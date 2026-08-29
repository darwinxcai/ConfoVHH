import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./oracle/canonical-json.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const REL = "validation/hard-decoy-holdout-v3/prelabel-census-draft";
const FILES = ["README.md", "annotation-epitope-ontology.json", "checksums.sha256", "disposition-contract.json", "source-query-contract.json", "state.json"].sort();
const SHA = /^[a-f0-9]{64}$/u;
const COORD = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)\b|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;
const MAX_JSON_CHARACTERS = 2 * 1024 * 1024;

function ok(value, message) { if (!value) throw new Error(message); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function same(left, right, message) { ok(JSON.stringify(left) === JSON.stringify(right), message); }
function parseContractJson(name, text) {
  try {
    return parseStrictJson(text, {
      maximumCharacters: MAX_JSON_CHARACTERS,
      maximumTokens: 500_000,
      maximumDepth: 64,
    });
  } catch (error) {
    throw new Error(`${name} failed strict JSON validation: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function clean(name, text) {
  ok(!text.includes("\0"), `NUL byte appeared in ${name}.`);
  ok(!COORD.test(text), `Coordinate payload appeared in ${name}.`);
  ok(!LABEL.test(text), `Observed holdout-label assignment appeared in ${name}.`);
}

async function loadPackage(root) {
  const dir = path.join(root, REL);
  const info = await lstat(dir);
  ok(info.isDirectory() && !info.isSymbolicLink(), "V3 contract path must be a direct directory.");
  ok(await realpath(dir) === path.resolve(dir), "V3 contract path cannot contain symlinked ancestors.");
  const entries = await readdir(dir, { withFileTypes: true });
  same(entries.map((entry) => entry.name).sort(), FILES, "V3 contract directory does not match the exact file allowlist.");
  ok(entries.every((entry) => entry.isFile() && !entry.isSymbolicLink()), "Every V3 contract entry must be a direct regular file.");

  const manifest = await readFile(path.join(dir, "checksums.sha256"), "utf8");
  clean("checksums.sha256", manifest);
  ok(manifest.endsWith("\n"), "checksums.sha256 must end with LF.");
  const rows = manifest.trimEnd().split("\n");
  const expected = FILES.filter((file) => file !== "checksums.sha256");
  ok(rows.length === expected.length, "checksums.sha256 must cover every contract file except itself.");
  const texts = new Map([["checksums.sha256", manifest]]);
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u.exec(row);
    ok(match, `checksums.sha256:${index + 1} has invalid syntax.`);
    const [, expectedSha, file] = match;
    ok(expected.includes(file) && !seen.has(file), `Unexpected or duplicate checksum path: ${file}`);
    seen.add(file);
    const fileInfo = await lstat(path.join(dir, file), { bigint: true });
    ok(fileInfo.isFile() && !fileInfo.isSymbolicLink() && fileInfo.nlink === 1n, `${file} must be one direct regular file.`);
    const bytes = await readFile(path.join(dir, file));
    ok(bytes.byteLength <= 2 * 1024 * 1024, `${file} exceeds the contract byte cap.`);
    ok(digest(bytes) === expectedSha, `Checksum mismatch: ${file}`);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    clean(file, text);
    texts.set(file, text);
  }
  same([...seen].sort(), expected.sort(), "Checksum coverage is incomplete.");
  return Object.fromEntries([...texts].map(([file, text]) => [file, file.endsWith(".json") ? parseContractJson(file, text) : text]));
}

function verifyState(state) {
  ok(state.schemaVersion === "1.0.0" && state.studyId === "confovhh-hard-decoy-holdout-v3", "V3 state identity drifted.");
  ok(state.status === "V3_CENSUS_IN_PROGRESS", "Historical source-census status drifted.");
  ok(state.protocol === "HARD_DECOY_PROTOCOL_V3_DRAFT.md" && state.protocolDigestStatus === "REQUIRED_BEFORE_V3_TARGETS_FROZEN", "Historical v3 draft identity drifted.");
  ok(state.requiredIndependentGroups === 10, "The formal minimum of 10 independent groups drifted.");
  for (const field of ["sourceUniverseFrozen", "dispositionLedgerComplete", "leakageGraphComplete", "exactFrozenTargetSetExists", "targetManifestFrozen", "candidateManifestFrozen", "auditManifestFrozen", "prelabelSealCreated", "userApproved", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]) {
    ok(state[field] === false, `V3 in-progress field must remain false: ${field}`);
  }
  ok(state.sourceUniverseSnapshot === null && state.exactFrozenGroupCount === null, "V3 draft cannot claim a frozen source snapshot or group count.");
  same(state.claimVocabulary, {
    receptor: "receptor-cluster-disjoint",
    vhh: "VHH-sequence-cluster-disjoint-with-known-parent-vetoes",
    epitope: "annotation-epitope-disjoint",
    publication: "primary-publication-disjoint",
  }, "Archived source-census vocabulary drifted.");
  const required = ["source-universe-reconstruction", "exhaustive-entry-dispositions", "development-registry-completion", "receptor-and-vhh-leakage-matrices", "mechanical-connected-component-graph", "minimum-independent-groups", "generator-environment-locks", "prelabel-seal-and-explicit-approval"].sort();
  same([...state.openBlockers].sort(), required, "V3 blocker list drifted.");
}

function verifySource(source) {
  ok(source.schemaVersion === "1.0.0" && source.studyId === "confovhh-hard-decoy-holdout-v3" && source.stage === "V3_CENSUS_IN_PROGRESS", "Source contract identity drifted.");
  ok(source.retrieval.repeatCount === 2 && source.retrieval.maximumResponseBytes === 16 * 1024 * 1024, "Source repeat or byte-cap contract drifted.");
  same(source.normalization, {
    identifierPattern: "^[0-9][A-Z0-9]{3}$", uppercase: true, deduplicate: true,
    sort: "bytewise-ascending", serialization: "one-identifier-per-line-with-terminal-LF",
    digest: "SHA-256-over-UTF-8-serialized-bytes",
  }, "PDB identifier normalization drifted.");
  ok(source.rcsb.endpoint === "https://search.rcsb.org/rcsbsearch/v2/query" && source.rcsb.method === "POST" && source.rcsb.service === "full_text" && source.rcsb.returnType === "entry", "RCSB query contract drifted.");
  same(source.rcsb.queries.map(({ id, term }) => [id, term]), [["nanobody", "nanobody"], ["vhh", "VHH"], ["camelid", "camelid"], ["megabody", "megabody"]], "RCSB search terms drifted.");
  ok(source.gpcrdb.apiEndpoint === "https://gpcrdb.org/services/structure/" && source.gpcrdb.pdbCodeField === "pdb_code", "GPCRdb API contract drifted.");
  ok(source.gpcrdb.htmlEndpoint === "https://gpcrdb.org/structure" && source.gpcrdb.htmlPdbColumnIndexZeroBased === 7, "GPCRdb HTML cross-check drifted.");
  for (const url of [source.rcsb.endpoint, source.gpcrdb.apiEndpoint, source.gpcrdb.htmlEndpoint]) {
    ok(url.startsWith("https://"), `Non-HTTPS metadata source: ${url}`);
    ok(source.blindBoundary.forbiddenUrlFragments.every((fragment) => !url.toLowerCase().includes(fragment.toLowerCase())), `Forbidden source URL class: ${url}`);
  }
  const historical = source.historicalReferenceOnly;
  same(historical.rcsbQueryCounts, { nanobody: 1760, vhh: 475, camelid: 188, megabody: 59 }, "Historical RCSB counts drifted.");
  ok(historical.rcsbUnionCount === 2065 && historical.gpcrdbCount === 1716 && historical.intersectionCount === 287, "Historical aggregate counts drifted.");
  ok([...Object.values(historical.rcsbQueryDigests), historical.rcsbUnionDigest, historical.gpcrdbDigest, historical.intersectionDigest].every((value) => SHA.test(value)), "Historical source digest is invalid.");
  ok(source.snapshot.requiredFiles.length === 24 && new Set(source.snapshot.requiredFiles).size === 24, "Source snapshot allowlist must contain 24 unique files.");
  same(source.snapshot.requiredFiles, [...source.snapshot.requiredFiles].sort(), "Source snapshot allowlist must be sorted.");
  ok(source.snapshot.rawResponsesRetained && source.snapshot.repeatResponsesRetained && !source.snapshot.targetFreezePermittedBySnapshotAlone, "Source snapshot retention or freeze policy drifted.");
}

function verifyDisposition(contract) {
  ok(contract.schemaVersion === "1.0.0" && contract.ledgerFilename === "entry-dispositions.jsonl" && contract.oneRowPerSourceEntry, "Disposition contract identity drifted.");
  ok(contract.sourceUniverse === "normalized/rcsb-gpcrdb-intersection.txt", "Disposition source universe drifted.");
  ok(contract.requiredFields.length === 22 && new Set(contract.requiredFields).size === 22, "Disposition required-field schema drifted.");
  ok(contract.requiredFields.includes("pdbId") && contract.requiredFields.includes("dispositionCode") && contract.requiredFields.includes("nativeCoordinatesInspected"), "Disposition core fields are missing.");
  ok(contract.nullableFields.every((field) => contract.requiredFields.includes(field)), "Nullable disposition fields must also be required.");
  ok(Object.keys(contract.dispositionCodes).length === 12, "Disposition code count drifted.");
  same(contract.failClosedDispositionCodes, ["EXCLUDE_AMBIGUOUS_EVIDENCE", "PENDING_REQUIRED_METADATA"], "Fail-closed disposition set drifted.");
  ok(contract.forbiddenFields.every((field) => !contract.requiredFields.includes(field)), "A forbidden result field entered the disposition schema.");
  ok(Object.values(contract.evidenceRules).every(Boolean), "Every disposition evidence rule must remain enabled.");
}

function verifyOntology(ontology) {
  ok(ontology.schemaVersion === "1.0.0" && ontology.ontologyId === "confovhh-annotation-epitope-v1" && ontology.claim === "annotation-epitope-disjoint", "Epitope ontology identity drifted.");
  ok(ontology.assignmentSourcePolicy === "primary-publication-or-depositor-annotation-only", "Epitope assignment source policy drifted.");
  const rules = ontology.matchingRules;
  ok(rules.exactTokenMatchCreatesEdge && rules.ancestorDescendantMatchCreatesEdge && !rules.sharedAncestorAloneCreatesEdge && rules.namedDomainMatchRequiresEqualNormalizedQualifier && rules.unknownOrAmbiguousFailsClosed, "Epitope matching rules drifted.");
  ok(ontology.tokens.length === 8, "Epitope token count drifted.");
  const map = new Map(ontology.tokens.map((token) => [token.id, token]));
  ok(map.size === ontology.tokens.length, "Epitope token IDs are duplicated.");
  for (const token of ontology.tokens) {
    ok(token.parent === null || map.has(token.parent), `Unknown epitope parent: ${token.id}`);
    const seen = new Set([token.id]);
    let parent = token.parent;
    while (parent !== null) { ok(!seen.has(parent), `Epitope ontology cycle: ${token.id}`); seen.add(parent); parent = map.get(parent).parent; }
  }
  const root = map.get("RECEPTOR_SURFACE");
  const unknown = map.get("UNKNOWN_OR_AMBIGUOUS");
  ok(root && root.parent === null && root.assignable === false, "Epitope root drifted.");
  ok(unknown && unknown.parent === null && unknown.assignable && unknown.failsClosed && unknown.qualifierPolicy === "REQUIRED_REASON", "Unknown epitope token must fail closed.");
  ok(map.get("NAMED_RECEPTOR_DOMAIN_SURFACE")?.qualifierPolicy === "REQUIRED_NORMALIZED_DOMAIN_NAME", "Named-domain qualifier policy drifted.");
}

export async function verifyV3CensusContracts(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const files = await loadPackage(root);
  verifyState(files["state.json"]);
  verifySource(files["source-query-contract.json"]);
  verifyDisposition(files["disposition-contract.json"]);
  verifyOntology(files["annotation-epitope-ontology.json"]);
  return {
    status: files["state.json"].status,
    requiredIndependentGroups: files["state.json"].requiredIndependentGroups,
    sourceRetrievalRepeats: files["source-query-contract.json"].retrieval.repeatCount,
    rcsbQueries: files["source-query-contract.json"].rcsb.queries.map(({ id }) => id),
    snapshotFileCount: files["source-query-contract.json"].snapshot.requiredFiles.length,
    dispositionRequiredFieldCount: files["disposition-contract.json"].requiredFields.length,
    dispositionCodeCount: Object.keys(files["disposition-contract.json"].dispositionCodes).length,
    epitopeTokenCount: files["annotation-epitope-ontology.json"].tokens.length,
    advancementAuthority: false,
    annotationEpitopeEligibilityAuthority: false,
    selectedProtocol: "HARD_DECOY_PROTOCOL_V3.md",
    nativeHoldoutCoordinatesAccessed: false,
    dockqLabelsAccessed: false,
    executionAuthorized: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  try { console.log(JSON.stringify(await verifyV3CensusContracts(process.argv[2] ? path.resolve(process.argv[2]) : ROOT), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
