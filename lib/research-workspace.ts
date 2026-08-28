import {
  CDR_ANNOTATION_METHOD_DESCRIPTION,
  CONFOVHH_VERSION,
  PAE_SUMMARY_METHOD_DESCRIPTION,
  SASA_RADII_METHOD_DESCRIPTION,
  classifyCoordinateProvenance,
  type EvidenceLevel,
  type InterfaceAudit,
} from "./confovhh.ts";
import type { SingleAuditExportReport } from "./audit-export.ts";
import { CANONICAL_SASA_FRAME_ALGORITHM } from "./geometry-constants.ts";
import {
  createPoseEnsembleExportReport,
  type PoseEnsembleExportReport,
} from "./pose-ensemble.ts";
import {
  createStatePairExportReport,
  type StatePairExportReport,
} from "./state-pair.ts";
import {
  normalizeIntendedFootprintIdentifiers,
  validateIntendedFootprintSummary,
  type IntendedFootprintSummary,
} from "./user-footprint.ts";

export const CONFOVHH_PRODUCT_RELEASE = "0.9.0" as const;
export type SupportedConfoVhhProductRelease =
  | "0.6.0"
  | "0.7.0"
  | "0.8.0"
  | typeof CONFOVHH_PRODUCT_RELEASE;
const SUPPORTED_PRODUCT_RELEASES = new Set<SupportedConfoVhhProductRelease>([
  "0.6.0",
  "0.7.0",
  "0.8.0",
  CONFOVHH_PRODUCT_RELEASE,
]);
export const RESEARCH_WORKSPACE_BUNDLE_SCHEMA_VERSION = "1.0.0" as const;
export const NOTEBOOK_SCHEMA_VERSION = "1.0.0" as const;
export const NOTEBOOK_EXPORT_SCHEMA_VERSION = "1.0.0" as const;
export const MAX_NOTEBOOK_ENTRIES = 40;
export const MAX_NOTEBOOK_SERIALIZED_BYTES = 1_000_000;
export const MAX_WORKSPACE_BUNDLE_SERIALIZED_BYTES = 32 * 1024 * 1024;

export interface ResearchContext {
  studyName: string;
  receptorName: string;
  candidateId: string;
  coordinateContext: string;
  intendedFootprint: string;
  notes: string;
}

export interface WorkflowCoverage {
  paeAttached: boolean;
  ensemblePoseCount: number;
  pairedContextCompared: boolean;
}

export interface CoordinateSelectionProvenance {
  sourceFileBytes: number;
  sourceFormat: "pdb" | "mmcif";
  coordinateScope: "as-supplied" | "deposited-assembly";
  selectedModelId: string;
  selectedAssemblyId: string | null;
  selectedCoordinateFingerprint: string;
  selectedGeometryFingerprint: string;
  auditInputFingerprint: string;
  auditResultFingerprint: string;
  receptorChainInstance: SelectedChainInstanceProvenance;
  vhhChainInstance: SelectedChainInstanceProvenance;
}

export interface SelectedChainInstanceProvenance {
  id: string;
  labelAsymId: string | null;
  authAsymId: string | null;
  assemblyCopyIndex: number | null;
  assemblyGeneratorRowIndex: number | null;
  assemblyOperationIds: string[];
  assemblyTransform: Array<[number, number, number, number]> | null;
}

export type CoordinateTriageBand =
  | "retain-for-comparison"
  | "review-before-comparison"
  | "deprioritize-coordinate-pose"
  | "coordinate-geometry-coherent"
  | "coordinate-geometry-mixed"
  | "coordinate-geometry-limited"
  | "not-assessable";

export interface CoordinateTriageBrief {
  band: CoordinateTriageBand;
  title: string;
  summary: string;
  reviewItems: string[];
  evidenceGaps: string[];
  nextActions: string[];
  boundary: string;
}

export interface NotebookEntry {
  schemaVersion: typeof NOTEBOOK_SCHEMA_VERSION;
  id: string;
  deduplicationKey: string;
  savedAt: string;
  productRelease: SupportedConfoVhhProductRelease;
  engineVersion: string;
  context: ResearchContext;
  coordinate: {
    filename: string;
    sha256: string;
    receptorChain: string;
    vhhChain: string;
  } & CoordinateSelectionProvenance;
  triage: CoordinateTriageBrief;
  workflow: WorkflowCoverage;
  metrics: {
    evidenceLevel: EvidenceLevel;
    contactPairCount: number;
    severeClashCount: number;
    deltaSasaAngstrom2: number;
    paratopeProxyShare: number | null;
    cdr3ProxyShare: number | null;
    interfacePaeMedianAngstrom: number | null;
  };
  privacy: {
    rawCoordinatesAutomaticallyCopied: false;
    parsedSequencesAutomaticallyCopied: false;
    paeMatrixAutomaticallyCopied: false;
    residueContactTableAutomaticallyCopied: false;
    userEnteredContextStored: true;
  };
}

export interface WorkspaceBundle {
  schemaVersion: typeof RESEARCH_WORKSPACE_BUNDLE_SCHEMA_VERSION;
  productRelease: SupportedConfoVhhProductRelease;
  engineVersion: string;
  generatedAt: string;
  context: ResearchContext;
  workflow: WorkflowCoverage;
  coordinate: {
    filename: string;
    sha256: string;
    receptorChain: string;
    vhhChain: string;
  } & CoordinateSelectionProvenance;
  decisionBrief: CoordinateTriageBrief;
  userDefinedFootprint: IntendedFootprintSummary | null;
  reports: {
    singleAudit: SingleAuditExportReport;
    poseEnsemble: PoseEnsembleExportReport | null;
    pairedContext: StatePairExportReport | null;
  };
  claimBoundary: string;
}

const CLAIM_BOUNDARY =
  "ConfoVHH supports review of coordinate plausibility and recurrence within the uploaded pose set. It does not establish binding, affinity, specificity, stability, signaling, membrane compatibility, receptor-state identity, or conformational selectivity.";

const FIELD_LIMITS: Record<keyof ResearchContext, number> = {
  studyName: 100,
  receptorName: 80,
  candidateId: 80,
  coordinateContext: 100,
  intendedFootprint: 1_000,
  notes: 1_000,
};

function requireIsoTimestamp(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be a valid UTC ISO 8601 timestamp with millisecond precision.`);
  }
}

function requireSha256(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${label} must be a 64-character hexadecimal SHA-256 digest.`);
  }
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function requireExactKeys(value: object, expected: readonly string[], label: string): void {
  if (!hasExactKeys(value, expected)) {
    throw new Error(`${label} contains missing or unsupported fields.`);
  }
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left == null || right == null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((entry, index) => jsonEqual(entry, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(leftRecord[key], rightRecord[key]));
}

function validateChainInstanceProvenance(
  value: unknown,
  label: string,
): asserts value is SelectedChainInstanceProvenance {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const chain = value as SelectedChainInstanceProvenance;
  requireExactKeys(chain, [
    "id", "labelAsymId", "authAsymId", "assemblyCopyIndex",
    "assemblyGeneratorRowIndex", "assemblyOperationIds", "assemblyTransform",
  ], label);
  if (
    !validBoundedIdentifier(chain.id, 256) ||
    (chain.labelAsymId != null && !validBoundedIdentifier(chain.labelAsymId, 256)) ||
    (chain.authAsymId != null && !validBoundedIdentifier(chain.authAsymId, 256)) ||
    (chain.assemblyCopyIndex != null && (!Number.isSafeInteger(chain.assemblyCopyIndex) || chain.assemblyCopyIndex <= 0)) ||
    (chain.assemblyGeneratorRowIndex != null && (!Number.isSafeInteger(chain.assemblyGeneratorRowIndex) || chain.assemblyGeneratorRowIndex <= 0)) ||
    !Array.isArray(chain.assemblyOperationIds) || chain.assemblyOperationIds.length > 8 ||
    chain.assemblyOperationIds.some((entry) => !validBoundedIdentifier(entry, 256))
  ) throw new Error(`${label} contains invalid chain-instance identifiers.`);
  if (chain.assemblyTransform != null && (
    !Array.isArray(chain.assemblyTransform) || chain.assemblyTransform.length !== 3 ||
    chain.assemblyTransform.some((row) => (
      !Array.isArray(row) || row.length !== 4 || row.some((entry) => !Number.isFinite(entry))
    ))
  )) throw new Error(`${label} contains an invalid assembly transform.`);
}

function validateCoordinateSelectionProvenance(
  value: unknown,
  label: string,
): asserts value is CoordinateSelectionProvenance {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const selection = value as CoordinateSelectionProvenance;
  requireExactKeys(selection, [
    "sourceFileBytes", "sourceFormat", "coordinateScope", "selectedModelId", "selectedAssemblyId",
    "selectedCoordinateFingerprint", "selectedGeometryFingerprint",
    "auditInputFingerprint", "auditResultFingerprint", "receptorChainInstance", "vhhChainInstance",
  ], label);
  if (
    !Number.isSafeInteger(selection.sourceFileBytes) || selection.sourceFileBytes < 0 ||
    !["pdb", "mmcif"].includes(selection.sourceFormat) ||
    !["as-supplied", "deposited-assembly"].includes(selection.coordinateScope) ||
    typeof selection.selectedModelId !== "string" || !selection.selectedModelId ||
    (selection.selectedAssemblyId != null && (
      typeof selection.selectedAssemblyId !== "string" || !selection.selectedAssemblyId
    )) ||
    (selection.coordinateScope === "as-supplied" && selection.selectedAssemblyId != null) ||
    (selection.coordinateScope === "deposited-assembly" && (
      selection.sourceFormat !== "mmcif" || selection.selectedAssemblyId == null
    )) ||
    !/^fnv1a64-3dp:[0-9a-f]{16}$/.test(selection.selectedCoordinateFingerprint) ||
    !/^fnv1a64-se3-2dp:[0-9a-f]{16}$/.test(selection.selectedGeometryFingerprint) ||
    !/^fnv1a32x2-audit-input:[0-9a-f]{16}$/.test(selection.auditInputFingerprint) ||
    !/^fnv1a32x2-audit-result:[0-9a-f]{16}$/.test(selection.auditResultFingerprint)
  ) {
    throw new Error(`${label} contains invalid coordinate-selection or audit provenance.`);
  }
  validateChainInstanceProvenance(selection.receptorChainInstance, `${label} receptor chain`);
  validateChainInstanceProvenance(selection.vhhChainInstance, `${label} VHH chain`);
  if (selection.receptorChainInstance.id === selection.vhhChainInstance.id) {
    throw new Error(`${label} requires distinct receptor and VHH chain instances.`);
  }
}

function validBoundedNullableText(value: unknown, maximumLength: number): boolean {
  return value == null || (
    typeof value === "string" && value.length <= maximumLength &&
    !/[\p{Cf}\p{Zl}\p{Zp}\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value)
  );
}

function validBoundedIdentifier(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && Boolean(value) && value.length <= maximumLength &&
    !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function validateAssemblyDescriptor(value: unknown, label: string): void {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const assembly = value as {
    id: string;
    details: string | null;
    methodDetails: string | null;
    oligomericDetails: string | null;
    oligomericCount: number | null;
    generatorCount: number;
    generators: Array<{ sourceRowIndex: number; operationExpression: string; labelAsymIds: string[] }>;
  };
  requireExactKeys(assembly, [
    "id", "details", "methodDetails", "oligomericDetails", "oligomericCount",
    "generatorCount", "generators",
  ], label);
  if (
    !validBoundedIdentifier(assembly.id, 256) ||
    !validBoundedNullableText(assembly.details, 4_000) ||
    !validBoundedNullableText(assembly.methodDetails, 4_000) ||
    !validBoundedNullableText(assembly.oligomericDetails, 4_000) ||
    (assembly.oligomericCount != null && (!Number.isSafeInteger(assembly.oligomericCount) || assembly.oligomericCount < 0)) ||
    !Number.isSafeInteger(assembly.generatorCount) || assembly.generatorCount < 0 ||
    !Array.isArray(assembly.generators) || assembly.generators.length !== assembly.generatorCount
  ) throw new Error(`${label} is invalid.`);
  for (const generator of assembly.generators) {
    if (generator == null || typeof generator !== "object" || Array.isArray(generator)) {
      throw new Error(`${label} generator must be an object.`);
    }
    requireExactKeys(generator, ["sourceRowIndex", "operationExpression", "labelAsymIds"], `${label} generator`);
    if (
      !Number.isSafeInteger(generator.sourceRowIndex) || generator.sourceRowIndex < 1 ||
      !validBoundedIdentifier(generator.operationExpression, 4_096) ||
      !Array.isArray(generator.labelAsymIds) || !generator.labelAsymIds.length ||
      new Set(generator.labelAsymIds).size !== generator.labelAsymIds.length ||
      generator.labelAsymIds.some((id) => !validBoundedIdentifier(id, 256))
    ) throw new Error(`${label} generator is invalid.`);
  }
}

function validateSelectedAssembly(value: unknown): void {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workspace selected assembly must be an object.");
  }
  const assembly = value as {
    id: string;
    details: string | null;
    generatorCount: number;
    generatedChainCount: number;
    generatedProteinHeavyAtomCount: number;
    generatedOperationCount: number;
    skippedNonProteinLabelAsymIds: string[];
    materializationPolicy: string;
    generators: Array<{
      sourceRowIndex: number;
      operationExpression: string;
      labelAsymIds: string[];
      expandedOperationTuples: string[][];
    }>;
  };
  requireExactKeys(assembly, [
    "id", "details", "generatorCount", "generatedChainCount", "generatedProteinHeavyAtomCount",
    "generatedOperationCount", "skippedNonProteinLabelAsymIds", "materializationPolicy", "generators",
  ], "Workspace selected assembly");
  if (
    !validBoundedIdentifier(assembly.id, 256) ||
    !validBoundedNullableText(assembly.details, 4_000) ||
    !Number.isSafeInteger(assembly.generatorCount) || assembly.generatorCount < 1 ||
    !Number.isSafeInteger(assembly.generatedChainCount) || assembly.generatedChainCount < 1 ||
    !Number.isSafeInteger(assembly.generatedProteinHeavyAtomCount) || assembly.generatedProteinHeavyAtomCount < 1 ||
    !Number.isSafeInteger(assembly.generatedOperationCount) || assembly.generatedOperationCount < 1 ||
    !Array.isArray(assembly.skippedNonProteinLabelAsymIds) ||
    new Set(assembly.skippedNonProteinLabelAsymIds).size !== assembly.skippedNonProteinLabelAsymIds.length ||
    assembly.skippedNonProteinLabelAsymIds.some((id) => !validBoundedIdentifier(id, 256)) ||
    cleanText(assembly.materializationPolicy, 4_000) !== assembly.materializationPolicy ||
    !assembly.materializationPolicy ||
    !Array.isArray(assembly.generators) || assembly.generators.length !== assembly.generatorCount
  ) throw new Error("Workspace selected assembly is invalid.");
  let expandedOperationCount = 0;
  for (const generator of assembly.generators) {
    if (generator == null || typeof generator !== "object" || Array.isArray(generator)) {
      throw new Error("Workspace selected-assembly generator must be an object.");
    }
    requireExactKeys(generator, [
      "sourceRowIndex", "operationExpression", "labelAsymIds", "expandedOperationTuples",
    ], "Workspace selected-assembly generator");
    if (
      !Number.isSafeInteger(generator.sourceRowIndex) || generator.sourceRowIndex < 1 ||
      !validBoundedIdentifier(generator.operationExpression, 4_096) ||
      !Array.isArray(generator.labelAsymIds) || !generator.labelAsymIds.length ||
      new Set(generator.labelAsymIds).size !== generator.labelAsymIds.length ||
      generator.labelAsymIds.some((id) => !validBoundedIdentifier(id, 256)) ||
      !Array.isArray(generator.expandedOperationTuples) || !generator.expandedOperationTuples.length ||
      generator.expandedOperationTuples.some((tuple) => (
        !Array.isArray(tuple) || !tuple.length || tuple.length > 8 ||
        tuple.some((id) => !validBoundedIdentifier(id, 256))
      ))
    ) throw new Error("Workspace selected-assembly generator is invalid.");
    expandedOperationCount += generator.expandedOperationTuples.length;
  }
  if (expandedOperationCount !== assembly.generatedOperationCount) {
    throw new Error("Workspace selected-assembly operation count does not reconcile with its generators.");
  }
}

function requireFiniteJson(
  value: unknown,
  path = "value",
  ancestors = new WeakSet<object>(),
): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number.`);
    }
    return;
  }
  if (value == null || typeof value !== "object") return;
  if (ancestors.has(value)) throw new Error(`${path} contains a cycle.`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => requireFiniteJson(entry, `${path}[${index}]`, ancestors));
  } else {
    Object.entries(value).forEach(([key, entry]) => (
      requireFiniteJson(entry, `${path}.${key}`, ancestors)
    ));
  }
  ancestors.delete(value);
}

function cleanText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim()
    .slice(0, maximumLength);
}

function cleanIdentifier(value: unknown, maximumLength: number, fallback: string): string {
  const cleaned = cleanText(value, maximumLength).replace(/\n+/g, " ");
  return cleaned || fallback;
}

function markdownText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([`*_{}[\]<>#+.!|~-])/g, "\\$1");
}

function cloneJson<T>(value: T, path: string): T {
  requireFiniteJson(value, path);
  const serialized = JSON.stringify(value);
  if (serialized == null) throw new Error(`${path} cannot be represented as JSON.`);
  return JSON.parse(serialized) as T;
}

function containsUnsafeObjectKey(
  value: unknown,
  ancestors = new WeakSet<object>(),
): boolean {
  if (value == null || typeof value !== "object") return false;
  if (ancestors.has(value)) return true;
  ancestors.add(value);
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value);
  const unsafe = entries.some(([key, entry]) => (
    key === "__proto__" || key === "prototype" || key === "constructor" ||
    containsUnsafeObjectKey(entry, ancestors)
  ));
  ancestors.delete(value);
  return unsafe;
}

function parseBoundedJson(text: string, maximumBytes: number, label: string): unknown {
  if (typeof text !== "string" || !text.trim()) throw new Error(`${label} is empty.`);
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > maximumBytes) throw new Error(`${label} exceeds its ${maximumBytes.toLocaleString()}-byte limit.`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (containsUnsafeObjectKey(value)) throw new Error(`${label} contains an unsafe or cyclic object shape.`);
  requireFiniteJson(value, label);
  return value;
}

function validOptionalShare(value: unknown): value is number | null {
  return value === null || (
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
  );
}

function validOptionalNonnegative(value: unknown): value is number | null {
  return value === null || (
    typeof value === "number" && Number.isFinite(value) && value >= 0
  );
}

function validateFootprintContext(
  summary: IntendedFootprintSummary,
  intendedFootprint: string,
  label: string,
): void {
  const requested = normalizeIntendedFootprintIdentifiers(intendedFootprint);
  const summarized = [
    ...summary.mapped.map((entry) => entry.requestedIdentifier),
    ...summary.duplicateAliases.map((entry) => entry.requestedIdentifier),
    ...summary.unmapped,
  ];
  const summarizedSet = new Set(summarized);
  if (
    requested.length !== summary.requestedCount ||
    summarizedSet.size !== requested.length ||
    requested.some((identifier) => !summarizedSet.has(identifier))
  ) throw new Error(`${label} does not match its normalized requested identifiers.`);
}

function validateFootprintAuditMetadata(
  summary: IntendedFootprintSummary,
  report: SingleAuditExportReport,
  label: string,
): void {
  const receptor = report.structure.selectedChains.find((chain) => chain.role === "receptor")!;
  const audited = new Set(report.audit.receptorInterfaceKeys);
  const contactsByOrder = new Map<number, InterfaceAudit["contacts"][number]>();
  for (const contact of report.audit.contacts) {
    const current = contactsByOrder.get(contact.receptorResidueOrder);
    if (current && (
      current.receptorResidue !== contact.receptorResidue ||
      current.receptorResidueName !== contact.receptorResidueName
    )) throw new Error(`${label} encounters inconsistent receptor contact labels.`);
    contactsByOrder.set(contact.receptorResidueOrder, contact);
  }
  if (
    summary.observedReceptorFootprint.length !== audited.size ||
    summary.observedReceptorFootprint.some((entry) => !audited.has(entry.residueKey))
  ) throw new Error(`${label} does not match the canonical audit receptor footprint.`);

  for (const entry of summary.observedReceptorFootprint) {
    let chainId: string;
    let residueNumber: number;
    let insertionCode: string;
    let sequenceOrder: number | null = null;
    if (report.structure.sourceFormat === "pdb") {
      const match = /^([^:]):(-?\d+):(.*)$/u.exec(entry.residueKey);
      if (!match) throw new Error(`${label} contains an invalid PDB residue key.`);
      chainId = match[1];
      residueNumber = Number(match[2]);
      insertionCode = match[3];
    } else {
      let tuple: unknown;
      try {
        tuple = JSON.parse(entry.residueKey);
      } catch {
        throw new Error(`${label} contains an invalid mmCIF residue key.`);
      }
      if (
        !Array.isArray(tuple) || tuple.length !== 4 ||
        typeof tuple[0] !== "string" || !Number.isSafeInteger(tuple[1]) ||
        typeof tuple[2] !== "string" || !Number.isSafeInteger(tuple[3])
      ) throw new Error(`${label} contains an invalid mmCIF residue key.`);
      [chainId, residueNumber, insertionCode, sequenceOrder] = tuple as [string, number, string, number];
    }
    const contact = contactsByOrder.get(entry.sequenceOrder);
    if (
      chainId !== receptor.id ||
      (sequenceOrder != null && sequenceOrder !== entry.sequenceOrder) ||
      entry.canonicalIdentifier !== `${encodeURIComponent(receptor.id)}:${residueNumber}${insertionCode}` ||
      contact == null ||
      contact.receptorResidue !== entry.coordinateLabel
    ) throw new Error(`${label} residue metadata does not reconcile with the canonical audit contact ledger.`);
  }
}

function validateWorkflowCoverage(
  value: unknown,
  label: string,
): asserts value is WorkflowCoverage {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const workflow = value as WorkflowCoverage;
  requireExactKeys(workflow, ["paeAttached", "ensemblePoseCount", "pairedContextCompared"], label);
  if (
    typeof workflow.paeAttached !== "boolean" ||
    !Number.isSafeInteger(workflow.ensemblePoseCount) ||
    workflow.ensemblePoseCount < 1 || workflow.ensemblePoseCount > 12 ||
    typeof workflow.pairedContextCompared !== "boolean"
  ) throw new Error(`${label} is invalid.`);
}

export function normalizeResearchContext(
  value: Partial<ResearchContext> | null | undefined,
): ResearchContext {
  const source = value ?? {};
  return {
    studyName: cleanText(source.studyName, FIELD_LIMITS.studyName),
    receptorName: cleanText(source.receptorName, FIELD_LIMITS.receptorName),
    candidateId: cleanText(source.candidateId, FIELD_LIMITS.candidateId),
    coordinateContext: cleanText(source.coordinateContext, FIELD_LIMITS.coordinateContext),
    intendedFootprint: cleanText(source.intendedFootprint, FIELD_LIMITS.intendedFootprint),
    notes: cleanText(source.notes, FIELD_LIMITS.notes),
  };
}

function neutralProductReviewText(value: string): string {
  return value
    .replaceAll(
      "Treat it as low-priority geometry until the pose is reviewed.",
      "Treat it as weak coordinate geometry requiring manual review.",
    )
    .replaceAll(
      "Review the footprint, overlaps, and coordinate confidence before prioritization.",
      "Review the footprint, overlaps, and coordinate confidence before drawing conclusions.",
    )
    .replaceAll(
      "Review the overlapping atoms before prioritization.",
      "Review the overlapping atoms and compare a relaxed or alternate pose.",
    );
}

export function deriveCoordinateTriageBrief(
  audit: Pick<InterfaceAudit, "evidenceLevel" | "findings" | "severeClashCount" | "paratopeProxyShare">,
  workflow: WorkflowCoverage,
): CoordinateTriageBrief {
  validateWorkflowCoverage(workflow, "Coordinate-triage workflow coverage");

  const triageByEvidence: Record<EvidenceLevel, Pick<CoordinateTriageBrief, "band" | "title" | "summary">> = {
    supported: {
      band: "coordinate-geometry-coherent",
      title: "Coordinate geometry is coherent under this audit policy",
      summary: "The selected interface has coherent coordinate geometry under the fixed audit policy. This flag has not been validated to improve candidate selection, experimental hit rate, or biological ranking.",
    },
    mixed: {
      band: "coordinate-geometry-mixed",
      title: "Coordinate geometry requires manual review",
      summary: "The selected interface contains both supportive and cautionary coordinate evidence. This flag has not been validated to improve candidate selection, experimental hit rate, or biological ranking.",
    },
    limited: {
      band: "coordinate-geometry-limited",
      title: "Coordinate geometry is weak under this audit policy",
      summary: "The selected interface has weak or unfavorable coordinate evidence under the fixed audit policy. This flag describes the uploaded geometry and is not a validated candidate-selection rule.",
    },
    "not-assessable": {
      band: "not-assessable",
      title: "This coordinate interface is not assessable",
      summary: "The selected chains do not provide an assessable interface under the fixed contact policy. Verify the chain assignment, coordinate scope, and model before drawing conclusions.",
    },
  };

  const base = triageByEvidence[audit.evidenceLevel];
  const reviewItems = audit.findings
    .filter((finding) => finding.level === "limited" || finding.level === "review")
    .map((finding) => `${finding.label}: ${neutralProductReviewText(finding.action)}`);
  const evidenceGaps: string[] = [];
  if (!workflow.paeAttached) {
    evidenceGaps.push("No direction-aware cross-chain PAE was attached for this audit.");
  }
  if (workflow.ensemblePoseCount < 2) {
    evidenceGaps.push("Pose recurrence has not been checked across model seeds or independent poses.");
  }
  if (!workflow.pairedContextCompared) {
    evidenceGaps.push("No same-sequence paired coordinate context has been compared.");
  }
  evidenceGaps.push("No experimental binding or functional result is represented in this workspace.");

  const nextActions: string[] = [];
  if (audit.evidenceLevel === "not-assessable") {
    nextActions.push("Recheck receptor/VHH chain roles, coordinate model, and deposited-assembly scope.");
  }
  if (audit.severeClashCount > 0) {
    nextActions.push("Inspect the severe overlap locations and compare a relaxed or alternate pose.");
  }
  if (audit.paratopeProxyShare != null && audit.paratopeProxyShare < 0.5) {
    nextActions.push("Review whether framework-dominated contacts match the intended binding mode.");
  }
  if (!workflow.paeAttached) {
    nextActions.push("For predicted complexes, attach the matching PAE JSON and confirm residue order.");
  }
  if (workflow.ensemblePoseCount < 2) {
    nextActions.push("Compare multiple seeds or poses to characterize interface recurrence before making a researcher-authored decision.");
  }
  if (!workflow.pairedContextCompared) {
    nextActions.push("If context dependence matters, compare same-sequence receptor–VHH coordinate contexts.");
  }
  nextActions.push("Use experiments to evaluate biological hypotheses; coordinate coherence does not establish binding.");

  return {
    ...base,
    reviewItems,
    evidenceGaps,
    nextActions: [...new Set(nextActions)],
    boundary: CLAIM_BOUNDARY,
  };
}

function deriveLegacyCoordinateTriageBrief(
  audit: Pick<InterfaceAudit, "evidenceLevel" | "findings" | "severeClashCount" | "paratopeProxyShare">,
  workflow: WorkflowCoverage,
): CoordinateTriageBrief {
  const current = deriveCoordinateTriageBrief(audit, workflow);
  const legacyByEvidence: Record<EvidenceLevel, Pick<CoordinateTriageBrief, "band" | "title" | "summary">> = {
    supported: {
      band: "retain-for-comparison",
      title: "Retain this coordinate pose for comparative review",
      summary: "The selected interface has coherent coordinate geometry under the fixed audit policy. Retention is a modeling decision, not evidence of biological binding.",
    },
    mixed: {
      band: "review-before-comparison",
      title: "Review this coordinate pose before prioritization",
      summary: "The selected interface contains both supportive and cautionary coordinate evidence. Resolve the highlighted geometry issues before using it as a leading coordinate pose for manual structural review.",
    },
    limited: {
      band: "deprioritize-coordinate-pose",
      title: "Deprioritize this coordinate pose",
      summary: "The selected interface has weak or unfavorable coordinate evidence under the fixed audit policy. A different pose or model seed is a stronger next step than interpreting this geometry biologically.",
    },
    "not-assessable": {
      band: "not-assessable",
      title: "This coordinate interface is not assessable",
      summary: "The selected chains do not provide an assessable interface under the fixed contact policy. Verify the chain assignment, coordinate scope, and model before drawing conclusions.",
    },
  };
  return {
    ...current,
    ...legacyByEvidence[audit.evidenceLevel],
    reviewItems: audit.findings
      .filter((finding) => finding.level === "limited" || finding.level === "review")
      .map((finding) => `${finding.label}: ${finding.action}`),
    nextActions: current.nextActions.map((action) => {
      if (action === "Compare multiple seeds or poses to characterize interface recurrence before making a researcher-authored decision.") {
        return "Compare multiple seeds or poses to test interface recurrence before prioritizing.";
      }
      if (action === "Use experiments to evaluate biological hypotheses; coordinate coherence does not establish binding.") {
        return "Validate retained candidates experimentally; coordinate coherence is not binding proof.";
      }
      return action;
    }),
  };
}

function deriveCoordinateTriageBriefForRelease(
  audit: Pick<InterfaceAudit, "evidenceLevel" | "findings" | "severeClashCount" | "paratopeProxyShare">,
  workflow: WorkflowCoverage,
  productRelease: SupportedConfoVhhProductRelease,
): CoordinateTriageBrief {
  return productRelease === CONFOVHH_PRODUCT_RELEASE
    ? deriveCoordinateTriageBrief(audit, workflow)
    : deriveLegacyCoordinateTriageBrief(audit, workflow);
}

interface NotebookEntryInput {
  singleAuditReport: SingleAuditExportReport;
  context: Partial<ResearchContext> | null | undefined;
  workflow: WorkflowCoverage;
  savedAt?: string;
}

function notebookSelectionKey(
  digest: string,
  receptorChain: string,
  vhhChain: string,
  selection: CoordinateSelectionProvenance,
): string {
  return JSON.stringify([
    "notebook-selection-v2",
    digest,
    selection.sourceFileBytes,
    selection.sourceFormat,
    selection.coordinateScope,
    selection.selectedModelId,
    selection.selectedAssemblyId,
    selection.selectedCoordinateFingerprint,
    selection.selectedGeometryFingerprint,
    selection.auditInputFingerprint,
    { role: "receptor", ...selection.receptorChainInstance, selectedId: receptorChain },
    { role: "VHH", ...selection.vhhChainInstance, selectedId: vhhChain },
  ]);
}

export function createNotebookEntry(input: NotebookEntryInput): NotebookEntry {
  const report = validateImportedSingleAuditReport(input.singleAuditReport);
  const savedAt = input.savedAt ?? new Date().toISOString();
  requireIsoTimestamp(savedAt, "Notebook savedAt");
  const context = normalizeResearchContext(input.context);
  const receptorChain = report.structure.selectedChains.find((chain) => chain.role === "receptor")!.id;
  const vhhChain = report.structure.selectedChains.find((chain) => chain.role === "VHH")!.id;
  const filename = cleanIdentifier(report.file, 240, "unnamed-coordinate-file");
  const digest = report.structure.sourceFileSha256;
  const selection = coordinateSelectionFromReport(report);
  if (input.workflow.paeAttached !== (report.pae != null)) {
    throw new Error("Notebook PAE coverage does not match the canonical single-audit report.");
  }
  const triage = deriveCoordinateTriageBrief(report.audit, input.workflow);
  const deduplicationKey = notebookSelectionKey(digest, receptorChain, vhhChain, selection);
  const id = `${digest.slice(0, 12)}-${selection.auditInputFingerprint.slice(-16)}-${Date.parse(savedAt).toString(36)}`;
  const entry: NotebookEntry = {
    schemaVersion: NOTEBOOK_SCHEMA_VERSION,
    id,
    deduplicationKey,
    savedAt,
    productRelease: CONFOVHH_PRODUCT_RELEASE,
    engineVersion: CONFOVHH_VERSION,
    context,
    coordinate: {
      filename,
      sha256: digest,
      receptorChain,
      vhhChain,
      ...cloneJson(selection, "Notebook coordinate selection"),
    },
    triage: cloneJson(triage, "Notebook triage"),
    workflow: cloneJson(input.workflow, "Notebook workflow"),
    metrics: {
      evidenceLevel: report.audit.evidenceLevel,
      contactPairCount: report.audit.contactPairCount,
      severeClashCount: report.audit.severeClashCount,
      deltaSasaAngstrom2: report.audit.deltaSasaAngstrom2,
      paratopeProxyShare: report.audit.paratopeProxyShare,
      cdr3ProxyShare: report.audit.cdr3ProxyShare,
      interfacePaeMedianAngstrom: report.audit.interfacePaeMedianAngstrom,
    },
    privacy: {
      rawCoordinatesAutomaticallyCopied: false,
      parsedSequencesAutomaticallyCopied: false,
      paeMatrixAutomaticallyCopied: false,
      residueContactTableAutomaticallyCopied: false,
      userEnteredContextStored: true,
    },
  };
  if (!isNotebookEntry(entry)) throw new Error("The derived notebook summary is invalid.");
  return entry;
}

function notebookEntrySnapshot(value: unknown): NotebookEntry {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Notebook entry must be an object.");
  }
  const entry = value as NotebookEntry;
  requireExactKeys(entry, [
    "schemaVersion", "id", "deduplicationKey", "savedAt", "productRelease",
    "engineVersion", "context", "coordinate", "triage", "workflow", "metrics", "privacy",
  ], "Notebook entry");
  if (
    entry.schemaVersion !== NOTEBOOK_SCHEMA_VERSION ||
    !SUPPORTED_PRODUCT_RELEASES.has(entry.productRelease) ||
    entry.engineVersion !== CONFOVHH_VERSION ||
    typeof entry.savedAt !== "string"
  ) throw new Error("Notebook entry version or timestamp provenance is invalid.");
  requireIsoTimestamp(entry.savedAt, "Notebook savedAt");
  requireFiniteJson(entry, "Notebook entry");

  if (entry.context == null || typeof entry.context !== "object" || Array.isArray(entry.context)) {
    throw new Error("Notebook context must be an object.");
  }
  requireExactKeys(entry.context, Object.keys(FIELD_LIMITS), "Notebook context");
  const normalizedContext = normalizeResearchContext(entry.context);
  if (!jsonEqual(normalizedContext, entry.context)) {
    throw new Error("Notebook context is not normalized or bounded.");
  }

  if (entry.coordinate == null || typeof entry.coordinate !== "object" || Array.isArray(entry.coordinate)) {
    throw new Error("Notebook coordinate provenance must be an object.");
  }
  requireExactKeys(entry.coordinate, [
    "filename", "sha256", "receptorChain", "vhhChain", "sourceFileBytes", "sourceFormat",
    "coordinateScope", "selectedModelId", "selectedAssemblyId",
    "selectedCoordinateFingerprint", "selectedGeometryFingerprint",
    "auditInputFingerprint", "auditResultFingerprint", "receptorChainInstance", "vhhChainInstance",
  ], "Notebook coordinate provenance");
  requireSha256(entry.coordinate.sha256, "Notebook coordinate digest");
  if (
    entry.coordinate.sha256 !== entry.coordinate.sha256.toLowerCase() ||
    cleanIdentifier(entry.coordinate.filename, 240, "") !== entry.coordinate.filename ||
    !validBoundedIdentifier(entry.coordinate.receptorChain, 256) ||
    !validBoundedIdentifier(entry.coordinate.vhhChain, 256) ||
    entry.coordinate.receptorChain === entry.coordinate.vhhChain
  ) throw new Error("Notebook coordinate source or chain identifiers are invalid.");
  const selection: CoordinateSelectionProvenance = {
    sourceFileBytes: entry.coordinate.sourceFileBytes,
    sourceFormat: entry.coordinate.sourceFormat,
    coordinateScope: entry.coordinate.coordinateScope,
    selectedModelId: entry.coordinate.selectedModelId,
    selectedAssemblyId: entry.coordinate.selectedAssemblyId,
    selectedCoordinateFingerprint: entry.coordinate.selectedCoordinateFingerprint,
    selectedGeometryFingerprint: entry.coordinate.selectedGeometryFingerprint,
    auditInputFingerprint: entry.coordinate.auditInputFingerprint,
    auditResultFingerprint: entry.coordinate.auditResultFingerprint,
    receptorChainInstance: entry.coordinate.receptorChainInstance,
    vhhChainInstance: entry.coordinate.vhhChainInstance,
  };
  validateCoordinateSelectionProvenance(selection, "Notebook coordinate selection");
  if (
    entry.coordinate.receptorChain !== selection.receptorChainInstance.id ||
    entry.coordinate.vhhChain !== selection.vhhChainInstance.id
  ) throw new Error("Notebook selected chain IDs do not match their chain-instance provenance.");

  validateWorkflowCoverage(entry.workflow, "Notebook workflow coverage");

  if (entry.metrics == null || typeof entry.metrics !== "object" || Array.isArray(entry.metrics)) {
    throw new Error("Notebook metrics must be an object.");
  }
  requireExactKeys(entry.metrics, [
    "evidenceLevel", "contactPairCount", "severeClashCount", "deltaSasaAngstrom2",
    "paratopeProxyShare", "cdr3ProxyShare", "interfacePaeMedianAngstrom",
  ], "Notebook metrics");
  if (
    !["supported", "mixed", "limited", "not-assessable"].includes(entry.metrics.evidenceLevel) ||
    !Number.isSafeInteger(entry.metrics.contactPairCount) || entry.metrics.contactPairCount < 0 ||
    !Number.isSafeInteger(entry.metrics.severeClashCount) || entry.metrics.severeClashCount < 0 ||
    entry.metrics.severeClashCount > entry.metrics.contactPairCount ||
    !Number.isFinite(entry.metrics.deltaSasaAngstrom2) || entry.metrics.deltaSasaAngstrom2 < 0 ||
    !validOptionalShare(entry.metrics.paratopeProxyShare) ||
    !validOptionalShare(entry.metrics.cdr3ProxyShare) ||
    !validOptionalNonnegative(entry.metrics.interfacePaeMedianAngstrom)
  ) throw new Error("Notebook summary metrics are invalid or inconsistent.");

  if (!validateDecisionBrief(entry.triage)) {
    throw new Error("Notebook coordinate review brief is invalid.");
  }
  const expectedBrief = deriveCoordinateTriageBriefForRelease({
    evidenceLevel: entry.metrics.evidenceLevel,
    findings: [],
    severeClashCount: entry.metrics.severeClashCount,
    paratopeProxyShare: entry.metrics.paratopeProxyShare,
  }, entry.workflow, entry.productRelease);
  const expectedCore = {
    band: expectedBrief.band,
    title: expectedBrief.title,
    summary: expectedBrief.summary,
    evidenceGaps: expectedBrief.evidenceGaps,
    nextActions: expectedBrief.nextActions,
    boundary: expectedBrief.boundary,
  };
  const { reviewItems, ...actualCore } = entry.triage;
  if (!jsonEqual(actualCore, expectedCore)) {
    throw new Error("Notebook coordinate review brief does not reconcile with its metrics and workflow coverage.");
  }

  if (entry.privacy == null || typeof entry.privacy !== "object" || Array.isArray(entry.privacy)) {
    throw new Error("Notebook privacy record must be an object.");
  }
  requireExactKeys(entry.privacy, [
    "rawCoordinatesAutomaticallyCopied", "parsedSequencesAutomaticallyCopied",
    "paeMatrixAutomaticallyCopied", "residueContactTableAutomaticallyCopied",
    "userEnteredContextStored",
  ], "Notebook privacy record");
  if (
    entry.privacy.rawCoordinatesAutomaticallyCopied !== false ||
    entry.privacy.parsedSequencesAutomaticallyCopied !== false ||
    entry.privacy.paeMatrixAutomaticallyCopied !== false ||
    entry.privacy.residueContactTableAutomaticallyCopied !== false ||
    entry.privacy.userEnteredContextStored !== true
  ) throw new Error("Notebook privacy record is incompatible with this product release.");

  const expectedDeduplicationKey = notebookSelectionKey(
    entry.coordinate.sha256,
    entry.coordinate.receptorChain,
    entry.coordinate.vhhChain,
    selection,
  );
  const expectedId = `${entry.coordinate.sha256.slice(0, 12)}-${entry.coordinate.auditInputFingerprint.slice(-16)}-${Date.parse(entry.savedAt).toString(36)}`;
  if (entry.deduplicationKey !== expectedDeduplicationKey || entry.id !== expectedId) {
    throw new Error("Notebook identity does not match its exact coordinate-selection provenance.");
  }

  return {
    schemaVersion: entry.schemaVersion,
    id: entry.id,
    deduplicationKey: entry.deduplicationKey,
    savedAt: entry.savedAt,
    productRelease: entry.productRelease,
    engineVersion: entry.engineVersion,
    context: { ...entry.context },
    coordinate: { ...entry.coordinate },
    triage: {
      ...entry.triage,
      reviewItems: [...reviewItems],
      evidenceGaps: [...entry.triage.evidenceGaps],
      nextActions: [...entry.triage.nextActions],
    },
    workflow: { ...entry.workflow },
    metrics: { ...entry.metrics },
    privacy: { ...entry.privacy },
  };
}

export function isNotebookEntry(value: unknown): value is NotebookEntry {
  try {
    notebookEntrySnapshot(value);
    return true;
  } catch {
    return false;
  }
}

export function normalizeNotebookEntries(value: unknown): NotebookEntry[] {
  if (!Array.isArray(value)) return [];
  const accepted: NotebookEntry[] = [];
  for (const candidate of value) {
    try {
      accepted.push(notebookEntrySnapshot(candidate));
    } catch {
      // Invalid local records are ignored rather than persisted or rendered.
    }
  }
  const byKey = new Map<string, NotebookEntry>();
  for (const entry of accepted.sort((left, right) => right.savedAt.localeCompare(left.savedAt))) {
    if (!byKey.has(entry.deduplicationKey)) byKey.set(entry.deduplicationKey, entry);
  }
  return [...byKey.values()].slice(0, MAX_NOTEBOOK_ENTRIES);
}

export function upsertNotebookEntry(
  entries: readonly NotebookEntry[],
  nextEntry: NotebookEntry,
): NotebookEntry[] {
  if (!isNotebookEntry(nextEntry)) throw new Error("Cannot save an invalid notebook entry.");
  const retained = normalizeNotebookEntries(entries)
    .filter((entry) => entry.deduplicationKey !== nextEntry.deduplicationKey);
  const next = normalizeNotebookEntries([nextEntry, ...retained]);
  const serializedBytes = new TextEncoder().encode(JSON.stringify(next)).byteLength;
  if (serializedBytes > MAX_NOTEBOOK_SERIALIZED_BYTES) {
    throw new Error("The local notebook has reached its 1 MB summary limit. Export or remove older summaries before saving another.");
  }
  return next;
}

export function createNotebookExport(entries: readonly NotebookEntry[], generatedAt?: string) {
  const timestamp = generatedAt ?? new Date().toISOString();
  requireIsoTimestamp(timestamp, "Notebook export generatedAt");
  const normalized = normalizeNotebookEntries(entries);
  if (normalized.length !== entries.length) {
    throw new Error("Notebook export contains an invalid or duplicate summary entry.");
  }
  return {
    schemaVersion: NOTEBOOK_EXPORT_SCHEMA_VERSION,
    productRelease: CONFOVHH_PRODUCT_RELEASE,
    engineVersion: CONFOVHH_VERSION,
    generatedAt: timestamp,
    privacy: "Stores explicitly saved user-entered context plus derived summaries; loaded coordinates, parsed sequences, PAE matrices, and residue-contact tables are not automatically copied.",
    entries: normalized,
  };
}

export function parseNotebookExport(text: string): NotebookEntry[] {
  const value = parseBoundedJson(text, MAX_NOTEBOOK_SERIALIZED_BYTES, "Notebook import");
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Notebook import must be an object.");
  }
  const record = value as Record<string, unknown>;
  requireExactKeys(record, [
    "schemaVersion", "productRelease", "engineVersion", "generatedAt", "privacy", "entries",
  ], "Notebook import");
  if (
    record.schemaVersion !== NOTEBOOK_EXPORT_SCHEMA_VERSION ||
    !SUPPORTED_PRODUCT_RELEASES.has(record.productRelease as SupportedConfoVhhProductRelease) ||
    record.engineVersion !== CONFOVHH_VERSION ||
    typeof record.generatedAt !== "string" ||
    record.privacy !== "Stores explicitly saved user-entered context plus derived summaries; loaded coordinates, parsed sequences, PAE matrices, and residue-contact tables are not automatically copied."
  ) {
    throw new Error("Notebook import version or provenance is incompatible with this product release.");
  }
  requireIsoTimestamp(record.generatedAt, "Notebook import generatedAt");
  if (!Array.isArray(record.entries)) throw new Error("Notebook import requires an entries array.");
  const normalized = normalizeNotebookEntries(record.entries);
  if (normalized.length !== record.entries.length) {
    throw new Error("Notebook import contains an invalid, duplicate, or unsupported summary entry.");
  }
  return normalized;
}

const INTERFACE_AUDIT_KEYS = [
  "version", "confidenceMode", "receptorChain", "vhhChain", "evidenceLevel", "rationale",
  "contactPairCount", "atomContactCount", "receptorInterfaceResidues", "vhhInterfaceResidues",
  "polarContactProxyCount", "saltBridgeProxyCount", "severeClashCount",
  "possibleInterchainDisulfideCount", "maximumOverlapAngstrom", "paratopeProxyShare",
  "cdr3ProxyShare", "interfaceConfidence", "interfaceConfidenceCoverage", "deltaSasaAngstrom2",
  "receptorBuriedSurfaceAreaAngstrom2", "vhhBuriedSurfaceAreaAngstrom2",
  "halfDeltaSasaInterfaceAreaAngstrom2", "interfacePaeMedianAngstrom", "interfacePaeP90Angstrom",
  "receptorFrameToVhhPaeMedianAngstrom", "vhhFrameToReceptorPaeMedianAngstrom",
  "receptorFrameToVhhPaeP90Angstrom", "vhhFrameToReceptorPaeP90Angstrom",
  "lowPaeContactShare", "paeFilename", "paeOrderConfirmed", "vhhNumbering", "contacts",
  "receptorInterfaceKeys", "vhhInterfaceKeys", "findings", "warnings", "methods",
  "auditAttestation",
] as const;

function auditHashUpdate(state: { first: number; second: number }, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    state.first = Math.imul(state.first ^ code, 0x01000193) >>> 0;
    state.second = Math.imul(state.second ^ code, 0x85ebca6b) >>> 0;
  }
  state.first = Math.imul(state.first ^ 0xff, 0x01000193) >>> 0;
  state.second = Math.imul(state.second ^ 0x7f, 0x85ebca6b) >>> 0;
}

function importedAuditResultFingerprint(audit: InterfaceAudit): string {
  const { auditAttestation: ignoredAttestation, ...scientificResult } = audit;
  void ignoredAttestation;
  const state = { first: 0x811c9dc5, second: 0x27d4eb2f };
  auditHashUpdate(state, JSON.stringify(scientificResult));
  return `fnv1a32x2-audit-result:${state.first.toString(16).padStart(8, "0")}${state.second.toString(16).padStart(8, "0")}`;
}

function validateImportedAudit(value: unknown, paeAttached: boolean): InterfaceAudit {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workspace single-audit payload must be an object.");
  }
  const audit = value as InterfaceAudit;
  requireExactKeys(audit, INTERFACE_AUDIT_KEYS, "Workspace single-audit payload");
  if (
    audit.version !== CONFOVHH_VERSION ||
    !["none", "plddt"].includes(audit.confidenceMode) ||
    typeof audit.receptorChain !== "string" || !audit.receptorChain ||
    typeof audit.vhhChain !== "string" || !audit.vhhChain ||
    audit.receptorChain === audit.vhhChain ||
    !["supported", "mixed", "limited", "not-assessable"].includes(audit.evidenceLevel) ||
    typeof audit.rationale !== "string" || !audit.rationale
  ) throw new Error("Workspace single-audit identity, mode, or evidence band is invalid.");

  for (const field of [
    "contactPairCount", "atomContactCount", "receptorInterfaceResidues", "vhhInterfaceResidues",
    "polarContactProxyCount", "saltBridgeProxyCount", "severeClashCount",
    "possibleInterchainDisulfideCount",
  ] as const) {
    if (!Number.isSafeInteger(audit[field]) || audit[field] < 0) {
      throw new Error(`Workspace single-audit ${field} is invalid.`);
    }
  }
  if (
    audit.atomContactCount < audit.contactPairCount ||
    audit.polarContactProxyCount > audit.atomContactCount ||
    audit.saltBridgeProxyCount > audit.atomContactCount ||
    audit.severeClashCount > audit.contactPairCount ||
    audit.possibleInterchainDisulfideCount > audit.contactPairCount
  ) throw new Error("Workspace single-audit contact counts are internally inconsistent.");
  for (const field of [
    "maximumOverlapAngstrom", "deltaSasaAngstrom2", "receptorBuriedSurfaceAreaAngstrom2",
    "vhhBuriedSurfaceAreaAngstrom2", "halfDeltaSasaInterfaceAreaAngstrom2",
  ] as const) {
    if (!Number.isFinite(audit[field]) || audit[field] < 0) {
      throw new Error(`Workspace single-audit ${field} is invalid.`);
    }
  }
  const sasaTolerance = Math.max(1e-8, audit.deltaSasaAngstrom2 * 1e-10);
  if (
    Math.abs(audit.receptorBuriedSurfaceAreaAngstrom2 + audit.vhhBuriedSurfaceAreaAngstrom2 - audit.deltaSasaAngstrom2) > sasaTolerance ||
    Math.abs(audit.halfDeltaSasaInterfaceAreaAngstrom2 - audit.deltaSasaAngstrom2 / 2) > sasaTolerance
  ) throw new Error("Workspace single-audit buried-area values do not reconcile.");
  for (const field of ["paratopeProxyShare", "cdr3ProxyShare", "lowPaeContactShare"] as const) {
    if (!validOptionalShare(audit[field])) throw new Error(`Workspace single-audit ${field} is invalid.`);
  }
  for (const field of [
    "interfacePaeMedianAngstrom", "interfacePaeP90Angstrom",
    "receptorFrameToVhhPaeMedianAngstrom", "vhhFrameToReceptorPaeMedianAngstrom",
    "receptorFrameToVhhPaeP90Angstrom", "vhhFrameToReceptorPaeP90Angstrom",
  ] as const) {
    if (!validOptionalNonnegative(audit[field])) throw new Error(`Workspace single-audit ${field} is invalid.`);
  }
  if (audit.confidenceMode === "none") {
    if (audit.interfaceConfidence != null || audit.interfaceConfidenceCoverage != null) {
      throw new Error("Workspace coordinate-only audit cannot contain pLDDT summaries.");
    }
  } else if (
    (audit.interfaceConfidence != null && (
      !Number.isFinite(audit.interfaceConfidence) || audit.interfaceConfidence < 0 || audit.interfaceConfidence > 100
    )) ||
    (audit.interfaceConfidenceCoverage != null && (
      !Number.isFinite(audit.interfaceConfidenceCoverage) || audit.interfaceConfidenceCoverage < 0 || audit.interfaceConfidenceCoverage > 1
    ))
  ) throw new Error("Workspace pLDDT summaries are invalid.");

  if (paeAttached) {
    if (typeof audit.paeFilename !== "string" || !audit.paeFilename || audit.paeOrderConfirmed !== true) {
      throw new Error("Workspace PAE-attached audit is missing confirmed PAE provenance.");
    }
  } else if (
    audit.paeFilename != null || audit.paeOrderConfirmed !== false ||
    [
      audit.interfacePaeMedianAngstrom, audit.interfacePaeP90Angstrom,
      audit.receptorFrameToVhhPaeMedianAngstrom, audit.vhhFrameToReceptorPaeMedianAngstrom,
      audit.receptorFrameToVhhPaeP90Angstrom, audit.vhhFrameToReceptorPaeP90Angstrom,
      audit.lowPaeContactShare,
    ].some((entry) => entry != null)
  ) throw new Error("Workspace audit contains PAE values without an attached PAE report.");

  if (audit.methods == null || typeof audit.methods !== "object" || Array.isArray(audit.methods)) {
    throw new Error("Workspace single-audit methods are missing.");
  }
  requireExactKeys(audit.methods, [
    "residueContactCutoffAngstrom", "polarProxyCutoffAngstrom", "saltBridgeProxyCutoffAngstrom",
    "severeClashOverlapAngstrom", "sasaProbeRadiusAngstrom", "sasaSpherePoints",
    "sasaMaximumCandidateDistanceChecks", "sasaMaximumOcclusionChecks", "sasaRadii",
    "sasaOrientation", "sasaFrameAlgorithm", "cdrAnnotation", "paeSummary",
  ], "Workspace single-audit methods");
  const exactMethodValues = {
    residueContactCutoffAngstrom: 4.5,
    polarProxyCutoffAngstrom: 3.5,
    saltBridgeProxyCutoffAngstrom: 4,
    severeClashOverlapAngstrom: 0.6,
    sasaProbeRadiusAngstrom: 1.4,
    sasaSpherePoints: 960,
    sasaMaximumCandidateDistanceChecks: 25_000_000,
    sasaMaximumOcclusionChecks: 250_000_000,
  } as const;
  for (const [field, expected] of Object.entries(exactMethodValues)) {
    if (audit.methods[field as keyof typeof exactMethodValues] !== expected) {
      throw new Error(`Workspace single-audit methods.${field} drifted from the fixed engine policy.`);
    }
  }
  if (
    audit.methods.sasaRadii !== SASA_RADII_METHOD_DESCRIPTION ||
    audit.methods.cdrAnnotation !== CDR_ANNOTATION_METHOD_DESCRIPTION ||
    audit.methods.paeSummary !== PAE_SUMMARY_METHOD_DESCRIPTION ||
    !(
      (audit.methods.sasaOrientation === "source-coordinate-frame" &&
        audit.methods.sasaFrameAlgorithm === "source-coordinates-as-supplied-v1") ||
      (audit.methods.sasaOrientation === "deterministic-proper-signed-frame" &&
        audit.methods.sasaFrameAlgorithm === CANONICAL_SASA_FRAME_ALGORITHM)
    )
  ) throw new Error("Workspace single-audit method descriptions are invalid.");

  if (!Array.isArray(audit.contacts) || audit.contacts.length !== audit.contactPairCount) {
    throw new Error("Workspace single-audit contact ledger does not match its count.");
  }
  const contactPairs = new Set<string>();
  const receptorOrders = new Set<number>();
  const vhhOrders = new Set<number>();
  const allowedContactTypes = new Set([
    "severe vdW overlap", "possible interchain disulfide", "salt-bridge proxy",
    "potential polar contact", "close contact",
  ]);
  const allowedRegions = new Set([
    "FR1-IMGT", "CDR1-IMGT", "FR2-IMGT", "CDR2-IMGT", "FR3-IMGT",
    "CDR3-IMGT", "FR4-IMGT", "Unnumbered",
  ]);
  for (const contact of audit.contacts) {
    if (contact == null || typeof contact !== "object" || Array.isArray(contact)) {
      throw new Error("Workspace single-audit contact records must be objects.");
    }
    requireExactKeys(contact, [
      "receptorResidue", "vhhResidue", "receptorResidueOrder", "vhhResidueOrder",
      "receptorResidueName", "vhhResidueName", "vhhRegion", "vhhImgtPosition",
      "minimumDistance", "contactTypes", "receptorConfidence", "vhhConfidence",
    ], "Workspace single-audit contact record");
    if (
      typeof contact.receptorResidue !== "string" || !contact.receptorResidue ||
      typeof contact.vhhResidue !== "string" || !contact.vhhResidue ||
      !Number.isSafeInteger(contact.receptorResidueOrder) || contact.receptorResidueOrder <= 0 ||
      !Number.isSafeInteger(contact.vhhResidueOrder) || contact.vhhResidueOrder <= 0 ||
      typeof contact.receptorResidueName !== "string" || !contact.receptorResidueName ||
      typeof contact.vhhResidueName !== "string" || !contact.vhhResidueName ||
      !allowedRegions.has(contact.vhhRegion) ||
      (contact.vhhImgtPosition != null && typeof contact.vhhImgtPosition !== "string") ||
      !Number.isFinite(contact.minimumDistance) || contact.minimumDistance < 0 || contact.minimumDistance > 4.5 ||
      !Array.isArray(contact.contactTypes) || !contact.contactTypes.length ||
      contact.contactTypes.some((entry) => typeof entry !== "string" || !allowedContactTypes.has(entry))
    ) throw new Error("Workspace single-audit contact record is invalid.");
    for (const confidence of [contact.receptorConfidence, contact.vhhConfidence]) {
      if (confidence != null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 100)) {
        throw new Error("Workspace single-audit contact confidence is invalid.");
      }
      if (audit.confidenceMode === "none" && confidence != null) {
        throw new Error("Workspace coordinate-only contact cannot contain pLDDT values.");
      }
    }
    const key = `${contact.receptorResidueOrder}:${contact.vhhResidueOrder}`;
    if (contactPairs.has(key)) throw new Error("Workspace single-audit contains duplicate contact pairs.");
    contactPairs.add(key);
    receptorOrders.add(contact.receptorResidueOrder);
    vhhOrders.add(contact.vhhResidueOrder);
  }
  if (
    receptorOrders.size !== audit.receptorInterfaceResidues ||
    vhhOrders.size !== audit.vhhInterfaceResidues
  ) throw new Error("Workspace single-audit interface-residue counts do not reconcile with contacts.");
  for (const [label, inventory, expectedCount] of [
    ["receptor", audit.receptorInterfaceKeys, audit.receptorInterfaceResidues],
    ["VHH", audit.vhhInterfaceKeys, audit.vhhInterfaceResidues],
  ] as const) {
    if (
      !Array.isArray(inventory) || inventory.length !== expectedCount ||
      new Set(inventory).size !== inventory.length ||
      inventory.some((entry) => typeof entry !== "string" || !entry)
    ) throw new Error(`Workspace single-audit ${label} interface-key inventory is invalid.`);
  }
  if (!Array.isArray(audit.findings) || audit.findings.length > 200) {
    throw new Error("Workspace single-audit findings are invalid.");
  }
  for (const finding of audit.findings) {
    if (finding == null || typeof finding !== "object" || Array.isArray(finding)) {
      throw new Error("Workspace single-audit finding must be an object.");
    }
    requireExactKeys(finding, ["label", "level", "evidence", "action"], "Workspace single-audit finding");
    if (
      typeof finding.label !== "string" || !finding.label ||
      !["supported", "review", "limited", "unavailable"].includes(finding.level) ||
      typeof finding.evidence !== "string" || !finding.evidence ||
      typeof finding.action !== "string" || !finding.action
    ) throw new Error("Workspace single-audit finding is incomplete.");
  }
  if (!Array.isArray(audit.warnings) || audit.warnings.some((entry) => typeof entry !== "string")) {
    throw new Error("Workspace single-audit warnings are invalid.");
  }

  if (audit.vhhNumbering == null || typeof audit.vhhNumbering !== "object" || Array.isArray(audit.vhhNumbering)) {
    throw new Error("Workspace VHH-numbering summary is missing.");
  }
  requireExactKeys(audit.vhhNumbering, [
    "status", "scheme", "engine", "confidence", "cdrLengths", "error",
  ], "Workspace VHH-numbering summary");
  if (
    !["numbered", "unavailable"].includes(audit.vhhNumbering.status) ||
    audit.vhhNumbering.scheme !== "IMGT" ||
    typeof audit.vhhNumbering.engine !== "string" || !audit.vhhNumbering.engine ||
    (audit.vhhNumbering.confidence != null && (
      !Number.isFinite(audit.vhhNumbering.confidence) || audit.vhhNumbering.confidence < 0 || audit.vhhNumbering.confidence > 1
    )) ||
    (audit.vhhNumbering.error != null && typeof audit.vhhNumbering.error !== "string")
  ) throw new Error("Workspace VHH-numbering provenance is invalid.");
  if (audit.vhhNumbering.cdrLengths != null) {
    requireExactKeys(audit.vhhNumbering.cdrLengths, ["cdr1", "cdr2", "cdr3"], "Workspace VHH CDR lengths");
    if (Object.values(audit.vhhNumbering.cdrLengths).some((entry) => !Number.isSafeInteger(entry) || entry < 0)) {
      throw new Error("Workspace VHH CDR lengths are invalid.");
    }
  }

  if (audit.auditAttestation == null || typeof audit.auditAttestation !== "object" || Array.isArray(audit.auditAttestation)) {
    throw new Error("Workspace single-audit attestation is missing.");
  }
  requireExactKeys(audit.auditAttestation, [
    "schemaVersion", "inputFingerprint", "resultFingerprint",
  ], "Workspace single-audit attestation");
  if (
    audit.auditAttestation.schemaVersion !== "1.0.0" ||
    !/^fnv1a32x2-audit-input:[0-9a-f]{16}$/.test(audit.auditAttestation.inputFingerprint) ||
    !/^fnv1a32x2-audit-result:[0-9a-f]{16}$/.test(audit.auditAttestation.resultFingerprint) ||
    importedAuditResultFingerprint(audit) !== audit.auditAttestation.resultFingerprint
  ) throw new Error("Workspace single-audit result attestation does not match its scientific fields.");

  return cloneJson(audit, "Workspace single-audit payload");
}

export function validateImportedSingleAuditReport(value: unknown): SingleAuditExportReport {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workspace dossier requires a canonical single-audit report.");
  }
  const report = value as SingleAuditExportReport;
  requireExactKeys(report, [
    "schemaVersion", "softwareVersion", "generatedAt", "file", "structure", "pae",
    "auditPolicy", "audit",
  ], "Workspace single-audit report");
  if (
    report.schemaVersion !== "1.2.0" || report.softwareVersion !== CONFOVHH_VERSION ||
    typeof report.generatedAt !== "string" || typeof report.file !== "string" || !report.file
  ) throw new Error("Workspace single-audit report version or file provenance is invalid.");
  requireIsoTimestamp(report.generatedAt, "Workspace single-audit generatedAt");
  requireFiniteJson(report, "Workspace single-audit report");

  if (report.structure == null || typeof report.structure !== "object" || Array.isArray(report.structure)) {
    throw new Error("Workspace single-audit structure provenance is missing.");
  }
  requireExactKeys(report.structure, [
    "title", "experimentalMethod", "coordinateProvenance", "sourceFileSha256", "sourceFileBytes",
    "selectedCoordinateFingerprint", "selectedGeometryFingerprint", "fingerprintPolicy", "sourceFormat",
    "coordinateScope", "modelCount", "selectedModelId", "availableModelIds", "selectedAssembly",
    "availableAssemblies", "modelPolicy", "assemblyPolicy", "chainIdentityConfirmed", "selectedChains",
    "parserDiagnostics",
  ], "Workspace single-audit structure provenance");
  requireSha256(report.structure.sourceFileSha256, "Workspace single-audit coordinate digest");
  if (
    !validBoundedNullableText(report.structure.title, 20_000) ||
    !validBoundedNullableText(report.structure.experimentalMethod, 4_000) ||
    report.structure.coordinateProvenance !== classifyCoordinateProvenance(report.structure.experimentalMethod) ||
    typeof report.file !== "string" || !report.file || report.file.length > 1_024 ||
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(report.file)
  ) throw new Error("Workspace single-audit source description or filename is invalid.");
  if (
    report.structure.sourceFileSha256 !== report.structure.sourceFileSha256.toLowerCase() ||
    !Number.isSafeInteger(report.structure.sourceFileBytes) || report.structure.sourceFileBytes < 0 ||
    !/^fnv1a64-3dp:[0-9a-f]{16}$/.test(report.structure.selectedCoordinateFingerprint) ||
    !/^fnv1a64-se3-2dp:[0-9a-f]{16}$/.test(report.structure.selectedGeometryFingerprint) ||
    !["pdb", "mmcif"].includes(report.structure.sourceFormat) ||
    !["as-supplied", "deposited-assembly"].includes(report.structure.coordinateScope) ||
    !Number.isSafeInteger(report.structure.modelCount) || report.structure.modelCount < 1 ||
    typeof report.structure.selectedModelId !== "string" || !report.structure.selectedModelId ||
    !Array.isArray(report.structure.availableModelIds) ||
    report.structure.availableModelIds.length !== report.structure.modelCount ||
    new Set(report.structure.availableModelIds).size !== report.structure.availableModelIds.length ||
    report.structure.availableModelIds.some((id) => !validBoundedIdentifier(id, 256)) ||
    !report.structure.availableModelIds.includes(report.structure.selectedModelId) ||
    report.structure.chainIdentityConfirmed !== true ||
    !Array.isArray(report.structure.selectedChains) || report.structure.selectedChains.length !== 2
  ) throw new Error("Workspace single-audit coordinate selection is invalid or incomplete.");
  if (
    report.structure.fingerprintPolicy == null ||
    typeof report.structure.fingerprintPolicy !== "object" ||
    Array.isArray(report.structure.fingerprintPolicy)
  ) throw new Error("Workspace fingerprint policy is missing.");
  requireExactKeys(report.structure.fingerprintPolicy, [
    "selectedCoordinateFingerprint", "selectedGeometryFingerprint", "decisionBoundary",
  ], "Workspace fingerprint policy");
  if (
    report.structure.fingerprintPolicy.selectedCoordinateFingerprint !== "FNV-1a 64-bit screening identifier over the selected receptor/VHH atom identities and source-frame coordinates rounded to 0.001 Å; it changes under rigid-body transforms." ||
    report.structure.fingerprintPolicy.selectedGeometryFingerprint !== "FNV-1a 64-bit screening identifier over the selected receptor/VHH atom identities in a deterministic SE(3)-canonical frame rounded to 0.01 Å; prefix fnv1a64-se3-2dp." ||
    report.structure.fingerprintPolicy.decisionBoundary !== "Fingerprints are provenance and candidate-screening identifiers, not cryptographic digests. Near-duplicate decisions use an explicit proper-rotation fit with independent RMSD and maximum-residual thresholds."
  ) throw new Error("Workspace fingerprint policy drifted from the canonical export boundary.");
  if (
    report.structure.modelPolicy !== "Exactly one explicitly selected coordinate model is audited; model identifiers are preserved from the source parser." ||
    report.structure.assemblyPolicy !== (report.structure.coordinateScope === "deposited-assembly"
      ? "User-selected depositor/PDB-supplied assembly operators were applied; physiological relevance was not inferred."
      : "Coordinates were analyzed as supplied. ConfoVHH applied no assembly transforms; the source file may already contain pre-expanded coordinates.")
  ) throw new Error("Workspace model or assembly policy drifted from the canonical export boundary.");
  if (!Array.isArray(report.structure.availableAssemblies)) {
    throw new Error("Workspace available-assembly provenance must be an array.");
  }
  const availableAssemblyIds = new Set<string>();
  report.structure.availableAssemblies.forEach((assembly, index) => {
    validateAssemblyDescriptor(assembly, `Workspace available assembly ${index + 1}`);
    if (availableAssemblyIds.has(assembly.id)) {
      throw new Error("Workspace available-assembly provenance contains duplicate IDs.");
    }
    availableAssemblyIds.add(assembly.id);
  });
  if (
    (report.structure.coordinateScope === "as-supplied" && report.structure.selectedAssembly != null) ||
    (report.structure.coordinateScope === "deposited-assembly" && (
      report.structure.sourceFormat !== "mmcif" || report.structure.selectedAssembly == null
    )) ||
    (report.structure.sourceFormat === "pdb" && report.structure.availableAssemblies.length !== 0)
  ) throw new Error("Workspace single-audit assembly scope is inconsistent.");
  if (report.structure.selectedAssembly != null) {
    validateSelectedAssembly(report.structure.selectedAssembly);
    if (!availableAssemblyIds.has(report.structure.selectedAssembly.id)) {
      throw new Error("Workspace selected assembly is absent from available-assembly provenance.");
    }
  }
  if (
    report.structure.parserDiagnostics == null ||
    typeof report.structure.parserDiagnostics !== "object" ||
    Array.isArray(report.structure.parserDiagnostics)
  ) throw new Error("Workspace parser diagnostics are missing.");
  requireExactKeys(report.structure.parserDiagnostics, [
    "parserEngine", "ignoredAlternateLocations", "ignoredHydrogens", "duplicateAtomRecords",
    "malformedAtomRecords", "unsupportedResidueRecords", "zeroOccupancyAtomRecords",
    "residueNameConflicts", "alternateLocationPolicy",
  ], "Workspace parser diagnostics");
  if (
    report.structure.parserDiagnostics.parserEngine !== (report.structure.sourceFormat === "mmcif"
      ? "ConfoVHH bounded CIF 1.1 tokenizer and PDBx category parser"
      : "ConfoVHH fixed-column PDB parser") ||
    report.structure.parserDiagnostics.alternateLocationPolicy !== "One residue-level conformer is selected by summed occupancy; blank atoms are shared, with A then deterministic code-unit tie-breaks." ||
    [
      report.structure.parserDiagnostics.ignoredAlternateLocations,
      report.structure.parserDiagnostics.ignoredHydrogens,
      report.structure.parserDiagnostics.duplicateAtomRecords,
      report.structure.parserDiagnostics.malformedAtomRecords,
      report.structure.parserDiagnostics.unsupportedResidueRecords,
      report.structure.parserDiagnostics.zeroOccupancyAtomRecords,
      report.structure.parserDiagnostics.residueNameConflicts,
    ].some((count) => !Number.isSafeInteger(count) || count < 0)
  ) throw new Error("Workspace parser diagnostics are invalid or noncanonical.");
  const selectedChains = report.structure.selectedChains;
  for (const chain of selectedChains) {
    if (chain == null || typeof chain !== "object" || Array.isArray(chain)) {
      throw new Error("Workspace selected-chain record must be an object.");
    }
    requireExactKeys(chain, [
      "id", "role", "sequence", "residueCount", "atomCount", "backboneCompleteness",
      "labelAsymId", "authAsymId", "assemblyCopyIndex", "assemblyGeneratorRowIndex",
      "assemblyOperationIds", "assemblyTransform",
    ], "Workspace selected-chain record");
    if (
      typeof chain.id !== "string" || !chain.id ||
      !["receptor", "VHH"].includes(chain.role) ||
      typeof chain.sequence !== "string" || chain.sequence.length !== chain.residueCount ||
      !Number.isSafeInteger(chain.residueCount) || chain.residueCount < 1 ||
      !Number.isSafeInteger(chain.atomCount) || chain.atomCount < 1 ||
      !Number.isFinite(chain.backboneCompleteness) || chain.backboneCompleteness < 0 || chain.backboneCompleteness > 1
    ) throw new Error("Workspace selected-chain record is invalid.");
    validateChainInstanceProvenance({
      id: chain.id,
      labelAsymId: chain.labelAsymId,
      authAsymId: chain.authAsymId,
      assemblyCopyIndex: chain.assemblyCopyIndex,
      assemblyGeneratorRowIndex: chain.assemblyGeneratorRowIndex,
      assemblyOperationIds: chain.assemblyOperationIds,
      assemblyTransform: chain.assemblyTransform,
    }, "Workspace selected-chain instance");
  }
  const receptorChain = selectedChains.find((chain) => chain.role === "receptor");
  const vhhChain = selectedChains.find((chain) => chain.role === "VHH");
  if (!receptorChain || !vhhChain || receptorChain.id === vhhChain.id) {
    throw new Error("Workspace single-audit report requires one distinct receptor and VHH chain.");
  }

  if (report.pae != null) {
    if (typeof report.pae !== "object" || Array.isArray(report.pae)) {
      throw new Error("Workspace PAE provenance must be an object or null.");
    }
    requireExactKeys(report.pae, [
      "filename", "sha256", "residueCount", "maxPaeAngstrom", "sourceFormat", "orderConfirmed",
      "directionConvention", "directionConventionConfirmed", "mappingMode", "matrixValuesExported",
      "residueIndexMap",
    ], "Workspace PAE provenance");
    requireSha256(report.pae.sha256, "Workspace PAE digest");
    if (
      typeof report.pae.filename !== "string" || !report.pae.filename ||
      !validBoundedIdentifier(report.pae.filename, 1_024) ||
      report.pae.sha256 !== report.pae.sha256.toLowerCase() ||
      !Number.isSafeInteger(report.pae.residueCount) || report.pae.residueCount < 1 || report.pae.residueCount > 1_500 ||
      !Number.isFinite(report.pae.maxPaeAngstrom) || report.pae.maxPaeAngstrom < 0 ||
      !["AlphaFold predicted_aligned_error", "pae matrix", "raw matrix"].includes(report.pae.sourceFormat) ||
      report.pae.orderConfirmed !== true || report.pae.directionConventionConfirmed !== true ||
      report.pae.directionConvention !== "AlphaFold: row is alignment-frame residue; column is evaluated residue." ||
      report.pae.mappingMode !== "Matrix dimensions checked; AlphaFold direction convention and complete parsed protein-residue order explicitly confirmed by the user." ||
      report.pae.matrixValuesExported !== false || !Array.isArray(report.pae.residueIndexMap) ||
      report.pae.residueIndexMap.length !== report.pae.residueCount
    ) throw new Error("Workspace PAE provenance is invalid or incomplete.");

    const residueOrderByChain = new Map<string, Set<number>>();
    for (let index = 0; index < report.pae.residueIndexMap.length; index += 1) {
      const entry = report.pae.residueIndexMap[index];
      if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("Workspace PAE residue-index entry must be an object.");
      }
      requireExactKeys(entry, [
        "matrixIndex", "chainId", "labelAsymId", "authAsymId", "assemblyCopyIndex",
        "assemblyGeneratorRowIndex", "assemblyOperationIds", "chainSequenceOrder",
        "labelSequenceId", "authSequenceId", "residueName", "residueNumber",
        "insertionCode", "residueKey",
      ], "Workspace PAE residue-index entry");
      if (
        entry.matrixIndex !== index ||
        !validBoundedIdentifier(entry.chainId, 256) ||
        (entry.labelAsymId != null && !validBoundedIdentifier(entry.labelAsymId, 256)) ||
        (entry.authAsymId != null && !validBoundedIdentifier(entry.authAsymId, 256)) ||
        (entry.assemblyCopyIndex != null && (!Number.isSafeInteger(entry.assemblyCopyIndex) || entry.assemblyCopyIndex < 1)) ||
        (entry.assemblyGeneratorRowIndex != null && (!Number.isSafeInteger(entry.assemblyGeneratorRowIndex) || entry.assemblyGeneratorRowIndex < 1)) ||
        !Array.isArray(entry.assemblyOperationIds) ||
        entry.assemblyOperationIds.length > 8 ||
        entry.assemblyOperationIds.some((operationId) => !validBoundedIdentifier(operationId, 256)) ||
        !Number.isSafeInteger(entry.chainSequenceOrder) || entry.chainSequenceOrder < 1 ||
        (entry.labelSequenceId != null && !Number.isSafeInteger(entry.labelSequenceId)) ||
        (entry.authSequenceId != null && !Number.isSafeInteger(entry.authSequenceId)) ||
        !validBoundedIdentifier(entry.residueName, 256) ||
        !Number.isSafeInteger(entry.residueNumber) ||
        typeof entry.insertionCode !== "string" || entry.insertionCode.length > 256 ||
        !validBoundedNullableText(entry.insertionCode, 256) ||
        !validBoundedIdentifier(entry.residueKey, 2_048)
      ) throw new Error("Workspace PAE residue-index entry is invalid.");
      const expectedResidueKey = report.structure.sourceFormat === "pdb"
        ? `${entry.chainId}:${entry.residueNumber}:${entry.insertionCode}`
        : JSON.stringify([
            entry.chainId,
            entry.residueNumber,
            entry.insertionCode,
            entry.chainSequenceOrder,
          ]);
      if (entry.residueKey !== expectedResidueKey) {
        throw new Error("Workspace PAE residue-index key conflicts with its chain and residue provenance.");
      }
      const orders = residueOrderByChain.get(entry.chainId) ?? new Set<number>();
      if (orders.has(entry.chainSequenceOrder)) {
        throw new Error("Workspace PAE residue-index map repeats a chain sequence position.");
      }
      orders.add(entry.chainSequenceOrder);
      residueOrderByChain.set(entry.chainId, orders);
    }
    for (const chain of selectedChains) {
      const chainEntries = report.pae.residueIndexMap.filter((entry) => entry.chainId === chain.id);
      if (chainEntries.length !== chain.residueCount) {
        throw new Error("Workspace PAE residue-index map does not cover every selected-chain residue exactly once.");
      }
      const sorted = [...chainEntries].sort((left, right) => left.chainSequenceOrder - right.chainSequenceOrder);
      for (let index = 0; index < sorted.length; index += 1) {
        const entry = sorted[index];
        if (
          entry.chainSequenceOrder !== index + 1 ||
          entry.labelAsymId !== chain.labelAsymId ||
          entry.authAsymId !== chain.authAsymId ||
          entry.assemblyCopyIndex !== chain.assemblyCopyIndex ||
          entry.assemblyGeneratorRowIndex !== chain.assemblyGeneratorRowIndex ||
          !jsonEqual(entry.assemblyOperationIds, chain.assemblyOperationIds)
        ) throw new Error("Workspace PAE selected-chain residue mapping conflicts with coordinate provenance.");
      }
    }
  }

  const audit = validateImportedAudit(report.audit, report.pae != null);
  if (
    audit.receptorChain !== receptorChain.id || audit.vhhChain !== vhhChain.id ||
    audit.receptorInterfaceResidues > receptorChain.residueCount ||
    audit.vhhInterfaceResidues > vhhChain.residueCount ||
    audit.contacts.some((contact) => (
      contact.receptorResidueOrder > receptorChain.residueCount ||
      contact.vhhResidueOrder > vhhChain.residueCount
    )) ||
    (report.pae == null ? audit.paeFilename != null : audit.paeFilename !== report.pae.filename)
  ) throw new Error("Workspace audit chains or PAE source do not match the canonical report.");
  if (report.pae != null) {
    const receptorMap = new Map(report.pae.residueIndexMap
      .filter((entry) => entry.chainId === receptorChain.id)
      .map((entry) => [entry.chainSequenceOrder, entry]));
    const vhhMap = new Map(report.pae.residueIndexMap
      .filter((entry) => entry.chainId === vhhChain.id)
      .map((entry) => [entry.chainSequenceOrder, entry]));
    for (const contact of audit.contacts) {
      const receptorResidue = receptorMap.get(contact.receptorResidueOrder);
      const vhhResidue = vhhMap.get(contact.vhhResidueOrder);
      if (
        receptorResidue == null ||
        receptorResidue.residueName !== contact.receptorResidueName ||
        `${receptorResidue.residueName} ${receptorResidue.chainId}:${receptorResidue.residueNumber}${receptorResidue.insertionCode}` !== contact.receptorResidue ||
        vhhResidue == null ||
        vhhResidue.residueName !== contact.vhhResidueName ||
        `${vhhResidue.residueName} ${vhhResidue.chainId}:${vhhResidue.residueNumber}${vhhResidue.insertionCode}` !== contact.vhhResidue
      ) throw new Error("Workspace PAE residue-index map conflicts with the canonical audit contact ledger.");
    }
  }
  if (report.auditPolicy == null || typeof report.auditPolicy !== "object" || Array.isArray(report.auditPolicy)) {
    throw new Error("Workspace audit policy is missing.");
  }
  requireExactKeys(report.auditPolicy, [
    "confidenceMode", "pae", "residueContactCutoffAngstrom", "polarProxyCutoffAngstrom",
    "saltBridgeProxyCutoffAngstrom", "severeClashOverlapAngstrom", "sasaProbeRadiusAngstrom",
    "sasaSpherePoints", "sasaRadii", "sasaOrientation", "sasaFrameAlgorithm",
    "sasaMaximumCandidateDistanceChecks", "sasaMaximumOcclusionChecks", "cdrAnnotation", "paeSummary",
  ], "Workspace audit policy");
  if (
    report.auditPolicy.confidenceMode !== audit.confidenceMode ||
    report.auditPolicy.pae !== (report.pae == null ? "omitted" : "attached-with-user-confirmed-direction-and-residue-order") ||
    report.auditPolicy.residueContactCutoffAngstrom !== audit.methods.residueContactCutoffAngstrom ||
    report.auditPolicy.polarProxyCutoffAngstrom !== audit.methods.polarProxyCutoffAngstrom ||
    report.auditPolicy.saltBridgeProxyCutoffAngstrom !== audit.methods.saltBridgeProxyCutoffAngstrom ||
    report.auditPolicy.severeClashOverlapAngstrom !== audit.methods.severeClashOverlapAngstrom ||
    report.auditPolicy.sasaProbeRadiusAngstrom !== audit.methods.sasaProbeRadiusAngstrom ||
    report.auditPolicy.sasaSpherePoints !== audit.methods.sasaSpherePoints ||
    report.auditPolicy.sasaMaximumCandidateDistanceChecks !== audit.methods.sasaMaximumCandidateDistanceChecks ||
    report.auditPolicy.sasaMaximumOcclusionChecks !== audit.methods.sasaMaximumOcclusionChecks ||
    report.auditPolicy.sasaRadii !== audit.methods.sasaRadii ||
    report.auditPolicy.sasaOrientation !== audit.methods.sasaOrientation ||
    report.auditPolicy.sasaFrameAlgorithm !== audit.methods.sasaFrameAlgorithm ||
    report.auditPolicy.cdrAnnotation !== audit.methods.cdrAnnotation ||
    report.auditPolicy.paeSummary !== audit.methods.paeSummary
  ) throw new Error("Workspace audit policy does not reconcile with its audit payload.");
  return cloneJson({ ...report, audit }, "Workspace single-audit report");
}

function coordinateSelectionFromReport(report: SingleAuditExportReport): CoordinateSelectionProvenance {
  const receptor = report.structure.selectedChains.find((chain) => chain.role === "receptor")!;
  const vhh = report.structure.selectedChains.find((chain) => chain.role === "VHH")!;
  const chainInstance = (chain: typeof receptor): SelectedChainInstanceProvenance => ({
    id: chain.id,
    labelAsymId: chain.labelAsymId,
    authAsymId: chain.authAsymId,
    assemblyCopyIndex: chain.assemblyCopyIndex,
    assemblyGeneratorRowIndex: chain.assemblyGeneratorRowIndex,
    assemblyOperationIds: [...chain.assemblyOperationIds],
    assemblyTransform: chain.assemblyTransform == null
      ? null
      : chain.assemblyTransform.map((row) => [...row] as [number, number, number, number]),
  });
  const selection: CoordinateSelectionProvenance = {
    sourceFileBytes: report.structure.sourceFileBytes,
    sourceFormat: report.structure.sourceFormat,
    coordinateScope: report.structure.coordinateScope,
    selectedModelId: report.structure.selectedModelId,
    selectedAssemblyId: report.structure.selectedAssembly?.id ?? null,
    selectedCoordinateFingerprint: report.structure.selectedCoordinateFingerprint,
    selectedGeometryFingerprint: report.structure.selectedGeometryFingerprint,
    auditInputFingerprint: report.audit.auditAttestation.inputFingerprint,
    auditResultFingerprint: report.audit.auditAttestation.resultFingerprint,
    receptorChainInstance: chainInstance(receptor),
    vhhChainInstance: chainInstance(vhh),
  };
  validateCoordinateSelectionProvenance(selection, "Workspace coordinate selection");
  return selection;
}

function canonicalPoseEnsembleReport(value: unknown): PoseEnsembleExportReport | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workspace pose-ensemble report must be an object or null.");
  }
  const report = value as PoseEnsembleExportReport;
  const rebuilt = createPoseEnsembleExportReport(
    report.summary,
    report.comparisonMode,
    report.rejected,
    report.generatedAt,
  );
  if (!jsonEqual(report, rebuilt)) {
    throw new Error("Workspace pose-ensemble wrapper is not the canonical current export shape.");
  }
  return rebuilt;
}

function canonicalStatePairReport(value: unknown): StatePairExportReport | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workspace paired-context report must be an object or null.");
  }
  const report = value as StatePairExportReport;
  const rebuilt = createStatePairExportReport(
    report.summary,
    report.comparisonMode,
    report.generatedAt,
  );
  if (!jsonEqual(report, rebuilt)) {
    throw new Error("Workspace paired-context wrapper is not the canonical current export shape.");
  }
  return rebuilt;
}

function workflowFromReports(
  single: SingleAuditExportReport,
  poseEnsemble: PoseEnsembleExportReport | null,
  pairedContext: StatePairExportReport | null,
): WorkflowCoverage {
  return {
    paeAttached: single.pae != null,
    ensemblePoseCount: poseEnsemble?.summary.poseCount ?? 1,
    pairedContextCompared: pairedContext != null,
  };
}

function workspaceCoordinateFromReport(report: SingleAuditExportReport): WorkspaceBundle["coordinate"] {
  const receptor = report.structure.selectedChains.find((chain) => chain.role === "receptor")!;
  const vhh = report.structure.selectedChains.find((chain) => chain.role === "VHH")!;
  return {
    filename: report.file,
    sha256: report.structure.sourceFileSha256,
    receptorChain: receptor.id,
    vhhChain: vhh.id,
    ...coordinateSelectionFromReport(report),
  };
}

function requireMatchingChainInstance(
  expected: SingleAuditExportReport["structure"]["selectedChains"][number],
  actual: {
    id: string;
    labelAsymId: string | null;
    authAsymId: string | null;
    assemblyCopyIndex: number | null;
    assemblyGeneratorRowIndex: number | null;
    assemblyOperationIds: string[];
    assemblyTransform: unknown;
  },
  label: string,
): void {
  const expectedInstance = {
    id: expected.id,
    labelAsymId: expected.labelAsymId,
    authAsymId: expected.authAsymId,
    assemblyCopyIndex: expected.assemblyCopyIndex,
    assemblyGeneratorRowIndex: expected.assemblyGeneratorRowIndex,
    assemblyOperationIds: expected.assemblyOperationIds,
    assemblyTransform: expected.assemblyTransform,
  };
  if (!jsonEqual(expectedInstance, actual)) {
    throw new Error(`${label} chain-instance provenance does not match the single-audit reference.`);
  }
}

function validateCrossReportProvenance(
  single: SingleAuditExportReport,
  poseEnsemble: PoseEnsembleExportReport | null,
  pairedContext: StatePairExportReport | null,
): void {
  const selection = coordinateSelectionFromReport(single);
  const receptor = single.structure.selectedChains.find((chain) => chain.role === "receptor")!;
  const vhh = single.structure.selectedChains.find((chain) => chain.role === "VHH")!;
  if (poseEnsemble) {
    const reference = poseEnsemble.summary.poses.find((pose) => pose.isReference);
    if (!reference ||
      reference.filename !== single.file ||
      reference.sha256 !== single.structure.sourceFileSha256 ||
      reference.coordinateFingerprint !== selection.selectedCoordinateFingerprint ||
      reference.geometryFingerprint !== selection.selectedGeometryFingerprint ||
      reference.sourceFormat !== selection.sourceFormat ||
      reference.coordinateScope !== selection.coordinateScope ||
      reference.selectedModelId !== selection.selectedModelId ||
      reference.selectedAssemblyId !== selection.selectedAssemblyId
    ) throw new Error("Workspace pose-ensemble reference does not match the canonical single-audit selection.");
    requireMatchingChainInstance(receptor, reference.receptorChain, "Workspace ensemble receptor");
    requireMatchingChainInstance(vhh, reference.vhhChain, "Workspace ensemble VHH");
  }
  if (pairedContext) {
    const reference = pairedContext.summary.reference;
    if (
      reference.filename !== single.file ||
      reference.sha256 !== single.structure.sourceFileSha256 ||
      reference.coordinateFingerprint !== selection.selectedCoordinateFingerprint ||
      reference.geometryFingerprint !== selection.selectedGeometryFingerprint ||
      reference.sourceFormat !== selection.sourceFormat ||
      reference.coordinateScope !== selection.coordinateScope ||
      reference.selectedModelId !== selection.selectedModelId ||
      reference.selectedAssemblyId !== selection.selectedAssemblyId
    ) throw new Error("Workspace paired-context reference does not match the canonical single-audit selection.");
    requireMatchingChainInstance(receptor, reference.receptorChain, "Workspace paired-context receptor");
    requireMatchingChainInstance(vhh, reference.vhhChain, "Workspace paired-context VHH");
  }
}

interface WorkspaceBundleInput {
  context: Partial<ResearchContext> | null | undefined;
  userDefinedFootprint?: IntendedFootprintSummary | null;
  singleAuditReport: unknown;
  poseEnsembleReport?: unknown | null;
  pairedContextReport?: unknown | null;
  generatedAt?: string;
}

export function createWorkspaceBundle(input: WorkspaceBundleInput): WorkspaceBundle {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  requireIsoTimestamp(generatedAt, "Workspace bundle generatedAt");
  const singleAudit = validateImportedSingleAuditReport(input.singleAuditReport);
  const poseEnsemble = canonicalPoseEnsembleReport(input.poseEnsembleReport);
  const pairedContext = canonicalStatePairReport(input.pairedContextReport);
  const workflow = workflowFromReports(singleAudit, poseEnsemble, pairedContext);
  const coordinate = workspaceCoordinateFromReport(singleAudit);
  const decisionBrief = deriveCoordinateTriageBrief(singleAudit.audit, workflow);
  const context = normalizeResearchContext(input.context);
  validateCrossReportProvenance(singleAudit, poseEnsemble, pairedContext);
  if (input.userDefinedFootprint != null) {
    validateIntendedFootprintSummary(input.userDefinedFootprint, coordinate.receptorChain);
    validateFootprintContext(
      input.userDefinedFootprint,
      context.intendedFootprint,
      "Workspace intended-footprint context",
    );
    const observed = new Set(input.userDefinedFootprint.observedReceptorFootprint.map((entry) => entry.residueKey));
    const audited = new Set(singleAudit.audit.receptorInterfaceKeys);
    if (observed.size !== audited.size || [...observed].some((key) => !audited.has(key))) {
      throw new Error("Workspace user-defined footprint does not match the canonical audit receptor footprint.");
    }
    validateFootprintAuditMetadata(input.userDefinedFootprint, singleAudit, "Workspace user-defined footprint");
  }
  if (Boolean(context.intendedFootprint) !== (input.userDefinedFootprint != null)) {
    throw new Error("Workspace intended-footprint context and mapping summary must be present together.");
  }
  const bundle: WorkspaceBundle = {
    schemaVersion: RESEARCH_WORKSPACE_BUNDLE_SCHEMA_VERSION,
    productRelease: CONFOVHH_PRODUCT_RELEASE,
    engineVersion: CONFOVHH_VERSION,
    generatedAt,
    context,
    workflow,
    coordinate,
    decisionBrief,
    userDefinedFootprint: input.userDefinedFootprint == null
      ? null
      : cloneJson(input.userDefinedFootprint, "Workspace user-defined footprint"),
    reports: {
      singleAudit,
      poseEnsemble,
      pairedContext,
    },
    claimBoundary: CLAIM_BOUNDARY,
  };
  requireFiniteJson(bundle, "Workspace bundle");
  return bundle;
}

function validateDecisionBrief(value: unknown): value is CoordinateTriageBrief {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const brief = value as Partial<CoordinateTriageBrief>;
  const boundedStringArray = (candidate: unknown): candidate is string[] => (
    Array.isArray(candidate) && candidate.length <= 200 &&
    candidate.every((item) => (
      typeof item === "string" && Boolean(item) && item.length <= 1_000 && cleanText(item, 1_000) === item
    ))
  );
  return hasExactKeys(brief, [
    "band", "title", "summary", "reviewItems", "evidenceGaps", "nextActions", "boundary",
  ]) && [
    "retain-for-comparison",
    "review-before-comparison",
    "deprioritize-coordinate-pose",
    "coordinate-geometry-coherent",
    "coordinate-geometry-mixed",
    "coordinate-geometry-limited",
    "not-assessable",
  ].includes(brief.band ?? "") &&
    typeof brief.title === "string" && Boolean(brief.title) && brief.title.length <= 1_000 && cleanText(brief.title, 1_000) === brief.title &&
    typeof brief.summary === "string" && Boolean(brief.summary) && brief.summary.length <= 2_000 && cleanText(brief.summary, 2_000) === brief.summary &&
    boundedStringArray(brief.reviewItems) &&
    boundedStringArray(brief.evidenceGaps) &&
    boundedStringArray(brief.nextActions) &&
    brief.boundary === CLAIM_BOUNDARY;
}

export function parseWorkspaceBundle(text: string): WorkspaceBundle {
  const value = parseBoundedJson(
    text,
    MAX_WORKSPACE_BUNDLE_SERIALIZED_BYTES,
    "Workspace dossier import",
  );
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workspace dossier import must be an object.");
  }
  const bundle = value as Partial<WorkspaceBundle>;
  requireExactKeys(bundle, [
    "schemaVersion", "productRelease", "engineVersion", "generatedAt", "context", "workflow",
    "coordinate", "decisionBrief", "userDefinedFootprint", "reports", "claimBoundary",
  ], "Workspace dossier");
  if (
    bundle.schemaVersion !== RESEARCH_WORKSPACE_BUNDLE_SCHEMA_VERSION ||
    !SUPPORTED_PRODUCT_RELEASES.has(bundle.productRelease as SupportedConfoVhhProductRelease) ||
    bundle.engineVersion !== CONFOVHH_VERSION ||
    typeof bundle.generatedAt !== "string" ||
    bundle.claimBoundary !== CLAIM_BOUNDARY
  ) {
    throw new Error("Workspace dossier version or provenance is incompatible with this product release.");
  }
  requireIsoTimestamp(bundle.generatedAt, "Workspace dossier generatedAt");
  if (!bundle.coordinate || !bundle.workflow || !bundle.reports || !bundle.context) {
    throw new Error("Workspace dossier is missing required context, coordinate, workflow, or report fields.");
  }
  requireExactKeys(bundle.context, Object.keys(FIELD_LIMITS), "Workspace dossier context");
  const normalizedContext = normalizeResearchContext(bundle.context);
  if (!jsonEqual(normalizedContext, bundle.context)) {
    throw new Error("Workspace dossier research context is not normalized or bounded.");
  }
  requireExactKeys(bundle.reports, ["singleAudit", "poseEnsemble", "pairedContext"], "Workspace dossier reports");
  const singleAudit = validateImportedSingleAuditReport(bundle.reports.singleAudit);
  const poseEnsemble = canonicalPoseEnsembleReport(bundle.reports.poseEnsemble);
  const pairedContext = canonicalStatePairReport(bundle.reports.pairedContext);
  validateCrossReportProvenance(singleAudit, poseEnsemble, pairedContext);
  const workflow = workflowFromReports(singleAudit, poseEnsemble, pairedContext);
  if (!jsonEqual(bundle.workflow, workflow)) {
    throw new Error("Workspace dossier workflow coverage does not reconcile with its reports.");
  }
  const coordinate = workspaceCoordinateFromReport(singleAudit);
  if (!jsonEqual(bundle.coordinate, coordinate)) {
    throw new Error("Workspace dossier coordinate selection does not match its single-audit provenance.");
  }
  const importedDecisionBrief = deriveCoordinateTriageBriefForRelease(
    singleAudit.audit,
    workflow,
    bundle.productRelease as SupportedConfoVhhProductRelease,
  );
  if (!validateDecisionBrief(bundle.decisionBrief) || !jsonEqual(bundle.decisionBrief, importedDecisionBrief)) {
    throw new Error("Workspace dossier decision brief does not reconcile with its audit and workflow coverage.");
  }
  const decisionBrief = deriveCoordinateTriageBrief(singleAudit.audit, workflow);
  if (bundle.userDefinedFootprint != null) {
    validateIntendedFootprintSummary(bundle.userDefinedFootprint, coordinate.receptorChain);
    validateFootprintContext(
      bundle.userDefinedFootprint,
      normalizedContext.intendedFootprint,
      "Workspace dossier intended-footprint context",
    );
    const observed = new Set(bundle.userDefinedFootprint.observedReceptorFootprint.map((entry) => entry.residueKey));
    const audited = new Set(singleAudit.audit.receptorInterfaceKeys);
    if (observed.size !== audited.size || [...observed].some((key) => !audited.has(key))) {
      throw new Error("Workspace dossier footprint does not reconcile with the canonical receptor contact footprint.");
    }
    validateFootprintAuditMetadata(bundle.userDefinedFootprint, singleAudit, "Workspace dossier footprint");
  }
  if (Boolean(normalizedContext.intendedFootprint) !== (bundle.userDefinedFootprint != null)) {
    throw new Error("Workspace dossier intended-footprint context and mapping summary are inconsistent.");
  }
  return cloneJson({
    schemaVersion: RESEARCH_WORKSPACE_BUNDLE_SCHEMA_VERSION,
    productRelease: CONFOVHH_PRODUCT_RELEASE,
    engineVersion: CONFOVHH_VERSION,
    generatedAt: bundle.generatedAt,
    context: normalizedContext,
    workflow,
    coordinate,
    decisionBrief,
    userDefinedFootprint: bundle.userDefinedFootprint ?? null,
    reports: { singleAudit, poseEnsemble, pairedContext },
    claimBoundary: CLAIM_BOUNDARY,
  }, "Workspace dossier");
}

interface HandoffMarkdownInput {
  singleAuditReport: SingleAuditExportReport;
  context: Partial<ResearchContext> | null | undefined;
  workflow: WorkflowCoverage;
  userDefinedFootprint?: IntendedFootprintSummary | null;
  generatedAt?: string;
}

export function createHandoffMarkdown(input: HandoffMarkdownInput): string {
  const report = validateImportedSingleAuditReport(input.singleAuditReport);
  const coordinate = workspaceCoordinateFromReport(report);
  const audit = report.audit;
  validateWorkflowCoverage(input.workflow, "Handoff workflow coverage");
  if (input.workflow.paeAttached !== (report.pae != null)) {
    throw new Error("Handoff PAE coverage does not match the canonical single-audit report.");
  }
  const decisionBrief = deriveCoordinateTriageBrief(audit, input.workflow);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  requireIsoTimestamp(generatedAt, "Handoff generatedAt");
  const context = normalizeResearchContext(input.context);
  if (input.userDefinedFootprint != null) {
    validateIntendedFootprintSummary(input.userDefinedFootprint, coordinate.receptorChain);
    validateFootprintContext(
      input.userDefinedFootprint,
      context.intendedFootprint,
      "Handoff intended-footprint context",
    );
    const observed = new Set(input.userDefinedFootprint.observedReceptorFootprint.map((entry) => entry.residueKey));
    const audited = new Set(audit.receptorInterfaceKeys);
    if (observed.size !== audited.size || [...observed].some((key) => !audited.has(key))) {
      throw new Error("Handoff user-defined footprint does not match the canonical audit receptor footprint.");
    }
    validateFootprintAuditMetadata(input.userDefinedFootprint, report, "Handoff user-defined footprint");
  }
  if (Boolean(context.intendedFootprint) !== (input.userDefinedFootprint != null)) {
    throw new Error("Handoff intended-footprint context and mapping summary must be present together.");
  }
  const value = (text: string, fallback = "Not recorded") => markdownText(text || fallback);
  const percentage = (share: number | null) => share == null ? "Unavailable" : `${Math.round(share * 100)}%`;
  const lines = [
    `# ConfoVHH coordinate-triage handoff`,
    "",
    `- Product release: ${CONFOVHH_PRODUCT_RELEASE}`,
    `- Scientific engine: ${CONFOVHH_VERSION}`,
    `- Generated: ${generatedAt}`,
    `- Study: ${value(context.studyName)}`,
    `- Receptor: ${value(context.receptorName)}`,
    `- Candidate: ${value(context.candidateId)}`,
    `- Coordinate context: ${value(context.coordinateContext)}`,
    `- Coordinate file: ${value(coordinate.filename)}`,
    `- SHA-256: \`${coordinate.sha256}\``,
    `- Source bytes: ${coordinate.sourceFileBytes}`,
    `- Source format and scope: ${coordinate.sourceFormat}; ${coordinate.coordinateScope}`,
    `- Selected model: ${value(coordinate.selectedModelId)}`,
    `- Selected assembly: ${coordinate.selectedAssemblyId == null ? "none / as supplied" : value(coordinate.selectedAssemblyId)}`,
    `- Selected chains: receptor ${value(coordinate.receptorChain)}; VHH ${value(coordinate.vhhChain)}`,
    `- Receptor chain instance: label ${value(coordinate.receptorChainInstance.labelAsymId ?? "")}; auth ${value(coordinate.receptorChainInstance.authAsymId ?? "")}; copy ${coordinate.receptorChainInstance.assemblyCopyIndex ?? "as supplied"}`,
    `- VHH chain instance: label ${value(coordinate.vhhChainInstance.labelAsymId ?? "")}; auth ${value(coordinate.vhhChainInstance.authAsymId ?? "")}; copy ${coordinate.vhhChainInstance.assemblyCopyIndex ?? "as supplied"}`,
    `- Selected-coordinate fingerprint: \`${coordinate.selectedCoordinateFingerprint}\``,
    `- Selected-geometry fingerprint: \`${coordinate.selectedGeometryFingerprint}\``,
    `- Audit-input fingerprint: \`${coordinate.auditInputFingerprint}\``,
    `- Audit-result fingerprint: \`${coordinate.auditResultFingerprint}\``,
    "",
    `## Coordinate decision brief`,
    "",
    `**${markdownText(decisionBrief.title)}**`,
    "",
    markdownText(decisionBrief.summary),
    "",
    `## Core audit`,
    "",
    `- Evidence band: ${audit.evidenceLevel}`,
    `- Residue-contact pairs: ${audit.contactPairCount}`,
    `- Severe-clash residue pairs: ${audit.severeClashCount}`,
    `- Protein ΔSASA: ${audit.deltaSasaAngstrom2.toFixed(1)} Å²`,
    `- IMGT CDR-contact share: ${percentage(audit.paratopeProxyShare)}`,
    `- IMGT CDR3-contact share: ${percentage(audit.cdr3ProxyShare)}`,
    `- Interface PAE median: ${audit.interfacePaeMedianAngstrom == null ? "Unavailable" : `${audit.interfacePaeMedianAngstrom.toFixed(1)} Å`}`,
    "",
    `## Workflow coverage`,
    "",
    `- Direction-aware PAE attached: ${input.workflow.paeAttached ? "yes" : "no"}`,
    `- Compatible poses in ensemble: ${input.workflow.ensemblePoseCount}`,
    `- Paired coordinate context compared: ${input.workflow.pairedContextCompared ? "yes" : "no"}`,
    "",
    `## Review items`,
    "",
    ...(decisionBrief.reviewItems.length
      ? decisionBrief.reviewItems.map((item) => `- ${markdownText(item)}`)
      : ["- No limited/review audit findings were recorded."]),
    "",
    `## Evidence gaps`,
    "",
    ...decisionBrief.evidenceGaps.map((item) => `- ${markdownText(item)}`),
    "",
    `## Next actions`,
    "",
    ...decisionBrief.nextActions.map((item) => `- ${markdownText(item)}`),
    "",
    `## Research notes`,
    "",
    value(context.notes),
    "",
    `## User-defined intended receptor footprint`,
    "",
    value(context.intendedFootprint),
    ...(input.userDefinedFootprint == null ? [] : [
      "",
      `- Requested identifiers: ${input.userDefinedFootprint.requestedCount}`,
      `- Mapped to selected receptor: ${input.userDefinedFootprint.mappedCount}`,
      `- Present in observed contact footprint: ${input.userDefinedFootprint.contactedCount}`,
      `- Duplicate aliases mapping an already-counted residue: ${input.userDefinedFootprint.duplicateAliases.length}`,
      `- Unmapped identifiers: ${input.userDefinedFootprint.unmapped.length ? input.userDefinedFootprint.unmapped.map(markdownText).join(", ") : "none"}`,
      `- Interpretation: ${markdownText(input.userDefinedFootprint.interpretation)}`,
    ]),
    "",
    `## Claim boundary`,
    "",
    markdownText(decisionBrief.boundary),
    "",
  ];
  return lines.join("\n");
}
