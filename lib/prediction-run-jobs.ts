import {
  CONFOVHH_VERSION,
  type ParsedPae,
  type ParsedStructure,
} from "./confovhh.ts";
import {
  executeEnsembleAuditJob,
  executeParseCoordinateJob,
  executeParsePaeJob,
  executeSingleAuditJob,
  type RejectedEnsemblePose,
} from "./audit-jobs.ts";
import {
  createSingleAuditExportReport,
  type SingleAuditExportReport,
} from "./audit-export.ts";
import {
  matchEnsembleChains,
  validatePoseEnsembleExportSummary,
  type PoseEnsembleSummary,
} from "./pose-ensemble.ts";
import {
  MAX_PREDICTION_RUN_COORDINATE_BYTES,
  MAX_PREDICTION_RUN_COORDINATE_TOTAL_BYTES,
  MAX_PREDICTION_RUN_JSON_BYTES,
  MAX_PREDICTION_RUN_PAE_TOTAL_BYTES,
  MAX_PREDICTION_RUN_POSES,
  normalizePredictionRunPath,
  predictionRunManifestForExport,
  type PredictionProvider,
  type PredictionRunManifest,
  type PredictionRunPoseRecord,
} from "./prediction-run.ts";
import { validateImportedSingleAuditReport } from "./research-workspace.ts";
import {
  evaluateAnnotatedFootprint,
  validateNormalizedTopologyAnnotation,
  type AnnotatedFootprintResult,
  type NormalizedTopologyAnnotation,
} from "./topology-annotation.ts";

export const PREDICTION_RUN_AUDIT_SCHEMA_VERSION = "1.0.0" as const;
export const PREDICTION_RUN_DOSSIER_SCHEMA_VERSION = "1.0.0" as const;
export const PREDICTION_RUN_PRODUCT_RELEASE = "0.7.0" as const;
export const PREDICTION_RUN_CLAIM_BOUNDARY =
  "ConfoVHH audits coordinate plausibility, per-pose source PAE over coordinate-defined contacts, and recurrence within the selected uploaded run. It does not establish pose correctness, binding, affinity, specificity, stability, signaling, membrane compatibility, receptor-state identity, or conformational selectivity.";
export const PER_POSE_PAE_INTERPRETATION =
  "PAE is source-model confidence context for this exact prediction sample. Directional summaries are calculated over this pose's coordinate-defined receptor–VHH contact pairs and do not rank binding or correctness across poses. The at-or-below-10-angstrom share is a descriptive ConfoVHH reporting rule, not a calibrated cutoff or native predictor score.";
/**
 * Some producer JSON serializes matrix entries at two decimal places while
 * retaining a higher-precision max_pae scalar. Accept only the resulting
 * sub-centiångström disagreement and normalize upward to the observed matrix
 * maximum before passing the payload to the strict canonical PAE parser.
 */
export const DECLARED_PAE_MAX_SERIALIZATION_TOLERANCE_ANGSTROM = 0.01;

export interface PredictionRunAuditSourceFile {
  id: string;
  path: string;
  filename: string;
  bytes: number;
  sha256: string;
  text: string;
}

export interface PredictionRunAuditPoseSource {
  id: string;
  provider: PredictionProvider;
  poseKey: string | null;
  variant: string | null;
  associationBasis: PredictionRunPoseRecord["associationBasis"];
  coordinate: PredictionRunAuditSourceFile;
  pae: PredictionRunAuditSourceFile | null;
}

export interface PredictionRunAuditJob {
  poses: PredictionRunAuditPoseSource[];
  referenceCoordinateFileId: string;
  referenceReceptorChain: string;
  referenceVhhChain: string;
  paeAssociationsAndOrderConfirmed: boolean;
  topologyAnnotation: NormalizedTopologyAnnotation | null;
}

export interface NativePaeMappingProvenance {
  basis:
    | "token-residue-metadata-verified"
    | "researcher-confirmed-token-chain-and-within-chain-order"
    | "researcher-confirmed-complete-protein-order";
  originalTokenCount: number;
  proteinResidueCount: number;
  sourceIndexMap: number[];
}

export type PerPosePaeStatus = "audited" | "not-provided" | "rejected";

export interface PredictionRunPoseAudit {
  id: string;
  isReference: boolean;
  provider: PredictionProvider;
  poseKey: string | null;
  variant: string | null;
  coordinate: {
    fileId: string;
    path: string;
    filename: string;
    sha256: string;
    bytes: number;
  };
  chains: {
    receptor: string;
    vhh: string;
    mappingBasis: "researcher-confirmed-reference" | "unique-exact-sequence-propagation";
  };
  singleAudit: SingleAuditExportReport;
  pae: {
    status: PerPosePaeStatus;
    fileId: string | null;
    path: string | null;
    filename: string | null;
    sha256: string | null;
    bytes: number | null;
    associationBasis: PredictionRunPoseRecord["associationBasis"];
    orderConfirmedByResearcher: boolean;
    mapping: NativePaeMappingProvenance | null;
    sourceFormat: ParsedPae["sourceFormat"] | null;
    maxPaeAngstrom: number | null;
    receptorAlignedVhhEvaluatedMedianAngstrom: number | null;
    vhhAlignedReceptorEvaluatedMedianAngstrom: number | null;
    receptorAlignedVhhEvaluatedP90Angstrom: number | null;
    vhhAlignedReceptorEvaluatedP90Angstrom: number | null;
    conservativeLargerDirectionMedianAngstrom: number | null;
    conservativeLargerDirectionP90Angstrom: number | null;
    contactPairShareAtOrBelow10Angstrom: number | null;
    reason: string | null;
    interpretation: typeof PER_POSE_PAE_INTERPRETATION;
  };
  topology: AnnotatedFootprintResult | null;
}

export interface PredictionRunAuditResult {
  schemaVersion: typeof PREDICTION_RUN_AUDIT_SCHEMA_VERSION;
  productRelease: typeof PREDICTION_RUN_PRODUCT_RELEASE;
  engineVersion: string;
  referenceCoordinateFileId: string;
  coordinateEnsemble: PoseEnsembleSummary | null;
  coordinateRejected: RejectedEnsemblePose[];
  poseAudits: PredictionRunPoseAudit[];
  counts: {
    selected: number;
    coordinateAccepted: number;
    coordinateRejected: number;
    paeAudited: number;
    paeNotProvided: number;
    paeRejected: number;
    topologyEvaluated: number;
  };
  claimBoundary: typeof PREDICTION_RUN_CLAIM_BOUNDARY;
}

export interface PredictionRunProgress {
  phase: "coordinate-recurrence" | "per-pose-audit";
  completed: number;
  total: number;
  filename: string;
}

export interface PredictionRunDossier {
  schemaVersion: typeof PREDICTION_RUN_DOSSIER_SCHEMA_VERSION;
  productRelease: typeof PREDICTION_RUN_PRODUCT_RELEASE;
  engineVersion: string;
  generatedAt: string;
  manifest: ReturnType<typeof predictionRunManifestForExport>;
  result: PredictionRunAuditResult;
  topologyAnnotation: Omit<NormalizedTopologyAnnotation, "receptorSequence"> | null;
  privacy: {
    rawCoordinateTextIncluded: false;
    paeMatricesIncluded: false;
    sourceFilesUploadedByConfoVHH: false;
  };
  claimBoundary: typeof PREDICTION_RUN_CLAIM_BOUNDARY;
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireExactKeys(value: object, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(codeUnitCompare);
  const wanted = [...expected].sort(codeUnitCompare);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains missing or unsupported fields.`);
  }
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireSha256(value: string, label: string): string {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} requires a valid SHA-256 digest.`);
  return value.toLowerCase();
}

function validateSource(file: PredictionRunAuditSourceFile, kind: "coordinate" | "pae"): void {
  if (file == null || typeof file !== "object") throw new Error(`Every ${kind} source must be an object.`);
  requireExactKeys(file, ["id", "path", "filename", "bytes", "sha256", "text"], `Prediction-run ${kind} source`);
  for (const [label, value] of [["identifier", file.id], ["path", file.path], ["filename", file.filename]] as const) {
    if (typeof value !== "string" || !value || value.length > 1_024 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) {
      throw new Error(`Every ${kind} source ${label} must be bounded visible text.`);
    }
  }
  const normalizedPath = normalizePredictionRunPath(file.path);
  if (normalizedPath !== file.path || file.filename !== normalizedPath.split("/").at(-1)) {
    throw new Error(`Every ${kind} source filename must match its normalized relative path.`);
  }
  if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > (
    kind === "coordinate" ? MAX_PREDICTION_RUN_COORDINATE_BYTES : MAX_PREDICTION_RUN_JSON_BYTES
  )) throw new Error(`${file.filename}: ${kind} source byte count exceeds the supported limit.`);
  if (file.sha256 !== requireSha256(file.sha256, `${file.filename} digest`)) {
    throw new Error(`${file.filename}: ${kind} source digest must use canonical lowercase hexadecimal.`);
  }
  if (typeof file.text !== "string") throw new Error(`${file.filename}: decoded ${kind} text is required.`);
  const encodedBytes = new TextEncoder().encode(file.text).byteLength;
  if (encodedBytes !== file.bytes) {
    throw new Error(`${file.filename}: declared byte count does not match the decoded UTF-8 source.`);
  }
}

function checkedSquareMatrix(value: unknown): { matrix: unknown[][]; maximum: number } {
  if (!Array.isArray(value) || !value.length || value.length > 1_500) {
    throw new Error("PAE must be a non-empty square matrix with at most 1,500 tokens.");
  }
  const dimension = value.length;
  let maximum = 0;
  for (let rowIndex = 0; rowIndex < dimension; rowIndex += 1) {
    const row = value[rowIndex];
    if (!Array.isArray(row) || row.length !== dimension) {
      throw new Error(`PAE row ${rowIndex + 1} is not ${dimension} values long.`);
    }
    for (let columnIndex = 0; columnIndex < dimension; columnIndex += 1) {
      const entry = row[columnIndex];
      if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0 || entry > 3.4028234663852886e38) {
        throw new Error(`PAE value at row ${rowIndex + 1}, column ${columnIndex + 1} is invalid.`);
      }
      maximum = Math.max(maximum, entry);
    }
  }
  return { matrix: value as unknown[][], maximum };
}

function chainAliases(chain: ParsedStructure["chains"][number]): Set<string> {
  return new Set([chain.id, chain.labelAsymId, chain.authAsymId].filter((value): value is string => Boolean(value)));
}

function residueAliases(residue: ParsedStructure["chains"][number]["residues"][number]): Set<string> {
  return new Set([
    `${residue.number}${residue.insertionCode}`,
    residue.labelSequenceId == null ? null : String(residue.labelSequenceId),
    residue.authSequenceId == null ? null : `${residue.authSequenceId}${residue.insertionCode}`,
  ].filter((value): value is string => value != null));
}

function tokenMetadataIndexMap(
  structure: ParsedStructure,
  tokenChainIds: unknown,
  tokenResidueIds: unknown,
  tokenCount: number,
): { indices: number[]; basis: NativePaeMappingProvenance["basis"] | null } {
  if (tokenChainIds == null) {
    return { indices: [], basis: null };
  }
  if (!Array.isArray(tokenChainIds) || tokenChainIds.length !== tokenCount || tokenChainIds.some((value) => typeof value !== "string")) {
    throw new Error("PAE token_chain_ids must contain one string for every source token.");
  }
  if (tokenResidueIds != null && (
    !Array.isArray(tokenResidueIds) || tokenResidueIds.length !== tokenCount ||
    tokenResidueIds.some((value) => typeof value !== "string" && typeof value !== "number")
  )) throw new Error("PAE token_res_ids must contain one string or number for every source token when present.");

  const expected = structure.chains.flatMap((chain) => chain.residues.map((residue) => ({ chain, residue })));
  if (tokenResidueIds == null) {
    if (tokenCount !== expected.length) {
      throw new Error("Non-protein or extra PAE tokens require token_res_ids for an exact protein-residue mapping.");
    }
    expected.forEach(({ chain }, index) => {
      if (!chainAliases(chain).has(tokenChainIds[index] as string)) {
        throw new Error("PAE token chain order conflicts with the complete parsed protein-residue order.");
      }
    });
    return {
      indices: expected.map((_, index) => index),
      basis: "researcher-confirmed-token-chain-and-within-chain-order",
    };
  }

  const used = new Set<number>();
  const indices = expected.map(({ chain, residue }) => {
    const chainIds = chainAliases(chain);
    const residueIds = residueAliases(residue);
    const candidates: number[] = [];
    for (let index = 0; index < tokenCount; index += 1) {
      if (
        chainIds.has(tokenChainIds[index] as string) &&
        residueIds.has(String((tokenResidueIds as Array<string | number>)[index]))
      ) candidates.push(index);
    }
    if (candidates.length !== 1 || used.has(candidates[0])) {
      throw new Error(
        `PAE token metadata does not map uniquely to parsed protein residue ${chain.id}:${residue.number}${residue.insertionCode}.`,
      );
    }
    used.add(candidates[0]);
    return candidates[0];
  });
  const parsedProteinAliases = new Set(expected.flatMap(({ chain }) => [...chainAliases(chain)]));
  for (let index = 0; index < tokenCount; index += 1) {
    if (!used.has(index) && parsedProteinAliases.has(tokenChainIds[index] as string)) {
      throw new Error("PAE token metadata contains an unused token assigned to a parsed protein chain.");
    }
  }
  return { indices, basis: "token-residue-metadata-verified" };
}

export function extractNativePredictionPae(
  source: PredictionRunAuditSourceFile,
  structure: ParsedStructure,
): { pae: ParsedPae; mapping: NativePaeMappingProvenance } {
  validateSource(source, "pae");
  if (source.text.length > MAX_PREDICTION_RUN_JSON_BYTES) {
    throw new Error("PAE JSON exceeds the 16 MiB decoded-text limit.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(source.text);
  } catch {
    throw new Error("PAE source is not valid JSON.");
  }
  if (Array.isArray(decoded) && decoded.length === 1 && decoded[0] != null && typeof decoded[0] === "object") {
    decoded = decoded[0];
  }
  let matrixValue: unknown;
  let declaredMaximum: unknown = null;
  let tokenChainIds: unknown = null;
  let tokenResidueIds: unknown = null;
  let sourceFormat: "predicted_aligned_error" | "pae" | "raw";
  if (Array.isArray(decoded)) {
    matrixValue = decoded;
    sourceFormat = "raw";
  } else if (decoded != null && typeof decoded === "object") {
    const record = decoded as Record<string, unknown>;
    const matrixFields = ["predicted_aligned_error", "pae"].filter((key) => record[key] != null);
    if (matrixFields.length !== 1) {
      throw new Error("PAE JSON must contain exactly one supported matrix field: pae or predicted_aligned_error.");
    }
    sourceFormat = matrixFields[0] as "predicted_aligned_error" | "pae";
    matrixValue = record[sourceFormat];
    declaredMaximum = record.max_pae ?? record.max_predicted_aligned_error ?? null;
    tokenChainIds = record.token_chain_ids ?? null;
    tokenResidueIds = record.token_res_ids ?? record.token_residue_ids ?? null;
  } else {
    throw new Error("PAE JSON must be an object or raw square matrix.");
  }
  const checked = checkedSquareMatrix(matrixValue);
  if (declaredMaximum != null && (
    typeof declaredMaximum !== "number" || !Number.isFinite(declaredMaximum) ||
    declaredMaximum < checked.maximum - DECLARED_PAE_MAX_SERIALIZATION_TOLERANCE_ANGSTROM ||
    declaredMaximum > 3.4028234663852886e38
  )) throw new Error("Declared maximum PAE is invalid or smaller than an observed matrix value.");
  const normalizedMaximum = declaredMaximum == null
    ? checked.maximum
    : Math.max(declaredMaximum as number, checked.maximum);

  const expectedResidueCount = structure.chains.reduce((sum, chain) => sum + chain.residueCount, 0);
  const metadataMap = tokenMetadataIndexMap(
    structure,
    tokenChainIds,
    tokenResidueIds,
    checked.matrix.length,
  );
  let sourceIndexMap: number[];
  let basis: NativePaeMappingProvenance["basis"];
  if (metadataMap.basis != null) {
    sourceIndexMap = metadataMap.indices;
    basis = metadataMap.basis;
  } else {
    if (checked.matrix.length !== expectedResidueCount) {
      throw new Error(
        `PAE dimension (${checked.matrix.length}) does not match ${expectedResidueCount} parsed protein residues, and no exact token mapping metadata is available.`,
      );
    }
    sourceIndexMap = Array.from({ length: expectedResidueCount }, (_, index) => index);
    basis = "researcher-confirmed-complete-protein-order";
  }
  const proteinMatrix = sourceIndexMap.map((sourceRow) => (
    sourceIndexMap.map((sourceColumn) => checked.matrix[sourceRow][sourceColumn])
  ));
  const minimalPayload = sourceFormat === "predicted_aligned_error"
    ? {
        predicted_aligned_error: proteinMatrix,
        max_predicted_aligned_error: normalizedMaximum,
      }
    : sourceFormat === "pae"
      ? {
          pae: proteinMatrix,
          max_pae: normalizedMaximum,
        }
      : proteinMatrix;
  const pae = executeParsePaeJob({
    filename: source.filename,
    text: JSON.stringify(minimalPayload),
    structure,
  });
  return {
    pae,
    mapping: {
      basis,
      originalTokenCount: checked.matrix.length,
      proteinResidueCount: expectedResidueCount,
      sourceIndexMap,
    },
  };
}

function receptorInterfaceOrders(
  structure: ParsedStructure,
  receptorChain: string,
  report: SingleAuditExportReport,
): number[] {
  const receptor = structure.chains.find((chain) => chain.id === receptorChain);
  if (!receptor) throw new Error("The selected receptor chain is absent while evaluating supplied topology labels.");
  const orderByKey = new Map(receptor.residues.map((residue) => [residue.key, residue.order]));
  return report.audit.receptorInterfaceKeys.map((key) => {
    const order = orderByKey.get(key);
    if (order == null) throw new Error("An audited receptor contact is absent from the selected receptor chain.");
    return order;
  }).sort((left, right) => left - right);
}

function createPaeRecord(
  source: PredictionRunAuditPoseSource,
  report: SingleAuditExportReport,
  status: PerPosePaeStatus,
  mapping: NativePaeMappingProvenance | null,
  pae: ParsedPae | null,
  confirmed: boolean,
  reason: string | null,
): PredictionRunPoseAudit["pae"] {
  return {
    status,
    fileId: source.pae?.id ?? null,
    path: source.pae?.path ?? null,
    filename: source.pae?.filename ?? null,
    sha256: source.pae?.sha256 ?? null,
    bytes: source.pae?.bytes ?? null,
    associationBasis: source.associationBasis,
    orderConfirmedByResearcher: Boolean(source.pae && confirmed),
    mapping,
    sourceFormat: pae?.sourceFormat ?? null,
    maxPaeAngstrom: pae?.maxPaeAngstrom ?? null,
    receptorAlignedVhhEvaluatedMedianAngstrom: report.audit.receptorFrameToVhhPaeMedianAngstrom,
    vhhAlignedReceptorEvaluatedMedianAngstrom: report.audit.vhhFrameToReceptorPaeMedianAngstrom,
    receptorAlignedVhhEvaluatedP90Angstrom: report.audit.receptorFrameToVhhPaeP90Angstrom,
    vhhAlignedReceptorEvaluatedP90Angstrom: report.audit.vhhFrameToReceptorPaeP90Angstrom,
    conservativeLargerDirectionMedianAngstrom: report.audit.interfacePaeMedianAngstrom,
    conservativeLargerDirectionP90Angstrom: report.audit.interfacePaeP90Angstrom,
    contactPairShareAtOrBelow10Angstrom: report.audit.lowPaeContactShare,
    reason,
    interpretation: PER_POSE_PAE_INTERPRETATION,
  };
}

function sourceByDigest(sources: readonly PredictionRunAuditPoseSource[]): Map<string, PredictionRunAuditPoseSource> {
  const result = new Map<string, PredictionRunAuditPoseSource>();
  for (const source of sources) {
    const digest = requireSha256(source.coordinate.sha256, `${source.coordinate.filename} digest`);
    if (result.has(digest)) {
      throw new Error("Two selected coordinate files have identical SHA-256 digests and cannot both contribute to recurrence.");
    }
    result.set(digest, source);
  }
  return result;
}

const PREDICTION_PROVIDERS = new Set<PredictionProvider>([
  "alphafold-server",
  "alphafold-local",
  "colabfold",
  "boltz",
  "unknown",
]);
const READY_ASSOCIATION_BASES = new Set<PredictionRunPoseRecord["associationBasis"]>([
  "exact-native-key",
  "explicit",
  "none",
]);

function requireBoundedVisibleText(value: unknown, label: string, maximum = 1_024): asserts value is string {
  if (
    typeof value !== "string" || !value || value.length > maximum ||
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
  ) throw new Error(`${label} must be bounded visible text.`);
}

function validateNullableRunLabel(value: unknown, label: string): void {
  if (value === null) return;
  requireBoundedVisibleText(value, label, 4_096);
}

export function executePredictionRunAuditJob(
  job: PredictionRunAuditJob,
  onProgress: (progress: PredictionRunProgress) => void = () => {},
): PredictionRunAuditResult {
  if (job == null || typeof job !== "object" || Array.isArray(job) || !Array.isArray(job.poses)) {
    throw new Error("Prediction-run audit job is invalid.");
  }
  requireExactKeys(job, [
    "poses", "referenceCoordinateFileId", "referenceReceptorChain", "referenceVhhChain",
    "paeAssociationsAndOrderConfirmed", "topologyAnnotation",
  ], "Prediction-run audit job");
  if (job.poses.length < 1 || job.poses.length > MAX_PREDICTION_RUN_POSES) {
    throw new Error(`Prediction-run audit requires 1–${MAX_PREDICTION_RUN_POSES} selected poses.`);
  }
  requireBoundedVisibleText(job.referenceCoordinateFileId, "Prediction-run reference coordinate identifier");
  requireBoundedVisibleText(job.referenceReceptorChain, "Prediction-run reference receptor chain", 256);
  requireBoundedVisibleText(job.referenceVhhChain, "Prediction-run reference VHH chain", 256);
  if (job.referenceReceptorChain === job.referenceVhhChain) {
    throw new Error("Prediction-run reference receptor and VHH chains must be distinct.");
  }
  if (typeof job.paeAssociationsAndOrderConfirmed !== "boolean") {
    throw new Error("Prediction-run PAE confirmation state must be boolean.");
  }
  if (job.topologyAnnotation !== null && (
    typeof job.topologyAnnotation !== "object" || Array.isArray(job.topologyAnnotation)
  )) throw new Error("Prediction-run topology annotation must be an object or null.");
  const poseIds = new Set<string>();
  const fileIds = new Set<string>();
  let coordinateBytes = 0;
  let paeBytes = 0;
  for (const source of job.poses) {
    if (source == null || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("Every prediction-run pose must be an object.");
    }
    requireExactKeys(source, [
      "id", "provider", "poseKey", "variant", "associationBasis", "coordinate", "pae",
    ], "Prediction-run pose source");
    requireBoundedVisibleText(source.id, "Prediction-run pose identifier");
    if (poseIds.has(source.id)) {
      throw new Error("Every prediction-run pose requires a unique non-empty identifier.");
    }
    poseIds.add(source.id);
    if (!PREDICTION_PROVIDERS.has(source.provider)) {
      throw new Error(`${source.id}: prediction provider is unsupported.`);
    }
    validateNullableRunLabel(source.poseKey, `${source.id}: pose key`);
    validateNullableRunLabel(source.variant, `${source.id}: pose variant`);
    if (!READY_ASSOCIATION_BASES.has(source.associationBasis)) {
      throw new Error(`${source.id}: association basis is not eligible for analysis.`);
    }
    if (source.pae !== null && (
      typeof source.pae !== "object" || Array.isArray(source.pae)
    )) throw new Error(`${source.id}: PAE source must be an object or null.`);
    validateSource(source.coordinate, "coordinate");
    if (fileIds.has(source.coordinate.id)) {
      throw new Error("Every selected coordinate source requires unique file ownership.");
    }
    fileIds.add(source.coordinate.id);
    coordinateBytes += source.coordinate.bytes;
    if (source.pae !== null) {
      if (source.associationBasis === "none") {
        throw new Error(`${source.id}: an attached PAE requires an exact or explicit per-pose association.`);
      }
      validateSource(source.pae, "pae");
      if (fileIds.has(source.pae.id)) {
        throw new Error("Every selected PAE source requires unique per-pose ownership.");
      }
      fileIds.add(source.pae.id);
      paeBytes += source.pae.bytes;
    } else if (source.associationBasis !== "none") {
      throw new Error(`${source.id}: a coordinate-only pose must use the none association basis.`);
    }
  }
  if (coordinateBytes > MAX_PREDICTION_RUN_COORDINATE_TOTAL_BYTES) {
    throw new Error("Selected prediction-run coordinates exceed the 48 MiB aggregate limit.");
  }
  if (paeBytes > MAX_PREDICTION_RUN_PAE_TOTAL_BYTES) {
    throw new Error("Selected prediction-run PAE JSON files exceed the 48 MiB aggregate limit.");
  }
  if (job.poses.some((source) => source.pae != null) && !job.paeAssociationsAndOrderConfirmed) {
    throw new Error(
      "Confirm that every selected PAE file belongs to its listed coordinate sample and both axes follow the complete parsed protein-residue order.",
    );
  }
  const reference = job.poses.find((source) => source.coordinate.id === job.referenceCoordinateFileId);
  if (!reference) throw new Error("The explicit reference coordinate is not included in this prediction run.");
  const digestSources = sourceByDigest(job.poses);
  const referenceStructure = executeParseCoordinateJob({
    filename: reference.coordinate.filename,
    text: reference.coordinate.text,
  });
  if (referenceStructure.modelCount > 1) {
    throw new Error("Reference coordinate contains multiple models. Select one coordinate model per run file.");
  }
  const referenceReceptor = referenceStructure.chains.find((chain) => chain.id === job.referenceReceptorChain);
  const referenceVhh = referenceStructure.chains.find((chain) => chain.id === job.referenceVhhChain);
  if (!referenceReceptor || !referenceVhh || referenceReceptor.id === referenceVhh.id) {
    throw new Error("The user-confirmed reference receptor and VHH chains are missing or not distinct.");
  }
  if (job.topologyAnnotation != null) {
    validateNormalizedTopologyAnnotation(job.topologyAnnotation, {
      receptorChain: referenceReceptor.id,
      receptorSequence: referenceReceptor.sequence,
    });
  }

  onProgress({ phase: "coordinate-recurrence", completed: 0, total: job.poses.length, filename: reference.coordinate.filename });
  let coordinateEnsemble: PoseEnsembleSummary | null = null;
  let coordinateRejected: RejectedEnsemblePose[] = [];
  if (job.poses.length > 1) {
    const candidates = job.poses
      .filter((source) => source !== reference)
      .map((source) => ({
        filename: source.coordinate.filename,
        text: source.coordinate.text,
        sha256: source.coordinate.sha256,
        bytes: source.coordinate.bytes,
      }));
    const ensembleJob = {
      reference: {
        filename: reference.coordinate.filename,
        sha256: reference.coordinate.sha256,
        bytes: reference.coordinate.bytes,
        structure: referenceStructure,
        receptorChain: referenceReceptor.id,
        vhhChain: referenceVhh.id,
      },
      candidates,
    };
    try {
      const ensemble = executeEnsembleAuditJob(ensembleJob, (completed, total, filename) => onProgress({
        phase: "coordinate-recurrence",
        completed: Math.min(total + 1, completed + 1),
        total: total + 1,
        filename,
      }));
      coordinateEnsemble = ensemble.summary;
      coordinateRejected = ensemble.rejected;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Coordinate recurrence failed.";
      if (!/^No additional compatible pose could be audited\./u.test(message)) throw caught;
      // The frozen ensemble executor correctly fails when every non-reference
      // member is rejected. A run workspace still needs a visible rejection
      // ledger, so recover each candidate's already-bounded reason without
      // changing the engine or treating it as coordinate-only success.
      coordinateRejected = candidates.map((candidate) => {
        try {
          executeEnsembleAuditJob({ ...ensembleJob, candidates: [candidate] });
          throw new Error("Candidate unexpectedly passed isolated recurrence recovery.");
        } catch (candidateError) {
          const candidateMessage = candidateError instanceof Error
            ? candidateError.message
            : "Candidate coordinate could not be audited.";
          const prefix = `No additional compatible pose could be audited. ${candidate.filename}: `;
          const reason = candidateMessage.startsWith(prefix)
            ? candidateMessage.slice(prefix.length)
            : candidateMessage;
          return {
            filename: candidate.filename,
            sha256: candidate.sha256,
            bytes: candidate.bytes,
            reason,
          };
        }
      });
      onProgress({
        phase: "coordinate-recurrence",
        completed: job.poses.length,
        total: job.poses.length,
        filename: reference.coordinate.filename,
      });
    }
  } else {
    onProgress({ phase: "coordinate-recurrence", completed: 1, total: 1, filename: reference.coordinate.filename });
  }

  const acceptedDigests = coordinateEnsemble == null
    ? new Set([reference.coordinate.sha256.toLowerCase()])
    : new Set(coordinateEnsemble.poses.flatMap((pose) => pose.sha256 == null ? [] : [pose.sha256.toLowerCase()]));
  const acceptedSources = [reference, ...job.poses.filter((source) => source !== reference)]
    .filter((source) => acceptedDigests.has(source.coordinate.sha256.toLowerCase()));
  const poseAudits: PredictionRunPoseAudit[] = [];
  for (let index = 0; index < acceptedSources.length; index += 1) {
    const source = acceptedSources[index];
    onProgress({
      phase: "per-pose-audit",
      completed: index,
      total: acceptedSources.length,
      filename: source.coordinate.filename,
    });
    const structure = source === reference
      ? referenceStructure
      : executeParseCoordinateJob({ filename: source.coordinate.filename, text: source.coordinate.text });
    const chains = source === reference
      ? { receptorChain: referenceReceptor.id, vhhChain: referenceVhh.id }
      : matchEnsembleChains(structure, referenceReceptor.sequence, referenceVhh.sequence);
    let pae: ParsedPae | null = null;
    let mapping: NativePaeMappingProvenance | null = null;
    let paeStatus: PerPosePaeStatus = source.pae == null ? "not-provided" : "audited";
    let paeFailure: string | null = null;
    if (source.pae != null) {
      try {
        const extracted = extractNativePredictionPae(source.pae, structure);
        pae = extracted.pae;
        mapping = extracted.mapping;
      } catch (caught) {
        paeStatus = "rejected";
        paeFailure = caught instanceof Error ? caught.message : "PAE attachment failed bounded validation.";
      }
    }
    const audit = executeSingleAuditJob({
      structure,
      receptorChain: chains.receptorChain,
      vhhChain: chains.vhhChain,
      confidenceMode: "none",
      pae: paeStatus === "audited" ? pae : null,
      paeOrderConfirmed: paeStatus === "audited",
    });
    const report = createSingleAuditExportReport({
      filename: source.coordinate.filename,
      coordinateSha256: source.coordinate.sha256,
      coordinateBytes: source.coordinate.bytes,
      structure,
      receptorChain: chains.receptorChain,
      vhhChain: chains.vhhChain,
      chainIdentityConfirmed: true,
      pae: paeStatus === "audited" ? pae : null,
      paeSha256: paeStatus === "audited" ? source.pae!.sha256 : null,
      paeOrderConfirmed: paeStatus === "audited",
      audit,
    });
    const topology = job.topologyAnnotation == null
      ? null
      : evaluateAnnotatedFootprint(
          job.topologyAnnotation,
          receptorInterfaceOrders(structure, chains.receptorChain, report),
        );
    poseAudits.push({
      id: source.id,
      isReference: source === reference,
      provider: source.provider,
      poseKey: source.poseKey,
      variant: source.variant,
      coordinate: {
        fileId: source.coordinate.id,
        path: source.coordinate.path,
        filename: source.coordinate.filename,
        sha256: source.coordinate.sha256.toLowerCase(),
        bytes: source.coordinate.bytes,
      },
      chains: {
        receptor: chains.receptorChain,
        vhh: chains.vhhChain,
        mappingBasis: source === reference
          ? "researcher-confirmed-reference"
          : "unique-exact-sequence-propagation",
      },
      singleAudit: report,
      pae: createPaeRecord(
        source,
        report,
        paeStatus,
        mapping,
        paeStatus === "audited" ? pae : null,
        job.paeAssociationsAndOrderConfirmed,
        paeFailure,
      ),
      topology,
    });
    onProgress({
      phase: "per-pose-audit",
      completed: index + 1,
      total: acceptedSources.length,
      filename: source.coordinate.filename,
    });
  }
  // Assert that every accepted ensemble digest resolved to exactly one bounded source.
  for (const digest of acceptedDigests) {
    if (!digestSources.has(digest)) throw new Error("An accepted coordinate result cannot be joined back to its source digest.");
  }
  poseAudits.sort((left, right) => (
    Number(right.isReference) - Number(left.isReference) ||
    codeUnitCompare(left.coordinate.sha256, right.coordinate.sha256) ||
    codeUnitCompare(left.coordinate.path, right.coordinate.path)
  ));
  return {
    schemaVersion: PREDICTION_RUN_AUDIT_SCHEMA_VERSION,
    productRelease: PREDICTION_RUN_PRODUCT_RELEASE,
    engineVersion: CONFOVHH_VERSION,
    referenceCoordinateFileId: job.referenceCoordinateFileId,
    coordinateEnsemble,
    coordinateRejected,
    poseAudits,
    counts: {
      selected: job.poses.length,
      coordinateAccepted: poseAudits.length,
      coordinateRejected: coordinateRejected.length,
      paeAudited: poseAudits.filter((pose) => pose.pae.status === "audited").length,
      paeNotProvided: poseAudits.filter((pose) => pose.pae.status === "not-provided").length,
      paeRejected: poseAudits.filter((pose) => pose.pae.status === "rejected").length,
      topologyEvaluated: poseAudits.filter((pose) => pose.topology != null).length,
    },
    claimBoundary: PREDICTION_RUN_CLAIM_BOUNDARY,
  };
}

function requireIsoTimestamp(value: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value
  ) throw new Error("Prediction-run dossier timestamp must be UTC ISO 8601 with millisecond precision.");
}

function assertJsonSafe(value: unknown): void {
  const active = new WeakSet<object>();
  const walk = (entry: unknown, depth: number): void => {
    if (depth > 128) throw new Error("Prediction-run dossier exceeds the bounded nesting depth.");
    if (typeof entry === "number" && !Number.isFinite(entry)) throw new Error("Prediction-run dossier contains a non-finite number.");
    if (entry == null || typeof entry !== "object") return;
    if (active.has(entry)) throw new Error("Prediction-run dossier contains a cyclic value.");
    active.add(entry);
    if (Array.isArray(entry)) entry.forEach((value) => walk(value, depth + 1));
    else Object.values(entry).forEach((value) => walk(value, depth + 1));
    active.delete(entry);
  };
  walk(value, 0);
}

const PAE_METRIC_FIELDS = [
  "receptorAlignedVhhEvaluatedMedianAngstrom",
  "vhhAlignedReceptorEvaluatedMedianAngstrom",
  "receptorAlignedVhhEvaluatedP90Angstrom",
  "vhhAlignedReceptorEvaluatedP90Angstrom",
  "conservativeLargerDirectionMedianAngstrom",
  "conservativeLargerDirectionP90Angstrom",
  "contactPairShareAtOrBelow10Angstrom",
] as const;

export function validatePredictionRunResultAgainstManifest(
  manifest: PredictionRunManifest,
  result: PredictionRunAuditResult,
  topologyAnnotation: NormalizedTopologyAnnotation | null,
): void {
  assertJsonSafe(result);
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Prediction-run dossier requires a result object.");
  }
  requireExactKeys(result, [
    "schemaVersion", "productRelease", "engineVersion", "referenceCoordinateFileId",
    "coordinateEnsemble", "coordinateRejected", "poseAudits", "counts", "claimBoundary",
  ], "Prediction-run result");
  if (
    result.schemaVersion !== PREDICTION_RUN_AUDIT_SCHEMA_VERSION ||
    result.productRelease !== PREDICTION_RUN_PRODUCT_RELEASE ||
    result.engineVersion !== CONFOVHH_VERSION ||
    result.claimBoundary !== PREDICTION_RUN_CLAIM_BOUNDARY ||
    typeof result.referenceCoordinateFileId !== "string" || !result.referenceCoordinateFileId ||
    !Array.isArray(result.poseAudits) || !Array.isArray(result.coordinateRejected)
  ) throw new Error("Prediction-run result version, claim boundary, or ledgers are invalid.");
  if (topologyAnnotation != null) validateNormalizedTopologyAnnotation(topologyAnnotation);

  const selectedManifestPoses = manifest.poses.filter((pose) => pose.included && pose.status === "ready");
  const selectedCoordinateIds = new Set(selectedManifestPoses.map((pose) => pose.coordinateFileId));
  if (!selectedCoordinateIds.has(result.referenceCoordinateFileId)) {
    throw new Error("Prediction-run result reference is not a ready included manifest pose.");
  }
  requireExactKeys(result.counts, [
    "selected", "coordinateAccepted", "coordinateRejected", "paeAudited",
    "paeNotProvided", "paeRejected", "topologyEvaluated",
  ], "Prediction-run result counts");
  if (
    Object.values(result.counts).some((count) => !Number.isSafeInteger(count) || count < 0) ||
    result.counts.selected !== selectedManifestPoses.length ||
    result.counts.coordinateAccepted !== result.poseAudits.length ||
    result.counts.coordinateRejected !== result.coordinateRejected.length ||
    result.counts.coordinateAccepted + result.counts.coordinateRejected !== result.counts.selected ||
    result.counts.paeAudited !== result.poseAudits.filter((pose) => pose.pae.status === "audited").length ||
    result.counts.paeNotProvided !== result.poseAudits.filter((pose) => pose.pae.status === "not-provided").length ||
    result.counts.paeRejected !== result.poseAudits.filter((pose) => pose.pae.status === "rejected").length ||
    result.counts.paeAudited + result.counts.paeNotProvided + result.counts.paeRejected !== result.poseAudits.length ||
    result.counts.topologyEvaluated !== result.poseAudits.filter((pose) => pose.topology != null).length ||
    result.counts.topologyEvaluated !== (topologyAnnotation == null ? 0 : result.poseAudits.length)
  ) throw new Error("Prediction-run result counts do not reconcile with its bounded ledgers.");

  const auditedCoordinateIds = new Set<string>();
  const auditedDigests = new Set<string>();
  let referenceCount = 0;
  for (const pose of result.poseAudits) {
    if (pose == null || typeof pose !== "object" || Array.isArray(pose)) {
      throw new Error("Every prediction-run pose audit must be an object.");
    }
    requireExactKeys(pose, [
      "id", "isReference", "provider", "poseKey", "variant", "coordinate", "chains",
      "singleAudit", "pae", "topology",
    ], "Prediction-run pose audit");
    if (pose.coordinate == null || typeof pose.coordinate !== "object" || Array.isArray(pose.coordinate)) {
      throw new Error("Prediction-run pose coordinate provenance must be an object.");
    }
    requireExactKeys(pose.coordinate, [
      "fileId", "path", "filename", "sha256", "bytes",
    ], "Prediction-run pose coordinate provenance");
    if (pose.chains == null || typeof pose.chains !== "object" || Array.isArray(pose.chains)) {
      throw new Error("Prediction-run pose chain provenance must be an object.");
    }
    requireExactKeys(pose.chains, [
      "receptor", "vhh", "mappingBasis",
    ], "Prediction-run pose chain provenance");
    if (pose.pae == null || typeof pose.pae !== "object" || Array.isArray(pose.pae)) {
      throw new Error("Prediction-run pose PAE provenance must be an object.");
    }
    requireExactKeys(pose.pae, [
      "status", "fileId", "path", "filename", "sha256", "bytes", "associationBasis",
      "orderConfirmedByResearcher", "mapping", "sourceFormat", "maxPaeAngstrom",
      "receptorAlignedVhhEvaluatedMedianAngstrom", "vhhAlignedReceptorEvaluatedMedianAngstrom",
      "receptorAlignedVhhEvaluatedP90Angstrom", "vhhAlignedReceptorEvaluatedP90Angstrom",
      "conservativeLargerDirectionMedianAngstrom", "conservativeLargerDirectionP90Angstrom",
      "contactPairShareAtOrBelow10Angstrom", "reason", "interpretation",
    ], "Prediction-run pose PAE provenance");
    if (
      typeof pose.isReference !== "boolean" ||
      !["audited", "not-provided", "rejected"].includes(pose.pae.status) ||
      !READY_ASSOCIATION_BASES.has(pose.pae.associationBasis) ||
      pose.pae.interpretation !== PER_POSE_PAE_INTERPRETATION
    ) throw new Error("Prediction-run pose status or fixed PAE interpretation is invalid.");
    const manifestPose = manifest.poses.find((entry) => entry.coordinateFileId === pose.coordinate.fileId);
    if (!manifestPose || !manifestPose.included || manifestPose.status !== "ready") {
      throw new Error("Prediction-run result contains a pose that was not ready and included in the manifest.");
    }
    if (
      auditedCoordinateIds.has(pose.coordinate.fileId) || auditedDigests.has(pose.coordinate.sha256) ||
      pose.id !== manifestPose.id || pose.provider !== manifestPose.provider ||
      pose.poseKey !== manifestPose.poseKey || pose.variant !== manifestPose.variant ||
      pose.pae.associationBasis !== manifestPose.associationBasis
    ) throw new Error("Prediction-run pose identity or association provenance is duplicated or inconsistent.");
    auditedCoordinateIds.add(pose.coordinate.fileId);
    auditedDigests.add(pose.coordinate.sha256);
    const coordinate = manifest.files.find((file) => file.id === pose.coordinate.fileId);
    if (
      !coordinate || coordinate.kind !== "coordinate" ||
      pose.coordinate.path !== coordinate.path || pose.coordinate.filename !== coordinate.filename ||
      pose.coordinate.sha256 !== coordinate.sha256 || pose.coordinate.bytes !== coordinate.bytes
    ) throw new Error("Prediction-run result coordinate provenance does not match the manifest ledger.");
    if (pose.isReference) referenceCount += 1;
    if (pose.isReference !== (pose.coordinate.fileId === result.referenceCoordinateFileId)) {
      throw new Error("Prediction-run pose reference flag does not match the declared reference coordinate.");
    }

    const canonicalReport = validateImportedSingleAuditReport(pose.singleAudit);
    const receptor = canonicalReport.structure.selectedChains.find((chain) => chain.role === "receptor");
    const vhh = canonicalReport.structure.selectedChains.find((chain) => chain.role === "VHH");
    if (
      canonicalReport.file !== coordinate.filename ||
      canonicalReport.structure.sourceFileSha256 !== coordinate.sha256 ||
      canonicalReport.structure.sourceFileBytes !== coordinate.bytes ||
      receptor?.id !== pose.chains.receptor || vhh?.id !== pose.chains.vhh ||
      pose.chains.mappingBasis !== (pose.isReference
        ? "researcher-confirmed-reference"
        : "unique-exact-sequence-propagation")
    ) throw new Error("Prediction-run canonical single-audit provenance does not match its pose ledger.");

    const paeFile = manifestPose.paeFileId == null
      ? null
      : manifest.files.find((file) => file.id === manifestPose.paeFileId) ?? null;
    if (pose.pae.fileId !== manifestPose.paeFileId) {
      throw new Error("Prediction-run result PAE association does not match the resolved manifest.");
    }
    if (paeFile == null) {
      if (
        pose.pae.status !== "not-provided" || canonicalReport.pae != null ||
        pose.pae.path != null || pose.pae.filename != null || pose.pae.sha256 != null ||
        pose.pae.bytes != null || pose.pae.mapping != null || pose.pae.sourceFormat != null ||
        pose.pae.maxPaeAngstrom != null || pose.pae.reason != null ||
        pose.pae.orderConfirmedByResearcher !== false ||
        PAE_METRIC_FIELDS.some((field) => pose.pae[field] != null)
      ) throw new Error("Prediction-run coordinate-only PAE record is inconsistent.");
    } else {
      if (
        paeFile.kind !== "pae-json" || pose.pae.path !== paeFile.path ||
        pose.pae.filename !== paeFile.filename || pose.pae.sha256 !== paeFile.sha256 ||
        pose.pae.bytes !== paeFile.bytes || pose.pae.orderConfirmedByResearcher !== true
      ) throw new Error("Prediction-run PAE source provenance does not match the manifest ledger.");
      if (pose.pae.status === "audited") {
        if (
          canonicalReport.pae == null || canonicalReport.pae.filename !== paeFile.filename ||
          canonicalReport.pae.sha256 !== paeFile.sha256 || pose.pae.mapping == null ||
          pose.pae.reason != null || pose.pae.sourceFormat == null || pose.pae.maxPaeAngstrom == null ||
          pose.pae.sourceFormat !== canonicalReport.pae.sourceFormat ||
          pose.pae.maxPaeAngstrom !== canonicalReport.pae.maxPaeAngstrom ||
          pose.pae.receptorAlignedVhhEvaluatedMedianAngstrom !== canonicalReport.audit.receptorFrameToVhhPaeMedianAngstrom ||
          pose.pae.vhhAlignedReceptorEvaluatedMedianAngstrom !== canonicalReport.audit.vhhFrameToReceptorPaeMedianAngstrom ||
          pose.pae.receptorAlignedVhhEvaluatedP90Angstrom !== canonicalReport.audit.receptorFrameToVhhPaeP90Angstrom ||
          pose.pae.vhhAlignedReceptorEvaluatedP90Angstrom !== canonicalReport.audit.vhhFrameToReceptorPaeP90Angstrom ||
          pose.pae.conservativeLargerDirectionMedianAngstrom !== canonicalReport.audit.interfacePaeMedianAngstrom ||
          pose.pae.conservativeLargerDirectionP90Angstrom !== canonicalReport.audit.interfacePaeP90Angstrom ||
          pose.pae.contactPairShareAtOrBelow10Angstrom !== canonicalReport.audit.lowPaeContactShare
        ) throw new Error("Prediction-run audited PAE metrics or canonical provenance are inconsistent.");
        const mapping = pose.pae.mapping;
        if (mapping == null || typeof mapping !== "object" || Array.isArray(mapping)) {
          throw new Error("Prediction-run PAE token mapping provenance must be an object.");
        }
        requireExactKeys(mapping, [
          "basis", "originalTokenCount", "proteinResidueCount", "sourceIndexMap",
        ], "Prediction-run PAE token mapping provenance");
        if (
          !["token-residue-metadata-verified", "researcher-confirmed-token-chain-and-within-chain-order", "researcher-confirmed-complete-protein-order"].includes(mapping.basis) ||
          !Number.isSafeInteger(mapping.originalTokenCount) || mapping.originalTokenCount < 1 ||
          !Number.isSafeInteger(mapping.proteinResidueCount) || mapping.proteinResidueCount < 1 ||
          mapping.proteinResidueCount !== canonicalReport.pae.residueCount ||
          !Array.isArray(mapping.sourceIndexMap) || mapping.sourceIndexMap.length !== mapping.proteinResidueCount ||
          new Set(mapping.sourceIndexMap).size !== mapping.sourceIndexMap.length ||
          mapping.sourceIndexMap.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= mapping.originalTokenCount)
        ) throw new Error("Prediction-run PAE token mapping provenance is invalid.");
        if (
          mapping.basis !== "token-residue-metadata-verified" && (
            mapping.originalTokenCount !== mapping.proteinResidueCount ||
            mapping.sourceIndexMap.some((sourceIndex, index) => sourceIndex !== index)
          )
        ) throw new Error("Researcher-confirmed complete-order PAE mapping must be identity ordered.");
      } else if (pose.pae.status === "rejected") {
        if (
          canonicalReport.pae != null || pose.pae.mapping != null || pose.pae.sourceFormat != null ||
          pose.pae.maxPaeAngstrom != null || typeof pose.pae.reason !== "string" || !pose.pae.reason ||
          pose.pae.reason.length > 4_096 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(pose.pae.reason) ||
          PAE_METRIC_FIELDS.some((field) => pose.pae[field] != null)
        ) throw new Error("Prediction-run rejected PAE record is incomplete or inconsistent.");
      } else {
        throw new Error("Prediction-run pose with an associated PAE must be audited or explicitly rejected.");
      }
    }

    if (topologyAnnotation == null) {
      if (pose.topology != null) throw new Error("Prediction-run result contains topology without a supplied annotation.");
    } else {
      const interfaceOrders = [...new Set(
        canonicalReport.audit.contacts.map((contact) => contact.receptorResidueOrder),
      )].sort((left, right) => left - right);
      const expectedTopology = evaluateAnnotatedFootprint(topologyAnnotation, interfaceOrders);
      if (!jsonEqual(pose.topology, expectedTopology)) {
        throw new Error("Prediction-run topology result does not reconcile with its annotation and coordinate contacts.");
      }
    }
  }
  if (referenceCount !== 1 || !auditedCoordinateIds.has(result.referenceCoordinateFileId)) {
    throw new Error("Prediction-run result must contain exactly one declared reference pose.");
  }

  const rejectedDigests = new Set<string>();
  for (const rejected of result.coordinateRejected) {
    if (
      rejected == null || typeof rejected !== "object" || Array.isArray(rejected) ||
      typeof rejected.filename !== "string" || !rejected.filename ||
      !/^[0-9a-f]{64}$/u.test(rejected.sha256) || rejected.sha256 !== rejected.sha256.toLowerCase() ||
      rejectedDigests.has(rejected.sha256) ||
      !Number.isSafeInteger(rejected.bytes) || rejected.bytes < 0 ||
      typeof rejected.reason !== "string" || !rejected.reason || rejected.reason.length > 4_096 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(rejected.reason)
    ) throw new Error("Prediction-run rejected-coordinate provenance is invalid or duplicated.");
    requireExactKeys(rejected, ["filename", "sha256", "bytes", "reason"], "Prediction-run rejected coordinate");
    rejectedDigests.add(rejected.sha256);
    const source = manifest.files.find((file) => file.kind === "coordinate" && file.sha256 === rejected.sha256);
    if (
      !source || !selectedCoordinateIds.has(source.id) || auditedCoordinateIds.has(source.id) ||
      source.filename !== rejected.filename || source.bytes !== rejected.bytes
    ) throw new Error("Prediction-run rejected coordinate does not reconcile with the selected manifest.");
  }

  if (result.coordinateEnsemble == null) {
    if (result.poseAudits.length !== 1 || result.counts.selected > 1 && result.coordinateRejected.length !== result.counts.selected - 1) {
      throw new Error("Prediction-run coordinate-only ensemble accounting is inconsistent.");
    }
  } else {
    const ensemble = validatePoseEnsembleExportSummary(result.coordinateEnsemble);
    const ensembleDigests = new Set(ensemble.poses.map((pose) => pose.sha256 as string));
    if (
      ensemble.poseCount !== result.poseAudits.length || ensembleDigests.size !== auditedDigests.size ||
      [...auditedDigests].some((digest) => !ensembleDigests.has(digest)) ||
      !ensemble.poses.some((pose) => pose.isReference && pose.sha256 === manifest.files.find((file) => file.id === result.referenceCoordinateFileId)?.sha256)
    ) throw new Error("Prediction-run ensemble membership does not reconcile with per-pose audits.");
  }
}

export function createPredictionRunDossier(
  manifest: PredictionRunManifest,
  result: PredictionRunAuditResult,
  topologyAnnotation: NormalizedTopologyAnnotation | null,
  generatedAt = new Date().toISOString(),
): PredictionRunDossier {
  requireIsoTimestamp(generatedAt);
  const manifestExport = predictionRunManifestForExport(manifest);
  validatePredictionRunResultAgainstManifest(manifest, result, topologyAnnotation);
  const sanitizedTopology = topologyAnnotation == null
    ? null
    : (({ receptorSequence, ...annotation }) => {
        void receptorSequence;
        return annotation;
      })(topologyAnnotation);
  const dossier: PredictionRunDossier = {
    schemaVersion: PREDICTION_RUN_DOSSIER_SCHEMA_VERSION,
    productRelease: PREDICTION_RUN_PRODUCT_RELEASE,
    engineVersion: result.engineVersion,
    generatedAt,
    manifest: manifestExport,
    result: JSON.parse(JSON.stringify(result)) as PredictionRunAuditResult,
    topologyAnnotation: sanitizedTopology,
    privacy: {
      rawCoordinateTextIncluded: false,
      paeMatricesIncluded: false,
      sourceFilesUploadedByConfoVHH: false,
    },
    claimBoundary: PREDICTION_RUN_CLAIM_BOUNDARY,
  };
  assertJsonSafe(dossier);
  const serialized = JSON.stringify(dossier);
  if (/"text"\s*:|"matrix"\s*:/u.test(serialized)) {
    throw new Error("Prediction-run dossier cannot include raw coordinate text or PAE matrices.");
  }
  return dossier;
}

function csvCell(value: string | number | null): string {
  if (value == null) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/gu, '""')}"`;
}

export function predictionRunPoseSummaryCsv(result: PredictionRunAuditResult): string {
  const header = [
    "pose_id", "coordinate_file", "coordinate_sha256", "is_reference", "provider",
    "recurrence_rank", "evidence_level", "contact_pairs", "severe_clashes", "delta_sasa_angstrom2",
    "pae_status", "pae_file", "pae_sha256", "receptor_aligned_vhh_evaluated_median_angstrom",
    "vhh_aligned_receptor_evaluated_median_angstrom", "conservative_median_angstrom",
    "contact_pair_share_at_or_below_10_angstrom", "topology_status", "topology_intended_side",
    "topology_interface_receptor_residues", "topology_annotation_coverage",
    "topology_side_evaluable_coverage", "topology_intended_side_contact_residues",
    "topology_intended_side_share", "pae_interpretation", "claim_boundary",
  ];
  const rankByDigest = new Map(
    result.coordinateEnsemble?.poses.map((pose) => [pose.sha256, pose.rank]) ?? [],
  );
  const rows = result.poseAudits.map((pose) => [
    pose.id,
    pose.coordinate.filename,
    pose.coordinate.sha256,
    pose.isReference,
    pose.provider,
    rankByDigest.get(pose.coordinate.sha256) ?? null,
    pose.singleAudit.audit.evidenceLevel,
    pose.singleAudit.audit.contactPairCount,
    pose.singleAudit.audit.severeClashCount,
    pose.singleAudit.audit.deltaSasaAngstrom2,
    pose.pae.status,
    pose.pae.filename,
    pose.pae.sha256,
    pose.pae.receptorAlignedVhhEvaluatedMedianAngstrom,
    pose.pae.vhhAlignedReceptorEvaluatedMedianAngstrom,
    pose.pae.conservativeLargerDirectionMedianAngstrom,
    pose.pae.contactPairShareAtOrBelow10Angstrom,
    pose.topology?.status ?? null,
    pose.topology?.intendedSide ?? null,
    pose.topology?.interfaceResidueCount ?? null,
    pose.topology?.annotationCoverage ?? null,
    pose.topology?.sideEvaluableCoverage ?? null,
    pose.topology?.intendedSideContactResidueCount ?? null,
    pose.topology?.intendedSideShare ?? null,
    pose.pae.interpretation,
    result.claimBoundary,
  ]);
  return [header, ...rows].map((row) => row.map((value) => csvCell(value as string | number | null)).join(",")).join("\n");
}
