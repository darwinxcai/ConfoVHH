import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const OUTPUT_REL = "validation/hard-decoy-holdout-v3/auxiliary-remainder-bound-2026-09-04";
const INPUT_RELS = [
  "HARD_DECOY_PROTOCOL_V3.md",
  "validation/hard-decoy-holdout-v3/CENSUS_RECONSTRUCTION_PLAN.md",
  "validation/hard-decoy-holdout-v3/prelabel-census-draft/disposition-contract.json",
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/entries.jsonl",
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/triage-signals.jsonl",
  "validation/hard-decoy-holdout-v3/other-strata-salvage-review-2026-09-04/unselected-still-pending.jsonl",
  "validation/hard-decoy-holdout-v3/direct-signal-salvage-bound-2026-09-04/summary.json",
];
const STATUS = "AUXILIARY_REMAINDER_TRIAGED_SOURCE_REVIEW_REQUIRED";
const PDB_ID = /^[0-9][A-Z0-9]{3}$/u;
const COORDINATES = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const OBSERVED_LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;

const ROLE_AUTHORITIES = [
  {
    roleClass: "NB35_G_PROTEIN_STABILIZER",
    sourceTitle: "Crystal structure of the beta2 adrenergic receptor-Gs protein complex",
    doi: "10.1038/nature10361",
    pmid: "21772288",
    evidenceClassification: "PRIMARY_SOURCE_G_ALPHA_G_BETA_INTERFACE_CRYSTALLIZATION_AID",
    evidenceBasis: "The primary paper identifies Nb35 as a crystallization aid that binds between the G-alpha and G-beta subunits of Gs, not as a direct receptor-binding VHH.",
    evidenceUrls: [
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC3184188/",
      "https://pubmed.ncbi.nlm.nih.gov/21772288/",
    ],
  },
  {
    roleClass: "SCFV16_G_PROTEIN_STABILIZER",
    sourceTitle: "Development of an antibody fragment that stabilizes GPCR/G-protein complexes",
    doi: "10.1038/s41467-018-06002-w",
    pmid: "30213947",
    evidenceClassification: "PRIMARY_SOURCE_G_ALPHA_G_BETA_GAMMA_INTERFACE_STABILIZER",
    evidenceBasis: "The primary paper identifies mAb16 and its scFv16 fragment as recognizing the heterotrimeric G-alpha/G-beta-gamma interface and stabilizing GPCR-G-protein complexes for structure determination.",
    evidenceUrls: [
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC6137068/",
      "https://pubmed.ncbi.nlm.nih.gov/30213947/",
    ],
  },
  {
    roleClass: "ANTI_FAB_FIDUCIAL_NANOBODY",
    sourceTitle: "Development of a universal nanobody-binding Fab module for fiducial-assisted cryo-EM studies of membrane proteins",
    doi: "10.1073/pnas.2115435118",
    pmid: "34782475",
    evidenceClassification: "PRIMARY_SOURCE_FAB_ELBOW_BINDER_AND_FIDUCIAL",
    evidenceBasis: "The primary paper identifies the anti-Fab nanobody as binding the Fab elbow linker, reducing Fab flexibility, and adding a fiducial feature for particle alignment.",
    evidenceUrls: [
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC8617411/",
      "https://pubmed.ncbi.nlm.nih.gov/34782475/",
    ],
  },
];

const ROLE_BY_DESCRIPTION = new Map([
  ...[
    "Camelid antibody fragment - nanobody 35",
    "Camelid antibody VHH fragment - nanobody 35",
    "Camelid antibody VHH fragment Nb35",
    "nanobody 35",
    "Nanobody 35",
    "NanoBody 35",
    "NANOBODY 35",
    "Nanobody 35|Lama glama",
    "nanobody Nb35",
    "Nanobody Nb35",
    "Nanobody-35",
    "Nb35 nanobody",
  ].map((description) => [description, "NB35_G_PROTEIN_STABILIZER"]),
  ["ScFv16 nanobody", "SCFV16_G_PROTEIN_STABILIZER"],
  ...[
    "anti-BRIL Fab Nanobody",
    "anti-Fab nanobody",
    "anti-Fab Nanobody",
    "Anti-Fab nanobody",
  ].map((description) => [description, "ANTI_FAB_FIDUCIAL_NANOBODY"]),
]);

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

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
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

function companionEvidence(entry, roleClass) {
  const entities = entry.polymerEntities ?? [];
  const descriptions = entities.map((entity) => entity.description ?? "");
  if (roleClass === "ANTI_FAB_FIDUCIAL_NANOBODY") {
    const fabHeavy = entities.filter((entity) => /fab.*heavy|heavy.*fab/iu.test(entity.description ?? "")).map((entity) => entity.entityId).sort(byteCompare);
    const fabLight = entities.filter((entity) => /fab.*light|light.*fab/iu.test(entity.description ?? "")).map((entity) => entity.entityId).sort(byteCompare);
    ok(fabHeavy.length > 0 && fabLight.length > 0, `${entry.pdbId} anti-Fab role lacks frozen Fab heavy/light companions.`);
    return { companionClass: "FAB_HEAVY_AND_LIGHT_ENTITIES", fabHeavyEntityIds: fabHeavy, fabLightEntityIds: fabLight };
  }
  const gAlpha = entities.filter((entity) => /(?:subunit alpha|alpha subunit|mini\s*-?g|gnas|g[- ]?alpha|guanine nucleotide-binding protein g(?:s|q|i|o)\b)/iu.test(entity.description ?? "")).map((entity) => entity.entityId).sort(byteCompare);
  const gBeta = entities.filter((entity) => /(?:subunit beta|g[- ]?protein beta)/iu.test(entity.description ?? "")).map((entity) => entity.entityId).sort(byteCompare);
  ok(gAlpha.length > 0 && gBeta.length > 0, `${entry.pdbId} G-protein stabilizer lacks frozen G-alpha/G-beta companions: ${descriptions.join(" | ")}`);
  return { companionClass: "G_ALPHA_AND_G_BETA_ENTITIES", gAlphaEntityIds: gAlpha, gBetaEntityIds: gBeta };
}

function additionalAntibodyLikeEvidence(entry, primaryVhhEntityId) {
  const antibodyLike = (entry.polymerEntities ?? []).filter((entity) => entity.entityId !== primaryVhhEntityId
    && /nanobody|vhh|scfv|single-chain variable|camelid|megabody|antibody|\bfab\b/iu.test(entity.description ?? ""));
  return antibodyLike.map((entity) => {
    const description = entity.description ?? "";
    if (/scfv16|single-chain variable fragment 16/iu.test(description)) {
      return {
        entityId: entity.entityId,
        description,
        sequenceLength: entity.sequenceLength ?? null,
        sequenceSha256: entity.sequenceSha256 ?? null,
        classification: "ADDITIONAL_SCFV16_G_PROTEIN_STABILIZER",
        formalRoleAssignment: false,
      };
    }
    ok(/fab.*(?:heavy|light)|(?:heavy|light).*fab/iu.test(description), `${entry.pdbId} contains an unreviewed additional antibody-like entity: ${description}`);
    return {
      entityId: entity.entityId,
      description,
      sequenceLength: entity.sequenceLength ?? null,
      sequenceSha256: entity.sequenceSha256 ?? null,
      classification: "FAB_CHAIN_NOT_VHH",
      formalRoleAssignment: false,
    };
  }).sort((left, right) => byteCompare(left.entityId, right.entityId));
}

function authorityMap() {
  return new Map(ROLE_AUTHORITIES.map((authority) => [authority.roleClass, authority]));
}

export async function buildAuxiliaryRemainderBound(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const loaded = new Map();
  for (const relative of INPUT_RELS) loaded.set(relative, await readBound(root, relative, relative));
  const protocol = loaded.get(INPUT_RELS[0]).text;
  const reconstructionPlan = loaded.get(INPUT_RELS[1]).text;
  ok(/The primary holdout requires an exact frozen set of \*\*at least ten\*\*/u.test(protocol), "The minimum-component rule drifted.");
  ok(/Exclude auxiliary G-protein nanobodies, anti-BRIL\/anti-Fab binders/u.test(protocol), "The auxiliary-binder exclusion rule drifted.");
  ok(/completed census still yields fewer than 10 formally cleared independent groups[\s\S]*TARGET_CENSUS_BLOCKED/u.test(reconstructionPlan), "The completed-census terminal rule drifted.");
  ok(reconstructionPlan.includes("The four-term search is known to be incomplete"), "The non-exhaustive discovery boundary drifted.");

  const contract = parseJson(loaded.get(INPUT_RELS[2]).text, INPUT_RELS[2]);
  ok(Object.hasOwn(contract.dispositionCodes, "EXCLUDE_AUXILIARY_BINDER"), "The auxiliary-binder disposition is absent from the frozen contract.");
  const entries = parseJsonl(loaded.get(INPUT_RELS[3]).text, INPUT_RELS[3]);
  const triageRows = parseJsonl(loaded.get(INPUT_RELS[4]).text, INPUT_RELS[4]);
  const remainder = parseJsonl(loaded.get(INPUT_RELS[5]).text, INPUT_RELS[5]);
  const priorBound = parseJson(loaded.get(INPUT_RELS[6]).text, INPUT_RELS[6]);
  const entryMap = mapByPdb(entries, "entry metadata");
  const triageMap = mapByPdb(triageRows, "triage metadata");
  mapByPdb(remainder, "unselected remainder");
  ok(entries.length === 287 && triageRows.length === 287, "The frozen candidate universe drifted.");
  ok(remainder.length === 212 && priorBound.unselectedOtherRowsStillOpenForComponentSearch === 212, "The 212-row remainder drifted.");
  ok(priorBound.prioritizedFrontierUpperBound === 8 && priorBound.requiredIndependentComponentCount === 10, "The prior frontier bound drifted.");

  const authorities = authorityMap();
  const mappings = remainder.map((remainderRow) => {
    ok(remainderRow.formalDisposition === "PENDING_REQUIRED_METADATA" && remainderRow.sourceBackedReviewStillRequired === true, `${remainderRow.pdbId} is not an unresolved remainder row.`);
    const entry = entryMap.get(remainderRow.pdbId);
    const triage = triageMap.get(remainderRow.pdbId);
    ok(entry && triage, `${remainderRow.pdbId} is absent from frozen metadata.`);
    const vhhIds = triage.vhhLikeEntityIds ?? [];
    const auxiliaryIds = new Set(triage.auxiliaryLexicalEntityIds ?? []);
    ok(vhhIds.length === 1 && auxiliaryIds.size > 0 && auxiliaryIds.has(vhhIds[0]), `${remainderRow.pdbId} does not contain exactly one auxiliary-marked VHH-like entity.`);
    const entity = (entry.polymerEntities ?? []).find((candidate) => candidate.entityId === vhhIds[0]);
    ok(entity, `${remainderRow.pdbId} auxiliary VHH-like entity is missing.`);
    ok(typeof entity.sequence === "string" && entity.sequence.length === entity.sequenceLength && sha256(entity.sequence) === entity.sequenceSha256, `${remainderRow.pdbId} frozen auxiliary sequence/hash mismatch.`);
    const roleClass = ROLE_BY_DESCRIPTION.get(entity.description ?? "");
    ok(roleClass && authorities.has(roleClass), `${remainderRow.pdbId} has an unrecognized auxiliary descriptor: ${entity.description ?? "<missing>"}`);
    const authority = authorities.get(roleClass);
    const evidenceUrls = [
      ...authority.evidenceUrls,
      `https://www.rcsb.org/structure/${remainderRow.pdbId}`,
      entry.primaryCitation?.doi ? `https://doi.org/${entry.primaryCitation.doi}` : null,
      entry.primaryCitation?.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${entry.primaryCitation.pmid}/` : null,
    ].filter(Boolean).sort(byteCompare);
    return {
      schemaVersion: "1.1.0",
      studyId: "confovhh-hard-decoy-holdout-v3",
      pdbId: remainderRow.pdbId,
      dispositionCode: "PENDING_REQUIRED_METADATA",
      independentComponentCountIncrementUpperBound: null,
      inferredRoleClass: roleClass,
      formalRoleAssignment: false,
      entrySpecificSourceReviewComplete: false,
      reagentSequenceIdentityVerified: false,
      frozenVhhLikeEntity: {
        entityId: entity.entityId,
        description: entity.description ?? null,
        sequenceLength: entity.sequenceLength ?? null,
        sequenceSha256: entity.sequenceSha256 ?? null,
        soleApparentVhhLikeEntity: true,
        auxiliaryLexicalEntityMatch: true,
      },
      companionEvidence: companionEvidence(entry, roleClass),
      additionalAntibodyLikeEntities: additionalAntibodyLikeEvidence(entry, entity.entityId),
      reagentRoleLiterature: {
        doi: authority.doi,
        pmid: authority.pmid,
        evidenceClassification: authority.evidenceClassification,
        evidenceBasis: authority.evidenceBasis,
      },
      publication: {
        doi: entry.primaryCitation?.doi ?? null,
        pmid: entry.primaryCitation?.pmid ?? null,
        title: entry.primaryCitation?.title ?? null,
      },
      dispositionReason: "The frozen descriptor and companion entities suggest an auxiliary reagent. Reagent-role literature does not establish this entry's binder identity, variant provenance, or direct-interface role. Entry-specific source review is still required.",
      evidenceUrls,
      reagentRoleSourcesReviewed: true,
      nativeCoordinatesInspected: false,
      nativeRelativePoseInspected: false,
      masterDispositionLedgerRewritten: false,
      targetFreezePermitted: false,
    };
  }).sort((left, right) => byteCompare(left.pdbId, right.pdbId));

  const roleCounts = Object.fromEntries([...authorities.keys()].map((roleClass) => [roleClass, mappings.filter((row) => row.inferredRoleClass === roleClass).length]));
  ok(canonical(roleCounts) === canonical({
    NB35_G_PROTEIN_STABILIZER: 196,
    SCFV16_G_PROTEIN_STABILIZER: 3,
    ANTI_FAB_FIDUCIAL_NANOBODY: 13,
  }), "The auxiliary role partition drifted.");
  ok(mappings.length === 212 && mappings.every((row) => row.dispositionCode === "PENDING_REQUIRED_METADATA" && row.independentComponentCountIncrementUpperBound === null), "Metadata-only triage gained disposition authority.");
  const additionalAntibodyLikeEntities = mappings.flatMap((row) => row.additionalAntibodyLikeEntities);
  const additionalScfv16EntityCount = additionalAntibodyLikeEntities.filter((entity) => entity.classification === "ADDITIONAL_SCFV16_G_PROTEIN_STABILIZER").length;
  const additionalFabChainEntityCount = additionalAntibodyLikeEntities.filter((entity) => entity.classification === "FAB_CHAIN_NOT_VHH").length;
  ok(additionalAntibodyLikeEntities.length === 44 && additionalScfv16EntityCount === 16 && additionalFabChainEntityCount === 28, "The additional antibody-like entity review drifted.");

  const requiredIndependentComponentCount = priorBound.requiredIndependentComponentCount;
  const sequenceGroups = new Map();
  for (const row of mappings) {
    const key = row.frozenVhhLikeEntity.sequenceSha256;
    ok(/^[a-f0-9]{64}$/u.test(key), `${row.pdbId} lacks a sequence hash.`);
    if (!sequenceGroups.has(key)) sequenceGroups.set(key, { sequenceSha256: key, inferredRoleClass: row.inferredRoleClass, entries: [], identityToEstablishedReagentVerified: false, formalExclusionAuthority: false });
    const group = sequenceGroups.get(key);
    ok(group.inferredRoleClass === row.inferredRoleClass, "An exact sequence carries conflicting role descriptors.");
    group.entries.push({ pdbId: row.pdbId, entityId: row.frozenVhhLikeEntity.entityId });
  }
  const sequenceReviewGroups = [...sequenceGroups.values()].sort((left, right) => byteCompare(left.sequenceSha256, right.sequenceSha256));
  ok(sequenceReviewGroups.length === 29, "Exact-sequence review partition drifted.");
  const summary = {
    schemaVersion: "1.1.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    recordedAtUtc: "2026-09-04T22:00:00Z",
    historicalSubUniverseEntryCount: entries.length,
    broaderDiscoveryComplete: false,
    reviewedAuxiliaryRemainderEntryCount: mappings.length,
    sourceBackedAuxiliaryBinderExclusionCount: 0,
    pendingEntryCount: mappings.length,
    exactSequenceReviewGroupCount: sequenceReviewGroups.length,
    auxiliaryRoleCounts: roleCounts,
    additionalAntibodyLikeEntityCount: additionalAntibodyLikeEntities.length,
    additionalScfv16EntityCount,
    additionalFabChainEntityCount,
    auxiliaryRemainderIndependentComponentIncrementUpperBound: null,
    priorPrioritizedFrontierUpperBound: priorBound.prioritizedFrontierUpperBound,
    wholeCensusComponentUpperBound: null,
    requiredIndependentComponentCount,
    conditionalHistoricalScenario: { ifAll212RowsAreIndependentlyExcluded: true, priorFrontierUpperBound: 8, additionalComponentsNeededOutsideThatFrontier: 2, formalWholeCensusAuthority: false },
    wholeCensusUpperBoundBelowRequiredMinimum: null,
    wholeCensusTerminalDecisionReached: false,
    formalProtocolStatus: "DRAFT",
    targetFreezeGate: "BLOCKED",
    completedCensusCountBound: false,
    absenceOfHiddenVhhEstablished: false,
    masterDispositionLedgerRewritten: false,
    oracleRequestFreezePermitted: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
    interpretation: "The 212 historical remainder rows have descriptors consistent with 196 Nb35, three scFv16, and 13 anti-Fab reagents. This is review triage, not 212 established exclusions. They form 29 exact-sequence review groups. The descriptor scan detects another 16 scFv16-like and 28 Fab-chain-like entities; it cannot rule out a missed VHH. Reagent-role papers do not replace entry-specific identity and role review. Broader candidate discovery is explicitly incomplete, so no whole-census upper bound or terminal v3 decision follows. Formal status remains DRAFT with target freeze BLOCKED.",
  };

  const authorityBytes = Buffer.from(jsonl(ROLE_AUTHORITIES.map((authority) => ({ ...authority, evidenceUrls: [...authority.evidenceUrls].sort(byteCompare) }))));
  const mappingBytes = Buffer.from(jsonl(mappings));
  const sequenceGroupBytes = Buffer.from(jsonl(sequenceReviewGroups));
  const summaryBytes = Buffer.from(pretty(summary));
  const manifest = {
    schemaVersion: "1.1.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    generatorScript: path.relative(root, HERE),
    generatorScriptSha256: sha256(await readFile(HERE)),
    inputDigests: Object.fromEntries(INPUT_RELS.map((relative) => [relative, loaded.get(relative).sha256])),
    evidenceBoundary: "Historical metadata descriptors plus general reagent-role literature only. No entry-specific source adjudication or reagent sequence identity verification is performed.",
    matchingRule: "One VHH-like descriptor per row plus lexical companion context yields only an inferred review class; sequence hashes group review work without propagating exclusions.",
    outputDigests: {
      "role-authorities.jsonl": sha256(authorityBytes),
      "auxiliary-entity-mappings.jsonl": sha256(mappingBytes),
      "sequence-review-groups.jsonl": sha256(sequenceGroupBytes),
      "summary.json": sha256(summaryBytes),
    },
    completedCensusCountBound: false,
    wholeCensusTerminalDecisionReached: false,
    formalRoleAssignment: false,
    broaderDiscoveryComplete: false,
    masterDispositionLedgerRewritten: false,
    oracleRequestFreezePermitted: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
  };
  const readme = [
    "# ConfoVHH hard-decoy v3 auxiliary-remainder bound",
    "",
    `Status: **${STATUS}**`,
    "",
    "This package organizes 212 pending entries from the historical 287-entry sub-universe for source review. It does not close those rows or terminate v3.",
    "",
    "## Entity-level result",
    "",
    "Descriptors and companion-protein names suggest 196 Nb35, three scFv16, and 13 anti-Fab reagents. All 212 remain PENDING_REQUIRED_METADATA. Their hashes partition into 29 exact-sequence groups for efficient identity and variant review. The additional descriptor scan detects 16 scFv16-like entities and 28 Fab-chain-like entities; it does not establish that no other VHH exists.",
    "",
    "## Census consequence",
    "",
    "The earlier eight-component frontier is a bounded prior analysis. Treating it as a whole-census bound requires additional evidence. The reconstruction plan explicitly says the four-term historical search is incomplete. General reagent-role papers plus entity-name matches cannot establish every entry-specific role or close broader discovery. V3 remains DRAFT with target freeze BLOCKED; no terminal decision is reached.",
    "",
    "Correction to local commit 9ef5d5e: its terminal TARGET_CENSUS_BLOCKED conclusion, 212 formal exclusions, and no-hidden-VHH assertion were unsupported and are withdrawn. Passing software tests did not validate those scientific premises. Complete entry-specific source review and the separately archived broader discovery routes before deciding census feasibility.",
    "",
    "A separate [entry-specific follow-on review](../auxiliary-remainder-source-review-2026-09-04/README.md) records primary-source adjudication for 16 rows. This triage snapshot retains its original pending statuses; the follow-on package states exactly which entry assessments it supersedes and which discrepancies remain open.",
    "",
    "No oracle request, target freeze, MSA retrieval, generator run, native coordinate access, pose inspection, DockQ/CAPRI label access, or ConfoVHH performance analysis is authorized.",
    "",
    "Regenerate and verify with:",
    "",
    "```bash",
    "node scripts/hard-decoy-v3/build-auxiliary-remainder-bound.mjs",
    "node --test tests/hard-decoy-v3-auxiliary-remainder-bound.test.mjs",
    "```",
    "",
  ].join("\n");
  const files = {
    "README.md": readme,
    "role-authorities.jsonl": authorityBytes.toString(),
    "auxiliary-entity-mappings.jsonl": mappingBytes.toString(),
    "sequence-review-groups.jsonl": sequenceGroupBytes.toString(),
    "summary.json": summaryBytes.toString(),
    "manifest.json": pretty(manifest),
  };
  Object.entries(files).forEach(([name, text]) => clean(name, text));
  return { authorities: ROLE_AUTHORITIES, mappings, sequenceReviewGroups, files, manifest, summary };
}

function checksumsFor(files) {
  return `${Object.keys(files).sort(byteCompare).map((name) => `${sha256(Buffer.from(files[name]))}  ${name}`).join("\n")}\n`;
}

export async function writeAuxiliaryRemainderBound(repositoryRoot = ROOT, outputDirectory = path.join(repositoryRoot, OUTPUT_REL)) {
  const built = await buildAuxiliaryRemainderBound(repositoryRoot);
  await mkdir(outputDirectory, { recursive: true });
  for (const [name, text] of Object.entries(built.files)) await writeFile(path.join(outputDirectory, name), text);
  await writeFile(path.join(outputDirectory, "checksums.sha256"), checksumsFor(built.files));
  return { output: outputDirectory, ...built };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const result = await writeAuxiliaryRemainderBound();
  process.stdout.write(`${JSON.stringify(result.summary)}\n`);
}
