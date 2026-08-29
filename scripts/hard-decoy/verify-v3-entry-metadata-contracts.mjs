import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const REL = "validation/hard-decoy-holdout-v3/entry-metadata-draft";
const FILES = ["README.md", "checksums.sha256", "entry-metadata-contract.json", "rcsb-entry-metadata.graphql"].sort();
const SHA = /^[a-f0-9]{64}$/u;
const COORD = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)\b|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;

function ok(value, message) {
  if (!value) throw new Error(message);
}
function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function byteSort(values) {
  return [...values].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}
function same(left, right, message) {
  ok(JSON.stringify(left) === JSON.stringify(right), message);
}
function clean(name, text) {
  ok(!text.includes("\0"), `NUL byte appeared in ${name}.`);
  ok(!COORD.test(text), `Coordinate payload appeared in ${name}.`);
  ok(!LABEL.test(text), `Observed holdout-label assignment appeared in ${name}.`);
}
async function regularFile(file, label, maximum = 20 * 1024 * 1024) {
  const info = await lstat(file, { bigint: true });
  ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, `${label} must be one direct regular file.`);
  const bytes = await readFile(file);
  ok(bytes.byteLength <= maximum, `${label} exceeds the byte cap.`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  clean(label, text);
  return { bytes, text };
}

async function loadPackage(root) {
  const directory = path.join(root, REL);
  const info = await lstat(directory);
  ok(info.isDirectory() && !info.isSymbolicLink(), "Entry-metadata contract path must be a direct directory.");
  ok(await realpath(directory) === path.resolve(directory), "Entry-metadata contract path cannot contain symlinked ancestors.");
  const entries = await readdir(directory, { withFileTypes: true });
  same(entries.map((entry) => entry.name).sort(), FILES, "Entry-metadata contract directory does not match the exact file allowlist.");
  ok(entries.every((entry) => entry.isFile() && !entry.isSymbolicLink()), "Every entry-metadata contract item must be a direct regular file.");

  const manifest = (await regularFile(path.join(directory, "checksums.sha256"), "checksums.sha256")).text;
  ok(manifest.endsWith("\n"), "Entry-metadata checksums must end with LF.");
  const expected = FILES.filter((file) => file !== "checksums.sha256");
  const rows = manifest.trimEnd().split("\n");
  ok(rows.length === expected.length, "Entry-metadata checksums must cover every contract file except itself.");
  const texts = new Map([["checksums.sha256", manifest]]);
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u.exec(row);
    ok(match, `entry-metadata checksums:${index + 1} has invalid syntax.`);
    const [, expectedSha, file] = match;
    ok(expected.includes(file) && !seen.has(file), `Unexpected or duplicate entry-metadata checksum path: ${file}`);
    seen.add(file);
    const payload = await regularFile(path.join(directory, file), file, 2 * 1024 * 1024);
    ok(digest(payload.bytes) === expectedSha, `Entry-metadata checksum mismatch: ${file}`);
    texts.set(file, payload.text);
  }
  same([...seen].sort(), [...expected].sort(), "Entry-metadata checksum coverage is incomplete.");
  return {
    contract: JSON.parse(texts.get("entry-metadata-contract.json")),
    query: texts.get("rcsb-entry-metadata.graphql"),
  };
}

function verifyContractShape(contract, query) {
  ok(contract.schemaVersion === "1.0.0", "Entry-metadata contract schema drifted.");
  ok(contract.studyId === "confovhh-hard-decoy-holdout-v3" && contract.stage === "V3_CENSUS_IN_PROGRESS", "Entry-metadata study identity or stage drifted.");
  const input = contract.input;
  ok(input.sourceSnapshotDirectory === "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29", "Source snapshot binding drifted.");
  ok(input.sourceAttestation === "validation/hard-decoy-holdout-v3/SOURCE_SNAPSHOT_ATTESTATION_2026-08-29.json", "Source attestation binding drifted.");
  ok(input.sourceIdentifierListFile === "normalized/rcsb-gpcrdb-intersection.txt", "Source identifier-list binding drifted.");
  ok(input.sourceUniverseFile === "source-universe.jsonl" && input.gpcrdbRawFile === "raw/gpcrdb-api-1.json", "Source universe or GPCRdb binding drifted.");
  ok(input.sourceIdentifierCount === 287, "The exact source-universe count drifted.");
  for (const field of ["sourceIdentifierListSha256", "sourceUniverseJsonlSha256", "sourceManifestSha256", "sourceChecksumsSha256"]) {
    ok(SHA.test(input[field]), `Invalid source-binding digest: ${field}`);
  }

  const rcsb = contract.rcsb;
  ok(rcsb.endpoint === "https://data.rcsb.org/graphql" && rcsb.method === "POST", "RCSB entry-metadata endpoint or method drifted.");
  ok(rcsb.queryFile === `${REL}/rcsb-entry-metadata.graphql`, "RCSB GraphQL query path drifted.");
  ok(rcsb.querySha256 === digest(Buffer.from(query)), "RCSB GraphQL query digest drifted.");
  ok(rcsb.batchSize === 25 && rcsb.expectedBatchCount === Math.ceil(input.sourceIdentifierCount / rcsb.batchSize), "Entry-metadata batch schedule drifted.");
  ok(rcsb.repeatCount === 2 && rcsb.expectedBatchCount * rcsb.repeatCount === contract.snapshot.rawResponseCount, "Entry-metadata repeat or raw-response count drifted.");
  ok(rcsb.timeoutMilliseconds === 90000 && rcsb.maximumResponseBytes === 16 * 1024 * 1024 && rcsb.minimumDelayMilliseconds >= 100, "Entry-metadata resource contract drifted.");
  ok(rcsb.endpoint.startsWith("https://"), "Entry-metadata endpoint must use HTTPS.");
  ok(contract.blindBoundary.forbiddenUrlFragments.every((fragment) => !rcsb.endpoint.toLowerCase().includes(fragment.toLowerCase())), "Entry-metadata endpoint entered a forbidden URL class.");
  ok(!/(?:atom_site|cartn_[xyz]|coordinates?|dockq|capri|fnat|irmsd|lrmsd)/iu.test(query), "The GraphQL query requests a forbidden coordinate or label field.");
  for (const required of ["entries(entry_ids: $ids)", "pdbx_seq_one_letter_code_can", "auth_asym_ids", "reference_sequence_identifiers", "pdbx_database_id_DOI", "pdbx_database_id_PubMed"]) {
    ok(query.includes(required), `The GraphQL query is missing required metadata: ${required}`);
  }

  same(contract.normalization, {
    pdbIdentifierPattern: "^[0-9][A-Z0-9]{3}$",
    sequenceWhitespaceRemoval: true,
    sequenceUppercase: true,
    entryOrder: "PDB-ID-bytewise-ascending",
    entityOrder: "numeric-entity-id-then-rcsb-id",
    setOrder: "canonical-JSON-bytewise-ascending",
    jsonl: "canonical-JSON-one-object-per-line-with-terminal-LF",
    digest: "SHA-256",
  }, "Entry-metadata normalization contract drifted.");

  const triage = contract.triage;
  ok(triage.status === "NON_DISPOSITIVE_METADATA_SIGNALS_ONLY", "Metadata triage became dispositive.");
  ok(triage.allDirectInterfaceEvidenceStatus === "UNRESOLVED" && triage.allDispositionStatus === "PENDING_DISPOSITION", "Metadata triage improperly resolves scientific evidence or disposition.");
  ok(triage.vhhLengthMinimum === 80 && triage.vhhLengthMaximum === 250, "VHH signal length bounds drifted.");
  for (const field of ["vhhDescriptionPattern", "camelidOrganismPattern", "auxiliaryPattern", "constructRiskPattern"]) {
    ok(typeof triage[field] === "string" && triage[field].length > 0, `Missing triage pattern: ${field}`);
    new RegExp(triage[field], "iu");
  }
  same(triage.allowedReviewStrata, ["DIRECT_TARGET_CANDIDATE_REVIEW", "AUXILIARY_OR_CONSTRUCT_REVIEW", "METADATA_RESOLUTION_REQUIRED"], "Metadata review strata drifted.");

  const snapshot = contract.snapshot;
  same(snapshot.staticFiles, byteSort(snapshot.staticFiles), "Entry-metadata static snapshot files must be bytewise sorted.");
  ok(new Set(snapshot.staticFiles).size === snapshot.staticFiles.length && snapshot.staticFiles.length === 9, "Entry-metadata static snapshot allowlist drifted.");
  ok(snapshot.rawFilePattern === "raw/rcsb-entry-metadata-batch-NNN-repeat-R.json" && snapshot.rawResponseCount === 24, "Entry-metadata raw response contract drifted.");
  ok(snapshot.targetFreezePermittedBySnapshotAlone === false && snapshot.dispositionLedgerComplete === false && snapshot.leakageGraphComplete === false && snapshot.executionAuthorized === false, "Entry-metadata snapshot cannot authorize scientific advancement.");
}

async function verifySourceBinding(root, contract) {
  const input = contract.input;
  const snapshot = path.join(root, input.sourceSnapshotDirectory);
  const attestationPath = path.join(root, input.sourceAttestation);
  ok(await realpath(snapshot) === path.resolve(snapshot), "Source snapshot path cannot contain symlinked ancestors.");
  const [manifest, checksums, identifiers, universe, gpcrdb, attestationFile] = await Promise.all([
    regularFile(path.join(snapshot, "manifest.json"), "source manifest"),
    regularFile(path.join(snapshot, "checksums.sha256"), "source checksums"),
    regularFile(path.join(snapshot, input.sourceIdentifierListFile), "source identifier list"),
    regularFile(path.join(snapshot, input.sourceUniverseFile), "source universe JSONL"),
    regularFile(path.join(snapshot, input.gpcrdbRawFile), "frozen GPCRdb metadata"),
    regularFile(attestationPath, "source attestation", 2 * 1024 * 1024),
  ]);
  ok(digest(manifest.bytes) === input.sourceManifestSha256, "Source manifest digest no longer matches the entry-metadata contract.");
  ok(digest(checksums.bytes) === input.sourceChecksumsSha256, "Source checksum-file digest no longer matches the entry-metadata contract.");
  ok(digest(identifiers.bytes) === input.sourceIdentifierListSha256, "Source identifier-list digest no longer matches the entry-metadata contract.");
  ok(digest(universe.bytes) === input.sourceUniverseJsonlSha256, "Source-universe JSONL digest no longer matches the entry-metadata contract.");

  const idPattern = new RegExp(contract.normalization.pdbIdentifierPattern, "u");
  ok(identifiers.text.endsWith("\n"), "Source identifier list must end with LF.");
  const ids = identifiers.text.trimEnd().split("\n");
  ok(ids.length === input.sourceIdentifierCount && new Set(ids).size === ids.length && ids.every((id) => idPattern.test(id)), "Source identifier list has invalid count, duplicates, or identifiers.");
  same(ids, byteSort(ids), "Source identifier list is not bytewise sorted.");
  const universeRows = universe.text.trimEnd().split("\n").map((line) => JSON.parse(line));
  ok(universeRows.length === ids.length, "Source universe row count no longer matches the identifier list.");
  same(universeRows.map((row) => row.pdbId), ids, "Source universe IDs no longer match the identifier list.");
  for (const row of universeRows) {
    ok(row.dispositionStatus === "PENDING_DISPOSITION" && row.nativeCoordinatesInspected === false, `${row.pdbId} improperly claims a disposition or coordinate access.`);
  }

  const gpcrdbRows = JSON.parse(gpcrdb.text);
  ok(Array.isArray(gpcrdbRows), "Frozen GPCRdb metadata must be an array.");
  const gpcrdbIds = gpcrdbRows.map((row) => String(row?.pdb_code ?? "").toUpperCase());
  ok(ids.every((id) => gpcrdbIds.includes(id)), "Frozen GPCRdb metadata is missing a source-universe entry.");

  const sourceManifest = JSON.parse(manifest.text);
  ok(sourceManifest.normalized?.intersection?.count === input.sourceIdentifierCount && sourceManifest.normalized?.intersection?.sha256 === input.sourceIdentifierListSha256, "Source manifest intersection binding drifted.");
  for (const field of ["dispositionLedgerComplete", "leakageGraphComplete", "exactFrozenTargetSetExists", "targetFreezePermitted", "prelabelSealCreated", "userApproved", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]) {
    ok(sourceManifest[field] === false, `Source manifest blocked-state field drifted: ${field}`);
  }

  const attestation = JSON.parse(attestationFile.text);
  ok(attestation.status === "SOURCE_UNIVERSE_ARCHIVED_BLOCKED_PENDING_DISPOSITIONS", "Source attestation status drifted.");
  ok(attestation.snapshotDirectory === input.sourceSnapshotDirectory && attestation.snapshotManifestSha256 === input.sourceManifestSha256 && attestation.snapshotChecksumsSha256 === input.sourceChecksumsSha256, "Source attestation no longer binds the selected snapshot.");
  ok(attestation.pendingDispositionRows === input.sourceIdentifierCount && attestation.formallyClearedGroupCount === 0, "Source attestation improperly claims disposition or clearance.");
  for (const field of ["dispositionLedgerComplete", "leakageGraphComplete", "targetFreezePermitted", "prelabelSealCreated", "userApproved", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]) {
    ok(attestation[field] === false, `Source attestation blocked-state field drifted: ${field}`);
  }
  return { ids, universeRows, gpcrdbRows };
}

export async function verifyV3EntryMetadataContracts(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const { contract, query } = await loadPackage(root);
  verifyContractShape(contract, query);
  const source = await verifySourceBinding(root, contract);
  return {
    status: contract.stage,
    sourceIdentifierCount: source.ids.length,
    batchSize: contract.rcsb.batchSize,
    batchCount: contract.rcsb.expectedBatchCount,
    repeatCount: contract.rcsb.repeatCount,
    expectedRawResponses: contract.snapshot.rawResponseCount,
    metadataTriageStatus: contract.triage.status,
    pendingDispositionRows: source.universeRows.length,
    formallyClearedGroups: 0,
    targetFreezePermitted: false,
    nativeHoldoutCoordinatesAccessed: false,
    dockqLabelsAccessed: false,
    executionAuthorized: false,
  };
}

export { digest };

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  try {
    console.log(JSON.stringify(await verifyV3EntryMetadataContracts(process.argv[2] ? path.resolve(process.argv[2]) : ROOT), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
