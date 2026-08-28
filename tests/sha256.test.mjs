import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import test from "node:test";

import { sha256Hex, sha256HexSoftware } from "../lib/sha256.ts";

function deterministicBytes(length) {
  const bytes = new Uint8Array(length);
  let state = 0x9e3779b9;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state ^ (state >>> 16), 0x21f0aaad) + index) >>> 0;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

test("software SHA-256 matches Node across padding boundaries and large inputs", () => {
  for (const length of [0, 1, 3, 55, 56, 63, 64, 65, 127, 128, 1024, 1_000_003]) {
    const bytes = deterministicBytes(length);
    const expected = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256HexSoftware(bytes.buffer), expected, `length ${length}`);
  }
});

test("portable SHA-256 uses WebCrypto when available without changing the digest", async () => {
  const bytes = deterministicBytes(4097);
  const expected = createHash("sha256").update(bytes).digest("hex");
  assert.ok(webcrypto.subtle);
  assert.equal(await sha256Hex(bytes.buffer), expected);
});
