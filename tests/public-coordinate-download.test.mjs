import assert from "node:assert/strict";
import test from "node:test";

import {
  downloadPublicCoordinate,
  MAX_PUBLIC_COORDINATE_BYTES,
  PUBLIC_DOWNLOAD_TIMEOUT_MILLISECONDS,
} from "../scripts/public-coordinate-download.mjs";

function chunkedResponse(chunks, headers = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  }), { status: 200, headers });
}

test("bounded public download streams exact bytes and passes a timeout signal", async () => {
  let observedSignal;
  const bytes = await downloadPublicCoordinate("https://example.invalid/coordinates", "fixture", {
    maximumBytes: 6,
    timeoutMilliseconds: 1_000,
    fetchImplementation: async (_url, options) => {
      observedSignal = options.signal;
      return chunkedResponse([[1, 2], [3, 4, 5, 6]], { "content-length": "6" });
    },
  });
  assert.deepEqual([...bytes], [1, 2, 3, 4, 5, 6]);
  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, false);
});

test("bounded public download rejects declared and streamed byte overflows", async () => {
  await assert.rejects(
    downloadPublicCoordinate("https://example.invalid/declared", "declared", {
      maximumBytes: 4,
      fetchImplementation: async () => chunkedResponse([[1]], { "content-length": "5" }),
    }),
    /declared response exceeds the 4 bytes public-coordinate limit/,
  );
  await assert.rejects(
    downloadPublicCoordinate("https://example.invalid/streamed", "streamed", {
      maximumBytes: 4,
      fetchImplementation: async () => chunkedResponse([[1, 2, 3], [4, 5]]),
    }),
    /streamed response exceeds the 4 bytes public-coordinate limit/,
  );
});

test("bounded public download fails closed on malformed metadata and responses", async () => {
  await assert.rejects(
    downloadPublicCoordinate("https://example.invalid/length", "length", {
      fetchImplementation: async () => chunkedResponse([[1]], { "content-length": "not-a-number" }),
    }),
    /malformed Content-Length/,
  );
  await assert.rejects(
    downloadPublicCoordinate("https://example.invalid/status", "status", {
      fetchImplementation: async () => new Response("missing", { status: 404 }),
    }),
    /status: HTTP 404/,
  );
  await assert.rejects(
    downloadPublicCoordinate("https://example.invalid/body", "body", {
      fetchImplementation: async () => new Response(null, { status: 200 }),
    }),
    /response body is unavailable/,
  );
});

test("public download defaults are explicit release resource bounds", () => {
  assert.equal(MAX_PUBLIC_COORDINATE_BYTES, 4 * 1024 * 1024);
  assert.equal(PUBLIC_DOWNLOAD_TIMEOUT_MILLISECONDS, 30_000);
});
