import type { InterfaceAudit, ParsedStructure } from "./confovhh.ts";
import {
  analyzeIntendedFootprint,
  validateIntendedFootprintSummary,
  type IntendedFootprintSummary,
} from "./user-footprint.ts";

export const TOPOLOGY_ANNOTATION_SCHEMA_VERSION = "1.0.0" as const;
export const TOPOLOGY_ANNOTATION_CLAIM_BOUNDARY =
  "This result compares coordinate-defined receptor contacts with user-supplied residue labels. It does not infer or validate a membrane plane, receptor orientation, lipid overlap, epitope accessibility, whole-binder sidedness, biological state, or binding.";

export type IntendedReceptorSide = "unspecified" | "extracellular" | "intracellular";
export type AnnotatedFootprintStatus =
  | "all-side-evaluable-overlap-on-intended-side"
  | "mixed-side-overlap"
  | "no-intended-side-overlap"
  | "descriptive-only"
  | "insufficient-annotation";

export interface UserTopologyAnnotationInput {
  intendedSide: IntendedReceptorSide;
  extracellularResidues: string;
  intracellularResidues: string;
  transmembraneResidues: string;
  annotationSource: string;
}

export interface NormalizedTopologyAnnotation {
  schemaVersion: typeof TOPOLOGY_ANNOTATION_SCHEMA_VERSION;
  receptorChain: string;
  receptorSequence: string;
  intendedSide: IntendedReceptorSide;
  annotationSource: string;
  extracellular: IntendedFootprintSummary;
  intracellular: IntendedFootprintSummary;
  transmembrane: IntendedFootprintSummary;
  extracellularOrders: number[];
  intracellularOrders: number[];
  transmembraneOrders: number[];
  annotationFingerprint: string;
  topologyInferencePerformed: false;
  membranePlaneUsed: false;
  membraneCompatibilityAssessed: false;
  claimBoundary: typeof TOPOLOGY_ANNOTATION_CLAIM_BOUNDARY;
}

export interface AnnotatedFootprintResult {
  status: AnnotatedFootprintStatus;
  interfaceResidueCount: number;
  extracellularContactResidueCount: number;
  intracellularContactResidueCount: number;
  transmembraneContactResidueCount: number;
  otherOrUnannotatedContactResidueCount: number;
  annotationCoverage: number | null;
  sideEvaluableCoverage: number | null;
  intendedSideContactResidueCount: number | null;
  intendedSideShare: number | null;
  intendedSide: IntendedReceptorSide;
  interpretation: string;
  claimBoundary: typeof TOPOLOGY_ANNOTATION_CLAIM_BOUNDARY;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64-topology-v1:${hash.toString(16).padStart(16, "0")}`;
}

function normalizeSource(value: string): string {
  if (typeof value !== "string") throw new Error("Topology annotation source must be text.");
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
}

function orders(summary: IntendedFootprintSummary): number[] {
  return summary.mapped.map((entry) => entry.sequenceOrder).sort((left, right) => left - right);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function fingerprintGroup(summary: IntendedFootprintSummary) {
  return {
    mapped: summary.mapped.map((entry) => ({
      requestedIdentifier: entry.requestedIdentifier,
      canonicalIdentifier: entry.canonicalIdentifier,
      sequenceOrder: entry.sequenceOrder,
    })),
    duplicateAliases: summary.duplicateAliases.map((entry) => ({
      requestedIdentifier: entry.requestedIdentifier,
      canonicalIdentifier: entry.canonicalIdentifier,
      canonicalRequestedIdentifier: entry.canonicalRequestedIdentifier,
    })),
    unmapped: [...summary.unmapped],
  };
}

function annotationFingerprintPayload(annotation: Pick<
  NormalizedTopologyAnnotation,
  | "receptorSequence" | "intendedSide" | "annotationSource"
  | "extracellular" | "intracellular" | "transmembrane"
  | "extracellularOrders" | "intracellularOrders" | "transmembraneOrders"
>): string {
  return JSON.stringify({
    receptorSequence: annotation.receptorSequence,
    intendedSide: annotation.intendedSide,
    annotationSource: annotation.annotationSource,
    extracellular: fingerprintGroup(annotation.extracellular),
    intracellular: fingerprintGroup(annotation.intracellular),
    transmembrane: fingerprintGroup(annotation.transmembrane),
    extracellularOrders: annotation.extracellularOrders,
    intracellularOrders: annotation.intracellularOrders,
    transmembraneOrders: annotation.transmembraneOrders,
  });
}

function requireDisjoint(
  groups: ReadonlyArray<{ label: string; summary: IntendedFootprintSummary }>,
): void {
  const ownerByResidue = new Map<string, string>();
  for (const group of groups) {
    for (const residue of group.summary.mapped) {
      const previous = ownerByResidue.get(residue.residueKey);
      if (previous != null) {
        throw new Error(
          `${residue.canonicalIdentifier} is assigned to both ${previous} and ${group.label}. ` +
          "Every mapped receptor residue must have one mutually exclusive supplied topology class.",
        );
      }
      ownerByResidue.set(residue.residueKey, group.label);
    }
  }
}

export function createTopologyAnnotation(
  structure: ParsedStructure,
  receptorChain: string,
  audit: InterfaceAudit,
  input: UserTopologyAnnotationInput,
): NormalizedTopologyAnnotation {
  if (input == null || typeof input !== "object") throw new Error("Topology annotation input is required.");
  if (!["unspecified", "extracellular", "intracellular"].includes(input.intendedSide)) {
    throw new Error("Intended receptor side must be unspecified, extracellular, or intracellular.");
  }
  const receptor = structure.chains.find((chain) => chain.id === receptorChain);
  if (!receptor) throw new Error("The annotated receptor chain is absent from the selected coordinate structure.");
  if (audit.receptorChain !== receptorChain) {
    throw new Error("The annotated receptor chain does not match the completed coordinate audit.");
  }
  const extracellular = analyzeIntendedFootprint(
    structure,
    receptorChain,
    audit,
    input.extracellularResidues,
  );
  const intracellular = analyzeIntendedFootprint(
    structure,
    receptorChain,
    audit,
    input.intracellularResidues,
  );
  const transmembrane = analyzeIntendedFootprint(
    structure,
    receptorChain,
    audit,
    input.transmembraneResidues,
  );
  requireDisjoint([
    { label: "extracellular", summary: extracellular },
    { label: "intracellular", summary: intracellular },
    { label: "transmembrane", summary: transmembrane },
  ]);
  const extracellularOrders = orders(extracellular);
  const intracellularOrders = orders(intracellular);
  const transmembraneOrders = orders(transmembrane);
  const annotationSource = normalizeSource(input.annotationSource);
  const annotation: NormalizedTopologyAnnotation = {
    schemaVersion: TOPOLOGY_ANNOTATION_SCHEMA_VERSION,
    receptorChain,
    receptorSequence: receptor.sequence,
    intendedSide: input.intendedSide,
    annotationSource,
    extracellular,
    intracellular,
    transmembrane,
    extracellularOrders,
    intracellularOrders,
    transmembraneOrders,
    annotationFingerprint: "",
    topologyInferencePerformed: false,
    membranePlaneUsed: false,
    membraneCompatibilityAssessed: false,
    claimBoundary: TOPOLOGY_ANNOTATION_CLAIM_BOUNDARY,
  };
  annotation.annotationFingerprint = fnv1a64(annotationFingerprintPayload(annotation));
  validateNormalizedTopologyAnnotation(annotation);
  return annotation;
}

export function validateNormalizedTopologyAnnotation(
  value: unknown,
  expected?: { receptorChain?: string; receptorSequence?: string },
): asserts value is NormalizedTopologyAnnotation {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Normalized topology annotation must be an object.");
  }
  const annotation = value as NormalizedTopologyAnnotation;
  if (!exactKeys(annotation, [
    "schemaVersion", "receptorChain", "receptorSequence", "intendedSide", "annotationSource",
    "extracellular", "intracellular", "transmembrane", "extracellularOrders",
    "intracellularOrders", "transmembraneOrders", "annotationFingerprint",
    "topologyInferencePerformed", "membranePlaneUsed", "membraneCompatibilityAssessed",
    "claimBoundary",
  ])) throw new Error("Normalized topology annotation contains missing or unsupported fields.");
  if (
    annotation.schemaVersion !== TOPOLOGY_ANNOTATION_SCHEMA_VERSION ||
    typeof annotation.receptorChain !== "string" || !annotation.receptorChain ||
    annotation.receptorChain.length > 256 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(annotation.receptorChain) ||
    typeof annotation.receptorSequence !== "string" || !/^[A-Z]+$/u.test(annotation.receptorSequence) ||
    annotation.receptorSequence.length > 10_000 ||
    !["unspecified", "extracellular", "intracellular"].includes(annotation.intendedSide) ||
    annotation.annotationSource !== normalizeSource(annotation.annotationSource) ||
    annotation.topologyInferencePerformed !== false || annotation.membranePlaneUsed !== false ||
    annotation.membraneCompatibilityAssessed !== false ||
    annotation.claimBoundary !== TOPOLOGY_ANNOTATION_CLAIM_BOUNDARY
  ) throw new Error("Normalized topology annotation metadata or claim boundary is invalid.");
  if (
    (expected?.receptorChain != null && annotation.receptorChain !== expected.receptorChain) ||
    (expected?.receptorSequence != null && annotation.receptorSequence !== expected.receptorSequence)
  ) throw new Error("Normalized topology annotation does not match the selected receptor chain and sequence.");

  validateIntendedFootprintSummary(annotation.extracellular, annotation.receptorChain);
  validateIntendedFootprintSummary(annotation.intracellular, annotation.receptorChain);
  validateIntendedFootprintSummary(annotation.transmembrane, annotation.receptorChain);
  requireDisjoint([
    { label: "extracellular", summary: annotation.extracellular },
    { label: "intracellular", summary: annotation.intracellular },
    { label: "transmembrane", summary: annotation.transmembrane },
  ]);
  for (const [label, supplied, expectedOrders] of [
    ["extracellular", annotation.extracellularOrders, orders(annotation.extracellular)],
    ["intracellular", annotation.intracellularOrders, orders(annotation.intracellular)],
    ["transmembrane", annotation.transmembraneOrders, orders(annotation.transmembrane)],
  ] as const) {
    if (
      !Array.isArray(supplied) || supplied.length !== expectedOrders.length ||
      supplied.some((entry, index) => entry !== expectedOrders[index]) ||
      supplied.some((entry) => !Number.isSafeInteger(entry) || entry <= 0 || entry > annotation.receptorSequence.length)
    ) throw new Error(`Normalized ${label} topology residue orders are invalid or inconsistent.`);
  }
  const expectedFingerprint = fnv1a64(annotationFingerprintPayload(annotation));
  if (annotation.annotationFingerprint !== expectedFingerprint) {
    throw new Error("Normalized topology annotation fingerprint does not match its supplied residue classes.");
  }
}

function intersectionSize(values: ReadonlySet<number>, available: ReadonlySet<number>): number {
  let count = 0;
  for (const value of values) if (available.has(value)) count += 1;
  return count;
}

export function evaluateAnnotatedFootprint(
  annotation: NormalizedTopologyAnnotation,
  receptorInterfaceOrders: readonly number[],
): AnnotatedFootprintResult {
  validateNormalizedTopologyAnnotation(annotation);
  if (!Array.isArray(receptorInterfaceOrders) || receptorInterfaceOrders.some((value) => (
    !Number.isSafeInteger(value) || value <= 0
  ))) throw new Error("Observed receptor interface orders must be positive safe integers.");
  const interfaceOrders = new Set(receptorInterfaceOrders);
  if (interfaceOrders.size !== receptorInterfaceOrders.length) {
    throw new Error("Observed receptor interface orders cannot contain duplicates.");
  }
  const extracellular = new Set(annotation.extracellularOrders);
  const intracellular = new Set(annotation.intracellularOrders);
  const transmembrane = new Set(annotation.transmembraneOrders);
  const extracellularCount = intersectionSize(extracellular, interfaceOrders);
  const intracellularCount = intersectionSize(intracellular, interfaceOrders);
  const transmembraneCount = intersectionSize(transmembrane, interfaceOrders);
  const interfaceResidueCount = interfaceOrders.size;
  const annotatedCount = extracellularCount + intracellularCount + transmembraneCount;
  const sideEvaluableCount = extracellularCount + intracellularCount;
  const intendedSideCount = annotation.intendedSide === "extracellular"
    ? extracellularCount
    : annotation.intendedSide === "intracellular"
      ? intracellularCount
      : null;
  let status: AnnotatedFootprintStatus;
  if (!interfaceResidueCount || !sideEvaluableCount) status = "insufficient-annotation";
  else if (annotation.intendedSide === "unspecified") status = "descriptive-only";
  else if (intendedSideCount === sideEvaluableCount) status = "all-side-evaluable-overlap-on-intended-side";
  else if (intendedSideCount === 0) status = "no-intended-side-overlap";
  else status = "mixed-side-overlap";
  return {
    status,
    interfaceResidueCount,
    extracellularContactResidueCount: extracellularCount,
    intracellularContactResidueCount: intracellularCount,
    transmembraneContactResidueCount: transmembraneCount,
    otherOrUnannotatedContactResidueCount: interfaceResidueCount - annotatedCount,
    annotationCoverage: interfaceResidueCount ? annotatedCount / interfaceResidueCount : null,
    sideEvaluableCoverage: interfaceResidueCount ? sideEvaluableCount / interfaceResidueCount : null,
    intendedSideContactResidueCount: intendedSideCount,
    intendedSideShare: intendedSideCount == null || !sideEvaluableCount
      ? null
      : intendedSideCount / sideEvaluableCount,
    intendedSide: annotation.intendedSide,
    interpretation:
      "Counts describe overlap between unique coordinate-contacting receptor residues and the mutually exclusive residue classes supplied by the researcher. Transmembrane and unannotated residues are excluded from intended-side share.",
    claimBoundary: TOPOLOGY_ANNOTATION_CLAIM_BOUNDARY,
  };
}

export function analyzeAnnotatedFootprint(
  structure: ParsedStructure,
  receptorChain: string,
  audit: InterfaceAudit,
  input: UserTopologyAnnotationInput,
): { annotation: NormalizedTopologyAnnotation; result: AnnotatedFootprintResult } {
  const annotation = createTopologyAnnotation(structure, receptorChain, audit, input);
  const receptor = structure.chains.find((chain) => chain.id === receptorChain)!;
  const orderByKey = new Map(receptor.residues.map((residue) => [residue.key, residue.order]));
  const receptorInterfaceOrders = audit.receptorInterfaceKeys.map((key) => {
    const order = orderByKey.get(key);
    if (order == null) throw new Error("A coordinate audit receptor contact is absent from the annotated receptor chain.");
    return order;
  }).sort((left, right) => left - right);
  return { annotation, result: evaluateAnnotatedFootprint(annotation, receptorInterfaceOrders) };
}
