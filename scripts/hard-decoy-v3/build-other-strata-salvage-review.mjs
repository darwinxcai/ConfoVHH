import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const OUTPUT_REL = "validation/hard-decoy-holdout-v3/other-strata-salvage-review-2026-09-04";
const INPUT_RELS = [
  "HARD_DECOY_PROTOCOL_V3.md",
  "validation/hard-decoy-holdout-v2/prelabel-census/target-census.jsonl",
  "validation/hard-decoy-holdout-v3/disposition-seed-2026-08-29/entry-dispositions.jsonl",
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/entries.jsonl",
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/triage-signals.jsonl",
  "validation/hard-decoy-holdout-v3/prelabel-viability-review-2026-09-04/candidate-review-queue.jsonl",
  "validation/hard-decoy-holdout-v3/exact-evidence-pregraph-2026-08-29/candidate-development-evidence.jsonl",
  "validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29/candidate-development-vhh-matrix.jsonl",
  "validation/hard-decoy-holdout-v3/receptor-tm-pregraph-2026-08-30/receptor-pair-matrix.jsonl",
];
const STATUS = "OTHER_STRATA_SALVAGE_REVIEW_QUEUED_NO_DISPOSITIONS_ASSIGNED";
const PDB_ID = /^[0-9][A-Z0-9]{3}$/u;
const COORDINATES = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const OBSERVED_LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;
const SIGNAL_SPECS = [
  {
    relative: INPUT_RELS[6],
    flag: "definitePregraphEdge",
    type: "DEFINITE_METADATA_IDENTITY",
  },
  {
    relative: INPUT_RELS[7],
    flag: "possibleMetadataSequenceLeakageEdge",
    type: "POSSIBLE_VHH_SEQUENCE_EDGE_ROLE_UNRESOLVED",
  },
  {
    relative: INPUT_RELS[8],
    flag: "possiblePrimaryReceptorSequenceLeakageEdge",
    type: "POSSIBLE_RECEPTOR_TM_SEQUENCE_EDGE",
  },
];
const SELECTION_ORDER = new Map([
  ["NO_AUXILIARY_LEXICAL_ENTITY_VHH_PRESENT_CONSTRUCT_SIGNAL_ABSENT", 0],
  ["EXTRA_UNFLAGGED_VHH_LIKE_ENTITY_BEYOND_AUXILIARY_SIGNAL", 1],
  ["NO_AUXILIARY_LEXICAL_ENTITY_VHH_PRESENT_CONSTRUCT_SIGNAL_PRESENT", 2],
  ["NO_VHH_LIKE_POLYMER_ENTITY_SIGNAL", 3],
]);

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

function pretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonl(rows) {
  return rows.length ? `${rows.map(canonical).join("\n")}\n` : "";
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
    ok(PDB_ID.test(row?.pdbId ?? ""), `${label} contains an invalid PDB ID.`);
    ok(!result.has(row.pdbId), `${label} contains duplicate PDB ID ${row.pdbId}.`);
    result.set(row.pdbId, row);
  }
  return result;
}

function nodePdbId(node, prefix) {
  const match = new RegExp(`^${prefix}:([0-9][A-Z0-9]{3})$`, "u").exec(node ?? "");
  return match?.[1] ?? null;
}

function selectionBasis(triage) {
  const auxiliaryIds = new Set(triage.auxiliaryLexicalEntityIds ?? []);
  const vhhIds = triage.vhhLikeEntityIds ?? [];
  if (vhhIds.length === 0) return "NO_VHH_LIKE_POLYMER_ENTITY_SIGNAL";
  if (auxiliaryIds.size > 0 && vhhIds.some((id) => !auxiliaryIds.has(id))) {
    return "EXTRA_UNFLAGGED_VHH_LIKE_ENTITY_BEYOND_AUXILIARY_SIGNAL";
  }
  ok(auxiliaryIds.size === 0, `${triage.pdbId} has no conservative salvage-selection basis.`);
  return (triage.constructRiskEntityIds ?? []).length > 0
    ? "NO_AUXILIARY_LEXICAL_ENTITY_VHH_PRESENT_CONSTRUCT_SIGNAL_PRESENT"
    : "NO_AUXILIARY_LEXICAL_ENTITY_VHH_PRESENT_CONSTRUCT_SIGNAL_ABSENT";
}

function uniprotAccessions(entity) {
  return uniqueStrings((entity?.referenceSequences ?? [])
    .filter((reference) => /uniprot/iu.test(reference.databaseName ?? ""))
    .map((reference) => reference.databaseAccession));
}

function selectedReceptor(entry, triage) {
  const ids = triage.preferredReceptorAuthChainEntityIds ?? [];
  if (ids.length !== 1) return null;
  return (entry.polymerEntities ?? []).find((entity) => entity.entityId === ids[0]) ?? null;
}

function buildSignals(loaded) {
  const byPdb = new Map();
  for (const spec of SIGNAL_SPECS) {
    for (const row of parseJsonl(loaded.get(spec.relative).text, spec.relative)) {
      if (row[spec.flag] !== true) continue;
      const candidateId = nodePdbId(row.nodeA, "candidate") ?? nodePdbId(row.nodeB, "candidate");
      const developmentId = nodePdbId(row.nodeA, "development") ?? nodePdbId(row.nodeB, "development");
      if (!candidateId || !developmentId) continue;
      if (!byPdb.has(candidateId)) byPdb.set(candidateId, new Map());
      const key = `${spec.type}|${developmentId}`;
      if (!byPdb.get(candidateId).has(key)) {
        byPdb.get(candidateId).set(key, {
          evidenceType: spec.type,
          developmentNode: `development:${developmentId}`,
          sourcePairIds: [],
          formalLeakageAuthority: false,
        });
      }
      byPdb.get(candidateId).get(key).sourcePairIds.push(row.pairId);
    }
  }
  return new Map([...byPdb].map(([pdbId, signals]) => [
    pdbId,
    [...signals.values()].map((row) => ({ ...row, sourcePairIds: uniqueStrings(row.sourcePairIds) }))
      .sort((left, right) => byteCompare(`${left.evidenceType}|${left.developmentNode}`, `${right.evidenceType}|${right.developmentNode}`)),
  ]));
}

function priorityClass(hasSignal, namedInCensus) {
  if (!hasSignal && !namedInCensus) return "NO_DIRECT_DEVELOPMENT_PREGRAPH_SIGNAL_NOT_IN_EXISTING_CENSUS";
  if (!hasSignal) return "NO_DIRECT_DEVELOPMENT_PREGRAPH_SIGNAL_EXISTING_CENSUS_REPRESENTATIVE";
  if (!namedInCensus) return "DIRECT_DEVELOPMENT_PREGRAPH_SIGNAL_NOT_IN_EXISTING_CENSUS";
  return "DIRECT_DEVELOPMENT_PREGRAPH_SIGNAL_EXISTING_CENSUS_REPRESENTATIVE";
}

function priorityRank(row) {
  const classes = new Map([
    ["NO_DIRECT_DEVELOPMENT_PREGRAPH_SIGNAL_NOT_IN_EXISTING_CENSUS", 0],
    ["NO_DIRECT_DEVELOPMENT_PREGRAPH_SIGNAL_EXISTING_CENSUS_REPRESENTATIVE", 1],
    ["DIRECT_DEVELOPMENT_PREGRAPH_SIGNAL_NOT_IN_EXISTING_CENSUS", 2],
    ["DIRECT_DEVELOPMENT_PREGRAPH_SIGNAL_EXISTING_CENSUS_REPRESENTATIVE", 3],
  ]);
  return [classes.get(row.priorityClass), SELECTION_ORDER.get(row.selectionBasis), row.pdbId];
}

function comparePriority(left, right) {
  const a = priorityRank(left);
  const b = priorityRank(right);
  return a[0] - b[0] || a[1] - b[1] || byteCompare(a[2], b[2]);
}

export async function buildOtherStrataSalvageReview(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const loaded = new Map();
  for (const relative of INPUT_RELS) loaded.set(relative, await readBound(root, relative, relative));
  const protocol = loaded.get(INPUT_RELS[0]).text;
  ok(/at least\s+ten/u.test(protocol) && /Fewer than ten terminates this\s+protocol version/u.test(protocol), "The minimum-component rule drifted.");

  const targetCensus = parseJsonl(loaded.get(INPUT_RELS[1]).text, INPUT_RELS[1]);
  const dispositions = parseJsonl(loaded.get(INPUT_RELS[2]).text, INPUT_RELS[2]);
  const entries = parseJsonl(loaded.get(INPUT_RELS[3]).text, INPUT_RELS[3]);
  const triage = parseJsonl(loaded.get(INPUT_RELS[4]).text, INPUT_RELS[4]);
  const directQueue = parseJsonl(loaded.get(INPUT_RELS[5]).text, INPUT_RELS[5]);
  const entryMap = mapByPdb(entries, "entry metadata");
  mapByPdb(triage, "triage metadata");
  ok(entries.length === 287 && triage.length === 287 && dispositions.length === 287, "The frozen 287-entry census drifted.");

  const pendingIds = new Set(dispositions.filter((row) => row.dispositionCode === "PENDING_REQUIRED_METADATA").map((row) => row.pdbId));
  const directQueueIds = new Set(directQueue.map((row) => row.pdbId));
  const namedCensusIds = new Set(targetCensus.map((row) => row.pdbId));
  const otherPending = triage.filter((row) => pendingIds.has(row.pdbId) && !directQueueIds.has(row.pdbId));
  ok(otherPending.length === 243, "The other pending stratum must contain 243 entries.");

  const selectedTriage = otherPending.filter((row) => {
    const auxiliaryIds = new Set(row.auxiliaryLexicalEntityIds ?? []);
    return auxiliaryIds.size === 0 || (row.vhhLikeEntityIds ?? []).some((id) => !auxiliaryIds.has(id));
  });
  ok(selectedTriage.length === 31, "The conservative salvage-selection rule must surface 31 entries.");
  const selectedIds = new Set(selectedTriage.map((row) => row.pdbId));
  const signalsByPdb = buildSignals(loaded);

  let queue = selectedTriage.map((triageRow) => {
    const entry = entryMap.get(triageRow.pdbId);
    const receptor = selectedReceptor(entry, triageRow);
    const auxiliaryIds = new Set(triageRow.auxiliaryLexicalEntityIds ?? []);
    const signals = signalsByPdb.get(triageRow.pdbId) ?? [];
    const namedInExistingProvisionalCensus = namedCensusIds.has(triageRow.pdbId);
    const basis = selectionBasis(triageRow);
    return {
      pdbId: triageRow.pdbId,
      reviewPriority: null,
      priorityClass: priorityClass(signals.length > 0, namedInExistingProvisionalCensus),
      selectionBasis: basis,
      selectionInterpretation: "Selected for source-backed review because frozen metadata does not lexically classify every apparent VHH-like entity as auxiliary, or because no VHH-like entity was identified. This is neither eligibility evidence nor an exclusion decision.",
      title: entry.title ?? null,
      releaseDate: entry.releaseDate ?? null,
      receptor: {
        gpcrdbProtein: entry.gpcrdb?.protein ?? null,
        selectedEntityId: receptor?.entityId ?? null,
        description: receptor?.description ?? null,
        uniprotAccessions: uniprotAccessions(receptor),
        constructSequenceSha256: receptor?.sequenceSha256 ?? null,
      },
      apparentVhhCandidates: (entry.polymerEntities ?? [])
        .filter((entity) => (triageRow.vhhLikeEntityIds ?? []).includes(entity.entityId))
        .map((entity) => ({
          entityId: entity.entityId,
          description: entity.description ?? null,
          sequenceLength: entity.sequenceLength ?? null,
          sequenceSha256: entity.sequenceSha256 ?? null,
          auxiliaryLexicalSignal: auxiliaryIds.has(entity.entityId),
        }))
        .sort((left, right) => byteCompare(left.entityId, right.entityId)),
      metadataSignals: {
        sourceReviewStratum: triageRow.reviewStratum,
        reasons: uniqueStrings(triageRow.reasons ?? []),
        auxiliaryLexicalEntityIds: uniqueStrings(triageRow.auxiliaryLexicalEntityIds ?? []),
        constructRiskEntityIds: uniqueStrings(triageRow.constructRiskEntityIds ?? []),
      },
      directDevelopmentPregraphSignalPresent: signals.length > 0,
      directDevelopmentPregraphSignals: signals,
      namedInExistingProvisionalCensus,
      publication: {
        doi: entry.primaryCitation?.doi ?? null,
        pmid: entry.primaryCitation?.pmid ?? null,
        title: entry.primaryCitation?.title ?? null,
      },
      requiredAdjudications: [
        "direct receptor-VHH role and interface from public source evidence",
        "construct, fusion, and auxiliary-binder status",
        "VHH parent and variant provenance",
        "formal receptor and VHH sequence-edge authority",
        "primary-publication identity and cross-entry linkage",
        "sealed native-epitope oracle after all pre-oracle gates pass",
      ],
      evidenceUrls: uniqueStrings([
        `https://www.rcsb.org/structure/${triageRow.pdbId}`,
        entry.primaryCitation?.doi ? `https://doi.org/${entry.primaryCitation.doi}` : null,
        entry.primaryCitation?.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${entry.primaryCitation.pmid}/` : null,
      ]),
      formalDisposition: "PENDING_REQUIRED_METADATA",
      lexicalSignalMayAutoExclude: false,
      absenceOfLexicalSignalEstablishesEligibility: false,
      pregraphSignalMayAutoExclude: false,
      automaticTargetPromotionPermitted: false,
      targetFreezePermitted: false,
      nativeCoordinatesInspected: false,
    };
  });
  queue = queue.sort(comparePriority).map((row, index) => ({ ...row, reviewPriority: index + 1 }));

  const remainder = otherPending.filter((row) => !selectedIds.has(row.pdbId));
  ok(remainder.length === 212, "The unselected other-pending remainder must contain 212 entries.");
  ok(remainder.every((row) => (row.auxiliaryLexicalEntityIds ?? []).length > 0 && (row.vhhLikeEntityIds ?? []).every((id) => row.auxiliaryLexicalEntityIds.includes(id))), "The remainder does not match the conservative selection complement.");

  const directSignalRows = queue.filter((row) => row.directDevelopmentPregraphSignalPresent);
  const noDirectSignalRows = queue.filter((row) => !row.directDevelopmentPregraphSignalPresent);
  const selectionCounts = Object.fromEntries([...SELECTION_ORDER.keys()].map((key) => [key, queue.filter((row) => row.selectionBasis === key).length]));
  const summary = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    recordedAtUtc: "2026-09-04T20:39:00Z",
    sourceOtherPendingEntryCount: otherPending.length,
    selectedForSalvageReviewCount: queue.length,
    unselectedStillPendingCount: remainder.length,
    selectionCounts,
    directDevelopmentPregraphSignalCount: directSignalRows.length,
    noDirectDevelopmentPregraphSignalCount: noDirectSignalRows.length,
    noDirectDevelopmentPregraphSignalIds: noDirectSignalRows.map((row) => row.pdbId),
    selectedExistingProvisionalCensusRepresentatives: queue.filter((row) => row.namedInExistingProvisionalCensus).map((row) => row.pdbId).sort(byteCompare),
    selectionIsEligibilityDecision: false,
    lexicalSignalsAreFormalExclusionAuthority: false,
    pregraphSignalsAreFormalLeakageAuthority: false,
    formalDispositionsAssigned: false,
    wholeCensusTerminalDecisionReached: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
    interpretation: "Thirty-one rows are the most conservative first-pass review set outside the direct-looking queue: frozen metadata either leaves at least one apparent VHH-like entity without an auxiliary lexical signal or identifies no VHH-like entity. Twenty-four already have a one-hop review-only pregraph signal to development; seven do not. The other 212 rows remain pending because lexical auxiliary signals alone cannot assign scientific dispositions.",
  };
  ok(directSignalRows.length === 24 && noDirectSignalRows.length === 7, "The direct-signal partition drifted.");
  ok(canonical(summary.noDirectDevelopmentPregraphSignalIds) === canonical(["8JRU", "8JRV", "8XGR", "9AXF", "7E6T", "8QJ2", "7E6U"]), "The no-direct-signal priority set drifted.");
  ok(canonical(summary.selectedExistingProvisionalCensusRepresentatives) === canonical(["7E6U", "8JXS", "8QJ2"]), "The existing-census overlap drifted.");
  ok(canonical(selectionCounts) === canonical({
    NO_VHH_LIKE_POLYMER_ENTITY_SIGNAL: 5,
    EXTRA_UNFLAGGED_VHH_LIKE_ENTITY_BEYOND_AUXILIARY_SIGNAL: 4,
    NO_AUXILIARY_LEXICAL_ENTITY_VHH_PRESENT_CONSTRUCT_SIGNAL_ABSENT: 7,
    NO_AUXILIARY_LEXICAL_ENTITY_VHH_PRESENT_CONSTRUCT_SIGNAL_PRESENT: 15,
  }), "The selection-basis partition drifted.");
  ok(queue.every((row, index) => row.reviewPriority === index + 1 && row.formalDisposition === "PENDING_REQUIRED_METADATA"), "The queue assigned an unauthorized disposition or unstable priority.");

  const queueBytes = Buffer.from(jsonl(queue));
  const remainderBytes = Buffer.from(jsonl(remainder.map((row) => ({
    pdbId: row.pdbId,
    reasonNotInFirstPassQueue: "ALL_APPARENT_VHH_LIKE_ENTITIES_HAVE_AUXILIARY_LEXICAL_SIGNALS",
    formalDisposition: "PENDING_REQUIRED_METADATA",
    lexicalSignalMayAutoExclude: false,
    sourceBackedReviewStillRequired: true,
    nativeCoordinatesInspected: false,
  })).sort((left, right) => byteCompare(left.pdbId, right.pdbId))));
  const summaryBytes = Buffer.from(pretty(summary));
  const manifest = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    generatorScript: path.relative(root, HERE),
    generatorScriptSha256: sha256(await readFile(HERE)),
    inputDigests: Object.fromEntries(INPUT_RELS.map((relative) => [relative, loaded.get(relative).sha256])),
    selectionRule: "Pending rows outside the 29-entry direct-looking queue for which no auxiliary lexical entity was identified, or at least one VHH-like entity was not among the auxiliary lexical entities.",
    complementRule: "All apparent VHH-like entities have auxiliary lexical signals; rows remain pending and require source-backed review.",
    reviewPriorityRule: "No direct development-pregraph signal before direct signal; rows not named in the existing provisional census before named representatives; then selection-basis order; then bytewise PDB ID.",
    outputDigests: {
      "salvage-review-queue.jsonl": sha256(queueBytes),
      "unselected-still-pending.jsonl": sha256(remainderBytes),
      "summary.json": sha256(summaryBytes),
    },
    formalDispositionsAssigned: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
  };
  const readme = [
    "# ConfoVHH hard-decoy v3 other-strata salvage review",
    "",
    `Status: **${STATUS}**`,
    "",
    "This deterministic package prioritizes source-backed review among the 243 still-pending rows outside the earlier 29-entry direct-looking queue. It does not assign eligibility, leakage, or auxiliary-binder dispositions.",
    "",
    "## First-pass queue",
    "",
    "The conservative metadata rule surfaces 31 rows: 26 have at least one apparent VHH-like entity not lexically flagged as auxiliary, and five have no identified VHH-like entity and therefore need metadata resolution. Of these 31, 24 have at least one direct review-only pregraph signal to development and seven do not.",
    "",
    `The seven without a direct development-pregraph signal are: ${summary.noDirectDevelopmentPregraphSignalIds.join(", ")}. They are review priorities, not independent-component claims.`,
    "",
    "## Guardrail",
    "",
    "The 212 rows outside this first-pass queue remain `PENDING_REQUIRED_METADATA`. Their apparent VHH-like entities all carry auxiliary lexical signals, but keyword matches are not formal exclusion authority. Source-backed direct-interface and role review remains required before any disposition changes.",
    "",
    "No native coordinates, native interface residues, prediction outputs, holdout labels, or ConfoVHH performance results were accessed. Target freeze and execution remain forbidden.",
    "",
  ].join("\n");
  const files = {
    "README.md": readme,
    "salvage-review-queue.jsonl": queueBytes.toString(),
    "unselected-still-pending.jsonl": remainderBytes.toString(),
    "summary.json": summaryBytes.toString(),
    "manifest.json": pretty(manifest),
  };
  Object.entries(files).forEach(([name, text]) => clean(name, text));
  return { files, manifest, queue, summary };
}

function checksumsFor(files) {
  return `${Object.keys(files).sort(byteCompare).map((name) => `${sha256(Buffer.from(files[name]))}  ${name}`).join("\n")}\n`;
}

export async function writeOtherStrataSalvageReview(repositoryRoot = ROOT, outputDirectory = path.join(repositoryRoot, OUTPUT_REL)) {
  const built = await buildOtherStrataSalvageReview(repositoryRoot);
  await mkdir(outputDirectory, { recursive: true });
  for (const [name, text] of Object.entries(built.files)) await writeFile(path.join(outputDirectory, name), text);
  await writeFile(path.join(outputDirectory, "checksums.sha256"), checksumsFor(built.files));
  return { output: outputDirectory, ...built };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const result = await writeOtherStrataSalvageReview();
  process.stdout.write(`${JSON.stringify(result.summary)}\n`);
}
