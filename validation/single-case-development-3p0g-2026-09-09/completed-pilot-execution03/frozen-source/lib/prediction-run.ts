export const PREDICTION_RUN_MANIFEST_SCHEMA_VERSION = "1.0.0" as const;
export const MAX_PREDICTION_RUN_FILES = 128;
export const MAX_PREDICTION_RUN_POSES = 12;
export const MAX_PREDICTION_RUN_COORDINATE_BYTES = 12 * 1024 * 1024;
export const MAX_PREDICTION_RUN_JSON_BYTES = 16 * 1024 * 1024;
export const MAX_PREDICTION_RUN_TOTAL_BYTES = 96 * 1024 * 1024;
export const MAX_PREDICTION_RUN_COORDINATE_TOTAL_BYTES = 48 * 1024 * 1024;
export const MAX_PREDICTION_RUN_PAE_TOTAL_BYTES = 48 * 1024 * 1024;
export const MAX_PREDICTION_RUN_PATH_CHARACTERS = 1_024;

export type PredictionProvider =
  | "alphafold-server"
  | "alphafold-local"
  | "colabfold"
  | "boltz"
  | "unknown";

export type PredictionRunFileKind =
  | "coordinate"
  | "pae-json"
  | "confidence-json"
  | "ranking-metadata"
  | "auxiliary-json"
  | "unsupported-pae"
  | "unsupported"
  | "rejected";

export interface PredictionRunRawFile {
  path: string;
  bytes: number;
  sha256: string;
  /** Decoded UTF-8 for text candidates. Binary files use null. */
  text: string | null;
}

export interface PredictionRunFileRecord {
  id: string;
  path: string;
  filename: string;
  directory: string;
  bytes: number;
  sha256: string;
  kind: PredictionRunFileKind;
  provider: PredictionProvider;
  poseKey: string | null;
  poseLabel: string | null;
  variant: string | null;
  detail: string;
  text: string | null;
}

export interface PredictionRunPairOverride {
  included?: boolean;
  /** null is an explicit coordinate-only decision; undefined keeps auto-detection. */
  paeFileId?: string | null;
}

export type PredictionRunPoseStatus = "ready" | "needs-review" | "excluded";

export interface PredictionRunPoseRecord {
  id: string;
  coordinateFileId: string;
  provider: PredictionProvider;
  poseKey: string | null;
  poseLabel: string;
  variant: string | null;
  included: boolean;
  paeFileId: string | null;
  confidenceFileId: string | null;
  unsupportedPaeFileId: string | null;
  candidatePaeFileIds: string[];
  associationBasis: "exact-native-key" | "explicit" | "none" | "unresolved";
  status: PredictionRunPoseStatus;
  issues: string[];
}

export interface PredictionRunManifest {
  schemaVersion: typeof PREDICTION_RUN_MANIFEST_SCHEMA_VERSION;
  files: PredictionRunFileRecord[];
  poses: PredictionRunPoseRecord[];
  totals: {
    fileCount: number;
    coordinateCount: number;
    paeJsonCount: number;
    readyPoseCount: number;
    reviewPoseCount: number;
    excludedPoseCount: number;
    ignoredOrUnsupportedFileCount: number;
    bytes: number;
    coordinateBytes: number;
  };
  warnings: string[];
}

interface NamingIdentity {
  provider: PredictionProvider;
  poseKey: string | null;
  poseLabel: string | null;
  variant: string | null;
  expectedRole: "coordinate" | "pae" | "confidence" | "unsupported-pae" | "ranking" | null;
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function requireSha256(value: string, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${label} requires a 64-character hexadecimal SHA-256 digest.`);
  }
  return value.toLowerCase();
}

export function normalizePredictionRunPath(value: string): string {
  if (typeof value !== "string" || !value || value.length > MAX_PREDICTION_RUN_PATH_CHARACTERS) {
    throw new Error(`Every prediction-run path must contain 1–${MAX_PREDICTION_RUN_PATH_CHARACTERS.toLocaleString()} characters.`);
  }
  if (/^[A-Za-z]:[\\/]|^[\\/]/u.test(value)) {
    throw new Error("Prediction-run paths must be relative to the selected upload.");
  }
  if (/\p{Cc}|\p{Cf}|\p{Zl}|\p{Zp}/u.test(value)) {
    throw new Error("Prediction-run paths cannot contain control, invisible-format, or bidi characters.");
  }
  const normalized = value.replace(/\\/gu, "/").replace(/^\.\//u, "");
  const segments = normalized.split("/");
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Prediction-run paths cannot contain empty, current-directory, or parent-directory segments.");
  }
  if (segments.some((segment) => segment.length > 255)) {
    throw new Error("A prediction-run filename or directory segment exceeds 255 characters.");
  }
  return normalized;
}

export function decodePredictionRunUtf8(bytes: ArrayBuffer, path: string): string {
  const view = new Uint8Array(bytes);
  if (view.length >= 3 && view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) {
    throw new Error(`${path} begins with a UTF-8 byte-order mark. Save it as BOM-free UTF-8 before prediction-run intake.`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${path} is not valid UTF-8 text. Decompress or convert binary coordinates/confidence data before import.`);
  }
}

function pathParts(path: string): { filename: string; directory: string; stem: string; extension: string } {
  const slash = path.lastIndexOf("/");
  const filename = slash < 0 ? path : path.slice(slash + 1);
  const directory = slash < 0 ? "" : path.slice(0, slash);
  const dot = filename.lastIndexOf(".");
  return {
    filename,
    directory,
    stem: dot <= 0 ? filename : filename.slice(0, dot),
    extension: dot <= 0 ? "" : filename.slice(dot + 1).toLowerCase(),
  };
}

function scopedKey(directory: string, family: string, identity: string): string {
  return JSON.stringify([directory, family, identity]);
}

function namingIdentity(path: string): NamingIdentity {
  const { directory, stem, extension } = pathParts(path);
  let match: RegExpExecArray | null;

  match = /^(fold_.+)_model_(\d+)$/iu.exec(stem);
  if (match && ["cif", "mmcif", "pdb", "ent"].includes(extension)) {
    return {
      provider: "alphafold-server",
      poseKey: scopedKey(directory, "alphafold-server", `${match[1]}:${match[2]}`),
      poseLabel: `${match[1]} · model ${match[2]}`,
      variant: null,
      expectedRole: "coordinate",
    };
  }
  match = /^(fold_.+)_full_data_(\d+)$/iu.exec(stem);
  if (match && extension === "json") {
    return {
      provider: "alphafold-server",
      poseKey: scopedKey(directory, "alphafold-server", `${match[1]}:${match[2]}`),
      poseLabel: `${match[1]} · model ${match[2]}`,
      variant: null,
      expectedRole: "pae",
    };
  }
  match = /^(fold_.+)_summary_confidences_(\d+)$/iu.exec(stem);
  if (match && extension === "json") {
    return {
      provider: "alphafold-server",
      poseKey: scopedKey(directory, "alphafold-server", `${match[1]}:${match[2]}`),
      poseLabel: `${match[1]} · model ${match[2]}`,
      variant: null,
      expectedRole: "confidence",
    };
  }

  // Prefixes are user-controlled. Greedy matching deliberately strips the
  // rightmost native role/rank suffix, even when the prefix itself contains
  // text such as "_unrelaxed_rank_001_" or "_scores_rank_001_".
  match = /^(.+)_(unrelaxed|relaxed)_rank_(\d{3})_(.+)$/iu.exec(stem);
  if (match && ["pdb", "ent", "cif", "mmcif"].includes(extension)) {
    return {
      provider: "colabfold",
      poseKey: scopedKey(directory, "colabfold", `${match[1]}:rank-${match[3]}:${match[4]}`),
      poseLabel: `${match[1]} · rank ${Number(match[3])}`,
      variant: match[2].toLowerCase(),
      expectedRole: "coordinate",
    };
  }
  match = /^(.+)_scores_rank_(\d{3})_(.+)$/iu.exec(stem);
  if (match && extension === "json") {
    return {
      provider: "colabfold",
      poseKey: scopedKey(directory, "colabfold", `${match[1]}:rank-${match[2]}:${match[3]}`),
      poseLabel: `${match[1]} · rank ${Number(match[2])}`,
      variant: null,
      expectedRole: "pae",
    };
  }

  match = /^confidence_(.+)_model_(\d+)$/iu.exec(stem);
  if (match && extension === "json") {
    return {
      provider: "boltz",
      poseKey: scopedKey(directory, "boltz", `${match[1]}:${match[2]}`),
      poseLabel: `${match[1]} · model ${match[2]}`,
      variant: null,
      expectedRole: "confidence",
    };
  }
  match = /^pae_(.+)_model_(\d+)$/iu.exec(stem);
  if (match && extension === "npz") {
    return {
      provider: "boltz",
      poseKey: scopedKey(directory, "boltz", `${match[1]}:${match[2]}`),
      poseLabel: `${match[1]} · model ${match[2]}`,
      variant: null,
      expectedRole: "unsupported-pae",
    };
  }
  match = /^(.+)_model_(\d+)$/iu.exec(stem);
  if (match && ["cif", "mmcif", "pdb", "ent"].includes(extension) && !stem.startsWith("fold_")) {
    return {
      provider: directory.split("/").includes("predictions") ? "boltz" : "unknown",
      poseKey: scopedKey(directory, "boltz", `${match[1]}:${match[2]}`),
      poseLabel: `${match[1]} · model ${match[2]}`,
      variant: null,
      expectedRole: "coordinate",
    };
  }

  match = /^(.+)_model$/iu.exec(stem);
  if (match && ["cif", "mmcif"].includes(extension)) {
    return {
      provider: "alphafold-local",
      poseKey: scopedKey(directory, "alphafold-local", match[1]),
      poseLabel: `${match[1]} · local sample`,
      variant: null,
      expectedRole: "coordinate",
    };
  }
  match = /^(.+)_summary_confidences$/iu.exec(stem);
  if (match && extension === "json") {
    return {
      provider: "alphafold-local",
      poseKey: scopedKey(directory, "alphafold-local", match[1]),
      poseLabel: `${match[1]} · local sample`,
      variant: null,
      expectedRole: "confidence",
    };
  }
  match = /^(.+)_confidences$/iu.exec(stem);
  if (match && extension === "json") {
    return {
      provider: "alphafold-local",
      poseKey: scopedKey(directory, "alphafold-local", match[1]),
      poseLabel: `${match[1]} · local sample`,
      variant: null,
      expectedRole: "pae",
    };
  }

  if (/^ranking_debug$/iu.test(stem) && extension === "json") {
    return { provider: "alphafold-local", poseKey: null, poseLabel: null, variant: null, expectedRole: "ranking" };
  }
  if (/^ranked_\d+$/iu.test(stem) && ["pdb", "ent", "cif", "mmcif"].includes(extension)) {
    return {
      provider: "alphafold-local",
      poseKey: null,
      poseLabel: stem.replace("_", " "),
      variant: "ranked-alias",
      expectedRole: "coordinate",
    };
  }

  return { provider: "unknown", poseKey: null, poseLabel: null, variant: null, expectedRole: null };
}

function preflightJson(text: string): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") {
      depth += 1;
      if (depth > 128) throw new Error("JSON nesting exceeds the 128-level manifest-scan limit.");
    } else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth < 0) throw new Error("JSON container delimiters are unbalanced.");
    }
  }
  if (inString || depth !== 0) throw new Error("JSON text is truncated or has unbalanced containers.");
}

function extractTopLevelPae(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length && Array.isArray(value[0])) return value;
    if (value.length === 1) return extractTopLevelPae(value[0]);
    return null;
  }
  if (value == null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return record.predicted_aligned_error ?? record.pae ?? null;
}

function looksLikeCoordinate(text: string, extension: string): boolean {
  const head = text.slice(0, 256 * 1024);
  if (extension === "pdb" || extension === "ent") {
    return /^(?:ATOM  |HETATM|MODEL |HEADER|TITLE |REMARK)/mu.test(head) && /^(?:ATOM  |HETATM)/mu.test(head);
  }
  if (extension === "cif" || extension === "mmcif") {
    return /^\s*data_/mu.test(head) && /_atom_site\.(?:group_PDB|Cartn_x)/u.test(head);
  }
  return false;
}

function confidenceLike(record: Record<string, unknown>): boolean {
  return [
    "plddt", "atom_plddts", "confidence_score", "ptm", "iptm", "chain_iptm",
    "ranking_confidence", "fraction_disordered", "has_clash",
  ].some((key) => Object.hasOwn(record, key));
}

function classifyFile(raw: PredictionRunRawFile, path: string): PredictionRunFileRecord {
  const { filename, directory, extension } = pathParts(path);
  const identity = namingIdentity(path);
  let kind: PredictionRunFileKind = "unsupported";
  let detail = "File type is not used by this browser release.";

  if (["pdb", "ent", "cif", "mmcif"].includes(extension)) {
    if (raw.text == null || !looksLikeCoordinate(raw.text, extension)) {
      kind = "rejected";
      detail = "Coordinate extension and content do not agree; no coordinate association was made.";
    } else {
      kind = "coordinate";
      detail = extension === "pdb" || extension === "ent" ? "Text PDB coordinate model" : "Text PDBx/mmCIF coordinate model";
    }
  } else if (extension === "json") {
    if (raw.text == null) {
      kind = "rejected";
      detail = "JSON files must be valid UTF-8 text.";
    } else {
      try {
        preflightJson(raw.text);
        const decoded = JSON.parse(raw.text) as unknown;
        const pae = extractTopLevelPae(decoded);
        if (pae != null && (identity.expectedRole === "confidence" || identity.expectedRole === "ranking")) {
          kind = "rejected";
          detail = "Filename role and JSON schema conflict: a confidence or ranking file cannot supply a PAE matrix.";
        } else if (pae != null) {
          kind = "pae-json";
          detail = "JSON contains a proposed PAE matrix; dimensions and values are checked against its selected coordinate before analysis.";
        } else if (identity.expectedRole === "pae") {
          kind = "rejected";
          detail = "The native filename identifies a PAE-bearing file, but no supported pae or predicted_aligned_error matrix was found.";
        } else if (identity.expectedRole === "ranking") {
          kind = "ranking-metadata";
          detail = "Ranking metadata is retained for provenance; binary AlphaFold result pickle files are not executed or parsed.";
        } else if (decoded != null && typeof decoded === "object" && !Array.isArray(decoded) && confidenceLike(decoded as Record<string, unknown>)) {
          kind = "confidence-json";
          detail = "Confidence summary retained in the file ledger; it is not interpreted as PAE.";
        } else {
          kind = "auxiliary-json";
          detail = "Auxiliary JSON retained in the file ledger; it is not used for scientific metrics.";
        }
      } catch (caught) {
        kind = "rejected";
        detail = caught instanceof Error ? `JSON rejected: ${caught.message}` : "JSON rejected during bounded manifest scan.";
      }
    }
  } else if (extension === "npz" && identity.expectedRole === "unsupported-pae") {
    kind = "unsupported-pae";
    detail = "Boltz binary PAE was recognized for inventory only and is not analyzed. Continue coordinate-only unless a compatible JSON matrix and its axes/order were independently verified.";
  } else if (["pkl", "pickle"].includes(extension)) {
    kind = "unsupported-pae";
    detail = "Binary pickle model output is never executed or parsed in the browser. Export PAE as supported JSON.";
  }

  return {
    id: `file-${raw.sha256.slice(0, 16)}-${fnv1a32(path)}`,
    path,
    filename,
    directory,
    bytes: raw.bytes,
    sha256: raw.sha256,
    kind,
    provider: identity.provider,
    poseKey: identity.poseKey,
    poseLabel: identity.poseLabel,
    variant: identity.variant,
    detail,
    text: raw.text,
  };
}

function foldCoordinateMatch(file: PredictionRunFileRecord): RegExpExecArray | null {
  if (file.kind !== "coordinate") return null;
  return /^(fold_.+)_model_(\d+)$/iu.exec(pathParts(file.path).stem);
}

function reconcileAmbiguousFoldCoordinates(
  files: readonly PredictionRunFileRecord[],
): PredictionRunFileRecord[] {
  return files.map((file) => {
    const match = foldCoordinateMatch(file);
    if (!match) return file;
    const alphaFoldKey = scopedKey(file.directory, "alphafold-server", `${match[1]}:${match[2]}`);
    const boltzKey = scopedKey(file.directory, "boltz", `${match[1]}:${match[2]}`);
    const alphaFoldEvidence = files.some((candidate) => (
      candidate.id !== file.id && candidate.provider === "alphafold-server" &&
      candidate.poseKey === alphaFoldKey
    ));
    const boltzEvidence = file.directory.split("/").some((segment) => segment.toLowerCase() === "predictions") ||
      files.some((candidate) => (
        candidate.id !== file.id && candidate.provider === "boltz" && candidate.poseKey === boltzKey
      ));
    if (alphaFoldEvidence && boltzEvidence) {
      return {
        ...file,
        provider: "unknown",
        poseKey: null,
        variant: "provider-ambiguous",
        detail: `${file.detail}; both AlphaFold Server and Boltz companion naming were detected, so no native association was made.`,
      };
    }
    if (boltzEvidence) {
      return {
        ...file,
        provider: "boltz",
        poseKey: boltzKey,
        detail: `${file.detail}; provider resolved as Boltz from its run namespace or unique native companion.`,
      };
    }
    return file;
  });
}

function alphaFoldLocalCoordinateBase(file: PredictionRunFileRecord): string | null {
  if (file.kind !== "coordinate" || file.provider !== "alphafold-local") return null;
  return /^(.+)_model$/iu.exec(pathParts(file.path).stem)?.[1] ?? null;
}

function isAlphaFoldSampleOfRoot(
  root: PredictionRunFileRecord,
  sample: PredictionRunFileRecord,
): boolean {
  if (root.id === sample.id) return false;
  const rootBase = alphaFoldLocalCoordinateBase(root);
  const sampleBase = alphaFoldLocalCoordinateBase(sample);
  if (rootBase == null || sampleBase == null) return false;
  const sampleMatch = /^(.+)_seed-[-+]?\d+_sample-\d+$/iu.exec(sampleBase);
  if (!sampleMatch || sampleMatch[1] !== rootBase) return false;
  return root.directory === "" || sample.directory === root.directory ||
    sample.directory.startsWith(`${root.directory}/`);
}

function annotateAlphaFoldRootAliases(
  files: readonly PredictionRunFileRecord[],
): PredictionRunFileRecord[] {
  const coordinates = files.filter((file) => file.kind === "coordinate");
  return files.map((file) => {
    if (!coordinates.some((sample) => isAlphaFoldSampleOfRoot(file, sample))) return file;
    return {
      ...file,
      variant: "top-ranked-alias",
      detail: `${file.detail}; local AlphaFold 3 top-ranked copy is excluded by default when seed/sample outputs are present.`,
    };
  });
}

function coordinateIncludedByDefault(
  coordinate: PredictionRunFileRecord,
  overrides: Readonly<Record<string, PredictionRunPairOverride>>,
): boolean {
  const explicit = overrides[coordinate.id]?.included;
  return explicit ?? coordinate.variant !== "top-ranked-alias";
}

function associatedSingle(
  files: readonly PredictionRunFileRecord[],
  coordinate: PredictionRunFileRecord,
  kinds: readonly PredictionRunFileKind[],
): PredictionRunFileRecord | null {
  if (coordinate.poseKey == null) return null;
  const candidates = files.filter((file) => file.poseKey === coordinate.poseKey && kinds.includes(file.kind));
  return candidates.length === 1 ? candidates[0] : null;
}

function countCoordinatesForKey(
  files: readonly PredictionRunFileRecord[],
  key: string | null,
  overrides: Readonly<Record<string, PredictionRunPairOverride>>,
): number {
  if (key == null) return 0;
  return files.filter((file) => (
    file.kind === "coordinate" && file.poseKey === key && coordinateIncludedByDefault(file, overrides)
  )).length;
}

function createPoseRecords(
  files: readonly PredictionRunFileRecord[],
  overrides: Readonly<Record<string, PredictionRunPairOverride>>,
): PredictionRunPoseRecord[] {
  const coordinates = files.filter((file) => file.kind === "coordinate");
  const paeFiles = files.filter((file) => file.kind === "pae-json");
  const selectedPaeOwners = new Map<string, string[]>();
  const provisional = coordinates.map((coordinate) => {
    const override = overrides[coordinate.id];
    const included = coordinateIncludedByDefault(coordinate, overrides);
    const exactCandidates = coordinate.poseKey == null
      ? []
      : paeFiles.filter((file) => file.poseKey === coordinate.poseKey).map((file) => file.id);
    const coordinateKeyCount = countCoordinatesForKey(files, coordinate.poseKey, overrides);
    let paeFileId: string | null = null;
    let associationBasis: PredictionRunPoseRecord["associationBasis"] = "none";
    const issues: string[] = [];
    const includedDigestCopies = files.filter((file) => (
      file.kind === "coordinate" && file.sha256 === coordinate.sha256 &&
      coordinateIncludedByDefault(file, overrides)
    )).length;
    if (included && includedDigestCopies > 1) {
      issues.push("Identical coordinate bytes appear in more than one included pose. Exclude aliases or duplicates before recurrence analysis.");
    }
    if (included && coordinate.variant === "provider-ambiguous") {
      issues.push("This fold_* coordinate has conflicting AlphaFold Server and Boltz companion namespaces. Remove the unrelated companions or exclude the pose.");
    }
    if (included) {
      const overlappingAliasCoordinates = coordinates.filter((candidate) => (
        candidate.id !== coordinate.id && coordinateIncludedByDefault(candidate, overrides) && (
          isAlphaFoldSampleOfRoot(coordinate, candidate) || isAlphaFoldSampleOfRoot(candidate, coordinate)
        )
      ));
      if (overlappingAliasCoordinates.length) {
        issues.push("A local AlphaFold 3 top-ranked copy cannot contribute alongside its seed/sample source; include only one representation of that prediction.");
      }
      if (coordinate.poseKey != null && files.some((file) => (
        file.id !== coordinate.id && file.poseKey === coordinate.poseKey && file.kind === "rejected"
      ))) {
        issues.push("A native companion for this pose was quarantined because its filename role and content could not be validated.");
      }
    }

    if (Object.hasOwn(override ?? {}, "paeFileId")) {
      paeFileId = override?.paeFileId ?? null;
      associationBasis = paeFileId == null ? "none" : "explicit";
      if (paeFileId != null && !paeFiles.some((file) => file.id === paeFileId)) {
        issues.push("The explicitly selected PAE file is missing or no longer classified as supported PAE JSON.");
      }
    } else if (exactCandidates.length === 1 && coordinateKeyCount === 1) {
      paeFileId = exactCandidates[0];
      associationBasis = "exact-native-key";
    } else if (exactCandidates.length > 0 || coordinateKeyCount > 1) {
      associationBasis = "unresolved";
      issues.push(coordinateKeyCount > 1
        ? "Multiple coordinate variants share this native pose key. Include one variant and explicitly resolve its PAE association."
        : "Multiple PAE JSON files share this native pose key. Select one explicitly.");
    } else {
      const nativeProviderExpectsPae = ["alphafold-server", "alphafold-local", "colabfold"].includes(coordinate.provider);
      const unsupported = associatedSingle(files, coordinate, ["unsupported-pae"]);
      const orphanPaeInDirectory = paeFiles.some((file) => file.directory === coordinate.directory);
      if (unsupported) {
        associationBasis = "unresolved";
        issues.push("A binary PAE file is associated with this pose but is inventory-only. Explicitly continue coordinate-only, select an independently verified compatible JSON matrix, or exclude the pose.");
      } else if (nativeProviderExpectsPae || orphanPaeInDirectory) {
        associationBasis = "unresolved";
        issues.push("No unique PAE JSON association was established. Select a PAE file, explicitly continue coordinate-only, or exclude the pose.");
      }
    }

    if (paeFileId != null && included) {
      const owners = selectedPaeOwners.get(paeFileId) ?? [];
      owners.push(coordinate.id);
      selectedPaeOwners.set(paeFileId, owners);
    }
    const confidence = associatedSingle(files, coordinate, ["confidence-json"]);
    const unsupportedPae = associatedSingle(files, coordinate, ["unsupported-pae"]);
    return {
      id: `pose-${coordinate.id}`,
      coordinateFileId: coordinate.id,
      provider: coordinate.provider,
      poseKey: coordinate.poseKey,
      poseLabel: coordinate.poseLabel ?? coordinate.filename,
      variant: coordinate.variant,
      included,
      paeFileId,
      confidenceFileId: confidence?.id ?? null,
      unsupportedPaeFileId: unsupportedPae?.id ?? null,
      candidatePaeFileIds: exactCandidates.sort(codeUnitCompare),
      associationBasis,
      status: included ? "ready" : "excluded",
      issues,
    } satisfies PredictionRunPoseRecord;
  });

  const selectedPaeBytes = provisional.reduce((sum, pose) => {
    if (!pose.included || pose.paeFileId == null) return sum;
    return sum + (paeFiles.find((file) => file.id === pose.paeFileId)?.bytes ?? 0);
  }, 0);

  return provisional.map((pose) => {
    const issues = [...pose.issues];
    if (pose.included && pose.paeFileId != null && (selectedPaeOwners.get(pose.paeFileId)?.length ?? 0) > 1) {
      issues.push("One PAE file cannot be attached to multiple included coordinate poses.");
    }
    if (pose.included && pose.paeFileId != null && selectedPaeBytes > MAX_PREDICTION_RUN_PAE_TOTAL_BYTES) {
      issues.push("Selected PAE JSON attachments exceed the 48 MiB aggregate audit limit. Continue one or more poses coordinate-only, or exclude them.");
    }
    return {
      ...pose,
      issues,
      status: !pose.included ? "excluded" : issues.length ? "needs-review" : "ready",
    };
  });
}

export function createPredictionRunManifest(
  rawFiles: readonly PredictionRunRawFile[],
  overrides: Readonly<Record<string, PredictionRunPairOverride>> = {},
): PredictionRunManifest {
  if (!Array.isArray(rawFiles) || rawFiles.length < 1) {
    throw new Error("Choose at least one prediction-run file.");
  }
  if (rawFiles.length > MAX_PREDICTION_RUN_FILES) {
    throw new Error(`Prediction-run intake supports at most ${MAX_PREDICTION_RUN_FILES} selected files.`);
  }
  const normalized = rawFiles.map((file, index) => {
    if (file == null || typeof file !== "object") throw new Error(`Selected file ${index + 1} is invalid.`);
    const path = normalizePredictionRunPath(file.path);
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      throw new Error(`${path}: byte count must be a non-negative safe integer.`);
    }
    const { extension } = pathParts(path);
    const limit = ["pdb", "ent", "cif", "mmcif"].includes(extension)
      ? MAX_PREDICTION_RUN_COORDINATE_BYTES
      : MAX_PREDICTION_RUN_JSON_BYTES;
    if (file.bytes > limit) {
      throw new Error(`${path}: file size exceeds the ${(limit / (1024 * 1024)).toLocaleString()} MiB intake limit.`);
    }
    if (file.text != null && typeof file.text !== "string") {
      throw new Error(`${path}: decoded text must be a string or null.`);
    }
    if (file.text?.startsWith("\uFEFF")) {
      throw new Error(`${path}: UTF-8 byte-order marks are not supported. Save the file as BOM-free UTF-8.`);
    }
    if (file.text != null && new TextEncoder().encode(file.text).byteLength !== file.bytes) {
      throw new Error(`${path}: declared byte count does not match the decoded UTF-8 source.`);
    }
    return { ...file, path, sha256: requireSha256(file.sha256, path) };
  });
  const canonicalPaths = new Set<string>();
  for (const file of normalized) {
    const collisionKey = file.path.normalize("NFKC").toLocaleLowerCase("en-US");
    if (canonicalPaths.has(collisionKey)) {
      throw new Error(`${file.path}: duplicate or normalization-colliding upload path.`);
    }
    canonicalPaths.add(collisionKey);
  }
  const bytes = normalized.reduce((sum, file) => sum + file.bytes, 0);
  if (!Number.isSafeInteger(bytes) || bytes > MAX_PREDICTION_RUN_TOTAL_BYTES) {
    throw new Error("Prediction-run files exceed the 96 MiB recognized-input limit.");
  }
  const classifiedFiles = normalized.map((file) => classifyFile(file, file.path));
  const files = annotateAlphaFoldRootAliases(reconcileAmbiguousFoldCoordinates(classifiedFiles))
    .sort((left, right) => codeUnitCompare(left.path, right.path) || codeUnitCompare(left.sha256, right.sha256));
  const coordinateFiles = files.filter((file) => file.kind === "coordinate");
  if (!coordinateFiles.length) throw new Error("No supported text PDB or PDBx/mmCIF coordinate model was detected.");
  const includedCoordinateFiles = coordinateFiles.filter((file) => coordinateIncludedByDefault(file, overrides));
  if (!includedCoordinateFiles.length) {
    throw new Error("Prediction-run intake requires at least one included coordinate pose.");
  }
  if (includedCoordinateFiles.length > MAX_PREDICTION_RUN_POSES) {
    throw new Error(`Prediction-run intake detected ${includedCoordinateFiles.length} included coordinate poses; at most ${MAX_PREDICTION_RUN_POSES} are supported.`);
  }
  const coordinateBytes = includedCoordinateFiles.reduce((sum, file) => sum + file.bytes, 0);
  if (coordinateBytes > MAX_PREDICTION_RUN_COORDINATE_TOTAL_BYTES) {
    throw new Error("Prediction-run coordinate models exceed the 48 MiB aggregate coordinate limit.");
  }
  const validFileIds = new Set(files.map((file) => file.id));
  for (const [coordinateId, override] of Object.entries(overrides)) {
    if (!validFileIds.has(coordinateId)) throw new Error("A prediction-run pairing override targets an unknown coordinate file.");
    if (override.paeFileId != null && !validFileIds.has(override.paeFileId)) {
      throw new Error("A prediction-run pairing override targets an unknown PAE file.");
    }
  }
  const poses = createPoseRecords(files, overrides);
  const warnings = [
    "Native filename pairing is a proposed association, not proof of PAE residue-axis order. Confirm exact model and token order before PAE analysis.",
    "Boltz NPZ and AlphaFold pickle files are recognized for provenance but are never executed or parsed in the browser.",
    "Coordinate recurrence within an uploaded run does not establish pose correctness, binding, affinity, specificity, membrane compatibility, or receptor state.",
  ];
  return {
    schemaVersion: PREDICTION_RUN_MANIFEST_SCHEMA_VERSION,
    files,
    poses,
    totals: {
      fileCount: files.length,
      coordinateCount: coordinateFiles.length,
      paeJsonCount: files.filter((file) => file.kind === "pae-json").length,
      readyPoseCount: poses.filter((pose) => pose.status === "ready").length,
      reviewPoseCount: poses.filter((pose) => pose.status === "needs-review").length,
      excludedPoseCount: poses.filter((pose) => pose.status === "excluded").length,
      ignoredOrUnsupportedFileCount: files.filter((file) => !["coordinate", "pae-json"].includes(file.kind)).length,
      bytes,
      coordinateBytes,
    },
    warnings,
  };
}

export function predictionRunManifestForExport(manifest: PredictionRunManifest): Omit<PredictionRunManifest, "files"> & {
  files: Array<Omit<PredictionRunFileRecord, "text">>;
} {
  return {
    ...manifest,
    files: manifest.files.map(({ text, ...file }) => {
      void text;
      return file;
    }),
  };
}

export function predictionRunFileById(
  manifest: PredictionRunManifest,
  id: string | null,
): PredictionRunFileRecord | null {
  if (id == null) return null;
  return manifest.files.find((file) => file.id === id) ?? null;
}
