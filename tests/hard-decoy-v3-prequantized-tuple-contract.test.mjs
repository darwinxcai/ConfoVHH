import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadPrequantizedTupleContract } from '../scripts/hard-decoy-v3/prequantized-tuple-contract.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const contract = await loadPrequantizedTupleContract();
const tuple = (patch = {}) => ({
  evidenceBandOrdinal: 2,
  severeClashResiduePairCount: 2,
  maximumVdwOverlapBin: 120,
  imgtNumberingAvailable: true,
  cdrContactShare: 0.5,
  interfaceResiduePairCount: 20,
  deltaSasaBin: 1000,
  ...patch,
});

test('the utility binds the original scoring contract without claiming an executable engine', () => {
  assert.equal(contract.contractSha256, '88c144fa7708901c910cea2f8ba000352f2d8f4ce0cb07d4084f6e26948b2698');
  assert.equal(contract.declaredEngineCommit, '04c6bda2289157dd294c290609f6052aa0ef9195');
  assert.equal(contract.declaredEngineTree, '1d0bc74ca7ca8d59de840b224e453bb61bd8e6b9');
  assert.equal(contract.status, 'PARTIAL_PREQUANTIZED_CONTRACT_UTILITY');
  assert.deepEqual(Object.values(contract.boundary), Array(7).fill(false));
  assert.deepEqual(contract.fieldMapping.filter((field) => field.quantizationUnit !== null), [
    { inputField: 'maximumVdwOverlapBin', contractField: 'maximumVdwOverlapAngstrom', direction: 'ascending', quantizationUnit: 0.01 },
    { inputField: 'deltaSasaBin', contractField: 'deltaSasaAngstromSquared', direction: 'descending', quantizationUnit: 1 },
  ]);
  assert.ok(Object.isFrozen(contract) && Object.isFrozen(contract.boundary) && Object.isFrozen(contract.fieldMapping));
  assert.ok(contract.fieldMapping.every(Object.isFrozen));
});

test('contract alteration fails even when valid JSON preserves the tuple fields', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'confovhh-tuple-contract-'));
  try {
    const target = path.join(root, contract.contractPath);
    await mkdir(path.dirname(target), { recursive: true });
    const bytes = await readFile(path.join(ROOT, contract.contractPath));
    await writeFile(target, bytes);
    assert.equal((await loadPrequantizedTupleContract({ repositoryRoot: root })).contractSha256, contract.contractSha256);
    await writeFile(target, `${bytes.toString('utf8')}\n`);
    await assert.rejects(loadPrequantizedTupleContract({ repositoryRoot: root }), /contract identity mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('every earlier tuple field defeats maximally favorable later fields', () => {
  const favored = [3, 0, -1000, true, 1, 100000, 100000];
  const disfavored = [0, 100000, 100000, false, null, 0, -1000];
  const fields = contract.fieldMapping.map((field) => field.inputField);
  for (let index = 0; index < fields.length; index += 1) {
    const winner = tuple();
    const loser = tuple();
    for (let tail = index; tail < fields.length; tail += 1) {
      winner[fields[tail]] = tail === index ? favored[tail] : disfavored[tail];
      loser[fields[tail]] = tail === index ? disfavored[tail] : favored[tail];
    }
    assert.equal(contract.compareTuples(winner, loser), -1, fields[index]);
    assert.equal(contract.compareTuples(loser, winner), 1, fields[index]);
  }
});

test('missing CDR share follows zero while equal missing shares defer to the next field', () => {
  assert.equal(contract.compareTuples(tuple({ cdrContactShare: 0 }), tuple({ cdrContactShare: null })), -1);
  assert.equal(contract.compareTuples(tuple({ cdrContactShare: null, interfaceResiduePairCount: 21 }), tuple({ cdrContactShare: null })), -1);
  // The comparator neither infers a share from availability nor alters a supplied share.
  assert.equal(contract.compareTuples(tuple({ imgtNumberingAvailable: true, cdrContactShare: null }), tuple({ imgtNumberingAvailable: false, cdrContactShare: 1 })), -1);
});

test('complete ties remain ties under input order and external identifier permutations', () => {
  const rows = ['z', 'a', 'm'].map((id) => ({ id, key: tuple() }));
  for (const permutation of [rows, [...rows].reverse(), [rows[1], rows[2], rows[0]]]) {
    for (const left of permutation) for (const right of permutation) {
      assert.equal(contract.compareTuples(left.key, right.key), 0);
    }
    assert.deepEqual([...permutation].sort((a, b) => contract.compareTuples(a.key, b.key)).map((row) => row.id), permutation.map((row) => row.id));
  }
  for (const display of [{ poseId: 'a' }, { attemptId: 'a' }, { coordinateSha256: '0'.repeat(64) }]) {
    assert.throws(() => contract.compareTuples(tuple(display), tuple()), /exactly the seven/);
  }
});

test('bin indices stay discrete, signed and exact without implicit rounding or epsilon ties', () => {
  assert.equal(contract.compareTuples(tuple({ maximumVdwOverlapBin: 120 }), tuple({ maximumVdwOverlapBin: 121 })), -1);
  assert.equal(contract.compareTuples(tuple({ deltaSasaBin: 1001 }), tuple({ deltaSasaBin: 1000 })), -1);
  assert.equal(contract.compareTuples(tuple({ maximumVdwOverlapBin: -Number.MAX_SAFE_INTEGER }), tuple({ maximumVdwOverlapBin: Number.MAX_SAFE_INTEGER })), -1);
  assert.equal(contract.compareTuples(tuple({ cdrContactShare: 0.5 + Number.EPSILON }), tuple({ cdrContactShare: 0.5 })), -1);
  for (const field of ['maximumVdwOverlapBin', 'deltaSasaBin']) {
    for (const value of [0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, null, '120']) {
      assert.throws(() => contract.compareTuples(tuple({ [field]: value }), tuple()), /supplied safe integer bin index/);
    }
  }
  assert.throws(() => contract.compareTuples(tuple({ maximumVdwOverlapAngstrom: 1.205 }), tuple()), /exactly the seven/);
});

test('invalid and incomplete tuples fail before a favorable early field can short-circuit validation', () => {
  for (const patch of [
    { evidenceBandOrdinal: 4 }, { evidenceBandOrdinal: 1.5 },
    { severeClashResiduePairCount: -1 }, { interfaceResiduePairCount: 2.5 },
    { imgtNumberingAvailable: 1 }, { cdrContactShare: -0.1 },
    { cdrContactShare: 1.1 }, { cdrContactShare: NaN }, { cdrContactShare: undefined },
    { deltaSasaBin: undefined },
  ]) assert.throws(() => contract.compareTuples(tuple({ evidenceBandOrdinal: 3, ...patch }), tuple({ evidenceBandOrdinal: 0 })));
  for (const field of contract.fieldMapping.map((item) => item.inputField)) {
    const incomplete = tuple();
    delete incomplete[field];
    assert.throws(() => contract.compareTuples(incomplete, tuple()), /exactly the seven/);
  }
  let accessed = false;
  const accessor = tuple();
  Object.defineProperty(accessor, 'cdrContactShare', { enumerable: true, get() { accessed = true; return 0.5; } });
  assert.throws(() => contract.compareTuples(accessor, tuple()), /data property/);
  assert.equal(accessed, false);
  assert.throws(() => contract.compareTuples({ ...tuple(), [Symbol('extra')]: 1 }, tuple()), /exactly the seven/);
  assert.throws(() => contract.compareTuples(Object.assign(Object.create({ inherited: true }), tuple()), tuple()), /plain object/);
  const original = tuple();
  const snapshot = contract.validateTuple(original);
  original.evidenceBandOrdinal = 0;
  assert.equal(snapshot.evidenceBandOrdinal, 2);
  assert.ok(Object.isFrozen(snapshot));
});

test('the preorder is reflexive, antisymmetric and transitive on an exhaustive synthetic cross-product', () => {
  const rows = [];
  for (const ordinal of [0, 3]) for (const count of [0, 2]) for (const overlap of [-1, 1]) {
    for (const available of [false, true]) for (const cdr of [null, 0, 1]) {
      rows.push(tuple({ evidenceBandOrdinal: ordinal, severeClashResiduePairCount: count, maximumVdwOverlapBin: overlap, imgtNumberingAvailable: available, cdrContactShare: cdr, interfaceResiduePairCount: count, deltaSasaBin: overlap }));
    }
  }
  // Cache comparisons once; exhaustive triple implications then exercise all orders.
  const relation = rows.map((left) => rows.map((right) => contract.compareTuples(left, right)));
  for (let i = 0; i < rows.length; i += 1) {
    assert.equal(relation[i][i], 0);
    for (let j = 0; j < rows.length; j += 1) {
      assert.equal(relation[i][j] + relation[j][i], 0);
      for (let k = 0; k < rows.length; k += 1) {
        if (relation[i][j] <= 0 && relation[j][k] <= 0) assert.ok(relation[i][k] <= 0);
      }
    }
  }
});
