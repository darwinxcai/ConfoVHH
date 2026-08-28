"use client";

import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import {
  AlertTriangle,
  Check,
  CircleSlash2,
  Download,
  FileArchive,
  FileJson,
  FileSearch,
  ListFilter,
  FolderOpen,
  LoaderCircle,
  Play,
  ShieldCheck,
  SquareArrowOutUpRight,
  X,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InterfaceAudit, ParsedStructure } from "@/lib/confovhh";
import { safeDownloadFilename } from "@/lib/download";
import { sha256Hex } from "@/lib/sha256";
import {
  candidateShortlistToCsv,
  createCandidateShortlistReport,
  MAX_CANDIDATE_NOTE_LENGTH,
  type CandidateDecision,
  type CandidateDisposition,
} from "@/lib/candidate-shortlist";
import { Input } from "@/components/ui/input";
import {
  MAX_PREDICTION_RUN_FILES,
  MAX_PREDICTION_RUN_JSON_BYTES,
  MAX_PREDICTION_RUN_TOTAL_BYTES,
  createPredictionRunManifest,
  decodePredictionRunUtf8,
  normalizePredictionRunPath,
  predictionRunFileById,
  predictionRunManifestForExport,
  type PredictionRunFileRecord,
  type PredictionRunManifest,
  type PredictionRunPairOverride,
  type PredictionRunRawFile,
} from "@/lib/prediction-run";
import {
  createPredictionRunDossier,
  predictionRunPoseSummaryCsv,
  type PredictionRunAuditJob,
  type PredictionRunAuditPoseSource,
  type PredictionRunAuditResult,
  type PredictionRunProgress,
} from "@/lib/prediction-run-jobs";
import type {
  PredictionRunWorkerRequest,
  PredictionRunWorkerResponse,
} from "@/lib/prediction-run-worker-protocol";
import {
  canAcceptPredictionRunWorkerEvent,
  isCurrentPredictionRunGeneration,
  nextPredictionRunGeneration,
  nextPredictionRunProgress,
} from "@/lib/prediction-run-lifecycle";
import type { NormalizedTopologyAnnotation } from "@/lib/topology-annotation";

export interface PredictionRunOpenPoseRequest {
  coordinate: PredictionRunFileRecord;
  pae: PredictionRunFileRecord | null;
  chainSelection?: { receptor: string; vhh: string };
}

interface CommittedRun {
  manifest: PredictionRunManifest;
  result: PredictionRunAuditResult;
  topologyAnnotation: NormalizedTopologyAnnotation | null;
}

interface SkippedRunFile {
  path: string;
  bytes: number;
  reason: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function shaPrefix(sha256: string): string {
  return `${sha256.slice(0, 10)}…${sha256.slice(-6)}`;
}

function percent(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function angstrom(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)} Å`;
}

function downloadText(content: string, mimeType: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = safeDownloadFilename(filename);
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

async function digestBytes(bytes: ArrayBuffer): Promise<string> {
  return sha256Hex(bytes);
}

function selectedPath(file: File): string {
  return normalizePredictionRunPath(file.webkitRelativePath || file.name);
}

function isTextCandidate(path: string): boolean {
  return /\.(?:pdb|ent|cif|mmcif|json)$/iu.test(path);
}

function statusBadge(status: string) {
  if (status === "ready" || status === "audited") return <Badge className="run-status-ready"><Check /> {status}</Badge>;
  if (status === "excluded" || status === "not-provided") return <Badge variant="secondary"><CircleSlash2 /> {status.replace("-", " ")}</Badge>;
  return <Badge className="run-status-review"><AlertTriangle /> {status.replace("-", " ")}</Badge>;
}

function buildAuditSources(manifest: PredictionRunManifest): PredictionRunAuditPoseSource[] {
  return manifest.poses.filter((pose) => pose.included && pose.status === "ready").map((pose) => {
    const coordinate = predictionRunFileById(manifest, pose.coordinateFileId);
    const pae = predictionRunFileById(manifest, pose.paeFileId);
    if (!coordinate || coordinate.kind !== "coordinate" || coordinate.text == null) {
      throw new Error("A ready manifest pose is missing its decoded coordinate source.");
    }
    if (pae != null && (pae.kind !== "pae-json" || pae.text == null)) {
      throw new Error("A ready manifest pose has an unsupported or undecoded PAE association.");
    }
    const source = (file: PredictionRunFileRecord) => ({
      id: file.id,
      path: file.path,
      filename: file.filename,
      bytes: file.bytes,
      sha256: file.sha256,
      text: file.text as string,
    });
    return {
      id: pose.id,
      provider: pose.provider,
      poseKey: pose.poseKey,
      variant: pose.variant,
      associationBasis: pose.associationBasis,
      coordinate: source(coordinate),
      pae: pae == null ? null : source(pae),
    };
  });
}

export function PredictionRunIntake({
  currentCoordinateSha256,
  currentStructure,
  currentAudit,
  receptorChain,
  vhhChain,
  chainConfirmed,
  topologyAnnotation,
  topologyAnnotationError,
  onOpenPose,
  cancelToken = 0,
  resetToken = 0,
  onStatusChange,
}: {
  currentCoordinateSha256: string | null;
  currentStructure: ParsedStructure | null;
  currentAudit: InterfaceAudit | null;
  receptorChain: string;
  vhhChain: string;
  chainConfirmed: boolean;
  topologyAnnotation: NormalizedTopologyAnnotation | null;
  topologyAnnotationError: string | null;
  onOpenPose: (request: PredictionRunOpenPoseRequest) => Promise<void>;
  cancelToken?: number;
  resetToken?: number;
  onStatusChange?: (status: { hasDraft: boolean; hasCommitted: boolean; busy: boolean }) => void;
}) {
  const [rawFiles, setRawFiles] = useState<PredictionRunRawFile[] | null>(null);
  const [manifest, setManifest] = useState<PredictionRunManifest | null>(null);
  const [overrides, setOverrides] = useState<Record<string, PredictionRunPairOverride>>({});
  const [referenceCoordinateId, setReferenceCoordinateId] = useState<string | null>(null);
  const [paeConfirmed, setPaeConfirmed] = useState(false);
  const [scanning, setScanning] = useState<string | null>(null);
  const [progress, setProgress] = useState<PredictionRunProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [committed, setCommitted] = useState<CommittedRun | null>(null);
  const [candidateDecisions, setCandidateDecisions] = useState<Record<string, CandidateDecision>>({});
  const [resultFilter, setResultFilter] = useState<CandidateDisposition | "all">("all");
  const [resultQuery, setResultQuery] = useState("");
  const [skippedFiles, setSkippedFiles] = useState<SkippedRunFile[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const generationRef = useRef(0);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const cancelTokenRef = useRef(cancelToken);
  const resetTokenRef = useRef(resetToken);

  const cancelWorker = (announce = true) => {
    const wasScanning = Boolean(scanning);
    generationRef.current = nextPredictionRunGeneration(generationRef.current);
    workerRef.current?.terminate();
    workerRef.current = null;
    setScanning(null);
    setProgress(null);
    if (announce) setNotice(
      wasScanning
        ? "Prediction-run file scanning was cancelled. The last completed run and single-pose workspace were preserved."
        : "Prediction-run analysis was cancelled. The last completed run and single-pose workspace were preserved.",
    );
  };
  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);
  useEffect(() => {
    if (cancelTokenRef.current === cancelToken) return;
    cancelTokenRef.current = cancelToken;
    generationRef.current = nextPredictionRunGeneration(generationRef.current);
    workerRef.current?.terminate();
    workerRef.current = null;
    setScanning(null);
    setProgress(null);
    setNotice("Prediction-run work was cancelled from the global workspace control. The last committed run remains available.");
  }, [cancelToken]);
  useEffect(() => {
    if (resetTokenRef.current === resetToken) return;
    resetTokenRef.current = resetToken;
    generationRef.current = nextPredictionRunGeneration(generationRef.current);
    workerRef.current?.terminate();
    workerRef.current = null;
    setRawFiles(null);
    setManifest(null);
    setOverrides({});
    setReferenceCoordinateId(null);
    setPaeConfirmed(false);
    setScanning(null);
    setProgress(null);
    setError(null);
    setNotice(null);
    setCommitted(null);
    setCandidateDecisions({});
    setResultFilter("all");
    setResultQuery("");
    setSkippedFiles([]);
  }, [resetToken]);
  useEffect(() => {
    onStatusChange?.({
      hasDraft: manifest != null,
      hasCommitted: committed != null,
      busy: scanning != null || progress != null,
    });
  }, [committed, manifest, onStatusChange, progress, scanning]);
  useEffect(() => {
    if (!error) return;
    window.requestAnimationFrame(() => {
      errorRef.current?.focus({ preventScroll: true });
      errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [error]);

  const applyManifest = (
    files: PredictionRunRawFile[],
    nextOverrides: Record<string, PredictionRunPairOverride>,
  ) => {
    const next = createPredictionRunManifest(files, nextOverrides);
    setRawFiles(files);
    setOverrides(nextOverrides);
    setManifest(next);
    setPaeConfirmed(false);
    const currentReference = next.poses.find((pose) => (
      pose.coordinateFileId === referenceCoordinateId && pose.included && pose.status === "ready"
    ));
    if (!currentReference) {
      setReferenceCoordinateId(next.poses.find((pose) => pose.included && pose.status === "ready")?.coordinateFileId ?? null);
    }
  };

  const scanFiles = async (fileList: FileList | File[]) => {
    cancelWorker(false);
    setError(null);
    setNotice(null);
    const files = Array.from(fileList);
    if (!files.length) return;
    if (files.length > MAX_PREDICTION_RUN_FILES * 4) {
      setError(`Choose at most ${MAX_PREDICTION_RUN_FILES * 4} directory entries at once; at most ${MAX_PREDICTION_RUN_FILES} bounded files can enter one manifest.`);
      return;
    }
    const paths: string[] = [];
    try {
      for (const file of files) {
        const path = selectedPath(file);
        if (isTextCandidate(path)) {
          const coordinateLike = /\.(?:pdb|ent|cif|mmcif)$/iu.test(path);
          const limit = coordinateLike ? 12 * 1024 * 1024 : MAX_PREDICTION_RUN_JSON_BYTES;
          if (file.size > limit) {
            throw new Error(`${path} exceeds the ${coordinateLike ? 12 : 16} MiB supported text-input limit.`);
          }
        }
        paths.push(path);
      }
      const collisionKeys = paths.map((path) => path.normalize("NFKC").toLocaleLowerCase("en-US"));
      if (new Set(collisionKeys).size !== collisionKeys.length) {
        throw new Error("Selected paths contain a duplicate or Unicode/case-normalization collision.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Selected file paths are invalid.");
      return;
    }
    const readable = files.map((file, index) => ({ file, path: paths[index] })).filter(({ file, path }) => (
      isTextCandidate(path) || file.size <= MAX_PREDICTION_RUN_JSON_BYTES
    ));
    const skipped = files.map((file, index) => ({ file, path: paths[index] })).filter(({ file, path }) => (
      !isTextCandidate(path) && file.size > MAX_PREDICTION_RUN_JSON_BYTES
    )).map(({ file, path }) => ({
      path,
      bytes: file.size,
      reason: "Oversized unsupported binary was not read, hashed, or included in the scientific manifest.",
    }));
    if (readable.length > MAX_PREDICTION_RUN_FILES) {
      setError(`The selection contains ${readable.length} bounded files; at most ${MAX_PREDICTION_RUN_FILES} can enter one prediction-run manifest.`);
      return;
    }
    const readableBytes = readable.reduce((sum, entry) => sum + entry.file.size, 0);
    if (readableBytes > MAX_PREDICTION_RUN_TOTAL_BYTES) {
      setError("Recognized text and bounded metadata files exceed the 96 MiB prediction-run intake limit. Oversized unsupported binaries are excluded before this calculation.");
      return;
    }
    const currentGeneration = nextPredictionRunGeneration(generationRef.current);
    generationRef.current = currentGeneration;
    setScanning(`Reading 0/${readable.length} bounded files…`);
    try {
      const nextRaw: PredictionRunRawFile[] = [];
      for (let index = 0; index < readable.length; index += 1) {
        const { file, path } = readable[index];
        const bytes = await file.arrayBuffer();
        if (!isCurrentPredictionRunGeneration(generationRef.current, currentGeneration)) return;
        const sha256 = await digestBytes(bytes);
        if (!isCurrentPredictionRunGeneration(generationRef.current, currentGeneration)) return;
        nextRaw.push({
          path,
          bytes: file.size,
          sha256,
          text: isTextCandidate(path) ? decodePredictionRunUtf8(bytes, path) : null,
        });
        setScanning(`Reading ${index + 1}/${readable.length} bounded files…`);
      }
      if (!isCurrentPredictionRunGeneration(generationRef.current, currentGeneration)) return;
      applyManifest(nextRaw, {});
      setSkippedFiles(skipped);
      setNotice(
        `Local scan complete. Review every proposed association before opening the reference or auditing the run.` +
        (skipped.length ? ` ${skipped.length} oversized unsupported binar${skipped.length === 1 ? "y was" : "ies were"} listed separately and not read.` : ""),
      );
    } catch (caught) {
      if (!isCurrentPredictionRunGeneration(generationRef.current, currentGeneration)) return;
      setError(caught instanceof Error ? caught.message : "Prediction-run scan failed. The completed workspace is unchanged.");
    } finally {
      if (isCurrentPredictionRunGeneration(generationRef.current, currentGeneration)) setScanning(null);
    }
  };

  const changeOverride = (coordinateId: string, patch: PredictionRunPairOverride) => {
    if (!rawFiles) return;
    cancelWorker(false);
    setError(null);
    setNotice(null);
    const nextOverrides = {
      ...overrides,
      [coordinateId]: { ...overrides[coordinateId], ...patch },
    };
    try {
      applyManifest(rawFiles, nextOverrides);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The proposed pairing could not be updated.");
    }
  };

  const referencePose = manifest?.poses.find((pose) => pose.coordinateFileId === referenceCoordinateId) ?? null;
  const referenceFile = manifest ? predictionRunFileById(manifest, referenceCoordinateId) : null;
  const rawReferenceMatches = Boolean(
    referenceFile && currentCoordinateSha256 && referenceFile.sha256 === currentCoordinateSha256.toLowerCase(),
  );
  const referenceScopeCompatible = Boolean(
    currentStructure && currentStructure.coordinateScope === "as-supplied" && currentStructure.modelCount === 1,
  );
  const currentMatchesReference = rawReferenceMatches && referenceScopeCompatible;
  const readyPoses = manifest?.poses.filter((pose) => pose.included && pose.status === "ready") ?? [];
  const selectedPaeCount = readyPoses.filter((pose) => pose.paeFileId != null).length;
  const hasBlockingReview = Boolean(manifest?.poses.some((pose) => pose.included && pose.status === "needs-review"));
  const canOpenReference = Boolean(referencePose?.included && referencePose.status === "ready" && !scanning && !progress);
  const canAnalyze = Boolean(
    manifest && referencePose && readyPoses.length && !hasBlockingReview && currentMatchesReference &&
    currentStructure && currentAudit && chainConfirmed && !topologyAnnotationError &&
    (!selectedPaeCount || paeConfirmed) && !scanning && !progress,
  );

  const openReference = async () => {
    if (!manifest || !referencePose || !canOpenReference) return;
    const coordinate = predictionRunFileById(manifest, referencePose.coordinateFileId);
    if (!coordinate) return;
    setError(null);
    setNotice(null);
    try {
      await onOpenPose({ coordinate, pae: null });
      setNotice(
        `Opened ${coordinate.filename} coordinate-only as the reference. Confirm receptor/VHH chains below; the proposed PAE remains attached to the run and will be independently audited or quarantined during batch analysis.`,
      );
      window.requestAnimationFrame(() => {
        const workspace = document.getElementById("coordinate-setup");
        workspace?.focus({ preventScroll: true });
        workspace?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The reference pose could not be opened. The completed workspace is unchanged.");
    }
  };

  const analyzeRun = () => {
    if (!manifest || !referencePose || !canAnalyze) return;
    cancelWorker(false);
    setError(null);
    setNotice(null);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const generation = nextPredictionRunGeneration(generationRef.current);
    generationRef.current = generation;
    const sources = buildAuditSources(manifest);
    const job: PredictionRunAuditJob = {
      poses: sources,
      referenceCoordinateFileId: referencePose.coordinateFileId,
      referenceReceptorChain: receptorChain,
      referenceVhhChain: vhhChain,
      paeAssociationsAndOrderConfirmed: selectedPaeCount === 0 || paeConfirmed,
      topologyAnnotation,
    };
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("../lib/prediction-run-worker.ts", import.meta.url),
        { type: "module", name: "confovhh-prediction-run" },
      );
    } catch (caught) {
      setError(
        `${caught instanceof Error ? caught.message : "The prediction-run worker could not start."} ` +
        "The last completed run and single-pose workspace were preserved.",
      );
      return;
    }
    workerRef.current = worker;
    let finished = false;
    let timeoutId = window.setTimeout(() => {
      if (finished || !isCurrentPredictionRunGeneration(generationRef.current, generation)) return;
      finish();
      setProgress(null);
      setError("Prediction-run audit exceeded the three-minute browser limit. The last completed run and single-pose workspace were preserved.");
    }, 180_000);
    const finish = () => {
      if (finished) return false;
      finished = true;
      window.clearTimeout(timeoutId);
      timeoutId = 0;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      return true;
    };
    worker.onmessage = (event: MessageEvent<PredictionRunWorkerResponse>) => {
      if (!canAcceptPredictionRunWorkerEvent(
        generationRef.current,
        generation,
        requestId,
        event.data.requestId,
        finished,
      )) return;
      if (event.data.type === "progress") {
        setProgress((previous) => nextPredictionRunProgress(previous, event.data));
      } else if (event.data.type === "result") {
        finish();
        setProgress(null);
        setCommitted({ manifest, result: event.data.result, topologyAnnotation });
        setNotice(
          `Run complete: ${event.data.result.counts.coordinateAccepted} coordinate poses retained, ` +
          `${event.data.result.counts.paeAudited} with audited PAE, ${event.data.result.counts.paeRejected} PAE attachment${event.data.result.counts.paeRejected === 1 ? "" : "s"} rejected explicitly.`,
        );
        window.requestAnimationFrame(() => {
          const results = document.getElementById("prediction-run-results");
          results?.focus({ preventScroll: true });
          results?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      } else if (event.data.type === "error") {
        finish();
        setProgress(null);
        setError(`${event.data.error} The last completed run and single-pose workspace were preserved.`);
      } else {
        finish();
        setProgress(null);
        setError("Prediction-run worker returned an unexpected PAE-only response. The last completed run was preserved.");
      }
    };
    worker.onerror = (event) => {
      if (finished || !isCurrentPredictionRunGeneration(generationRef.current, generation)) return;
      finish();
      setProgress(null);
      setError(`${event.message || "Prediction-run worker stopped unexpectedly."} The last completed run was preserved.`);
    };
    worker.onmessageerror = () => {
      if (finished || !isCurrentPredictionRunGeneration(generationRef.current, generation)) return;
      finish();
      setProgress(null);
      setError("Prediction-run worker returned an unreadable result. The last completed run was preserved.");
    };
    const request: PredictionRunWorkerRequest = { requestId, type: "prediction-run", job };
    setProgress(nextPredictionRunProgress(null, {
      phase: "coordinate-recurrence",
      completed: 0,
      total: sources.length,
      filename: referenceFile?.filename ?? "reference",
    }));
    try {
      worker.postMessage(request);
    } catch (caught) {
      finish();
      setProgress(null);
      setError(
        `${caught instanceof Error ? caught.message : "The prediction-run request could not be transferred."} ` +
        "The last completed run and single-pose workspace were preserved.",
      );
    }
  };

  const exportManifest = () => {
    if (!manifest) return;
    try {
      downloadText(
        JSON.stringify(predictionRunManifestForExport(manifest), null, 2),
        "application/json",
        "confovhh_prediction_run_manifest.json",
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? `Prediction-run manifest export failed: ${caught.message}` : "Prediction-run manifest export failed.");
    }
  };
  const exportRun = (format: "json" | "csv") => {
    if (!committed) return;
    try {
      if (format === "json") {
        downloadText(
          JSON.stringify(createPredictionRunDossier(
            committed.manifest,
            committed.result,
            committed.topologyAnnotation,
          ), null, 2),
          "application/json",
          "confovhh_prediction_run_dossier.json",
        );
      } else {
        downloadText(
          predictionRunPoseSummaryCsv(committed.result),
          "text/csv;charset=utf-8",
          "confovhh_prediction_run_pose_summary.csv",
        );
      }
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? `Prediction-run ${format.toUpperCase()} export failed: ${caught.message}` : `Prediction-run ${format.toUpperCase()} export failed.`);
    }
  };
  const exportShortlist = (format: "json" | "csv") => {
    if (!committed) return;
    try {
      const report = createCandidateShortlistReport(committed.result, candidateDecisions);
      downloadText(
        format === "json" ? JSON.stringify(report, null, 2) : candidateShortlistToCsv(report),
        format === "json" ? "application/json" : "text/csv;charset=utf-8",
        `confovhh_candidate_shortlist.${format}`,
      );
      setNotice(`Researcher shortlist exported as ${format.toUpperCase()}.`);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? `Shortlist export failed: ${caught.message}` : "Shortlist export failed.");
    }
  };

  const directoryAttributes = {
    webkitdirectory: "",
    directory: "",
  } as InputHTMLAttributes<HTMLInputElement>;
  const paeFiles = manifest?.files.filter((file) => file.kind === "pae-json") ?? [];
  const rankByDigest = useMemo(() => new Map(
    committed?.result.coordinateEnsemble?.poses.map((pose) => [pose.sha256, pose.rank]) ?? [],
  ), [committed]);
  const draftChangedSinceCommit = Boolean(
    committed && manifest && JSON.stringify(predictionRunManifestForExport(committed.manifest)) !==
      JSON.stringify(predictionRunManifestForExport(manifest)) ||
    committed && JSON.stringify(committed.topologyAnnotation) !== JSON.stringify(topologyAnnotation),
  );
  const visiblePoseAudits = useMemo(() => {
    if (!committed) return [];
    const query = resultQuery.trim().toLocaleLowerCase();
    return committed.result.poseAudits.filter((pose) => {
      const decision = candidateDecisions[pose.id]?.disposition ?? "unreviewed";
      return (resultFilter === "all" || decision === resultFilter) && (
        !query || pose.coordinate.filename.toLocaleLowerCase().includes(query) ||
        pose.provider.toLocaleLowerCase().includes(query) || pose.coordinate.sha256.includes(query)
      );
    });
  }, [candidateDecisions, committed, resultFilter, resultQuery]);

  return (
    <section className="panel prediction-run-panel" id="prediction-run-intake" aria-labelledby="prediction-run-title">
      <div className="panel-heading prediction-run-heading">
        <div>
          <p className="eyebrow">Prediction-run batch audit</p>
          <h2 id="prediction-run-title">Audit an existing AlphaFold, ColabFold, or Boltz output run</h2>
          <p>
            ConfoVHH audits already-predicted complex coordinates. It does not accept FASTA sequences or run a structure predictor. Scan up to 12 poses locally, review every proposed PAE association, and produce one provenance-bound run dossier.
          </p>
        </div>
        <Badge variant="outline">product 0.8</Badge>
      </div>
      <ol className="run-workflow-steps" aria-label="Four-step prediction-run workflow">
        <li><span>1</span><div><strong>Choose output files</strong><small>Select a producer folder or the matching coordinate, confidence, and PAE files.</small></div></li>
        <li><span>2</span><div><strong>Review the manifest</strong><small>Resolve amber pairings, include poses, and choose one reference.</small></div></li>
        <li><span>3</span><div><strong>Audit the reference</strong><small>Open it below, confirm receptor/VHH chains, and run the single-pose audit.</small></div></li>
        <li><span>4</span><div><strong>Return and analyze</strong><small>ConfoVHH propagates only unique exact sequence matches; changed or ambiguous chains are rejected.</small></div></li>
      </ol>
      <details className="run-format-help">
        <summary>Which folder or files should I choose?</summary>
        <div>
          <p><strong>AlphaFold Server:</strong> the downloaded job folder containing <code>fold_*_model_*.cif</code> and matching <code>fold_*_full_data_*.json</code>.</p>
          <p><strong>Local AlphaFold 3:</strong> one output folder containing <code>*_model.cif</code> and <code>*_confidences.json</code>.</p>
          <p><strong>ColabFold:</strong> the result folder containing matched <code>*_unrelaxed_rank_*.pdb</code> or <code>*_relaxed_rank_*.pdb</code> and <code>*_scores_rank_*.json</code>.</p>
          <p><strong>Boltz:</strong> select <code>out_dir/predictions/&lt;input&gt;/</code>. Coordinates and confidence metadata are recognized. Native NPZ PAE is inventoried but not analyzed; continue coordinate-only unless you independently verified a compatible JSON matrix and its axes/order.</p>
          <p>Public generated-output regressions exercise genuine <a href="https://zenodo.org/records/17063524" target="_blank" rel="noreferrer">ColabFold-multimer coordinates and score JSON</a> plus a commit-pinned <a href="https://github.com/martinovein/AF3_MiniPAE/tree/a7458d1d26a35154cbfc3e24ec197352079970df/data/example/p06730_o60516" target="_blank" rel="noreferrer">AlphaFold Server coordinate/full-data run</a> end to end. Provider filenames propose associations—they never prove identity.</p>
        </div>
      </details>
      <div className="run-intake-actions">
        <label className="button-file-label primary-file-action">
          <FolderOpen /> Choose prediction folder
          <input
            type="file"
            multiple
            {...directoryAttributes}
            aria-label="Choose a prediction output folder"
            disabled={Boolean(scanning || progress)}
            onChange={(event) => {
              if (event.target.files) void scanFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <label className="button-file-label secondary-file-action">
          <FileSearch /> Choose multiple files
          <input
            type="file"
            multiple
            aria-label="Choose multiple prediction output files"
            disabled={Boolean(scanning || progress)}
            onChange={(event) => {
              if (event.target.files) void scanFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {manifest && <Button variant="outline" onClick={exportManifest}><Download /> Manifest JSON</Button>}
        {(scanning || progress) && (
          <Button variant="outline" onClick={() => cancelWorker()}>
            <X /> {scanning ? "Cancel scan" : "Cancel run"}
          </Button>
        )}
      </div>
      <p className="run-local-note">
        Files stay in this tab and are not uploaded. Limits: {MAX_PREDICTION_RUN_FILES} bounded files per manifest, 12 poses, 12 MiB/coordinate, 16 MiB/JSON, 48 MiB aggregate coordinates, 48 MiB selected PAE JSON, and 96 MiB recognized content. Oversized unsupported binaries are listed without being read; bounded NPZ/pickle is inventoried but never executed. Filename matching proposes an association; it never proves model identity or residue order.
      </p>

      {scanning && <div className="run-progress" role="status"><LoaderCircle className="animate-spin" /> {scanning}</div>}
      {progress && (
        <div
          className="run-progress"
          role="progressbar"
          aria-label="Prediction-run audit progress"
          aria-valuetext={`${progress.phase === "coordinate-recurrence" ? "Coordinate recurrence" : "Per-pose PAE audit"}: ${progress.completed} of ${progress.total}, ${progress.filename}`}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.completed}
        >
          <LoaderCircle className="animate-spin" />
          {progress.phase === "coordinate-recurrence" ? "Coordinate recurrence" : "Per-pose PAE audit"}: {progress.completed}/{progress.total} · {progress.filename}
        </div>
      )}
      {error && (
        <div ref={errorRef} tabIndex={-1} className="run-error-focus">
          <Alert variant="destructive" role="alert"><AlertTriangle /><AlertTitle>Prediction run needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
        </div>
      )}
      {notice && <Alert role="status"><ShieldCheck /><AlertTitle>Prediction run</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert>}

      {manifest && (
        <>
          <div className="run-summary" role="status" aria-label="Prediction-run manifest counts">
            <article><strong>{manifest.totals.coordinateCount}</strong><span>coordinate poses</span></article>
            <article><strong>{manifest.totals.paeJsonCount}</strong><span>PAE JSON files</span></article>
            <article><strong>{manifest.totals.readyPoseCount}</strong><span>ready</span></article>
            <article><strong>{manifest.totals.reviewPoseCount}</strong><span>need review</span></article>
            <article><strong>{manifest.totals.excludedPoseCount}</strong><span>excluded</span></article>
            <article><strong>{formatBytes(manifest.totals.bytes)}</strong><span>local input</span></article>
          </div>

          <fieldset className="run-pose-fieldset">
            <legend>Pose inclusion, reference, and PAE association</legend>
            <div className="run-pose-list">
              {manifest.poses.map((pose) => {
                const coordinate = predictionRunFileById(manifest, pose.coordinateFileId)!;
                const selectedPae = predictionRunFileById(manifest, pose.paeFileId);
                return (
                  <article className={`run-pose-card run-pose-${pose.status}`} key={pose.id}>
                    <div className="run-pose-card-head">
                      <label className="run-check">
                        <input
                          type="checkbox"
                          checked={pose.included}
                          onChange={(event) => changeOverride(pose.coordinateFileId, { included: event.target.checked })}
                        />
                        <span>Include</span>
                      </label>
                      <label className="run-reference">
                        <input
                          type="radio"
                          name="prediction-run-reference"
                          checked={referenceCoordinateId === pose.coordinateFileId}
                          disabled={!pose.included || pose.status !== "ready"}
                          onChange={() => {
                            setReferenceCoordinateId(pose.coordinateFileId);
                            setPaeConfirmed(false);
                          }}
                        />
                        <span>Reference</span>
                      </label>
                      {statusBadge(pose.status)}
                    </div>
                    <h3>{pose.poseLabel}{pose.variant ? ` · ${pose.variant}` : ""}</h3>
                    <p className="run-file-path">{coordinate.path}</p>
                    <dl className="run-file-meta">
                      <div><dt>Producer</dt><dd>{pose.provider}</dd></div>
                      <div><dt>Coordinate</dt><dd>{formatBytes(coordinate.bytes)} · {shaPrefix(coordinate.sha256)}</dd></div>
                      <div><dt>Pairing</dt><dd>{pose.associationBasis.replaceAll("-", " ")}</dd></div>
                    </dl>
                    <label className="run-pae-select">
                      <span>Per-pose PAE</span>
                      <Select
                        value={pose.paeFileId ?? (pose.associationBasis === "unresolved" ? "unresolved" : "coordinate-only")}
                        disabled={!pose.included}
                        onValueChange={(value) => changeOverride(pose.coordinateFileId, {
                          paeFileId: value === "coordinate-only" ? null : value,
                        })}
                      >
                        <SelectTrigger aria-label={`PAE association for ${coordinate.filename}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {pose.associationBasis === "unresolved" && <SelectItem value="unresolved" disabled>PAE decision required</SelectItem>}
                          <SelectItem value="coordinate-only">Continue explicitly coordinate-only</SelectItem>
                          {paeFiles.map((file) => <SelectItem key={file.id} value={file.id}>{file.path}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </label>
                    {selectedPae && <p className="run-pae-detail"><FileJson /> {formatBytes(selectedPae.bytes)} · {shaPrefix(selectedPae.sha256)}</p>}
                    {pose.unsupportedPaeFileId && (
                      <p className="run-pose-warning">Native binary PAE is inventory-only. Use coordinates only unless a compatible JSON matrix and its axes/order were independently verified.</p>
                    )}
                    {pose.issues.map((issue) => <p className="run-pose-warning" key={issue}>{issue}</p>)}
                  </article>
                );
              })}
            </div>
          </fieldset>

          <details className="run-file-ledger">
            <summary>Complete file ledger · {manifest.files.length} files</summary>
            <Table containerLabel="Scrollable prediction-run file ledger">
              <TableHeader><TableRow><TableHead>Path</TableHead><TableHead>Detected type</TableHead><TableHead>Provider</TableHead><TableHead>Bytes / SHA-256</TableHead><TableHead>Disposition</TableHead></TableRow></TableHeader>
              <TableBody>
                {manifest.files.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell className="run-file-path">{file.path}</TableCell>
                    <TableCell>{file.kind.replaceAll("-", " ")}</TableCell>
                    <TableCell>{file.provider}</TableCell>
                    <TableCell>{formatBytes(file.bytes)}<br /><code>{shaPrefix(file.sha256)}</code></TableCell>
                    <TableCell>{file.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </details>

          {skippedFiles.length > 0 && (
            <details className="run-file-ledger run-skipped-ledger">
              <summary>Oversized unsupported binaries excluded before manifest · {skippedFiles.length}</summary>
              <Table containerLabel="Scrollable excluded binary file ledger">
                <TableHeader><TableRow><TableHead>Path</TableHead><TableHead>Bytes</TableHead><TableHead>Disposition</TableHead></TableRow></TableHeader>
                <TableBody>
                  {skippedFiles.map((file) => (
                    <TableRow key={file.path}>
                      <TableCell className="run-file-path">{file.path}</TableCell>
                      <TableCell>{formatBytes(file.bytes)}</TableCell>
                      <TableCell>{file.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </details>
          )}

          <div className="run-confirmation">
            <div>
              <strong>Reference and chain gate</strong>
              <p>{currentMatchesReference
                ? chainConfirmed && currentAudit
                  ? `Reference is open and chains ${receptorChain} / ${vhhChain} have a completed audit.`
                  : "Reference is open. Confirm receptor/VHH chains and complete its single-pose audit below."
                : rawReferenceMatches && !referenceScopeCompatible
                  ? "The matching source is open in a changed model or deposited-assembly scope. Reopen it as supplied; run inputs must contain exactly one coordinate model."
                : "Open the explicit reference pose, then confirm its receptor/VHH chains in the single-pose workspace."}</p>
            </div>
            <Button variant="outline" onClick={() => void openReference()} disabled={!canOpenReference}>
              <SquareArrowOutUpRight /> {currentMatchesReference ? "Reopen reference" : "Open reference pose"}
            </Button>
          </div>
          {selectedPaeCount > 0 && (
            <label className="run-order-confirmation">
              <input type="checkbox" checked={paeConfirmed} onChange={(event) => setPaeConfirmed(event.target.checked)} />
              <span>
                <strong>Confirm {selectedPaeCount} PAE association{selectedPaeCount === 1 ? "" : "s"} and residue axes</strong>
                I confirm each listed JSON came from its paired coordinate sample; both axes follow that model&apos;s complete parsed protein-residue order; and the AlphaFold convention applies: row is the alignment-frame residue and column is the evaluated residue. Filename and dimension matching alone are not proof. Exact metadata is checked when present; any failed mapping is quarantined.
              </span>
            </label>
          )}
          <div className="run-analysis-cta">
            <Button onClick={analyzeRun} disabled={!canAnalyze}>
              <Play /> Analyze {readyPoses.length} selected pose{readyPoses.length === 1 ? "" : "s"}
            </Button>
            {!canAnalyze && (
              <p>
                {hasBlockingReview
                  ? "Resolve or exclude every amber pose first."
                  : topologyAnnotationError
                    ? "Resolve the supplied topology annotation conflict before auditing the run."
                  : !currentMatchesReference || !chainConfirmed || !currentAudit
                    ? "Open the reference, confirm chains, and complete its single-pose audit first."
                    : selectedPaeCount && !paeConfirmed
                      ? "Confirm all proposed PAE associations and axis order first."
                      : "Choose at least one ready pose and an explicit reference."}
              </p>
            )}
          </div>
          <Alert className="run-boundary" role="note">
            <AlertTriangle />
            <AlertTitle>Evidence boundary</AlertTitle>
            <AlertDescription>
              PAE never changes recurrence rank. Native filenames propose association but do not prove model identity or residue order. Recurrence can reproduce a consistently wrong pose and does not establish binding or membrane compatibility.
              The conservative PAE summary uses the larger direction for each coordinate-defined contact, and the ≤10 Å share is a descriptive ConfoVHH rule—not a validated cutoff or native predictor score. Different poses can contain different contact sets, and cross-engine values may not be comparable.
            </AlertDescription>
          </Alert>
        </>
      )}

      {committed && (
        <section className="run-results" id="prediction-run-results" tabIndex={-1} aria-labelledby="prediction-run-results-title">
          {draftChangedSinceCommit && (
            <Alert className="run-snapshot-warning" role="note">
              <AlertTriangle />
              <AlertTitle>Draft changed after this run completed</AlertTitle>
              <AlertDescription>
                The table and exports below remain bound to the previous committed manifest. Analyze the current draft to replace this snapshot.
              </AlertDescription>
            </Alert>
          )}
          <div className="run-results-head">
            <div>
              <p className="eyebrow">Last committed run · immutable snapshot</p>
              <h2 id="prediction-run-results-title">Per-pose coordinate and PAE audit</h2>
              <p>
                {committed.result.counts.coordinateAccepted} retained · {committed.result.counts.paeAudited} with audited PAE · {committed.result.counts.paeNotProvided} coordinate-only · {committed.result.counts.paeRejected} PAE rejected
              </p>
            </div>
            <div className="run-export-actions">
              <Button onClick={() => exportRun("json")}><FileArchive /> Snapshot dossier</Button>
              <Button variant="outline" onClick={() => exportRun("csv")}><Download /> Pose CSV</Button>
              <Button variant="outline" onClick={() => exportShortlist("json")}><Download /> Shortlist JSON</Button>
              <Button variant="outline" onClick={() => exportShortlist("csv")}><Download /> Shortlist CSV</Button>
            </div>
          </div>
          <div className="candidate-review-toolbar" aria-label="Candidate review controls">
            <label><span>Find pose</span><Input value={resultQuery} maxLength={160} placeholder="Filename, provider, or SHA-256" onChange={(event) => setResultQuery(event.target.value)} /></label>
            <label><span><ListFilter /> Disposition</span><Select value={resultFilter} onValueChange={(value) => setResultFilter(value as CandidateDisposition | "all")}><SelectTrigger aria-label="Filter candidates by disposition"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All candidates</SelectItem><SelectItem value="unreviewed">Unreviewed</SelectItem><SelectItem value="advance">Advance</SelectItem><SelectItem value="hold">Hold</SelectItem><SelectItem value="reject">Reject</SelectItem></SelectContent></Select></label>
            <p><strong>{visiblePoseAudits.length}</strong> of {committed.result.poseAudits.length} shown. Decisions remain local to this tab until exported.</p>
          </div>
          <Table containerLabel="Scrollable prediction-run pose audit table">
            <TableHeader>
              <TableRow>
                <TableHead>Pose</TableHead><TableHead>Researcher decision</TableHead><TableHead>Recurrence</TableHead><TableHead>Coordinate audit</TableHead>
                <TableHead>PAE status</TableHead><TableHead>Directional medians</TableHead><TableHead>≤10 Å share</TableHead>
                <TableHead>Annotated footprint</TableHead><TableHead>Inspect</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiblePoseAudits.map((pose) => (
                <TableRow key={pose.id}>
                  <TableCell>
                    <strong>{pose.coordinate.filename}</strong>{pose.isReference && <Badge variant="outline">reference</Badge>}
                    <small>{pose.provider} · {shaPrefix(pose.coordinate.sha256)}</small>
                  </TableCell>
                  <TableCell className="candidate-decision-cell">
                    <Select value={candidateDecisions[pose.id]?.disposition ?? "unreviewed"} onValueChange={(value) => setCandidateDecisions((current) => ({ ...current, [pose.id]: { disposition: value as CandidateDisposition, note: current[pose.id]?.note ?? "" } }))}>
                      <SelectTrigger aria-label={`Researcher disposition for ${pose.coordinate.filename}`}><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="unreviewed">Unreviewed</SelectItem><SelectItem value="advance">Advance</SelectItem><SelectItem value="hold">Hold</SelectItem><SelectItem value="reject">Reject</SelectItem></SelectContent>
                    </Select>
                    <Input aria-label={`Researcher note for ${pose.coordinate.filename}`} maxLength={MAX_CANDIDATE_NOTE_LENGTH} placeholder="Why? Next experiment?" value={candidateDecisions[pose.id]?.note ?? ""} onChange={(event) => setCandidateDecisions((current) => ({ ...current, [pose.id]: { disposition: current[pose.id]?.disposition ?? "unreviewed", note: event.target.value } }))} />
                  </TableCell>
                  <TableCell>{rankByDigest.get(pose.coordinate.sha256) ? `rank ${rankByDigest.get(pose.coordinate.sha256)}` : "single pose"}</TableCell>
                  <TableCell>{pose.singleAudit.audit.evidenceLevel}<small>{pose.singleAudit.audit.contactPairCount} contacts · {pose.singleAudit.audit.severeClashCount} severe overlaps</small></TableCell>
                  <TableCell>{statusBadge(pose.pae.status)}{pose.pae.reason && <small>{pose.pae.reason}</small>}</TableCell>
                  <TableCell>
                    <span>R aligned: {angstrom(pose.pae.receptorAlignedVhhEvaluatedMedianAngstrom)}</span>
                    <small>VHH aligned: {angstrom(pose.pae.vhhAlignedReceptorEvaluatedMedianAngstrom)} · conservative {angstrom(pose.pae.conservativeLargerDirectionMedianAngstrom)}</small>
                  </TableCell>
                  <TableCell>{percent(pose.pae.contactPairShareAtOrBelow10Angstrom)}</TableCell>
                  <TableCell>
                    {pose.topology?.status.replaceAll("-", " ") ?? "not supplied"}
                    {pose.topology && (
                      <small>
                        {percent(pose.topology.annotationCoverage)} annotated · {percent(pose.topology.sideEvaluableCoverage)} side-evaluable
                        {pose.topology.intendedSide === "unspecified"
                          ? " · no intended side supplied"
                          : ` · ${pose.topology.intendedSideContactResidueCount ?? 0}/${pose.topology.extracellularContactResidueCount + pose.topology.intracellularContactResidueCount} side-evaluable contacts on intended side`}
                      </small>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const coordinate = predictionRunFileById(committed.manifest, pose.coordinate.fileId);
                        const pae = pose.pae.status === "audited" ? predictionRunFileById(committed.manifest, pose.pae.fileId) : null;
                        if (!coordinate) return;
                        setError(null);
                        setNotice(null);
                        void onOpenPose({
                          coordinate,
                          pae,
                          chainSelection: { receptor: pose.chains.receptor, vhh: pose.chains.vhh },
                        }).then(() => {
                          setNotice(`${coordinate.filename} was reloaded into the single-pose workspace with its audited chain selection. Confirm the propagated chain roles before extending the analysis.`);
                          window.requestAnimationFrame(() => {
                            const workspace = document.getElementById("coordinate-setup");
                            workspace?.focus({ preventScroll: true });
                            workspace?.scrollIntoView({ behavior: "smooth", block: "start" });
                          });
                        }).catch((caught) => {
                          setError(caught instanceof Error ? caught.message : `${coordinate.filename} could not be opened.`);
                        });
                      }}
                      aria-label={`Reload ${pose.coordinate.filename} into the single-pose workspace`}
                    >
                      <SquareArrowOutUpRight /> {pose.pae.status === "rejected" ? "Open coordinate-only" : "Open pose"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!visiblePoseAudits.length && <TableRow><TableCell colSpan={9}>No candidates match the current review filter.</TableCell></TableRow>}
            </TableBody>
          </Table>
          {committed.result.coordinateRejected.length > 0 && (
            <Alert className="run-rejections">
              <AlertTriangle />
              <AlertTitle>{committed.result.coordinateRejected.length} coordinate pose{committed.result.coordinateRejected.length === 1 ? " was" : "s were"} excluded from recurrence</AlertTitle>
              <AlertDescription>{committed.result.coordinateRejected.map((entry) => `${entry.filename}: ${entry.reason}`).join(" · ")}</AlertDescription>
            </Alert>
          )}
        </section>
      )}
    </section>
  );
}
