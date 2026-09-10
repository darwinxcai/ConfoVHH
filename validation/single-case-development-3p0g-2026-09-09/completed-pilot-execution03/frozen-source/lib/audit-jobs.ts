import {
  analyzeInterface,
  parsePaeJson,
  type ConfidenceMode,
  type InterfaceAudit,
  type ParsedPae,
  type ParsedStructure,
} from "./confovhh.ts";
import { parseCoordinateText } from "./coordinate-parser.ts";
import {
  MAX_ENSEMBLE_POSES,
  matchEnsembleChains,
  selectedCoordinateFingerprint,
  selectedGeometryFingerprint,
  summarizePoseEnsemble,
  type EnsemblePoseInput,
  type PoseEnsembleSummary,
} from "./pose-ensemble.ts";
import {
  canonicalizeSelectedGeometry,
  geometryFitIsDuplicate,
  selectedGeometryAtoms,
  selectedGeometryFit,
  type RigidGeometryComparison,
} from "./geometry-fit.ts";
import {
  summarizeStatePair,
  type StatePairSummary,
} from "./state-pair.ts";

const MEBIBYTE = 1024 * 1024;
const MAX_COORDINATE_SOURCE_BYTES = 12 * MEBIBYTE;
const MAX_COORDINATE_SOURCE_CHARACTERS = 12 * MEBIBYTE;
const MAX_PAE_SOURCE_CHARACTERS = 16 * MEBIBYTE;
const MAX_ENSEMBLE_SOURCE_BYTES = 48 * MEBIBYTE;
const MAX_ENSEMBLE_SOURCE_CHARACTERS = 48 * MEBIBYTE;
const MAX_PARSED_ATOMS_PER_STRUCTURE = 60_000;
const MAX_PARSED_CHAINS_PER_STRUCTURE = 256;
const MAX_ENSEMBLE_PARSED_ATOMS = 240_000;
const MAX_ENSEMBLE_CONTACT_PAIRS = 10_000;
const MAX_STATE_PAIR_PARSED_ATOMS = 120_000;
const MAX_STATE_PAIR_CONTACT_PAIRS = 10_000;
const MAX_SOURCE_FILENAME_CHARACTERS = 1_024;
const MAX_SELECTION_ID_CHARACTERS = 256;

export interface SingleAuditJob {
  structure: ParsedStructure;
  receptorChain: string;
  vhhChain: string;
  confidenceMode: ConfidenceMode;
  pae: ParsedPae | null;
  paeOrderConfirmed: boolean;
}

export interface ParseCoordinateJob {
  filename: string;
  text: string;
  assemblyId?: string | null;
  modelId?: string | null;
}

export interface ParsePaeJob {
  filename: string;
  text: string;
  structure: ParsedStructure;
}

export interface EnsembleCoordinateFile {
  filename: string;
  text: string;
  sha256: string;
  bytes: number;
  assemblyId?: string | null;
}

export interface EnsembleAuditJob {
  reference: {
    filename: string;
    sha256: string | null;
    bytes: number | null;
    structure: ParsedStructure;
    receptorChain: string;
    vhhChain: string;
  };
  candidates: EnsembleCoordinateFile[];
}

export interface RejectedEnsemblePose {
  filename: string;
  sha256: string;
  bytes: number;
  reason: string;
}

export interface EnsembleAuditJobResult {
  summary: PoseEnsembleSummary;
  rejected: RejectedEnsemblePose[];
  comparisonMode: string;
}

export interface StatePairCoordinateFile {
  filename: string;
  text: string;
  sha256: string;
  bytes: number;
  assemblyId?: string | null;
  modelId?: string | null;
}

export interface StatePairAuditJob {
  reference: {
    filename: string;
    sha256: string | null;
    bytes: number | null;
    structure: ParsedStructure;
    receptorChain: string;
    vhhChain: string;
    label?: string | null;
  };
  comparison: StatePairCoordinateFile & { label?: string | null };
}

export interface StatePairAuditJobResult {
  summary: StatePairSummary;
  comparisonMode: string;
}

function normalizedSha256(value: string | null, label: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${label} must be a 64-character hexadecimal SHA-256 digest.`);
  }
  return value.toLowerCase();
}

function assertSourceFileMetadata(
  filename: string,
  bytes: number | null,
  label: string,
): void {
  if (typeof filename !== "string" || filename.length > MAX_SOURCE_FILENAME_CHARACTERS ||
      !filename.trim() || /[\u0000-\u001f\u007f]/u.test(filename)) {
    throw new Error(`${label} requires a non-empty filename.`);
  }
  if (bytes != null && (!Number.isSafeInteger(bytes) || bytes < 0)) {
    throw new Error(`${label} byte count must be a non-negative safe integer when present.`);
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertCoordinateText(text: unknown, label: string): asserts text is string {
  if (typeof text !== "string") {
    throw new Error(`${label} text is required.`);
  }
  if (text.length > MAX_COORDINATE_SOURCE_CHARACTERS) {
    throw new Error(`${label} exceeds the 12 MiB decoded-text limit.`);
  }
}

function assertPaeText(text: unknown): asserts text is string {
  if (typeof text !== "string") {
    throw new Error("PAE source text is required.");
  }
  if (text.length > MAX_PAE_SOURCE_CHARACTERS) {
    throw new Error("PAE source exceeds the 16 MiB decoded-text limit.");
  }
}

function assertOptionalSelectionId(value: unknown, label: string): void {
  if (value == null) return;
  if (typeof value !== "string" || value.length > MAX_SELECTION_ID_CHARACTERS ||
      !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be a non-empty bounded string when present.`);
  }
}

function assertRequiredSelectionId(value: unknown, label: string): asserts value is string {
  assertOptionalSelectionId(value, label);
  if (value == null) {
    throw new Error(`${label} is required.`);
  }
}

function assertOptionalLabel(value: unknown, label: string): void {
  if (value == null) return;
  if (typeof value !== "string" || value.length > 512 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be a bounded text string when present.`);
  }
}

function assertParsedStructureEnvelope(
  value: unknown,
  label: string,
): asserts value is ParsedStructure {
  assertRecord(value, label);
  const structure = value as Partial<ParsedStructure>;
  if (!Array.isArray(structure.atoms) || !Array.isArray(structure.chains)) {
    throw new Error(`${label} is missing parsed atom or chain records.`);
  }
  if (structure.atoms.length > MAX_PARSED_ATOMS_PER_STRUCTURE) {
    throw new Error(
      `${label} exceeds the ${MAX_PARSED_ATOMS_PER_STRUCTURE.toLocaleString()}-atom parsed-structure limit.`,
    );
  }
  if (structure.chains.length < 1 || structure.chains.length > MAX_PARSED_CHAINS_PER_STRUCTURE) {
    throw new Error(
      `${label} must contain between 1 and ${MAX_PARSED_CHAINS_PER_STRUCTURE} parsed chains.`,
    );
  }
  if (structure.sourceFormat !== "pdb" && structure.sourceFormat !== "mmcif") {
    throw new Error(`${label} has an invalid coordinate source format.`);
  }
  const observedChainIds = new Set<string>();
  let nestedResidueCount = 0;
  let nestedAtomCount = 0;
  for (let chainIndex = 0; chainIndex < structure.chains.length; chainIndex += 1) {
    const chain = structure.chains[chainIndex];
    assertRecord(chain, `${label} chain ${chainIndex + 1}`);
    assertRequiredSelectionId(chain.id, `${label} chain ${chainIndex + 1} identifier`);
    if (observedChainIds.has(chain.id)) {
      throw new Error(`${label} contains a duplicate parsed-chain identifier.`);
    }
    observedChainIds.add(chain.id);
    if (!Array.isArray(chain.residues) ||
        !Number.isSafeInteger(chain.residueCount) || chain.residueCount !== chain.residues.length ||
        !Number.isSafeInteger(chain.atomCount) || chain.atomCount < 0) {
      throw new Error(`${label} chain ${chain.id} has inconsistent parsed counts.`);
    }
    nestedResidueCount += chain.residues.length;
    if (nestedResidueCount > MAX_PARSED_ATOMS_PER_STRUCTURE) {
      throw new Error(`${label} exceeds the bounded parsed-residue inventory.`);
    }
    let chainAtomCount = 0;
    for (let residueIndex = 0; residueIndex < chain.residues.length; residueIndex += 1) {
      const residue = chain.residues[residueIndex];
      assertRecord(residue, `${label} chain ${chain.id} residue ${residueIndex + 1}`);
      if (!Array.isArray(residue.atoms)) {
        throw new Error(`${label} contains a residue without a bounded atom inventory.`);
      }
      chainAtomCount += residue.atoms.length;
      nestedAtomCount += residue.atoms.length;
      if (chainAtomCount > MAX_PARSED_ATOMS_PER_STRUCTURE ||
          nestedAtomCount > MAX_PARSED_ATOMS_PER_STRUCTURE) {
        throw new Error(`${label} exceeds the bounded nested-atom inventory.`);
      }
    }
    if (chain.atomCount !== chainAtomCount) {
      throw new Error(`${label} chain ${chain.id} has inconsistent parsed atom counts.`);
    }
  }
  if (nestedAtomCount !== structure.atoms.length) {
    throw new Error(`${label} has inconsistent top-level and nested atom inventories.`);
  }
}

function checkedAggregate(
  values: readonly number[],
  maximum: number,
  message: string,
): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || total > maximum - value) {
      throw new Error(message);
    }
    total += value;
  }
  return total;
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface PreparedEnsembleGeometry {
  isReference: boolean;
  filename: string;
  sha256: string;
  bytes: number;
  assemblyId: string | null;
  structure: ParsedStructure;
  receptorChain: string;
  vhhChain: string;
  coordinateFingerprint: string;
  geometryFingerprint: string;
  geometrySignature: number[];
}

/**
 * Full-precision coordinates in the deterministic proper-signed canonical
 * frame form an SE(3)-invariant ordering key. This is deliberately separate
 * from the coarse public provenance fingerprint: a hash collision or 0.01 A
 * quantization boundary must not decide which member represents a duplicate
 * component. External identifiers are consulted only when these geometry
 * vectors and every medoid error are exactly indistinguishable.
 */
function invariantGeometrySignature(
  canonicalStructure: ParsedStructure,
  receptorChain: string,
  vhhChain: string,
): number[] {
  const signature: number[] = [];
  for (const { atom } of selectedGeometryAtoms(
    canonicalStructure,
    receptorChain,
    vhhChain,
  )) {
    signature.push(atom.x, atom.y, atom.z);
  }
  return signature;
}

function compareGeometrySignatures(left: readonly number[], right: readonly number[]): number {
  const commonLength = Math.min(left.length, right.length);
  for (let index = 0; index < commonLength; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return left.length - right.length;
}

function externalGeometryTieBreak(pose: PreparedEnsembleGeometry): string {
  return JSON.stringify([
    pose.sha256,
    pose.assemblyId,
    pose.filename,
    pose.coordinateFingerprint,
  ]);
}

function comparePreparedGeometry(
  left: PreparedEnsembleGeometry,
  right: PreparedEnsembleGeometry,
): number {
  return compareGeometrySignatures(left.geometrySignature, right.geometrySignature) ||
    codeUnitCompare(externalGeometryTieBreak(left), externalGeometryTieBreak(right));
}

function stableFiniteSum(values: number[]): number {
  return values.sort((left, right) => left - right).reduce((sum, value) => sum + value, 0);
}

export function executeSingleAuditJob(job: SingleAuditJob): InterfaceAudit {
  assertRecord(job, "Single-audit job");
  assertParsedStructureEnvelope(job.structure, "Single-audit parsed structure");
  assertRequiredSelectionId(job.receptorChain, "Receptor chain identifier");
  assertRequiredSelectionId(job.vhhChain, "VHH chain identifier");
  if (job.receptorChain === job.vhhChain) {
    throw new Error("Receptor and VHH chain identifiers must be distinct.");
  }
  if (job.confidenceMode !== "none" && job.confidenceMode !== "plddt") {
    throw new Error("Single-audit confidence mode is invalid.");
  }
  if (typeof job.paeOrderConfirmed !== "boolean") {
    throw new Error("Single-audit PAE order confirmation must be boolean.");
  }
  if (job.pae != null) {
    assertRecord(job.pae, "Single-audit PAE attachment");
    if (!(job.pae.matrix instanceof Float32Array)) {
      throw new Error("Single-audit PAE attachment requires a Float32 matrix.");
    }
  }
  return analyzeInterface(
    job.structure,
    job.receptorChain,
    job.vhhChain,
    job.confidenceMode,
    job.pae,
    job.paeOrderConfirmed,
  );
}

export function executeParseCoordinateJob(job: ParseCoordinateJob): ParsedStructure {
  assertRecord(job, "Coordinate parse job");
  assertSourceFileMetadata(job.filename, null, "Coordinate source");
  assertCoordinateText(job.text, "Coordinate source");
  assertOptionalSelectionId(job.assemblyId, "Assembly identifier");
  assertOptionalSelectionId(job.modelId, "Model identifier");
  const structure = parseCoordinateText(job.text, job.filename, {
    assemblyId: job.assemblyId,
    modelId: job.modelId,
  });
  assertParsedStructureEnvelope(structure, "Parsed coordinate structure");
  return structure;
}

export function executeParsePaeJob(job: ParsePaeJob): ParsedPae {
  assertRecord(job, "PAE parse job");
  assertSourceFileMetadata(job.filename, null, "PAE source");
  assertPaeText(job.text);
  assertParsedStructureEnvelope(job.structure, "PAE target parsed structure");
  return parsePaeJson(job.text, job.structure, job.filename);
}

export function executeEnsembleAuditJob(
  job: EnsembleAuditJob,
  onProgress: (completed: number, total: number, filename: string) => void = () => {},
): EnsembleAuditJobResult {
  assertRecord(job, "Ensemble audit job");
  if (!Array.isArray(job.candidates) || job.candidates.length < 1) {
    throw new Error("Ensemble audit requires at least one candidate pose.");
  }
  if (job.candidates.length > MAX_ENSEMBLE_POSES - 1) {
    throw new Error(
      `Ensemble audit supports at most ${MAX_ENSEMBLE_POSES - 1} candidates plus the reference pose.`,
    );
  }
  assertRecord(job.reference, "Reference coordinate source");
  assertSourceFileMetadata(
    job.reference.filename,
    job.reference.bytes,
    "Reference coordinate source",
  );
  const referenceSha256 = normalizedSha256(
    job.reference.sha256,
    "Reference coordinate source digest",
  );
  if (referenceSha256 == null || job.reference.bytes == null) {
    throw new Error("Reference coordinate source requires SHA-256 and byte-count provenance.");
  }
  if (job.reference.bytes > MAX_COORDINATE_SOURCE_BYTES) {
    throw new Error("Reference coordinate source exceeds the 12 MiB per-file limit.");
  }
  const normalizedCandidates = job.candidates.map((candidate, index) => {
    assertRecord(candidate, `Candidate ${index + 1} coordinate source`);
    assertSourceFileMetadata(
      candidate.filename,
      candidate.bytes,
      `Candidate ${index + 1} coordinate source`,
    );
    assertCoordinateText(candidate.text, `Candidate ${index + 1} coordinate source`);
    assertOptionalSelectionId(candidate.assemblyId, `Candidate ${index + 1} assembly identifier`);
    const sha256 = normalizedSha256(
      candidate.sha256,
      `Candidate ${index + 1} coordinate source digest`,
    );
    if (sha256 == null) {
      throw new Error(`Candidate ${index + 1} coordinate source digest is required.`);
    }
    if (candidate.bytes > MAX_COORDINATE_SOURCE_BYTES) {
      throw new Error(`Candidate ${index + 1} coordinate source exceeds the 12 MiB per-file limit.`);
    }
    return { ...candidate, sha256 };
  });
  checkedAggregate(
    [job.reference.bytes, ...normalizedCandidates.map((candidate) => candidate.bytes)],
    MAX_ENSEMBLE_SOURCE_BYTES,
    "Ensemble coordinate sources exceed the 48 MiB aggregate declared-byte limit.",
  );
  checkedAggregate(
    normalizedCandidates.map((candidate) => candidate.text.length),
    MAX_ENSEMBLE_SOURCE_CHARACTERS,
    "Ensemble candidate sources exceed the 48 MiB aggregate decoded-text limit.",
  );
  assertParsedStructureEnvelope(job.reference.structure, "Reference parsed structure");
  assertRequiredSelectionId(job.reference.receptorChain, "Reference receptor chain identifier");
  assertRequiredSelectionId(job.reference.vhhChain, "Reference VHH chain identifier");
  if (job.reference.receptorChain === job.reference.vhhChain) {
    throw new Error("Reference receptor and VHH chain identifiers must be distinct.");
  }
  const referenceReceptor = job.reference.structure.chains.find(
    (chain) => chain.id === job.reference.receptorChain,
  );
  const referenceVhh = job.reference.structure.chains.find(
    (chain) => chain.id === job.reference.vhhChain,
  );
  if (!referenceReceptor || !referenceVhh) {
    throw new Error("The reference receptor or VHH chain is missing from the parsed structure.");
  }

  const referenceSasaStructure = canonicalizeSelectedGeometry(
    job.reference.structure,
    job.reference.receptorChain,
    job.reference.vhhChain,
  );
  const referenceAudit = analyzeInterface(
    job.reference.structure,
    job.reference.receptorChain,
    job.reference.vhhChain,
    "none",
    null,
    false,
    referenceSasaStructure,
  );
  const referenceCoordinateFingerprint = selectedCoordinateFingerprint(
    job.reference.structure,
    job.reference.receptorChain,
    job.reference.vhhChain,
  );
  const referenceGeometryFingerprint = selectedGeometryFingerprint(
    job.reference.structure,
    job.reference.receptorChain,
    job.reference.vhhChain,
  );
  let parsedAtomCount = job.reference.structure.atoms.length;
  let auditedContactPairCount = referenceAudit.contacts.length;
  if (parsedAtomCount > MAX_ENSEMBLE_PARSED_ATOMS) {
    throw new Error("Ensemble poses exceed the 240,000-atom aggregate parsed-structure budget.");
  }
  if (auditedContactPairCount > MAX_ENSEMBLE_CONTACT_PAIRS) {
    throw new Error("Ensemble poses exceed the 10,000-contact aggregate audit budget.");
  }
  const referenceInput: EnsemblePoseInput = {
    id: `${referenceSha256 ?? "reference"}:${referenceCoordinateFingerprint}`,
    filename: job.reference.filename,
    sha256: referenceSha256,
    bytes: job.reference.bytes,
    structure: job.reference.structure,
    audit: referenceAudit,
    coordinateFingerprint: referenceCoordinateFingerprint,
    geometryFingerprint: referenceGeometryFingerprint,
  };
  const inputs: EnsemblePoseInput[] = [referenceInput];
  const rejected: RejectedEnsemblePose[] = [];
  const referenceGeometry: PreparedEnsembleGeometry = {
    isReference: true,
    filename: job.reference.filename,
    sha256: referenceSha256,
    bytes: job.reference.bytes,
    assemblyId: job.reference.structure.selectedAssembly?.id ?? null,
    structure: job.reference.structure,
    receptorChain: job.reference.receptorChain,
    vhhChain: job.reference.vhhChain,
    coordinateFingerprint: referenceCoordinateFingerprint,
    geometryFingerprint: referenceGeometryFingerprint,
    geometrySignature: invariantGeometrySignature(
      referenceSasaStructure,
      job.reference.receptorChain,
      job.reference.vhhChain,
    ),
  };
  const preparedCandidates: PreparedEnsembleGeometry[] = [];
  const orderedCandidates = normalizedCandidates.sort((left, right) => (
    codeUnitCompare(left.sha256, right.sha256) ||
    codeUnitCompare(left.assemblyId ?? "", right.assemblyId ?? "") ||
    codeUnitCompare(left.filename, right.filename)
  ));

  for (let index = 0; index < orderedCandidates.length; index += 1) {
    const candidate = orderedCandidates[index];
    try {
      if (parsedAtomCount >= MAX_ENSEMBLE_PARSED_ATOMS) {
        throw new Error("Ensemble poses exhausted the 240,000-atom aggregate parsed-structure budget.");
      }
      const structure = parseCoordinateText(candidate.text, candidate.filename, {
        assemblyId: candidate.assemblyId,
      });
      assertParsedStructureEnvelope(structure, `Candidate ${index + 1} parsed structure`);
      parsedAtomCount += structure.atoms.length;
      if (parsedAtomCount > MAX_ENSEMBLE_PARSED_ATOMS) {
        throw new Error("Ensemble poses exceed the 240,000-atom aggregate parsed-structure budget.");
      }
      if (structure.modelCount > 1) {
        throw new Error(
          `The file contains ${structure.modelCount} coordinate models. Extract one model per file before ensemble comparison.`,
        );
      }
      const matched = matchEnsembleChains(
        structure,
        referenceReceptor.sequence,
        referenceVhh.sequence,
      );
      const referenceFit = selectedGeometryFit(
        job.reference.structure,
        job.reference.receptorChain,
        job.reference.vhhChain,
        structure,
        matched.receptorChain,
        matched.vhhChain,
      );
      if (referenceFit == null) {
        throw new Error(
          "The selected receptor–VHH atom inventory is incompatible with the reference. " +
          "Every compared pose must contain the same unambiguous atom identities.",
        );
      }
      const coordinateFingerprint = selectedCoordinateFingerprint(
        structure,
        matched.receptorChain,
        matched.vhhChain,
      );
      const geometryFingerprint = selectedGeometryFingerprint(
        structure,
        matched.receptorChain,
        matched.vhhChain,
      );
      const sasaStructure = canonicalizeSelectedGeometry(
        structure,
        matched.receptorChain,
        matched.vhhChain,
      );
      preparedCandidates.push({
        isReference: false,
        filename: candidate.filename,
        sha256: candidate.sha256,
        bytes: candidate.bytes,
        assemblyId: candidate.assemblyId ?? null,
        structure,
        receptorChain: matched.receptorChain,
        vhhChain: matched.vhhChain,
        coordinateFingerprint,
        geometryFingerprint,
        geometrySignature: invariantGeometrySignature(
          sasaStructure,
          matched.receptorChain,
          matched.vhhChain,
        ),
      });
    } catch (caught) {
      rejected.push({
        filename: candidate.filename,
        sha256: candidate.sha256,
        bytes: candidate.bytes,
        reason: caught instanceof Error ? caught.message : "The pose could not be audited.",
      });
    } finally {
      onProgress(index + 1, orderedCandidates.length, candidate.filename);
    }
  }

  // Duplicate membership is a graph property rather than a greedy filter.
  // This matters because the documented proper-fit threshold is not transitive:
  // A may be close to B and B close to C even when A is not close to C.
  // Build every bounded fit first, then choose one deterministic representative
  // per connected component.
  preparedCandidates.sort(comparePreparedGeometry);
  const geometryNodes = [referenceGeometry, ...preparedCandidates];
  const pairwiseFits: Array<Array<RigidGeometryComparison | undefined>> =
    Array.from({ length: geometryNodes.length }, () => (
      new Array<RigidGeometryComparison | undefined>(geometryNodes.length)
    ));
  const duplicateNeighbors: number[][] = Array.from(
    { length: geometryNodes.length },
    () => [],
  );
  for (let left = 0; left < geometryNodes.length; left += 1) {
    for (let right = left + 1; right < geometryNodes.length; right += 1) {
      const leftNode = geometryNodes[left];
      const rightNode = geometryNodes[right];
      const fit = selectedGeometryFit(
        leftNode.structure,
        leftNode.receptorChain,
        leftNode.vhhChain,
        rightNode.structure,
        rightNode.receptorChain,
        rightNode.vhhChain,
      );
      // Every candidate was already checked against the reference inventory,
      // so pairwise incompatibility here indicates a violated invariant. Fail
      // closed instead of treating a null fit as evidence of distinct geometry.
      if (fit == null) {
        throw new Error(
          `Selected atom inventories became incompatible while comparing ` +
          `${leftNode.filename} with ${rightNode.filename}.`,
        );
      }
      pairwiseFits[left][right] = fit;
      pairwiseFits[right][left] = fit;
      if (geometryFitIsDuplicate(fit)) {
        duplicateNeighbors[left].push(right);
        duplicateNeighbors[right].push(left);
      }
    }
  }

  const components: number[][] = [];
  const visited = new Set<number>();
  for (let start = 0; start < geometryNodes.length; start += 1) {
    if (visited.has(start)) continue;
    const component: number[] = [];
    const pending = [start];
    visited.add(start);
    while (pending.length) {
      const current = pending.pop()!;
      component.push(current);
      for (const neighbor of duplicateNeighbors[current]) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    component.sort((left, right) => comparePreparedGeometry(
      geometryNodes[left],
      geometryNodes[right],
    ));
    components.push(component);
  }

  const representativeForComponent = (component: number[]): number => {
    if (component.includes(0)) return 0;
    let best = component[0];
    let bestRmsdSum = Number.POSITIVE_INFINITY;
    let bestMaximumDeviationSum = Number.POSITIVE_INFINITY;
    for (const candidateIndex of component) {
      const fits = component
        .filter((otherIndex) => otherIndex !== candidateIndex)
        .map((otherIndex) => pairwiseFits[candidateIndex][otherIndex]!);
      const rmsdSum = stableFiniteSum(fits.map((fit) => fit.rmsdAngstrom));
      const maximumDeviationSum = stableFiniteSum(
        fits.map((fit) => fit.maximumDeviationAngstrom),
      );
      const geometryOrder = comparePreparedGeometry(
        geometryNodes[candidateIndex],
        geometryNodes[best],
      );
      if (
        rmsdSum < bestRmsdSum ||
        (rmsdSum === bestRmsdSum && maximumDeviationSum < bestMaximumDeviationSum) ||
        (rmsdSum === bestRmsdSum &&
          maximumDeviationSum === bestMaximumDeviationSum && geometryOrder < 0)
      ) {
        best = candidateIndex;
        bestRmsdSum = rmsdSum;
        bestMaximumDeviationSum = maximumDeviationSum;
      }
    }
    return best;
  };

  const componentSelections = components.map((members) => ({
    members,
    representative: representativeForComponent(members),
    retained: false,
    representativeFailure: null as string | null,
  }));
  componentSelections.sort((left, right) => {
    if (left.representative === 0) return -1;
    if (right.representative === 0) return 1;
    return comparePreparedGeometry(
      geometryNodes[left.representative],
      geometryNodes[right.representative],
    );
  });

  for (const selection of componentSelections) {
    const representative = geometryNodes[selection.representative];
    if (representative.isReference) {
      selection.retained = true;
      continue;
    }
    try {
      // Scientific ledgers are allocated only for the one selected
      // representative of each candidate-only component. Duplicate
      // nonrepresentatives never reach analyzeInterface().
      const sasaStructure = canonicalizeSelectedGeometry(
        representative.structure,
        representative.receptorChain,
        representative.vhhChain,
      );
      const audit = analyzeInterface(
        representative.structure,
        representative.receptorChain,
        representative.vhhChain,
        "none",
        null,
        false,
        sasaStructure,
      );
      if (auditedContactPairCount >
          MAX_ENSEMBLE_CONTACT_PAIRS - audit.contacts.length) {
        throw new Error("Ensemble poses exceed the 10,000-contact aggregate audit budget.");
      }
      auditedContactPairCount += audit.contacts.length;
      inputs.push({
        id: `${representative.sha256}:${representative.coordinateFingerprint}`,
        filename: representative.filename,
        sha256: representative.sha256,
        bytes: representative.bytes,
        structure: representative.structure,
        audit,
        coordinateFingerprint: representative.coordinateFingerprint,
        geometryFingerprint: representative.geometryFingerprint,
      });
      selection.retained = true;
    } catch (caught) {
      const reason = caught instanceof Error
        ? caught.message
        : "The component representative could not be scientifically audited.";
      rejected.push({
        filename: representative.filename,
        sha256: representative.sha256,
        bytes: representative.bytes,
        reason,
      });
      selection.representativeFailure = reason;
    }
  }

  for (const selection of componentSelections) {
    if (selection.members.length < 2) continue;
    const representative = geometryNodes[selection.representative];
    for (const memberIndex of selection.members) {
      if (memberIndex === selection.representative) continue;
      const member = geometryNodes[memberIndex];
      const directFit = pairwiseFits[memberIndex][selection.representative]!;
      const relation = geometryFitIsDuplicate(directFit)
        ? `(direct proper-rotation fit RMSD ${directFit.rmsdAngstrom.toFixed(4)} Å; ` +
          `maximum deviation ${directFit.maximumDeviationAngstrom.toFixed(4)} Å)`
        : "(connected transitively by proper-rotation duplicate-threshold edges)";
      const selectionMethod = representative.isReference
        ? `the privileged reference ${representative.filename}`
        : `the deterministic geometry medoid ${representative.filename}`;
      rejected.push({
        filename: member.filename,
        sha256: member.sha256,
        bytes: member.bytes,
        reason: `Near-duplicate selected receptor–VHH geometry belongs to a component ` +
          `represented by ${selectionMethod} ${relation}; duplicate limits are 0.02 Å RMSD ` +
          `and 0.05 Å maximum deviation${selection.retained ? "." :
            ", but that representative could not be retained after scientific-audit and " +
            `resource validation (${selection.representativeFailure ?? "unspecified failure"}).`}`,
      });
    }
  }

  rejected.sort((left, right) => (
    codeUnitCompare(left.sha256, right.sha256) ||
    codeUnitCompare(left.filename, right.filename) ||
    codeUnitCompare(left.reason, right.reason)
  ));

  if (inputs.length < 2) {
    const detail = rejected.map((pose) => `${pose.filename}: ${pose.reason}`).join("; ");
    throw new Error(`No additional compatible pose could be audited.${detail ? ` ${detail}` : ""}`);
  }

  return {
    summary: summarizePoseEnsemble(inputs),
    rejected,
    comparisonMode: "Coordinate-only ensemble comparison: contacts and clashes use each source coordinate frame; approximate SASA alone uses a deterministic canonical selected-complex frame. PAE is omitted and B factors are not interpreted as pLDDT. Near-duplicate proper-fit edges are resolved as connected components: the reference is privileged in its component; every other component uses the medoid with minimum summed pairwise fit error, then a full-precision proper-signed invariant geometry signature, and only then an external identifier for an exact tie.",
  };
}

export function executeStatePairAuditJob(job: StatePairAuditJob): StatePairAuditJobResult {
  assertRecord(job, "Paired-state audit job");
  assertRecord(job.reference, "Reference coordinate source");
  assertRecord(job.comparison, "Comparison coordinate source");
  assertSourceFileMetadata(
    job.reference.filename,
    job.reference.bytes,
    "Reference coordinate source",
  );
  assertSourceFileMetadata(
    job.comparison.filename,
    job.comparison.bytes,
    "Comparison coordinate source",
  );
  const referenceSha256 = normalizedSha256(
    job.reference.sha256,
    "Reference coordinate source digest",
  );
  const comparisonSha256 = normalizedSha256(
    job.comparison.sha256,
    "Comparison coordinate source digest",
  );
  if (referenceSha256 == null || comparisonSha256 == null ||
      job.reference.bytes == null || job.comparison.bytes == null) {
    throw new Error("Paired coordinate sources require SHA-256 and byte-count provenance.");
  }
  if (job.reference.bytes > MAX_COORDINATE_SOURCE_BYTES ||
      job.comparison.bytes > MAX_COORDINATE_SOURCE_BYTES) {
    throw new Error("Each paired coordinate source must be no larger than 12 MiB.");
  }
  assertCoordinateText(job.comparison.text, "Comparison coordinate source");
  assertOptionalSelectionId(job.comparison.assemblyId, "Comparison assembly identifier");
  assertOptionalSelectionId(job.comparison.modelId, "Comparison model identifier");
  assertOptionalLabel(job.reference.label, "Reference state label");
  assertOptionalLabel(job.comparison.label, "Comparison state label");
  checkedAggregate(
    [job.reference.bytes, job.comparison.bytes],
    MAX_ENSEMBLE_SOURCE_BYTES,
    "Paired coordinate sources exceed the 48 MiB aggregate declared-byte limit.",
  );
  assertParsedStructureEnvelope(job.reference.structure, "Reference parsed structure");
  assertRequiredSelectionId(job.reference.receptorChain, "Reference receptor chain identifier");
  assertRequiredSelectionId(job.reference.vhhChain, "Reference VHH chain identifier");
  if (job.reference.receptorChain === job.reference.vhhChain) {
    throw new Error("Reference receptor and VHH chain identifiers must be distinct.");
  }
  const referenceReceptor = job.reference.structure.chains.find(
    (chain) => chain.id === job.reference.receptorChain,
  );
  const referenceVhh = job.reference.structure.chains.find(
    (chain) => chain.id === job.reference.vhhChain,
  );
  if (!referenceReceptor || !referenceVhh) {
    throw new Error("The reference receptor or VHH chain is missing from the parsed structure.");
  }
  const comparisonStructure = parseCoordinateText(
    job.comparison.text,
    job.comparison.filename,
    { assemblyId: job.comparison.assemblyId, modelId: job.comparison.modelId },
  );
  assertParsedStructureEnvelope(comparisonStructure, "Comparison parsed structure");
  if (job.reference.structure.atoms.length + comparisonStructure.atoms.length >
      MAX_STATE_PAIR_PARSED_ATOMS) {
    throw new Error("Paired structures exceed the 120,000-atom aggregate parsed-structure budget.");
  }
  if (comparisonStructure.modelCount > 1 && job.comparison.modelId == null) {
    throw new Error(
      `The comparison contains ${comparisonStructure.modelCount} coordinate models. Select one model before paired comparison.`,
    );
  }
  const matched = matchEnsembleChains(
    comparisonStructure,
    referenceReceptor.sequence,
    referenceVhh.sequence,
  );
  const fit = selectedGeometryFit(
    job.reference.structure,
    job.reference.receptorChain,
    job.reference.vhhChain,
    comparisonStructure,
    matched.receptorChain,
    matched.vhhChain,
  );
  if (fit == null) {
    throw new Error(
      "The selected receptor–VHH atom inventory is incompatible with the reference. " +
      "Paired comparison requires the same unambiguous atom identities in both conditions.",
    );
  }
  if (geometryFitIsDuplicate(fit)) {
    throw new Error(
      `The reference and comparison are near-duplicate selected geometries ` +
      `(proper-rotation fit RMSD ${fit.rmsdAngstrom.toFixed(4)} Å; ` +
      `maximum deviation ${fit.maximumDeviationAngstrom.toFixed(4)} Å).`,
    );
  }

  const referenceSasa = canonicalizeSelectedGeometry(
    job.reference.structure,
    job.reference.receptorChain,
    job.reference.vhhChain,
  );
  const comparisonSasa = canonicalizeSelectedGeometry(
    comparisonStructure,
    matched.receptorChain,
    matched.vhhChain,
  );
  const referenceAudit = analyzeInterface(
    job.reference.structure,
    job.reference.receptorChain,
    job.reference.vhhChain,
    "none",
    null,
    false,
    referenceSasa,
  );
  const comparisonAudit = analyzeInterface(
    comparisonStructure,
    matched.receptorChain,
    matched.vhhChain,
    "none",
    null,
    false,
    comparisonSasa,
  );
  if (referenceAudit.contacts.length + comparisonAudit.contacts.length >
      MAX_STATE_PAIR_CONTACT_PAIRS) {
    throw new Error("Paired structures exceed the 10,000-contact aggregate audit budget.");
  }
  const referenceCoordinateFingerprint = selectedCoordinateFingerprint(
    job.reference.structure,
    job.reference.receptorChain,
    job.reference.vhhChain,
  );
  const comparisonCoordinateFingerprint = selectedCoordinateFingerprint(
    comparisonStructure,
    matched.receptorChain,
    matched.vhhChain,
  );
  const summary = summarizeStatePair({
    id: `${referenceSha256}:${referenceCoordinateFingerprint}`,
    label: job.reference.label,
    filename: job.reference.filename,
    sha256: referenceSha256,
    bytes: job.reference.bytes,
    structure: job.reference.structure,
    audit: referenceAudit,
    coordinateFingerprint: referenceCoordinateFingerprint,
    geometryFingerprint: selectedGeometryFingerprint(
      job.reference.structure,
      job.reference.receptorChain,
      job.reference.vhhChain,
    ),
  }, {
    id: `${comparisonSha256}:${comparisonCoordinateFingerprint}`,
    label: job.comparison.label,
    filename: job.comparison.filename,
    sha256: comparisonSha256,
    bytes: job.comparison.bytes,
    structure: comparisonStructure,
    audit: comparisonAudit,
    coordinateFingerprint: comparisonCoordinateFingerprint,
    geometryFingerprint: selectedGeometryFingerprint(
      comparisonStructure,
      matched.receptorChain,
      matched.vhhChain,
    ),
  });
  return {
    summary,
    comparisonMode: "Paired coordinate-only comparison with exact observed sequence matching and unambiguous chain assignment. All deltas are comparison minus reference. Contacts and clashes use source coordinates; approximate SASA alone uses a deterministic canonical selected-complex frame. PAE and pLDDT interpretation are omitted, and user labels are not treated as structural evidence.",
  };
}
