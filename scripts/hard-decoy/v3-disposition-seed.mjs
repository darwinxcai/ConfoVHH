import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const CONTRACT_REL = "validation/hard-decoy-holdout-v3/disposition-seed-contract-2026-08-29.json";
const DISPOSITION_CONTRACT_REL = "validation/hard-decoy-holdout-v3/prelabel-census-draft/disposition-contract.json";
const OUTPUT_STATUS = "DISPOSITION_SEED_CREATED_BLOCKED_PENDING_REVIEW";
const TRI = ["PASS", "FAIL", "UNRESOLVED"];
const SHA256 = /^[a-f0-9]{64}$/u;
const PDB_ID = /^[0-9][A-Z0-9]{3}$/u;
const COORD = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const OBSERVED_LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)\b|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;
const FORBIDDEN_KEYS = /^(?:dockq|dockqScore|capri|capriClass|fnat|irmsd|lrmsd|nativeCoordinates|nativeInterfaceResidues|confovhhScore|performanceResult)$/iu;

function ok(value, message) {
  if (!value) throw new Error(message);
}

function byteCompare(left, right) {
  return Buffer.from(String(left)).compare(Buffer.from(String(right)));
}

function byteSort(values) {
  return [...values].sort(byteCompare);
}

function uniqueStrings(values) {
  return byteSort([...new Set(values.filter((value) => typeof value === "string" && value.length > 0))]);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort(byteCompare).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonl(rows) {
  return rows.length ? `${rows.map(canonical).join("\n")}\n` : "";
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJsonl(text, label) {
  ok(text.endsWith("\n"), `${label} must end with LF.`);
  if (!text.trim()) return [];
  return text.trimEnd().split("\n").map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${label}:${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function walk(value, visit, trail = []) {
  visit(value, trail);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visit, [...trail, index]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    ok(!FORBIDDEN_KEYS.test(key), `Forbidden result field: ${[...trail, key].join(".")}`);
    walk(item, visit, [...trail, key]);
  }
}

function clean(label, text) {
  ok(!text.includes("\0"), `NUL byte appeared in ${label}.`);
  ok(!COORD.test(text), `Coordinate payload appeared in ${label}.`);
  ok(!OBSERVED_LABEL.test(text), `Observed holdout-label assignment appeared in ${label}.`);
}

function exactKeys(record, expected, label) {
  ok(record && typeof record === "object" && !Array.isArray(record), `${label} must be an object.`);
  ok(canonical(Object.keys(record).sort(byteCompare)) === canonical([...expected].sort(byteCompare)), `${label} has unexpected keys.`);
}

function directRepositoryPath(root, relative, label) {
  ok(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative), `${label} path is unsafe.`);
  const filename = path.resolve(root, relative);
  const containment = path.relative(root, filename);
  ok(containment && containment !== ".." && !containment.startsWith(`..${path.sep}`) && !path.isAbsolute(containment), `${label} escaped the repository.`);
  return filename;
}

async function readDirect(root, relative, label, maximumBytes = 64 * 1024 * 1024) {
  const filename = directRepositoryPath(root, relative, label);
  const info = await lstat(filename, { bigint: true });
  ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, `${label} must be one direct regular file.`);
  ok(await realpath(filename) === filename, `${label} path cannot contain symlinks.`);
  ok(info.size <= BigInt(maximumBytes), `${label} exceeds the ${maximumBytes}-byte cap.`);
  const bytes = await readFile(filename);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  clean(label, text);
  return { filename, bytes, text, sha256: sha256(bytes) };
}

function mapUnique(rows, key, label) {
  const result = new Map();
  for (const row of rows) {
    const id = row?.[key];
    ok(typeof id === "string" && PDB_ID.test(id), `${label} contains an invalid ${key}.`);
    ok(!result.has(id), `${label} contains duplicate ${key}: ${id}`);
    result.set(id, row);
  }
  return result;
}

function selectEntity(entry, entityIds) {
  if (!Array.isArray(entityIds) || entityIds.length !== 1) return null;
  const entity = entry.polymerEntities?.find((candidate) => candidate.entityId === entityIds[0]);
  return entity ?? null;
}

function selectUniProt(entity) {
  if (!entity) return null;
  const accessions = uniqueStrings((entity.referenceSequences ?? [])
    .filter((reference) => /uniprot/iu.test(reference.databaseName ?? ""))
    .map((reference) => reference.databaseAccession));
  return accessions.length === 1 ? accessions[0] : null;
}

function buildDispositionRow({ source, entry, triage, development }) {
  const receptor = selectEntity(entry, triage.preferredReceptorAuthChainEntityIds);
  const vhh = selectEntity(entry, triage.vhhLikeEntityIds);
  const exactDevelopmentReuse = development !== null;
  const primaryDoi = entry.primaryCitation?.doi ?? null;
  const primaryPmid = entry.primaryCitation?.pmid ?? null;
  const publicationIdentified = primaryDoi !== null || primaryPmid !== null;
  const evidenceUrls = [`https://www.rcsb.org/structure/${source.pdbId}`];
  if (exactDevelopmentReuse) {
    evidenceUrls.push("https://github.com/darwinxcai/ConfoVHH/blob/8d6b27a104811c813b4769f8ec7c3a973d5f2a35/validation/hard-decoy-holdout-v2/prelabel-census/development-registry.json");
  }
  return {
    pdbId: source.pdbId,
    sourceQueryIds: uniqueStrings(source.rcsbQueryIds ?? []),
    releaseDate: entry.releaseDate ?? null,
    receptorEntityName: receptor?.description ?? development?.receptor ?? null,
    receptorUniProt: selectUniProt(receptor),
    vhhEntityName: vhh?.description ?? development?.vhh ?? null,
    vhhSequenceSha256: vhh?.sequenceSha256 ?? null,
    primaryDoi,
    primaryPmid,
    publicationStatus: publicationIdentified ? "PUBLISHED" : "UNKNOWN",
    directReceptorVhhEvidence: "UNRESOLVED",
    constructEvidence: "UNRESOLVED",
    auxiliaryBinderFlag: "UNRESOLVED",
    annotationEpitope: null,
    receptorClusterStatus: exactDevelopmentReuse ? "FAIL" : "UNRESOLVED",
    vhhClusterStatus: "UNRESOLVED",
    knownParentStatus: "UNRESOLVED",
    publicationEdgeStatus: "UNRESOLVED",
    dispositionCode: exactDevelopmentReuse ? "EXCLUDE_RECEPTOR_CLUSTER_LEAKAGE" : "PENDING_REQUIRED_METADATA",
    dispositionReason: exactDevelopmentReuse
      ? `Exact development-structure reuse: ${source.pdbId} appears in the frozen development registry for ${development.receptor}; receptor-cluster leakage is sufficient to exclude this entry before any other scientific gate.`
      : "No automatic scientific disposition is justified by metadata triage alone; source-backed direct-interface, construct, receptor/VHH cluster, parent, publication, and annotation-epitope review remains required.",
    evidenceUrls: uniqueStrings(evidenceUrls),
    nativeCoordinatesInspected: false,
  };
}

async function readInputs(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");

  const contractFile = await readDirect(root, CONTRACT_REL, "disposition seed contract", 2 * 1024 * 1024);
  const dispositionContractFile = await readDirect(root, DISPOSITION_CONTRACT_REL, "disposition contract", 2 * 1024 * 1024);
  const contract = JSON.parse(contractFile.text);
  const dispositionContract = JSON.parse(dispositionContractFile.text);

  ok(contract.schemaVersion === "1.0.0" && contract.studyId === "confovhh-hard-decoy-holdout-v3", "Disposition seed contract identity drifted.");
  ok(contract.status === "METADATA_ONLY_DISPOSITION_SEED_RULE_FROZEN", "Disposition seed rule is not frozen.");
  ok(contract.sourceUniverse.identifierCount === 287 && SHA256.test(contract.sourceUniverse.identifierListSha256), "Disposition seed source-universe contract drifted.");
  ok(contract.entryMetadata.entryCount === 287 && contract.entryMetadata.triageReviewStrataAreNotScientificDispositions === true, "Entry-metadata seed boundary drifted.");
  ok(contract.defaultRule.dispositionCode === "PENDING_REQUIRED_METADATA" && contract.defaultRule.automaticProvisionalTargetAssignmentPermitted === false && contract.defaultRule.automaticAuxiliaryOrConstructExclusionPermitted === false, "Default disposition seed rule drifted.");
  ok(contract.developmentRegistry.exactPdbReuseRule.dispositionCode === "EXCLUDE_RECEPTOR_CLUSTER_LEAKAGE" && contract.developmentRegistry.exactPdbReuseRule.receptorClusterStatus === "FAIL", "Exact development-reuse rule drifted.");
  ok(contract.integrity.targetFreezePermitted === false && contract.integrity.executionAuthorized === false, "Disposition seed contract cannot authorize target freeze or execution.");

  const sourceDir = contract.sourceUniverse.directory;
  const entryDir = contract.entryMetadata.directory;
  const sourceIdFile = await readDirect(root, `${sourceDir}/${contract.sourceUniverse.identifierListFile}`, "source identifier list");
  const sourceLedgerFile = await readDirect(root, `${sourceDir}/${contract.sourceUniverse.ledgerFile}`, "source universe ledger");
  const entryLedgerFile = await readDirect(root, `${entryDir}/${contract.entryMetadata.entryLedgerFile}`, "entry metadata ledger");
  const triageLedgerFile = await readDirect(root, `${entryDir}/${contract.entryMetadata.triageLedgerFile}`, "entry metadata triage ledger");
  const developmentFile = await readDirect(root, contract.developmentRegistry.path, "development registry", 4 * 1024 * 1024);

  ok(sourceIdFile.sha256 === contract.sourceUniverse.identifierListSha256, "Source identifier-list digest drifted.");
  const ids = sourceIdFile.text.trimEnd().split("\n");
  ok(sourceIdFile.text.endsWith("\n") && ids.length === contract.sourceUniverse.identifierCount, "Source identifier-list count drifted.");
  ok(ids.every((id) => PDB_ID.test(id)) && canonical(ids) === canonical(byteSort(ids)) && new Set(ids).size === ids.length, "Source identifier list is not unique bytewise-sorted PDB IDs.");

  const sourceRows = parseJsonl(sourceLedgerFile.text, "source-universe.jsonl");
  const entries = parseJsonl(entryLedgerFile.text, "entries.jsonl");
  const triageRows = parseJsonl(triageLedgerFile.text, "triage-signals.jsonl");
  ok(sourceRows.length === ids.length && entries.length === ids.length && triageRows.length === ids.length, "Disposition seed inputs do not reconcile to 287 rows.");

  const sourceMap = mapUnique(sourceRows, "pdbId", "source universe ledger");
  const entryMap = mapUnique(entries, "pdbId", "entry metadata ledger");
  const triageMap = mapUnique(triageRows, "pdbId", "entry metadata triage ledger");
  for (const id of ids) ok(sourceMap.has(id) && entryMap.has(id) && triageMap.has(id), `Disposition seed input omitted ${id}.`);

  const developmentRegistry = JSON.parse(developmentFile.text);
  const developmentRows = developmentRegistry.developmentGpcrVhhStructures ?? [];
  const developmentIds = byteSort(developmentRows.map((row) => row.pdbId));
  ok(developmentRows.length === contract.developmentRegistry.expectedStructureCount, "Development structure count drifted.");
  ok(canonical(developmentIds) === canonical(contract.developmentRegistry.requiredStructureIds), "Development PDB registry drifted from the frozen seed rule.");
  const developmentMap = new Map(developmentRows.map((row) => [row.pdbId, row]));

  const requiredFields = dispositionContract.requiredFields;
  ok(Array.isArray(requiredFields) && requiredFields.length === 22, "Disposition contract required-field count drifted.");
  ok(Object.hasOwn(dispositionContract.dispositionCodes, "EXCLUDE_RECEPTOR_CLUSTER_LEAKAGE") && Object.hasOwn(dispositionContract.dispositionCodes, "PENDING_REQUIRED_METADATA"), "Required seed disposition codes are missing.");

  return {
    root,
    contract,
    dispositionContract,
    ids,
    sourceMap,
    entryMap,
    triageMap,
    developmentMap,
    inputDigests: {
      dispositionSeedContract: contractFile.sha256,
      dispositionContract: dispositionContractFile.sha256,
      sourceIdentifierList: sourceIdFile.sha256,
      sourceUniverseLedger: sourceLedgerFile.sha256,
      entryMetadataLedger: entryLedgerFile.sha256,
      entryMetadataTriageLedger: triageLedgerFile.sha256,
      developmentRegistry: developmentFile.sha256,
      generatorScript: sha256(await readFile(HERE)),
    },
  };
}

function validateRow(row, dispositionContract) {
  exactKeys(row, dispositionContract.requiredFields, `Disposition row ${row.pdbId}`);
  ok(PDB_ID.test(row.pdbId), `Invalid disposition PDB ID: ${row.pdbId}`);
  ok(Array.isArray(row.sourceQueryIds) && row.sourceQueryIds.length > 0 && canonical(row.sourceQueryIds) === canonical(uniqueStrings(row.sourceQueryIds)), `${row.pdbId} source query IDs are invalid.`);
  ok(row.releaseDate === null || typeof row.releaseDate === "string", `${row.pdbId} release date is invalid.`);
  for (const field of ["receptorEntityName", "receptorUniProt", "vhhEntityName", "vhhSequenceSha256", "primaryDoi", "primaryPmid"]) {
    ok(row[field] === null || typeof row[field] === "string", `${row.pdbId} ${field} is invalid.`);
  }
  ok(row.vhhSequenceSha256 === null || SHA256.test(row.vhhSequenceSha256), `${row.pdbId} VHH sequence digest is invalid.`);
  ok(dispositionContract.allowedPublicationStatus.includes(row.publicationStatus), `${row.pdbId} publication status is invalid.`);
  for (const field of ["directReceptorVhhEvidence", "constructEvidence", "receptorClusterStatus", "vhhClusterStatus", "knownParentStatus", "publicationEdgeStatus"]) {
    ok(TRI.includes(row[field]), `${row.pdbId} ${field} is invalid.`);
  }
  ok(typeof row.auxiliaryBinderFlag === "boolean" || row.auxiliaryBinderFlag === "UNRESOLVED", `${row.pdbId} auxiliary binder flag is invalid.`);
  ok(row.annotationEpitope === null || typeof row.annotationEpitope === "object", `${row.pdbId} annotation epitope is invalid.`);
  ok(Object.hasOwn(dispositionContract.dispositionCodes, row.dispositionCode), `${row.pdbId} disposition code is invalid.`);
  ok(typeof row.dispositionReason === "string" && row.dispositionReason.length >= 40, `${row.pdbId} disposition reason is inadequate.`);
  ok(Array.isArray(row.evidenceUrls) && row.evidenceUrls.length > 0 && row.evidenceUrls.every((url) => /^https:\/\//u.test(url)), `${row.pdbId} evidence URLs are invalid.`);
  ok(row.nativeCoordinatesInspected === false, `${row.pdbId} cannot claim native-coordinate inspection.`);
  walk(row, (value, trail) => {
    if (typeof value === "number") ok(Number.isFinite(value), `${row.pdbId} contains a nonfinite number: ${trail.join(".")}`);
    if (typeof value === "string") clean(`${row.pdbId}:${trail.join(".")}`, value);
  });
}

export async function buildDispositionSeedModel(repositoryRoot = ROOT) {
  const inputs = await readInputs(repositoryRoot);
  const rows = inputs.ids.map((id) => buildDispositionRow({
    source: inputs.sourceMap.get(id),
    entry: inputs.entryMap.get(id),
    triage: inputs.triageMap.get(id),
    development: inputs.developmentMap.get(id) ?? null,
  }));
  rows.forEach((row) => validateRow(row, inputs.dispositionContract));
  ok(canonical(rows.map((row) => row.pdbId)) === canonical(inputs.ids), "Disposition rows lost exact source order.");

  const exactDevelopmentExclusionIds = rows.filter((row) => row.dispositionCode === "EXCLUDE_RECEPTOR_CLUSTER_LEAKAGE").map((row) => row.pdbId);
  const pendingIds = rows.filter((row) => row.dispositionCode === "PENDING_REQUIRED_METADATA").map((row) => row.pdbId);
  const otherRows = rows.filter((row) => !["EXCLUDE_RECEPTOR_CLUSTER_LEAKAGE", "PENDING_REQUIRED_METADATA"].includes(row.dispositionCode));
  ok(otherRows.length === 0, "The metadata-only seed assigned an unauthorized scientific disposition.");
  ok(exactDevelopmentExclusionIds.every((id) => inputs.developmentMap.has(id)), "An exact-development exclusion lacks a development-registry match.");
  ok(pendingIds.every((id) => !inputs.developmentMap.has(id)), "An exact development PDB was left pending.");
  ok(pendingIds.length > 0, "The seed cannot complete the scientific disposition ledger.");

  const dispositionText = jsonl(rows);
  const sourceIdsPresentInDevelopment = inputs.ids.filter((id) => inputs.developmentMap.has(id));
  const developmentIdsAbsentFromSource = byteSort([...inputs.developmentMap.keys()].filter((id) => !inputs.sourceMap.has(id)));
  const summary = {
    schemaVersion: "1.0.0",
    studyId: inputs.contract.studyId,
    status: OUTPUT_STATUS,
    sourceEntryCount: inputs.ids.length,
    dispositionRowCount: rows.length,
    resolvedDispositionRowCount: exactDevelopmentExclusionIds.length,
    pendingDispositionRowCount: pendingIds.length,
    exactDevelopmentExclusionCount: exactDevelopmentExclusionIds.length,
    provisionalDirectTargetCount: 0,
    otherAutomaticDispositionCount: 0,
    developmentRegistryStructureCount: inputs.developmentMap.size,
    developmentStructuresPresentInSourceCount: sourceIdsPresentInDevelopment.length,
    developmentStructuresAbsentFromSourceCount: developmentIdsAbsentFromSource.length,
    dispositionLedgerComplete: false,
    leakageGraphComplete: false,
    formallyClearedGroupCount: 0,
    exactFrozenTargetSetExists: false,
    targetFreezePermitted: false,
    prelabelSealCreated: false,
    userApproved: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
  };
  const manifest = {
    schemaVersion: "1.0.0",
    studyId: inputs.contract.studyId,
    stage: "V3_CENSUS_IN_PROGRESS",
    status: OUTPUT_STATUS,
    snapshotDateUtc: inputs.contract.snapshotDateUtc,
    generatorScript: "scripts/hard-decoy/v3-disposition-seed.mjs",
    dispositionSeedContract: CONTRACT_REL,
    dispositionContract: DISPOSITION_CONTRACT_REL,
    inputDigests: inputs.inputDigests,
    sourceIdentifierCount: inputs.ids.length,
    sourceIdentifierListSha256: inputs.contract.sourceUniverse.identifierListSha256,
    dispositionRows: {
      count: rows.length,
      sha256: sha256(Buffer.from(dispositionText)),
    },
    exactDevelopmentExclusionIds,
    developmentStructuresAbsentFromSource: developmentIdsAbsentFromSource,
    triageReviewStrataUsedForDisposition: false,
    automaticProvisionalTargetAssignment: false,
    automaticAuxiliaryOrConstructExclusion: false,
    summary,
    dispositionLedgerComplete: false,
    leakageGraphComplete: false,
    exactFrozenTargetSetExists: false,
    targetFreezePermitted: false,
    prelabelSealCreated: false,
    userApproved: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
  };
  const readme = [
    "# ConfoVHH hard-decoy v3 metadata-only disposition seed",
    "",
    `Status: **${OUTPUT_STATUS}**`,
    "",
    `- Exact source-universe rows: ${summary.sourceEntryCount}`,
    `- Exact development-PDB exclusions: ${summary.exactDevelopmentExclusionCount}`,
    `- Rows still pending required public evidence: ${summary.pendingDispositionRowCount}`,
    "- Automatically promoted provisional targets: 0",
    "- Formally cleared independent groups: 0",
    "",
    "Only exact PDB-ID reuse from the frozen development registry is automatically excluded. Metadata review strata, auxiliary-language signals, construct-risk signals, missing citation identifiers, and VHH-like sequence signals do not by themselves determine a scientific disposition.",
    "",
    "Every non-development row remains `PENDING_REQUIRED_METADATA` until source-backed direct-interface, construct, receptor/VHH cluster, known-parent, publication, and annotation-epitope review is complete.",
    "",
    "No holdout coordinate, native relative receptor–VHH pose, DockQ/CAPRI label, ConfoVHH holdout score, or performance result was accessed.",
    "",
  ].join("\n");

  const payloads = {
    "README.md": readme,
    "entry-dispositions.jsonl": dispositionText,
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "summary.json": `${JSON.stringify(summary, null, 2)}\n`,
  };
  Object.entries(payloads).forEach(([name, text]) => clean(name, text));
  const checksumRows = byteSort(Object.keys(payloads)).map((name) => `${sha256(Buffer.from(payloads[name]))}  ${name}`);
  payloads["checksums.sha256"] = `${checksumRows.join("\n")}\n`;
  return { ...inputs, rows, summary, manifest, payloads };
}

async function listFiles(directory) {
  return byteSort((await readdir(directory, { withFileTypes: true })).map((entry) => {
    ok(entry.isFile() && !entry.isSymbolicLink(), `Unexpected non-file disposition seed entry: ${entry.name}`);
    return entry.name;
  }));
}

function safeOutputDirectory(outputDirectory, repositoryRoot) {
  ok(typeof outputDirectory === "string" && outputDirectory.length > 0, "Disposition seed output directory is required.");
  const output = path.resolve(outputDirectory);
  ok(output !== path.parse(output).root && output !== path.resolve(repositoryRoot), "Refusing unsafe disposition seed output path.");
  return output;
}

export async function writeDispositionSeed({ repositoryRoot = ROOT, outputDirectory } = {}) {
  const model = await buildDispositionSeedModel(repositoryRoot);
  const output = safeOutputDirectory(outputDirectory, repositoryRoot);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const name of byteSort(Object.keys(model.payloads))) {
    await writeFile(path.join(output, name), model.payloads[name], { flag: "wx" });
  }
  const verified = await verifyDispositionSeed({ repositoryRoot, snapshotDirectory: output });
  return { ...verified, outputDirectory: output };
}

async function readSnapshotFiles(snapshotDirectory, expectedFiles) {
  const snapshot = await realpath(snapshotDirectory);
  ok(snapshot === path.resolve(snapshotDirectory), "Disposition seed snapshot path contains symlinked ancestors.");
  ok(canonical(await listFiles(snapshot)) === canonical(expectedFiles), "Disposition seed snapshot inventory drifted.");
  const manifestText = await readFile(path.join(snapshot, "checksums.sha256"), "utf8");
  clean("checksums.sha256", manifestText);
  ok(manifestText.endsWith("\n"), "checksums.sha256 must end with LF.");
  const rows = manifestText.trimEnd().split("\n");
  ok(rows.length === expectedFiles.length - 1, "Disposition seed checksum coverage is incomplete.");
  const texts = new Map([["checksums.sha256", manifestText]]);
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u.exec(row);
    ok(match, `checksums.sha256:${index + 1} has invalid syntax.`);
    const [, expectedSha, name] = match;
    ok(expectedFiles.includes(name) && name !== "checksums.sha256" && !seen.has(name), `Unexpected or duplicate checksum path: ${name}`);
    seen.add(name);
    const info = await lstat(path.join(snapshot, name), { bigint: true });
    ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, `${name} must be one direct regular file.`);
    const bytes = await readFile(path.join(snapshot, name));
    ok(sha256(bytes) === expectedSha, `Checksum mismatch: ${name}`);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    clean(name, text);
    texts.set(name, text);
  }
  ok(canonical(byteSort([...seen])) === canonical(expectedFiles.filter((name) => name !== "checksums.sha256").sort(byteCompare)), "Disposition seed checksum coverage drifted.");
  return texts;
}

export async function verifyDispositionSeed({ repositoryRoot = ROOT, snapshotDirectory } = {}) {
  ok(snapshotDirectory, "Disposition seed snapshot directory is required.");
  const model = await buildDispositionSeedModel(repositoryRoot);
  const expectedFiles = model.contract.output.requiredFiles;
  ok(canonical(expectedFiles) === canonical(byteSort(expectedFiles)) && new Set(expectedFiles).size === expectedFiles.length, "Disposition seed output allowlist is invalid.");
  const texts = await readSnapshotFiles(snapshotDirectory, expectedFiles);
  for (const [name, expected] of Object.entries(model.payloads)) {
    ok(texts.get(name) === expected, `Disposition seed snapshot drifted: ${name}`);
  }

  const rows = parseJsonl(texts.get("entry-dispositions.jsonl"), "entry-dispositions.jsonl");
  ok(rows.length === model.ids.length && new Set(rows.map((row) => row.pdbId)).size === rows.length, "Disposition seed ledger does not contain one unique row per source entry.");
  rows.forEach((row) => validateRow(row, model.dispositionContract));
  ok(rows.every((row) => row.nativeCoordinatesInspected === false), "Disposition seed cannot contain native-coordinate inspection.");
  ok(rows.filter((row) => row.dispositionCode === "PROVISIONAL_DIRECT_TARGET").length === 0, "Metadata triage improperly promoted a provisional target.");
  ok(rows.filter((row) => row.dispositionCode === "EXCLUDE_AUXILIARY_BINDER").length === 0, "Metadata lexical signals improperly created auxiliary exclusions.");
  ok(rows.filter((row) => row.dispositionCode === "EXCLUDE_FUSION_DOMINATED_INTERFACE").length === 0, "Metadata lexical signals improperly created construct exclusions.");

  return {
    status: model.summary.status,
    sourceEntryCount: model.summary.sourceEntryCount,
    dispositionRowCount: model.summary.dispositionRowCount,
    resolvedDispositionRowCount: model.summary.resolvedDispositionRowCount,
    pendingDispositionRowCount: model.summary.pendingDispositionRowCount,
    exactDevelopmentExclusionCount: model.summary.exactDevelopmentExclusionCount,
    exactDevelopmentExclusionIds: model.manifest.exactDevelopmentExclusionIds,
    developmentStructuresAbsentFromSource: model.manifest.developmentStructuresAbsentFromSource,
    provisionalDirectTargetCount: 0,
    formallyClearedGroupCount: 0,
    nativeHoldoutCoordinatesAccessed: false,
    dockqLabelsAccessed: false,
    executionAuthorized: false,
  };
}

async function main() {
  const [mode, target] = process.argv.slice(2);
  if (mode === "generate") {
    console.log(JSON.stringify(await writeDispositionSeed({ repositoryRoot: ROOT, outputDirectory: target }), null, 2));
    return;
  }
  if (mode === "verify") {
    console.log(JSON.stringify(await verifyDispositionSeed({ repositoryRoot: ROOT, snapshotDirectory: target }), null, 2));
    return;
  }
  throw new Error("Usage: node scripts/hard-decoy/v3-disposition-seed.mjs <generate|verify> <snapshot-directory>");
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
