// Documentary lineage only: no structures, predictions, scoring or eligibility.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE = 'validation/hard-decoy-holdout-v3/mglyr-source-resolution-2026-09-08/source-blocks.json';
const PARAGRAPH_SHA = 'd8836cc14669c1a90798541934762cf2825e9e195190bae151c8febb20a47051';
const XML_SHA = '5841cd77f7242c75562f2eb1237edb2ee43720f2cbf71bb70bf1b202f6890776';
const PARENT_SHA = 'dc98dd242f5929991a7780a20d2aa613270104a7b9c4e4d1431d721ab9b5b38b';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function deriveKnownNb20Lineage(sourceBytes) {
  assert.ok(sourceBytes instanceof Uint8Array && sourceBytes.length > 0 && sourceBytes.length <= 65536, 'Expected bounded source bytes');
  const bytes = Buffer.from(sourceBytes);
  const source = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), {
    maximumCharacters: 65536, maximumTokens: 20000, maximumDepth: 16,
  });
  assert.equal(source.sourceDoi, '10.1038/s41467-026-68339-x');
  assert.equal(source.sourcePmcid, 'PMC12834959');
  assert.equal(source.sourceUrl, 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12834959/fullTextXML');
  assert.equal(source.sourceResponseSha256, XML_SHA, 'Unrecognized primary source');
  assert.ok(Array.isArray(source.paragraphs), 'Missing source paragraphs');
  const selected = source.paragraphs.filter(row => row.id === 'Sec11.p0');
  assert.equal(selected.length, 1, 'Expected exactly one construct paragraph');
  const paragraph = selected[0];
  assert.equal(paragraph.sectionId, 'Sec11');
  assert.equal(paragraph.paragraphIndex, 0);
  assert.equal(paragraph.textSha256, PARAGRAPH_SHA);
  assert.equal(sha(paragraph.text), PARAGRAPH_SHA, 'Construct paragraph changed');
  assert.ok(paragraph.text.includes('To generate control non-binding nanobody (Nb20*), Nb20 cDNA was mutated to replace '), 'Named parent/derivative statement missing');
  const sequenceMatches = [...paragraph.text.matchAll(/The complete sequence of Nb20 is as follows: ([A-Z]+)\./gu)];
  assert.equal(sequenceMatches.length, 1, 'Expected exactly one source-reported parent sequence');
  const parent = sequenceMatches[0][1];
  assert.equal(parent.length, 131);
  assert.equal(sha(parent), PARENT_SHA, 'Reported Nb20 sequence changed');
  const substitutions = [
    { sourceRegionLabel: 'CDR1', firstPosition: 30, lastPosition: 35, from: 'IGNIYI', to: 'GGAGAG' },
    { sourceRegionLabel: 'CDR2', firstPosition: 54, lastPosition: 62, from: 'RTVRWTKYE', to: 'GAVGGAAAG' },
  ];
  const inferred = [...parent];
  for (const row of substitutions) {
    assert.ok(paragraph.text.includes(`${row.firstPosition}${row.from}${row.lastPosition} sequence in ${row.sourceRegionLabel} with ${row.firstPosition}${row.to}${row.lastPosition} sequence`), 'Reported substitution missing');
    assert.equal(parent.slice(row.firstPosition - 1, row.lastPosition), row.from, 'Reported positions disagree with parent sequence');
    assert.equal(row.from.length, row.to.length);
    inferred.splice(row.firstPosition - 1, row.from.length, ...row.to);
  }
  const derivative = inferred.join('');
  const changedPositions = [...parent].flatMap((residue, index) => residue === derivative[index] ? [] : [index + 1]);
  return {
    schemaVersion: '1.0.0',
    status: 'SOURCE_REPORTED_NAMED_DERIVATIVE_RECORDED',
    source: { path: SOURCE, bytes: bytes.length, sha256: sha(bytes), doi: source.sourceDoi,
      pmcid: source.sourcePmcid, paragraphId: paragraph.id, paragraphTextSha256: PARAGRAPH_SHA,
      upstreamXmlSha256: XML_SHA },
    relationship: { parentName: 'Nb20', derivativeName: 'Nb20*',
      type: 'SOURCE_REPORTED_DIRECT_SITE_DIRECTED_DERIVATIVE',
      sourceReportedParentSequenceLength: parent.length, sourceReportedParentSequenceSha256: PARENT_SHA,
      coordinateSystem: 'One-based positions in the 131-residue source-reported sequence; not an independently assigned IMGT numbering.',
      substitutions, inferredDerivativeSequenceLength: derivative.length,
      inferredDerivativeSequenceSha256: sha(derivative), inferredChangedPositions: changedPositions,
      inferredDerivativeStatus: 'INFERRED_FROM_REPORTED_REPLACEMENTS_NOT_OBSERVED_REAGENT_BYTES' },
    interpretation: {
      knownParentRelationshipDocumented: true,
      sourceNamesHaveBeenLinkedToEveryDepositedEntity: false,
      allParentOrVariantRelationshipsResolved: false,
      inferredDerivativeIsAnObservedExpressedConstruct: false,
      sourceNonbindingLabelIsIndependentPerformanceEvidence: false,
      sourceRegionLabelsAreNewImgtAssignments: false,
    },
    authority: {
      exactCryoEmConstructResolved: false, completeAncestryCertified: false,
      formalLeakageGraphChanged: false, formalNoEdgeAuthority: false,
      formalEligibilityGranted: false, exposureClearanceGranted: false,
      independentEligibleGroupsAdded: 0, predictiveAccuracyMeasured: false,
      targetFreezePermitted: false, nativeCoordinatesAccessed: false,
      predictionOutputsAccessed: false, labelsAccessed: false, networkUsed: false,
    },
  };
}

export async function reviewKnownNb20Lineage() {
  const filename = path.join(ROOT, SOURCE);
  assert.equal(await realpath(filename), filename, 'Symlinked source forbidden');
  const info = await lstat(filename);
  assert.ok(info.isFile() && info.nlink === 1 && info.size <= 65536, 'Expected bounded regular source file');
  const bytes = await readFile(filename);
  assert.equal(bytes.length, info.size, 'Source changed during read');
  return deriveKnownNb20Lineage(bytes);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/hard-decoy-v3/review-mglyr-known-lineage.mjs --output=NEW.json');
  const match = /^--output=(.+)$/u.exec(process.argv[2]);
  assert.ok(match, 'Expected --output=NEW.json');
  const receipt = await reviewKnownNb20Lineage();
  await writeFile(path.resolve(match[1]), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ status: receipt.status, independentEligibleGroupsAdded: 0 }));
}
