import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDevelopmentComparison } from './compare-domain-remainder-development.mjs';
import { canonicalJson, parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BASE = 'validation/hard-decoy-holdout-v3';
const SCRIPT = 'scripts/hard-decoy-v3/compare-mglyr-development.mjs';
export const MGLYR_OUTPUT = `${BASE}/mglyr-development-review-2026-09-08`;
const IDS = ['9VOR', '9VOS'];
const NB20 = '4d18b2d2954bc60334d58cb9ef20a8bc36c3de841fdaa85074c4a0876775abbc';
const PINNED = {
  [`${BASE}/annotation-discovery-2026-09-04/entries.jsonl`]: 'ab4ebb4597948b973af33ae55763c0f8a65fcbfe66db3748d24478ec33a429df',
  [`${BASE}/annotation-screen-2026-09-04/entity-screens.jsonl`]: '5f583d2f7c4f8f2990f0a1f4281b597365fe53f6f3d334740529469052f0c1d1',
  [`${BASE}/annotation-screen-2026-09-04/sequence-screens.jsonl`]: 'f7767c377cb6c9e74bdedc87c9133ec17adcf0bc3d552231148edd43cc8b6557',
  [`${BASE}/annotation-priority-review-2026-09-04/source-reviews.json`]: '67765a9c985b84f73fe7fa36e16dd0068457cb56a10a2d20bcecff24f09e9c20',
  [`${BASE}/mglyr-construct-followup-2026-09-04/construct-followup.json`]: 'a5ce563ba0c7ef839deca77f9ca3f88880fb37c67fc2f922283483186bbe51af',
  [`${BASE}/mglyr-construct-followup-2026-09-04/navigation-exposure-caveat.json`]: 'a65c5fc5e73ad7aacaaa24f4272601d74d610ab425418eb7ebab7b3154b8fe3a',
  [`${BASE}/vhh-sequence-pregraph-2026-08-29/development-vhh-profiles.jsonl`]: '1c791d337d628a1de397eb33cfe5685d76953e169bfbf1077798365fa9fa8730',
  [`${BASE}/receptor-tm-pregraph-2026-08-30/development-receptor-profiles.jsonl`]: '0a120c9ac73ce5acbb33cb638d2fe396942cf6dff302d3a81e74a789af797b65',
  [`${BASE}/receptor-tm-pregraph-2026-08-30/candidate-receptor-profiles.jsonl`]: 'ac6d733ec4658b17349b8ca63cc9a4fbf18ce9c761b7c9ed38fcd4854e8b15f3',
  [`${BASE}/vhh-sequence-contract-2026-08-29.json`]: 'bc31adf14cf1222ebade348337facefb209c286c631f0da0bf640bd778b0688f',
  [`${BASE}/receptor-tm-contract-2026-08-30.json`]: 'abd88bbae2d35fda28dc9339f80d91c65d95c4b9f844d74ddff7249090eea412',
  'HARD_DECOY_PROTOCOL_V3.md': '1b7b869fbc777ed794a4397a418fbf92dc4fe58392f75405b5304d5de455b376',
  'scripts/hard-decoy-v3/compare-domain-remainder-development.mjs': '60a9448f4f42c21f87ff1d998eb0ee773570a9eeec9b065c9f9659e8b3cfd990',
  'scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs': '5e46e17d7f14315bd9f87da60dffb7db7ce7a328c6db96e1e8f9fe8c9662ffeb',
  'scripts/hard-decoy/v3-receptor-tm-pregraph.mjs': '4316347ee87f6c945f3cb3ed8b3128bb3b2468ec5dfdb158d4e297119821fa6b',
  'node_modules/immunum/immunum.js': 'a53007322b0a006421fd65d816a6e4f4c4cd2f5b4092e824bb9367bad1f92f00',
  'node_modules/immunum/immunum_bg.wasm': '68804983b37b3746f65d84c9c6c0e703361ea9191fe3edc3d0748cddad2c646b',
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const text = object => `${canonicalJson(object)}\n`;
const rowsText = rows => rows.map(text).join('');
const parse = bytes => parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumCharacters: 64000000, maximumTokens: 4000000, maximumDepth: 32 });
const rows = bytes => {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.ok(decoded.endsWith('\n'), 'JSONL input must end with LF');
  return decoded.trimEnd().split('\n').map(line => parse(Buffer.from(line)));
};

async function boundRead(root, relative, expected) {
  assert.ok(!path.isAbsolute(relative) && relative.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe input path');
  const file = path.join(root, relative);
  assert.equal(await realpath(file), file, `Symlink input forbidden: ${relative}`);
  const info = await lstat(file, { bigint: true });
  assert.ok(info.isFile() && info.nlink === 1n && info.size <= 64000000n, `Invalid bounded file: ${relative}`);
  const bytes = await readFile(file);
  assert.equal(BigInt(bytes.length), info.size, `Input changed while reading: ${relative}`);
  if (expected) assert.equal(sha(bytes), expected, `Pinned input changed: ${relative}`);
  return bytes;
}

/** Scope validation is separate from ranking/eligibility and retains every deposited polymer. */
export function selectMglyrInputs({ entries, entityScreens, sequenceScreens, sourceReview }) {
  const selected = entries.filter(row => IDS.includes(row.pdbId));
  assert.deepEqual(selected.map(row => row.pdbId).sort(), IDS, 'Expected both unique mGlyR entries');
  selected.sort((a, b) => a.pdbId.localeCompare(b.pdbId));
  const screens = entityScreens.filter(row => IDS.includes(row.pdbId));
  assert.equal(screens.length, 6, 'Expected all six polymer screen records');
  assert.equal(new Set(screens.map(row => `${row.pdbId}_${row.entityId}`)).size, 6, 'Duplicate polymer screen identity');
  const selectedDigests = new Set();
  for (const entry of selected) {
    assert.equal(entry.polymerEntities.length, entry.pdbId === '9VOR' ? 2 : 4, 'Polymer scope changed');
    assert.equal(new Set(entry.polymerEntities.map(row => row.entityId)).size, entry.polymerEntities.length, 'Duplicate polymer identity');
    assert.equal(entry.polymerEntityCountReported, entry.polymerEntities.length, 'Deposited inventory incomplete');
    const reviews = sourceReview.reviews.filter(row => row.pdbId === entry.pdbId);
    assert.equal(reviews.length, 1, 'Missing or duplicate bound source review');
    const review = reviews[0];
    assert.equal(review.depositionLinkage.pdbIdExplicitlyNamed, true, 'Exact deposition link missing');
    assert.equal(review.receptorAccession, 'Q5T848', 'Receptor context changed');
    assert.equal(review.resolvedPrimaryCitation.doi, '10.1038/s41467-026-68339-x', 'Primary citation changed');
    for (const entity of entry.polymerEntities) {
      assert.equal(sha(entity.sequence), entity.sequenceSha256, 'Entity sequence digest mismatch');
      assert.equal(entity.sequence.length, entity.sequenceLength, 'Entity sequence length mismatch');
      const screen = screens.find(row => row.pdbId === entry.pdbId && row.entityId === entity.entityId);
      assert.ok(screen && screen.sequenceSha256 === entity.sequenceSha256, 'Screen identity or sequence mismatch');
      const reviewed = review.allFrozenPolymerEntities.filter(row => row.entityId === entity.entityId);
      assert.equal(reviewed.length, 1, 'Source inventory entity missing or duplicate');
      assert.equal(reviewed[0].sequenceSha256, entity.sequenceSha256, 'Source inventory differs');
      selectedDigests.add(entity.sequenceSha256);
    }
    const candidates = entry.polymerEntities.filter(row => row.sequenceSha256 === NB20);
    assert.equal(candidates.length, 1, 'Expected one deposited Nb20 sequence per entry');
    assert.equal(candidates[0].entityId, entry.pdbId === '9VOR' ? '2' : '4', 'Nb20 entity identity changed');
  }
  const sequences = sequenceScreens.filter(row => selectedDigests.has(row.sequenceSha256));
  assert.equal(sequences.length, selectedDigests.size, 'Missing or duplicate sequence screen');
  assert.equal(new Set(sequences.map(row => row.sequenceSha256)).size, selectedDigests.size, 'Duplicate sequence screen digest');
  assert.deepEqual(sequences.map(row => row.sequenceSha256).sort(), [...selectedDigests].sort(), 'Sequence screen digest inventory mismatch');
  return { entries: selected, entityScreens: screens, sequenceScreens: sequences };
}

export async function buildMglyrDevelopmentFiles({ repositoryRoot = ROOT } = {}) {
  const root = path.resolve(repositoryRoot);
  assert.equal(await realpath(root), root, 'Repository root cannot contain symlinks');
  const inputDigests = {}, loaded = new Map();
  for (const [relative, expected] of Object.entries(PINNED)) {
    const bytes = await boundRead(root, relative, expected);
    loaded.set(relative, bytes); inputDigests[relative] = { sha256: sha(bytes), bytes: bytes.length };
  }
  for (const relative of [SCRIPT, 'scripts/hard-decoy/oracle/canonical-json.mjs', 'package-lock.json', 'node_modules/immunum/package.json']) {
    const bytes = await boundRead(root, relative);
    inputDigests[relative] = { sha256: sha(bytes), bytes: bytes.length };
  }
  const get = relative => loaded.get(`${BASE}/${relative}`);
  const selected = selectMglyrInputs({ entries: rows(get('annotation-discovery-2026-09-04/entries.jsonl')),
    entityScreens: rows(get('annotation-screen-2026-09-04/entity-screens.jsonl')),
    sequenceScreens: rows(get('annotation-screen-2026-09-04/sequence-screens.jsonl')),
    sourceReview: parse(get('annotation-priority-review-2026-09-04/source-reviews.json')) });
  const result = buildDevelopmentComparison({ ...selected,
    developmentVhh: rows(get('vhh-sequence-pregraph-2026-08-29/development-vhh-profiles.jsonl')),
    developmentReceptors: rows(get('receptor-tm-pregraph-2026-08-30/development-receptor-profiles.jsonl')),
    canonicalProfiles: rows(get('receptor-tm-pregraph-2026-08-30/candidate-receptor-profiles.jsonl')),
    vhhContract: parse(get('vhh-sequence-contract-2026-08-29.json')),
    receptorContract: parse(get('receptor-tm-contract-2026-08-30.json')) });
  assert.equal(result.summary.selectedEntityCount, 2);
  assert.equal(result.summary.entityDevelopmentVhhPairCount, 36);
  assert.equal(result.summary.entryDevelopmentReceptorPairCount, 34);
  const summary = { ...result.summary, scope: 'GPR158/mGlyR Nb20 development-reference comparison only',
    independentlyEligibleGroupsAdded: 0, independenceCertified: false, predictionAccuracyMeasured: false,
    missingCanonicalProfileIsNotNegativeComparison: true,
    currentWorkAccessedPrimaryBody: false, previousExposureCaveatsRemainActive: true,
    remainingBlockers: ['Exact cryo-EM receptor truncation and Nb20 tag provenance require unavailable supplementary Methods.',
      'Q5T848 lacks a retained canonical GPCRdb TM1–TM7 profile; UniProt boundaries are not silently substituted.',
      'Known parent/variant provenance, candidate-to-candidate comparisons, publication-family and formal global graph review remain incomplete.',
      'The retained earlier navigation/figure-heading exposure caveat requires review; no clean-blind or exposure-clearance claim is made.'] };
  const files = new Map([
    ['summary.json', text(summary)], ['pair-space-commitments.json', text(result.commitments)],
    ['entity-review.jsonl', rowsText(result.entityRows)], ['domain-calls.jsonl', rowsText(result.calls)],
    ['domain-profiles.jsonl', rowsText(result.profileRows)], ['domain-development-vhh-matrix.jsonl', rowsText(result.comparisonRows)],
    ['entity-development-vhh-matrix.jsonl', rowsText(result.vhhMatrix)], ['receptor-review.jsonl', rowsText(result.receptorRows)],
    ['entry-development-receptor-matrix.jsonl', rowsText(result.receptorMatrix)],
  ]);
  files.set('README.md', `# mGlyR/Nb20 development-reference comparison\n\nThe two source-linked entries 9VOR and 9VOS contain the same deposited Nb20 sequence. This packet closes their missing frozen framework/CDR3 comparison to all 18 development VHH profiles, preserving all six polymers and 36 entry-entity/reference pairs. They are one source/sequence review family, with no independent-component certification.\n\nThe unchanged IMGT numbering and frozen affine-alignment implementation reproduce ${summary.reproducedDevelopmentVhhProfileCount} development profiles and ${summary.uniqueDomainProfileCount} candidate domain profile. ${summary.positiveVhhEntityCount} candidate entities have a positive threshold signal; ${summary.unresolvedDomainProfileCount} domain profiles remain unresolved. Negative sequence comparisons establish neither unrelated ancestry nor a formal no-edge decision.\n\nAll 34 entry/development receptor pairs remain explicitly unresolved because the retained GPCRdb canonical profiles omit Q5T848. Earlier UniProt checks show all seven TM segment sequences in the deposit, but those boundaries are not substituted for the frozen GPCRdb definition.\n\nExact preparation/tag provenance, known parents, candidate-to-candidate/global graph integration and prior navigation-exposure review remain open. No primary article bodies, coordinates, relative poses, contact tables, labels or prediction outputs are accessed in this computation. No disposition, eligibility, frozen input or exposure clearance changes. Formally cleared independent groups remain zero.\n\nVerify: \`node scripts/hard-decoy-v3/compare-mglyr-development.mjs verify\`. Collect a new packet: \`node scripts/hard-decoy-v3/compare-mglyr-development.mjs collect --output-directory NEW_EMPTY_DIRECTORY\`. The exact input hashes, source/dependency hashes, complete pair inventories and every output byte are replayed offline.\n`);
  files.set('manifest.json', text({ schemaVersion: '1.0.0', inputDigests, scopePdbIds: IDS,
    metadataOnly: true, formalGraphAuthority: false, deterministicOfflineReplay: true,
    files: [...files].map(([name, value]) => ({ name, sha256: sha(value), bytes: Buffer.byteLength(value) })) }));
  files.set('checksums.sha256', [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${sha(value)}  ${name}\n`).join(''));
  return { files, summary };
}

export async function runMglyrDevelopmentReview(mode, { repositoryRoot = ROOT, outputDirectory = path.join(repositoryRoot, MGLYR_OUTPUT) } = {}) {
  assert.ok(['collect', 'verify'].includes(mode), 'Expected collect or verify');
  const result = await buildMglyrDevelopmentFiles({ repositoryRoot });
  const output = path.resolve(outputDirectory);
  if (mode === 'collect') await mkdir(output, { recursive: true });
  assert.equal(await realpath(output), output, 'Output directory cannot contain symlinks');
  const inventory = await readdir(output);
  if (mode === 'collect') {
    assert.deepEqual(inventory, [], 'Collection requires an empty new directory');
    for (const [name, value] of result.files) await writeFile(path.join(output, name), value, { flag: 'wx' });
  } else {
    assert.deepEqual(inventory.sort(), [...result.files.keys()].sort(), 'Output inventory changed');
    for (const [name, value] of result.files) assert.ok((await boundRead(output, name)).equals(Buffer.from(value)), `Offline replay mismatch: ${name}`);
  }
  return result.summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), mode = args.shift(), options = {};
  while (args.length) {
    const flag = args.shift(), value = args.shift();
    assert.ok(value && ['--repository-root', '--output-directory'].includes(flag), 'Invalid CLI arguments');
    const key = flag === '--repository-root' ? 'repositoryRoot' : 'outputDirectory';
    assert.ok(!(key in options), 'Duplicate CLI argument'); options[key] = path.resolve(value);
  }
  console.log(JSON.stringify(await runMglyrDevelopmentReview(mode, options), null, 2));
}
