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
const STATUS = "TARGET_CENSUS_BLOCKED";
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
        directReceptorVhhCandidate: false,
      };
    }
    ok(/fab.*(?:heavy|light)|(?:heavy|light).*fab/iu.test(description), `${entry.pdbId} contains an unreviewed additional antibody-like entity: ${description}`);
    return {
      entityId: entity.entityId,
      description,
      sequenceLength: entity.sequenceLength ?? null,
      sequenceSha256: entity.sequenceSha256 ?? null,
      classification: "FAB_CHAIN_NOT_VHH",
      directReceptorVhhCandidate: false,
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
      schemaVersion: "1.0.0",
      studyId: "confovhh-hard-decoy-holdout-v3",
      pdbId: remainderRow.pdbId,
      dispositionCode: "EXCLUDE_AUXILIARY_BINDER",
      independentComponentCountIncrementUpperBound: 0,
      roleClass,
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
      sourceAuthority: {
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
      dispositionReason: "The sole apparent VHH-like entity maps exactly by frozen entity description and companion-component context to a source-established auxiliary binder class excluded by the v3 protocol.",
      evidenceUrls,
      publicSourcesReviewed: true,
      nativeCoordinatesInspected: false,
      nativeRelativePoseInspected: false,
      masterDispositionLedgerRewritten: false,
      targetFreezePermitted: false,
    };
  }).sort((left, right) => byteCompare(left.pdbId, right.pdbId));

  const roleCounts = Object.fromEntries([...authorities.keys()].map((roleClass) => [roleClass, mappings.filter((row) => row.roleClass === roleClass).length]));
  ok(canonical(roleCounts) === canonical({
    NB35_G_PROTEIN_STABILIZER: 196,
    SCFV16_G_PROTEIN_STABILIZER: 3,
    ANTI_FAB_FIDUCIAL_NANOBODY: 13,
  }), "The auxiliary role partition drifted.");
  ok(mappings.length === 212 && mappings.every((row) => row.independentComponentCountIncrementUpperBound === 0), "The remainder bound is incomplete.");
  const additionalAntibodyLikeEntities = mappings.flatMap((row) => row.additionalAntibodyLikeEntities);
  const additionalScfv16EntityCount = additionalAntibodyLikeEntities.filter((entity) => entity.classification === "ADDITIONAL_SCFV16_G_PROTEIN_STABILIZER").length;
  const additionalFabChainEntityCount = additionalAntibodyLikeEntities.filter((entity) => entity.classification === "FAB_CHAIN_NOT_VHH").length;
  ok(additionalAntibodyLikeEntities.length === 44 && additionalScfv16EntityCount === 16 && additionalFabChainEntityCount === 28, "The additional antibody-like entity review drifted.");

  const wholeCensusComponentUpperBound = priorBound.prioritizedFrontierUpperBound;
  const requiredIndependentComponentCount = priorBound.requiredIndependentComponentCount;
  const componentDeficitAtUpperBound = requiredIndependentComponentCount - wholeCensusComponentUpperBound;
  ok(wholeCensusComponentUpperBound === 8 && componentDeficitAtUpperBound === 2, "The terminal component arithmetic drifted.");
  const summary = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    recordedAtUtc: "2026-09-04T21:34:00Z",
    completeFrozenCandidateUniverseEntryCount: entries.length,
    reviewedAuxiliaryRemainderEntryCount: mappings.length,
    sourceBackedAuxiliaryBinderExclusionCount: mappings.length,
    auxiliaryRoleCounts: roleCounts,
    additionalAntibodyLikeEntityCount: additionalAntibodyLikeEntities.length,
    additionalScfv16EntityCount,
    additionalFabChainEntityCount,
    auxiliaryRemainderIndependentComponentIncrementUpperBound: 0,
    priorPrioritizedFrontierUpperBound: priorBound.prioritizedFrontierUpperBound,
    wholeCensusComponentUpperBound,
    requiredIndependentComponentCount,
    componentDeficitAtUpperBound,
    wholeCensusUpperBoundBelowRequiredMinimum: wholeCensusComponentUpperBound < requiredIndependentComponentCount,
    wholeCensusTerminalDecisionReached: true,
    formalProtocolStatus: STATUS,
    completedCensusCountBound: true,
    masterDispositionLedgerRewritten: false,
    oracleRequestFreezePermitted: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
    interpretation: "Every row in the 212-entry auxiliary-lexical remainder has exactly one apparent VHH-like entity and maps to a source-established auxiliary class: 196 Nb35 G-protein stabilizers, three scFv16 G-protein stabilizers, and 13 anti-Fab fiducial nanobodies. A broad negative-control scan finds only 16 additional scFv16 stabilizers and 28 Fab heavy/light chains, with no hidden additional VHH candidate. These rows add zero independent components. The prior favorable frontier upper bound therefore becomes the whole-census upper bound of eight, below the required ten, so hard-decoy v3 terminates at TARGET_CENSUS_BLOCKED before oracle freeze or label access.",
  };

  const authorityBytes = Buffer.from(jsonl(ROLE_AUTHORITIES.map((authority) => ({ ...authority, evidenceUrls: [...authority.evidenceUrls].sort(byteCompare) }))));
  const mappingBytes = Buffer.from(jsonl(mappings));
  const summaryBytes = Buffer.from(pretty(summary));
  const manifest = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    generatorScript: path.relative(root, HERE),
    generatorScriptSha256: sha256(await readFile(HERE)),
    inputDigests: Object.fromEntries(INPUT_RELS.map((relative) => [relative, loaded.get(relative).sha256])),
    evidenceBoundary: "Frozen public entity metadata plus role definitions from three primary papers; no coordinate-derived interface inference.",
    matchingRule: "Exactly one frozen VHH-like entity per row; exact descriptor membership in a closed role dictionary; role-specific G-protein or Fab companion entities required.",
    outputDigests: {
      "role-authorities.jsonl": sha256(authorityBytes),
      "auxiliary-entity-mappings.jsonl": sha256(mappingBytes),
      "summary.json": sha256(summaryBytes),
    },
    completedCensusCountBound: true,
    wholeCensusTerminalDecisionReached: true,
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
    "This source-backed audit closes the 212 rows left outside the earlier salvage queue. It uses frozen public entity metadata and primary role sources, without native coordinates or relative-pose inspection.",
    "",
    "## Entity-level result",
    "",
    "Each row contains exactly one apparent VHH-like entity, already marked auxiliary in the frozen triage snapshot. Exact descriptor matching and required companion entities classify 196 as Nb35 G-protein stabilizers, three as scFv16 G-protein stabilizers, and 13 as anti-Fab fiducial nanobodies. A broader antibody-like entity scan additionally accounts for 16 scFv16 stabilizers and 28 Fab heavy/light chains and finds no hidden VHH candidate. The v3 protocol explicitly excludes all three auxiliary VHH-like classes. Every row therefore has an independent-component increment upper bound of zero.",
    "",
    "## Census consequence",
    "",
    "The preceding audit bounded the favorable prioritized frontier at eight components and proved that at least two more would have to come from these 212 rows. Because this package closes all 212 at zero, eight is now the whole-census upper bound. The protocol requires at least ten, so version 3 terminates at `TARGET_CENSUS_BLOCKED`.",
    "",
    "This terminal decision does not authorize a smaller formal GPCR holdout. A smaller panel remains exploratory only. A broader membrane-protein-VHH benchmark would require a separately preregistered protocol.",
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
    "summary.json": summaryBytes.toString(),
    "manifest.json": pretty(manifest),
  };
  Object.entries(files).forEach(([name, text]) => clean(name, text));
  return { authorities: ROLE_AUTHORITIES, mappings, files, manifest, summary };
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
