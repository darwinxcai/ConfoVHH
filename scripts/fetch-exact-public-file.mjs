import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
]);

export function zenodoRecordFileUrl(recordId, filename) {
  assert.match(String(recordId), /^[1-9][0-9]*$/u, "positive Zenodo record ID required");
  assert.ok(typeof filename === "string" && filename.length >= 1 && filename.length <= 512,
    "bounded Zenodo filename required");
  assert.ok(!/[\\/\p{Cc}\p{Cf}]/u.test(filename) && filename !== "." && filename !== "..",
    "Zenodo filename must be one path component");
  return `https://zenodo.org/records/${recordId}/files/${encodeURIComponent(filename)}?download=1`;
}

function transientNetworkError(error, signal) {
  if (signal.aborted && ["TimeoutError", "AbortError"].includes(error?.name)) return true;
  const code = error?.cause?.code ?? error?.code;
  if (code != null) return TRANSIENT_NETWORK_CODES.has(code);
  return error instanceof TypeError && error.message === "fetch failed";
}

function retryAfterMilliseconds(value, now) {
  if (value == null) return null;
  const text = value.trim();
  if (/^\d+$/u.test(text)) return Number(text) * 1000;
  // Do not let Date.parse interpret malformed numeric delays as calendar dates.
  if (!/^[A-Za-z]{3,9}[, ]/u.test(text)) return null;
  const instant = Date.parse(text);
  return Number.isFinite(instant) ? Math.max(0, instant - now) : null;
}

/** Retry transport failures only. Exact content checks run once, after download.
 *
 * Every attempt uses the same URL. No fallback source, weakened hash, partial
 * response cache or producer-record mutation is supported.
 */
export async function fetchExactPublicFile(file, {
  fetchImplementation = fetch,
  sleepImplementation = wait,
  nowImplementation = Date.now,
  onRetry = () => {},
  maximumAttempts = 3,
  timeoutMilliseconds = 60_000,
  initialDelayMilliseconds = 1_000,
  maximumDelayMilliseconds = 30_000,
} = {}) {
  assert.ok(typeof file?.filename === "string" && file.filename.length > 0, "filename required");
  assert.ok(Number.isSafeInteger(file.bytes) && file.bytes >= 0, "exact byte count required");
  assert.match(file.sha256, /^[a-f0-9]{64}$/u, "exact SHA-256 required");
  assert.ok(["http:", "https:"].includes(new URL(file.url).protocol), "HTTP(S) URL required");
  assert.ok(Number.isSafeInteger(maximumAttempts) && maximumAttempts >= 1 && maximumAttempts <= 5);
  assert.ok(Number.isSafeInteger(timeoutMilliseconds) && timeoutMilliseconds > 0 && timeoutMilliseconds <= 120_000);
  assert.ok(Number.isSafeInteger(initialDelayMilliseconds) && initialDelayMilliseconds >= 0);
  assert.ok(Number.isSafeInteger(maximumDelayMilliseconds) && maximumDelayMilliseconds >= initialDelayMilliseconds
    && maximumDelayMilliseconds <= 60_000);

  let bytes;
  for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
    const signal = AbortSignal.timeout(timeoutMilliseconds);
    let response;
    let failure;
    try {
      response = await fetchImplementation(file.url, { redirect: "follow", signal });
      if (response.ok) {
        // The timeout covers the response body as well as headers.
        bytes = Buffer.from(await response.arrayBuffer());
        break;
      }
    } catch (error) {
      if (!transientNetworkError(error, signal)) throw error;
      failure = new Error(`${file.filename}: transient download failure (${error.message})`, { cause: error });
    }
    if (!failure) {
      // Release unsuccessful responses before another request. Cancellation
      // failure must not replace the HTTP status that explains the retry.
      try { await response.body?.cancel(); } catch { /* Already closed/aborted. */ }
      failure = new Error(`${file.filename}: HTTP ${response.status}`);
      if (!TRANSIENT_HTTP_STATUSES.has(response.status)) throw failure;
    }
    if (attempt === maximumAttempts) {
      throw new Error(`${failure.message}; exhausted ${maximumAttempts} attempts`, { cause: failure });
    }
    const requestedDelay = response && !response.ok
      ? retryAfterMilliseconds(response.headers.get("retry-after"), nowImplementation())
      : null;
    if (requestedDelay != null && requestedDelay > maximumDelayMilliseconds) {
      throw new Error(`${failure.message}; Retry-After exceeds the ${maximumDelayMilliseconds} ms retry budget`, { cause: failure });
    }
    const backoff = Math.min(initialDelayMilliseconds * (2 ** (attempt - 1)), maximumDelayMilliseconds);
    const delayMilliseconds = Math.max(backoff, requestedDelay ?? 0);
    onRetry({ filename: file.filename, attempt, nextAttempt: attempt + 1, maximumAttempts, delayMilliseconds, reason: failure.message });
    await sleepImplementation(delayMilliseconds);
  }

  // A completed HTTP response with changed content is a provenance failure,
  // not a transient download: never retry it or accept a later matching body.
  assert.equal(bytes.byteLength, file.bytes, `${file.filename}: byte count changed`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, `${file.filename}: SHA-256 changed`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { path: file.filename, bytes: bytes.byteLength, sha256: file.sha256, text };
}

/** Preserve input order while limiting pressure on immutable public sources. */
export async function fetchExactPublicFiles(files, {
  maximumConcurrency = 4,
  fetchOne = fetchExactPublicFile,
} = {}) {
  assert.ok(Array.isArray(files) && files.length >= 1 && files.length <= 128, "bounded file list required");
  assert.ok(Number.isSafeInteger(maximumConcurrency) && maximumConcurrency >= 1 && maximumConcurrency <= 4,
    "maximum concurrency must be between 1 and 4");
  assert.equal(typeof fetchOne, "function", "fetch implementation required");
  const output = new Array(files.length);
  let cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const index = cursor++;
      output[index] = await fetchOne(files[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(maximumConcurrency, files.length) }, worker));
  return output;
}
