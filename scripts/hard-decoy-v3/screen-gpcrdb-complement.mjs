import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { numberVhhForLeakage } from "../hard-decoy/v3-vhh-sequence-pregraph.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const STATUS = "GPCRDB_COMPLEMENT_SEQUENCE_SCREENED_PENDING_ROLE_AND_COMPLETENESS_REVIEW";
const CANONICAL_RUN = /[ACDEFGHIKLMNPQRSTVWY]+/gu;
const ANTIBODY = /nanobody|\bvhh\b|single[ -]?domain|single[ -]?chain|antibod|\bscfv(?=\b|\d|heavy|light|[hl](?:\b|chain))|\bfab(?=\b|\d|heavy|light|[hl](?:\b|chain))|\bigg(?=\b|\d|heavy|light)|\b(?:heavy|light)[ _-]?chain\b|immunoglobulin|\b(?:nb|vhh)[ -]?\d+/iu;
const AUXILIARY = /\bnb[ -]?35\b|nanobody[ -]?35\b|\bscfv[ -]?16\b|anti[ -]?(?:fab|bril)|fiducial/iu;
const REFERENCES = [
  ["HISTORICAL_KEYWORD_PROFILE_ROLE_UNRESOLVED", "validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29/candidate-vhh-profiles.jsonl"],
  ["DEVELOPMENT_PROFILE", "validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29/development-vhh-profiles.jsonl"],
];
export const SCREEN_POLICY = Object.freeze({
  numberingEngine: "immunum 1.3.0", numberingScheme: "IMGT", minimumEngineConfidence: 0.5,
  wholeCanonicalRunScan: true, windowLength: 256, windowStride: 96,
  recursiveRemainderScanAfterDetection: true, coordinates: "zero-based-start-inclusive-end-exclusive",
  candidateSignalsAreIndependentOfDescriptorAndTaxonomy: true,
  heavyChainNumberingEstablishesVhhIdentity: false, negativeScreenEstablishesAbsence: false,
  domainDetectionSensitivityValidated: false,
});
const AUTHORITY = Object.freeze({
  directBinderRoleResolved: false, vhhIdentityEstablished: false, formalExclusionAuthority: false,
  formalLeakageGraphAuthority: false, formalNoEdgeAuthority: false, wholeCensusAuthority: false,
  absenceOfHiddenVhhEstablished: false, targetFreezePermitted: false, executionAuthorized: false,
  nativeCoordinatesInspected: false, dockqLabelsAccessed: false, performanceResultsAccessed: false,
});

function ok(value, message) { if (!value) throw new Error(message); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function compare(a, b) { return Buffer.from(String(a)).compare(Buffer.from(String(b))); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort(compare).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function jsonl(rows) { return rows.length ? `${rows.map(canonical).join("\n")}\n` : ""; }
function forbidden(value) {
  if (Array.isArray(value)) return value.forEach(forbidden);
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    ok(!/^(?:nativeCoordinates|nativeInterfaceResidues|dockq|dockqScore|capriClass|fnat|irmsd|lrmsd|confovhhScore|performanceResult)$/iu.test(key), `Forbidden result field: ${key}`);
    if (/^(?:nativeCoordinatesInspected|nativeHoldoutCoordinatesAccessed|dockqLabelsAccessed|performanceResultsAccessed)$/u.test(key)) ok(item === false, `Previously exposed input cannot be attested unexposed: ${key}`);
    forbidden(item);
  }
}
function parseRows(bytes, label) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  ok(!text.includes("\0") && !/(?:^|\n)(?:ATOM  |HETATM)|_atom_site\.(?:Cartn_[xyz]|group_PDB)/u.test(text), `Coordinate or invalid payload in ${label}`);
  ok(!/\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*[:=]\s*(?:\d|\.\d)/iu.test(text), `Observed label assignment in ${label}`);
  ok(!text || text.endsWith("\n"), `${label} must end with LF`);
  return text.trim() ? text.trimEnd().split("\n").map((line) => { const row = JSON.parse(line); forbidden(row); return row; }) : [];
}

/** A positive result is a numbered IGH variable domain, not a VHH or binding-role call. */
export function screenProteinSequence(sequence) {
  ok(sequence === null || typeof sequence === "string", "Sequence must be a string or null");
  if (!sequence) return { sequenceSha256: null, sequenceLength: 0, status: "MISSING_SEQUENCE_REVIEW_REQUIRED", canonicalResidueCount: 0, noncanonicalResidueCount: 0, attemptedIntervalCount: 0, numberingFailureCounts: {}, heavyChainDomains: [], absenceOfVhhEstablished: false };
  ok(sequence === sequence.toUpperCase() && !/\s/u.test(sequence), "Expected an already normalized uppercase sequence");
  const domains = new Map();
  const attempted = new Set();
  const numberingFailureCounts = {};
  function scan(start, end) {
    if (start >= end || attempted.has(`${start}:${end}`)) return;
    attempted.add(`${start}:${end}`);
    const numbered = numberVhhForLeakage(sequence.slice(start, end));
    if (numbered.numberingStatus !== "NUMBERED") {
      const code = numbered.numberingFailureCode ?? "UNSPECIFIED_NUMBERING_FAILURE";
      numberingFailureCounts[code] = (numberingFailureCounts[code] ?? 0) + 1;
      return;
    }
    const domainStart = start + numbered.queryStart;
    const domainEnd = start + numbered.queryEnd + 1;
    ok(domainStart >= start && domainEnd <= end && domainStart < domainEnd, "Numbered domain escaped the scanned interval");
    const key = `${domainStart}:${domainEnd}`;
    const domain = {
      start: domainStart, end: domainEnd, sequenceLength: domainEnd - domainStart,
      sequenceSha256: sha256(sequence.slice(domainStart, domainEnd)), confidence: numbered.confidence,
      frameworkSequenceSha256: numbered.frameworkSequenceSha256, frameworkLength: numbered.frameworkLength,
      cdr3SequenceSha256: numbered.cdr3SequenceSha256, cdr3Length: numbered.cdr3Length,
      completeImgtRegionCoverage: numbered.completeImgtRegionCoverage,
      numberingSegmentationAgreement: numbered.numberingSegmentationAgreement,
    };
    const previous = domains.get(key);
    if (!previous || domain.confidence > previous.confidence) domains.set(key, domain);
    scan(start, domainStart);
    scan(domainEnd, end);
  }
  let canonicalResidueCount = 0;
  for (const match of sequence.matchAll(CANONICAL_RUN)) {
    const start = match.index;
    const end = start + match[0].length;
    canonicalResidueCount += match[0].length;
    scan(start, end);
    if (end - start > SCREEN_POLICY.windowLength) {
      for (let cursor = start; cursor + SCREEN_POLICY.windowLength < end; cursor += SCREEN_POLICY.windowStride) scan(cursor, cursor + SCREEN_POLICY.windowLength);
      scan(end - SCREEN_POLICY.windowLength, end);
    }
  }
  // Alternative window alignments may overlap. Preserve them; they are not independent domains.
  const heavyChainDomains = [...domains.values()].sort((a, b) => a.start - b.start || a.end - b.end);
  const overlappingDomainCalls = heavyChainDomains.some((row, index) => heavyChainDomains.slice(index + 1).some((next) => next.start < row.end));
  const noncanonicalResidueCount = sequence.length - canonicalResidueCount;
  return {
    sequenceSha256: sha256(sequence), sequenceLength: sequence.length,
    status: heavyChainDomains.length ? "HEAVY_CHAIN_V_DOMAIN_DETECTED_IDENTITY_AND_ROLE_UNRESOLVED" : noncanonicalResidueCount ? "NONCANONICAL_SEQUENCE_REVIEW_REQUIRED" : "NO_CONFIDENT_COMPLETE_HEAVY_DOMAIN_DETECTED_NOT_ABSENCE_EVIDENCE",
    canonicalResidueCount, noncanonicalResidueCount, attemptedIntervalCount: attempted.size,
    numberingFailureCounts, heavyChainDomains, overlappingDomainCalls, absenceOfVhhEstablished: false,
  };
}

function verifySequence(sequence, digest, length, label) {
  if (sequence === null) { ok(digest === null && length === null, `Missing sequence has inconsistent hash/length: ${label}`); return; }
  ok(typeof sequence === "string" && sequence.length > 0, `Invalid sequence: ${label}`);
  ok(sha256(sequence) === digest && sequence.length === length, `Sequence hash/length mismatch: ${label}`);
}
function referenceIndex(referenceRows) {
  const full = new Map();
  const domain = new Map();
  function add(index, digest, value) { if (!index.has(digest)) index.set(digest, []); index.get(digest).push(value); }
  for (const { category, rows } of referenceRows) for (const row of rows) {
    if (!row.fullSequence) continue;
    verifySequence(row.fullSequence, row.fullSequenceSha256, row.fullSequenceLength, row.profileId);
    const value = { category, pdbId: row.pdbId, entityId: row.entityId, profileId: row.profileId, description: row.entityDescription };
    add(full, row.fullSequenceSha256, value);
    if (row.numberingStatus === "NUMBERED" && row.completeImgtRegionCoverage && row.numberingSegmentationAgreement) {
      ok(Number.isInteger(row.queryStart) && Number.isInteger(row.queryEnd) && row.queryStart >= 0 && row.queryEnd < row.fullSequence.length && row.queryEnd >= row.queryStart, `Invalid historical numbering bounds: ${row.profileId}`);
      add(domain, sha256(row.fullSequence.slice(row.queryStart, row.queryEnd + 1)), value);
    }
  }
  return { full, domain };
}
function matchesFor(screen, index) {
  const matches = new Map();
  for (const match of index.full.get(screen.sequenceSha256) ?? []) matches.set(`FULL:${match.profileId}`, { matchType: "EXACT_FULL_ENTITY_SEQUENCE", ...match });
  for (const domain of screen.heavyChainDomains) for (const match of index.domain.get(domain.sequenceSha256) ?? []) {
    matches.set(`DOMAIN:${match.profileId}:${domain.start}:${domain.end}`, { matchType: "EXACT_NUMBERED_HEAVY_DOMAIN_SEQUENCE", queryDomainStart: domain.start, queryDomainEnd: domain.end, ...match });
  }
  return [...matches.values()].sort((a, b) => compare(canonical(a), canonical(b)));
}

export function screenEntries(entries, referenceRows = []) {
  const index = referenceIndex(referenceRows);
  const sequenceCache = new Map();
  const entityScreens = [];
  const seenEntries = new Set();
  for (const entry of [...entries].sort((a, b) => compare(a.pdbId, b.pdbId))) {
    ok(/^[0-9][A-Z0-9]{3}$/u.test(entry.pdbId) && !seenEntries.has(entry.pdbId), `Invalid or duplicate PDB entry: ${entry.pdbId}`);
    seenEntries.add(entry.pdbId);
    ok(Array.isArray(entry.polymerEntities), `Polymer entity inventory missing: ${entry.pdbId}`);
    const seenEntities = new Set();
    for (const entity of [...entry.polymerEntities].sort((a, b) => compare(a.entityId, b.entityId))) {
      ok(typeof entity.entityId === "string" && !seenEntities.has(entity.entityId), `Invalid or duplicate entity: ${entry.pdbId}:${entity.entityId}`);
      seenEntities.add(entity.entityId);
      const protein = entity.polymerType === "Protein" || /polypeptide/iu.test(entity.polymerTypeDetail ?? "");
      const unknownType = !entity.polymerType;
      if (!protein && !unknownType) {
        entityScreens.push({ pdbId: entry.pdbId, entityId: entity.entityId, description: entity.description, polymerType: entity.polymerType, status: "NONPROTEIN_POLYMER_NOT_NUMBERED", proteinSequenceScreened: false, dispositionStatus: "PENDING_REQUIRED_METADATA", ...AUTHORITY });
        continue;
      }
      verifySequence(entity.sequence, entity.sequenceSha256, entity.sequenceLength, `${entry.pdbId}:${entity.entityId}`);
      const key = entity.sequenceSha256 ?? "MISSING";
      if (!sequenceCache.has(key)) {
        const screened = screenProteinSequence(entity.sequence);
        sequenceCache.set(key, { ...screened, referenceMatches: matchesFor(screened, index) });
      }
      const screen = sequenceCache.get(key);
      const referenceMatches = screen.referenceMatches;
      const numbered = screen.heavyChainDomains.length > 0;
      const lexicalAntibodySignal = ANTIBODY.test(entity.description ?? "") || entity.metadataSignals?.vhhLikeCandidate === true;
      const auxiliaryDescriptorSignal = AUXILIARY.test(entity.description ?? "");
      const priorSequenceExposure = referenceMatches.length > 0;
      const metadataSequenceReviewRequired = !entity.sequence || screen.noncanonicalResidueCount > 0 || (screen.numberingFailureCounts.NUMBERING_ENGINE_ERROR ?? 0) > 0;
      const priorityTier = numbered ? auxiliaryDescriptorSignal ? 3 : priorSequenceExposure ? 2 : lexicalAntibodySignal ? 1 : 0 : lexicalAntibodySignal || metadataSequenceReviewRequired ? 4 : 5;
      const outsideLongestDomain = numbered ? entity.sequence.length - Math.max(...screen.heavyChainDomains.map((domain) => domain.sequenceLength)) : null;
      const receptorEntityIds = entry.receptorMapping?.preferredAuthChainEntityIds ?? [];
      const receptorEntities = entry.polymerEntities.filter((row) => receptorEntityIds.includes(row.entityId));
      entityScreens.push({
        pdbId: entry.pdbId, entityId: entity.entityId, description: entity.description, polymerType: entity.polymerType,
        proteinSequenceScreened: true, polymerTypeUnresolved: unknownType,
        sequenceSha256: entity.sequenceSha256, sequenceLength: entity.sequenceLength, status: screen.status,
        numberedHeavyDomainCallCount: screen.heavyChainDomains.length, lexicalAntibodySignal, auxiliaryDescriptorSignal,
        sequenceSignalMissedByHistoricalDescriptorTaxonomyRule: numbered && entity.metadataSignals?.vhhLikeCandidate !== true,
        priorSequenceExposure, developmentSequenceMatch: referenceMatches.some((match) => match.category === "DEVELOPMENT_PROFILE"),
        referenceMatchCount: referenceMatches.length,
        referenceMatchCategories: [...new Set(referenceMatches.map((match) => match.category))].sort(compare),
        referenceMatchDetails: { file: "sequence-screens.jsonl", sequenceSha256: entity.sequenceSha256 },
        metadataSequenceReviewRequired, priorityTier, reviewQueueIncluded: priorityTier < 5,
        possibleFusionOrAdditionalDomainSequence: numbered && outsideLongestDomain > 30,
        preferredReceptorEntity: receptorEntityIds.includes(entity.entityId),
        dispositionStatus: "PENDING_REQUIRED_METADATA", ...AUTHORITY,
        context: {
          entryTitle: entry.title, primaryCitation: entry.primaryCitation,
          gpcrdbProtein: entry.gpcrdb?.protein ?? null, gpcrdbClass: entry.gpcrdb?.class ?? null,
          preferredReceptorAuthChain: entry.gpcrdb?.preferredChain ?? null,
          preferredReceptorEntityIds: receptorEntityIds,
          receptorReferenceSequences: receptorEntities.flatMap((row) => row.referenceSequences ?? []),
          sourceOrganisms: entity.sourceOrganisms ?? [], authAsymIds: entity.authAsymIds ?? [], labelAsymIds: entity.labelAsymIds ?? [],
          sourceLinks: {
            rcsbEntry: `https://www.rcsb.org/structure/${entry.pdbId}`,
            rcsbEntityMetadata: `https://data.rcsb.org/rest/v1/core/polymer_entity/${entry.pdbId}/${entity.entityId}`,
            gpcrdbEntry: `https://gpcrdb.org/structure/${entry.pdbId}`,
            primaryPublication: entry.primaryCitation?.doi ? `https://doi.org/${entry.primaryCitation.doi}` : entry.primaryCitation?.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${entry.primaryCitation.pmid}/` : null,
          },
        },
      });
    }
  }
  const sequenceScreens = [...sequenceCache.values()].sort((a, b) => compare(a.sequenceSha256 ?? "", b.sequenceSha256 ?? ""));
  const reviewQueue = entityScreens.filter((row) => row.reviewQueueIncluded).sort((a, b) => a.priorityTier - b.priorityTier || compare(a.pdbId, b.pdbId) || compare(a.entityId, b.entityId));
  const screened = entityScreens.filter((row) => row.proteinSequenceScreened);
  const withDomain = screened.filter((row) => row.numberedHeavyDomainCallCount > 0);
  return {
    entityScreens, sequenceScreens, reviewQueue,
    summary: {
      schemaVersion: "1.0.0", status: STATUS, inputEntryCount: entries.length, polymerEntityCount: entityScreens.length,
      proteinOrUnknownTypeEntityCount: screened.length, nonProteinEntityCount: entityScreens.length - screened.length,
      distinctPresentSequencesScreened: sequenceScreens.filter((row) => row.sequenceSha256 !== null).length,
      entitiesWithNumberedHeavyDomain: withDomain.length,
      entriesWithNumberedHeavyDomain: new Set(withDomain.map((row) => row.pdbId)).size,
      sequencePositiveEntitiesMissedByHistoricalDescriptorTaxonomyRule: withDomain.filter((row) => row.sequenceSignalMissedByHistoricalDescriptorTaxonomyRule).length,
      untaggedUnexposedSequencePositiveEntities: withDomain.filter((row) => row.priorityTier === 0).length,
      sequencePositiveEntitiesMatchingDevelopment: withDomain.filter((row) => row.developmentSequenceMatch).length,
      entitiesWithoutConfidentCompleteHeavyDomain: screened.length - withDomain.length,
      entitiesRequiringMissingNoncanonicalOrEngineErrorReview: screened.filter((row) => row.metadataSequenceReviewRequired).length,
      reviewQueueEntityCount: reviewQueue.length,
      reviewPriorityCounts: Object.fromEntries([0, 1, 2, 3, 4, 5].map((tier) => [String(tier), screened.filter((row) => row.priorityTier === tier).length])),
      sequenceScreenCoversEveryPresentProteinOrUnknownTypeEntity: true,
      broaderDiscoveryComplete: false, eligibleDirectVhhCount: null, independentLeakageComponentCount: null,
      ...AUTHORITY,
    },
  };
}

export async function buildGpcrdbComplementScreen({ inputDirectory, repositoryRoot = ROOT }) {
  const input = path.resolve(inputDirectory);
  const root = path.resolve(repositoryRoot);
  const inputDigests = {};
  async function source(filename, label) { const bytes = await readFile(filename); inputDigests[label] = sha256(bytes); return bytes; }
  const entries = parseRows(await source(path.join(input, "entries.jsonl"), "snapshot/entries.jsonl"), "entries.jsonl");
  // Bind the captured source scope and completeness as well as the normalized sequences.
  for (const filename of ["manifest.json", "summary.json", "checksums.sha256"]) await source(path.join(input, filename), `snapshot/${filename}`);
  const checksumRows = (await readFile(path.join(input, "checksums.sha256"), "utf8")).trimEnd().split("\n");
  const checksums = new Map();
  for (const line of checksumRows) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    ok(match && !checksums.has(match[2]), "Invalid or duplicate snapshot checksum row");
    checksums.set(match[2], match[1]);
  }
  for (const name of ["entries.jsonl", "manifest.json", "summary.json"]) ok(checksums.get(name) === inputDigests[`snapshot/${name}`], `Snapshot checksum mismatch: ${name}`);
  const references = [];
  for (const [category, relative] of REFERENCES) references.push({ category, rows: parseRows(await source(path.join(root, relative), relative), relative) });
  const dependencyFiles = ["package-lock.json", "scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs", "scripts/hard-decoy-v3/screen-gpcrdb-complement.mjs", "node_modules/immunum/package.json", "node_modules/immunum/immunum.js", "node_modules/immunum/immunum_bg.wasm", "node_modules/immunum/README.md"];
  for (const relative of dependencyFiles) await source(path.join(root, relative), relative);
  const packageJson = JSON.parse(await readFile(path.join(root, "node_modules/immunum/package.json"), "utf8"));
  ok(packageJson.version === "1.3.0", "The screen requires immunum 1.3.0");
  const built = screenEntries(entries, references);
  const manifest = {
    schemaVersion: "1.0.0", status: STATUS, stage: "metadata-only-GPCRdb-complement-sequence-screen",
    inputDigests, normalizedInputFilesMatchSnapshotChecksums: true, sourceCaptureVerificationRequiredSeparately: true, policy: SCREEN_POLICY, ...AUTHORITY,
    implementationReference: "https://github.com/ENPICOM/immunum",
    limitations: [
      "Immunum detects antibody heavy variable domains; Fab VH and scFv VH can produce the same positive signal as VHH.",
      "Whole chains, canonical runs, overlapping windows and recursive remainders are screened. Sensitivity for unusual or incomplete domains is not established; failure to number does not establish VHH absence.",
      "Overlapping window calls are preserved and are not independent domain counts. Extra residues may be a fusion, constant domain, linker or tag; sequence length alone does not adjudicate a construct.",
      "Exact historical sequence matches are exposure flags, not automatic formal leakage edges or role exclusions. Near matches and known-parent relationships remain unaudited here.",
      "The review queue prioritizes positive, lexical, missing-sequence and engine-error signals. Every other polymer remains in entity-screens.jsonl without an exclusion or absence call.",
      "The snapshot is a frozen GPCRdb inventory complement, not an exhaustive GPCR-VHH universe. Other discovery routes and entry-specific source review remain required.",
    ],
  };
  const summary = { ...built.summary, inputEntriesSha256: inputDigests["snapshot/entries.jsonl"] };
  const readme = `# GPCRdb complement sequence screen\n\nStatus: ${STATUS}.\n\nScreened ${summary.proteinOrUnknownTypeEntityCount} protein or unknown-type entities across ${summary.inputEntryCount} captured entries, using ${summary.distinctPresentSequencesScreened} distinct present sequences. ${summary.entitiesWithNumberedHeavyDomain} entities in ${summary.entriesWithNumberedHeavyDomain} entries yield a complete numbered heavy-chain variable domain. These are review signals, not confirmed VHHs or direct receptor binders.\n\nThe sequence method uses the pinned immunum 1.3.0 heavy-chain IMGT implementation at confidence 0.5, with complete region coverage and numbering/segmentation agreement. Whole canonical runs are scanned; 256-residue windows at stride 96 and recursive flanking intervals help find domains in long or multidomain chains. The method runs independently of descriptions and source taxonomy. Its sensitivity is not validated.\n\n${summary.sequencePositiveEntitiesMissedByHistoricalDescriptorTaxonomyRule} positive entities lack the historical descriptor/taxonomy signal. ${summary.untaggedUnexposedSequencePositiveEntities} are untagged and have no exact full-entity or numbered-domain match in the historical reference profiles. This does not establish novel VHH identity, receptor binding or independence.\n\nReview tiers: 0, sequence-positive without antibody wording or exact prior exposure; 1, other unexposed positives; 2, exact historical/development matches; 3, auxiliary reagent wording; 4, lexical antibody signals or missing/noncanonical/engine-error sequences. Tier 5 entities have no such signal and remain in the complete entity inventory. Every tier remains scientifically unresolved.\n\n${manifest.limitations.map((item) => `- ${item}`).join("\n")}\n\nFiles bind the input snapshot, historical profiles, source script, lockfile and executed immunum JavaScript/WASM bytes by SHA-256. Rebuild with \`node scripts/hard-decoy-v3/screen-gpcrdb-complement.mjs build INPUT_DIRECTORY OUTPUT_DIRECTORY\`; verify without rewriting with \`... verify INPUT_DIRECTORY OUTPUT_DIRECTORY\`. No coordinates or holdout labels are used.\n`;
  const files = {
    "entity-screens.jsonl": jsonl(built.entityScreens), "sequence-screens.jsonl": jsonl(built.sequenceScreens), "review-queue.jsonl": jsonl(built.reviewQueue),
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`, "summary.json": `${JSON.stringify(summary, null, 2)}\n`, "README.md": readme,
  };
  files["checksums.sha256"] = Object.keys(files).sort(compare).map((name) => `${sha256(files[name])}  ${name}\n`).join("");
  return { ...built, summary, manifest, files };
}

export async function writeGpcrdbComplementScreen(options) {
  const output = path.resolve(options.outputDirectory);
  ok(output !== path.resolve(options.inputDirectory), "Input and output directories must differ");
  const built = await buildGpcrdbComplementScreen(options);
  try { ok((await readdir(output)).length === 0, "Output directory must be new or empty"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  await mkdir(output, { recursive: true });
  for (const [name, content] of Object.entries(built.files)) await writeFile(path.join(output, name), content, { flag: "wx" });
  return built.summary;
}

export async function verifyGpcrdbComplementScreen(options) {
  const output = path.resolve(options.outputDirectory);
  const built = await buildGpcrdbComplementScreen(options);
  ok(canonical((await readdir(output)).sort(compare)) === canonical(Object.keys(built.files).sort(compare)), "Screen artifact inventory mismatch");
  for (const [name, content] of Object.entries(built.files)) ok(await readFile(path.join(output, name), "utf8") === content, `Screen artifact mismatch: ${name}`);
  return built.summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const [command, inputDirectory, outputDirectory, repositoryRoot] = process.argv.slice(2);
  ok(["build", "verify"].includes(command) && inputDirectory && outputDirectory, "Usage: screen-gpcrdb-complement.mjs build|verify INPUT_DIRECTORY OUTPUT_DIRECTORY [REPOSITORY_ROOT]");
  const options = { inputDirectory, outputDirectory, ...(repositoryRoot ? { repositoryRoot } : {}) };
  console.log(JSON.stringify(await (command === "build" ? writeGpcrdbComplementScreen(options) : verifyGpcrdbComplementScreen(options)), null, 2));
}
