import {
  IMGT_NUMBERING_ENGINE,
  numberVhhSequence,
  type ImgtRegion,
  type VhhNumberingAnnotation,
} from "./vhh-numbering.ts";
import { canonicalSasaFrameMatches } from "./geometry-fit.ts";
import {
  CANONICAL_SASA_FRAME_ALGORITHM,
  MAX_ABSOLUTE_COORDINATE_ANGSTROM,
  MAX_CANONICAL_COORDINATE_ANGSTROM,
} from "./geometry-constants.ts";

export {
  CANONICAL_SASA_FRAME_ALGORITHM,
  MAX_ABSOLUTE_COORDINATE_ANGSTROM,
  MAX_CANONICAL_COORDINATE_ANGSTROM,
} from "./geometry-constants.ts";

export const CONFOVHH_VERSION = "0.6.0";

export type ConfidenceMode = "none" | "plddt";
export type EvidenceLevel = "supported" | "mixed" | "limited" | "not-assessable";
export type FindingLevel = "supported" | "review" | "limited" | "unavailable";
export type SasaOrientation =
  | "source-coordinate-frame"
  | "deterministic-proper-signed-frame";

export interface AtomRecord {
  serial: number;
  name: string;
  residueName: string;
  chainId: string;
  residueNumber: number;
  insertionCode: string;
  residueKey: string;
  residueOrder: number;
  x: number;
  y: number;
  z: number;
  element: string;
  bFactor: number | null;
}

export interface ResidueRecord {
  key: string;
  chainId: string;
  name: string;
  number: number;
  insertionCode: string;
  order: number;
  oneLetter: string;
  atoms: AtomRecord[];
  labelSequenceId?: number | null;
  authSequenceId?: number | null;
}

export interface ChainSummary {
  id: string;
  atomCount: number;
  residueCount: number;
  sequence: string;
  backboneCompleteness: number;
  roleHint: "VHH-like" | "receptor-like" | "other";
  residues: ResidueRecord[];
  /** Unique source identifier used by deposited-assembly generation. */
  labelAsymId?: string;
  /** Depositor-facing chain identifier. It is not necessarily unique. */
  authAsymId?: string;
  /** 1-based copy index when a deposited assembly was reconstructed. */
  assemblyCopyIndex?: number;
  /** 1-based source row in pdbx_struct_assembly_gen. */
  assemblyGeneratorRowIndex?: number;
  /** Ordered operation identifiers used to generate this chain instance. */
  assemblyOperationIds?: string[];
  /** Composite affine transform as three [r1,r2,r3,t] rows. */
  assemblyTransform?: [[number, number, number, number], [number, number, number, number], [number, number, number, number]];
}

export interface AssemblyDescriptor {
  id: string;
  details: string | null;
  methodDetails: string | null;
  oligomericDetails: string | null;
  oligomericCount: number | null;
  generatorCount: number;
  generators: Array<{
    sourceRowIndex: number;
    operationExpression: string;
    labelAsymIds: string[];
  }>;
}

export interface SelectedAssembly {
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
}

export interface ParsedStructure {
  atoms: AtomRecord[];
  chains: ChainSummary[];
  title: string | null;
  experimentalMethod: string | null;
  modelCount: number;
  ignoredAlternateLocations: number;
  ignoredHydrogens: number;
  duplicateAtomRecords: number;
  malformedAtomRecords: number;
  unsupportedResidueRecords: number;
  zeroOccupancyAtomRecords: number;
  residueNameConflicts: number;
  sourceFormat: "pdb" | "mmcif";
  coordinateScope: "as-supplied" | "deposited-assembly";
  selectedModelId: string;
  availableModelIds: string[];
  availableAssemblies: AssemblyDescriptor[];
  selectedAssembly: SelectedAssembly | null;
}

export interface ContactPair {
  receptorResidue: string;
  vhhResidue: string;
  receptorResidueOrder: number;
  vhhResidueOrder: number;
  receptorResidueName: string;
  vhhResidueName: string;
  vhhRegion: ImgtRegion | "Unnumbered";
  vhhImgtPosition: string | null;
  minimumDistance: number;
  contactTypes: string[];
  receptorConfidence: number | null;
  vhhConfidence: number | null;
}

export interface AuditFinding {
  label: string;
  level: FindingLevel;
  evidence: string;
  action: string;
}

export interface InterfaceAudit {
  version: string;
  confidenceMode: ConfidenceMode;
  receptorChain: string;
  vhhChain: string;
  evidenceLevel: EvidenceLevel;
  rationale: string;
  contactPairCount: number;
  atomContactCount: number;
  receptorInterfaceResidues: number;
  vhhInterfaceResidues: number;
  polarContactProxyCount: number;
  saltBridgeProxyCount: number;
  severeClashCount: number;
  possibleInterchainDisulfideCount: number;
  maximumOverlapAngstrom: number;
  paratopeProxyShare: number | null;
  cdr3ProxyShare: number | null;
  interfaceConfidence: number | null;
  interfaceConfidenceCoverage: number | null;
  deltaSasaAngstrom2: number;
  receptorBuriedSurfaceAreaAngstrom2: number;
  vhhBuriedSurfaceAreaAngstrom2: number;
  halfDeltaSasaInterfaceAreaAngstrom2: number;
  interfacePaeMedianAngstrom: number | null;
  interfacePaeP90Angstrom: number | null;
  receptorFrameToVhhPaeMedianAngstrom: number | null;
  vhhFrameToReceptorPaeMedianAngstrom: number | null;
  receptorFrameToVhhPaeP90Angstrom: number | null;
  vhhFrameToReceptorPaeP90Angstrom: number | null;
  lowPaeContactShare: number | null;
  paeFilename: string | null;
  paeOrderConfirmed: boolean;
  vhhNumbering: {
    status: VhhNumberingAnnotation["status"];
    policyVersion: VhhNumberingAnnotation["policyVersion"];
    scheme: "IMGT";
    engine: string;
    minimumEngineConfidence: number;
    confidence: number | null;
    completeImgtRegionCoverage: boolean;
    numberingSegmentationAgreement: boolean;
    cdrLengths: VhhNumberingAnnotation["cdrLengths"];
    error: string | null;
  };
  contacts: ContactPair[];
  receptorInterfaceKeys: string[];
  vhhInterfaceKeys: string[];
  findings: AuditFinding[];
  warnings: string[];
  methods: {
    residueContactCutoffAngstrom: number;
    polarProxyCutoffAngstrom: number;
    saltBridgeProxyCutoffAngstrom: number;
    severeClashOverlapAngstrom: number;
    sasaProbeRadiusAngstrom: number;
    sasaSpherePoints: number;
    sasaMaximumCandidateDistanceChecks: number;
    sasaMaximumOcclusionChecks: number;
    sasaRadii: string;
    sasaOrientation: SasaOrientation;
    sasaFrameAlgorithm: string;
    cdrAnnotation: string;
    paeSummary: string;
  };
  auditAttestation: {
    schemaVersion: "1.0.0";
    inputFingerprint: string;
    resultFingerprint: string;
  };
}

export interface ParsedPae {
  /** Row-major Float32 matrix to bound memory and support worker transfer. */
  matrix: Float32Array;
  residueCount: number;
  maxPaeAngstrom: number;
  sourceFormat: "AlphaFold predicted_aligned_error" | "pae matrix" | "raw matrix";
  filename: string | null;
}

interface AuditHashState {
  first: number;
  second: number;
}

function auditHashUpdate(state: AuditHashState, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    state.first = Math.imul(state.first ^ code, 0x01000193) >>> 0;
    state.second = Math.imul(state.second ^ code, 0x85ebca6b) >>> 0;
  }
  state.first = Math.imul(state.first ^ 0xff, 0x01000193) >>> 0;
  state.second = Math.imul(state.second ^ 0x7f, 0x85ebca6b) >>> 0;
}

function auditHashDigest(state: AuditHashState, prefix: string): string {
  return `${prefix}:${state.first.toString(16).padStart(8, "0")}${state.second.toString(16).padStart(8, "0")}`;
}

function auditInputFingerprint(
  structure: ParsedStructure,
  receptorChainId: string,
  vhhChainId: string,
  confidenceMode: ConfidenceMode,
  pae: ParsedPae | null,
  paeOrderConfirmed: boolean,
  sasaOrientation: SasaOrientation,
  sasaFrameAlgorithm: string,
): string {
  const state = { first: 0x811c9dc5, second: 0x27d4eb2f };
  auditHashUpdate(state, JSON.stringify({
    version: CONFOVHH_VERSION,
    receptorChainId,
    vhhChainId,
    confidenceMode,
    paeOrderConfirmed,
    sasaOrientation,
    sasaFrameAlgorithm,
    title: structure.title,
    experimentalMethod: structure.experimentalMethod,
    coordinateScope: structure.coordinateScope,
    sourceFormat: structure.sourceFormat,
    modelCount: structure.modelCount,
    selectedModelId: structure.selectedModelId,
    availableModelIds: structure.availableModelIds,
    selectedAssembly: structure.selectedAssembly,
    availableAssemblies: structure.availableAssemblies,
    parserAccounting: [
      structure.ignoredAlternateLocations,
      structure.ignoredHydrogens,
      structure.duplicateAtomRecords,
      structure.malformedAtomRecords,
      structure.unsupportedResidueRecords,
      structure.zeroOccupancyAtomRecords,
      structure.residueNameConflicts,
    ],
  }));
  for (const [role, chainId] of [["receptor", receptorChainId], ["vhh", vhhChainId]] as const) {
    const chain = structure.chains.find((candidate) => candidate.id === chainId);
    if (!chain) throw new Error(`Audit attestation cannot find selected ${role} chain ${chainId}.`);
    auditHashUpdate(state, JSON.stringify([
      role, chain.id, chain.sequence, chain.residueCount, chain.atomCount,
      chain.labelAsymId ?? null, chain.authAsymId ?? null,
      chain.assemblyCopyIndex ?? null, chain.assemblyGeneratorRowIndex ?? null,
      chain.assemblyOperationIds ?? [], chain.assemblyTransform ?? null,
    ]));
    for (const residue of chain.residues) {
      auditHashUpdate(state, JSON.stringify([
        residue.key, residue.name, residue.number, residue.insertionCode,
        residue.order, residue.oneLetter, residue.labelSequenceId ?? null,
        residue.authSequenceId ?? null,
      ]));
      for (const atom of residue.atoms) {
        auditHashUpdate(state, JSON.stringify([
          atom.name, atom.element, atom.serial, atom.residueOrder,
          atom.x, atom.y, atom.z, atom.bFactor,
        ]));
      }
    }
  }
  if (pae == null) {
    auditHashUpdate(state, "pae:null");
  } else {
    validateParsedPae(pae);
    auditHashUpdate(state, JSON.stringify([
      pae.filename, pae.residueCount, pae.maxPaeAngstrom, pae.sourceFormat,
    ]));
    const view = new DataView(pae.matrix.buffer, pae.matrix.byteOffset, pae.matrix.byteLength);
    for (let offset = 0; offset < view.byteLength; offset += 4) {
      auditHashUpdate(state, view.getUint32(offset, true).toString(16));
    }
  }
  return auditHashDigest(state, "fnv1a32x2-audit-input");
}

function auditResultFingerprint(audit: Omit<InterfaceAudit, "auditAttestation">): string {
  const state = { first: 0x811c9dc5, second: 0x27d4eb2f };
  auditHashUpdate(state, JSON.stringify(audit));
  return auditHashDigest(state, "fnv1a32x2-audit-result");
}

export function verifyInterfaceAuditAttestation(
  structure: ParsedStructure,
  receptorChainId: string,
  vhhChainId: string,
  audit: InterfaceAudit,
  pae: ParsedPae | null,
  paeOrderConfirmed: boolean,
): void {
  if (audit.auditAttestation?.schemaVersion !== "1.0.0") {
    throw new Error("The audit is missing its ConfoVHH input/result attestation.");
  }
  const expectedInput = auditInputFingerprint(
    structure,
    receptorChainId,
    vhhChainId,
    audit.confidenceMode,
    pae,
    paeOrderConfirmed,
    audit.methods.sasaOrientation,
    audit.methods.sasaFrameAlgorithm,
  );
  if (audit.auditAttestation.inputFingerprint !== expectedInput) {
    throw new Error("The audit input attestation does not match the selected coordinates, metadata, PAE, or method frame.");
  }
  const { auditAttestation, ...result } = audit;
  if (auditAttestation.resultFingerprint !== auditResultFingerprint(result)) {
    throw new Error("The audit result attestation does not match its scientific result fields.");
  }
}

export type CoordinateProvenance = "experimental" | "modeled" | "unknown";

export function classifyCoordinateProvenance(
  experimentalMethod: string | null | undefined,
): CoordinateProvenance {
  if (!experimentalMethod) return "unknown";
  const normalized = experimentalMethod.toUpperCase();
  if (normalized.includes("THEORETICAL") || normalized.includes("MODEL")) return "modeled";
  if (
    normalized.includes("DIFFRACTION") ||
    normalized.includes("ELECTRON MICROSCOPY") ||
    normalized.includes("NMR") ||
    normalized.includes("NEUTRON")
  ) return "experimental";
  return "unknown";
}

const AMINO_ACIDS: Record<string, string> = {
  ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C", GLN: "Q", GLU: "E",
  GLY: "G", HIS: "H", ILE: "I", LEU: "L", LYS: "K", MET: "M", PHE: "F",
  PRO: "P", SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V", MSE: "M",
  SEC: "U", PYL: "O",
};

const ACIDIC_ATOMS = new Set(["ASP:OD1", "ASP:OD2", "GLU:OE1", "GLU:OE2"]);
const BASIC_ATOMS = new Set(["LYS:NZ", "ARG:NE", "ARG:NH1", "ARG:NH2"]);
const DONOR_ATOMS = new Set([
  "ARG:NE", "ARG:NH1", "ARG:NH2", "ASN:ND2", "GLN:NE2", "HIS:ND1",
  "HIS:NE2", "LYS:NZ", "SER:OG", "THR:OG1", "TRP:NE1", "TYR:OH", "CYS:SG",
]);
const ACCEPTOR_ATOMS = new Set([
  "ASP:OD1", "ASP:OD2", "GLU:OE1", "GLU:OE2", "ASN:OD1", "GLN:OE1",
  "HIS:ND1", "HIS:NE2", "SER:OG", "THR:OG1", "TYR:OH", "CYS:SG",
]);
const MAX_PARSED_ATOMS = 60_000;
const MAX_PARSED_PROTEIN_CHAINS = 256;
const MAX_PDB_MODELS = 100;
const MAX_CANDIDATE_ATOM_PAIRS = 5_000_000;
const MAX_INTERFACE_RESIDUE_PAIRS = 50_000;
const MAX_CHAIN_SUGGESTION_PAIR_SCANS = 4_096;
const MAX_CHAIN_SUGGESTION_ATOM_COMPARISONS = 250_000;
const MAX_PAE_RESIDUES = 1_500;
const MAX_BROWSER_INPUT_TEXT_CHARACTERS = 16 * 1024 * 1024;
const MAX_PDB_LINE_BREAKS = 500_000;
const MAX_PAE_JSON_CONTAINERS = MAX_PAE_RESIDUES + 16;
const MAX_PAE_JSON_NESTING = 16;
const MAX_PAE_JSON_SEPARATORS =
  MAX_PAE_RESIDUES * MAX_PAE_RESIDUES + MAX_PAE_RESIDUES + 32;
const PDB_INTEGER_FIELD = /^[+-]?\d+$/;
const PDB_DECIMAL_FIELD = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/;

function strictPdbInteger(field: string): number | null {
  const value = field.trim();
  if (!PDB_INTEGER_FIELD.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function preflightPaeJsonStructure(text: string): void {
  let inString = false;
  let escaped = false;
  let containerCount = 0;
  let nesting = 0;
  let separatorCount = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "[" || character === "{") {
      containerCount += 1;
      nesting += 1;
      if (containerCount > MAX_PAE_JSON_CONTAINERS) {
        throw new Error(
          `The PAE JSON defines more than ${MAX_PAE_RESIDUES.toLocaleString()} matrix-row-scale containers.`,
        );
      }
      if (nesting > MAX_PAE_JSON_NESTING) {
        throw new Error("The PAE JSON exceeds the bounded nesting-depth limit.");
      }
    } else if (character === "]" || character === "}") {
      nesting -= 1;
      if (nesting < 0) break;
    } else if (character === ",") {
      separatorCount += 1;
      if (separatorCount > MAX_PAE_JSON_SEPARATORS) {
        throw new Error(
          `The PAE JSON exceeds the bounded ${MAX_PAE_RESIDUES.toLocaleString()}-residue matrix-entry limit.`,
        );
      }
    }
  }
}

function strictPdbDecimal(field: string): number | null {
  const value = field.trim();
  if (!PDB_DECIMAL_FIELD.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function strictPdbCoordinate(field: string): number | null {
  const value = field.trim();
  if (!PDB_DECIMAL_FIELD.test(value)) return null;
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    Math.abs(parsed) > MAX_ABSOLUTE_COORDINATE_ANGSTROM
  ) {
    throw new Error(
      `The selected PDB protein atoms contain a non-finite coordinate or one outside ` +
      `±${MAX_ABSOLUTE_COORDINATE_ANGSTROM.toLocaleString()} Å.`,
    );
  }
  return parsed;
}
const SASA_PROBE_RADIUS = 1.4;
const SASA_SPHERE_POINTS = 960;
const MAX_SASA_CANDIDATE_DISTANCE_CHECKS = 25_000_000;
const MAX_SASA_SURFACE_POINT_OCCLUSION_CHECKS = 250_000_000;
const VDW_RADII: Record<string, number> = {
  H: 1.2,
  C: 1.7,
  N: 1.55,
  O: 1.52,
  S: 1.8,
  P: 1.8,
  SE: 1.9,
  F: 1.47,
  CL: 1.75,
  BR: 1.85,
  I: 1.98,
};
const SASA_GRID_CELL_SIZE = 2 * (
  Math.max(1.7, ...Object.values(VDW_RADII)) + SASA_PROBE_RADIUS
);

export const SASA_RADII_METHOD_DESCRIPTION =
  "Element-based Bondi radii: H 1.20, C 1.70, N 1.55, O 1.52, S/P 1.80, Se 1.90 Å.";
export const CDR_ANNOTATION_METHOD_DESCRIPTION =
  `Sequence-aligned IMGT regions from ${IMGT_NUMBERING_ENGINE}: exact coordinate-sequence map-back, complete FR1/CDR1/FR2/CDR2/FR3/CDR3/FR4 coverage, and independent number/segment agreement; CDR1 27–38, CDR2 56–65, CDR3 105–117.`;
export const PAE_SUMMARY_METHOD_DESCRIPTION =
  "Directional median and 90th-percentile PAE over contacting receptor–VHH residue pairs using the user-confirmed AlphaFold row-aligned/column-evaluated convention and residue order; conservative summaries aggregate the worse direction for each contact pair, and lowPaeContactShare is the share of those conservative contact-pair values at or below 10 Å.";

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export interface ContactPaeSummary {
  receptorFrameToVhhPaeMedianAngstrom: number | null;
  vhhFrameToReceptorPaeMedianAngstrom: number | null;
  receptorFrameToVhhPaeP90Angstrom: number | null;
  vhhFrameToReceptorPaeP90Angstrom: number | null;
  interfacePaeMedianAngstrom: number | null;
  interfacePaeP90Angstrom: number | null;
  lowPaeContactShare: number | null;
}

export function validateParsedPae(pae: ParsedPae): void {
  if (!Number.isSafeInteger(pae?.residueCount) || pae.residueCount < 1 ||
      pae.residueCount > MAX_PAE_RESIDUES) {
    throw new Error(`The attached PAE residue count must be a safe integer from 1 to ${MAX_PAE_RESIDUES}.`);
  }
  if (!(pae.matrix instanceof Float32Array) ||
      pae.matrix.length !== pae.residueCount * pae.residueCount) {
    throw new Error("The attached PAE matrix must be a square Float32 array matching residueCount.");
  }
  if (!Number.isFinite(pae.maxPaeAngstrom) || pae.maxPaeAngstrom < 0) {
    throw new Error("The attached PAE maximum must be finite and non-negative.");
  }
  let observedMaximum = 0;
  for (let index = 0; index < pae.matrix.length; index += 1) {
    const value = pae.matrix[index];
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`The attached PAE matrix contains an invalid value at flat index ${index}.`);
    }
    observedMaximum = Math.max(observedMaximum, value);
  }
  if (pae.maxPaeAngstrom < observedMaximum) {
    throw new Error("The attached PAE maximum is smaller than a value in its matrix.");
  }
  if (![
    "AlphaFold predicted_aligned_error",
    "pae matrix",
    "raw matrix",
  ].includes(pae.sourceFormat)) {
    throw new Error("The attached PAE source format is invalid.");
  }
  if (pae.filename != null && (
    typeof pae.filename !== "string" || !pae.filename.trim() || pae.filename.length > 1_024 ||
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(pae.filename)
  )) {
    throw new Error("The attached PAE filename must be a non-empty bounded string without control or invisible formatting characters, or null.");
  }
}

export function summarizeContactPae(
  structure: ParsedStructure,
  receptorChainId: string,
  vhhChainId: string,
  contacts: readonly ContactPair[],
  pae: ParsedPae | null,
): ContactPaeSummary {
  const empty = {
    receptorFrameToVhhPaeMedianAngstrom: null,
    vhhFrameToReceptorPaeMedianAngstrom: null,
    receptorFrameToVhhPaeP90Angstrom: null,
    vhhFrameToReceptorPaeP90Angstrom: null,
    interfacePaeMedianAngstrom: null,
    interfacePaeP90Angstrom: null,
    lowPaeContactShare: null,
  } satisfies ContactPaeSummary;
  if (pae == null) return empty;
  validateParsedPae(pae);

  const globalResidueIndex = new Map<string, number>();
  let residueIndex = 0;
  for (const chain of structure.chains) {
    for (const residue of chain.residues) {
      globalResidueIndex.set(JSON.stringify([chain.id, residue.order]), residueIndex);
      residueIndex += 1;
    }
  }
  if (
    pae.residueCount !== residueIndex ||
    pae.matrix.length !== residueIndex * residueIndex
  ) {
    throw new Error("The attached PAE matrix no longer matches the parsed coordinate structure.");
  }
  const receptorFrameToVhhPae: number[] = [];
  const vhhFrameToReceptorPae: number[] = [];
  const conservativeContactPairPae: number[] = [];
  for (const contact of contacts) {
    const receptorIndex = globalResidueIndex.get(JSON.stringify([
      receptorChainId,
      contact.receptorResidueOrder,
    ]));
    const vhhIndex = globalResidueIndex.get(JSON.stringify([
      vhhChainId,
      contact.vhhResidueOrder,
    ]));
    if (receptorIndex == null || vhhIndex == null) {
      throw new Error("An audited contact cannot be mapped onto the attached PAE residue order.");
    }
    const receptorFrameToVhh = pae.matrix[receptorIndex * pae.residueCount + vhhIndex];
    const vhhFrameToReceptor = pae.matrix[vhhIndex * pae.residueCount + receptorIndex];
    receptorFrameToVhhPae.push(receptorFrameToVhh);
    vhhFrameToReceptorPae.push(vhhFrameToReceptor);
    conservativeContactPairPae.push(Math.max(receptorFrameToVhh, vhhFrameToReceptor));
  }
  return {
    receptorFrameToVhhPaeMedianAngstrom: median(receptorFrameToVhhPae),
    vhhFrameToReceptorPaeMedianAngstrom: median(vhhFrameToReceptorPae),
    receptorFrameToVhhPaeP90Angstrom: percentile(receptorFrameToVhhPae, 0.9),
    vhhFrameToReceptorPaeP90Angstrom: percentile(vhhFrameToReceptorPae, 0.9),
    interfacePaeMedianAngstrom: median(conservativeContactPairPae),
    interfacePaeP90Angstrom: percentile(conservativeContactPairPae, 0.9),
    lowPaeContactShare: conservativeContactPairPae.length
      ? conservativeContactPairPae.filter((value) => value <= 10).length /
        conservativeContactPairPae.length
      : null,
  };
}

function distance(a: AtomRecord, b: AtomRecord): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function atomElement(atomName: string, explicitElement: string): string {
  if (explicitElement) return explicitElement.toUpperCase();
  const letters = atomName.replace(/[^A-Za-z]/g, "").toUpperCase();
  // Selenium is the only supported protein heavy atom whose blank-element
  // PDB atom name would otherwise be misread as sulfur by first-letter inference.
  if (letters === "SE") return "SE";
  return letters.charAt(0);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareAtomsForAnalysis(left: AtomRecord, right: AtomRecord): number {
  // Parsed atom arrays preserve source-row order for provenance, but scientific
  // accumulation must not depend on an otherwise irrelevant atom-site row
  // permutation. Keep identity ahead of coordinates so rigidly identical
  // structures use the same contact/SASA traversal order even when atom serials
  // or upload row order differ.
  return compareCodeUnits(left.chainId, right.chainId) ||
    left.residueOrder - right.residueOrder ||
    compareCodeUnits(left.residueName, right.residueName) ||
    compareCodeUnits(left.name, right.name) ||
    compareCodeUnits(left.element, right.element) ||
    left.x - right.x ||
    left.y - right.y ||
    left.z - right.z ||
    left.serial - right.serial;
}

function atomsInDeterministicAnalysisOrder(atoms: readonly AtomRecord[]): AtomRecord[] {
  return [...atoms].sort(compareAtomsForAnalysis);
}

function residueLabel(residue: ResidueRecord): string {
  return `${residue.name} ${residue.chainId}:${residue.number}${residue.insertionCode}`;
}

function polarRoles(atom: AtomRecord): { donor: boolean; acceptor: boolean } {
  const key = `${atom.residueName}:${atom.name}`;
  const donor = (
    (atom.name === "N" && atom.residueName !== "PRO") ||
    DONOR_ATOMS.has(key)
  );
  const acceptor = (
    atom.name === "O" || atom.name === "OXT" ||
    ACCEPTOR_ATOMS.has(key)
  );
  return { donor, acceptor };
}

function isPlausibleInterchainDisulfide(a: AtomRecord, b: AtomRecord, d: number): boolean {
  return (
    a.residueName === "CYS" &&
    b.residueName === "CYS" &&
    a.name === "SG" &&
    b.name === "SG" &&
    d >= 1.8 &&
    d <= 2.3
  );
}

function isPotentialPolarPair(a: AtomRecord, b: AtomRecord): boolean {
  const aRoles = polarRoles(a);
  const bRoles = polarRoles(b);
  return (aRoles.donor && bRoles.acceptor) || (bRoles.donor && aRoles.acceptor);
}

function severeOverlap(a: AtomRecord, b: AtomRecord, d: number): number {
  const radiusA = VDW_RADII[a.element] ?? 1.7;
  const radiusB = VDW_RADII[b.element] ?? 1.7;
  return radiusA + radiusB - d;
}

function spatialCellKey(atom: AtomRecord, cellSize: number): string {
  return [
    Math.floor(atom.x / cellSize),
    Math.floor(atom.y / cellSize),
    Math.floor(atom.z / cellSize),
  ].join(":");
}

function roleHint(residueCount: number): ChainSummary["roleHint"] {
  if (residueCount >= 80 && residueCount <= 155) return "VHH-like";
  if (residueCount >= 180) return "receptor-like";
  return "other";
}

function fibonacciSphere(pointCount: number): Array<{ x: number; y: number; z: number }> {
  const points: Array<{ x: number; y: number; z: number }> = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < pointCount; index += 1) {
    const y = 1 - (2 * (index + 0.5)) / pointCount;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = goldenAngle * index;
    points.push({ x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius });
  }
  return points;
}

const SASA_POINTS = fibonacciSphere(SASA_SPHERE_POINTS);

function neighboringAtoms(
  atom: AtomRecord,
  grid: Map<string, AtomRecord[]>,
  cellSize: number,
): AtomRecord[] {
  const cellX = Math.floor(atom.x / cellSize);
  const cellY = Math.floor(atom.y / cellSize);
  const cellZ = Math.floor(atom.z / cellSize);
  const neighbors: AtomRecord[] = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const cell = grid.get(`${cellX + dx}:${cellY + dy}:${cellZ + dz}`);
        if (cell) neighbors.push(...cell);
      }
    }
  }
  return neighbors;
}

function neighboringAtomCount(
  atom: AtomRecord,
  grid: Map<string, AtomRecord[]>,
  cellSize: number,
): number {
  const cellX = Math.floor(atom.x / cellSize);
  const cellY = Math.floor(atom.y / cellSize);
  const cellZ = Math.floor(atom.z / cellSize);
  let count = 0;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        count += grid.get(`${cellX + dx}:${cellY + dy}:${cellZ + dz}`)?.length ?? 0;
      }
    }
  }
  return count;
}

function atomGrid(atoms: AtomRecord[], cellSize: number): Map<string, AtomRecord[]> {
  const grid = new Map<string, AtomRecord[]>();
  for (const atom of atoms) {
    const key = spatialCellKey(atom, cellSize);
    const cell = grid.get(key) ?? [];
    cell.push(atom);
    grid.set(key, cell);
  }
  return grid;
}

function assertSupportedAtomCoordinates(
  atoms: readonly AtomRecord[],
  context: string,
  maximumAbsoluteCoordinate = MAX_ABSOLUTE_COORDINATE_ANGSTROM,
): void {
  for (const atom of atoms) {
    if (
      !Number.isFinite(atom.x) || !Number.isFinite(atom.y) || !Number.isFinite(atom.z) ||
      Math.abs(atom.x) > maximumAbsoluteCoordinate ||
      Math.abs(atom.y) > maximumAbsoluteCoordinate ||
      Math.abs(atom.z) > maximumAbsoluteCoordinate
    ) {
      throw new Error(
        `${context} contains a non-finite coordinate or one outside ` +
        `±${maximumAbsoluteCoordinate.toLocaleString()} Å.`,
      );
    }
  }
}

function surfacePointOccluded(
  x: number,
  y: number,
  z: number,
  neighbors: AtomRecord[],
  excludedAtom: AtomRecord,
): boolean {
  for (const neighbor of neighbors) {
    if (neighbor === excludedAtom) continue;
    const expandedRadius = (VDW_RADII[neighbor.element] ?? 1.7) + SASA_PROBE_RADIUS;
    const dx = x - neighbor.x;
    const dy = y - neighbor.y;
    const dz = z - neighbor.z;
    if (dx * dx + dy * dy + dz * dz < expandedRadius * expandedRadius) return true;
  }
  return false;
}

interface SasaAtomNeighborhood {
  atom: AtomRecord;
  sameChainNeighbors: AtomRecord[];
  oppositeChainNeighbors: AtomRecord[];
}

function possibleSasaOccluders(atom: AtomRecord, candidates: AtomRecord[]): AtomRecord[] {
  const atomRadius = (VDW_RADII[atom.element] ?? 1.7) + SASA_PROBE_RADIUS;
  return candidates.filter((candidate) => {
    if (candidate === atom) return false;
    const candidateRadius = (VDW_RADII[candidate.element] ?? 1.7) + SASA_PROBE_RADIUS;
    const maximumDistance = atomRadius + candidateRadius;
    const dx = atom.x - candidate.x;
    const dy = atom.y - candidate.y;
    const dz = atom.z - candidate.z;
    return dx * dx + dy * dy + dz * dz < maximumDistance * maximumDistance;
  });
}

function sasaNeighborhoods(
  sideAtoms: AtomRecord[],
  sideGrid: Map<string, AtomRecord[]>,
  otherGrid: Map<string, AtomRecord[]>,
  budget: { maximumOcclusionChecks: number },
): SasaAtomNeighborhood[] {
  const neighborhoods: SasaAtomNeighborhood[] = [];
  for (const atom of sideAtoms) {
    const sameChainNeighbors = possibleSasaOccluders(
      atom,
      neighboringAtoms(atom, sideGrid, SASA_GRID_CELL_SIZE),
    );
    const oppositeChainNeighbors = possibleSasaOccluders(
      atom,
      neighboringAtoms(atom, otherGrid, SASA_GRID_CELL_SIZE),
    );
    budget.maximumOcclusionChecks += SASA_SPHERE_POINTS * (
      sameChainNeighbors.length + oppositeChainNeighbors.length
    );
    if (budget.maximumOcclusionChecks > MAX_SASA_SURFACE_POINT_OCCLUSION_CHECKS) {
      throw new Error(
        "The selected chains require more than 250 million worst-case SASA surface-point occlusion checks. " +
        "Reduce the coordinate file to the receptor and VHH chains and try again.",
      );
    }
    // Push only after the cumulative budget passes, so a rejected dense input
    // cannot retain millions of neighbor references in browser memory.
    neighborhoods.push({ atom, sameChainNeighbors, oppositeChainNeighbors });
  }
  return neighborhoods;
}

function buriedAreaForSide(neighborhoods: SasaAtomNeighborhood[]): number {
  let buriedArea = 0;
  for (const { atom, sameChainNeighbors, oppositeChainNeighbors } of neighborhoods) {
    if (!oppositeChainNeighbors.length) continue;
    const expandedRadius = (VDW_RADII[atom.element] ?? 1.7) + SASA_PROBE_RADIUS;
    const areaPerPoint = 4 * Math.PI * expandedRadius * expandedRadius / SASA_SPHERE_POINTS;
    for (const point of SASA_POINTS) {
      const x = atom.x + point.x * expandedRadius;
      const y = atom.y + point.y * expandedRadius;
      const z = atom.z + point.z * expandedRadius;
      if (surfacePointOccluded(x, y, z, sameChainNeighbors, atom)) continue;
      if (surfacePointOccluded(x, y, z, oppositeChainNeighbors, atom)) {
        buriedArea += areaPerPoint;
      }
    }
  }
  return buriedArea;
}

export function calculateBuriedSurfaceArea(
  receptorAtoms: AtomRecord[],
  vhhAtoms: AtomRecord[],
  maximumAbsoluteCoordinate = MAX_ABSOLUTE_COORDINATE_ANGSTROM,
): {
  total: number;
  receptor: number;
  vhh: number;
} {
  if (!receptorAtoms.length || !vhhAtoms.length) return { total: 0, receptor: 0, vhh: 0 };
  assertSupportedAtomCoordinates(receptorAtoms, "The selected receptor", maximumAbsoluteCoordinate);
  assertSupportedAtomCoordinates(vhhAtoms, "The selected VHH", maximumAbsoluteCoordinate);
  const orderedReceptorAtoms = atomsInDeterministicAnalysisOrder(receptorAtoms);
  const orderedVhhAtoms = atomsInDeterministicAnalysisOrder(vhhAtoms);
  const receptorGrid = atomGrid(orderedReceptorAtoms, SASA_GRID_CELL_SIZE);
  const vhhGrid = atomGrid(orderedVhhAtoms, SASA_GRID_CELL_SIZE);

  // Count all bounded-grid candidates before allocating or filtering candidate
  // arrays. This closes the O(n^2) preprocessing path independently of the
  // later surface-point budget.
  let candidateDistanceChecks = 0;
  const preflightSide = (
    atoms: AtomRecord[],
    sameGrid: Map<string, AtomRecord[]>,
    otherGrid: Map<string, AtomRecord[]>,
  ) => {
    for (const atom of atoms) {
      candidateDistanceChecks += neighboringAtomCount(atom, sameGrid, SASA_GRID_CELL_SIZE);
      candidateDistanceChecks += neighboringAtomCount(atom, otherGrid, SASA_GRID_CELL_SIZE);
      if (candidateDistanceChecks > MAX_SASA_CANDIDATE_DISTANCE_CHECKS) {
        throw new Error(
          "The selected chains require more than 25 million SASA candidate-distance checks. " +
          "Reduce the coordinate file to the receptor and VHH chains and try again.",
        );
      }
    }
  };
  preflightSide(orderedReceptorAtoms, receptorGrid, vhhGrid);
  preflightSide(orderedVhhAtoms, vhhGrid, receptorGrid);

  const occlusionBudget = { maximumOcclusionChecks: 0 };
  const receptorNeighborhoods = sasaNeighborhoods(
    orderedReceptorAtoms,
    receptorGrid,
    vhhGrid,
    occlusionBudget,
  );
  const vhhNeighborhoods = sasaNeighborhoods(
    orderedVhhAtoms,
    vhhGrid,
    receptorGrid,
    occlusionBudget,
  );

  const receptor = buriedAreaForSide(receptorNeighborhoods);
  const vhh = buriedAreaForSide(vhhNeighborhoods);
  return { total: receptor + vhh, receptor, vhh };
}

function extractPaePayload(value: unknown): {
  matrix: unknown;
  maxPae: unknown;
  sourceFormat: ParsedPae["sourceFormat"];
} | null {
  if (Array.isArray(value)) {
    if (value.length && Array.isArray(value[0])) {
      return { matrix: value, maxPae: null, sourceFormat: "raw matrix" };
    }
    if (value.length === 1) return extractPaePayload(value[0]);
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.predicted_aligned_error != null) {
    return {
      matrix: record.predicted_aligned_error,
      maxPae: record.max_predicted_aligned_error,
      sourceFormat: "AlphaFold predicted_aligned_error",
    };
  }
  if (record.pae != null) {
    return {
      matrix: record.pae,
      maxPae: record.max_pae ?? record.max_predicted_aligned_error,
      sourceFormat: "pae matrix",
    };
  }
  return null;
}

export function parsePaeJson(
  text: string,
  structure: ParsedStructure,
  filename: string | null = null,
): ParsedPae {
  if (typeof text !== "string" || text.length > MAX_BROWSER_INPUT_TEXT_CHARACTERS) {
    throw new Error("This PAE JSON exceeds the bounded browser parser size limit.");
  }
  preflightPaeJsonStructure(text);
  if (structure.coordinateScope === "deposited-assembly") {
    throw new Error(
      "PAE cannot be mapped onto generated assembly copies because assembly operators do not create model confidence values.",
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new Error("The PAE file is not valid JSON.");
  }
  const payload = extractPaePayload(decoded);
  if (!payload || !Array.isArray(payload.matrix) || !payload.matrix.length) {
    throw new Error("No PAE matrix was found. Expected predicted_aligned_error, pae, or a raw square matrix.");
  }
  const residueCount = payload.matrix.length;
  if (residueCount > MAX_PAE_RESIDUES) {
    throw new Error(`PAE matrices above ${MAX_PAE_RESIDUES.toLocaleString()} residues are not supported.`);
  }
  const expectedResidues = structure.chains.reduce((sum, chain) => sum + chain.residueCount, 0);
  if (residueCount !== expectedResidues) {
    throw new Error(
      `PAE dimension (${residueCount}) does not match the ${expectedResidues} parsed protein residues. ` +
      "Use the score file produced for this exact coordinate model and remove non-protein tokens if necessary.",
    );
  }
  const matrix = new Float32Array(residueCount * residueCount);
  let observedMaximum = 0;
  payload.matrix.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== residueCount) {
      throw new Error(`PAE row ${rowIndex + 1} is not ${residueCount} values long.`);
    }
    row.forEach((value, columnIndex) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error(`PAE value at row ${rowIndex + 1}, column ${columnIndex + 1} is invalid.`);
      }
      const storedValue = Math.fround(value);
      if (!Number.isFinite(storedValue)) {
        throw new Error(
          `PAE value at row ${rowIndex + 1}, column ${columnIndex + 1} exceeds Float32 range.`,
        );
      }
      matrix[rowIndex * residueCount + columnIndex] = storedValue;
      observedMaximum = Math.max(observedMaximum, storedValue);
    });
  });
  if (
    payload.maxPae != null &&
    (
      typeof payload.maxPae !== "number" ||
      !Number.isFinite(payload.maxPae) ||
      payload.maxPae < 0 ||
      !Number.isFinite(Math.fround(payload.maxPae))
    )
  ) {
    throw new Error("The declared maximum PAE is invalid or exceeds Float32 range.");
  }
  const declaredMaximum = typeof payload.maxPae === "number"
    ? Math.fround(payload.maxPae)
    : observedMaximum;
  if (declaredMaximum < observedMaximum) {
    throw new Error("The declared maximum PAE is smaller than a value in the matrix.");
  }
  return {
    matrix,
    residueCount,
    maxPaeAngstrom: declaredMaximum,
    sourceFormat: payload.sourceFormat,
    filename,
  };
}

function scanPdbModelIds(lines: string[]): string[] {
  const modelIds: string[] = [];
  const seenModelIds = new Set<string>();
  let insideModel = false;
  let coordinateOutsideModel = false;
  for (const line of lines) {
    const record = line.slice(0, 6).trim();
    if (record === "MODEL") {
      if (insideModel) {
        throw new Error("This PDB contains a nested MODEL record or a MODEL without a preceding ENDMDL.");
      }
      if (coordinateOutsideModel) {
        throw new Error("This PDB mixes coordinate records outside MODEL blocks with explicit MODEL records.");
      }
      insideModel = true;
      if (modelIds.length >= MAX_PDB_MODELS) {
        throw new Error(`This PDB contains more than ${MAX_PDB_MODELS} coordinate models.`);
      }
      const modelId = line.slice(10, 14).trim() || String(modelIds.length + 1);
      if (seenModelIds.has(modelId)) {
        throw new Error("This PDB contains duplicate MODEL identifiers and cannot be selected unambiguously.");
      }
      seenModelIds.add(modelId);
      modelIds.push(modelId);
      continue;
    }
    if (record === "ENDMDL") {
      if (!insideModel) throw new Error("This PDB contains an ENDMDL record without an open MODEL block.");
      insideModel = false;
      continue;
    }
    if (record === "ATOM" || record === "HETATM") {
      if (modelIds.length && !insideModel) {
        throw new Error("This PDB contains coordinate records outside an explicit MODEL block.");
      }
      if (!insideModel) coordinateOutsideModel = true;
    }
  }
  if (insideModel) throw new Error("This PDB ends before the open MODEL block is closed by ENDMDL.");
  return modelIds;
}

export function parsePdb(text: string, requestedModelId: string | null = null): ParsedStructure {
  if (typeof text !== "string" || text.length > MAX_BROWSER_INPUT_TEXT_CHARACTERS) {
    throw new Error("This PDB coordinate text exceeds the bounded browser parser size limit.");
  }
  if (text.includes("\u0000")) throw new Error("PDB coordinate text cannot contain NUL characters.");
  let lineBreakCount = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue;
    lineBreakCount += 1;
    if (lineBreakCount > MAX_PDB_LINE_BREAKS) {
      throw new Error("This PDB exceeds the bounded line-count limit for a browser audit.");
    }
  }
  const lines = text.split(/\r?\n/);
  const declaredModelIds = scanPdbModelIds(lines);
  if (requestedModelId != null && declaredModelIds.length && !declaredModelIds.includes(requestedModelId)) {
    throw new Error(`Coordinate model “${requestedModelId}” is not defined in this PDB file.`);
  }
  if (requestedModelId != null && !declaredModelIds.length && requestedModelId !== "1") {
    throw new Error(`Coordinate model “${requestedModelId}” is not defined in this single-model PDB file.`);
  }
  const selectedModelId = requestedModelId ?? declaredModelIds[0] ?? "1";
  const atoms: AtomRecord[] = [];
  const residuesByChain = new Map<string, Map<string, ResidueRecord>>();
  const residueOrderByChain = new Map<string, number>();
  let title = "";
  let experimentalMethod: string | null = null;
  const hasModelRecords = declaredModelIds.length > 0;
  let activeModelId: string | null = null;
  let encounteredModelIndex = 0;
  let ignoredAlternateLocations = 0;
  let ignoredHydrogens = 0;
  let duplicateAtomRecords = 0;
  let malformedAtomRecords = 0;
  let unsupportedResidueRecords = 0;
  let zeroOccupancyAtomRecords = 0;
  let residueNameConflicts = 0;
  const atomCandidatesByResidue = new Map<string, Map<string, Array<{
    atom: AtomRecord;
    occupancy: number;
    alternateLocation: string;
  }>>>();
  let candidateAtomCount = 0;
  let uniqueCandidateAtomIdentityCount = 0;

  for (const line of lines) {
    const record = line.slice(0, 6).trim();
    if (record === "TITLE") {
      title += `${line.slice(10).trim()} `;
      continue;
    }
    if (record === "EXPDTA") {
      experimentalMethod = line.slice(10).trim() || null;
      continue;
    }
    if (record === "MODEL") {
      activeModelId = line.slice(10, 14).trim() || declaredModelIds[encounteredModelIndex];
      encounteredModelIndex += 1;
      continue;
    }
    if (record === "ENDMDL") {
      activeModelId = null;
      continue;
    }
    if ((record !== "ATOM" && record !== "HETATM") || (hasModelRecords && activeModelId !== selectedModelId)) continue;

    const alternateLocation = line.charAt(16).trim();
    const atomName = line.slice(12, 16).trim();
    const residueName = line.slice(17, 20).trim().toUpperCase();
    if (!AMINO_ACIDS[residueName]) {
      if (record === "ATOM") unsupportedResidueRecords += 1;
      continue;
    }
    const chainId = line.charAt(21).trim() || "pdb-chain-blank";
    const residueNumber = strictPdbInteger(line.slice(22, 26));
    const insertionCode = line.charAt(26).trim();
    const x = strictPdbCoordinate(line.slice(30, 38));
    const y = strictPdbCoordinate(line.slice(38, 46));
    const z = strictPdbCoordinate(line.slice(46, 54));
    if (residueNumber == null || x == null || y == null || z == null || !atomName) {
      malformedAtomRecords += 1;
      continue;
    }
    const element = atomElement(atomName, line.slice(76, 78).trim());
    if (element === "H" || element === "D") {
      ignoredHydrogens += 1;
      continue;
    }

    const bFactorText = line.slice(60, 66).trim();
    const occupancyText = line.slice(54, 60).trim();
    const bFactorValue = bFactorText ? strictPdbDecimal(bFactorText) : null;
    const occupancyValue = occupancyText ? strictPdbDecimal(occupancyText) : null;
    if (
      (bFactorText && bFactorValue == null) ||
      (occupancyText && occupancyValue == null) ||
      (occupancyValue != null && (occupancyValue < 0 || occupancyValue > 1))
    ) {
      malformedAtomRecords += 1;
      continue;
    }
    const occupancy = occupancyValue ?? 1;
    if (occupancy === 0) {
      zeroOccupancyAtomRecords += 1;
      continue;
    }

    const residueKey = `${chainId}:${residueNumber}:${insertionCode}`;
    if (!residuesByChain.has(chainId)) {
      if (residuesByChain.size >= MAX_PARSED_PROTEIN_CHAINS) {
        throw new Error(`This PDB contains more than ${MAX_PARSED_PROTEIN_CHAINS} parsed protein chains.`);
      }
      residuesByChain.set(chainId, new Map());
    }
    const chainResidues = residuesByChain.get(chainId)!;
    if (!chainResidues.has(residueKey)) {
      const nextOrder = (residueOrderByChain.get(chainId) ?? 0) + 1;
      residueOrderByChain.set(chainId, nextOrder);
      chainResidues.set(residueKey, {
        key: residueKey,
        chainId,
        name: residueName,
        number: residueNumber,
        insertionCode,
        order: nextOrder,
        oneLetter: AMINO_ACIDS[residueName],
        atoms: [],
      });
    } else if (chainResidues.get(residueKey)!.name !== residueName) {
      residueNameConflicts += 1;
      continue;
    }

    const atom: AtomRecord = {
      serial: Number.parseInt(line.slice(6, 11).trim(), 10) || candidateAtomCount + 1,
      name: atomName,
      residueName,
      chainId,
      residueNumber,
      insertionCode,
      residueKey,
      residueOrder: chainResidues.get(residueKey)!.order,
      x,
      y,
      z,
      element,
      bFactor: bFactorValue,
    };
    const residueCandidates = atomCandidatesByResidue.get(residueKey) ?? new Map();
    if (!residueCandidates.has(atomName)) {
      uniqueCandidateAtomIdentityCount += 1;
      if (uniqueCandidateAtomIdentityCount > MAX_PARSED_ATOMS) {
        throw new Error(
          `This file contains more than ${MAX_PARSED_ATOMS.toLocaleString()} unique protein heavy-atom sites. ` +
          "Reduce the coordinate file to the receptor and VHH chains before analysis.",
        );
      }
    }
    const atomCandidates = residueCandidates.get(atomName) ?? [];
    atomCandidates.push({ atom, occupancy, alternateLocation });
    residueCandidates.set(atomName, atomCandidates);
    atomCandidatesByResidue.set(residueKey, residueCandidates);
    candidateAtomCount += 1;
    if (candidateAtomCount > MAX_PARSED_ATOMS * 8) {
      throw new Error(
        "This file contains too many alternate or duplicate protein atom records for a browser audit. " +
        "Reduce the coordinate file to the receptor and VHH chains before analysis.",
      );
    }
  }

  for (const residueMap of residuesByChain.values()) {
    for (const residue of residueMap.values()) {
      const residueCandidates = atomCandidatesByResidue.get(residue.key);
      if (!residueCandidates) continue;
      const deduplicatedByAtom = new Map<string, Map<string, {
        atom: AtomRecord;
        occupancy: number;
        alternateLocation: string;
      }>>();
      const alternateOccupancyTotals = new Map<string, number>();

      for (const [atomName, candidates] of residueCandidates) {
        const bestByAlternate = new Map<string, typeof candidates[number]>();
        const conflictingBestAlternates = new Set<string>();
        for (const candidate of candidates) {
          const existing = bestByAlternate.get(candidate.alternateLocation);
          if (existing) {
            duplicateAtomRecords += 1;
            if (candidate.occupancy > existing.occupancy) {
              bestByAlternate.set(candidate.alternateLocation, candidate);
              conflictingBestAlternates.delete(candidate.alternateLocation);
            } else if (
              candidate.occupancy === existing.occupancy &&
              (
                candidate.atom.x !== existing.atom.x || candidate.atom.y !== existing.atom.y ||
                candidate.atom.z !== existing.atom.z || candidate.atom.element !== existing.atom.element
              )
            ) {
              conflictingBestAlternates.add(candidate.alternateLocation);
            }
          } else {
            bestByAlternate.set(candidate.alternateLocation, candidate);
          }
        }
        if (conflictingBestAlternates.size) {
          throw new Error(
            `The PDB contains conflicting highest-occupancy duplicate records for atom ${atomName} ` +
            `in residue ${residue.name} ${residue.chainId}:${residue.number}${residue.insertionCode}.`,
          );
        }
        deduplicatedByAtom.set(atomName, bestByAlternate);
        for (const [alternateLocation, candidate] of bestByAlternate) {
          if (!alternateLocation) continue;
          alternateOccupancyTotals.set(
            alternateLocation,
            (alternateOccupancyTotals.get(alternateLocation) ?? 0) + candidate.occupancy,
          );
        }
      }

      let preferredAlternate: string | null = null;
      let preferredOccupancy = Number.NEGATIVE_INFINITY;
      for (const [alternateLocation, occupancy] of alternateOccupancyTotals) {
        if (
          occupancy > preferredOccupancy ||
          (
            occupancy === preferredOccupancy &&
            (
              preferredAlternate == null || alternateLocation === "A" ||
              (preferredAlternate !== "A" && compareCodeUnits(alternateLocation, preferredAlternate) < 0)
            )
          )
        ) {
          preferredAlternate = alternateLocation;
          preferredOccupancy = occupancy;
        }
      }

      for (const bestByAlternate of deduplicatedByAtom.values()) {
        const blank = bestByAlternate.get("");
        const selected = blank ?? (preferredAlternate
          ? bestByAlternate.get(preferredAlternate)
          : undefined);
        for (const [alternateLocation] of bestByAlternate) {
          if (alternateLocation && bestByAlternate.get(alternateLocation) !== selected) {
            ignoredAlternateLocations += 1;
          }
        }
        if (!selected) continue;
        atoms.push(selected.atom);
        residue.atoms.push(selected.atom);
        if (atoms.length > MAX_PARSED_ATOMS) {
          throw new Error(
            `This file contains more than ${MAX_PARSED_ATOMS.toLocaleString()} protein heavy atoms. ` +
            "Reduce the coordinate file to the receptor and VHH chains before analysis.",
          );
        }
      }
    }
  }

  assertSupportedAtomCoordinates(atoms, "The selected PDB protein atoms");
  if (!atoms.length) throw new Error("No readable protein coordinate records were found in this PDB.");

  const chains: ChainSummary[] = Array.from(residuesByChain.entries()).map(([id, residueMap]) => {
    const residues = Array.from(residueMap.values());
    return {
      id,
      atomCount: residues.reduce((sum, residue) => sum + residue.atoms.length, 0),
      residueCount: residues.length,
      sequence: residues.map((residue) => residue.oneLetter).join(""),
      backboneCompleteness: residues.filter((residue) => (
        ["N", "CA", "C", "O"].every((name) => residue.atoms.some((atom) => atom.name === name))
      )).length / residues.length,
      roleHint: roleHint(residues.length),
      residues,
    };
  });
  if (chains.length > MAX_PARSED_PROTEIN_CHAINS) {
    throw new Error(`This PDB contains more than ${MAX_PARSED_PROTEIN_CHAINS} parsed protein chains.`);
  }

  return {
    atoms,
    chains,
    title: title.trim() || null,
    experimentalMethod,
    modelCount: hasModelRecords ? declaredModelIds.length : 1,
    ignoredAlternateLocations,
    ignoredHydrogens,
    duplicateAtomRecords,
    malformedAtomRecords,
    unsupportedResidueRecords,
    zeroOccupancyAtomRecords,
    residueNameConflicts,
    sourceFormat: "pdb",
    coordinateScope: "as-supplied",
    selectedModelId,
    availableModelIds: declaredModelIds.length ? declaredModelIds : ["1"],
    availableAssemblies: [],
    selectedAssembly: null,
  };
}

function coarseInterfaceResidues(
  chainA: ChainSummary,
  chainB: ChainSummary,
  comparisonBudget: { remaining: number },
  chainBGrid?: Map<string, AtomRecord[]>,
): number | null {
  const cutoff = 5;
  const grid = chainBGrid ?? atomGrid(
    chainB.residues.flatMap((residue) => residue.atoms),
    cutoff,
  );
  const pairs = new Set<string>();
  for (const residue of chainA.residues) {
    for (const atom of residue.atoms) {
      const candidates = neighboringAtoms(atom, grid, cutoff);
      if (candidates.length > comparisonBudget.remaining) return null;
      comparisonBudget.remaining -= candidates.length;
      for (const candidate of candidates) {
        if (distance(atom, candidate) <= cutoff) {
          pairs.add(`${residue.key}\u0000${candidate.residueKey}`);
        }
      }
    }
  }
  return pairs.size;
}

function chainBounds(chain: ChainSummary): {
  minimum: [number, number, number];
  maximum: [number, number, number];
} {
  const minimum: [number, number, number] = [Infinity, Infinity, Infinity];
  const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const residue of chain.residues) {
    for (const atom of residue.atoms) {
      minimum[0] = Math.min(minimum[0], atom.x);
      minimum[1] = Math.min(minimum[1], atom.y);
      minimum[2] = Math.min(minimum[2], atom.z);
      maximum[0] = Math.max(maximum[0], atom.x);
      maximum[1] = Math.max(maximum[1], atom.y);
      maximum[2] = Math.max(maximum[2], atom.z);
    }
  }
  return { minimum, maximum };
}

function boundsDistanceSquared(
  left: ReturnType<typeof chainBounds>,
  right: ReturnType<typeof chainBounds>,
): number {
  let result = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const separation = left.maximum[axis] < right.minimum[axis]
      ? right.minimum[axis] - left.maximum[axis]
      : right.maximum[axis] < left.minimum[axis]
        ? left.minimum[axis] - right.maximum[axis]
        : 0;
    result += separation * separation;
  }
  return result;
}

export function suggestChains(structure: ParsedStructure): {
  receptorChain: string | null;
  vhhChain: string | null;
} {
  const vhhCandidates = structure.chains
    .filter((chain) => chain.roleHint === "VHH-like")
    .sort((a, b) => (
      Math.abs(a.residueCount - 120) - Math.abs(b.residueCount - 120) ||
      compareCodeUnits(a.id, b.id)
    ));
  const receptorCandidates = structure.chains
    .filter((chain) => chain.residueCount >= 160)
    .sort((a, b) => b.residueCount - a.residueCount || compareCodeUnits(a.id, b.id));
  const sizeOnlyFallback = () => {
    const vhhChain = vhhCandidates[0]?.id ?? null;
    const fallbackReceptor = structure.chains
      .filter((chain) => chain.id !== vhhChain)
      .sort((a, b) => b.residueCount - a.residueCount || compareCodeUnits(a.id, b.id))[0];
    return { receptorChain: fallbackReceptor?.id ?? null, vhhChain };
  };
  const bounds = new Map(structure.chains.map((chain) => [chain.id, chainBounds(chain)]));
  const possibleInterfaces: Array<{
    receptor: ChainSummary;
    vhh: ChainSummary;
    distanceSquared: number;
  }> = [];
  for (const vhh of vhhCandidates) {
    for (const receptor of receptorCandidates) {
      if (receptor.id === vhh.id) continue;
      const distanceSquared = boundsDistanceSquared(bounds.get(receptor.id)!, bounds.get(vhh.id)!);
      if (distanceSquared > 25) continue;
      possibleInterfaces.push({ receptor, vhh, distanceSquared });
      if (possibleInterfaces.length > MAX_CHAIN_SUGGESTION_PAIR_SCANS) return sizeOnlyFallback();
    }
  }
  possibleInterfaces.sort((a, b) => (
    a.distanceSquared - b.distanceSquared ||
    Math.abs(a.vhh.residueCount - 120) - Math.abs(b.vhh.residueCount - 120) ||
    b.receptor.residueCount - a.receptor.residueCount ||
    compareCodeUnits(a.receptor.id, b.receptor.id) ||
    compareCodeUnits(a.vhh.id, b.vhh.id)
  ));
  const vhhGrids = new Map<string, Map<string, AtomRecord[]>>();
  const comparisonBudget = { remaining: MAX_CHAIN_SUGGESTION_ATOM_COMPARISONS };
  const rankedPairs: Array<{
    receptor: ChainSummary;
    vhh: ChainSummary;
    interfaceResidues: number;
  }> = [];
  for (const { receptor, vhh } of possibleInterfaces) {
    let grid = vhhGrids.get(vhh.id);
    if (!grid) {
      grid = atomGrid(vhh.residues.flatMap((residue) => residue.atoms), 5);
      vhhGrids.set(vhh.id, grid);
    }
    const interfaceResidues = coarseInterfaceResidues(receptor, vhh, comparisonBudget, grid);
    if (interfaceResidues == null) return sizeOnlyFallback();
    if (interfaceResidues > 0) rankedPairs.push({ receptor, vhh, interfaceResidues });
  }
  rankedPairs.sort((a, b) => (
    b.interfaceResidues - a.interfaceResidues ||
    Math.abs(a.vhh.residueCount - 120) - Math.abs(b.vhh.residueCount - 120) ||
    b.receptor.residueCount - a.receptor.residueCount ||
    compareCodeUnits(a.receptor.id, b.receptor.id) ||
    compareCodeUnits(a.vhh.id, b.vhh.id)
  ));
  if (rankedPairs.length) {
    return {
      receptorChain: rankedPairs[0].receptor.id,
      vhhChain: rankedPairs[0].vhh.id,
    };
  }
  return sizeOnlyFallback();
}

function residueConfidence(residue: ResidueRecord): number | null {
  const alphaCarbon = residue.atoms.find((atom) => atom.name === "CA");
  const value = alphaCarbon?.bFactor ?? median(
    residue.atoms.flatMap((atom) => atom.bFactor == null ? [] : [atom.bFactor]),
  );
  return value != null && value >= 0 && value <= 100 ? value : null;
}

function isSaltBridgeAtom(a: AtomRecord, b: AtomRecord): boolean {
  const aKey = `${a.residueName}:${a.name}`;
  const bKey = `${b.residueName}:${b.name}`;
  return (
    (ACIDIC_ATOMS.has(aKey) && BASIC_ATOMS.has(bKey)) ||
    (BASIC_ATOMS.has(aKey) && ACIDIC_ATOMS.has(bKey))
  );
}

function evidenceRationale(audit: Omit<InterfaceAudit, "rationale" | "auditAttestation">): string {
  if (audit.contactPairCount === 0) {
    return "No receptor–VHH residue contacts were detected at the configured cutoff.";
  }
  const footprint = `${audit.contactPairCount} contacting residue pairs across ` +
    `${audit.receptorInterfaceResidues} receptor and ${audit.vhhInterfaceResidues} VHH residues`;
  if (audit.evidenceLevel === "supported") {
    return `The selected pose has ${footprint} with no material severe-overlap burden. ` +
      "This is internally coherent coordinate geometry—not evidence of biological binding.";
  }
  if (audit.evidenceLevel === "limited") {
    return `The selected pose has ${footprint}, but its footprint or steric quality is weak. ` +
      "Treat it as low-priority geometry until the pose is reviewed.";
  }
  return `The selected pose has ${footprint}, but the coordinate evidence is not consistently strong. ` +
    "Review the footprint, overlaps, and coordinate confidence before prioritization.";
}

function assertSasaChainIdentity(source: ChainSummary, sasa: ChainSummary): void {
  if (
    source.sequence !== sasa.sequence || source.residueCount !== sasa.residueCount ||
    source.atomCount !== sasa.atomCount || source.residues.length !== sasa.residues.length
  ) {
    throw new Error(`The SASA-frame copy of chain ${source.id} does not match the audited chain sequence and size.`);
  }
  for (let residueIndex = 0; residueIndex < source.residues.length; residueIndex += 1) {
    const left = source.residues[residueIndex];
    const right = sasa.residues[residueIndex];
    if (
      left.key !== right.key || left.chainId !== right.chainId || left.name !== right.name || left.number !== right.number ||
      left.insertionCode !== right.insertionCode || left.order !== right.order ||
      left.oneLetter !== right.oneLetter || left.atoms.length !== right.atoms.length
    ) {
      throw new Error(`The SASA-frame copy of chain ${source.id} changes residue identity or atom cardinality.`);
    }
    for (let atomIndex = 0; atomIndex < left.atoms.length; atomIndex += 1) {
      const leftAtom = left.atoms[atomIndex];
      const rightAtom = right.atoms[atomIndex];
      if (
        leftAtom.name !== rightAtom.name || leftAtom.residueName !== rightAtom.residueName ||
        leftAtom.chainId !== rightAtom.chainId || leftAtom.residueNumber !== rightAtom.residueNumber ||
        leftAtom.insertionCode !== rightAtom.insertionCode || leftAtom.residueKey !== rightAtom.residueKey ||
        leftAtom.residueOrder !== rightAtom.residueOrder || leftAtom.element !== rightAtom.element ||
        leftAtom.serial !== rightAtom.serial
      ) {
        throw new Error(`The SASA-frame copy of chain ${source.id} changes selected atom identity or order.`);
      }
    }
  }
}

export function analyzeInterface(
  structure: ParsedStructure,
  receptorChainId: string,
  vhhChainId: string,
  confidenceMode: ConfidenceMode,
  pae: ParsedPae | null = null,
  paeOrderConfirmed = false,
  sasaStructure: ParsedStructure | null = null,
): InterfaceAudit {
  if (confidenceMode !== "none" && confidenceMode !== "plddt") {
    throw new Error("Interface confidence mode must be none or plddt.");
  }
  if (receptorChainId === vhhChainId) throw new Error("Choose two different chains for the receptor and VHH.");
  const receptor = structure.chains.find((chain) => chain.id === receptorChainId);
  const vhh = structure.chains.find((chain) => chain.id === vhhChainId);
  if (!receptor || !vhh) throw new Error("The selected chain assignment is not present in this structure.");
  const sasaFrame = sasaStructure ?? structure;
  let sasaOrientation: SasaOrientation = "source-coordinate-frame";
  let sasaFrameAlgorithm = "source-coordinates-as-supplied-v1";
  if (sasaFrame !== structure) {
    if (!canonicalSasaFrameMatches(
      structure,
      sasaFrame,
      receptorChainId,
      vhhChainId,
    )) {
      throw new Error(
        "The alternate SASA frame is not the verified deterministic ConfoVHH canonical frame for this source structure and selected chains.",
      );
    }
    sasaOrientation = "deterministic-proper-signed-frame";
    sasaFrameAlgorithm = CANONICAL_SASA_FRAME_ALGORITHM;
  }
  const sasaReceptor = sasaFrame.chains.find((chain) => chain.id === receptorChainId);
  const sasaVhh = sasaFrame.chains.find((chain) => chain.id === vhhChainId);
  if (!sasaReceptor || !sasaVhh) {
    throw new Error("The SASA-frame structure does not contain the selected receptor and VHH chains.");
  }
  assertSasaChainIdentity(receptor, sasaReceptor);
  assertSasaChainIdentity(vhh, sasaVhh);
  if (pae && paeOrderConfirmed !== true) {
    throw new Error(
      "Confirm both the AlphaFold row-aligned/column-evaluated convention and the parsed protein-residue order before using PAE.",
    );
  }
  if (!pae && paeOrderConfirmed !== false) {
    throw new Error("PAE residue-order confirmation cannot be supplied without a PAE matrix.");
  }

  const CONTACT_CUTOFF = 4.5;
  const POLAR_CUTOFF = 3.5;
  const SALT_CUTOFF = 4.0;
  const SEVERE_OVERLAP = 0.6;
  const receptorAtoms = atomsInDeterministicAnalysisOrder(
    receptor.residues.flatMap((residue) => residue.atoms),
  );
  const vhhAtoms = atomsInDeterministicAnalysisOrder(
    vhh.residues.flatMap((residue) => residue.atoms),
  );
  assertSupportedAtomCoordinates(receptorAtoms, "The selected receptor");
  assertSupportedAtomCoordinates(vhhAtoms, "The selected VHH");
  const receptorResidueMap = new Map(receptor.residues.map((residue) => [residue.key, residue]));
  const vhhResidueMap = new Map(vhh.residues.map((residue) => [residue.key, residue]));
  const vhhNumbering = numberVhhSequence(vhh.sequence);
  const vhhNumberingByKey = new Map(vhh.residues.map((residue, index) => [
    residue.key,
    vhhNumbering.residues[index] ?? null,
  ]));
  const pairMap = new Map<string, {
    minimumDistance: number;
    polar: boolean;
    salt: boolean;
    clash: boolean;
    disulfide: boolean;
    maximumOverlap: number;
  }>();
  let atomContactCount = 0;
  let polarContactProxyCount = 0;
  let saltBridgeProxyCount = 0;
  let severeClashCount = 0;
  let possibleInterchainDisulfideCount = 0;

  const vhhSpatialGrid = new Map<string, AtomRecord[]>();
  for (const atom of vhhAtoms) {
    const key = spatialCellKey(atom, CONTACT_CUTOFF);
    const cell = vhhSpatialGrid.get(key) ?? [];
    cell.push(atom);
    vhhSpatialGrid.set(key, cell);
  }

  let candidateAtomPairs = 0;
  for (const receptorAtom of receptorAtoms) {
    const cellX = Math.floor(receptorAtom.x / CONTACT_CUTOFF);
    const cellY = Math.floor(receptorAtom.y / CONTACT_CUTOFF);
    const cellZ = Math.floor(receptorAtom.z / CONTACT_CUTOFF);
    const candidates: AtomRecord[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const cell = vhhSpatialGrid.get(`${cellX + dx}:${cellY + dy}:${cellZ + dz}`);
          if (cell) candidates.push(...cell);
        }
      }
    }
    candidateAtomPairs += candidates.length;
    if (candidateAtomPairs > MAX_CANDIDATE_ATOM_PAIRS) {
      throw new Error(
        "The selected chains create too many local atom comparisons for a browser audit. " +
        "Reduce the file to the receptor and VHH chains and try again.",
      );
    }
    for (const vhhAtom of candidates) {
      const d = distance(receptorAtom, vhhAtom);
      if (d > CONTACT_CUTOFF) continue;
      atomContactCount += 1;
      const pairKey = `${receptorAtom.residueKey}\u0000${vhhAtom.residueKey}`;
      let current = pairMap.get(pairKey);
      if (!current) {
        if (pairMap.size >= MAX_INTERFACE_RESIDUE_PAIRS) {
          throw new Error(
            `The selected chains create more than ${MAX_INTERFACE_RESIDUE_PAIRS.toLocaleString()} ` +
            "unique contacting residue pairs. Reduce the coordinate file to the intended receptor and VHH chains.",
          );
        }
        current = {
          minimumDistance: Number.POSITIVE_INFINITY,
          polar: false,
          salt: false,
          clash: false,
          disulfide: false,
          maximumOverlap: Number.NEGATIVE_INFINITY,
        };
        pairMap.set(pairKey, current);
      }
      current.minimumDistance = Math.min(current.minimumDistance, d);
      if (
        d >= 2.4 &&
        d <= POLAR_CUTOFF &&
        isPotentialPolarPair(receptorAtom, vhhAtom)
      ) {
        polarContactProxyCount += 1;
        current.polar = true;
      }
      if (d >= 2.4 && d <= SALT_CUTOFF && isSaltBridgeAtom(receptorAtom, vhhAtom)) {
        saltBridgeProxyCount += 1;
        current.salt = true;
      }
      const overlap = severeOverlap(receptorAtom, vhhAtom, d);
      if (isPlausibleInterchainDisulfide(receptorAtom, vhhAtom, d)) {
        if (!current.disulfide) possibleInterchainDisulfideCount += 1;
        current.disulfide = true;
      } else {
        current.maximumOverlap = Math.max(current.maximumOverlap, overlap);
        if (overlap >= SEVERE_OVERLAP && !current.clash) {
          severeClashCount += 1;
          current.clash = true;
        }
      }
    }
  }

  const contacts: ContactPair[] = Array.from(pairMap.entries()).map(([pairKey, values]) => {
    const [receptorKey, vhhKey] = pairKey.split("\u0000");
    const receptorResidue = receptorResidueMap.get(receptorKey)!;
    const vhhResidue = vhhResidueMap.get(vhhKey)!;
    const numbering = vhhNumberingByKey.get(vhhKey);
    const region: ContactPair["vhhRegion"] = numbering?.imgtPosition
      ? numbering.region
      : "Unnumbered";
    const contactTypes: string[] = [];
    if (values.clash) contactTypes.push("severe vdW overlap");
    if (values.disulfide) contactTypes.push("possible interchain disulfide");
    if (values.salt) contactTypes.push("salt-bridge proxy");
    if (values.polar) contactTypes.push("potential polar contact");
    if (!contactTypes.length) contactTypes.push("close contact");
    return {
      receptorResidue: residueLabel(receptorResidue),
      vhhResidue: residueLabel(vhhResidue),
      receptorResidueOrder: receptorResidue.order,
      vhhResidueOrder: vhhResidue.order,
      receptorResidueName: receptorResidue.name,
      vhhResidueName: vhhResidue.name,
      vhhRegion: region,
      vhhImgtPosition: numbering?.imgtPosition ?? null,
      minimumDistance: values.minimumDistance,
      contactTypes,
      receptorConfidence: confidenceMode === "plddt" ? residueConfidence(receptorResidue) : null,
      vhhConfidence: confidenceMode === "plddt" ? residueConfidence(vhhResidue) : null,
    };
  }).sort((a, b) => a.minimumDistance - b.minimumDistance);

  const receptorInterfaceKeys = Array.from(new Set(
    Array.from(pairMap.keys()).map((key) => key.split("\u0000")[0]),
  ));
  const vhhInterfaceKeys = Array.from(new Set(
    Array.from(pairMap.keys()).map((key) => key.split("\u0000")[1]),
  ));
  let maximumOverlapAngstrom = 0;
  for (const values of pairMap.values()) {
    maximumOverlapAngstrom = Math.max(maximumOverlapAngstrom, values.maximumOverlap);
  }
  const cdrContacts = contacts.filter(
    (contact) => contact.vhhRegion === "CDR1-IMGT" ||
      contact.vhhRegion === "CDR2-IMGT" ||
      contact.vhhRegion === "CDR3-IMGT",
  ).length;
  const cdr3Contacts = contacts.filter(
    (contact) => contact.vhhRegion === "CDR3-IMGT",
  ).length;
  const paratopeProxyShare = contacts.length && vhhNumbering.status === "numbered"
    ? cdrContacts / contacts.length
    : null;
  const cdr3ProxyShare = contacts.length && vhhNumbering.status === "numbered"
    ? cdr3Contacts / contacts.length
    : null;
  const interfaceConfidenceValues = confidenceMode === "plddt"
    ? [
        ...receptorInterfaceKeys.map((key) => residueConfidence(receptorResidueMap.get(key)!)),
        ...vhhInterfaceKeys.map((key) => residueConfidence(vhhResidueMap.get(key)!)),
      ]
    : [];
  const interfaceConfidenceCoverage = confidenceMode === "plddt" && interfaceConfidenceValues.length
    ? interfaceConfidenceValues.filter((value) => value != null).length / interfaceConfidenceValues.length
    : null;
  let interfaceConfidence = confidenceMode === "plddt"
    ? median(interfaceConfidenceValues.flatMap((value) => value == null ? [] : [value]))
    : null;
  const buriedArea = calculateBuriedSurfaceArea(
    sasaReceptor.residues.flatMap((residue) => residue.atoms),
    sasaVhh.residues.flatMap((residue) => residue.atoms),
    sasaOrientation === "deterministic-proper-signed-frame"
      ? MAX_CANONICAL_COORDINATE_ANGSTROM
      : MAX_ABSOLUTE_COORDINATE_ANGSTROM,
  );

  const {
    receptorFrameToVhhPaeMedianAngstrom,
    vhhFrameToReceptorPaeMedianAngstrom,
    receptorFrameToVhhPaeP90Angstrom,
    vhhFrameToReceptorPaeP90Angstrom,
    interfacePaeMedianAngstrom,
    interfacePaeP90Angstrom,
    lowPaeContactShare,
  } = summarizeContactPae(
    structure,
    receptorChainId,
    vhhChainId,
    contacts,
    pae,
  );

  const coordinateCompleteness = Math.min(
    receptor.backboneCompleteness,
    vhh.backboneCompleteness,
  );
  const plddtValuesInvalid = confidenceMode === "plddt" && [
    ...receptorInterfaceKeys.map((key) => receptorResidueMap.get(key)!),
    ...vhhInterfaceKeys.map((key) => vhhResidueMap.get(key)!),
  ].some((residue) => residue.atoms.some((atom) => (
    atom.bFactor != null && (atom.bFactor < 0 || atom.bFactor > 100)
  )));
  if (plddtValuesInvalid) interfaceConfidence = null;

  let evidenceLevel: EvidenceLevel;
  if (!contacts.length) evidenceLevel = "not-assessable";
  else if (
    contacts.length < 8 ||
    receptorInterfaceKeys.length < 3 ||
    vhhInterfaceKeys.length < 3 ||
    coordinateCompleteness < 0.7 ||
    maximumOverlapAngstrom >= 1.5 ||
    severeClashCount >= Math.max(5, Math.ceil(contacts.length * 0.25))
  ) evidenceLevel = "limited";
  else if (
    contacts.length >= 18 &&
    receptorInterfaceKeys.length >= 7 &&
    vhhInterfaceKeys.length >= 6 &&
    severeClashCount === 0 &&
    (
      confidenceMode !== "plddt" ||
      (!plddtValuesInvalid && interfaceConfidence != null && interfaceConfidence >= 70 &&
        (interfaceConfidenceCoverage ?? 0) >= 0.9)
    )
  ) evidenceLevel = "supported";
  else evidenceLevel = "mixed";

  const findings: AuditFinding[] = [
    {
      label: "Chain and coordinate plausibility",
      level: coordinateCompleteness >= 0.9 && receptor.residueCount >= 160 &&
        vhh.residueCount >= 80 && vhh.residueCount <= 155
        ? "supported" : coordinateCompleteness < 0.7 ? "limited" : "review",
      evidence: `Receptor ${receptor.id}: ${receptor.residueCount} residues, ${Math.round(receptor.backboneCompleteness * 100)}% complete backbone. ` +
        `VHH ${vhh.id}: ${vhh.residueCount} residues, ${Math.round(vhh.backboneCompleteness * 100)}% complete backbone.`,
      action: "Confirm biological chain identities and review missing backbone atoms or receptor fusion constructs.",
    },
    {
      label: "IMGT V-domain annotation",
      level: vhhNumbering.status === "numbered" && (vhhNumbering.confidence ?? 0) >= 0.7
        ? "supported" : vhhNumbering.status === "numbered" ? "review" : "unavailable",
      evidence: vhhNumbering.status === "numbered"
        ? `${IMGT_NUMBERING_ENGINE} recognized an IGH V-domain with alignment confidence ${vhhNumbering.confidence?.toFixed(2)}; ` +
          `complete seven-region number/segment agreement passed; CDR lengths ${vhhNumbering.cdrLengths?.cdr1}/${vhhNumbering.cdrLengths?.cdr2}/${vhhNumbering.cdrLengths?.cdr3}.`
        : `IMGT annotation unavailable: ${vhhNumbering.error ?? "the V-domain was not recognized"}`,
      action: "Sequence-aligned IMGT regions map the paratope footprint but do not establish antigen binding.",
    },
    {
      label: "Contact breadth",
      level: contacts.length >= 18 && vhhInterfaceKeys.length >= 6
        ? "supported" : contacts.length ? "review" : "limited",
      evidence: `${contacts.length} residue pairs across ${receptorInterfaceKeys.length} receptor and ${vhhInterfaceKeys.length} VHH residues.`,
      action: contacts.length ? "Inspect whether the footprint occupies the intended epitope." : "Check chain assignment or modeled pose.",
    },
    {
      label: "Buried solvent-accessible area",
      level: buriedArea.total > 0 ? "review" : "unavailable",
      evidence: buriedArea.total > 0
        ? `Protein-heavy-atom ΔSASA ${buriedArea.total.toFixed(0)} Å²; ½ΔSASA interface-area convention ${(buriedArea.total / 2).toFixed(0)} Å² ` +
          `(${buriedArea.receptor.toFixed(0)} Å² receptor; ${buriedArea.vhh.toFixed(0)} Å² VHH).` +
          (contacts.length ? "" : " Probe-expanded surfaces overlap despite no residue pair within the 4.5 Å contact cutoff.")
        : "No cross-chain burial was detected.",
      action: "Use buried area as a descriptive footprint metric; it is not an affinity or binding-energy estimate.",
    },
    {
      label: "Cross-chain PAE",
      level: interfacePaeMedianAngstrom == null ? "unavailable" : "review",
      evidence: interfacePaeMedianAngstrom == null
        ? "No matching PAE JSON was attached; relative-placement confidence was not assessed."
        : `Median contact-pair PAE: receptor frame → VHH ${receptorFrameToVhhPaeMedianAngstrom?.toFixed(1)} Å; ` +
          `VHH frame → receptor ${vhhFrameToReceptorPaeMedianAngstrom?.toFixed(1)} Å. Conservative summary ${interfacePaeMedianAngstrom.toFixed(1)} Å.`,
      action: "Use the continuous directional values; no universal GPCR–VHH acceptance cutoff is applied.",
    },
    {
      label: "Potential polar and electrostatic contacts",
      level: polarContactProxyCount >= 3 || saltBridgeProxyCount >= 1
        ? "review" : contacts.length ? "review" : "unavailable",
      evidence: `${polarContactProxyCount} donor–acceptor distance matches and ${saltBridgeProxyCount} acidic/basic atom-pair proximities.`,
      action: "These distance-only candidates do not affect the evidence label; protonation and angles are not modeled.",
    },
    {
      label: "Steric quality",
      level: severeClashCount === 0 ? "supported"
        : maximumOverlapAngstrom >= 1.5 || severeClashCount > 2 ? "limited" : "review",
      evidence: `${severeClashCount} contacting residue pairs contain a noncovalent heavy-atom van der Waals overlap of at least ${SEVERE_OVERLAP.toFixed(1)} Å; ` +
        `maximum overlap is ${maximumOverlapAngstrom.toFixed(2)} Å. ${possibleInterchainDisulfideCount} plausible Cys–Cys crosslink(s) were exempted.`,
      action: severeClashCount ? "Review the overlapping atoms before prioritization." : "No severe cross-chain van der Waals overlaps were detected.",
    },
    {
      label: "Reported coordinate confidence",
      level: confidenceMode !== "plddt" || interfaceConfidence == null || plddtValuesInvalid ? "unavailable"
        : (interfaceConfidenceCoverage ?? 0) < 0.9 ? "limited"
        : interfaceConfidence >= 80 ? "supported"
        : interfaceConfidence >= 70 ? "review" : "limited",
      evidence: confidenceMode !== "plddt"
        ? "B-factor interpretation is off; no coordinate-confidence claim is made."
        : interfaceConfidence == null || plddtValuesInvalid
          ? "The B-factor field is missing values or contains values outside the valid 0–100 pLDDT range."
          : `Median interface pLDDT from the B-factor field: ${interfaceConfidence.toFixed(1)} ` +
            `across ${Math.round((interfaceConfidenceCoverage ?? 0) * 100)}% of interface residues.`,
      action: "Only enable pLDDT interpretation when the file format is known. Confidence does not establish binding.",
    },
  ];

  const warnings = [
    "Favorable coordinate geometry is not evidence of affinity, specificity, kinetics, signaling, or biological binding.",
    "Evidence bands use transparent screening heuristics and are not calibrated probabilities.",
    "Cross-chain PAE is reported only when a dimension-matched square JSON matrix is supplied and its residue order is explicitly confirmed; it is never inferred from coordinates.",
    "Membrane orientation and active/inactive state preference are not assessed.",
    `IMGT regions use sequence alignment from ${IMGT_NUMBERING_ENGINE}, not ANARCI's germline HMMs; unrecognized chains are left unnumbered.`,
    "IMGT positions are mapped to the observed coordinate sequence; unresolved residues absent from coordinate atom records can make experimental-structure mapping incomplete.",
    `Buried area uses a ${SASA_SPHERE_POINTS}-point Shrake–Rupley approximation with a ${SASA_PROBE_RADIUS.toFixed(1)} Å probe and protein heavy atoms only.`,
  ];
  if (sasaOrientation === "source-coordinate-frame") {
    warnings.push(
      "Finite-grid ΔSASA was evaluated in the source coordinate orientation; a whole-complex rotation can cause small discretization differences. Ensemble and paired workflows use ConfoVHH's deterministic canonical SASA frame instead.",
    );
  }
  if (structure.selectedAssembly) {
    warnings.push(
      `Depositor/PDB-supplied assembly ${structure.selectedAssembly.id} was reconstructed from its declared operators. ` +
      "This does not establish a physiological assembly, and no additional crystallographic symmetry was generated.",
    );
  } else if (structure.sourceFormat === "mmcif" && structure.availableAssemblies.length > 0) {
    warnings.push(
      `The mmCIF atom-site coordinates were analyzed as supplied; ${structure.availableAssemblies.length} deposited assembly annotation(s) were available but not selected.`,
    );
  } else {
    warnings.push("Coordinates were analyzed as supplied; deposited-assembly and crystallographic-symmetry transforms were not generated.");
  }
  if (structure.chains.length > 2) {
    warnings.push(`Only chains ${receptorChainId} and ${vhhChainId} were audited; ${structure.chains.length - 2} other protein chain(s) were not evaluated.`);
  }
  if (structure.modelCount > 1) {
    warnings.push(`This file contains ${structure.modelCount} models; only selected model ID ${structure.selectedModelId} was analyzed.`);
  }
  if (structure.ignoredAlternateLocations > 0) {
    warnings.push(`${structure.ignoredAlternateLocations} non-primary alternate-location atoms were ignored.`);
  }
  if (structure.duplicateAtomRecords > 0) {
    warnings.push(`${structure.duplicateAtomRecords} duplicate atom record(s) were ignored.`);
  }
  if (structure.malformedAtomRecords > 0 || structure.unsupportedResidueRecords > 0 ||
    structure.zeroOccupancyAtomRecords > 0 || structure.residueNameConflicts > 0) {
    warnings.push(
      `Parser exclusions: ${structure.malformedAtomRecords} malformed, ${structure.unsupportedResidueRecords} unsupported polymer, ` +
      `${structure.zeroOccupancyAtomRecords} zero-occupancy, ${structure.residueNameConflicts} residue-name conflict record(s).`,
    );
  }
  if (plddtValuesInvalid) {
    warnings.push("pLDDT interpretation was disabled for the summary because interface B-factor values fell outside 0–100.");
  }

  const withoutRationale: Omit<InterfaceAudit, "rationale" | "auditAttestation"> = {
    version: CONFOVHH_VERSION,
    confidenceMode,
    receptorChain: receptorChainId,
    vhhChain: vhhChainId,
    evidenceLevel,
    contactPairCount: contacts.length,
    atomContactCount,
    receptorInterfaceResidues: receptorInterfaceKeys.length,
    vhhInterfaceResidues: vhhInterfaceKeys.length,
    polarContactProxyCount,
    saltBridgeProxyCount,
    severeClashCount,
    possibleInterchainDisulfideCount,
    maximumOverlapAngstrom,
    paratopeProxyShare,
    cdr3ProxyShare,
    interfaceConfidence,
    interfaceConfidenceCoverage,
    deltaSasaAngstrom2: buriedArea.total,
    receptorBuriedSurfaceAreaAngstrom2: buriedArea.receptor,
    vhhBuriedSurfaceAreaAngstrom2: buriedArea.vhh,
    halfDeltaSasaInterfaceAreaAngstrom2: buriedArea.total / 2,
    interfacePaeMedianAngstrom,
    interfacePaeP90Angstrom,
    receptorFrameToVhhPaeMedianAngstrom,
    vhhFrameToReceptorPaeMedianAngstrom,
    receptorFrameToVhhPaeP90Angstrom,
    vhhFrameToReceptorPaeP90Angstrom,
    lowPaeContactShare,
    paeFilename: pae?.filename ?? null,
    paeOrderConfirmed: Boolean(pae && paeOrderConfirmed),
    vhhNumbering: {
      status: vhhNumbering.status,
      policyVersion: vhhNumbering.policyVersion,
      scheme: "IMGT",
      engine: vhhNumbering.engine,
      minimumEngineConfidence: vhhNumbering.minimumEngineConfidence,
      confidence: vhhNumbering.confidence,
      completeImgtRegionCoverage: vhhNumbering.completeImgtRegionCoverage,
      numberingSegmentationAgreement: vhhNumbering.numberingSegmentationAgreement,
      cdrLengths: vhhNumbering.cdrLengths,
      error: vhhNumbering.error,
    },
    contacts,
    receptorInterfaceKeys,
    vhhInterfaceKeys,
    findings,
    warnings,
    methods: {
      residueContactCutoffAngstrom: CONTACT_CUTOFF,
      polarProxyCutoffAngstrom: POLAR_CUTOFF,
      saltBridgeProxyCutoffAngstrom: SALT_CUTOFF,
      severeClashOverlapAngstrom: SEVERE_OVERLAP,
      sasaProbeRadiusAngstrom: SASA_PROBE_RADIUS,
      sasaSpherePoints: SASA_SPHERE_POINTS,
      sasaMaximumCandidateDistanceChecks: MAX_SASA_CANDIDATE_DISTANCE_CHECKS,
      sasaMaximumOcclusionChecks: MAX_SASA_SURFACE_POINT_OCCLUSION_CHECKS,
      sasaRadii: SASA_RADII_METHOD_DESCRIPTION,
      sasaOrientation,
      sasaFrameAlgorithm,
      cdrAnnotation: CDR_ANNOTATION_METHOD_DESCRIPTION,
      paeSummary: PAE_SUMMARY_METHOD_DESCRIPTION,
    },
  };
  const result = { ...withoutRationale, rationale: evidenceRationale(withoutRationale) };
  const inputFingerprint = auditInputFingerprint(
    structure,
    receptorChainId,
    vhhChainId,
    confidenceMode,
    pae,
    paeOrderConfirmed,
    sasaOrientation,
    sasaFrameAlgorithm,
  );
  return {
    ...result,
    auditAttestation: {
      schemaVersion: "1.0.0",
      inputFingerprint,
      resultFingerprint: auditResultFingerprint(result),
    },
  };
}
