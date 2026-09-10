import {
  CANONICAL_SASA_FRAME_ALGORITHM,
  CDR_ANNOTATION_METHOD_DESCRIPTION,
  CONFOVHH_VERSION,
  PAE_SUMMARY_METHOD_DESCRIPTION,
  SASA_RADII_METHOD_DESCRIPTION,
  classifyCoordinateProvenance,
  verifyInterfaceAuditAttestation,
  type ContactPair,
  type InterfaceAudit,
  type ParsedStructure,
} from "./confovhh.ts";
import {
  GEOMETRY_DUPLICATE_MAX_DEVIATION_ANGSTROM,
  GEOMETRY_DUPLICATE_RMSD_ANGSTROM,
  geometryFitIsDuplicate,
  jaccardIndex,
  selectedCoordinateFingerprint,
  selectedGeometryFingerprint,
  selectedGeometryFit,
} from "./pose-ensemble.ts";

export const STATE_PAIR_SCHEMA_VERSION = "1.2.0" as const;
export const STATE_PAIR_LABELS = ["neutral", "active", "inactive"] as const;

export type StateContextLabel = (typeof STATE_PAIR_LABELS)[number];

export interface StatePairInput {
  id: string;
  filename: string;
  sha256?: string | null;
  bytes?: number | null;
  structure: ParsedStructure;
  audit: InterfaceAudit;
  /** Runtime validation keeps this compatible with serialized worker payloads. */
  label?: StateContextLabel | string | null;
  coordinateFingerprint?: string;
  geometryFingerprint?: string;
}

export type StatePairPoseInput = StatePairInput;

type ChainTransform = ParsedStructure["chains"][number]["assemblyTransform"] | null;

export interface StatePairChainProvenance {
  id: string;
  labelAsymId: string | null;
  authAsymId: string | null;
  assemblyCopyIndex: number | null;
  assemblyGeneratorRowIndex: number | null;
  assemblyOperationIds: string[];
  assemblyTransform: ChainTransform;
  atomCount: number;
  residueCount: number;
  observedSequence: string;
  observedSequenceLength: number;
  backboneCompleteness: number;
}

export interface StatePairConditionSummary {
  id: string;
  label: StateContextLabel | null;
  labelSource: "user" | null;
  filename: string;
  sha256: string | null;
  bytes: number | null;
  coordinateFingerprint: string;
  geometryFingerprint: string;
  title: string | null;
  experimentalMethod: string | null;
  coordinateProvenance: ReturnType<typeof classifyCoordinateProvenance>;
  sourceFormat: ParsedStructure["sourceFormat"];
  coordinateScope: ParsedStructure["coordinateScope"];
  selectedModelId: string;
  modelCount: number;
  availableModelIds: string[];
  selectedAssemblyId: string | null;
  selectedAssembly: ParsedStructure["selectedAssembly"];
  availableAssemblies: ParsedStructure["availableAssemblies"];
  parserAccounting: {
    ignoredAlternateLocations: number;
    ignoredHydrogens: number;
    duplicateAtomRecords: number;
    malformedAtomRecords: number;
    unsupportedResidueRecords: number;
    zeroOccupancyAtomRecords: number;
    residueNameConflicts: number;
  };
  receptorChain: StatePairChainProvenance;
  vhhChain: StatePairChainProvenance;
  evidenceLevel: InterfaceAudit["evidenceLevel"];
  contactPairCount: number;
  severeClashCount: number;
  deltaSasaAngstrom2: number;
  halfDeltaSasaInterfaceAreaAngstrom2: number;
  audit: InterfaceAudit;
}

export type StatePairCoordinateSummary = StatePairConditionSummary;

export interface StatePairDeltas {
  contactPairCount: number;
  atomContactCount: number;
  receptorInterfaceResidues: number;
  vhhInterfaceResidues: number;
  polarContactProxyCount: number;
  saltBridgeProxyCount: number;
  severeClashCount: number;
  possibleInterchainDisulfideCount: number;
  maximumOverlapAngstrom: number;
  deltaSasaAngstrom2: number;
  receptorBuriedSurfaceAreaAngstrom2: number;
  vhhBuriedSurfaceAreaAngstrom2: number;
  halfDeltaSasaInterfaceAreaAngstrom2: number;
  paratopeProxyShare: number | null;
  cdr3ProxyShare: number | null;
}

export interface StatePairContactComparison {
  key: string;
  receptorResidueOrder: number;
  vhhResidueOrder: number;
  reference: ContactPair | null;
  comparison: ContactPair | null;
  receptorResidue: string;
  vhhResidue: string;
  referenceMinimumDistanceAngstrom: number | null;
  comparisonMinimumDistanceAngstrom: number | null;
  minimumDistanceDeltaAngstrom: number | null;
}

export type StatePairContactSummary = StatePairContactComparison;

export interface StatePairAuditPolicy {
  confidenceMode: "none";
  pae: "omitted";
  residueContactCutoffAngstrom: 4.5;
  polarProxyCutoffAngstrom: 3.5;
  saltBridgeProxyCutoffAngstrom: 4;
  severeClashOverlapAngstrom: 0.6;
  sasaProbeRadiusAngstrom: 1.4;
  sasaSpherePoints: 960;
  sasaMaximumCandidateDistanceChecks: 25_000_000;
  sasaMaximumOcclusionChecks: 250_000_000;
  sasaRadii: string;
  cdrAnnotation: string;
  paeSummary: string;
  sasaOrientation: "deterministic-proper-signed-frame";
  sasaFrameAlgorithm: typeof CANONICAL_SASA_FRAME_ALGORITHM;
  fingerprint: string;
}

export interface StatePairSummary {
  schemaVersion: typeof STATE_PAIR_SCHEMA_VERSION;
  version: string;
  reference: StatePairConditionSummary;
  comparison: StatePairConditionSummary;
  receptorSequenceLength: number;
  vhhSequenceLength: number;
  deltas: StatePairDeltas;
  similarity: {
    contactPairs: number | null;
    receptorEpitope: number | null;
    vhhParatope: number | null;
  };
  contacts: {
    shared: StatePairContactComparison[];
    referenceOnly: StatePairContactComparison[];
    comparisonOnly: StatePairContactComparison[];
  };
  selectedGeometryFit: {
    rmsdAngstrom: number;
    maximumDeviationAngstrom: number;
  };
  auditPolicy: StatePairAuditPolicy;
  methods: {
    residueMapping: string;
    contactDefinition: string;
    comparisonDirection: string;
    jaccard: string;
    labels: string;
    coordinateFrame: string;
    duplicateDetection: string;
    auditPolicyFingerprint: string;
  };
  warnings: string[];
}

export interface StatePairExportReport {
  schemaVersion: typeof STATE_PAIR_SCHEMA_VERSION;
  softwareVersion: string;
  version: string;
  generatedAt: string;
  comparisonMode: string;
  claimBoundary: string;
  auditPolicy: StatePairAuditPolicy;
  summary: StatePairSummary;
}

type ExtendedAuditMethods = InterfaceAudit["methods"] & {
  sasaMaximumCandidateDistanceChecks?: number;
  sasaMaximumOcclusionChecks?: number;
};

const EXPECTED_POLICY = {
  confidenceMode: "none",
  pae: "omitted",
  residueContactCutoffAngstrom: 4.5,
  polarProxyCutoffAngstrom: 3.5,
  saltBridgeProxyCutoffAngstrom: 4,
  severeClashOverlapAngstrom: 0.6,
  sasaProbeRadiusAngstrom: 1.4,
  sasaSpherePoints: 960,
  sasaMaximumCandidateDistanceChecks: 25_000_000,
  sasaMaximumOcclusionChecks: 250_000_000,
  sasaOrientation: "deterministic-proper-signed-frame",
  sasaFrameAlgorithm: CANONICAL_SASA_FRAME_ALGORITHM,
} as const;

const SASA_ORIENTATION =
  "SASA only is evaluated on a deterministic proper-rotation/translation canonical clone; contacts, distances, clashes, PAE, and coordinate provenance remain in each source frame.";

export const STATE_PAIR_CLAIM_BOUNDARY =
  "Descriptive coordinate-context differences only; no claim of binding, affinity, function, GPCR state, or conformational selectivity.";

const STATE_PAIR_METHODS = {
  residueMapping:
    "Exact observed receptor and VHH sequences; contact identities use one-based observed residue order within each selected chain.",
  contactDefinition:
    "A residue pair is present when the coordinate-only re-audit finds at least one interchain protein-heavy-atom distance at or below 4.5 Å.",
  comparisonDirection:
    "Every signed delta is comparison minus reference; positive and negative values are descriptive changes, not favorable/unfavorable scores.",
  jaccard:
    "Contact-pair, receptor-epitope, and VHH-paratope overlaps are Jaccard intersection-over-union values; two empty sets are reported as null, not perfect agreement.",
  labels:
    "Condition labels are optional user-supplied context. They do not alter calculations and do not establish active-state, inactive-state, binding, or selectivity claims.",
  coordinateFrame: SASA_ORIENTATION,
  duplicateDetection:
    "The selected receptor–VHH heavy-atom correspondence is fit with a proper rotation plus translation; RMSD ≤ 0.02 Å and maximum deviation ≤ 0.05 Å is rejected as duplicate geometry. Reflections are not treated as duplicates.",
} as const;

const STATE_PAIR_WARNINGS = [
  "This is a paired coordinate-context comparison, not a classifier of GPCR conformational state.",
  "Differences in contact footprint, burial, or clashes do not establish binding, affinity, specificity, signaling, or conformational selectivity.",
  "Only exact observed coordinate sequences are compared; unresolved residues can prevent a match even when canonical sequences are related.",
  "A contact exactly at a hard cutoff is numerically boundary-sensitive; inspect source coordinates before interpreting a one-contact change.",
  "Approximate ΔSASA uses a finite sphere grid in an independently canonicalized frame for each condition. Small deltas can reflect grid orientation or a canonical-anchor switch and are not energetic changes.",
  "PAE and pLDDT are deliberately omitted so both conditions are re-audited under the same coordinate-only policy.",
  "User labels are provenance only and are never inferred from coordinates.",
] as const;

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function assertFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite nonnegative number.`);
  }
}

function assertFiniteNullable(value: number | null, label: string): void {
  if (value != null && !Number.isFinite(value)) {
    throw new Error(`${label} must be finite when present.`);
  }
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

function normalizeLabel(value: string | null | undefined, condition: string): StateContextLabel | null {
  if (value == null) return null;
  if (!(STATE_PAIR_LABELS as readonly string[]).includes(value)) {
    throw new Error(
      `${condition} label must be neutral, active, inactive, or omitted; labels are user-supplied context only.`,
    );
  }
  return value as StateContextLabel;
}

function selectedChains(input: StatePairInput) {
  if (input.audit.receptorChain === input.audit.vhhChain) {
    throw new Error(`${input.filename}: receptor and VHH must be different selected chains.`);
  }
  const receptor = input.structure.chains.find((chain) => chain.id === input.audit.receptorChain);
  const vhh = input.structure.chains.find((chain) => chain.id === input.audit.vhhChain);
  if (!receptor || !vhh) {
    throw new Error(`${input.filename}: the audited receptor or VHH chain is missing from the parsed structure.`);
  }
  if (!receptor.sequence || !vhh.sequence) {
    throw new Error(`${input.filename}: selected chains require non-empty observed coordinate sequences.`);
  }
  return { receptor, vhh };
}

/**
 * Matches by exact observed coordinate sequence, never by chain ID, role hint,
 * filename, state label, or interface score. The scan stops at a second match
 * so ambiguous files cannot trigger a Cartesian result allocation.
 */
export function matchStatePairChains(
  structure: ParsedStructure,
  receptorSequence: string,
  vhhSequence: string,
): { receptorChain: string; vhhChain: string } {
  let match: { receptorChain: string; vhhChain: string } | null = null;
  for (const receptor of structure.chains) {
    if (receptor.sequence !== receptorSequence) continue;
    for (const vhh of structure.chains) {
      if (vhh.id === receptor.id || vhh.sequence !== vhhSequence) continue;
      if (match) {
        throw new Error(
          "The comparison contains multiple indistinguishable exact-sequence receptor–VHH pairs. Reduce it to one pair before state-context comparison.",
        );
      }
      match = { receptorChain: receptor.id, vhhChain: vhh.id };
    }
  }
  if (!match) {
    throw new Error(
      "The comparison does not contain exact observed receptor and VHH sequences matching the reference selection.",
    );
  }
  return match;
}

function contactKey(contact: Pick<ContactPair, "receptorResidueOrder" | "vhhResidueOrder">): string {
  return `${contact.receptorResidueOrder}\u0000${contact.vhhResidueOrder}`;
}

function contactMap(
  input: Pick<StatePairInput, "filename" | "audit">,
  receptorLength: number,
  vhhLength: number,
): Map<string, ContactPair> {
  const result = new Map<string, ContactPair>();
  for (const contact of input.audit.contacts) {
    if (!Number.isInteger(contact.receptorResidueOrder) || contact.receptorResidueOrder < 1 ||
        contact.receptorResidueOrder > receptorLength) {
      throw new Error(`${input.filename}: an audited receptor contact has an invalid observed-sequence order.`);
    }
    if (!Number.isInteger(contact.vhhResidueOrder) || contact.vhhResidueOrder < 1 ||
        contact.vhhResidueOrder > vhhLength) {
      throw new Error(`${input.filename}: an audited VHH contact has an invalid observed-sequence order.`);
    }
    if (!Number.isFinite(contact.minimumDistance) || contact.minimumDistance < 0 ||
        contact.minimumDistance > EXPECTED_POLICY.residueContactCutoffAngstrom) {
      throw new Error(
        `${input.filename}: an audited contact minimum distance must be finite, nonnegative, ` +
        `and at or below ${EXPECTED_POLICY.residueContactCutoffAngstrom} Å.`,
      );
    }
    if (contact.receptorConfidence != null || contact.vhhConfidence != null) {
      throw new Error(`${input.filename}: per-contact confidence must be omitted from the coordinate-only re-audit.`);
    }
    const key = contactKey(contact);
    if (result.has(key)) {
      throw new Error(`${input.filename}: the coordinate audit contains a duplicate residue-contact pair.`);
    }
    result.set(key, contact);
  }
  if (result.size !== input.audit.contactPairCount) {
    throw new Error(`${input.filename}: contactPairCount does not match the coordinate audit contact records.`);
  }
  if (setFromContacts(result.values(), "receptor").size !== input.audit.receptorInterfaceResidues) {
    throw new Error(`${input.filename}: receptorInterfaceResidues does not match the coordinate audit contacts.`);
  }
  if (setFromContacts(result.values(), "vhh").size !== input.audit.vhhInterfaceResidues) {
    throw new Error(`${input.filename}: vhhInterfaceResidues does not match the coordinate audit contacts.`);
  }
  return result;
}

function setFromContacts(contacts: Iterable<ContactPair>, role: "receptor" | "vhh"): Set<string> {
  const result = new Set<string>();
  for (const contact of contacts) {
    result.add(String(role === "receptor" ? contact.receptorResidueOrder : contact.vhhResidueOrder));
  }
  return result;
}

function auditPolicyFingerprint(audit: InterfaceAudit): string {
  const methods = audit.methods as ExtendedAuditMethods;
  return [
    `confovhh=${audit.version}`,
    `confidence=${audit.confidenceMode}`,
    "pae=omitted",
    `contact=${methods.residueContactCutoffAngstrom}`,
    `polar=${methods.polarProxyCutoffAngstrom}`,
    `salt=${methods.saltBridgeProxyCutoffAngstrom}`,
    `overlap=${methods.severeClashOverlapAngstrom}`,
    `probe=${methods.sasaProbeRadiusAngstrom}`,
    `sphere=${methods.sasaSpherePoints}`,
    `candidate_checks=${methods.sasaMaximumCandidateDistanceChecks}`,
    `occlusion_checks=${methods.sasaMaximumOcclusionChecks}`,
    `radii=${methods.sasaRadii}`,
    `sasa_orientation=${methods.sasaOrientation}`,
    `sasa_algorithm=${methods.sasaFrameAlgorithm}`,
    `cdr=${methods.cdrAnnotation}`,
    `pae_summary=${methods.paeSummary}`,
    "sasa_frame=canonical-clone-only",
  ].join("|");
}

function assertCoordinateOnlyAudit(input: Pick<StatePairInput, "filename" | "audit">): void {
  const audit = input.audit;
  const methods = audit.methods as ExtendedAuditMethods;
  if (!audit.version) throw new Error(`${input.filename}: the coordinate audit is missing its software version.`);
  if (audit.confidenceMode !== "none") {
    throw new Error(`${input.filename}: state-context comparison requires a fresh coordinate-only audit with pLDDT disabled.`);
  }
  if (
    audit.paeFilename != null || audit.paeOrderConfirmed ||
    audit.interfacePaeMedianAngstrom != null || audit.interfacePaeP90Angstrom != null ||
    audit.receptorFrameToVhhPaeMedianAngstrom != null || audit.vhhFrameToReceptorPaeMedianAngstrom != null ||
    audit.receptorFrameToVhhPaeP90Angstrom != null || audit.vhhFrameToReceptorPaeP90Angstrom != null ||
    audit.lowPaeContactShare != null
  ) {
    throw new Error(`${input.filename}: PAE must be omitted from the coordinate-only state-context re-audit.`);
  }
  if (audit.interfaceConfidence != null || audit.interfaceConfidenceCoverage != null) {
    throw new Error(`${input.filename}: reported coordinate confidence must be omitted from the state-context re-audit.`);
  }

  const expectations: Array<[string, number | undefined, number]> = [
    ["residue-contact cutoff", methods.residueContactCutoffAngstrom, EXPECTED_POLICY.residueContactCutoffAngstrom],
    ["polar-proxy cutoff", methods.polarProxyCutoffAngstrom, EXPECTED_POLICY.polarProxyCutoffAngstrom],
    ["salt-bridge-proxy cutoff", methods.saltBridgeProxyCutoffAngstrom, EXPECTED_POLICY.saltBridgeProxyCutoffAngstrom],
    ["severe-clash overlap", methods.severeClashOverlapAngstrom, EXPECTED_POLICY.severeClashOverlapAngstrom],
    ["SASA probe radius", methods.sasaProbeRadiusAngstrom, EXPECTED_POLICY.sasaProbeRadiusAngstrom],
    ["SASA sphere-point count", methods.sasaSpherePoints, EXPECTED_POLICY.sasaSpherePoints],
    ["SASA candidate-distance budget", methods.sasaMaximumCandidateDistanceChecks, EXPECTED_POLICY.sasaMaximumCandidateDistanceChecks],
    ["SASA occlusion-check budget", methods.sasaMaximumOcclusionChecks, EXPECTED_POLICY.sasaMaximumOcclusionChecks],
  ];
  for (const [label, actual, expected] of expectations) {
    if (actual !== expected) {
      throw new Error(`${input.filename}: ${label} does not match the fixed coordinate-only re-audit policy.`);
    }
  }
  for (const [label, value] of [
    ["SASA radii", methods.sasaRadii],
    ["CDR annotation", methods.cdrAnnotation],
    ["PAE summary", methods.paeSummary],
  ] as const) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${input.filename}: the coordinate-only audit is missing its ${label} provenance.`);
    }
  }
  for (const [label, actual, expected] of [
    ["SASA radii", methods.sasaRadii, SASA_RADII_METHOD_DESCRIPTION],
    ["CDR annotation", methods.cdrAnnotation, CDR_ANNOTATION_METHOD_DESCRIPTION],
    ["PAE summary", methods.paeSummary, PAE_SUMMARY_METHOD_DESCRIPTION],
  ] as const) {
    if (actual !== expected) {
      throw new Error(`${input.filename}: ${label} does not match the current fixed coordinate-only re-audit policy.`);
    }
  }
  if (
    methods.sasaOrientation !== EXPECTED_POLICY.sasaOrientation ||
    methods.sasaFrameAlgorithm !== EXPECTED_POLICY.sasaFrameAlgorithm
  ) {
    throw new Error(
      `${input.filename}: SASA frame provenance does not match the verified canonical re-audit policy.`,
    );
  }

  const countFields: Array<[string, number]> = [
    ["contactPairCount", audit.contactPairCount],
    ["atomContactCount", audit.atomContactCount],
    ["receptorInterfaceResidues", audit.receptorInterfaceResidues],
    ["vhhInterfaceResidues", audit.vhhInterfaceResidues],
    ["polarContactProxyCount", audit.polarContactProxyCount],
    ["saltBridgeProxyCount", audit.saltBridgeProxyCount],
    ["severeClashCount", audit.severeClashCount],
    ["possibleInterchainDisulfideCount", audit.possibleInterchainDisulfideCount],
  ];
  for (const [field, value] of countFields) {
    assertFiniteNonnegative(value, `${input.filename}: ${field}`);
    if (!Number.isInteger(value)) throw new Error(`${input.filename}: ${field} must be an integer.`);
  }
  const areaFields: Array<[string, number]> = [
    ["maximumOverlapAngstrom", audit.maximumOverlapAngstrom],
    ["deltaSasaAngstrom2", audit.deltaSasaAngstrom2],
    ["receptorBuriedSurfaceAreaAngstrom2", audit.receptorBuriedSurfaceAreaAngstrom2],
    ["vhhBuriedSurfaceAreaAngstrom2", audit.vhhBuriedSurfaceAreaAngstrom2],
    ["halfDeltaSasaInterfaceAreaAngstrom2", audit.halfDeltaSasaInterfaceAreaAngstrom2],
  ];
  for (const [field, value] of areaFields) assertFiniteNonnegative(value, `${input.filename}: ${field}`);
  assertFiniteNullable(audit.paratopeProxyShare, `${input.filename}: paratopeProxyShare`);
  assertFiniteNullable(audit.cdr3ProxyShare, `${input.filename}: cdr3ProxyShare`);
  for (const [field, value] of [
    ["paratopeProxyShare", audit.paratopeProxyShare],
    ["cdr3ProxyShare", audit.cdr3ProxyShare],
  ] as const) {
    if (value != null && (value < 0 || value > 1)) {
      throw new Error(`${input.filename}: ${field} must fall within 0–1 when present.`);
    }
  }
  if (
    Math.abs(
      audit.deltaSasaAngstrom2 -
      audit.receptorBuriedSurfaceAreaAngstrom2 -
      audit.vhhBuriedSurfaceAreaAngstrom2,
    ) > Math.max(1e-6, audit.deltaSasaAngstrom2 * 1e-12)
  ) {
    throw new Error(`${input.filename}: receptor and VHH buried areas do not sum to the reported ΔSASA.`);
  }
  if (
    Math.abs(audit.halfDeltaSasaInterfaceAreaAngstrom2 - audit.deltaSasaAngstrom2 / 2) >
      Math.max(1e-6, audit.deltaSasaAngstrom2 * 1e-12)
  ) {
    throw new Error(`${input.filename}: the reported 1/2 ΔSASA is inconsistent with the coordinate audit.`);
  }
}

function createAuditPolicy(referenceAudit: InterfaceAudit, comparisonAudit: InterfaceAudit): StatePairAuditPolicy {
  const referenceFingerprint = auditPolicyFingerprint(referenceAudit);
  const comparisonFingerprint = auditPolicyFingerprint(comparisonAudit);
  if (referenceFingerprint !== comparisonFingerprint) {
    throw new Error("Reference and comparison were not re-audited under the same coordinate-only policy.");
  }
  const methods = referenceAudit.methods as ExtendedAuditMethods;
  return {
    ...EXPECTED_POLICY,
    sasaRadii: methods.sasaRadii,
    cdrAnnotation: methods.cdrAnnotation,
    paeSummary: methods.paeSummary,
    fingerprint: referenceFingerprint,
  };
}

function chainProvenance(input: StatePairInput, chainId: string): StatePairChainProvenance {
  const chain = input.structure.chains.find((candidate) => candidate.id === chainId);
  if (!chain) throw new Error(`${input.filename}: selected chain ${chainId} is missing.`);
  return {
    id: chain.id,
    labelAsymId: chain.labelAsymId ?? null,
    authAsymId: chain.authAsymId ?? null,
    assemblyCopyIndex: chain.assemblyCopyIndex ?? null,
    assemblyGeneratorRowIndex: chain.assemblyGeneratorRowIndex ?? null,
    assemblyOperationIds: [...(chain.assemblyOperationIds ?? [])],
    assemblyTransform: chain.assemblyTransform == null
      ? null
      : chain.assemblyTransform.map((row) => [...row]) as NonNullable<ChainTransform>,
    atomCount: chain.atomCount,
    residueCount: chain.residueCount,
    observedSequence: chain.sequence,
    observedSequenceLength: chain.sequence.length,
    backboneCompleteness: chain.backboneCompleteness,
  };
}

function cloneSelectedAssembly(
  assembly: ParsedStructure["selectedAssembly"],
): ParsedStructure["selectedAssembly"] {
  if (assembly == null) return null;
  return {
    ...assembly,
    skippedNonProteinLabelAsymIds: [...assembly.skippedNonProteinLabelAsymIds],
    generators: assembly.generators.map((generator) => ({
      ...generator,
      labelAsymIds: [...generator.labelAsymIds],
      expandedOperationTuples: generator.expandedOperationTuples.map((tuple) => [...tuple]),
    })),
  };
}

function cloneAvailableAssemblies(
  assemblies: ParsedStructure["availableAssemblies"],
): ParsedStructure["availableAssemblies"] {
  return assemblies.map((assembly) => ({
    ...assembly,
    generators: assembly.generators.map((generator) => ({
      ...generator,
      labelAsymIds: [...generator.labelAsymIds],
    })),
  }));
}

function cloneAudit(audit: InterfaceAudit): InterfaceAudit {
  return {
    ...audit,
    vhhNumbering: {
      ...audit.vhhNumbering,
      cdrLengths: audit.vhhNumbering.cdrLengths == null
        ? null
        : { ...audit.vhhNumbering.cdrLengths },
    },
    contacts: audit.contacts.map((contact) => ({
      ...contact,
      contactTypes: [...contact.contactTypes],
    })),
    receptorInterfaceKeys: [...audit.receptorInterfaceKeys],
    vhhInterfaceKeys: [...audit.vhhInterfaceKeys],
    findings: audit.findings.map((finding) => ({ ...finding })),
    warnings: [...audit.warnings],
    methods: { ...audit.methods },
  };
}

function conditionSummary(
  input: StatePairInput,
  label: StateContextLabel | null,
  sha256: string | null,
  coordinateFingerprint: string,
  geometryFingerprint: string,
): StatePairConditionSummary {
  return {
    id: input.id,
    label,
    labelSource: label == null ? null : "user",
    filename: input.filename,
    sha256,
    bytes: input.bytes ?? null,
    coordinateFingerprint,
    geometryFingerprint,
    title: input.structure.title,
    experimentalMethod: input.structure.experimentalMethod,
    coordinateProvenance: classifyCoordinateProvenance(input.structure.experimentalMethod),
    sourceFormat: input.structure.sourceFormat,
    coordinateScope: input.structure.coordinateScope,
    selectedModelId: input.structure.selectedModelId,
    modelCount: input.structure.modelCount,
    availableModelIds: [...input.structure.availableModelIds],
    selectedAssemblyId: input.structure.selectedAssembly?.id ?? null,
    selectedAssembly: cloneSelectedAssembly(input.structure.selectedAssembly),
    availableAssemblies: cloneAvailableAssemblies(input.structure.availableAssemblies),
    parserAccounting: {
      ignoredAlternateLocations: input.structure.ignoredAlternateLocations,
      ignoredHydrogens: input.structure.ignoredHydrogens,
      duplicateAtomRecords: input.structure.duplicateAtomRecords,
      malformedAtomRecords: input.structure.malformedAtomRecords,
      unsupportedResidueRecords: input.structure.unsupportedResidueRecords,
      zeroOccupancyAtomRecords: input.structure.zeroOccupancyAtomRecords,
      residueNameConflicts: input.structure.residueNameConflicts,
    },
    receptorChain: chainProvenance(input, input.audit.receptorChain),
    vhhChain: chainProvenance(input, input.audit.vhhChain),
    evidenceLevel: input.audit.evidenceLevel,
    contactPairCount: input.audit.contactPairCount,
    severeClashCount: input.audit.severeClashCount,
    deltaSasaAngstrom2: input.audit.deltaSasaAngstrom2,
    halfDeltaSasaInterfaceAreaAngstrom2: input.audit.halfDeltaSasaInterfaceAreaAngstrom2,
    audit: cloneAudit(input.audit),
  };
}

function nullableDelta(comparison: number | null, reference: number | null): number | null {
  return comparison == null || reference == null ? null : comparison - reference;
}

function compareContacts(
  referenceContacts: Map<string, ContactPair>,
  comparisonContacts: Map<string, ContactPair>,
): StatePairSummary["contacts"] {
  const shared: StatePairContactComparison[] = [];
  const referenceOnly: StatePairContactComparison[] = [];
  const comparisonOnly: StatePairContactComparison[] = [];
  const keys = new Set([...referenceContacts.keys(), ...comparisonContacts.keys()]);
  const sortedKeys = [...keys].sort((left, right) => {
    const [leftReceptor, leftVhh] = left.split("\u0000").map(Number);
    const [rightReceptor, rightVhh] = right.split("\u0000").map(Number);
    return leftReceptor - rightReceptor || leftVhh - rightVhh;
  });
  for (const key of sortedKeys) {
    const referenceSource = referenceContacts.get(key) ?? null;
    const comparisonSource = comparisonContacts.get(key) ?? null;
    const reference = referenceSource == null
      ? null
      : { ...referenceSource, contactTypes: [...referenceSource.contactTypes] };
    const comparison = comparisonSource == null
      ? null
      : { ...comparisonSource, contactTypes: [...comparisonSource.contactTypes] };
    const source = reference ?? comparison!;
    const record: StatePairContactComparison = {
      key: `${source.receptorResidueOrder}:${source.vhhResidueOrder}`,
      receptorResidueOrder: source.receptorResidueOrder,
      vhhResidueOrder: source.vhhResidueOrder,
      reference,
      comparison,
      receptorResidue: (reference ?? comparison!).receptorResidue,
      vhhResidue: (reference ?? comparison!).vhhResidue,
      referenceMinimumDistanceAngstrom: reference?.minimumDistance ?? null,
      comparisonMinimumDistanceAngstrom: comparison?.minimumDistance ?? null,
      minimumDistanceDeltaAngstrom: reference && comparison
        ? comparison.minimumDistance - reference.minimumDistance
        : null,
    };
    if (reference && comparison) shared.push(record);
    else if (reference) referenceOnly.push(record);
    else comparisonOnly.push(record);
  }
  return { shared, referenceOnly, comparisonOnly };
}

export function summarizeStatePair(
  referenceInput: StatePairInput,
  comparisonInput: StatePairInput,
): StatePairSummary {
  if (
    typeof referenceInput.id !== "string" || !referenceInput.id.trim() ||
    typeof comparisonInput.id !== "string" || !comparisonInput.id.trim() ||
    referenceInput.id === comparisonInput.id
  ) {
    throw new Error("Reference and comparison require distinct, non-empty identifiers.");
  }
  for (const input of [referenceInput, comparisonInput]) {
    if (typeof input.filename !== "string" || !input.filename.trim()) {
      throw new Error("Each state-context coordinate requires a non-empty filename.");
    }
    if (input.bytes != null && (!Number.isSafeInteger(input.bytes) || input.bytes < 0)) {
      throw new Error(`${input.filename}: byte count must be a nonnegative safe integer when present.`);
    }
  }
  const referenceLabel = normalizeLabel(referenceInput.label, "Reference");
  const comparisonLabel = normalizeLabel(comparisonInput.label, "Comparison");
  const referenceSha256 = normalizeOptionalSha256(
    referenceInput.sha256,
    `${referenceInput.filename}: source digest`,
  );
  const comparisonSha256 = normalizeOptionalSha256(
    comparisonInput.sha256,
    `${comparisonInput.filename}: source digest`,
  );
  const referenceChains = selectedChains(referenceInput);
  const comparisonChains = selectedChains(comparisonInput);
  assertCoordinateOnlyAudit(referenceInput);
  assertCoordinateOnlyAudit(comparisonInput);
  if (referenceInput.audit.version !== comparisonInput.audit.version) {
    throw new Error("Reference and comparison audits must use the same ConfoVHH software version.");
  }
  if (referenceInput.audit.version !== CONFOVHH_VERSION) {
    throw new Error(
      `State-context audits must use current ConfoVHH software version ${CONFOVHH_VERSION}.`,
    );
  }

  const match = matchStatePairChains(
    comparisonInput.structure,
    referenceChains.receptor.sequence,
    referenceChains.vhh.sequence,
  );
  if (
    match.receptorChain !== comparisonInput.audit.receptorChain ||
    match.vhhChain !== comparisonInput.audit.vhhChain
  ) {
    throw new Error(
      `${comparisonInput.filename}: the audited chain assignment is not the unique exact-sequence match to the reference selection.`,
    );
  }
  if (
    comparisonChains.receptor.sequence !== referenceChains.receptor.sequence ||
    comparisonChains.vhh.sequence !== referenceChains.vhh.sequence
  ) {
    throw new Error("Reference and comparison require exact observed receptor and VHH sequence identity.");
  }

  const referenceContacts = contactMap(
    referenceInput,
    referenceChains.receptor.sequence.length,
    referenceChains.vhh.sequence.length,
  );
  const comparisonContacts = contactMap(
    comparisonInput,
    comparisonChains.receptor.sequence.length,
    comparisonChains.vhh.sequence.length,
  );
  for (const input of [referenceInput, comparisonInput]) {
    verifyInterfaceAuditAttestation(
      input.structure,
      input.audit.receptorChain,
      input.audit.vhhChain,
      input.audit,
      null,
      false,
    );
  }
  const referenceReceptorResidues = setFromContacts(referenceContacts.values(), "receptor");
  const comparisonReceptorResidues = setFromContacts(comparisonContacts.values(), "receptor");
  const referenceVhhResidues = setFromContacts(referenceContacts.values(), "vhh");
  const comparisonVhhResidues = setFromContacts(comparisonContacts.values(), "vhh");

  const computedReferenceCoordinateFingerprint = selectedCoordinateFingerprint(
    referenceInput.structure,
    referenceInput.audit.receptorChain,
    referenceInput.audit.vhhChain,
  );
  const computedComparisonCoordinateFingerprint = selectedCoordinateFingerprint(
    comparisonInput.structure,
    comparisonInput.audit.receptorChain,
    comparisonInput.audit.vhhChain,
  );
  const computedReferenceGeometryFingerprint = selectedGeometryFingerprint(
    referenceInput.structure,
    referenceInput.audit.receptorChain,
    referenceInput.audit.vhhChain,
  );
  const computedComparisonGeometryFingerprint = selectedGeometryFingerprint(
    comparisonInput.structure,
    comparisonInput.audit.receptorChain,
    comparisonInput.audit.vhhChain,
  );
  for (const [input, kind, supplied, computed] of [
    [referenceInput, "coordinate", referenceInput.coordinateFingerprint, computedReferenceCoordinateFingerprint],
    [comparisonInput, "coordinate", comparisonInput.coordinateFingerprint, computedComparisonCoordinateFingerprint],
    [referenceInput, "geometry", referenceInput.geometryFingerprint, computedReferenceGeometryFingerprint],
    [comparisonInput, "geometry", comparisonInput.geometryFingerprint, computedComparisonGeometryFingerprint],
  ] as const) {
    if (supplied != null && supplied !== computed) {
      throw new Error(`${input.filename}: the supplied ${kind} fingerprint does not match the selected coordinates.`);
    }
  }
  const referenceCoordinateFingerprint = computedReferenceCoordinateFingerprint;
  const comparisonCoordinateFingerprint = computedComparisonCoordinateFingerprint;
  const referenceGeometryFingerprint = computedReferenceGeometryFingerprint;
  const comparisonGeometryFingerprint = computedComparisonGeometryFingerprint;
  const fit = selectedGeometryFit(
    referenceInput.structure,
    referenceInput.audit.receptorChain,
    referenceInput.audit.vhhChain,
    comparisonInput.structure,
    comparisonInput.audit.receptorChain,
    comparisonInput.audit.vhhChain,
  );
  if (!fit) {
    throw new Error(
      "Selected receptor–VHH heavy atoms cannot be paired exactly by role, observed residue order, atom name, and element for geometry comparison.",
    );
  }
  if (geometryFitIsDuplicate(fit)) {
    throw new Error(
      "Reference and comparison are duplicate selected receptor–VHH geometries after a proper-rotation/translation fit. Choose genuinely different coordinates.",
    );
  }

  const auditPolicy = createAuditPolicy(referenceInput.audit, comparisonInput.audit);
  const reference = conditionSummary(
    referenceInput,
    referenceLabel,
    referenceSha256,
    referenceCoordinateFingerprint,
    referenceGeometryFingerprint,
  );
  const comparison = conditionSummary(
    comparisonInput,
    comparisonLabel,
    comparisonSha256,
    comparisonCoordinateFingerprint,
    comparisonGeometryFingerprint,
  );
  const contacts = compareContacts(referenceContacts, comparisonContacts);

  return {
    schemaVersion: STATE_PAIR_SCHEMA_VERSION,
    version: referenceInput.audit.version,
    reference,
    comparison,
    receptorSequenceLength: referenceChains.receptor.sequence.length,
    vhhSequenceLength: referenceChains.vhh.sequence.length,
    deltas: {
      contactPairCount: comparison.audit.contactPairCount - reference.audit.contactPairCount,
      atomContactCount: comparison.audit.atomContactCount - reference.audit.atomContactCount,
      receptorInterfaceResidues: comparison.audit.receptorInterfaceResidues - reference.audit.receptorInterfaceResidues,
      vhhInterfaceResidues: comparison.audit.vhhInterfaceResidues - reference.audit.vhhInterfaceResidues,
      polarContactProxyCount: comparison.audit.polarContactProxyCount - reference.audit.polarContactProxyCount,
      saltBridgeProxyCount: comparison.audit.saltBridgeProxyCount - reference.audit.saltBridgeProxyCount,
      severeClashCount: comparison.audit.severeClashCount - reference.audit.severeClashCount,
      possibleInterchainDisulfideCount:
        comparison.audit.possibleInterchainDisulfideCount - reference.audit.possibleInterchainDisulfideCount,
      maximumOverlapAngstrom: comparison.audit.maximumOverlapAngstrom - reference.audit.maximumOverlapAngstrom,
      deltaSasaAngstrom2: comparison.audit.deltaSasaAngstrom2 - reference.audit.deltaSasaAngstrom2,
      receptorBuriedSurfaceAreaAngstrom2:
        comparison.audit.receptorBuriedSurfaceAreaAngstrom2 - reference.audit.receptorBuriedSurfaceAreaAngstrom2,
      vhhBuriedSurfaceAreaAngstrom2:
        comparison.audit.vhhBuriedSurfaceAreaAngstrom2 - reference.audit.vhhBuriedSurfaceAreaAngstrom2,
      halfDeltaSasaInterfaceAreaAngstrom2:
        comparison.audit.halfDeltaSasaInterfaceAreaAngstrom2 - reference.audit.halfDeltaSasaInterfaceAreaAngstrom2,
      paratopeProxyShare: nullableDelta(comparison.audit.paratopeProxyShare, reference.audit.paratopeProxyShare),
      cdr3ProxyShare: nullableDelta(comparison.audit.cdr3ProxyShare, reference.audit.cdr3ProxyShare),
    },
    similarity: {
      contactPairs: jaccardIndex(new Set(referenceContacts.keys()), new Set(comparisonContacts.keys())),
      receptorEpitope: jaccardIndex(referenceReceptorResidues, comparisonReceptorResidues),
      vhhParatope: jaccardIndex(referenceVhhResidues, comparisonVhhResidues),
    },
    contacts,
    selectedGeometryFit: {
      rmsdAngstrom: fit.rmsdAngstrom,
      maximumDeviationAngstrom: fit.maximumDeviationAngstrom,
    },
    auditPolicy,
    methods: {
      ...STATE_PAIR_METHODS,
      auditPolicyFingerprint: auditPolicy.fingerprint,
    },
    warnings: [...STATE_PAIR_WARNINGS],
  };
}

function assertFiniteNumbersRecursively(
  value: unknown,
  path = "state-pair summary",
  active = new WeakSet<object>(),
  visited = new WeakSet<object>(),
): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number.`);
    }
    return;
  }
  if (value == null || typeof value !== "object") return;
  if (active.has(value)) throw new Error(`${path} contains a cyclic value.`);
  if (visited.has(value)) return;
  active.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertFiniteNumbersRecursively(entry, `${path}[${index}]`, active, visited);
    });
  } else {
    for (const [key, entry] of Object.entries(value)) {
      assertFiniteNumbersRecursively(entry, `${path}.${key}`, active, visited);
    }
  }
  active.delete(value);
  visited.add(value);
}

function stateAuditHashUpdate(
  state: { first: number; second: number },
  value: string,
): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    state.first = Math.imul(state.first ^ code, 0x01000193) >>> 0;
    state.second = Math.imul(state.second ^ code, 0x85ebca6b) >>> 0;
  }
  state.first = Math.imul(state.first ^ 0xff, 0x01000193) >>> 0;
  state.second = Math.imul(state.second ^ 0x7f, 0x85ebca6b) >>> 0;
}

function verifyStateAuditResultAttestation(audit: InterfaceAudit, filename: string): void {
  if (
    audit.auditAttestation?.schemaVersion !== "1.0.0" ||
    !/^fnv1a32x2-audit-input:[0-9a-f]{16}$/.test(audit.auditAttestation.inputFingerprint) ||
    !/^fnv1a32x2-audit-result:[0-9a-f]{16}$/.test(audit.auditAttestation.resultFingerprint)
  ) {
    throw new Error(`${filename}: state-pair export requires a valid audit input/result attestation.`);
  }
  const { auditAttestation, ...scientificResult } = audit;
  const state = { first: 0x811c9dc5, second: 0x27d4eb2f };
  stateAuditHashUpdate(state, JSON.stringify(scientificResult));
  const expected = `fnv1a32x2-audit-result:${state.first.toString(16).padStart(8, "0")}${state.second.toString(16).padStart(8, "0")}`;
  if (auditAttestation.resultFingerprint !== expected) {
    throw new Error(`${filename}: the audit result attestation does not match its scientific result fields.`);
  }
}

function assertExactNumber(actual: number, expected: number, label: string): void {
  if (actual !== expected) throw new Error(`${label} is inconsistent with the paired coordinate audits.`);
}

function assertExactNullableNumber(
  actual: number | null,
  expected: number | null,
  label: string,
): void {
  if (actual !== expected) throw new Error(`${label} is inconsistent with the paired coordinate audits.`);
}

function assertExportCondition(
  condition: StatePairConditionSummary,
  conditionName: "reference" | "comparison",
  receptorSequenceLength: number,
  vhhSequenceLength: number,
): Map<string, ContactPair> {
  if (typeof condition.id !== "string" || !condition.id.trim()) {
    throw new Error(`State-pair export ${conditionName} identifier must be non-empty.`);
  }
  if (typeof condition.filename !== "string" || !condition.filename.trim()) {
    throw new Error(`State-pair export ${conditionName} filename must be non-empty.`);
  }
  const label = normalizeLabel(condition.label, `State-pair export ${conditionName}`);
  const expectedLabelSource = label == null ? null : "user";
  if (condition.labelSource !== expectedLabelSource) {
    throw new Error(`${condition.filename}: condition label source is inconsistent with the optional user label.`);
  }
  if (
    typeof condition.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(condition.sha256)
  ) {
    throw new Error(
      `${condition.filename}: state-pair export requires a source SHA-256 digest in canonical lowercase hexadecimal form.`,
    );
  }
  if (condition.bytes == null || !Number.isSafeInteger(condition.bytes) || condition.bytes < 0) {
    throw new Error(`${condition.filename}: state-pair export requires a non-negative source byte count.`);
  }
  if (!/^fnv1a64-3dp:[0-9a-f]{16}$/.test(condition.coordinateFingerprint)) {
    throw new Error(`${condition.filename}: state-pair export requires a verified source-coordinate fingerprint.`);
  }
  if (!/^fnv1a64-se3-2dp:[0-9a-f]{16}$/.test(condition.geometryFingerprint)) {
    throw new Error(`${condition.filename}: state-pair export requires a verified SE(3)-canonical geometry fingerprint.`);
  }
  if (condition.coordinateProvenance !== classifyCoordinateProvenance(condition.experimentalMethod)) {
    throw new Error(`${condition.filename}: coordinate provenance is inconsistent with the experimental-method metadata.`);
  }
  if (condition.sourceFormat !== "pdb" && condition.sourceFormat !== "mmcif") {
    throw new Error(`${condition.filename}: coordinate source format is invalid.`);
  }
  if (
    condition.coordinateScope !== "as-supplied" &&
    condition.coordinateScope !== "deposited-assembly"
  ) {
    throw new Error(`${condition.filename}: coordinate scope is invalid.`);
  }
  if (
    typeof condition.selectedModelId !== "string" || !condition.selectedModelId ||
    !Number.isSafeInteger(condition.modelCount) || condition.modelCount < 1 ||
    !Array.isArray(condition.availableModelIds) ||
    condition.availableModelIds.length !== condition.modelCount ||
    new Set(condition.availableModelIds).size !== condition.availableModelIds.length ||
    !condition.availableModelIds.includes(condition.selectedModelId)
  ) {
    throw new Error(`${condition.filename}: selected-model provenance is inconsistent.`);
  }
  if (condition.selectedAssemblyId !== (condition.selectedAssembly?.id ?? null)) {
    throw new Error(`${condition.filename}: selected-assembly provenance is inconsistent.`);
  }
  if (
    (condition.coordinateScope === "as-supplied" && condition.selectedAssembly != null) ||
    (condition.coordinateScope === "deposited-assembly" &&
      (condition.sourceFormat !== "mmcif" || condition.selectedAssembly == null))
  ) {
    throw new Error(`${condition.filename}: coordinate scope and selected assembly are inconsistent.`);
  }
  for (const [field, value] of Object.entries(condition.parserAccounting)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${condition.filename}: parser-accounting field ${field} must be a non-negative safe integer.`);
    }
  }
  for (const [role, chain, expectedLength] of [
    ["receptor", condition.receptorChain, receptorSequenceLength],
    ["VHH", condition.vhhChain, vhhSequenceLength],
  ] as const) {
    if (typeof chain.id !== "string" || !chain.id) {
      throw new Error(`${condition.filename}: selected ${role} chain provenance is missing its instance ID.`);
    }
    if (
      typeof chain.observedSequence !== "string" || !chain.observedSequence ||
      chain.observedSequenceLength !== chain.observedSequence.length ||
      chain.observedSequenceLength !== expectedLength ||
      chain.residueCount !== chain.observedSequenceLength ||
      !Number.isSafeInteger(chain.atomCount) || chain.atomCount < chain.residueCount ||
      !Number.isFinite(chain.backboneCompleteness) ||
      chain.backboneCompleteness < 0 || chain.backboneCompleteness > 1
    ) {
      throw new Error(`${condition.filename}: selected ${role} chain sequence/count provenance is inconsistent.`);
    }
  }
  if (
    condition.receptorChain.id === condition.vhhChain.id ||
    condition.audit.receptorChain !== condition.receptorChain.id ||
    condition.audit.vhhChain !== condition.vhhChain.id
  ) {
    throw new Error(`${condition.filename}: selected-chain provenance does not match the coordinate audit.`);
  }
  if (
    condition.audit.version !== CONFOVHH_VERSION ||
    condition.evidenceLevel !== condition.audit.evidenceLevel ||
    condition.contactPairCount !== condition.audit.contactPairCount ||
    condition.severeClashCount !== condition.audit.severeClashCount ||
    condition.deltaSasaAngstrom2 !== condition.audit.deltaSasaAngstrom2 ||
    condition.halfDeltaSasaInterfaceAreaAngstrom2 !==
      condition.audit.halfDeltaSasaInterfaceAreaAngstrom2
  ) {
    throw new Error(`${condition.filename}: condition summary fields drift from the attested coordinate audit.`);
  }
  assertCoordinateOnlyAudit(condition);
  verifyStateAuditResultAttestation(condition.audit, condition.filename);
  const contacts = contactMap(condition, receptorSequenceLength, vhhSequenceLength);
  if (
    new Set(condition.audit.receptorInterfaceKeys).size !==
      condition.audit.receptorInterfaceKeys.length ||
    new Set(condition.audit.vhhInterfaceKeys).size !==
      condition.audit.vhhInterfaceKeys.length ||
    condition.audit.receptorInterfaceKeys.length !== condition.audit.receptorInterfaceResidues ||
    condition.audit.vhhInterfaceKeys.length !== condition.audit.vhhInterfaceResidues
  ) {
    throw new Error(`${condition.filename}: interface-key provenance is inconsistent with the coordinate audit.`);
  }
  return contacts;
}

function assertPolicyIsCurrent(summary: StatePairSummary): void {
  const policy = summary.auditPolicy;
  for (const [label, actual, expected] of [
    ["confidence mode", policy.confidenceMode, EXPECTED_POLICY.confidenceMode],
    ["PAE policy", policy.pae, EXPECTED_POLICY.pae],
    ["residue-contact cutoff", policy.residueContactCutoffAngstrom, EXPECTED_POLICY.residueContactCutoffAngstrom],
    ["polar-proxy cutoff", policy.polarProxyCutoffAngstrom, EXPECTED_POLICY.polarProxyCutoffAngstrom],
    ["salt-bridge-proxy cutoff", policy.saltBridgeProxyCutoffAngstrom, EXPECTED_POLICY.saltBridgeProxyCutoffAngstrom],
    ["severe-clash overlap", policy.severeClashOverlapAngstrom, EXPECTED_POLICY.severeClashOverlapAngstrom],
    ["SASA probe radius", policy.sasaProbeRadiusAngstrom, EXPECTED_POLICY.sasaProbeRadiusAngstrom],
    ["SASA sphere points", policy.sasaSpherePoints, EXPECTED_POLICY.sasaSpherePoints],
    ["SASA candidate-distance budget", policy.sasaMaximumCandidateDistanceChecks, EXPECTED_POLICY.sasaMaximumCandidateDistanceChecks],
    ["SASA occlusion-check budget", policy.sasaMaximumOcclusionChecks, EXPECTED_POLICY.sasaMaximumOcclusionChecks],
    ["SASA orientation", policy.sasaOrientation, EXPECTED_POLICY.sasaOrientation],
    ["SASA frame algorithm", policy.sasaFrameAlgorithm, EXPECTED_POLICY.sasaFrameAlgorithm],
    ["SASA radii", policy.sasaRadii, SASA_RADII_METHOD_DESCRIPTION],
    ["CDR annotation", policy.cdrAnnotation, CDR_ANNOTATION_METHOD_DESCRIPTION],
    ["PAE summary", policy.paeSummary, PAE_SUMMARY_METHOD_DESCRIPTION],
  ] as const) {
    if (actual !== expected) throw new Error(`State-pair export ${label} drifted from the current fixed audit policy.`);
  }
  const referenceFingerprint = auditPolicyFingerprint(summary.reference.audit);
  const comparisonFingerprint = auditPolicyFingerprint(summary.comparison.audit);
  if (
    policy.fingerprint !== referenceFingerprint ||
    policy.fingerprint !== comparisonFingerprint ||
    summary.methods.auditPolicyFingerprint !== policy.fingerprint
  ) {
    throw new Error("State-pair export audit-policy fingerprints are inconsistent.");
  }
}

function jsonRecordEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Takes and validates a deep export snapshot. Both JSON and CSV exports use
 * this same gate so neither format can serialize stale or internally
 * contradictory scientific results.
 */
export function validateStatePairExportSummary(summary: StatePairSummary): StatePairSummary {
  const snapshot = structuredClone(summary);
  assertFiniteNumbersRecursively(snapshot);
  if (
    snapshot.schemaVersion !== STATE_PAIR_SCHEMA_VERSION ||
    snapshot.version !== CONFOVHH_VERSION
  ) {
    throw new Error(
      `State-pair export requires schema ${STATE_PAIR_SCHEMA_VERSION} and current ConfoVHH ${CONFOVHH_VERSION}.`,
    );
  }
  if (
    !Number.isSafeInteger(snapshot.receptorSequenceLength) ||
    snapshot.receptorSequenceLength < 1 ||
    !Number.isSafeInteger(snapshot.vhhSequenceLength) ||
    snapshot.vhhSequenceLength < 1
  ) {
    throw new Error("State-pair export requires positive observed receptor and VHH sequence lengths.");
  }
  const referenceContacts = assertExportCondition(
    snapshot.reference,
    "reference",
    snapshot.receptorSequenceLength,
    snapshot.vhhSequenceLength,
  );
  const comparisonContacts = assertExportCondition(
    snapshot.comparison,
    "comparison",
    snapshot.receptorSequenceLength,
    snapshot.vhhSequenceLength,
  );
  if (snapshot.reference.id === snapshot.comparison.id) {
    throw new Error("State-pair export requires distinct reference and comparison identifiers.");
  }
  if (
    snapshot.reference.receptorChain.observedSequence !==
      snapshot.comparison.receptorChain.observedSequence ||
    snapshot.reference.vhhChain.observedSequence !==
      snapshot.comparison.vhhChain.observedSequence
  ) {
    throw new Error("State-pair export requires exact observed receptor and VHH sequence identity.");
  }

  assertPolicyIsCurrent(snapshot);
  for (const [key, expected] of Object.entries(STATE_PAIR_METHODS)) {
    if (snapshot.methods[key as keyof typeof STATE_PAIR_METHODS] !== expected) {
      throw new Error(`State-pair export method description ${key} drifted from the current schema.`);
    }
  }
  if (!jsonRecordEquals(snapshot.warnings, STATE_PAIR_WARNINGS)) {
    throw new Error("State-pair export warnings drifted from the current claim boundary.");
  }

  const referenceAudit = snapshot.reference.audit;
  const comparisonAudit = snapshot.comparison.audit;
  const expectedDeltas: StatePairDeltas = {
    contactPairCount: comparisonAudit.contactPairCount - referenceAudit.contactPairCount,
    atomContactCount: comparisonAudit.atomContactCount - referenceAudit.atomContactCount,
    receptorInterfaceResidues:
      comparisonAudit.receptorInterfaceResidues - referenceAudit.receptorInterfaceResidues,
    vhhInterfaceResidues:
      comparisonAudit.vhhInterfaceResidues - referenceAudit.vhhInterfaceResidues,
    polarContactProxyCount:
      comparisonAudit.polarContactProxyCount - referenceAudit.polarContactProxyCount,
    saltBridgeProxyCount: comparisonAudit.saltBridgeProxyCount - referenceAudit.saltBridgeProxyCount,
    severeClashCount: comparisonAudit.severeClashCount - referenceAudit.severeClashCount,
    possibleInterchainDisulfideCount:
      comparisonAudit.possibleInterchainDisulfideCount -
      referenceAudit.possibleInterchainDisulfideCount,
    maximumOverlapAngstrom:
      comparisonAudit.maximumOverlapAngstrom - referenceAudit.maximumOverlapAngstrom,
    deltaSasaAngstrom2: comparisonAudit.deltaSasaAngstrom2 - referenceAudit.deltaSasaAngstrom2,
    receptorBuriedSurfaceAreaAngstrom2:
      comparisonAudit.receptorBuriedSurfaceAreaAngstrom2 -
      referenceAudit.receptorBuriedSurfaceAreaAngstrom2,
    vhhBuriedSurfaceAreaAngstrom2:
      comparisonAudit.vhhBuriedSurfaceAreaAngstrom2 -
      referenceAudit.vhhBuriedSurfaceAreaAngstrom2,
    halfDeltaSasaInterfaceAreaAngstrom2:
      comparisonAudit.halfDeltaSasaInterfaceAreaAngstrom2 -
      referenceAudit.halfDeltaSasaInterfaceAreaAngstrom2,
    paratopeProxyShare: nullableDelta(
      comparisonAudit.paratopeProxyShare,
      referenceAudit.paratopeProxyShare,
    ),
    cdr3ProxyShare: nullableDelta(
      comparisonAudit.cdr3ProxyShare,
      referenceAudit.cdr3ProxyShare,
    ),
  };
  for (const key of Object.keys(expectedDeltas) as Array<keyof StatePairDeltas>) {
    const actual = snapshot.deltas[key];
    const expected = expectedDeltas[key];
    if (actual == null || expected == null) {
      assertExactNullableNumber(actual, expected, `State-pair signed delta ${key}`);
    } else {
      assertExactNumber(actual, expected, `State-pair signed delta ${key}`);
    }
  }

  const expectedSimilarity = {
    contactPairs: jaccardIndex(new Set(referenceContacts.keys()), new Set(comparisonContacts.keys())),
    receptorEpitope: jaccardIndex(
      setFromContacts(referenceContacts.values(), "receptor"),
      setFromContacts(comparisonContacts.values(), "receptor"),
    ),
    vhhParatope: jaccardIndex(
      setFromContacts(referenceContacts.values(), "vhh"),
      setFromContacts(comparisonContacts.values(), "vhh"),
    ),
  };
  for (const key of Object.keys(expectedSimilarity) as Array<keyof typeof expectedSimilarity>) {
    const actual = snapshot.similarity[key];
    const expected = expectedSimilarity[key];
    if (actual != null && (actual < 0 || actual > 1)) {
      throw new Error(`State-pair Jaccard ${key} must fall within 0–1 when present.`);
    }
    assertExactNullableNumber(actual, expected, `State-pair Jaccard ${key}`);
  }

  const expectedContacts = compareContacts(referenceContacts, comparisonContacts);
  if (!jsonRecordEquals(snapshot.contacts, expectedContacts)) {
    throw new Error(
      "State-pair shared/reference-only/comparison-only contact partitions do not match the attested contact maps.",
    );
  }
  assertFiniteNonnegative(
    snapshot.selectedGeometryFit.rmsdAngstrom,
    "State-pair selected-geometry RMSD",
  );
  assertFiniteNonnegative(
    snapshot.selectedGeometryFit.maximumDeviationAngstrom,
    "State-pair selected-geometry maximum deviation",
  );
  if (
    snapshot.selectedGeometryFit.rmsdAngstrom >
      snapshot.selectedGeometryFit.maximumDeviationAngstrom + 1e-12
  ) {
    throw new Error(
      "State-pair selected-geometry RMSD cannot exceed the maximum atom deviation.",
    );
  }
  if (
    snapshot.selectedGeometryFit.rmsdAngstrom <=
      GEOMETRY_DUPLICATE_RMSD_ANGSTROM + 1e-12 &&
    snapshot.selectedGeometryFit.maximumDeviationAngstrom <=
      GEOMETRY_DUPLICATE_MAX_DEVIATION_ANGSTROM + 1e-12
  ) {
    throw new Error("State-pair export cannot report duplicate selected receptor–VHH geometry.");
  }
  return snapshot;
}

type CsvValue = string | number | boolean | null | undefined;

function sanitizeCsvText(value: string): string {
  const formulaLike = /^[\p{White_Space}\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*[=+\-@]/u.test(value);
  const withoutControls = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => {
    if (character === "\n") return "\\n";
    if (character === "\r") return "\\r";
    if (character === "\t") return "\\t";
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
  return formulaLike ? `'${withoutControls}` : withoutControls;
}

function csvCell(value: CsvValue): string {
  if (value == null) return "";
  const text = typeof value === "string" ? sanitizeCsvText(value) : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const CSV_HEADER = [
  "schema_version",
  "software_version",
  "record_type",
  "record_id",
  "condition",
  "condition_label",
  "filename",
  "sha256",
  "bytes",
  "source_format",
  "coordinate_scope",
  "selected_model_id",
  "selected_assembly_id",
  "receptor_chain_instance",
  "vhh_chain_instance",
  "metric",
  "reference_value",
  "comparison_value",
  "delta_comparison_minus_reference",
  "similarity_value",
  "contact_membership",
  "receptor_residue_order",
  "vhh_residue_order",
  "reference_receptor_residue",
  "reference_vhh_residue",
  "comparison_receptor_residue",
  "comparison_vhh_residue",
  "reference_minimum_distance_angstrom",
  "comparison_minimum_distance_angstrom",
  "distance_delta_comparison_minus_reference_angstrom",
  "reference_contact_types",
  "comparison_contact_types",
  "audit_policy_fingerprint",
  "sasa_orientation",
  "sasa_sphere_points",
  "sasa_maximum_candidate_distance_checks",
  "sasa_maximum_occlusion_checks",
  "comparison_direction",
  "cdr_annotation",
  "pae_summary",
  "sasa_frame_algorithm",
  "condition_label_source",
  "coordinate_provenance",
  "experimental_method",
  "coordinate_fingerprint",
  "geometry_fingerprint",
  "source_title",
  "model_count",
  "available_model_ids",
  "receptor_sequence_length",
  "vhh_sequence_length",
  "claim_boundary",
  "residue_contact_cutoff_angstrom",
  "polar_proxy_cutoff_angstrom",
  "salt_bridge_proxy_cutoff_angstrom",
  "severe_clash_overlap_angstrom",
  "sasa_probe_radius_angstrom",
  "sasa_radii",
  "contact_definition_method",
  "residue_mapping_method",
  "jaccard_method",
  "label_method",
  "coordinate_frame_method",
  "duplicate_detection_method",
  "confidence_mode",
  "pae_policy",
] as const;

function blankCsvRow(summary: StatePairSummary): CsvValue[] {
  const row = Array<CsvValue>(CSV_HEADER.length).fill(null);
  row[0] = summary.schemaVersion;
  row[1] = summary.version;
  row[32] = summary.auditPolicy.fingerprint;
  row[33] = summary.auditPolicy.sasaOrientation;
  row[34] = summary.auditPolicy.sasaSpherePoints;
  row[35] = summary.auditPolicy.sasaMaximumCandidateDistanceChecks;
  row[36] = summary.auditPolicy.sasaMaximumOcclusionChecks;
  row[37] = "comparison minus reference";
  row[38] = summary.auditPolicy.cdrAnnotation;
  row[39] = summary.auditPolicy.paeSummary;
  row[40] = summary.auditPolicy.sasaFrameAlgorithm;
  row[49] = summary.receptorSequenceLength;
  row[50] = summary.vhhSequenceLength;
  row[51] = STATE_PAIR_CLAIM_BOUNDARY;
  row[52] = summary.auditPolicy.residueContactCutoffAngstrom;
  row[53] = summary.auditPolicy.polarProxyCutoffAngstrom;
  row[54] = summary.auditPolicy.saltBridgeProxyCutoffAngstrom;
  row[55] = summary.auditPolicy.severeClashOverlapAngstrom;
  row[56] = summary.auditPolicy.sasaProbeRadiusAngstrom;
  row[57] = summary.auditPolicy.sasaRadii;
  row[58] = summary.methods.contactDefinition;
  row[59] = summary.methods.residueMapping;
  row[60] = summary.methods.jaccard;
  row[61] = summary.methods.labels;
  row[62] = summary.methods.coordinateFrame;
  row[63] = summary.methods.duplicateDetection;
  row[64] = summary.auditPolicy.confidenceMode;
  row[65] = summary.auditPolicy.pae;
  return row;
}

function conditionCsvRow(
  summary: StatePairSummary,
  conditionName: "reference" | "comparison",
  condition: StatePairConditionSummary,
): CsvValue[] {
  const row = blankCsvRow(summary);
  row[2] = "condition_provenance";
  row[3] = condition.id;
  row[4] = conditionName;
  row[5] = condition.label;
  row[6] = condition.filename;
  row[7] = condition.sha256;
  row[8] = condition.bytes;
  row[9] = condition.sourceFormat;
  row[10] = condition.coordinateScope;
  row[11] = condition.selectedModelId;
  row[12] = condition.selectedAssemblyId;
  row[13] = condition.receptorChain.id;
  row[14] = condition.vhhChain.id;
  row[41] = condition.labelSource;
  row[42] = condition.coordinateProvenance;
  row[43] = condition.experimentalMethod;
  row[44] = condition.coordinateFingerprint;
  row[45] = condition.geometryFingerprint;
  row[46] = condition.title;
  row[47] = condition.modelCount;
  row[48] = condition.availableModelIds.join(";");
  return row;
}

function metricRows(summary: StatePairSummary): CsvValue[][] {
  const reference = summary.reference.audit;
  const comparison = summary.comparison.audit;
  const metrics: Array<[keyof StatePairDeltas, number | null, number | null, number | null]> = [
    ["contactPairCount", reference.contactPairCount, comparison.contactPairCount, summary.deltas.contactPairCount],
    ["atomContactCount", reference.atomContactCount, comparison.atomContactCount, summary.deltas.atomContactCount],
    ["receptorInterfaceResidues", reference.receptorInterfaceResidues, comparison.receptorInterfaceResidues, summary.deltas.receptorInterfaceResidues],
    ["vhhInterfaceResidues", reference.vhhInterfaceResidues, comparison.vhhInterfaceResidues, summary.deltas.vhhInterfaceResidues],
    ["polarContactProxyCount", reference.polarContactProxyCount, comparison.polarContactProxyCount, summary.deltas.polarContactProxyCount],
    ["saltBridgeProxyCount", reference.saltBridgeProxyCount, comparison.saltBridgeProxyCount, summary.deltas.saltBridgeProxyCount],
    ["severeClashCount", reference.severeClashCount, comparison.severeClashCount, summary.deltas.severeClashCount],
    ["possibleInterchainDisulfideCount", reference.possibleInterchainDisulfideCount, comparison.possibleInterchainDisulfideCount, summary.deltas.possibleInterchainDisulfideCount],
    ["maximumOverlapAngstrom", reference.maximumOverlapAngstrom, comparison.maximumOverlapAngstrom, summary.deltas.maximumOverlapAngstrom],
    ["deltaSasaAngstrom2", reference.deltaSasaAngstrom2, comparison.deltaSasaAngstrom2, summary.deltas.deltaSasaAngstrom2],
    ["receptorBuriedSurfaceAreaAngstrom2", reference.receptorBuriedSurfaceAreaAngstrom2, comparison.receptorBuriedSurfaceAreaAngstrom2, summary.deltas.receptorBuriedSurfaceAreaAngstrom2],
    ["vhhBuriedSurfaceAreaAngstrom2", reference.vhhBuriedSurfaceAreaAngstrom2, comparison.vhhBuriedSurfaceAreaAngstrom2, summary.deltas.vhhBuriedSurfaceAreaAngstrom2],
    ["halfDeltaSasaInterfaceAreaAngstrom2", reference.halfDeltaSasaInterfaceAreaAngstrom2, comparison.halfDeltaSasaInterfaceAreaAngstrom2, summary.deltas.halfDeltaSasaInterfaceAreaAngstrom2],
    ["paratopeProxyShare", reference.paratopeProxyShare, comparison.paratopeProxyShare, summary.deltas.paratopeProxyShare],
    ["cdr3ProxyShare", reference.cdr3ProxyShare, comparison.cdr3ProxyShare, summary.deltas.cdr3ProxyShare],
  ];
  return metrics.map(([metric, referenceValue, comparisonValue, delta]) => {
    const row = blankCsvRow(summary);
    row[2] = "metric";
    row[3] = `metric:${metric}`;
    row[15] = metric;
    row[16] = referenceValue;
    row[17] = comparisonValue;
    row[18] = delta;
    return row;
  });
}

function similarityRows(summary: StatePairSummary): CsvValue[][] {
  return (Object.entries(summary.similarity) as Array<[keyof StatePairSummary["similarity"], number | null]>)
    .map(([metric, value]) => {
      const row = blankCsvRow(summary);
      row[2] = "similarity";
      row[3] = `similarity:${metric}`;
      row[15] = metric;
      row[19] = value;
      return row;
    });
}

function contactCsvRows(summary: StatePairSummary): CsvValue[][] {
  const groups = [
    ["shared", summary.contacts.shared],
    ["reference_only", summary.contacts.referenceOnly],
    ["comparison_only", summary.contacts.comparisonOnly],
  ] as const;
  return groups.flatMap(([membership, contacts]) => contacts.map((contact) => {
    const row = blankCsvRow(summary);
    row[2] = "contact";
    row[3] = `contact:${contact.key}`;
    row[20] = membership;
    row[21] = contact.receptorResidueOrder;
    row[22] = contact.vhhResidueOrder;
    row[23] = contact.reference?.receptorResidue ?? null;
    row[24] = contact.reference?.vhhResidue ?? null;
    row[25] = contact.comparison?.receptorResidue ?? null;
    row[26] = contact.comparison?.vhhResidue ?? null;
    row[27] = contact.reference?.minimumDistance ?? null;
    row[28] = contact.comparison?.minimumDistance ?? null;
    row[29] = contact.minimumDistanceDeltaAngstrom;
    row[30] = contact.reference?.contactTypes.join(";") ?? null;
    row[31] = contact.comparison?.contactTypes.join(";") ?? null;
    return row;
  }));
}

/** Long-form, one-record-per-condition/metric/similarity/contact CSV. */
export function statePairToCsv(summary: StatePairSummary): string {
  const summarySnapshot = validateStatePairExportSummary(summary);
  const rows: CsvValue[][] = [
    [...CSV_HEADER],
    conditionCsvRow(summarySnapshot, "reference", summarySnapshot.reference),
    conditionCsvRow(summarySnapshot, "comparison", summarySnapshot.comparison),
    ...metricRows(summarySnapshot),
    ...similarityRows(summarySnapshot),
    ...contactCsvRows(summarySnapshot),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function createStatePairExportReport(
  summary: StatePairSummary,
  comparisonMode = "Paired coordinate-only state-context re-audit; no PAE or pLDDT.",
  generatedAt = new Date().toISOString(),
): StatePairExportReport {
  if (typeof comparisonMode !== "string" || !comparisonMode.trim()) {
    throw new Error("comparisonMode must describe the paired audit policy.");
  }
  requireIsoTimestamp(generatedAt, "State-pair export timestamp");
  const summarySnapshot = validateStatePairExportSummary(summary);
  return {
    schemaVersion: STATE_PAIR_SCHEMA_VERSION,
    softwareVersion: CONFOVHH_VERSION,
    version: CONFOVHH_VERSION,
    generatedAt,
    comparisonMode,
    claimBoundary: STATE_PAIR_CLAIM_BOUNDARY,
    auditPolicy: { ...summarySnapshot.auditPolicy },
    summary: summarySnapshot,
  };
}

// Keep deterministic string ordering available to integration code without
// depending on host locale or ICU data.
export const compareStatePairCodeUnits = compareCodeUnits;
