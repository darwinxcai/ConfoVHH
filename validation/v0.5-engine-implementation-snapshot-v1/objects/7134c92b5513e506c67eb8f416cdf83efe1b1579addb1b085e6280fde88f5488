import assert from "node:assert/strict";

export const MAX_PUBLIC_COORDINATE_BYTES = 4 * 1024 * 1024;
export const PUBLIC_DOWNLOAD_TIMEOUT_MILLISECONDS = 30_000;

export async function downloadPublicCoordinate(
  url,
  label,
  {
    fetchImplementation = fetch,
    maximumBytes = MAX_PUBLIC_COORDINATE_BYTES,
    timeoutMilliseconds = PUBLIC_DOWNLOAD_TIMEOUT_MILLISECONDS,
  } = {},
) {
  assert.ok(Number.isSafeInteger(maximumBytes) && maximumBytes > 0);
  assert.ok(Number.isSafeInteger(timeoutMilliseconds) && timeoutMilliseconds > 0);
  const limitLabel = maximumBytes === MAX_PUBLIC_COORDINATE_BYTES
    ? "4 MiB"
    : `${maximumBytes.toLocaleString("en-US")} bytes`;
  const response = await fetchImplementation(url, {
    signal: AbortSignal.timeout(timeoutMilliseconds),
  });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  const declaredHeader = response.headers.get("content-length");
  if (declaredHeader != null) {
    if (!/^\d+$/u.test(declaredHeader)) {
      throw new Error(`${label}: malformed Content-Length response header`);
    }
    const declaredLength = Number(declaredHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > maximumBytes) {
      throw new Error(`${label}: declared response exceeds the ${limitLabel} public-coordinate limit`);
    }
  }
  assert.ok(response.body, `${label}: response body is unavailable`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("public coordinate response exceeded configured byte limit");
        throw new Error(`${label}: streamed response exceeds the ${limitLabel} public-coordinate limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}
