import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const PACKAGE = "validation/hard-decoy-holdout-v3/review-disposition-integration-2026-09-07";
const INPUTS = [
  ["validation/hard-decoy-holdout-v3/prelabel-census-draft/disposition-contract.json", "805136877bd727ca22aae0c13284cfd4fd8aca5e8b2f868fe619d320e0c1f039"],
  ["validation/hard-decoy-holdout-v3/disposition-seed-2026-08-29/entry-dispositions.jsonl", "1687775f2495447475dbffccdc27b8ded042d7c235669635672b6d3afe61e894"],
  ["validation/hard-decoy-holdout-v3/census-audit-2026-08-29/dispositions.jsonl", "9743428646cf523c453940fede9d3e69388a42bfdadb5bf1e84e81bad8b1e24a"],
  ["validation/hard-decoy-holdout-v3/no-direct-signal-role-audit-2026-09-04/source-backed-exclusions.jsonl", "6454d97cd8faa49108979b3ae1b64c8460f40e17d51cf41093c0aca59dc15848"],
  ["validation/hard-decoy-holdout-v3/direct-signal-salvage-bound-2026-09-04/source-backed-exclusions.jsonl", "612330ba1c81ac8baf2e8aeeeef0de4c691030372e359fbde70718df73fbedd9"],
  ["validation/hard-decoy-holdout-v3/auxiliary-remainder-source-review-2026-09-04/source-reviews.json", "17e89335abe2b1539b515b3171c15efd4f532801db2e4c1a36f4515e7e6c4a5a"],
  ["validation/hard-decoy-holdout-v3/gpcrdb-complement-priority-review-2026-09-04/source-reviews.json", "b2cc22d3261dfbeb861af09ed1f5e65fe3ba168063ba4deee61e6eca49610f9d"],
  ["validation/hard-decoy-holdout-v3/prostanoid-role-adjudication-2026-09-06/source-reviews.json", "96f082310dc08afc727e0770f901f81e85c4e70dfa6dc417593e101f371c7853"],
  ["validation/hard-decoy-holdout-v3/gpr1-nb32-entity-adjudication-2026-09-07/entity-adjudications.json", "895c45b71de637aae8cd52b649dfc332c153256a43c3cf49d302e65feb813f8d"],
  ["validation/hard-decoy-holdout-v3/gcgr-nb32-role-adjudication-2026-09-07/source-reviews.json", "cf19c49067e15df4606f72ab11a279b3e6ee53faca64dc032ffbf6ff462e70be"],
];
const PENDING = "PENDING_REQUIRED_METADATA";
const NORMALIZATION_RULES = new Map([
  ...["6KNM", "6O3C", "8W1V", "9NNZ", "9NOZ", "9NYX", "9MQI", "9MQK", "9PXU", "9Q0F", "9W3F"].map(pdbId => [pdbId, "EXCLUDE_RECEPTOR_CLUSTER_LEAKAGE"]),
  ...["8YKD", "9ULM"].map(pdbId => [pdbId, "EXCLUDE_NO_DIRECT_RECEPTOR_VHH_INTERFACE"]),
  ...["9LFA", "9LFC", "9LFD"].map(pdbId => [pdbId, "EXCLUDE_ENGINEERED_EPITOPE_GRAFT"]),
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const COORDINATES = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const OBSERVED_LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const stable = value => `${JSON.stringify(value, null, 2)}\n`;
const jsonl = rows => `${rows.map(row => JSON.stringify(row)).join("\n")}\n`;
const compare = (left, right) => Buffer.from(String(left)).compare(Buffer.from(String(right)));

function parseJsonl(text, label) {
  assert.ok(text.endsWith("\n"), `${label} must end with LF`);
  return text.trimEnd().split("\n").filter(Boolean).map(line => JSON.parse(line));
}

async function readBound(root, [relative, expectedSha]) {
  assert.ok(SHA256.test(expectedSha) && !path.isAbsolute(relative), `Invalid input binding: ${relative}`);
  const filename = path.resolve(root, relative);
  assert.ok(path.relative(root, filename) && !path.relative(root, filename).startsWith(".."), `Unsafe input path: ${relative}`);
  const info = await lstat(filename, { bigint: true });
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, `${relative} must be one direct regular file`);
  assert.equal(await realpath(filename), filename, `${relative} path cannot contain symlinks`);
  assert.ok(info.size <= 64n * 1024n * 1024n, `${relative} exceeds its byte cap`);
  const bytes = await readFile(filename);
  assert.equal(sha(bytes), expectedSha, `${relative} changed`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.ok(!COORDINATES.test(text) && !OBSERVED_LABEL.test(text), `${relative} crosses the pre-label evidence boundary`);
  return { relative, expectedSha, text };
}

function sourceRef(sourcePath, sourceDisposition, detail = null, normalizedDisposition = sourceDisposition) {
  return { sourcePath, sourceDisposition, normalizedDisposition, detail };
}

function addRecord(records, pdbId, dispositionCode, source) {
  assert.match(pdbId, /^[0-9][A-Z0-9]{3}$/u);
  assert.equal(typeof dispositionCode, "string");
  const current = records.get(pdbId) ?? { pdbId, codes: new Set(), sources: [] };
  current.codes.add(dispositionCode);
  current.sources.push(source);
  records.set(pdbId, current);
}

function addBacklog(backlog, pdbId, sourceDisposition, sourcePath, detail) {
  assert.match(pdbId, /^[0-9][A-Z0-9]{3}$/u);
  backlog.push({ pdbId, sourceDisposition, sourcePath, detail, normalizedContractDisposition: null });
}

async function derive(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  assert.equal(root, path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors");
  const loaded = new Map();
  for (const input of INPUTS) {
    const result = await readBound(root, input);
    loaded.set(result.relative, result.text);
  }
  const get = relative => {
    assert.ok(loaded.has(relative), `Unbound input: ${relative}`);
    return loaded.get(relative);
  };
  const contractPath = INPUTS[0][0];
  const seedPath = INPUTS[1][0];
  const auditPath = INPUTS[2][0];
  const noDirectPath = INPUTS[3][0];
  const directPath = INPUTS[4][0];
  const auxiliaryPath = INPUTS[5][0];
  const complementPath = INPUTS[6][0];
  const prostanoidPath = INPUTS[7][0];
  const gpr1Path = INPUTS[8][0];
  const gcgrPath = INPUTS[9][0];

  const contract = JSON.parse(get(contractPath));
  const contractCodes = new Set(Object.keys(contract.dispositionCodes));
  assert.equal(contract.ledgerFilename, "entry-dispositions.jsonl");
  const seed = parseJsonl(get(seedPath), seedPath);
  assert.equal(seed.length, 287);
  const historicalIds = new Set(seed.map(row => row.pdbId));
  const seedPending = new Set(seed.filter(row => row.dispositionCode === PENDING).map(row => row.pdbId));
  assert.equal(seedPending.size, 272);

  const records = new Map();
  const backlog = [];
  const ingest = (pdbId, code, sourcePath, detail = null) => {
    const normalized = NORMALIZATION_RULES.get(pdbId);
    if (contractCodes.has(code) && code !== PENDING) addRecord(records, pdbId, code, sourceRef(sourcePath, code, detail));
    else if (code !== PENDING && normalized) {
      assert.ok(contractCodes.has(normalized), `${pdbId}: normalization target is not in the frozen contract`);
      addRecord(records, pdbId, normalized, sourceRef(sourcePath, code, detail, normalized));
    } else if (code !== PENDING) addBacklog(backlog, pdbId, code, sourcePath, detail);
  };

  for (const row of seed) ingest(row.pdbId, row.dispositionCode, seedPath, "frozen disposition seed");
  for (const row of parseJsonl(get(auditPath), auditPath)) {
    for (const pdbId of row.pdbIds) ingest(pdbId, row.dispositionCode, auditPath, row.dispositionReason);
  }
  for (const row of parseJsonl(get(noDirectPath), noDirectPath)) ingest(row.pdbId, row.dispositionCode, noDirectPath, row.dispositionReason);
  for (const row of parseJsonl(get(directPath), directPath)) ingest(row.pdbId, row.dispositionCode, directPath, row.dispositionReason);

  const auxiliary = JSON.parse(get(auxiliaryPath));
  assert.deepEqual(auxiliary.summary, { ...auxiliary.summary, reviewedEntryCount: 16 });
  for (const row of auxiliary.reviews) ingest(row.pdbId, row.entryDisposition, auxiliaryPath, row.entryAssessment);

  const complement = JSON.parse(get(complementPath));
  assert.equal(complement.summary.reviewedEntryCount, 11);
  for (const row of complement.reviews) ingest(row.pdbId, row.entryDisposition, complementPath, row.entryAssessment);

  const prostanoid = JSON.parse(get(prostanoidPath));
  assert.equal(prostanoid.summary.boundedEntryExclusionCount, 12);
  for (const row of prostanoid.reviews) ingest(row.pdbId, row.entryDisposition, prostanoidPath, row.dispositionReason);

  const gcgr = JSON.parse(get(gcgrPath));
  assert.equal(gcgr.authority.boundedEntryDispositionAuthority, true);
  for (const row of gcgr.reviews) ingest(row.pdbId, row.entryDisposition, gcgrPath, row.dispositionReason);

  const conflicts = [...records.values()].filter(row => row.codes.size > 1);
  assert.deepEqual(conflicts, [], "Conflicting contract dispositions require manual adjudication");
  const dispositionRows = [...records.values()].map(row => ({
    pdbId: row.pdbId,
    dispositionCode: [...row.codes][0],
    inFrozenHistorical287: historicalIds.has(row.pdbId),
    historicalSeedWasPending: seedPending.has(row.pdbId),
    corroborationCount: row.sources.length,
    dispositionSources: row.sources.sort((left, right) => compare(left.sourcePath, right.sourcePath)),
    contractDispositionCodeValidated: true,
    masterDispositionLedgerRewritten: false,
    formalEligibilityAuthority: false,
    formalLeakageGraphAuthority: false,
    formalNoEdgeAuthority: false,
    wholeCensusDecisionAuthority: false,
    targetFreezePermitted: false,
  })).sort((left, right) => compare(left.pdbId, right.pdbId));
  const corroborations = dispositionRows.filter(row => row.corroborationCount > 1).map(row => ({
    pdbId: row.pdbId,
    dispositionCode: row.dispositionCode,
    corroboratingSourceCount: row.corroborationCount,
    sourcePaths: row.dispositionSources.map(source => source.sourcePath),
    conflict: false,
  }));
  const normalizations = dispositionRows.flatMap(row => row.dispositionSources
    .filter(source => source.sourceDisposition !== source.normalizedDisposition)
    .map(source => ({
      pdbId: row.pdbId,
      sourceDisposition: source.sourceDisposition,
      normalizedContractDisposition: row.dispositionCode,
      sourcePath: source.sourcePath,
      normalizationBasis: "The source record's stated exclusion fact maps unambiguously to one frozen contract code; this semantic mapping does not complete the formal leakage graph.",
    }))).sort((left, right) => compare(left.pdbId, right.pdbId));

  const gpr1 = JSON.parse(get(gpr1Path));
  assert.equal(gpr1.summary.wholeEntryDispositionCount, 0);
  const entityOnly = gpr1.reviews.map(row => ({
    pdbId: row.pdbId,
    entityId: row.candidateEntity.rcsbId,
    entityDisposition: row.candidateEntityDisposition,
    wholeEntryDisposition: row.wholeEntryDisposition,
    entryExclusionAuthority: row.entryExclusionAuthority,
    sourcePath: gpr1Path,
    excludedFromWholeEntryLedger: true,
  })).sort((left, right) => compare(left.pdbId, right.pdbId));

  backlog.sort((left, right) => compare(left.pdbId, right.pdbId));
  assert.equal(new Set(backlog.map(row => row.pdbId)).size, backlog.length, "Normalization backlog contains duplicate entries");
  const historicalPendingOverlay = dispositionRows.filter(row => row.historicalSeedWasPending).length;
  const counts = Object.fromEntries([...contractCodes].filter(code => code !== PENDING).sort(compare).map(code => [code, dispositionRows.filter(row => row.dispositionCode === code).length]));
  const summary = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    reviewDate: "2026-09-07",
    status: "CONFLICT_FREE_REVIEW_DISPOSITION_OVERLAY_BUILT_FREEZE_BLOCKED",
    historicalSourceEntryCount: historicalIds.size,
    historicalSeedResolvedCount: seed.length - seedPending.size,
    contractDispositionEntryCount: dispositionRows.length,
    contractDispositionCounts: counts,
    historicalContractDispositionCount: dispositionRows.filter(row => row.inFrozenHistorical287).length,
    expandedDiscoveryContractDispositionCount: dispositionRows.filter(row => !row.inFrozenHistorical287).length,
    historicalPendingRowsWithContractDispositionOverlay: historicalPendingOverlay,
    historicalRowsRemainingPendingIfOverlayApplied: seedPending.size - historicalPendingOverlay,
    corroboratedEntryCount: corroborations.length,
    conflictingEntryCount: conflicts.length,
    nonContractNormalizationBacklogEntryCount: backlog.length,
    normalizedLegacyDispositionEntryCount: normalizations.length,
    entityOnlyAdjudicationCount: entityOnly.length,
    wholeEntryDispositionFromEntityOnlyCount: 0,
    masterDispositionLedgerRewritten: false,
    dispositionLedgerComplete: false,
    formalLeakageGraphComplete: false,
    formallyClearedIndependentComponentCount: 0,
    wholeCensusUpperBound: null,
    targetFreezePermitted: false,
  };
  assert.equal(summary.contractDispositionEntryCount, 66);
  assert.deepEqual(summary.contractDispositionCounts, {
    EXCLUDE_ANNOTATION_EPITOPE_LEAKAGE: 0,
    EXCLUDE_AMBIGUOUS_EVIDENCE: 0,
    EXCLUDE_AUXILIARY_BINDER: 27,
    EXCLUDE_ENGINEERED_EPITOPE_GRAFT: 3,
    EXCLUDE_FUSION_DOMINATED_INTERFACE: 4,
    EXCLUDE_NO_DIRECT_RECEPTOR_VHH_INTERFACE: 6,
    EXCLUDE_PUBLICATION_LEAKAGE: 0,
    EXCLUDE_RECEPTOR_CLUSTER_LEAKAGE: 26,
    EXCLUDE_VHH_CLUSTER_OR_PARENT_LEAKAGE: 0,
    PROVISIONAL_DIRECT_TARGET: 0,
    SAME_COMPONENT_NOT_ADDITIONAL: 0,
  });
  assert.equal(summary.corroboratedEntryCount, 2);
  assert.equal(summary.nonContractNormalizationBacklogEntryCount, 6);
  assert.equal(summary.normalizedLegacyDispositionEntryCount, 16);
  assert.equal(summary.entityOnlyAdjudicationCount, 6);

  return { dispositionRows, corroborations, normalizations, backlog, entityOnly, summary };
}

function readme(summary) {
  return `# Review-disposition integration overlay\n\nStatus: **${summary.contractDispositionEntryCount} conflict-free, contract-coded whole-entry dispositions integrated; target freeze remains blocked.**\n\nThis packet integrates the frozen disposition seed and later bounded source-review packages into one review overlay. It validates every accepted code against the frozen disposition contract, preserves every contributing source path, distinguishes the historical 287-entry universe from expanded discovery, and detects duplicate or conflicting dispositions. It does not rewrite the externally pinned master ledger or integration state.\n\nThe overlay contains ${summary.contractDispositionCounts.EXCLUDE_RECEPTOR_CLUSTER_LEAKAGE} receptor-cluster exclusions, ${summary.contractDispositionCounts.EXCLUDE_AUXILIARY_BINDER} auxiliary-binder exclusions, ${summary.contractDispositionCounts.EXCLUDE_ENGINEERED_EPITOPE_GRAFT} engineered-epitope exclusions, ${summary.contractDispositionCounts.EXCLUDE_FUSION_DOMINATED_INTERFACE} fusion-dominated exclusions and ${summary.contractDispositionCounts.EXCLUDE_NO_DIRECT_RECEPTOR_VHH_INTERFACE} no-direct-interface exclusions. Sixteen legacy source codes map unambiguously to these frozen contract categories. Two GCGR rows have consistent corroboration from both the earlier bounded audit and the later complete-inventory review; no conflict is present.\n\nWithin the historical 287-row seed, ${summary.historicalPendingRowsWithContractDispositionOverlay} previously pending rows now have contract-coded source-review overlays. If applied, that would reduce the historical pending count from 272 to ${summary.historicalRowsRemainingPendingIfOverlayApplied}. This is progress accounting, not a completeness claim: ${summary.expandedDiscoveryContractDispositionCount} integrated rows belong to expanded discovery, ${summary.nonContractNormalizationBacklogEntryCount} additional source-reviewed rows retain ambiguous component-collapse codes requiring manual contract adjudication, and six GPR1 Nb32 entity dispositions remain excluded from the whole-entry ledger because their entries are still pending.\n\nNo eligibility or graph authority is created. Formally cleared independent components remain zero, the whole-census upper bound remains unknown, and target freeze remains blocked. No coordinates, relative poses, structural contact tables, labels, prediction outputs or performance results were accessed.\n\nVerify offline with:\n\n\`\`\`bash\nnode scripts/hard-decoy-v3/integrate-review-dispositions.mjs verify\nnode --test tests/hard-decoy-v3-review-disposition-integration.test.mjs\n\`\`\`\n`;
}

async function expectedFiles(repositoryRoot = ROOT) {
  const result = await derive(repositoryRoot);
  const files = new Map([
    ["contract-dispositions.jsonl", jsonl(result.dispositionRows)],
    ["corroborations.jsonl", jsonl(result.corroborations)],
    ["entity-only-adjudications.jsonl", jsonl(result.entityOnly)],
    ["legacy-code-normalizations.jsonl", jsonl(result.normalizations)],
    ["normalization-backlog.jsonl", jsonl(result.backlog)],
    ["summary.json", stable(result.summary)],
    ["README.md", readme(result.summary)],
    ["manifest.json", stable({
      schemaVersion: "1.0.0",
      package: PACKAGE,
      inputs: Object.fromEntries(INPUTS),
      deterministicOfflineReplay: true,
      networkAccessRequiredForVerification: false,
      masterDispositionLedgerRewritten: false,
      outputFiles: ["README.md", "contract-dispositions.jsonl", "corroborations.jsonl", "entity-only-adjudications.jsonl", "legacy-code-normalizations.jsonl", "manifest.json", "normalization-backlog.jsonl", "summary.json"],
    })],
  ]);
  const ordered = [...files].sort(([left], [right]) => compare(left, right));
  files.set("checksums.sha256", ordered.map(([name, bytes]) => `${sha(bytes)}  ${name}\n`).join(""));
  return files;
}

export async function buildReviewDispositionIntegration(repositoryRoot = ROOT) {
  const files = await expectedFiles(repositoryRoot);
  const output = path.join(repositoryRoot, PACKAGE);
  await mkdir(output, { recursive: true });
  for (const [name, bytes] of files) await writeFile(path.join(output, name), bytes, { flag: "wx" });
  return { built: true, output, fileCount: files.size };
}

export async function verifyReviewDispositionIntegration(repositoryRoot = ROOT, overrides = new Map()) {
  const files = await expectedFiles(repositoryRoot);
  const output = path.join(repositoryRoot, PACKAGE);
  assert.deepEqual((await readdir(output)).sort(), [...files.keys()].sort(), "Package file inventory changed");
  for (const [name, expected] of files) {
    const filename = path.join(output, name);
    const info = await lstat(filename);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, `${name} must be one direct regular file`);
    const actual = overrides.has(name) ? overrides.get(name) : await readFile(filename, "utf8");
    assert.equal(actual, expected, `${name} differs from deterministic evidence integration`);
  }
  const result = await derive(repositoryRoot);
  return {
    verified: true,
    contractDispositionEntryCount: result.summary.contractDispositionEntryCount,
    historicalPendingRowsWithContractDispositionOverlay: result.summary.historicalPendingRowsWithContractDispositionOverlay,
    historicalRowsRemainingPendingIfOverlayApplied: result.summary.historicalRowsRemainingPendingIfOverlayApplied,
    normalizationBacklogEntryCount: result.summary.nonContractNormalizationBacklogEntryCount,
    entityOnlyAdjudicationCount: result.summary.entityOnlyAdjudicationCount,
    conflictingEntryCount: result.summary.conflictingEntryCount,
    formallyClearedIndependentComponentCount: 0,
    targetFreezePermitted: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const command = process.argv[2] ?? "verify";
  const result = command === "build" ? await buildReviewDispositionIntegration() : await verifyReviewDispositionIntegration();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
