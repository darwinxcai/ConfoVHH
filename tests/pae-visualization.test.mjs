import assert from "node:assert/strict";
import test from "node:test";

import {
  createPaeCrossBlockSample,
  deterministicPaeMarkerSample,
} from "../lib/pae-visualization.ts";

function structure() {
  return {
    chains: [
      { id: "X", residueCount: 1 },
      { id: "R", residueCount: 2 },
      { id: "V", residueCount: 2 },
    ],
  };
}

function pae() {
  const residueCount = 5;
  const matrix = new Float32Array(residueCount * residueCount);
  const forward = [[2, 4], [6, 8]];
  const reverse = [[12, 14], [16, 18]];
  for (let receptor = 0; receptor < 2; receptor += 1) {
    for (let vhh = 0; vhh < 2; vhh += 1) {
      matrix[(1 + receptor) * residueCount + 3 + vhh] = forward[receptor][vhh];
      matrix[(3 + vhh) * residueCount + 1 + receptor] = reverse[receptor][vhh];
    }
  }
  return {
    matrix,
    residueCount,
    maxPaeAngstrom: 31.75,
    sourceFormat: "raw matrix",
    filename: "pae.json",
  };
}

test("extracts directional receptor/VHH PAE blocks in confirmed chain order", () => {
  const sample = createPaeCrossBlockSample(pae(), structure(), "R", "V", 10, 10);
  assert.equal(sample.receptorOffset, 1);
  assert.equal(sample.vhhOffset, 3);
  assert.equal(sample.width, 2);
  assert.equal(sample.height, 2);
  assert.deepEqual([...sample.receptorFrameToVhh], [2, 4, 6, 8]);
  assert.deepEqual([...sample.vhhFrameToReceptor], [12, 14, 16, 18]);
});

test("downsamples directional blocks by deterministic bin means", () => {
  const sample = createPaeCrossBlockSample(pae(), structure(), "R", "V", 1, 1);
  assert.deepEqual([...sample.receptorFrameToVhh], [5]);
  assert.deepEqual([...sample.vhhFrameToReceptor], [15]);
});

test("rejects stale dimensions, invalid chain roles, and invalid display caps", () => {
  const stale = pae();
  stale.residueCount = 4;
  assert.throws(() => createPaeCrossBlockSample(stale, structure(), "R", "V"), /square|inventory/i);
  assert.throws(() => createPaeCrossBlockSample(pae(), structure(), "R", "R"), /distinct/i);
  assert.throws(() => createPaeCrossBlockSample(pae(), structure(), "R", "V", 0, 10), /positive/i);
});

test("contact-marker sampling is bounded, deterministic, and endpoint preserving", () => {
  const source = Array.from({ length: 1_003 }, (_, index) => index);
  const first = deterministicPaeMarkerSample(source, 240);
  const second = deterministicPaeMarkerSample(source, 240);
  assert.equal(first.length, 240);
  assert.deepEqual(first, second);
  assert.equal(first[0], 0);
  assert.equal(first.at(-1), 1_002);
  assert.deepEqual(deterministicPaeMarkerSample(source, 0), []);
  assert.throws(() => deterministicPaeMarkerSample(source, -1), /non-negative/i);
});
