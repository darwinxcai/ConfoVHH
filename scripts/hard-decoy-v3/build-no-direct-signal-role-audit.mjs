import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const OUTPUT_REL = "validation/hard-decoy-holdout-v3/no-direct-signal-role-audit-2026-09-04";
const INPUT_RELS = [
  "HARD_DECOY_PROTOCOL_V3.md",
  "validation/hard-decoy-holdout-v3/prelabel-census-draft/disposition-contract.json",
  "validation/hard-decoy-holdout-v2/prelabel-census/target-census.jsonl",
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/entries.jsonl",
  "validation/hard-decoy-holdout-v3/other-strata-salvage-review-2026-09-04/salvage-review-queue.jsonl",
  "validation/hard-decoy-holdout-v3/other-strata-salvage-review-2026-09-04/summary.json",
];
const STATUS = "NO_DIRECT_SIGNAL_PRIORITY_SET_ADDS_ZERO_COMPONENTS_OTHER_ROWS_REMAIN";
const COORDINATES = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const OBSERVED_LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;

const SOURCE_BACKED_EXCLUSIONS = [
  {
    pdbIds: ["7E6T"],
    dispositionCode: "EXCLUDE_NO_DIRECT_RECEPTOR_VHH_INTERFACE",
    componentEffect: "NO_NEW_COMPONENT",
    reviewedApparentVhhEntities: [],
    directInterfaceEvidence: {
      classification: "SOURCE_BACKED_NO_VHH_IN_DEPOSITED_COMPLEX",
      basis: "The primary paper's data-availability statement identifies 7E6T as TNCA-bound CaSR and 7E6U as the separate NB-2D11-bound CaSR entry; the frozen 7E6T entity record contains only the receptor polymer.",
      nativeCoordinatesInspected: false,
    },
    dispositionReason: "7E6T is a receptor-ligand structure without a deposited VHH, so it cannot be a direct receptor-VHH docking target.",
    evidenceUrls: [
      "https://elifesciences.org/articles/68578",
      "https://www.rcsb.org/structure/7E6T",
    ],
  },
  {
    pdbIds: ["8JRU", "8JRV"],
    dispositionCode: "EXCLUDE_AUXILIARY_BINDER",
    componentEffect: "NO_NEW_COMPONENT",
    reviewedApparentVhhEntities: ["Nanobody 32"],
    directInterfaceEvidence: {
      classification: "SOURCE_BACKED_ARRESTIN_COMPLEX_STABILIZER",
      basis: "The 2023 primary paper reports incubating the GCGR-beta-arrestin sample with Nb32. The primary Nb32 reagent paper reports that Nb32 recognizes the activated beta-arrestin conformation and substantially increases intact GPCR-G-protein-beta-arrestin megaplex particles.",
      nativeCoordinatesInspected: false,
    },
    dispositionReason: "Nb32 is an arrestin-complex stabilizer rather than the direct receptor-binding VHH required by the benchmark.",
    evidenceUrls: [
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC10447241/",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC7108872/",
      "https://www.rcsb.org/structure/8JRU",
      "https://www.rcsb.org/structure/8JRV",
    ],
  },
  {
    pdbIds: ["8XGR"],
    dispositionCode: "EXCLUDE_AUXILIARY_BINDER",
    componentEffect: "NO_NEW_COMPONENT",
    reviewedApparentVhhEntities: ["Nb35*"],
    directInterfaceEvidence: {
      classification: "SOURCE_BACKED_G_PROTEIN_COMPLEX_STABILIZER",
      basis: "The primary paper identifies the engineered Nb35* as binding the Rho-Gt complex and applies it with engineered Gt to determine the ETB receptor-G-protein complex.",
      nativeCoordinatesInspected: false,
    },
    dispositionReason: "The deposited VHH is the engineered G-protein-complex stabilizer Nb35*, not a direct ETB-binding VHH.",
    evidenceUrls: [
      "https://doi.org/10.1016/j.bbrc.2023.149361",
      "https://pubmed.ncbi.nlm.nih.gov/38128244/",
      "https://www.rcsb.org/structure/8XGR",
    ],
  },
  {
    pdbIds: ["9AXF"],
    dispositionCode: "EXCLUDE_AUXILIARY_BINDER",
    componentEffect: "NO_NEW_COMPONENT",
    reviewedApparentVhhEntities: ["Nanobody Nb-35"],
    directInterfaceEvidence: {
      classification: "SOURCE_BACKED_G_PROTEIN_COMPLEX_STABILIZER",
      basis: "The primary paper states that Nb35 and scFv16 were used to stabilize the heterotrimeric G protein in the detergent-solubilized CaSR-miniGisq complex.",
      nativeCoordinatesInspected: false,
    },
    dispositionReason: "Nb35 stabilizes the heterotrimeric G-protein assembly and is not the direct CaSR-binding VHH required by the benchmark.",
    evidenceUrls: [
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC11844898/",
      "https://doi.org/10.1038/s41586-024-07331-1",
      "https://www.rcsb.org/structure/9AXF",
    ],
  },
];

function ok(value, message) {
  if (!value) throw new Error(message);
}

function byteCompare(left, right) {
  return Buffer.from(String(left)).compare(Buffer.from(String(right)));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort(byteCompare).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function pretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonl(rows) {
  return `${rows.map(canonical).join("\n")}\n`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function clean(label, text) {
  ok(!text.includes("\0"), `NUL byte appeared in ${label}.`);
  ok(!COORDINATES.test(text), `Coordinate payload appeared in ${label}.`);
  ok(!OBSERVED_LABEL.test(text), `Observed holdout label appeared in ${label}.`);
}

function parseJsonl(text, label) {
  ok(text.endsWith("\n"), `${label} must end with LF.`);
  return text.trimEnd().split("\n").filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${label}:${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function directPath(root, relative, label) {
  ok(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative), `${label} path is unsafe.`);
  const filename = path.resolve(root, relative);
  const containment = path.relative(root, filename);
  ok(containment && containment !== ".." && !containment.startsWith(`..${path.sep}`) && !path.isAbsolute(containment), `${label} escaped the repository.`);
  return filename;
}

async function readBound(root, relative, label, maximumBytes = 128 * 1024 * 1024) {
  const filename = directPath(root, relative, label);
  const info = await lstat(filename, { bigint: true });
  ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, `${label} must be one direct regular file.`);
  ok(await realpath(filename) === filename, `${label} path cannot contain symlinks.`);
  ok(info.size <= BigInt(maximumBytes), `${label} exceeds its byte cap.`);
  const bytes = await readFile(filename);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  clean(label, text);
  return { bytes, text, sha256: sha256(bytes) };
}

function mapByPdb(rows, label) {
  const result = new Map();
  for (const row of rows) {
    ok(typeof row.pdbId === "string" && !result.has(row.pdbId), `${label} contains an invalid or duplicate PDB ID.`);
    result.set(row.pdbId, row);
  }
  return result;
}

export async function buildNoDirectSignalRoleAudit(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const loaded = new Map();
  for (const relative of INPUT_RELS) loaded.set(relative, await readBound(root, relative, relative));
  const protocol = loaded.get(INPUT_RELS[0]).text;
  ok(/at least\s+ten/u.test(protocol) && /Fewer than ten terminates this\s+protocol version/u.test(protocol), "The minimum-component rule drifted.");
  const contract = JSON.parse(loaded.get(INPUT_RELS[1]).text);
  const targetCensus = parseJsonl(loaded.get(INPUT_RELS[2]).text, INPUT_RELS[2]);
  const entries = parseJsonl(loaded.get(INPUT_RELS[3]).text, INPUT_RELS[3]);
  const queue = parseJsonl(loaded.get(INPUT_RELS[4]).text, INPUT_RELS[4]);
  const queueSummary = JSON.parse(loaded.get(INPUT_RELS[5]).text);
  const targetMap = mapByPdb(targetCensus, "target census");
  const entryMap = mapByPdb(entries, "entry metadata");
  const noSignalRows = queue.filter((row) => !row.directDevelopmentPregraphSignalPresent);
  ok(noSignalRows.length === 7 && queueSummary.noDirectDevelopmentPregraphSignalCount === 7, "The seven-entry priority set drifted.");

  const exclusions = SOURCE_BACKED_EXCLUSIONS.flatMap((assessment) => assessment.pdbIds.map((pdbId) => {
    ok(entryMap.has(pdbId), `${pdbId} is absent from the frozen entry snapshot.`);
    ok(noSignalRows.some((row) => row.pdbId === pdbId), `${pdbId} is absent from the no-direct-signal queue.`);
    ok(Object.hasOwn(contract.dispositionCodes, assessment.dispositionCode), `${assessment.dispositionCode} is not in the frozen disposition contract.`);
    const entry = entryMap.get(pdbId);
    return {
      schemaVersion: "1.0.0",
      studyId: "confovhh-hard-decoy-holdout-v3",
      pdbId,
      dispositionCode: assessment.dispositionCode,
      componentEffect: assessment.componentEffect,
      reviewedApparentVhhEntities: assessment.reviewedApparentVhhEntities,
      directInterfaceEvidence: assessment.directInterfaceEvidence,
      dispositionReason: assessment.dispositionReason,
      publication: {
        doi: entry.primaryCitation?.doi ?? null,
        pmid: entry.primaryCitation?.pmid ?? null,
        title: entry.primaryCitation?.title ?? null,
      },
      evidenceUrls: [...assessment.evidenceUrls].sort(byteCompare),
      publicSourcesReviewed: true,
      masterDispositionLedgerRewritten: false,
      targetFreezePermitted: false,
      nativeCoordinatesInspected: false,
    };
  })).sort((left, right) => byteCompare(left.pdbId, right.pdbId));
  ok(canonical(exclusions.map((row) => row.pdbId)) === canonical(["7E6T", "8JRU", "8JRV", "8XGR", "9AXF"]), "The source-backed exclusion set drifted.");

  const accountedIds = new Set(exclusions.map((row) => row.pdbId));
  const existingRepresentatives = noSignalRows.filter((row) => !accountedIds.has(row.pdbId)).map((row) => {
    ok(targetMap.has(row.pdbId), `${row.pdbId} is neither excluded nor an existing provisional representative.`);
    const target = targetMap.get(row.pdbId);
    return {
      schemaVersion: "1.0.0",
      studyId: "confovhh-hard-decoy-holdout-v3",
      pdbId: row.pdbId,
      provisionalGroupId: target.provisionalGroupId,
      accountingConclusion: "NO_ADDITIONAL_COMPONENT_EXISTING_PROVISIONAL_REPRESENTATIVE",
      independentComponentCountIncrementUpperBound: 0,
      existingStatus: target.status,
      formalDisposition: "PENDING_REQUIRED_METADATA",
      rationale: "This PDB ID is already the named representative of a component in the existing seven-group provisional census; reviewing it again cannot add another independent component.",
      masterDispositionLedgerRewritten: false,
      targetFreezePermitted: false,
      nativeCoordinatesInspected: false,
    };
  }).sort((left, right) => byteCompare(left.pdbId, right.pdbId));
  ok(canonical(existingRepresentatives.map((row) => row.pdbId)) === canonical(["7E6U", "8QJ2"]), "The existing-representative accounting set drifted.");
  const allOtherStrataExistingRepresentatives = queue.filter((row) => targetMap.has(row.pdbId)).map((row) => row.pdbId).sort(byteCompare);
  ok(canonical(allOtherStrataExistingRepresentatives) === canonical(["7E6U", "8JXS", "8QJ2"]), "The other-strata existing-representative overlap drifted.");
  const otherStrataRowsStillPendingAfterBoundedAudit = queueSummary.sourceOtherPendingEntryCount - exclusions.length;

  const summary = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    recordedAtUtc: "2026-09-04T20:39:00Z",
    reviewedNoDirectSignalEntryCount: noSignalRows.length,
    sourceBackedExcludedEntryCount: exclusions.length,
    sourceBackedAuxiliaryBinderExclusionCount: exclusions.filter((row) => row.dispositionCode === "EXCLUDE_AUXILIARY_BINDER").length,
    sourceBackedNoDirectInterfaceExclusionCount: exclusions.filter((row) => row.dispositionCode === "EXCLUDE_NO_DIRECT_RECEPTOR_VHH_INTERFACE").length,
    existingProvisionalRepresentativeCount: existingRepresentatives.length,
    independentComponentCountIncrementUpperBoundFromReviewedSet: 0,
    otherStrataRowsStillPendingAfterBoundedAudit,
    stillPendingRowsAlreadyNamedInExistingCensus: allOtherStrataExistingRepresentatives,
    stillPendingRowsNotNamedInExistingCensusCount: otherStrataRowsStillPendingAfterBoundedAudit - allOtherStrataExistingRepresentatives.length,
    masterDispositionLedgerRewritten: false,
    wholeCensusTerminalDecisionReached: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
    interpretation: "The seven rows without a direct development-pregraph signal cannot supply a new independent component: five are source-backed exclusions and two are already the named representatives of existing provisional components. This closes the highest-priority component-search subset only. After the five exclusions, 238 other-strata rows remain pending; three are named representatives of existing provisional components and 235 are not.",
  };
  ok(summary.sourceBackedAuxiliaryBinderExclusionCount === 4 && summary.sourceBackedNoDirectInterfaceExclusionCount === 1, "The exclusion-reason counts drifted.");
  ok(summary.otherStrataRowsStillPendingAfterBoundedAudit === 238 && summary.stillPendingRowsNotNamedInExistingCensusCount === 235, "The remaining other-strata review count drifted.");

  const exclusionBytes = Buffer.from(jsonl(exclusions));
  const representativeBytes = Buffer.from(jsonl(existingRepresentatives));
  const summaryBytes = Buffer.from(pretty(summary));
  const manifest = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    generatorScript: path.relative(root, HERE),
    generatorScriptSha256: sha256(await readFile(HERE)),
    inputDigests: Object.fromEntries(INPUT_RELS.map((relative) => [relative, loaded.get(relative).sha256])),
    evidenceBoundary: "Public primary-paper text and frozen public metadata only; no coordinate-derived interface inference.",
    outputDigests: {
      "source-backed-exclusions.jsonl": sha256(exclusionBytes),
      "existing-representative-accounting.jsonl": sha256(representativeBytes),
      "summary.json": sha256(summaryBytes),
    },
    partialAuditOnly: true,
    masterDispositionLedgerRewritten: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
  };
  const readme = [
    "# ConfoVHH hard-decoy v3 no-direct-signal role audit",
    "",
    `Status: **${STATUS}**`,
    "",
    "This bounded public-source audit resolves the seven entries prioritized because they lacked a direct development-pregraph signal. It uses primary-paper text and frozen public metadata, not native coordinates.",
    "",
    "## Result",
    "",
    "Five entries are excluded from direct receptor-VHH benchmarking: 8JRU and 8JRV use the arrestin-complex stabilizer Nb32; 8XGR and 9AXF use Nb35-family G-protein-complex stabilizers; and 7E6T contains TNCA-bound CaSR without a VHH polymer. The remaining two entries, 7E6U and 8QJ2, are already named representatives in the seven-group provisional census and therefore add no component.",
    "",
    "Accordingly, the independent-component increment from this seven-entry set is zero. This is not a whole-census terminal result: after the five source-backed exclusions, 238 other-strata rows remain pending. Three of those are named representatives of existing provisional components, leaving 235 rows not already named in that census. The master disposition ledger is not rewritten by this partial package.",
    "",
    "Target freeze and execution remain forbidden. No native coordinates, native interfaces, prediction outputs, holdout labels, or ConfoVHH performance results were accessed.",
    "",
  ].join("\n");
  const files = {
    "README.md": readme,
    "source-backed-exclusions.jsonl": exclusionBytes.toString(),
    "existing-representative-accounting.jsonl": representativeBytes.toString(),
    "summary.json": summaryBytes.toString(),
    "manifest.json": pretty(manifest),
  };
  Object.entries(files).forEach(([name, text]) => clean(name, text));
  return { exclusions, existingRepresentatives, files, manifest, summary };
}

function checksumsFor(files) {
  return `${Object.keys(files).sort(byteCompare).map((name) => `${sha256(Buffer.from(files[name]))}  ${name}`).join("\n")}\n`;
}

export async function writeNoDirectSignalRoleAudit(repositoryRoot = ROOT, outputDirectory = path.join(repositoryRoot, OUTPUT_REL)) {
  const built = await buildNoDirectSignalRoleAudit(repositoryRoot);
  await mkdir(outputDirectory, { recursive: true });
  for (const [name, text] of Object.entries(built.files)) await writeFile(path.join(outputDirectory, name), text);
  await writeFile(path.join(outputDirectory, "checksums.sha256"), checksumsFor(built.files));
  return { output: outputDirectory, ...built };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const result = await writeNoDirectSignalRoleAudit();
  process.stdout.write(`${JSON.stringify(result.summary)}\n`);
}
