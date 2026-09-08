import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  fetchExactPublicFile,
  fetchExactPublicFiles,
  zenodoRecordFileUrl,
} from "../scripts/fetch-exact-public-file.mjs";

// All bodies are synthetic text. No real coordinates, confidence or labels.
const BODY = Buffer.from("synthetic immutable public artifact\n");
const FILE = Object.freeze({
  filename: "synthetic.txt", url: "https://synthetic.invalid/immutable.txt",
  bytes: BODY.length, sha256: createHash("sha256").update(BODY).digest("hex"),
});

function harness(responses, options = {}) {
  const requests = [], delays = [], retries = [];
  return {
    requests, delays, retries,
    run(file = FILE) {
      return fetchExactPublicFile(file, {
        fetchImplementation: async (url, init) => {
          requests.push({ url, init });
          assert.ok(responses.length, "unexpected extra download");
          const response = responses.shift();
          if (response instanceof Error) throw response;
          return typeof response === "function" ? response(init) : response;
        },
        sleepImplementation: async (milliseconds) => { delays.push(milliseconds); },
        onRetry: (record) => retries.push(record),
        ...options,
      });
    },
  };
}

test("HTTP 504 and 502 recover with bounded backoff and the identical URL", async () => {
  const first = new Response("synthetic timeout", { status: 504 });
  const run = harness([first, new Response("synthetic gateway", { status: 502 }), new Response(BODY)]);
  assert.deepEqual(await run.run(), { path: FILE.filename, bytes: FILE.bytes, sha256: FILE.sha256, text: BODY.toString() });
  assert.deepEqual(run.delays, [1000, 2000]);
  assert.deepEqual(run.requests.map((r) => r.url), [FILE.url, FILE.url, FILE.url]);
  assert.ok(run.requests.every((r) => r.init.redirect === "follow" && r.init.signal instanceof AbortSignal));
  assert.equal(first.bodyUsed, true, "failed response body was cancelled");
});

test("HTTP 503 and 429 honor bounded Retry-After seconds and HTTP date", async () => {
  const now = Date.UTC(2026, 8, 8, 12);
  const run = harness([
    new Response(null, { status: 503, headers: { "Retry-After": "3" } }),
    new Response(null, { status: 429, headers: { "Retry-After": new Date(now + 7000).toUTCString() } }),
    new Response(BODY),
  ], { nowImplementation: () => now });
  await run.run();
  assert.deepEqual(run.delays, [3000, 7000]);
});

test("excessive Retry-After fails without retrying earlier than requested", async () => {
  const run = harness([new Response(null, { status: 429, headers: { "Retry-After": "120" } }), new Response(BODY)]);
  await assert.rejects(run.run(), /Retry-After exceeds/u);
  assert.equal(run.requests.length, 1);
  assert.deepEqual(run.delays, []);
});

test("malformed Retry-After uses bounded backoff", async () => {
  const run = harness([new Response(null, { status: 503, headers: { "Retry-After": "1.5" } }), new Response(BODY)]);
  await run.run();
  assert.deepEqual(run.delays, [1000]);
});

test("permanent 404, 403 and ordinary HTTP 500 are not retried", async () => {
  for (const status of [404, 403, 500]) {
    const run = harness([new Response(null, { status }), new Response(BODY)]);
    await assert.rejects(run.run(), new RegExp(`HTTP ${status}`, "u"));
    assert.equal(run.requests.length, 1);
    assert.deepEqual(run.delays, []);
  }
});

test("transient connection failure and interrupted response body can recover", async () => {
  const network = new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
  const interruptedBody = {
    ok: true,
    arrayBuffer: async () => { throw new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } }); },
  };
  const run = harness([network, interruptedBody, new Response(BODY)]);
  assert.equal((await run.run()).sha256, FILE.sha256);
  assert.equal(run.requests.length, 3);
});

test("attempt timeout retries without requiring a real network", async () => {
  const run = harness([
    ({ signal }) => new Promise((resolve, reject) => {
      const keepAlive = setTimeout(resolve, 1000);
      signal.addEventListener("abort", () => { clearTimeout(keepAlive); reject(signal.reason); }, { once: true });
    }),
    new Response(BODY),
  ], { timeoutMilliseconds: 10 });
  assert.equal((await run.run()).bytes, FILE.bytes);
  assert.equal(run.requests.length, 2);
});

test("transport retries stop after three attempts", async () => {
  const run = harness(Array.from({ length: 4 }, () => new Response(null, { status: 504 })));
  await assert.rejects(run.run(), /HTTP 504; exhausted 3 attempts/u);
  assert.equal(run.requests.length, 3);
  assert.deepEqual(run.delays, [1000, 2000]);
});

test("TLS errors and unrelated programming exceptions fail immediately", async () => {
  for (const error of [new TypeError("fetch failed", { cause: { code: "CERT_HAS_EXPIRED" } }), new TypeError("fixture programming error")]) {
    const run = harness([error, new Response(BODY)]);
    await assert.rejects(run.run(), (actual) => actual === error);
    assert.equal(run.requests.length, 1);
  }
});

test("matching byte length but changed SHA-256 is never retried or accepted", async () => {
  const changed = Buffer.from(BODY);
  changed[0] ^= 1;
  const run = harness([new Response(changed), new Response(BODY)]);
  await assert.rejects(run.run(), /SHA-256 changed/u);
  assert.equal(run.requests.length, 1);
  assert.deepEqual(run.delays, []);
});

test("byte-count drift after transient recovery fails before another retry", async () => {
  const run = harness([new Response(null, { status: 504 }), new Response("short"), new Response(BODY)]);
  await assert.rejects(run.run(), /byte count changed/u);
  assert.equal(run.requests.length, 2);
  assert.deepEqual(run.delays, [1000]);
});

test("a matching hash cannot authorize invalid UTF-8 or trigger a retry", async () => {
  const invalid = Buffer.from([0xff]);
  const file = { ...FILE, bytes: 1, sha256: createHash("sha256").update(invalid).digest("hex") };
  const run = harness([new Response(invalid), new Response(BODY)]);
  await assert.rejects(run.run(file), /encoded data was not valid/u);
  assert.equal(run.requests.length, 1);
});

test("batch retrieval preserves order and enforces source-specific concurrency", async () => {
  const files = Array.from({ length: 7 }, (_, index) => ({ filename: `synthetic-${index}` }));
  for (const maximumConcurrency of [1, 4]) {
    let active = 0;
    let peak = 0;
    const starts = [];
    const result = await fetchExactPublicFiles(files, {
      maximumConcurrency,
      fetchOne: async (file) => {
        starts.push(file.filename);
        active++;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 2));
        active--;
        return `downloaded:${file.filename}`;
      },
    });
    assert.equal(peak, maximumConcurrency);
    assert.deepEqual(starts, files.map(file => file.filename));
    assert.deepEqual(result, files.map(file => `downloaded:${file.filename}`));
  }
});

test("batch retrieval rejects unbounded work and invalid concurrency", async () => {
  await assert.rejects(fetchExactPublicFiles([]), /bounded file list/u);
  await assert.rejects(fetchExactPublicFiles(Array.from({ length: 129 }, () => FILE)), /bounded file list/u);
  for (const maximumConcurrency of [0, 5, 1.5]) {
    await assert.rejects(fetchExactPublicFiles([FILE], { maximumConcurrency }), /maximum concurrency/u);
  }
});

test("Zenodo public record URLs encode one bounded filename without API credentials", () => {
  assert.equal(
    zenodoRecordFileUrl(17063524, "synthetic file.json"),
    "https://zenodo.org/records/17063524/files/synthetic%20file.json?download=1",
  );
  for (const [record, filename] of [[0, "x"], ["abc", "x"], [1, "../x"], [1, "a/b"], [1, "a\\b"], [1, "\u200bx"]]) {
    assert.throws(() => zenodoRecordFileUrl(record, filename));
  }
});
