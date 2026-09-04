import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const OUTPUT_REL = "validation/hard-decoy-holdout-v3/public-component-links-2026-09-04";
const INPUT_RELS = [
  "HARD_DECOY_PROTOCOL_V3.md",
  "validation/hard-decoy-holdout-v2/prelabel-census/target-census.jsonl",
  "validation/hard-decoy-holdout-v2/prelabel-census/vhh-lineage-census.jsonl",
  "validation/hard-decoy-holdout-v3/disposition-seed-2026-08-29/entry-dispositions.jsonl",
  "validation/hard-decoy-holdout-v3/prelabel-viability-review-2026-09-04/candidate-review-queue.jsonl",
  "validation/hard-decoy-holdout-v3/receptor-tm-pregraph-2026-08-30/candidate-receptor-profiles.jsonl",
  "validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29/candidate-vhh-profiles.jsonl",
];
const STATUS = "PUBLIC_COMPONENT_LINKS_RECORDED_DISPOSITIONS_STILL_PENDING";
const REVIEW_IDS = ["6N51", "7DGE", "7EPB", "8T7H", "8XFP", "8XFS"];
const COORDINATES = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const OBSERVED_LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;
const LINK_SPECS = [
  {
    pdbId: "6N51",
    representativePdbId: "8TAO",
    expectedGroupId: "MGLU",
    rules: ["IDENTICAL_RECEPTOR_UNIPROT", "VHH_IMGT_FRAMEWORK_CDR3_THRESHOLD"],
    sourceReview: {
      classification: "DIRECT_BINDER_CONTEXT_REPORTED",
      note: "The deposited complex and primary publication identify Nb43 bound to mGlu5.",
      urls: [
        "https://www.rcsb.org/structure/6N51",
        "https://europepmc.org/article/PMC/6709600",
      ],
    },
  },
  {
    pdbId: "7DGE",
    representativePdbId: "8TAO",
    expectedGroupId: "MGLU",
    rules: ["VHH_IMGT_FRAMEWORK_CDR3_THRESHOLD"],
    sourceReview: {
      classification: "ENGINEERED_EPITOPE_GRAFT_REPORTED",
      note: "The primary publication reports use of Nb43 after changing seven mGlu1 VFT binding-site residues to the corresponding mGlu5 residues; formal disposition remains separate.",
      urls: [
        "https://www.rcsb.org/structure/7DGE",
        "https://link.springer.com/article/10.1007/s13238-020-00808-5",
      ],
    },
  },
  {
    pdbId: "7EPB",
    representativePdbId: "7E9G",
    expectedGroupId: "MGLU",
    rules: ["IDENTICAL_RECEPTOR_UNIPROT", "VHH_IMGT_FRAMEWORK_CDR3_THRESHOLD"],
    sourceReview: {
      classification: "DEPOSITOR_NAME_SEQUENCE_DISCREPANCY_REVIEWED",
      note: "The deposited entity is named anti-RON rather than DN13, while its numbered framework and CDR3 are identical to the DN13 record; the graph link uses frozen sequences, not the entity name.",
      urls: [
        "https://www.rcsb.org/structure/7EPB",
        "https://doi.org/10.1038/s41586-021-03641-w",
      ],
    },
  },
  {
    pdbId: "8T7H",
    representativePdbId: "8TAO",
    expectedGroupId: "MGLU",
    rules: ["IDENTICAL_RECEPTOR_UNIPROT", "VHH_IMGT_FRAMEWORK_CDR3_THRESHOLD", "IDENTICAL_PRIMARY_DOI"],
    sourceReview: {
      classification: "DIRECT_BINDER_CONTEXT_REPORTED",
      note: "The primary publication reports Quis- and Nb43-bound mGlu5 structures.",
      urls: [
        "https://www.rcsb.org/structure/8T7H",
        "https://pmc.ncbi.nlm.nih.gov/articles/PMC11960862/",
      ],
    },
  },
  {
    pdbId: "8XFP",
    representativePdbId: "9S37",
    expectedGroupId: "LGR4",
    rules: ["IDENTICAL_RECEPTOR_UNIPROT"],
    sourceReview: {
      classification: "MEGABODY_CONSTRUCT_REPORTED",
      note: "The primary publication reports expansion of LGR4-binding NB52 into MB52 for particle orientation; formal construct disposition remains separate.",
      urls: [
        "https://www.rcsb.org/structure/8XFP",
        "https://www.nature.com/articles/s41467-024-55431-3",
      ],
    },
  },
  {
    pdbId: "8XFS",
    representativePdbId: "9S37",
    expectedGroupId: "LGR4",
    rules: ["IDENTICAL_RECEPTOR_UNIPROT"],
    sourceReview: {
      classification: "DIRECT_BINDER_CONTEXT_REPORTED",
      note: "The primary publication identifies NB52 as a high-affinity nanobody targeting the LGR4 ectodomain.",
      urls: [
        "https://www.rcsb.org/structure/8XFS",
        "https://www.nature.com/articles/s41467-024-55431-3",
      ],
    },
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

function mapUnique(rows, key, label) {
  const result = new Map();
  for (const row of rows) {
    const value = row?.[key];
    ok(typeof value === "string" && value.length > 0, `${label} has a row without ${key}.`);
    ok(!result.has(value), `${label} repeats ${value}.`);
    result.set(value, row);
  }
  return result;
}

function mapSelectedUnique(rows, key, selectedValues, label) {
  const selected = new Set(selectedValues);
  const result = mapUnique(rows.filter((row) => selected.has(row?.[key])), key, label);
  ok(result.size === selected.size, `${label} is missing a selected row.`);
  return result;
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

function evidenceForRule(rule, candidate, representative, candidateVhh, representativeVhh) {
  if (rule === "IDENTICAL_RECEPTOR_UNIPROT") {
    const left = candidate.receptorUniProt;
    const right = representative.receptor.uniprot;
    ok(left === right && typeof left === "string", `${candidate.pdbId} receptor accession did not match ${representative.pdbId}.`);
    return { rule, satisfied: true, candidateValue: left, representativeValue: right };
  }
  if (rule === "VHH_IMGT_FRAMEWORK_CDR3_THRESHOLD") {
    ok(candidateVhh.numberingStatus === "NUMBERED" && representativeVhh.status === "numbered", "Both VHH records must be numbered.");
    ok(candidateVhh.frameworkSequenceSha256 === representativeVhh.frameworkSequenceSha256, "Framework identity must be exact for this recorded edge.");
    ok(candidateVhh.cdr3SequenceSha256 === representativeVhh.cdr3Sha256, "CDR3 identity must be exact for this recorded edge.");
    const lengthDifference = Math.abs(candidateVhh.cdr3Length - representativeVhh.cdrLengths.cdr3);
    ok(lengthDifference === 0, "CDR3 length difference must be zero for this recorded edge.");
    return {
      rule,
      satisfied: true,
      frameworkIdentity: 1,
      frameworkThreshold: 0.9,
      cdr3Identity: 1,
      cdr3Threshold: 0.7,
      cdr3LengthDifference: lengthDifference,
      maximumCdr3LengthDifference: 2,
      exactConstructSequenceMatch: candidate.vhhSequenceSha256 === representative.vhh.constructSequenceSha256,
      candidateConstructSequenceSha256: candidate.vhhSequenceSha256,
      representativeConstructSequenceSha256: representative.vhh.constructSequenceSha256,
      frameworkSequenceSha256: candidateVhh.frameworkSequenceSha256,
      cdr3SequenceSha256: candidateVhh.cdr3SequenceSha256,
    };
  }
  if (rule === "IDENTICAL_PRIMARY_DOI") {
    const left = candidate.primaryDoi;
    const right = representative.publication.doi;
    ok(left === right && typeof left === "string", `${candidate.pdbId} DOI did not match ${representative.pdbId}.`);
    return { rule, satisfied: true, candidateValue: left, representativeValue: right };
  }
  throw new Error(`Unknown rule ${rule}.`);
}

async function build(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const inputs = new Map();
  for (const relative of INPUT_RELS) inputs.set(relative, await readBound(root, relative, relative));

  const protocol = inputs.get(INPUT_RELS[0]).text;
  ok(/identical receptor UniProt accession/u.test(protocol), "The receptor identity rule drifted.");
  ok(/framework\s+identity\s+>=0\.90 plus CDR3 global identity >=0\.70/u.test(protocol), "The VHH threshold rule drifted.");
  ok(/Holdout nodes in\s+one connected component form one independent group/u.test(protocol), "The component-count rule drifted.");

  const targetRows = parseJsonl(inputs.get(INPUT_RELS[1]).text, INPUT_RELS[1]);
  const targetMap = mapUnique(targetRows, "pdbId", INPUT_RELS[1]);
  const lineageRows = parseJsonl(inputs.get(INPUT_RELS[2]).text, INPUT_RELS[2]);
  const lineageMap = mapUnique(lineageRows, "pdbId", INPUT_RELS[2]);
  const candidateRows = parseJsonl(inputs.get(INPUT_RELS[3]).text, INPUT_RELS[3]);
  const candidateMap = mapUnique(candidateRows, "pdbId", INPUT_RELS[3]);
  const queueRows = parseJsonl(inputs.get(INPUT_RELS[4]).text, INPUT_RELS[4]);
  const queueMap = mapUnique(queueRows, "pdbId", INPUT_RELS[4]);
  const receptorRows = parseJsonl(inputs.get(INPUT_RELS[5]).text, INPUT_RELS[5]);
  const receptorMap = mapSelectedUnique(receptorRows, "pdbId", REVIEW_IDS, INPUT_RELS[5]);
  const vhhRows = parseJsonl(inputs.get(INPUT_RELS[6]).text, INPUT_RELS[6]);
  const vhhMap = mapSelectedUnique(vhhRows, "pdbId", REVIEW_IDS, INPUT_RELS[6]);

  const queuedNoPathIds = queueRows.filter((row) => row.reviewClass === "NO_PREGRAPH_DEVELOPMENT_PATH_REVIEW").map((row) => row.pdbId).sort(byteCompare);
  ok(canonical(queuedNoPathIds) === canonical([...REVIEW_IDS].sort(byteCompare)), "The six-entry review set drifted.");

  const links = LINK_SPECS.map((spec) => {
    const candidate = candidateMap.get(spec.pdbId);
    const queue = queueMap.get(spec.pdbId);
    const candidateReceptor = receptorMap.get(spec.pdbId);
    const candidateVhh = vhhMap.get(spec.pdbId);
    const representative = targetMap.get(spec.representativePdbId);
    const representativeVhh = lineageMap.get(spec.representativePdbId);
    ok(candidate && queue && candidateReceptor && candidateVhh && representative && representativeVhh, `Missing input for ${spec.pdbId}.`);
    ok(queue.formalDisposition === "PENDING_REQUIRED_METADATA" && queue.developmentPath === null, `${spec.pdbId} is no longer a pending no-path row.`);
    ok(candidateReceptor.canonicalAccession === candidate.receptorUniProt, `${spec.pdbId} receptor records disagree.`);
    ok(candidateVhh.fullSequenceSha256 === candidate.vhhSequenceSha256, `${spec.pdbId} VHH records disagree.`);
    ok(representative.provisionalGroupId === spec.expectedGroupId, `${spec.representativePdbId} group drifted.`);
    const ruleEvidence = spec.rules.map((rule) => evidenceForRule(rule, candidate, representative, candidateVhh, representativeVhh));
    ok(ruleEvidence.every((item) => item.satisfied), `${spec.pdbId} has an unsatisfied public component rule.`);
    return {
      pdbId: spec.pdbId,
      priorReviewPriority: queue.reviewPriority,
      priorReviewClass: queue.reviewClass,
      representativePdbId: spec.representativePdbId,
      existingProvisionalGroupId: spec.expectedGroupId,
      publicComponentRulesSatisfied: ruleEvidence,
      conditionalComponentEdgeEstablished: true,
      conditionalMeaning: "If this source entry passes target eligibility, the frozen public graph rules place it in the named existing provisional component; if it fails eligibility, it contributes no component.",
      independentComponentCountIncrementUpperBound: 0,
      sourceReview: spec.sourceReview,
      sourceReviewControlsComponentCount: false,
      eligibilityResolved: false,
      formalDisposition: "PENDING_REQUIRED_METADATA",
      nativeCoordinatesInspected: false,
      targetFreezePermitted: false,
      executionAuthorized: false,
    };
  }).sort((left, right) => left.priorReviewPriority - right.priorReviewPriority || byteCompare(left.pdbId, right.pdbId));

  const summary = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    recordedAtUtc: "2026-09-04T20:39:00Z",
    reviewedEntryCount: links.length,
    reviewedPdbIds: links.map((row) => row.pdbId),
    existingGroupsReached: [...new Set(links.map((row) => row.existingProvisionalGroupId))].sort(byteCompare),
    newIndependentComponentUpperBoundFromReviewedEntries: links.reduce((sum, row) => sum + row.independentComponentCountIncrementUpperBound, 0),
    provisionalComponentCountBeforeReview: 7,
    provisionalComponentCountAfterReview: 7,
    formalClearedComponentCount: 0,
    remainingDirectLookingEntriesForReview: 23,
    conclusion: "The six entries previously prioritized because no development path appeared in the v3 pregraphs cannot increase the independent-component count. This does not resolve their target eligibility or the remaining 23 direct-looking entries.",
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
  };

  const scriptBytes = await readFile(HERE);
  const inputDigests = Object.fromEntries(INPUT_RELS.map((relative) => [relative, inputs.get(relative).sha256]));
  const linkBytes = Buffer.from(jsonl(links));
  const summaryBytes = Buffer.from(pretty(summary));
  const manifest = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    generatorScript: path.relative(root, HERE),
    generatorScriptSha256: sha256(scriptBytes),
    inputDigests,
    outputDigests: {
      "component-links.jsonl": sha256(linkBytes),
      "summary.json": sha256(summaryBytes),
    },
    decisionBasis: "Frozen v3 public component rules applied to frozen metadata and sequence records; primary-source role notes do not control the component-count conclusion.",
    formalTargetDispositionsAssigned: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
  };
  return { links, summary, manifest };
}

async function writeOutputs(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  const output = directPath(root, OUTPUT_REL, "output directory");
  await mkdir(output, { recursive: true });
  const { links, summary, manifest } = await build(root);
  const readme = `# Public component links: 2026-09-04\n\nThis label-safe record resolves the component-count effect of the six entries that had no path to development in the earlier review pregraph. Every one has at least one frozen public graph edge to an already counted v2 provisional component. Therefore these six can add **zero** independent groups: an eligible entry joins that existing component, while an ineligible entry contributes nothing.\n\nThe provisional count remains seven, not thirteen. This is not a completed target disposition, formal clearance, native-epitope result, target freeze, or execution authorization. The other 23 direct-looking entries remain under review.\n\nThe primary-source notes flag two important follow-ups without using them to force the count result: \`7DGE\` reports an engineered mGlu5-derived Nb43 epitope in mGlu1, and \`8XFP\` reports the enlarged MB52 orientation construct.\n\nRegenerate and verify with:\n\n\`\`\`bash\nnode scripts/hard-decoy-v3/build-public-component-links.mjs\nnode --test tests/hard-decoy-v3-public-component-links.test.mjs\n\`\`\`\n`;
  const files = new Map([
    ["README.md", Buffer.from(readme)],
    ["component-links.jsonl", Buffer.from(jsonl(links))],
    ["manifest.json", Buffer.from(pretty(manifest))],
    ["summary.json", Buffer.from(pretty(summary))],
  ]);
  for (const [name, bytes] of files) await writeFile(path.join(output, name), bytes);
  const checksums = [...files.entries()].sort(([a], [b]) => byteCompare(a, b)).map(([name, bytes]) => `${sha256(bytes)}  ${name}`).join("\n") + "\n";
  await writeFile(path.join(output, "checksums.sha256"), checksums);
  return { output, links, summary, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const result = await writeOutputs();
  process.stdout.write(`${result.summary.status}: ${result.links.length} links, +${result.summary.newIndependentComponentUpperBoundFromReviewedEntries} possible groups\n`);
}

export { build, writeOutputs };
