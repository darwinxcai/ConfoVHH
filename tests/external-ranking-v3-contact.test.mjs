import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createContactOnlyEngine, deriveContactModule, contactEvidenceDigest, validateContactEvidence } from '../scripts/external-ranking-v3/contact-only.mjs';
import { decomposeCdr } from '../scripts/external-ranking-v3/policy.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENGINE = path.join(ROOT, 'validation/single-case-development-3p0g-2026-09-09/completed-pilot-execution03/frozen-source');
const engine = await createContactOnlyEngine(ENGINE, path.join(ROOT, 'validation/prospective-benchmark-v1/engine-lock.json'));

function structure(receptorCount = 1, vhhCount = 1, oneResidue = false) {
  const chains = [['R', receptorCount], ['V', vhhCount]].map(([id, n]) => {
    const atoms = Array.from({ length: n }, (_, i) => ({ serial: i+1, name: 'CA', residueName: 'ALA', chainId: id, residueNumber: oneResidue ? 1 : i+1,
      insertionCode: '', residueKey: id+':'+(oneResidue ? 1 : i+1), residueOrder: oneResidue ? 0 : i, x: 0, y: id === 'R' ? 0 : 4.5, z: 0, element: 'C', bFactor: null }));
    const residues = Array.from({ length: oneResidue ? 1 : n }, (_, i) => ({ key: id+':'+(i+1), chainId: id, name: 'ALA', number: i+1, insertionCode: '', order: i, oneLetter: 'A', atoms: oneResidue ? atoms : [atoms[i]] }));
    return { id, sequence: 'A'.repeat(residues.length), atomCount: n, residueCount: residues.length, residues };
  });
  return { chains, atoms: chains.flatMap(c => c.residues.flatMap(r => r.atoms)) };
}

test('contact phase uses inclusive cutoff, exact pair deduplication, and null at no contact or unavailable numbering', () => {
  const s = structure(2, 2, true), at = engine.analyze(s, 'R', 'V');
  assert.equal(at.contactPairCount, 1); assert.equal(at.atomContactCount, 4); assert.equal(at.contacts[0].minimumDistance, 4.5);
  assert.equal(at.vhhNumbering.status, 'unavailable'); assert.equal(at.paratopeProxyShare, null);
  for (const a of s.chains[1].residues[0].atoms) a.y = 4.5000000001;
  const outside = engine.analyze(s, 'R', 'V'); assert.equal(outside.contactPairCount, 0); assert.equal(outside.paratopeProxyShare, null);
  assert.equal(decomposeCdr(outside).components.contactPairs, 0);
});

test('contact phase retains finite coordinate bounds, local candidate cap and distinct pair cap', () => {
  const invalid = structure(); invalid.chains[0].residues[0].atoms[0].x = Infinity;
  assert.throws(() => engine.analyze(invalid, 'R', 'V'), /finite|coordinate/u);
  const bounded = structure(); bounded.chains[0].residues[0].atoms[0].x = 1e9;
  assert.throws(() => engine.analyze(bounded, 'R', 'V'), /coordinate/u);
  assert.throws(() => engine.analyze(structure(2300, 2300, true), 'R', 'V'), /too many local atom/u);
  assert.throws(() => engine.analyze(structure(225, 225), 'R', 'V'), /50,000/u);
});

test('source extraction refuses even a comment-only change and preserves frozen caps', async () => {
  const source = await readFile(path.join(ENGINE, 'lib/confovhh.ts'));
  assert.throws(() => deriveContactModule(Buffer.concat([source, Buffer.from('\n')]), ENGINE), /exact frozen/u);
  const derived = deriveContactModule(source, ENGINE);
  assert.ok(derived.module.includes('candidateAtomPairs > MAX_CANDIDATE_ATOM_PAIRS'));
  assert.ok(derived.module.includes('pairMap.size >= MAX_INTERFACE_RESIDUE_PAIRS'));
  assert.ok(!derived.module.includes('const buriedArea = calculateBuriedSurfaceArea('));
  assert.equal(engine.method.sasaExecuted, false);
});

test('standalone binding authenticates identity, roles, provenance kind, components and no-contact state', () => {
  const contact = engine.analyze(structure(), 'R', 'V'), coordinateSha256 = 'a'.repeat(64), sourceHash = 'b'.repeat(64);
  const manifest = { attempts: [{ id: 'a', setId: 's', coordinate: { sha256: coordinateSha256 } }], sets: [{ id: 's', receptorChain: 'R', vhhChain: 'V', selectedModelId: '1' }] };
  const report = { schema: 'confovhh-standalone-contact-evidence-v1', id: 'a', setId: 's', coordinateSha256, sourceScoreReceiptSha256: sourceHash, receptorChain: 'R', vhhChain: 'V', selectedModelId: '1',
    fullAuditDisposition: { status: 'absent', sourceAttemptStatus: 'unavailable', reason: 'Full audit size cap' }, method: engine.method, status: 'computed', reason: '', contact };
  const feature = { id: 'a', sourceAuditSha256: null, validity: { status: 'valid' }, contactEvidence: { kind: 'standalone-contact', sha256: contactEvidenceDigest(report) }, interface: { status: 'contacting', contactPairCount: 1 }, cdr: decomposeCdr(contact) };
  validateContactEvidence([feature], [report], manifest, sourceHash, engine.method);
  for (const mutate of [r => { r.vhhChain = 'X'; }, r => { r.coordinateSha256 = 'c'.repeat(64); }, r => { r.fullAuditDisposition.status = 'present'; }, r => { r.contact.DockQ = .8; }, r => { r.contact.atomContactCount += 1; }]) {
    const changed = structuredClone(report); mutate(changed);
    assert.throws(() => validateContactEvidence([feature], [changed], manifest, sourceHash, engine.method));
  }
  assert.throws(() => validateContactEvidence([{ ...feature, sourceAuditSha256: sourceHash }], [report], manifest, sourceHash, engine.method));
  assert.throws(() => validateContactEvidence([feature], [], manifest, sourceHash, engine.method));
});
