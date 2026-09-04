import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const OUTPUT_REL = "validation/hard-decoy-holdout-v3/direct-stratum-bound-2026-09-04";
const INPUT_RELS = [
  "HARD_DECOY_PROTOCOL_V3.md",
  "validation/hard-decoy-holdout-v2/prelabel-census/census-summary.json",
  "validation/hard-decoy-holdout-v2/prelabel-census/target-census.jsonl",
  "validation/hard-decoy-holdout-v3/disposition-seed-2026-08-29/summary.json",
  "validation/hard-decoy-holdout-v3/disposition-seed-2026-08-29/entry-dispositions.jsonl",
  "validation/hard-decoy-holdout-v3/prelabel-viability-review-2026-09-04/candidate-review-queue.jsonl",
  "validation/hard-decoy-holdout-v3/public-component-links-2026-09-04/component-links.jsonl",
  "validation/hard-decoy-holdout-v3/exact-evidence-pregraph-2026-08-29/candidate-candidate-evidence.jsonl",
];
const STATUS = "DIRECT_LOOKING_STRATUM_INSUFFICIENT_OTHER_STRATA_REQUIRED";
const COORDINATES = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const OBSERVED_LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;

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

function pdbIdFromNode(node) {
  const match = /^candidate:([0-9][A-Z0-9]{3})$/u.exec(node ?? "");
  return match?.[1] ?? null;
}

function components(ids, edges) {
  const parent = new Map(ids.map((id) => [id, id]));
  function find(id) {
    const current = parent.get(id);
    if (current !== id) parent.set(id, find(current));
    return parent.get(id);
  }
  function union(left, right) {
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft === rootRight) return;
    if (byteCompare(rootLeft, rootRight) <= 0) parent.set(rootRight, rootLeft);
    else parent.set(rootLeft, rootRight);
  }
  for (const [left, right] of edges) union(left, right);
  const groups = new Map();
  for (const id of ids) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }
  return [...groups.values()].map((group) => group.sort(byteCompare)).sort((left, right) => byteCompare(left[0], right[0]));
}

async function build(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const inputs = new Map();
  for (const relative of INPUT_RELS) inputs.set(relative, await readBound(root, relative, relative));
  const protocol = inputs.get(INPUT_RELS[0]).text;
  ok(/at least\s+ten/u.test(protocol) && /Fewer than ten terminates this\s+protocol version/u.test(protocol), "The minimum-component rule drifted.");
  ok(/A candidate connected to any development node is excluded/u.test(protocol), "The development-leakage rule drifted.");
  ok(/Holdout nodes in\s+one connected component form one independent group/u.test(protocol), "The component-count rule drifted.");

  const census = JSON.parse(inputs.get(INPUT_RELS[1]).text);
  const targetCensus = parseJsonl(inputs.get(INPUT_RELS[2]).text, INPUT_RELS[2]);
  const dispositionSummary = JSON.parse(inputs.get(INPUT_RELS[3]).text);
  ok(census.requiredIndependentGroups === 10 && census.screenedProvisionalGroupCount === 7, "The v2 census checkpoint drifted.");
  ok(dispositionSummary.sourceEntryCount === 287 && dispositionSummary.pendingDispositionRowCount === 272, "The v3 source census drifted.");
  const dispositions = parseJsonl(inputs.get(INPUT_RELS[4]).text, INPUT_RELS[4]);
  const queue = parseJsonl(inputs.get(INPUT_RELS[5]).text, INPUT_RELS[5]);
  const publicLinks = parseJsonl(inputs.get(INPUT_RELS[6]).text, INPUT_RELS[6]);
  const exactEvidence = parseJsonl(inputs.get(INPUT_RELS[7]).text, INPUT_RELS[7]);
  ok(queue.length === 29, "The direct-looking nondevelopment queue must contain 29 entries.");

  const directRows = queue.filter((row) => row.reviewClass === "DIRECT_PREGRAPH_DEVELOPMENT_PATH_REVIEW");
  const transitiveRows = queue.filter((row) => row.reviewClass === "TRANSITIVE_PREGRAPH_DEVELOPMENT_PATH_REVIEW");
  const noPathRows = queue.filter((row) => row.reviewClass === "NO_PREGRAPH_DEVELOPMENT_PATH_REVIEW");
  ok(directRows.length === 19 && transitiveRows.length === 4 && noPathRows.length === 6, "The queue partition drifted.");
  ok(publicLinks.length === 6, "All six no-path rows require public component links.");
  ok(canonical(publicLinks.map((row) => row.pdbId).sort(byteCompare)) === canonical(noPathRows.map((row) => row.pdbId).sort(byteCompare)), "The public links do not cover the no-path rows exactly.");
  ok(publicLinks.every((row) => row.conditionalComponentEdgeEstablished && row.independentComponentCountIncrementUpperBound === 0), "A no-path row lacks a zero-addition public link.");

  const directAssessments = directRows.map((row) => {
    ok(row.developmentPath?.edgeCount === 1 && row.developmentPath.edges?.length === 1, `${row.pdbId} no longer has a one-edge development path.`);
    const edge = row.developmentPath.edges[0];
    ok(edge.from === `candidate:${row.pdbId}` && /^development:[0-9][A-Z0-9]{3}$/u.test(edge.to), `${row.pdbId} development edge is malformed.`);
    ok(["DEFINITE_METADATA_IDENTITY", "POSSIBLE_RECEPTOR_TM_SEQUENCE_EDGE", "POSSIBLE_VHH_SEQUENCE_EDGE_ROLE_UNRESOLVED"].includes(edge.preferredEvidenceType), `${row.pdbId} uses an unknown edge type.`);
    if (edge.preferredEvidenceType === "POSSIBLE_VHH_SEQUENCE_EDGE_ROLE_UNRESOLVED") {
      ok(row.vhhCandidates.length === 1, `${row.pdbId} has ambiguous VHH profiles for its role-conditional edge.`);
    }
    return {
      pdbId: row.pdbId,
      priorReviewPriority: row.reviewPriority,
      developmentNode: edge.to,
      publicEdgeType: edge.preferredEvidenceType,
      upperBoundLogic: "If eligible, the sole selected receptor-VHH profile makes the recorded public edge applicable and development connectivity excludes the entry; if ineligible, the entry contributes no component.",
      independentComponentCountIncrementUpperBound: 0,
      formalDisposition: "PENDING_REQUIRED_METADATA",
      nativeCoordinatesInspected: false,
    };
  }).sort((left, right) => left.priorReviewPriority - right.priorReviewPriority);

  const transitiveIds = transitiveRows.map((row) => row.pdbId).sort(byteCompare);
  const transitiveSet = new Set(transitiveIds);
  const definiteEdges = exactEvidence.filter((row) => row.definitePregraphEdge).map((row) => [pdbIdFromNode(row.nodeA), pdbIdFromNode(row.nodeB)])
    .filter(([left, right]) => transitiveSet.has(left) && transitiveSet.has(right));
  const transitiveComponents = components(transitiveIds, definiteEdges);
  ok(canonical(transitiveComponents) === canonical([["7UL3"], ["9B9Y", "9B9Z", "9BA0"]]), "The conservative transitive-row partition drifted.");
  const transitiveAssessments = transitiveComponents.map((pdbIds) => ({
    pdbIds,
    exactPublicEdgeCountWithinGroup: definiteEdges.filter(([left, right]) => pdbIds.includes(left) && pdbIds.includes(right)).length,
    independentComponentCountIncrementUpperBound: 1,
    rationale: pdbIds.length === 1
      ? "Counted as one possible independent component without relying on its unresolved path to development."
      : "Exact publication, receptor-construct, and VHH metadata identity conservatively cap these entries at one possible component.",
    formalDispositions: "PENDING_REQUIRED_METADATA",
  }));

  const directLookingIncrementUpperBound = publicLinks.length * 0
    + directAssessments.reduce((sum, row) => sum + row.independentComponentCountIncrementUpperBound, 0)
    + transitiveAssessments.reduce((sum, row) => sum + row.independentComponentCountIncrementUpperBound, 0);
  const directLookingPlusExistingUpperBound = census.screenedProvisionalGroupCount + directLookingIncrementUpperBound;
  ok(directLookingIncrementUpperBound === 2 && directLookingPlusExistingUpperBound === 9, "The direct-stratum upper bound drifted.");
  const queueIds = new Set(queue.map((row) => row.pdbId));
  const otherPendingIds = dispositions.filter((row) => row.dispositionCode === "PENDING_REQUIRED_METADATA" && !queueIds.has(row.pdbId)).map((row) => row.pdbId).sort(byteCompare);
  const otherPendingNondevelopmentRows = otherPendingIds.length;
  ok(otherPendingNondevelopmentRows === 243, "The remaining pending-row count drifted.");
  const namedCensusIds = new Set(targetCensus.map((row) => row.pdbId));
  const alreadyNamedOtherPendingIds = otherPendingIds.filter((pdbId) => namedCensusIds.has(pdbId));
  ok(canonical(alreadyNamedOtherPendingIds) === canonical(["7E6U", "8JXS", "8QJ2"]), "The pending rows already named in the v2 census drifted.");
  const otherPendingNotNamedInExistingCensusCount = otherPendingNondevelopmentRows - alreadyNamedOtherPendingIds.length;
  ok(otherPendingNotNamedInExistingCensusCount === 240, "The unrepresented pending-row count drifted.");

  const assessments = [
    {
      category: "NO_DEVELOPMENT_PATH_BUT_LINKED_TO_EXISTING_PROVISIONAL",
      entryCount: publicLinks.length,
      pdbIds: publicLinks.map((row) => row.pdbId),
      independentComponentCountIncrementUpperBound: 0,
    },
    {
      category: "ONE_EDGE_DEVELOPMENT_PATH",
      entryCount: directAssessments.length,
      pdbIds: directAssessments.map((row) => row.pdbId),
      independentComponentCountIncrementUpperBound: 0,
    },
    {
      category: "TRANSITIVE_PATH_CONSERVATIVELY_COUNTED_WITHOUT_DEVELOPMENT_EXCLUSION",
      entryCount: transitiveRows.length,
      pdbIds: transitiveIds,
      possibleComponentGroups: transitiveComponents,
      independentComponentCountIncrementUpperBound: transitiveAssessments.length,
    },
  ];
  const summary = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    recordedAtUtc: "2026-09-04T20:39:00Z",
    directLookingNondevelopmentEntryCount: queue.length,
    directLookingEntryIncrementUpperBound: directLookingIncrementUpperBound,
    existingProvisionalComponentCount: census.screenedProvisionalGroupCount,
    existingPlusDirectLookingUpperBound: directLookingPlusExistingUpperBound,
    requiredIndependentComponentCount: census.requiredIndependentGroups,
    directLookingStratumAloneCanMeetMinimum: false,
    otherPendingNondevelopmentRowCount: otherPendingNondevelopmentRows,
    otherPendingRowsAlreadyNamedInExistingCensus: alreadyNamedOtherPendingIds,
    otherPendingRowsNotNamedInExistingCensusCount: otherPendingNotNamedInExistingCensusCount,
    minimumAdditionalComponentsRequiredFromOtherPendingRows: census.requiredIndependentGroups - directLookingPlusExistingUpperBound,
    interpretation: "Even granting the unresolved transitive rows their most favorable conservative count, the prioritized direct-looking stratum can raise seven existing provisional components to at most nine. Three of the other 243 pending rows are already named representatives of those seven components, so at least one additional component must be found among the other 240 rows not named in the existing census; more are required if any existing provisional component fails later gates.",
    wholeCensusTerminalDecisionReached: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
  };
  const scriptBytes = await readFile(HERE);
  const assessmentBytes = Buffer.from(jsonl(assessments));
  const directBytes = Buffer.from(jsonl(directAssessments));
  const transitiveBytes = Buffer.from(jsonl(transitiveAssessments));
  const summaryBytes = Buffer.from(pretty(summary));
  const manifest = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    generatorScript: path.relative(root, HERE),
    generatorScriptSha256: sha256(scriptBytes),
    inputDigests: Object.fromEntries(INPUT_RELS.map((relative) => [relative, inputs.get(relative).sha256])),
    outputDigests: {
      "category-assessments.jsonl": sha256(assessmentBytes),
      "direct-development-assessments.jsonl": sha256(directBytes),
      "transitive-upper-bound-groups.jsonl": sha256(transitiveBytes),
      "summary.json": sha256(summaryBytes),
    },
    scope: "Prioritized 29-entry direct-looking nondevelopment stratum only; not the complete 287-entry census.",
    wholeCensusTerminalDecisionReached: false,
    formalTargetDispositionsAssigned: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
  };
  return { assessments, directAssessments, transitiveAssessments, summary, manifest };
}

async function writeOutputs(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  const output = directPath(root, OUTPUT_REL, "output directory");
  await mkdir(output, { recursive: true });
  const result = await build(root);
  const readme = `# Direct-looking stratum upper bound: 2026-09-04\n\nThe 29 nondevelopment entries in the prioritized direct-looking queue can add at most **two** independent components. Nineteen have a one-edge public pregraph path to development, six are publicly linked to existing provisional components, and the four remaining transitive-path entries form at most two groups when only definite metadata identity is used.\n\nStarting from seven existing provisional components, this stratum reaches at most nine—below the required ten. Therefore further detailed review within this 29-entry stratum cannot by itself rescue the formal holdout. Of the other 243 pending nondevelopment rows, three (\`7E6U\`, \`8JXS\`, and \`8QJ2\`) are already named in the seven-component census. At least one new independent component must be found among the remaining 240 rows, and more would be needed if any of the current seven fail later gates.\n\nThis is a stratum bound, not a terminal whole-census decision. It assigns no final target dispositions and authorizes no target freeze, native access, MSA retrieval, generator run, or label access.\n\nRegenerate and verify with:\n\n\`\`\`bash\nnode scripts/hard-decoy-v3/build-direct-stratum-bound.mjs\nnode --test tests/hard-decoy-v3-direct-stratum-bound.test.mjs\n\`\`\`\n`;
  const files = new Map([
    ["README.md", Buffer.from(readme)],
    ["category-assessments.jsonl", Buffer.from(jsonl(result.assessments))],
    ["direct-development-assessments.jsonl", Buffer.from(jsonl(result.directAssessments))],
    ["manifest.json", Buffer.from(pretty(result.manifest))],
    ["summary.json", Buffer.from(pretty(result.summary))],
    ["transitive-upper-bound-groups.jsonl", Buffer.from(jsonl(result.transitiveAssessments))],
  ]);
  for (const [name, bytes] of files) await writeFile(path.join(output, name), bytes);
  const checksums = [...files.entries()].sort(([a], [b]) => byteCompare(a, b)).map(([name, bytes]) => `${sha256(bytes)}  ${name}`).join("\n") + "\n";
  await writeFile(path.join(output, "checksums.sha256"), checksums);
  return { output, ...result };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const result = await writeOutputs();
  process.stdout.write(`${result.summary.status}: ${result.summary.existingPlusDirectLookingUpperBound}/${result.summary.requiredIndependentComponentCount}\n`);
}

export { build, writeOutputs };
