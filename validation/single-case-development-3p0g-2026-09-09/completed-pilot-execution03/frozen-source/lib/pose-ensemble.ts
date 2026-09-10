import {
  CANONICAL_SASA_FRAME_ALGORITHM,
  CDR_ANNOTATION_METHOD_DESCRIPTION,
  CONFOVHH_VERSION,
  MAX_CANONICAL_COORDINATE_ANGSTROM,
  PAE_SUMMARY_METHOD_DESCRIPTION,
  SASA_RADII_METHOD_DESCRIPTION,
  verifyInterfaceAuditAttestation,
  type EvidenceLevel,
  type InterfaceAudit,
  type ParsedStructure,
} from "./confovhh.ts";
import {
  canonicalizeSelectedGeometry,
  geometryFitIsDuplicate,
  selectedGeometryAtoms,
  selectedGeometryFit,
} from "./geometry-fit.ts";
export {
  canonicalizeSelectedGeometry,
  GEOMETRY_DUPLICATE_MAX_DEVIATION_ANGSTROM,
  GEOMETRY_DUPLICATE_RMSD_ANGSTROM,
  geometryFitIsDuplicate,
  selectedGeometryFit,
} from "./geometry-fit.ts";

export const MAX_ENSEMBLE_POSES = 12;
export const POSE_ENSEMBLE_EXPORT_SCHEMA_VERSION = "1.2.0" as const;
export const POSE_ENSEMBLE_CLAIM_BOUNDARY =
  "Pose consensus measures reproducibility within the uploaded ensemble, not correctness, affinity, specificity, or conformational selectivity.";

export interface EnsemblePoseInput {
  id: string;
  filename: string;
  sha256?: string | null;
  bytes?: number | null;
  structure: ParsedStructure;
  audit: InterfaceAudit;
  coordinateFingerprint?: string;
  geometryFingerprint?: string;
}

export type CoordinateOnlyAuditPolicy = InterfaceAudit["methods"] & {
  fingerprint: string;
  confidenceMode: "none";
  pae: "omitted";
  sasaOrientation: "deterministic-proper-signed-frame";
};

export type EnsembleTriageGroup = "coherent" | "review" | "low-priority";

export interface EnsemblePoseSummary {
  id: string;
  filename: string;
  sha256: string | null;
  coordinateFingerprint: string;
  geometryFingerprint: string;
  bytes: number | null;
  isReference: boolean;
  rank: number;
  triageGroup: EnsembleTriageGroup;
  evidenceLevel: EvidenceLevel;
  contactPairCount: number;
  severeClashCount: number;
  deltaSasaAngstrom2: number;
  interfacePaeMedianAngstrom: number | null;
  contactPairConsensus: number | null;
  receptorEpitopeConsensus: number | null;
  vhhParatopeConsensus: number | null;
  ensembleConsensus: number | null;
  recurrentContactShare: number | null;
  comparisonCount: number;
  sourceFormat: ParsedStructure["sourceFormat"];
  coordinateScope: ParsedStructure["coordinateScope"];
  selectedModelId: string;
  selectedAssemblyId: string | null;
  receptorChain: {
    id: string;
    labelAsymId: string | null;
    authAsymId: string | null;
    assemblyCopyIndex: number | null;
    assemblyGeneratorRowIndex: number | null;
    assemblyOperationIds: string[];
    assemblyTransform: ChainSummaryTransform;
  };
  vhhChain: {
    id: string;
    labelAsymId: string | null;
    authAsymId: string | null;
    assemblyCopyIndex: number | null;
    assemblyGeneratorRowIndex: number | null;
    assemblyOperationIds: string[];
    assemblyTransform: ChainSummaryTransform;
  };
}

type ChainSummaryTransform = ParsedStructure["chains"][number]["assemblyTransform"] | null;

export interface PoseEnsembleSummary {
  version: string;
  poseCount: number;
  referencePoseId: string;
  receptorSequenceLength: number;
  vhhSequenceLength: number;
  poses: EnsemblePoseSummary[];
  pairwisePoseIds: string[];
  pairwiseConsensus: Array<Array<number | null>>;
  auditPolicy: CoordinateOnlyAuditPolicy;
  methods: {
    residueMapping: string;
    contactPairConsensus: string;
    receptorEpitopeConsensus: string;
    vhhParatopeConsensus: string;
    ensembleConsensus: string;
    ranking: string;
    recurrentContactShare: string;
  };
  warnings: string[];
}

export interface PoseEnsembleExportReport {
  schemaVersion: typeof POSE_ENSEMBLE_EXPORT_SCHEMA_VERSION;
  softwareVersion: string;
  version: string;
  generatedAt: string;
  comparisonMode: string;
  referencePoseId: string;
  rejected: Array<{ filename: string; sha256: string; bytes: number; reason: string }>;
  auditPolicy: CoordinateOnlyAuditPolicy;
  summary: PoseEnsembleSummary;
}

interface PoseFingerprint {
  contactPairs: Set<string>;
  receptorResidues: Set<string>;
  vhhResidues: Set<string>;
}

function fnv1a64Update(hash: bigint, value: string): bigint {
  let next = hash;
  for (let index = 0; index < value.length; index += 1) {
    next ^= BigInt(value.charCodeAt(index));
    next = BigInt.asUintN(64, next * 0x100000001b3n);
  }
  return next;
}

function expectedEnsembleMethods(poseCount: number): PoseEnsembleSummary["methods"] {
  const recurrentMinimum = Math.max(2, Math.ceil(poseCount / 2));
  return {
    residueMapping: "Exact observed receptor and VHH sequences; contacts are mapped by one-based sequence order within each selected chain.",
    contactPairConsensus: "Mean Jaccard similarity of receptor–VHH residue-contact pairs against every other pose.",
    receptorEpitopeConsensus: "Mean Jaccard similarity of contacting receptor residue sets against every other pose.",
    vhhParatopeConsensus: "Mean Jaccard similarity of contacting VHH residue sets against every other pose.",
    ensembleConsensus: "Unweighted mean of available contact-pair, receptor-epitope, and VHH-paratope consensus values.",
    ranking: "Ensemble consensus first, then fewer severe clashes. Poses tied on both receive the same competition rank; stable code-unit pose identifier controls display order only. Evidence bands and ΔSASA remain visible but do not control rank; no binding score is produced.",
    recurrentContactShare: `Fraction of a pose's residue-contact pairs present in at least ${recurrentMinimum} of ${poseCount} poses.`,
  };
}

function stableAuditMethodPayload(methods: InterfaceAudit["methods"]): InterfaceAudit["methods"] {
  const numericKeys = [
    "residueContactCutoffAngstrom", "polarProxyCutoffAngstrom",
    "saltBridgeProxyCutoffAngstrom", "severeClashOverlapAngstrom",
    "sasaProbeRadiusAngstrom", "sasaSpherePoints",
    "sasaMaximumCandidateDistanceChecks", "sasaMaximumOcclusionChecks",
  ] as const;
  for (const key of numericKeys) {
    if (!Number.isFinite(methods?.[key]) || methods[key] <= 0) {
      throw new Error(`Every compared audit requires a complete positive finite methods.${key} value.`);
    }
  }
  const textKeys = ["sasaRadii", "sasaFrameAlgorithm", "cdrAnnotation", "paeSummary"] as const;
  for (const key of textKeys) {
    if (typeof methods?.[key] !== "string" || !methods[key].trim()) {
      throw new Error(`Every compared audit requires a complete methods.${key} description.`);
    }
  }
  const expectedFixedPolicy = {
    residueContactCutoffAngstrom: 4.5,
    polarProxyCutoffAngstrom: 3.5,
    saltBridgeProxyCutoffAngstrom: 4,
    severeClashOverlapAngstrom: 0.6,
    sasaProbeRadiusAngstrom: 1.4,
    sasaSpherePoints: 960,
    sasaMaximumCandidateDistanceChecks: 25_000_000,
    sasaMaximumOcclusionChecks: 250_000_000,
    sasaRadii: SASA_RADII_METHOD_DESCRIPTION,
    sasaFrameAlgorithm: CANONICAL_SASA_FRAME_ALGORITHM,
    cdrAnnotation: CDR_ANNOTATION_METHOD_DESCRIPTION,
    paeSummary: PAE_SUMMARY_METHOD_DESCRIPTION,
  } as const;
  for (const [key, expected] of Object.entries(expectedFixedPolicy)) {
    if (methods[key as keyof typeof expectedFixedPolicy] !== expected) {
      throw new Error(`Compared audits must use the current fixed ConfoVHH methods.${key} policy.`);
    }
  }
  return {
    residueContactCutoffAngstrom: methods.residueContactCutoffAngstrom,
    polarProxyCutoffAngstrom: methods.polarProxyCutoffAngstrom,
    saltBridgeProxyCutoffAngstrom: methods.saltBridgeProxyCutoffAngstrom,
    severeClashOverlapAngstrom: methods.severeClashOverlapAngstrom,
    sasaProbeRadiusAngstrom: methods.sasaProbeRadiusAngstrom,
    sasaSpherePoints: methods.sasaSpherePoints,
    sasaMaximumCandidateDistanceChecks: methods.sasaMaximumCandidateDistanceChecks,
    sasaMaximumOcclusionChecks: methods.sasaMaximumOcclusionChecks,
    sasaRadii: methods.sasaRadii,
    sasaOrientation: methods.sasaOrientation,
    sasaFrameAlgorithm: methods.sasaFrameAlgorithm,
    cdrAnnotation: methods.cdrAnnotation,
    paeSummary: methods.paeSummary,
  };
}

function coordinateOnlyPolicyFingerprint(
  policy: Omit<CoordinateOnlyAuditPolicy, "fingerprint">,
): string {
  let hash = 0xcbf29ce484222325n;
  hash = fnv1a64Update(hash, JSON.stringify(policy));
  return `fnv1a64-audit-policy:${hash.toString(16).padStart(16, "0")}`;
}

export function coordinateOnlyAuditPolicy(
  audits: readonly InterfaceAudit[],
): CoordinateOnlyAuditPolicy {
  if (!audits.length) throw new Error("At least one interface audit is required to define policy.");
  const payloads = audits.map((audit) => {
    if (
      audit.confidenceMode !== "none" || audit.paeFilename != null || audit.paeOrderConfirmed ||
      audit.interfaceConfidence != null || audit.interfaceConfidenceCoverage != null ||
      audit.interfacePaeMedianAngstrom != null || audit.interfacePaeP90Angstrom != null ||
      audit.receptorFrameToVhhPaeMedianAngstrom != null ||
      audit.vhhFrameToReceptorPaeMedianAngstrom != null ||
      audit.receptorFrameToVhhPaeP90Angstrom != null ||
      audit.vhhFrameToReceptorPaeP90Angstrom != null || audit.lowPaeContactShare != null
    ) {
      throw new Error(
        "Ensemble and paired comparisons require coordinate-only audits with PAE omitted and confidence mode none.",
      );
    }
    if (audit.methods.sasaOrientation !== "deterministic-proper-signed-frame") {
      throw new Error(
        "Ensemble and paired comparisons require audits produced with the verified deterministic canonical SASA frame.",
      );
    }
    if (audit.methods.sasaFrameAlgorithm !== CANONICAL_SASA_FRAME_ALGORITHM) {
      throw new Error(
        "Ensemble and paired comparisons require the current verified canonical SASA frame algorithm.",
      );
    }
    return stableAuditMethodPayload(audit.methods);
  });
  const serialized = payloads.map((methods) => JSON.stringify(methods));
  if (serialized.some((value) => value !== serialized[0])) {
    throw new Error("Compared audits use different scientific method policies and cannot be combined.");
  }
  const policyWithoutFingerprint = {
    confidenceMode: "none" as const,
    pae: "omitted" as const,
    ...payloads[0],
    sasaOrientation: "deterministic-proper-signed-frame" as const,
  };
  return {
    fingerprint: coordinateOnlyPolicyFingerprint(policyWithoutFingerprint),
    ...policyWithoutFingerprint,
  };
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeOptionalSha256(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${label} must be a 64-character hexadecimal SHA-256 digest when present.`);
  }
  return value.toLowerCase();
}

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

export function selectedCoordinateFingerprint(
  structure: ParsedStructure,
  receptorChainId: string,
  vhhChainId: string,
): string {
  let hash = 0xcbf29ce484222325n;
  for (const [role, chainId] of [["receptor", receptorChainId], ["vhh", vhhChainId]] as const) {
    const chain = structure.chains.find((candidate) => candidate.id === chainId);
    if (!chain) throw new Error(`Selected ${role} chain ${chainId} is missing while fingerprinting coordinates.`);
    hash = fnv1a64Update(hash, `${role}|${chain.sequence}|${chain.residueCount}|`);
    for (const residue of chain.residues) {
      hash = fnv1a64Update(hash, `${JSON.stringify([role, residue.order, residue.oneLetter])}|`);
      for (const atom of [...residue.atoms].sort((left, right) => (
        codeUnitCompare(JSON.stringify([left.name, left.element]), JSON.stringify([right.name, right.element]))
      ))) {
        hash = fnv1a64Update(
          hash,
          `${JSON.stringify([atom.name, atom.element, atom.x.toFixed(3), atom.y.toFixed(3), atom.z.toFixed(3)])}|`,
        );
      }
    }
  }
  return `fnv1a64-3dp:${hash.toString(16).padStart(16, "0")}`;
}

/** A coarse, rigid-transform-invariant provenance hash; duplicate decisions use an explicit fit. */
export function selectedGeometryFingerprint(
  structure: ParsedStructure,
  receptorChainId: string,
  vhhChainId: string,
): string {
  const canonical = canonicalizeSelectedGeometry(structure, receptorChainId, vhhChainId);
  const selected = selectedGeometryAtoms(
    canonical,
    receptorChainId,
    vhhChainId,
    MAX_CANONICAL_COORDINATE_ANGSTROM,
  );
  let hash = 0xcbf29ce484222325n;
  const fixedGeometryCoordinate = (value: number): string => {
    const fixed = value.toFixed(2);
    return fixed === "-0.00" ? "0.00" : fixed;
  };
  for (const entry of selected) {
    hash = fnv1a64Update(hash, JSON.stringify([
      entry.identity,
      fixedGeometryCoordinate(entry.atom.x),
      fixedGeometryCoordinate(entry.atom.y),
      fixedGeometryCoordinate(entry.atom.z),
    ]));
  }
  return `fnv1a64-se3-2dp:${hash.toString(16).padStart(16, "0")}`;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  // Stable numeric order makes exported recurrence values byte-identical when
  // the same poses arrive in a different upload order.
  const ordered = [...values].sort((left, right) => left - right);
  return ordered.reduce((sum, value) => sum + value, 0) / ordered.length;
}

export function jaccardIndex(a: Set<string>, b: Set<string>): number | null {
  if (!a.size && !b.size) return null;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

function fingerprint(audit: InterfaceAudit): PoseFingerprint {
  return {
    contactPairs: new Set(audit.contacts.map(
      (contact) => `${contact.receptorResidueOrder}\u0000${contact.vhhResidueOrder}`,
    )),
    receptorResidues: new Set(audit.contacts.map(
      (contact) => String(contact.receptorResidueOrder),
    )),
    vhhResidues: new Set(audit.contacts.map(
      (contact) => String(contact.vhhResidueOrder),
    )),
  };
}

function validateEnsembleAudit(pose: EnsemblePoseInput, expectedVersion: string): void {
  const { audit } = pose;
  if (audit.version !== expectedVersion) {
    throw new Error(`${pose.filename}: every ensemble audit must use software version ${expectedVersion}.`);
  }
  if (!new Set<EvidenceLevel>(["supported", "mixed", "limited", "not-assessable"])
    .has(audit.evidenceLevel)) {
    throw new Error(`${pose.filename}: the coordinate evidence level is invalid.`);
  }
  if (audit.receptorChain === audit.vhhChain) {
    throw new Error(`${pose.filename}: receptor and VHH must be different selected chains.`);
  }
  for (const [label, value] of [
    ["contact-pair count", audit.contactPairCount],
    ["atom-contact count", audit.atomContactCount],
    ["receptor-interface residue count", audit.receptorInterfaceResidues],
    ["VHH-interface residue count", audit.vhhInterfaceResidues],
    ["polar-contact proxy count", audit.polarContactProxyCount],
    ["salt-bridge proxy count", audit.saltBridgeProxyCount],
    ["severe-clash count", audit.severeClashCount],
    ["possible interchain-disulfide count", audit.possibleInterchainDisulfideCount],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${pose.filename}: ${label} must be a non-negative safe integer.`);
    }
  }
  if (audit.atomContactCount < audit.contactPairCount) {
    throw new Error(`${pose.filename}: atomContactCount cannot be smaller than contactPairCount.`);
  }
  if (audit.polarContactProxyCount > audit.atomContactCount ||
      audit.saltBridgeProxyCount > audit.atomContactCount) {
    throw new Error(`${pose.filename}: polar/salt proxy counts cannot exceed atomContactCount.`);
  }
  if (audit.severeClashCount > audit.contactPairCount ||
      audit.possibleInterchainDisulfideCount > audit.contactPairCount) {
    throw new Error(`${pose.filename}: clash/disulfide counts cannot exceed contactPairCount.`);
  }
  for (const [label, value] of [
    ["maximum van der Waals overlap", audit.maximumOverlapAngstrom],
    ["protein ΔSASA", audit.deltaSasaAngstrom2],
    ["receptor buried surface area", audit.receptorBuriedSurfaceAreaAngstrom2],
    ["VHH buried surface area", audit.vhhBuriedSurfaceAreaAngstrom2],
    ["half-ΔSASA interface area", audit.halfDeltaSasaInterfaceAreaAngstrom2],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${pose.filename}: ${label} must be finite and non-negative.`);
    }
  }
  const sasaTolerance = Math.max(1e-8, audit.deltaSasaAngstrom2 * 1e-10);
  if (Math.abs(
    audit.receptorBuriedSurfaceAreaAngstrom2 +
    audit.vhhBuriedSurfaceAreaAngstrom2 -
    audit.deltaSasaAngstrom2
  ) > sasaTolerance) {
    throw new Error(`${pose.filename}: receptor and VHH buried areas do not reconcile with protein ΔSASA.`);
  }
  if (Math.abs(
    audit.halfDeltaSasaInterfaceAreaAngstrom2 - audit.deltaSasaAngstrom2 / 2
  ) > sasaTolerance) {
    throw new Error(`${pose.filename}: half-ΔSASA interface area is inconsistent with protein ΔSASA.`);
  }
  for (const [label, value] of [
    ["IMGT CDR-contact share", audit.paratopeProxyShare],
    ["IMGT CDR3-contact share", audit.cdr3ProxyShare],
  ] as const) {
    if (value != null && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error(`${pose.filename}: ${label} must be null or within [0, 1].`);
    }
  }
  if (!Array.isArray(audit.contacts) || audit.contacts.length !== audit.contactPairCount) {
    throw new Error(`${pose.filename}: contact records must reconcile with contactPairCount.`);
  }
  const seenContacts = new Set<string>();
  const receptor = pose.structure.chains.find((chain) => chain.id === audit.receptorChain);
  const vhh = pose.structure.chains.find((chain) => chain.id === audit.vhhChain);
  if (!receptor || !vhh) {
    throw new Error(`${pose.filename}: the audited receptor or VHH chain is missing.`);
  }
  for (const contact of audit.contacts) {
    if (
      !Number.isSafeInteger(contact.receptorResidueOrder) ||
      contact.receptorResidueOrder < 1 ||
      contact.receptorResidueOrder > receptor.sequence.length ||
      !Number.isSafeInteger(contact.vhhResidueOrder) ||
      contact.vhhResidueOrder < 1 ||
      contact.vhhResidueOrder > vhh.sequence.length
    ) {
      throw new Error(`${pose.filename}: contact residue orders must be positive safe integers.`);
    }
    if (
      !Number.isFinite(contact.minimumDistance) ||
      contact.minimumDistance < 0 ||
      contact.minimumDistance > audit.methods.residueContactCutoffAngstrom
    ) {
      throw new Error(`${pose.filename}: contact minimum distances must be finite and within the contact cutoff.`);
    }
    if (contact.receptorConfidence != null || contact.vhhConfidence != null) {
      throw new Error(`${pose.filename}: per-contact confidence must be omitted from coordinate-only audits.`);
    }
    const key = JSON.stringify([contact.receptorResidueOrder, contact.vhhResidueOrder]);
    if (seenContacts.has(key)) {
      throw new Error(`${pose.filename}: duplicate receptor–VHH contact records are not allowed.`);
    }
    seenContacts.add(key);
  }
  if (new Set(audit.contacts.map((contact) => contact.receptorResidueOrder)).size !==
      audit.receptorInterfaceResidues) {
    throw new Error(`${pose.filename}: receptor interface-residue count does not match contacts.`);
  }
  if (new Set(audit.contacts.map((contact) => contact.vhhResidueOrder)).size !==
      audit.vhhInterfaceResidues) {
    throw new Error(`${pose.filename}: VHH interface-residue count does not match contacts.`);
  }
}

function selectedSequences(pose: EnsemblePoseInput): {
  receptor: string;
  vhh: string;
} {
  const receptor = pose.structure.chains.find((chain) => chain.id === pose.audit.receptorChain);
  const vhh = pose.structure.chains.find((chain) => chain.id === pose.audit.vhhChain);
  if (!receptor || !vhh) {
    throw new Error(`${pose.filename}: the audited receptor or VHH chain is missing from the parsed structure.`);
  }
  return { receptor: receptor.sequence, vhh: vhh.sequence };
}

function selectedChainProvenance(pose: EnsemblePoseInput, chainId: string) {
  const chain = pose.structure.chains.find((candidate) => candidate.id === chainId);
  if (!chain) throw new Error(`${pose.filename}: selected chain ${chainId} is missing.`);
  return {
    id: chain.id,
    labelAsymId: chain.labelAsymId ?? null,
    authAsymId: chain.authAsymId ?? null,
    assemblyCopyIndex: chain.assemblyCopyIndex ?? null,
    assemblyGeneratorRowIndex: chain.assemblyGeneratorRowIndex ?? null,
    assemblyOperationIds: [...(chain.assemblyOperationIds ?? [])],
    assemblyTransform: chain.assemblyTransform == null
      ? null
      : chain.assemblyTransform.map((row) => [...row]) as NonNullable<ChainSummaryTransform>,
  };
}

function verifiedPoseFingerprint(
  pose: EnsemblePoseInput,
  kind: "coordinate" | "geometry",
): string {
  const supplied = kind === "coordinate"
    ? pose.coordinateFingerprint
    : pose.geometryFingerprint;
  const receptor = pose.structure.chains.find((chain) => chain.id === pose.audit.receptorChain);
  const vhh = pose.structure.chains.find((chain) => chain.id === pose.audit.vhhChain);
  const canRecompute = receptor != null && vhh != null &&
    Array.isArray(receptor.residues) && Array.isArray(vhh.residues);
  if (!canRecompute) {
    if (supplied != null) {
      throw new Error(`${pose.filename}: the supplied ${kind} fingerprint cannot be verified from the parsed coordinates.`);
    }
    return `unavailable:${pose.id}`;
  }
  const computed = kind === "coordinate"
    ? selectedCoordinateFingerprint(
        pose.structure,
        pose.audit.receptorChain,
        pose.audit.vhhChain,
      )
    : selectedGeometryFingerprint(
        pose.structure,
        pose.audit.receptorChain,
        pose.audit.vhhChain,
      );
  if (supplied != null && supplied !== computed) {
    throw new Error(`${pose.filename}: the supplied ${kind} fingerprint does not match the selected coordinates.`);
  }
  return computed;
}

function triageGroup(audit: InterfaceAudit): EnsembleTriageGroup {
  if (audit.evidenceLevel === "supported") return "coherent";
  if (audit.evidenceLevel === "mixed") return "review";
  return "low-priority";
}

export function matchEnsembleChains(
  structure: ParsedStructure,
  receptorSequence: string,
  vhhSequence: string,
): { receptorChain: string; vhhChain: string } {
  const receptorCandidates = structure.chains.filter((chain) => chain.sequence === receptorSequence);
  const vhhCandidates = structure.chains.filter((chain) => chain.sequence === vhhSequence);
  let matched: { receptorChain: string; vhhChain: string } | null = null;
  for (const receptor of receptorCandidates) {
    for (const vhh of vhhCandidates) {
      if (receptor.id === vhh.id) continue;
      if (matched) {
        throw new Error(
          "The pose contains multiple indistinguishable receptor–VHH copies. Reduce it to one pair before ensemble comparison.",
        );
      }
      matched = { receptorChain: receptor.id, vhhChain: vhh.id };
    }
  }
  if (!matched) {
    throw new Error(
      "The pose does not contain exact observed receptor and VHH sequences matching the reference pose.",
    );
  }
  return matched;
}

export function summarizePoseEnsemble(inputs: EnsemblePoseInput[]): PoseEnsembleSummary {
  if (inputs.length < 2) throw new Error("Ensemble comparison requires at least two audited poses.");
  if (inputs.length > MAX_ENSEMBLE_POSES) {
    throw new Error(`Ensemble comparison supports at most ${MAX_ENSEMBLE_POSES} poses per browser session.`);
  }
  const normalizedSha256: Array<string | null> = [];
  for (const pose of inputs) {
    if (typeof pose.id !== "string" || !pose.id.trim()) {
      throw new Error("Every ensemble pose requires a non-empty identifier.");
    }
    if (typeof pose.filename !== "string" || !pose.filename.trim()) {
      throw new Error("Every ensemble pose requires a non-empty filename.");
    }
    if (pose.bytes != null && (!Number.isSafeInteger(pose.bytes) || pose.bytes < 0)) {
      throw new Error(`${pose.filename}: byte count must be a non-negative safe integer when present.`);
    }
    normalizedSha256.push(normalizeOptionalSha256(pose.sha256, `${pose.filename}: source digest`));
  }
  const ids = new Set(inputs.map((pose) => pose.id));
  if (ids.size !== inputs.length) throw new Error("Every ensemble pose requires a unique identifier.");
  const expectedVersion = inputs[0].audit.version;
  if (expectedVersion !== CONFOVHH_VERSION) {
    throw new Error(`Every ensemble audit must use current ConfoVHH software version ${CONFOVHH_VERSION}.`);
  }
  for (const pose of inputs) validateEnsembleAudit(pose, expectedVersion);
  const auditPolicy = coordinateOnlyAuditPolicy(inputs.map((pose) => pose.audit));
  for (const pose of inputs) {
    verifyInterfaceAuditAttestation(
      pose.structure,
      pose.audit.receptorChain,
      pose.audit.vhhChain,
      pose.audit,
      null,
      false,
    );
  }
  const coordinateFingerprints = inputs.map((pose) => verifiedPoseFingerprint(pose, "coordinate"));
  const availableFingerprints = coordinateFingerprints.filter((value) => !value.startsWith("unavailable:"));
  if (new Set(availableFingerprints).size !== availableFingerprints.length) {
    throw new Error("The ensemble contains duplicate selected receptor–VHH source-frame coordinates.");
  }
  const geometryFingerprints = inputs.map((pose) => verifiedPoseFingerprint(pose, "geometry"));
  const referenceSequences = selectedSequences(inputs[0]);
  for (const pose of inputs.slice(1)) {
    const sequences = selectedSequences(pose);
    if (sequences.receptor !== referenceSequences.receptor || sequences.vhh !== referenceSequences.vhh) {
      throw new Error(
        `${pose.filename}: exact observed receptor and VHH sequences do not match the reference pose.`,
      );
    }
  }
  for (let leftIndex = 0; leftIndex < inputs.length; leftIndex += 1) {
    const leftReceptor = inputs[leftIndex].structure.chains.find(
      (chain) => chain.id === inputs[leftIndex].audit.receptorChain,
    );
    const leftVhh = inputs[leftIndex].structure.chains.find(
      (chain) => chain.id === inputs[leftIndex].audit.vhhChain,
    );
    if (!Array.isArray(leftReceptor?.residues) || !Array.isArray(leftVhh?.residues)) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < inputs.length; rightIndex += 1) {
      const rightReceptor = inputs[rightIndex].structure.chains.find(
        (chain) => chain.id === inputs[rightIndex].audit.receptorChain,
      );
      const rightVhh = inputs[rightIndex].structure.chains.find(
        (chain) => chain.id === inputs[rightIndex].audit.vhhChain,
      );
      if (!Array.isArray(rightReceptor?.residues) || !Array.isArray(rightVhh?.residues)) continue;
      const fit = selectedGeometryFit(
        inputs[leftIndex].structure,
        inputs[leftIndex].audit.receptorChain,
        inputs[leftIndex].audit.vhhChain,
        inputs[rightIndex].structure,
        inputs[rightIndex].audit.receptorChain,
        inputs[rightIndex].audit.vhhChain,
      );
      if (fit == null) {
        throw new Error(
          `${inputs[rightIndex].filename}: selected receptor–VHH atom inventory is incompatible with ` +
          `${inputs[leftIndex].filename}; ensemble geometry comparison requires identical selected atom identities.`,
        );
      }
      if (geometryFitIsDuplicate(fit)) {
        throw new Error(
          `${inputs[rightIndex].filename}: near-duplicate selected receptor–VHH geometry matches ` +
          `${inputs[leftIndex].filename} after a proper-rotation/translation fit.`,
        );
      }
    }
  }

  const fingerprints = inputs.map((pose) => fingerprint(pose.audit));
  const inputOrderPairwiseConsensus: Array<Array<number | null>> = inputs.map((_, rowIndex) => (
    inputs.map((__, columnIndex) => {
      if (rowIndex === columnIndex) return 1;
      const contact = jaccardIndex(
        fingerprints[rowIndex].contactPairs,
        fingerprints[columnIndex].contactPairs,
      );
      const receptor = jaccardIndex(
        fingerprints[rowIndex].receptorResidues,
        fingerprints[columnIndex].receptorResidues,
      );
      const vhh = jaccardIndex(
        fingerprints[rowIndex].vhhResidues,
        fingerprints[columnIndex].vhhResidues,
      );
      return mean([contact, receptor, vhh].flatMap((value) => value == null ? [] : [value]));
    })
  ));

  const contactFrequency = new Map<string, number>();
  for (const pose of fingerprints) {
    for (const contact of pose.contactPairs) {
      contactFrequency.set(contact, (contactFrequency.get(contact) ?? 0) + 1);
    }
  }
  const recurrentMinimum = Math.max(2, Math.ceil(inputs.length / 2));

  const unsorted = inputs.map((pose, poseIndex) => {
    const otherIndexes = inputs
      .map((_, index) => index)
      .filter((index) => index !== poseIndex);
    const contactPairConsensus = mean(otherIndexes.flatMap((otherIndex) => {
      const value = jaccardIndex(
        fingerprints[poseIndex].contactPairs,
        fingerprints[otherIndex].contactPairs,
      );
      return value == null ? [] : [value];
    }));
    const receptorEpitopeConsensus = mean(otherIndexes.flatMap((otherIndex) => {
      const value = jaccardIndex(
        fingerprints[poseIndex].receptorResidues,
        fingerprints[otherIndex].receptorResidues,
      );
      return value == null ? [] : [value];
    }));
    const vhhParatopeConsensus = mean(otherIndexes.flatMap((otherIndex) => {
      const value = jaccardIndex(
        fingerprints[poseIndex].vhhResidues,
        fingerprints[otherIndex].vhhResidues,
      );
      return value == null ? [] : [value];
    }));
    const ensembleConsensus = mean([
      contactPairConsensus,
      receptorEpitopeConsensus,
      vhhParatopeConsensus,
    ].flatMap((value) => value == null ? [] : [value]));
    const recurrentContactShare = fingerprints[poseIndex].contactPairs.size
      ? Array.from(fingerprints[poseIndex].contactPairs)
        .filter((contact) => (contactFrequency.get(contact) ?? 0) >= recurrentMinimum).length /
        fingerprints[poseIndex].contactPairs.size
      : null;
    return {
      id: pose.id,
      filename: pose.filename,
      sha256: normalizedSha256[poseIndex],
      coordinateFingerprint: coordinateFingerprints[poseIndex],
      geometryFingerprint: geometryFingerprints[poseIndex],
      bytes: pose.bytes ?? null,
      isReference: poseIndex === 0,
      rank: 0,
      triageGroup: triageGroup(pose.audit),
      evidenceLevel: pose.audit.evidenceLevel,
      contactPairCount: pose.audit.contactPairCount,
      severeClashCount: pose.audit.severeClashCount,
      deltaSasaAngstrom2: pose.audit.deltaSasaAngstrom2,
      interfacePaeMedianAngstrom: pose.audit.interfacePaeMedianAngstrom,
      contactPairConsensus,
      receptorEpitopeConsensus,
      vhhParatopeConsensus,
      ensembleConsensus,
      recurrentContactShare,
      comparisonCount: otherIndexes.length,
      sourceFormat: pose.structure.sourceFormat,
      coordinateScope: pose.structure.coordinateScope,
      selectedModelId: pose.structure.selectedModelId,
      selectedAssemblyId: pose.structure.selectedAssembly?.id ?? null,
      receptorChain: selectedChainProvenance(pose, pose.audit.receptorChain),
      vhhChain: selectedChainProvenance(pose, pose.audit.vhhChain),
    } satisfies EnsemblePoseSummary;
  });

  const orderedPoses = [...unsorted].sort((a, b) => {
    const consensusDifference = (b.ensembleConsensus ?? -1) - (a.ensembleConsensus ?? -1);
    if (Math.abs(consensusDifference) > 1e-12) return consensusDifference;
    if (a.severeClashCount !== b.severeClashCount) return a.severeClashCount - b.severeClashCount;
    return codeUnitCompare(a.id, b.id);
  });
  const poses: EnsemblePoseSummary[] = [];
  for (let index = 0; index < orderedPoses.length; index += 1) {
    const pose = orderedPoses[index];
    if (index === 0) {
      poses.push({ ...pose, rank: 1 });
      continue;
    }
    const previous = orderedPoses[index - 1];
    const tied = Math.abs(
      (pose.ensembleConsensus ?? -1) - (previous.ensembleConsensus ?? -1),
    ) <= 1e-12 && pose.severeClashCount === previous.severeClashCount;
    poses.push({ ...pose, rank: tied ? poses[index - 1].rank : index + 1 });
  }
  const inputIndexById = new Map(inputs.map((pose, index) => [pose.id, index]));
  const pairwisePoseIds = poses.map((pose) => pose.id);
  const pairwiseConsensus = pairwisePoseIds.map((rowId) => pairwisePoseIds.map((columnId) => (
    inputOrderPairwiseConsensus[inputIndexById.get(rowId)!][inputIndexById.get(columnId)!]
  )));

  return {
    version: inputs[0].audit.version,
    poseCount: inputs.length,
    referencePoseId: inputs[0].id,
    receptorSequenceLength: referenceSequences.receptor.length,
    vhhSequenceLength: referenceSequences.vhh.length,
    poses,
    pairwisePoseIds,
    pairwiseConsensus,
    auditPolicy,
    methods: expectedEnsembleMethods(inputs.length),
    warnings: [
      POSE_ENSEMBLE_CLAIM_BOUNDARY,
      "A consistently reproduced wrong pose can receive high consensus; review geometry, PAE, membrane context, and experimental evidence separately.",
      "Only exact observed receptor and VHH sequence matches are compared; unresolved coordinate differences can prevent ensemble mapping.",
      "Seed independence cannot be verified. Correlated, repeated, or near-identical poses can inflate consensus because every upload contributes equal weight.",
      "Approximate ΔSASA uses a finite sphere grid in a per-pose deterministic frame. Small differences can reflect grid orientation or a canonical-anchor switch and should not be interpreted as energetic changes.",
      "Recurrence-first rank is deterministic and transparent but is not a calibrated probability or learned binding score; the visible triage group is descriptive metadata only.",
    ],
  };
}

function assertJsonExportSafe(value: unknown, label: string): void {
  const active = new WeakSet<object>();
  const visited = new WeakSet<object>();
  const stack: Array<{
    value: unknown;
    path: string;
    depth: number;
    exiting: boolean;
  }> = [{ value, path: label, depth: 0, exiting: false }];
  let visitedNodes = 0;
  while (stack.length) {
    const entry = stack.pop()!;
    const current = entry.value;
    if (entry.exiting) {
      active.delete(current as object);
      visited.add(current as object);
      continue;
    }
    visitedNodes += 1;
    if (visitedNodes > 250_000) {
      throw new Error(`${label} exceeds the bounded export validation size.`);
    }
    if (entry.depth > 128) {
      throw new Error(`${entry.path} exceeds the bounded export nesting depth.`);
    }
    if (current == null || typeof current === "string" || typeof current === "boolean") continue;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new Error(`${entry.path} must contain finite numbers only.`);
      }
      continue;
    }
    if (typeof current !== "object") {
      throw new Error(`${entry.path} contains a value that cannot be exported as JSON.`);
    }
    if (active.has(current)) throw new Error(`${entry.path} contains a cyclic export value.`);
    if (visited.has(current)) continue;
    const prototype = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${entry.path} must contain plain JSON objects only.`);
    }
    active.add(current);
    stack.push({ ...entry, exiting: true });
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        if (!(index in current)) throw new Error(`${entry.path} contains a sparse array.`);
        stack.push({
          value: current[index],
          path: `${entry.path}[${index}]`,
          depth: entry.depth + 1,
          exiting: false,
        });
      }
    } else {
      for (const key of Reflect.ownKeys(current)) {
        if (typeof key !== "string") {
          throw new Error(`${entry.path} contains a symbol-keyed value that cannot be exported.`);
        }
        stack.push({
          value: (current as Record<string, unknown>)[key],
          path: `${entry.path}.${key}`,
          depth: entry.depth + 1,
          exiting: false,
        });
      }
    }
  }
}

function assertExactKeys(
  value: object,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(codeUnitCompare);
  const expected = [...expectedKeys].sort(codeUnitCompare);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} does not match the current export schema.`);
  }
}

function requireNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function validateChainSummary(
  chain: EnsemblePoseSummary["receptorChain"],
  role: "receptor" | "VHH",
  filename: string,
): void {
  if (chain == null || typeof chain !== "object" || Array.isArray(chain)) {
    throw new Error(`${filename}: ${role} chain provenance is missing.`);
  }
  assertExactKeys(chain, [
    "id", "labelAsymId", "authAsymId", "assemblyCopyIndex",
    "assemblyGeneratorRowIndex", "assemblyOperationIds", "assemblyTransform",
  ], `${filename}: ${role} chain provenance`);
  requireNonEmptyString(chain.id, `${filename}: ${role} chain identifier`);
  for (const [field, value] of [
    ["label asym identifier", chain.labelAsymId],
    ["auth asym identifier", chain.authAsymId],
  ] as const) {
    if (value != null && typeof value !== "string") {
      throw new Error(`${filename}: ${role} ${field} must be a string or null.`);
    }
  }
  for (const [field, value] of [
    ["assembly copy index", chain.assemblyCopyIndex],
    ["assembly generator row index", chain.assemblyGeneratorRowIndex],
  ] as const) {
    if (value != null && (!Number.isSafeInteger(value) || value < 1)) {
      throw new Error(`${filename}: ${role} ${field} must be a positive safe integer or null.`);
    }
  }
  if (
    !Array.isArray(chain.assemblyOperationIds) ||
    chain.assemblyOperationIds.some((operationId) => typeof operationId !== "string" || !operationId.trim())
  ) {
    throw new Error(`${filename}: ${role} assembly operation identifiers are invalid.`);
  }
  if (chain.assemblyTransform != null && (
    !Array.isArray(chain.assemblyTransform) || chain.assemblyTransform.length !== 3 ||
    chain.assemblyTransform.some((row) => (
      !Array.isArray(row) || row.length !== 4 || row.some((value) => !Number.isFinite(value))
    ))
  )) {
    throw new Error(`${filename}: ${role} assembly transform must be a finite 3×4 matrix or null.`);
  }
}

function validateCurrentAuditPolicy(policy: CoordinateOnlyAuditPolicy): void {
  if (policy == null || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("Ensemble export requires a complete coordinate-only audit policy.");
  }
  assertExactKeys(policy, [
    "fingerprint", "confidenceMode", "pae", "residueContactCutoffAngstrom",
    "polarProxyCutoffAngstrom", "saltBridgeProxyCutoffAngstrom",
    "severeClashOverlapAngstrom", "sasaProbeRadiusAngstrom", "sasaSpherePoints",
    "sasaMaximumCandidateDistanceChecks", "sasaMaximumOcclusionChecks", "sasaRadii",
    "sasaOrientation", "sasaFrameAlgorithm", "cdrAnnotation", "paeSummary",
  ], "Ensemble audit policy");
  if (policy.confidenceMode !== "none" || policy.pae !== "omitted") {
    throw new Error("Ensemble export requires confidence mode none with PAE omitted.");
  }
  if (policy.sasaOrientation !== "deterministic-proper-signed-frame") {
    throw new Error("Ensemble export requires the deterministic proper signed SASA frame.");
  }
  const methods = stableAuditMethodPayload(policy);
  const withoutFingerprint: Omit<CoordinateOnlyAuditPolicy, "fingerprint"> = {
    confidenceMode: "none",
    pae: "omitted",
    ...methods,
    sasaOrientation: "deterministic-proper-signed-frame",
  };
  const expectedFingerprint = coordinateOnlyPolicyFingerprint(withoutFingerprint);
  if (policy.fingerprint !== expectedFingerprint) {
    throw new Error("Ensemble audit-policy fingerprint does not match the current exact method policy.");
  }
}

function consensusSort(left: EnsemblePoseSummary, right: EnsemblePoseSummary): number {
  const consensusDifference = (right.ensembleConsensus ?? -1) - (left.ensembleConsensus ?? -1);
  if (Math.abs(consensusDifference) > 1e-12) return consensusDifference;
  if (left.severeClashCount !== right.severeClashCount) {
    return left.severeClashCount - right.severeClashCount;
  }
  return codeUnitCompare(left.id, right.id);
}

/**
 * Validate and snapshot the complete, self-contained ensemble export surface.
 * JSON and CSV deliberately share this gate so neither format can serialize a
 * scientifically inconsistent or provenance-incomplete summary.
 */
export function validatePoseEnsembleExportSummary(
  summary: PoseEnsembleSummary,
): PoseEnsembleSummary {
  assertJsonExportSafe(summary, "Ensemble summary");
  const snapshot = structuredClone(summary);
  if (snapshot == null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Ensemble export requires a summary object.");
  }
  assertExactKeys(snapshot, [
    "version", "poseCount", "referencePoseId", "receptorSequenceLength",
    "vhhSequenceLength", "poses", "pairwisePoseIds", "pairwiseConsensus",
    "auditPolicy", "methods", "warnings",
  ], "Ensemble summary");
  if (snapshot.version !== CONFOVHH_VERSION) {
    throw new Error(`Ensemble export requires current ConfoVHH software version ${CONFOVHH_VERSION}.`);
  }
  if (
    !Number.isSafeInteger(snapshot.poseCount) || snapshot.poseCount < 2 ||
    snapshot.poseCount > MAX_ENSEMBLE_POSES || !Array.isArray(snapshot.poses) ||
    snapshot.poses.length !== snapshot.poseCount
  ) {
    throw new Error("Ensemble export poseCount does not reconcile with the bounded pose summary.");
  }
  for (const [label, value] of [
    ["receptor sequence length", snapshot.receptorSequenceLength],
    ["VHH sequence length", snapshot.vhhSequenceLength],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Ensemble export ${label} must be a positive safe integer.`);
    }
  }
  requireNonEmptyString(snapshot.referencePoseId, "Ensemble reference pose identifier");
  validateCurrentAuditPolicy(snapshot.auditPolicy);

  const expectedMethods = expectedEnsembleMethods(snapshot.poseCount);
  if (snapshot.methods == null || typeof snapshot.methods !== "object" || Array.isArray(snapshot.methods)) {
    throw new Error("Ensemble export requires the exact current method descriptions.");
  }
  assertExactKeys(snapshot.methods, Object.keys(expectedMethods), "Ensemble method descriptions");
  for (const key of Object.keys(expectedMethods) as Array<keyof typeof expectedMethods>) {
    if (snapshot.methods[key] !== expectedMethods[key]) {
      throw new Error(`Ensemble export methods.${key} does not match the current exact method description.`);
    }
  }
  if (
    !Array.isArray(snapshot.warnings) ||
    snapshot.warnings.some((warning) => typeof warning !== "string" || !warning.trim()) ||
    !snapshot.warnings.includes(POSE_ENSEMBLE_CLAIM_BOUNDARY)
  ) {
    throw new Error("Ensemble export warnings must include the current claim boundary.");
  }

  const poseIds = new Set<string>();
  let referenceCount = 0;
  const allowedTriage = new Set<EnsembleTriageGroup>(["coherent", "review", "low-priority"]);
  const allowedEvidence = new Set<EvidenceLevel>([
    "supported", "mixed", "limited", "not-assessable",
  ]);
  const expectedPoseKeys = [
    "id", "filename", "sha256", "coordinateFingerprint", "geometryFingerprint", "bytes",
    "isReference", "rank", "triageGroup", "evidenceLevel", "contactPairCount",
    "severeClashCount", "deltaSasaAngstrom2", "interfacePaeMedianAngstrom",
    "contactPairConsensus", "receptorEpitopeConsensus", "vhhParatopeConsensus",
    "ensembleConsensus", "recurrentContactShare", "comparisonCount", "sourceFormat",
    "coordinateScope", "selectedModelId", "selectedAssemblyId", "receptorChain", "vhhChain",
  ] as const;
  for (const pose of snapshot.poses) {
    if (pose == null || typeof pose !== "object" || Array.isArray(pose)) {
      throw new Error("Every ensemble export pose must be an object.");
    }
    assertExactKeys(pose, expectedPoseKeys, "Ensemble pose summary");
    requireNonEmptyString(pose.id, "Ensemble pose identifier");
    requireNonEmptyString(pose.filename, `${pose.id}: source filename`);
    if (poseIds.has(pose.id)) throw new Error("Every ensemble export pose requires a unique identifier.");
    poseIds.add(pose.id);
    const sha256 = normalizeOptionalSha256(pose.sha256, `${pose.filename}: export source digest`);
    if (sha256 == null) {
      throw new Error(`${pose.filename}: ensemble export requires a source SHA-256 digest.`);
    }
    pose.sha256 = sha256;
    if (pose.bytes == null || !Number.isSafeInteger(pose.bytes) || pose.bytes < 0) {
      throw new Error(`${pose.filename}: ensemble export requires a non-negative source byte count.`);
    }
    if (!/^fnv1a64-3dp:[0-9a-f]{16}$/.test(pose.coordinateFingerprint)) {
      throw new Error(`${pose.filename}: ensemble export requires a verified source-coordinate fingerprint.`);
    }
    if (!/^fnv1a64-se3-2dp:[0-9a-f]{16}$/.test(pose.geometryFingerprint)) {
      throw new Error(`${pose.filename}: ensemble export requires a verified SE(3)-canonical geometry fingerprint.`);
    }
    if (typeof pose.isReference !== "boolean") {
      throw new Error(`${pose.filename}: isReference must be boolean.`);
    }
    if (pose.isReference) {
      referenceCount += 1;
      if (pose.id !== snapshot.referencePoseId) {
        throw new Error("The reference pose flag does not match referencePoseId.");
      }
    }
    if (!Number.isSafeInteger(pose.rank) || pose.rank < 1 || pose.rank > snapshot.poseCount) {
      throw new Error(`${pose.filename}: competition rank must be a bounded positive safe integer.`);
    }
    if (!allowedTriage.has(pose.triageGroup) || !allowedEvidence.has(pose.evidenceLevel)) {
      throw new Error(`${pose.filename}: triage or evidence level is invalid.`);
    }
    const expectedTriage = pose.evidenceLevel === "supported"
      ? "coherent"
      : pose.evidenceLevel === "mixed" ? "review" : "low-priority";
    if (pose.triageGroup !== expectedTriage) {
      throw new Error(`${pose.filename}: triage group does not reconcile with its evidence level.`);
    }
    if (
      !Number.isSafeInteger(pose.contactPairCount) || pose.contactPairCount < 0 ||
      !Number.isSafeInteger(pose.severeClashCount) || pose.severeClashCount < 0 ||
      pose.severeClashCount > pose.contactPairCount
    ) {
      throw new Error(`${pose.filename}: contact and severe-clash counts are inconsistent.`);
    }
    if (!Number.isFinite(pose.deltaSasaAngstrom2) || pose.deltaSasaAngstrom2 < 0) {
      throw new Error(`${pose.filename}: protein ΔSASA must be finite and non-negative.`);
    }
    if (pose.interfacePaeMedianAngstrom != null) {
      throw new Error(`${pose.filename}: coordinate-only ensemble export requires interface PAE to be null.`);
    }
    const consensusValues = [
      pose.contactPairConsensus, pose.receptorEpitopeConsensus,
      pose.vhhParatopeConsensus, pose.ensembleConsensus, pose.recurrentContactShare,
    ];
    for (const value of consensusValues) {
      if (value != null && (!Number.isFinite(value) || value < 0 || value > 1)) {
        throw new Error(`${pose.filename}: consensus values must be null or within [0, 1].`);
      }
    }
    const availableComponents = [
      pose.contactPairConsensus, pose.receptorEpitopeConsensus, pose.vhhParatopeConsensus,
    ].filter((value): value is number => value != null);
    const recomputedConsensus = mean(availableComponents);
    if (
      (recomputedConsensus == null) !== (pose.ensembleConsensus == null) ||
      (recomputedConsensus != null && Math.abs(recomputedConsensus - pose.ensembleConsensus!) > 1e-12)
    ) {
      throw new Error(`${pose.filename}: ensemble consensus does not reconcile with its component means.`);
    }
    if ((pose.contactPairCount === 0) !== (pose.recurrentContactShare == null)) {
      throw new Error(`${pose.filename}: recurrent-contact share does not reconcile with contactPairCount.`);
    }
    if (pose.comparisonCount !== snapshot.poseCount - 1) {
      throw new Error(`${pose.filename}: comparisonCount must equal poseCount minus one.`);
    }
    if (pose.sourceFormat !== "pdb" && pose.sourceFormat !== "mmcif") {
      throw new Error(`${pose.filename}: source format is invalid.`);
    }
    if (pose.coordinateScope !== "as-supplied" && pose.coordinateScope !== "deposited-assembly") {
      throw new Error(`${pose.filename}: coordinate scope is invalid.`);
    }
    requireNonEmptyString(pose.selectedModelId, `${pose.filename}: selected model identifier`);
    if (pose.selectedAssemblyId != null && typeof pose.selectedAssemblyId !== "string") {
      throw new Error(`${pose.filename}: selected assembly identifier must be a string or null.`);
    }
    validateChainSummary(pose.receptorChain, "receptor", pose.filename);
    validateChainSummary(pose.vhhChain, "VHH", pose.filename);
    if (pose.receptorChain.id === pose.vhhChain.id) {
      throw new Error(`${pose.filename}: receptor and VHH chain identifiers must be distinct.`);
    }
  }
  if (referenceCount !== 1 || !poseIds.has(snapshot.referencePoseId)) {
    throw new Error("Ensemble export requires exactly one reference pose matching referencePoseId.");
  }

  const expectedOrder = [...snapshot.poses].sort(consensusSort);
  for (let index = 0; index < snapshot.poseCount; index += 1) {
    if (snapshot.poses[index].id !== expectedOrder[index].id) {
      throw new Error("Ensemble export poses are not in deterministic consensus/clash/identifier order.");
    }
    const expectedRank = index === 0
      ? 1
      : (
          Math.abs(
            (expectedOrder[index].ensembleConsensus ?? -1) -
            (expectedOrder[index - 1].ensembleConsensus ?? -1),
          ) <= 1e-12 &&
          expectedOrder[index].severeClashCount === expectedOrder[index - 1].severeClashCount
        ) ? snapshot.poses[index - 1].rank : index + 1;
    if (snapshot.poses[index].rank !== expectedRank) {
      throw new Error("Ensemble export competition ranks do not match consensus and clash ties.");
    }
  }

  if (
    !Array.isArray(snapshot.pairwisePoseIds) ||
    snapshot.pairwisePoseIds.length !== snapshot.poseCount ||
    snapshot.pairwisePoseIds.some((id, index) => id !== snapshot.poses[index].id)
  ) {
    throw new Error("Pairwise pose identifiers must exactly match exported pose order.");
  }
  if (!Array.isArray(snapshot.pairwiseConsensus) || snapshot.pairwiseConsensus.length !== snapshot.poseCount) {
    throw new Error("Pairwise consensus must be a square poseCount matrix.");
  }
  for (let rowIndex = 0; rowIndex < snapshot.poseCount; rowIndex += 1) {
    const row = snapshot.pairwiseConsensus[rowIndex];
    if (!Array.isArray(row) || row.length !== snapshot.poseCount) {
      throw new Error("Pairwise consensus must be a square poseCount matrix.");
    }
    for (let columnIndex = 0; columnIndex < snapshot.poseCount; columnIndex += 1) {
      const value = row[columnIndex];
      if (rowIndex === columnIndex) {
        if (value !== 1) throw new Error("Pairwise consensus diagonal values must equal 1.");
        continue;
      }
      if (value != null && (!Number.isFinite(value) || value < 0 || value > 1)) {
        throw new Error("Pairwise consensus values must be null or within [0, 1].");
      }
      const mirror = snapshot.pairwiseConsensus[columnIndex]?.[rowIndex];
      if (
        (value == null) !== (mirror == null) ||
        (value != null && mirror != null && Math.abs(value - mirror) > 1e-12)
      ) {
        throw new Error("Pairwise consensus matrix must be symmetric.");
      }
    }
  }
  return snapshot;
}

function csvCell(value: string | number | boolean | null): string {
  if (value == null) return "";
  const raw = String(value);
  const withoutControls = typeof value === "string"
    ? raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => {
      if (character === "\n") return "\\n";
      if (character === "\r") return "\\r";
      if (character === "\t") return "\\t";
      if (/\p{Cf}/u.test(character)) return "";
      return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    })
    : raw;
  const formulaProbe = typeof value === "string"
    ? raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    : raw;
  const formulaLike = typeof value === "string" &&
    /^[\p{White_Space}]*[=+\-@]/u.test(formulaProbe);
  const text = formulaLike
    ? `'${withoutControls}`
    : withoutControls;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function poseEnsembleToCsv(summary: PoseEnsembleSummary): string {
  const exportSummary = validatePoseEnsembleExportSummary(summary);
  const rows = [
    [
      "schema_version",
      "software_version",
      "rank",
      "filename",
      "sha256",
      "coordinate_fingerprint",
      "geometry_fingerprint",
      "bytes",
      "source_format",
      "coordinate_scope",
      "selected_model_id",
      "selected_assembly_id",
      "receptor_chain_instance",
      "vhh_chain_instance",
      "receptor_label_asym_id",
      "receptor_auth_asym_id",
      "receptor_assembly_copy_index",
      "receptor_assembly_generator_row_index",
      "receptor_operation_ids",
      "receptor_transform_3x4_json",
      "vhh_label_asym_id",
      "vhh_auth_asym_id",
      "vhh_assembly_copy_index",
      "vhh_assembly_generator_row_index",
      "vhh_operation_ids",
      "vhh_transform_3x4_json",
      "is_reference",
      "triage_group",
      "evidence_level",
      "comparison_count",
      "ranking_method",
      "consensus_method",
      "claim_boundary",
      "confidence_mode",
      "pae_context",
      "ensemble_consensus",
      "contact_pair_consensus",
      "receptor_epitope_consensus",
      "vhh_paratope_consensus",
      "recurrent_contact_share",
      "contact_pairs",
      "severe_clash_pairs",
      "delta_sasa_angstrom2",
      "interface_pae_median_angstrom",
      "audit_policy_fingerprint",
      "sasa_orientation",
      "sasa_frame_algorithm",
      "residue_contact_cutoff_angstrom",
      "polar_proxy_cutoff_angstrom",
      "salt_bridge_proxy_cutoff_angstrom",
      "severe_clash_overlap_angstrom",
      "sasa_probe_radius_angstrom",
      "sasa_sphere_points",
      "sasa_radii",
      "sasa_maximum_candidate_distance_checks",
      "sasa_maximum_occlusion_checks",
      "cdr_annotation",
      "pae_summary_method",
    ],
    ...exportSummary.poses.map((pose) => [
      POSE_ENSEMBLE_EXPORT_SCHEMA_VERSION,
      exportSummary.version,
      pose.rank,
      pose.filename,
      pose.sha256,
      pose.coordinateFingerprint,
      pose.geometryFingerprint,
      pose.bytes,
      pose.sourceFormat,
      pose.coordinateScope,
      pose.selectedModelId,
      pose.selectedAssemblyId,
      pose.receptorChain.id,
      pose.vhhChain.id,
      pose.receptorChain.labelAsymId,
      pose.receptorChain.authAsymId,
      pose.receptorChain.assemblyCopyIndex,
      pose.receptorChain.assemblyGeneratorRowIndex,
      pose.receptorChain.assemblyOperationIds.join(";"),
      pose.receptorChain.assemblyTransform == null
        ? null
        : JSON.stringify(pose.receptorChain.assemblyTransform),
      pose.vhhChain.labelAsymId,
      pose.vhhChain.authAsymId,
      pose.vhhChain.assemblyCopyIndex,
      pose.vhhChain.assemblyGeneratorRowIndex,
      pose.vhhChain.assemblyOperationIds.join(";"),
      pose.vhhChain.assemblyTransform == null
        ? null
        : JSON.stringify(pose.vhhChain.assemblyTransform),
      pose.isReference,
      pose.triageGroup,
      pose.evidenceLevel,
      pose.comparisonCount,
      exportSummary.methods.ranking,
      exportSummary.methods.ensembleConsensus,
      POSE_ENSEMBLE_CLAIM_BOUNDARY,
      exportSummary.auditPolicy.confidenceMode,
      exportSummary.auditPolicy.pae,
      pose.ensembleConsensus,
      pose.contactPairConsensus,
      pose.receptorEpitopeConsensus,
      pose.vhhParatopeConsensus,
      pose.recurrentContactShare,
      pose.contactPairCount,
      pose.severeClashCount,
      pose.deltaSasaAngstrom2,
      pose.interfacePaeMedianAngstrom,
      exportSummary.auditPolicy.fingerprint,
      exportSummary.auditPolicy.sasaOrientation,
      exportSummary.auditPolicy.sasaFrameAlgorithm,
      exportSummary.auditPolicy.residueContactCutoffAngstrom,
      exportSummary.auditPolicy.polarProxyCutoffAngstrom,
      exportSummary.auditPolicy.saltBridgeProxyCutoffAngstrom,
      exportSummary.auditPolicy.severeClashOverlapAngstrom,
      exportSummary.auditPolicy.sasaProbeRadiusAngstrom,
      exportSummary.auditPolicy.sasaSpherePoints,
      exportSummary.auditPolicy.sasaRadii,
      exportSummary.auditPolicy.sasaMaximumCandidateDistanceChecks,
      exportSummary.auditPolicy.sasaMaximumOcclusionChecks,
      exportSummary.auditPolicy.cdrAnnotation,
      exportSummary.auditPolicy.paeSummary,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function createPoseEnsembleExportReport(
  summary: PoseEnsembleSummary,
  comparisonMode: string,
  rejected: Array<{ filename: string; sha256: string; bytes: number; reason: string }>,
  generatedAt = new Date().toISOString(),
): PoseEnsembleExportReport {
  if (typeof comparisonMode !== "string" || !comparisonMode.trim()) {
    throw new Error("comparisonMode must describe the ensemble audit policy.");
  }
  requireIsoTimestamp(generatedAt, "Ensemble export timestamp");
  if (!Array.isArray(rejected) || rejected.length > MAX_ENSEMBLE_POSES) {
    throw new Error(`Rejected-pose provenance must contain at most ${MAX_ENSEMBLE_POSES} records.`);
  }
  const rejectedSnapshot = rejected.map((pose, index) => {
    if (typeof pose.filename !== "string" || !pose.filename.trim()) {
      throw new Error(`Rejected pose ${index + 1} requires a non-empty filename.`);
    }
    const sha256 = normalizeOptionalSha256(
      pose.sha256,
      `Rejected pose ${index + 1} source digest`,
    );
    if (sha256 == null) {
      throw new Error(`Rejected pose ${index + 1} requires its source SHA-256 digest.`);
    }
    if (!Number.isSafeInteger(pose.bytes) || pose.bytes < 0) {
      throw new Error(`Rejected pose ${index + 1} byte count must be a non-negative safe integer.`);
    }
    if (typeof pose.reason !== "string" || !pose.reason.trim()) {
      throw new Error(`Rejected pose ${index + 1} requires a non-empty reason.`);
    }
    return { filename: pose.filename, sha256, bytes: pose.bytes, reason: pose.reason };
  });
  const summarySnapshot = validatePoseEnsembleExportSummary(summary);
  if (summarySnapshot.poseCount + rejectedSnapshot.length > MAX_ENSEMBLE_POSES) {
    throw new Error(
      `Accepted and rejected pose provenance together must contain at most ${MAX_ENSEMBLE_POSES} records.`,
    );
  }
  return {
    schemaVersion: POSE_ENSEMBLE_EXPORT_SCHEMA_VERSION,
    softwareVersion: CONFOVHH_VERSION,
    version: CONFOVHH_VERSION,
    generatedAt,
    comparisonMode,
    referencePoseId: summary.referencePoseId,
    rejected: rejectedSnapshot,
    auditPolicy: { ...summarySnapshot.auditPolicy },
    summary: summarySnapshot,
  };
}
