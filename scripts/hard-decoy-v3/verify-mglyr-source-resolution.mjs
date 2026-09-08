// Source-only integrity checks. This never reads native structures, labels or predictions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const BUNDLE_PATH = 'validation/hard-decoy-holdout-v3/mglyr-source-resolution-2026-09-08';
const DOI = '10.1038/s41467-026-68339-x';
const RESPONSE_SHA = '5841cd77f7242c75562f2eb1237edb2ee43720f2cbf71bb70bf1b202f6890776';
// The human-reviewed wording and provenance are immutable too. Local checksums
// alone cannot stop a revised claim from being paired with a revised checksum.
const REVIEWED_CANONICAL_SHA = {
  blocks: '7bb01f628d306efcae2df42ab508bc220c307a2353dd4222729e667507daf0bd',
  provenance: '181152f91b67cf2fcdf3d3791a85aae628d7fef4babd730f9a9b90c7a03bf680',
  attempts: '97d891ce6d4c06e987ee2286e0334068a49bf4baf43f9a9bbe48886a87909849',
  review: '2d241f7a2330b09b4a0c9eb2ccd0aa9c2f14f1d441278d3494c3bf23001ce726',
};
const sha = value => createHash('sha256').update(value).digest('hex');
const eq = (actual, expected, message) => assert.equal(canonicalJson(actual), canonicalJson(expected), message);
const SELECTORS = [
  ['Sec11.p0', 'Sec11', 'cDNA constructs', 0, 'd8836cc14669c1a90798541934762cf2825e9e195190bae151c8febb20a47051'],
  ['Sec13.p0', 'Sec13', 'Llama immunization, phage display', 0, '36be7276e4a5ff2096b5ddda1fea0d369a2e188bb197050e59d7f6c43168f9ad'],
  ['Sec13.p9', 'Sec13', 'Llama immunization, phage display', 9, '5e7caff275c5c6fc29ba2e7959c5eca4b79e2fb9ce3982840870105bb8faa6f7'],
  ['Sec14.p0', 'Sec14', 'Nanobody identification via phage library screening', 0, '72d4cec5093b72439e5b8c75f8e1d405a781f30c8303bc7ac86400b23044151e'],
  ['Sec15.p0', 'Sec15', 'Protein production and purification', 0, '221285e6848061d0b2e7ea4fb55a7c7fbfe45719c022d679deb22cd47281e540'],
];

/** Consistency verification of a human source review, not an automated ancestry adjudicator. */
export function validateMglyrSourceBundle({ blocks, provenance, attempts, review }) {
  eq(blocks.schema, 'confovhh-mglyr-selected-methods-v1');
  eq(blocks.sourceDoi, DOI);
  eq(blocks.sourcePmcid, 'PMC12834959');
  eq(blocks.sourceResponseSha256, RESPONSE_SHA);
  eq(blocks.paragraphs.map(p => [p.id, p.sectionId, p.sectionTitle, p.paragraphIndex, p.textSha256]), SELECTORS, 'Selected preparation paragraph inventory drift');
  for (const p of blocks.paragraphs) eq(sha(p.text), p.textSha256, `${p.id}: paragraph bytes changed`);
  eq(provenance.response.sha256, RESPONSE_SHA);
  eq(provenance.response.status, 200);
  eq(provenance.response.bytes, 173132);
  eq(provenance.response.url, blocks.sourceUrl);
  eq(provenance.license.url, 'http://creativecommons.org/licenses/by/4.0/');
  assert.ok(provenance.license.text.includes('Creative Commons Attribution 4.0 International License'));
  eq(provenance.extraction.sectionsAndZeroBasedParagraphs, blocks.paragraphs.map(p => ({ id: p.id, sectionId: p.sectionId, sectionTitle: p.sectionTitle, paragraphIndex: p.paragraphIndex, textSha256: p.textSha256 })));
  for (const key of ['rawFullArticleArchived', 'nativeCoordinatesInspected', 'nativeRelativePosesInspected', 'structuralContactTablesInspected', 'labelsAccessed', 'predictionOutputsAccessed']) eq(provenance.extraction[key], false, `${key} cannot change`);
  eq(review.schema, 'confovhh-mglyr-source-resolution-v1');
  eq(review.scope.pdbIds, ['9VOR', '9VOS']);
  eq(review.scope.sourceDoi, DOI);
  eq(review.evidence.map(f => [f.id, f.classification, f.paragraphIds]), [
    ['immune-origin', 'SOURCE_REPORTED_FACT', ['Sec13.p0']],
    ['library-vector', 'SOURCE_REPORTED_FACT', ['Sec13.p9']],
    ['panning-route', 'SOURCE_REPORTED_FACT', ['Sec14.p0']],
    ['nb20-production-link', 'SOURCE_REPORTED_FACT', ['Sec11.p0']],
    ['assay-tags', 'SOURCE_REPORTED_FACT', ['Sec15.p0']],
  ], 'Source claim to paragraph mapping drift');
  eq(review.resolution, {
    reportedDiscoveryRouteEstablished: true,
    exactCryoEmReceptorConstructEstablished: false,
    exactCryoEmNb20TagEstablished: false,
    completeBinderAncestryAdjudicated: false,
    formalEligibilityAuthority: false,
    formalNoEdgeAuthority: false,
    independenceCertified: false,
    targetFreezePermitted: false,
    newFormalEligibleEntries: 0,
    newIndependentEligibleGroups: 0,
    priorDispositionsChanged: 0,
  }, 'Source review cannot acquire construct, ancestry, eligibility or count authority');
  eq(review.prohibitedDataAccessed, false);
  eq(attempts.requests.length, 9);
  eq(new Set(attempts.requests.map(r => r.name)).size, 9);
  for (const request of attempts.requests) eq(request.responseBodyArchived, false);
  const supplement = attempts.supplement2026;
  const request = attempts.requests.find(r => r.name === supplement.apiRequestName);
  eq(request.status, 200);
  eq(request.isZip, true);
  eq(supplement.archiveSha256, request.sha256);
  eq(supplement.memberBytes, 4489295);
  eq(supplement.memberSha256, '772c08de7434d07651862bdd3f7805b46bb62d610f444b64b2794de85f397334');
  eq(supplement.selectorMatchedHeadingCount, 0);
  eq(supplement.selectedMethodsParagraphCount, 0);
  for (const key of ['fullArchiveArchived', 'pdfArchived', 'fullTextArchived', 'figuresRendered', 'captionsReviewed', 'structuralTablesReviewed']) eq(supplement[key], false);
  for (const [key, value] of Object.entries({ blocks, provenance, attempts, review })) {
    eq(sha(canonicalJson(value)), REVIEWED_CANONICAL_SHA[key], `${key}: reviewed payload identity changed`);
  }
  return {
    status: 'SOURCE_INTEGRITY_VERIFIED',
    selectedMethodsParagraphs: blocks.paragraphs.length,
    sourceReportedDiscoveryRouteEstablished: true,
    exactCryoEmConstructsReconciled: 0,
    independentEligibleGroupsAdded: 0,
    targetFreezePermitted: false,
    scientificIndependenceCertified: false,
  };
}

async function boundedFile(root, relativePath) {
  assert.ok(typeof relativePath === 'string' && !path.isAbsolute(relativePath) && !relativePath.split('/').some(part => !part || part === '.' || part === '..'), 'Noncanonical evidence path');
  const filename = path.join(root, relativePath);
  const stat = await lstat(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 100000, 'Evidence must be a bounded regular file');
  eq(await realpath(filename), filename, 'Symlink evidence paths are forbidden');
  return readFile(filename);
}

export async function verifyMglyrSourceResolution(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  const names = ['source-blocks.json', 'source-provenance.json', 'retrieval-attempts.json', 'source-review.json'];
  const checksumText = (await boundedFile(root, `${BUNDLE_PATH}/checksums.sha256`)).toString('utf8');
  const pairs = checksumText.trimEnd().split('\n').map(line => {
    const match = /^([a-f0-9]{64})  ([a-z-]+\.json)$/u.exec(line);
    assert.ok(match, 'Invalid checksum entry');
    return [match[2], match[1]];
  });
  eq(pairs.map(([name]) => name).sort(), [...names].sort(), 'Unexpected checksum file inventory');
  const objects = {};
  for (const [name, expected] of pairs) {
    const bytes = await boundedFile(root, `${BUNDLE_PATH}/${name}`);
    eq(sha(bytes), expected, `${name}: checksum mismatch`);
    objects[name] = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  const bundle = { blocks: objects[names[0]], provenance: objects[names[1]], attempts: objects[names[2]], review: objects[names[3]] };
  const priorBase = 'validation/hard-decoy-holdout-v3/mglyr-construct-followup-2026-09-04/';
  eq(Object.keys(bundle.review.priorInputSha256).sort(), ['bibliography-provenance.json', 'construct-followup.json', 'retrieval-attempts.json'].map(name => priorBase + name));
  for (const [filename, expected] of Object.entries(bundle.review.priorInputSha256)) eq(sha(await boundedFile(root, filename)), expected, `${filename}: immutable prior evidence changed`);
  return validateMglyrSourceBundle(bundle);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/hard-decoy-v3/verify-mglyr-source-resolution.mjs');
  console.log(JSON.stringify(await verifyMglyrSourceResolution(), null, 2));
}
