"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Atom,
  CheckCircle2,
  CircleHelp,
  Download,
  FileCode2,
  FlaskConical,
  Layers3,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
  XCircle,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  CONFOVHH_VERSION,
  type ConfidenceMode,
  type EvidenceLevel,
  type InterfaceAudit,
  type ParsedPae,
  type ParsedStructure,
  suggestChains,
} from "@/lib/confovhh";
import type {
  EnsembleAuditJobResult,
  EnsembleCoordinateFile,
  ParseCoordinateJob,
  ParsePaeJob,
  RejectedEnsemblePose,
  SingleAuditJob,
  StatePairAuditJobResult,
} from "@/lib/audit-jobs";
import type {
  AuditWorkerRequest,
  AuditWorkerResponse,
} from "@/lib/audit-worker-protocol";
import {
  createPoseEnsembleExportReport,
  MAX_ENSEMBLE_POSES,
  poseEnsembleToCsv,
  type PoseEnsembleSummary,
} from "@/lib/pose-ensemble";
import { createSingleAuditExportReport } from "@/lib/audit-export";
import { safeDownloadFilename } from "@/lib/download";
import { ValidationRecord } from "@/components/validation-record";
import { StatePairPanel } from "@/components/state-pair-panel";
import { ContactExplorer } from "@/components/contact-explorer";
import { PaeExplorer } from "@/components/pae-explorer";
import { IntendedFootprintPanel } from "@/components/intended-footprint";
import {
  PredictionRunIntake,
  type PredictionRunOpenPoseRequest,
} from "@/components/prediction-run-intake";
import {
  EMPTY_TOPOLOGY_ANNOTATION,
  TopologyAnnotationPanel,
  computeTopologyAnnotation,
} from "@/components/topology-annotation";
import {
  AuditDecisionSummary,
  DossierImportControl,
  EnsembleConsensusMatrix,
  EntryWorkflowCards,
  ImportedDossier,
  NotebookPanel,
  ResearchContextPanel,
  WorkspaceNavigator,
} from "@/components/research-workspace";
import { createStatePairExportReport } from "@/lib/state-pair";
import {
  CONFOVHH_PRODUCT_RELEASE,
  createHandoffMarkdown,
  createNotebookEntry,
  createNotebookExport,
  createWorkspaceBundle,
  deriveCoordinateTriageBrief,
  normalizeNotebookEntries,
  parseNotebookExport,
  parseWorkspaceBundle,
  upsertNotebookEntry,
  type NotebookEntry,
  type ResearchContext,
  type WorkspaceBundle,
} from "@/lib/research-workspace";
import { analyzeIntendedFootprint } from "@/lib/user-footprint";
import { sha256Hex } from "@/lib/sha256";
import type { PredictionRunAuditSourceFile } from "@/lib/prediction-run-jobs";
import type {
  PredictionRunWorkerRequest,
  PredictionRunWorkerResponse,
} from "@/lib/prediction-run-worker-protocol";
import type { UserTopologyAnnotationInput } from "@/lib/topology-annotation";

const DEMO_URL = "https://files.rcsb.org/download/3P0G.cif";
const MAX_COORDINATE_FILE_BYTES = 12 * 1024 * 1024;
const MAX_ENSEMBLE_TOTAL_BYTES = 48 * 1024 * 1024;
export const MAX_VIEWPORT_TRACE_POINTS_PER_CHAIN = 1_500;
export const MAX_VIEWPORT_INTERFACE_MARKERS = 500;
const AS_SUPPLIED_SCOPE = "__as_supplied__";
const NOTEBOOK_STORAGE_KEY = "confovhh:summary-notebook:v1";
const EMPTY_RESEARCH_CONTEXT: ResearchContext = {
  studyName: "",
  receptorName: "",
  candidateId: "",
  coordinateContext: "",
  intendedFootprint: "",
  notes: "",
};

interface ViewportPoint {
  x: number;
  y: number;
  key: string;
  segmentId: number;
  interface: boolean;
}

interface ViewportSourcePoint {
  x: number;
  y: number;
  z: number;
  key: string;
  segmentId: number;
  interface: boolean;
}

export function deterministicViewportSample<T>(
  values: readonly T[],
  maximumCount: number,
): T[] {
  if (!Number.isSafeInteger(maximumCount) || maximumCount < 0) {
    throw new Error("Viewport sample size must be a non-negative safe integer.");
  }
  if (values.length <= maximumCount) return [...values];
  if (maximumCount === 0) return [];
  if (maximumCount === 1) return [values[0]];
  return Array.from({ length: maximumCount }, (_, index) => (
    values[Math.floor(index * (values.length - 1) / (maximumCount - 1))]
  ));
}

export function viewportTracePath(points: readonly ViewportPoint[]): string {
  return points.map((point, index) => {
    const previous = index > 0 ? points[index - 1] : null;
    const command = previous?.segmentId === point.segmentId ? "L" : "M";
    return `${command}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(" ");
}

export async function readBoundedResponseBytes(
  response: Response,
  maximumBytes: number,
  label = "Response",
): Promise<ArrayBuffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new Error("Response byte limit must be a non-negative safe integer.");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength != null) {
    const normalizedLength = declaredLength.trim();
    if (!/^\d+$/.test(normalizedLength)) {
      throw new Error(`${label} returned an invalid Content-Length header.`);
    }
    const parsedLength = Number(normalizedLength);
    if (!Number.isSafeInteger(parsedLength)) {
      throw new Error(`${label} returned an unsafe Content-Length header.`);
    }
    if (parsedLength > maximumBytes) {
      throw new Error(`${label} is larger than the 12 MiB browser-analysis limit.`);
    }
  }
  if (!response.body) return new ArrayBuffer(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumBytes) {
        await reader.cancel("Response exceeded the browser-analysis byte limit.").catch(() => {});
        throw new Error(`${label} is larger than the 12 MiB browser-analysis limit.`);
      }
      if (value.byteLength > 0) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

const evidenceLabel: Record<EvidenceLevel, string> = {
  supported: "Coherent candidate geometry",
  mixed: "Mixed coordinate evidence",
  limited: "Weak coordinate evidence",
  "not-assessable": "No assessable interface",
};

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="metric-card">
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      <p className="metric-detail">{detail}</p>
    </article>
  );
}

function FindingIcon({ level }: { level: InterfaceAudit["findings"][number]["level"] }) {
  if (level === "supported") return <CheckCircle2 className="size-4 text-teal-300" />;
  if (level === "limited") return <XCircle className="size-4 text-rose-300" />;
  if (level === "review") return <AlertTriangle className="size-4 text-amber-300" />;
  return <CircleHelp className="size-4 text-slate-400" />;
}

function StructureViewport({
  structure,
  receptorChain,
  vhhChain,
  audit,
}: {
  structure: ParsedStructure | null;
  receptorChain: string;
  vhhChain: string;
  audit: InterfaceAudit | null;
}) {
  const [yaw, setYaw] = useState(-0.5);
  const [pitch, setPitch] = useState(0.25);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const width = 720;
  const height = 420;

  const viewportModel = useMemo(() => {
    if (!structure || !receptorChain || !vhhChain) return null;
    const receptor = structure.chains.find((chain) => chain.id === receptorChain);
    const vhh = structure.chains.find((chain) => chain.id === vhhChain);
    if (!receptor || !vhh) return null;
    const selected = [receptor, vhh];
    const alphaCarbons = selected.flatMap((chain) =>
      chain.residues.flatMap((residue) => {
        const atom = residue.atoms.find((candidate) => candidate.name === "CA");
        return atom ? [{ ...atom, residueKey: residue.key }] : [];
      }),
    );
    if (!alphaCarbons.length) return null;
    const center = alphaCarbons.reduce(
      (sum, atom) => ({ x: sum.x + atom.x, y: sum.y + atom.y, z: sum.z + atom.z }),
      { x: 0, y: 0, z: 0 },
    );
    center.x /= alphaCarbons.length;
    center.y /= alphaCarbons.length;
    center.z /= alphaCarbons.length;
    const receptorInterface = new Set(audit?.receptorInterfaceKeys ?? []);
    const vhhInterface = new Set(audit?.vhhInterfaceKeys ?? []);
    const completeTraces = selected.map((chain) => {
      let segmentId = 0;
      let previousAtom: (typeof alphaCarbons)[number] | null = null;
      const points = alphaCarbons
        .filter((atom) => atom.chainId === chain.id)
        .map((atom) => {
          if (previousAtom) {
            const sourceDistance = Math.hypot(
              atom.x - previousAtom.x,
              atom.y - previousAtom.y,
              atom.z - previousAtom.z,
            );
            if (atom.residueOrder !== previousAtom.residueOrder + 1 || sourceDistance > 8) {
              segmentId += 1;
            }
          }
          previousAtom = atom;
          return {
            x: atom.x,
            y: atom.y,
            z: atom.z,
            key: atom.residueKey,
            segmentId,
            interface: chain.id === receptorChain
              ? receptorInterface.has(atom.residueKey)
              : vhhInterface.has(atom.residueKey),
          } satisfies ViewportSourcePoint;
        });
      return { id: chain.id, points };
    });
    return {
      center,
      traces: completeTraces.map((trace) => ({
        id: trace.id,
        points: deterministicViewportSample(
          trace.points,
          MAX_VIEWPORT_TRACE_POINTS_PER_CHAIN,
        ),
      })),
      interfaceMarkers: deterministicViewportSample(
        completeTraces.flatMap((trace) => trace.points
          .filter((point) => point.interface)
          .map((point) => ({ ...point, markerKey: `${trace.id}:${point.key}` }))),
        MAX_VIEWPORT_INTERFACE_MARKERS,
      ),
    };
  }, [structure, receptorChain, vhhChain, audit]);

  const scene = useMemo(() => {
    if (!viewportModel) return null;
    const { center } = viewportModel;
    const rotate = (x: number, y: number, z: number) => {
      const translatedX = x - center.x;
      const translatedY = y - center.y;
      const translatedZ = z - center.z;
      const xYaw = translatedX * Math.cos(yaw) + translatedZ * Math.sin(yaw);
      const zYaw = -translatedX * Math.sin(yaw) + translatedZ * Math.cos(yaw);
      const yPitch = translatedY * Math.cos(pitch) - zYaw * Math.sin(pitch);
      const zPitch = translatedY * Math.sin(pitch) + zYaw * Math.cos(pitch);
      return { x: xYaw, y: yPitch, z: zPitch };
    };
    const rotatedTraces = viewportModel.traces.map((trace) => ({
      id: trace.id,
      points: trace.points.map((point) => ({
        source: point,
        rotated: rotate(point.x, point.y, point.z),
      })),
    }));
    const rotatedMarkers = viewportModel.interfaceMarkers.map((point) => ({
      source: point,
      rotated: rotate(point.x, point.y, point.z),
    }));
    let extent = 1;
    for (const point of [
      ...rotatedTraces.flatMap((trace) => trace.points.map(({ rotated }) => rotated)),
      ...rotatedMarkers.map(({ rotated }) => rotated),
    ]) {
      extent = Math.max(extent, Math.abs(point.x), Math.abs(point.y));
    }
    const scale = (Math.min(width, height) * 0.4) / extent;
    return {
      traces: rotatedTraces.map((trace) => ({
        id: trace.id,
        path: viewportTracePath(trace.points.map(({ source, rotated }) => ({
          x: width / 2 + rotated.x * scale,
          y: height / 2 - rotated.y * scale,
          key: source.key,
          segmentId: source.segmentId,
          interface: source.interface,
        }))),
      })),
      interfaceMarkers: rotatedMarkers.map(({ source, rotated }) => ({
        x: width / 2 + rotated.x * scale,
        y: height / 2 - rotated.y * scale,
        markerKey: source.markerKey,
      })),
    };
  }, [viewportModel, yaw, pitch]);

  if (!scene) {
    return (
      <div className="structure-empty">
        <div className="molecule-mark" aria-hidden="true"><span /><span /><span /></div>
        <p>Import text PDB or PDBx/mmCIF coordinates to inspect chains and interface geometry.</p>
      </div>
    );
  }

  return (
    <div className="structure-stage">
      <div className="viewer-toolbar">
        <div className="viewer-legend" aria-label="Structure color legend">
          <span><i className="legend-receptor" />Receptor</span>
          <span><i className="legend-vhh" />VHH</span>
          <span><i className="legend-interface" />Interface</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Reset structure view"
          onClick={() => { setYaw(-0.5); setPitch(0.25); }}
        >
          <RotateCcw /> <span className="button-label">Reset view</span>
        </Button>
      </div>
      <svg
        className="structure-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="application"
        tabIndex={0}
        aria-label="Interactive alpha-carbon trace. Drag to rotate, or use the arrow keys."
        aria-describedby="viewer-hint"
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const dx = event.clientX - drag.current.x;
          const dy = event.clientY - drag.current.y;
          drag.current = { x: event.clientX, y: event.clientY };
          setYaw((value) => value + dx * 0.01);
          setPitch((value) => Math.max(-1.4, Math.min(1.4, value + dy * 0.01)));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            setYaw((value) => value + (event.key === "ArrowLeft" ? -0.12 : 0.12));
          }
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            setPitch((value) => Math.max(
              -1.4,
              Math.min(1.4, value + (event.key === "ArrowUp" ? -0.12 : 0.12)),
            ));
          }
        }}
      >
        {scene.traces.map((trace) => (
          <path
            key={trace.id}
            d={trace.path}
            fill="none"
            className={trace.id === receptorChain ? "trace-receptor" : "trace-vhh"}
          />
        ))}
        {scene.interfaceMarkers.map((point) => (
          <circle
            key={point.markerKey}
            cx={point.x}
            cy={point.y}
            r="3.2"
            className="trace-interface"
          />
        ))}
      </svg>
      <p className="viewer-hint" id="viewer-hint">
        Drag or arrow keys to rotate · view capped at {MAX_VIEWPORT_TRACE_POINTS_PER_CHAIN} Cα points/chain and {MAX_VIEWPORT_INTERFACE_MARKERS} interface markers · audit metrics and exports use the complete parsed coordinates
      </p>
    </div>
  );
}

export default function Home() {
  const [filename, setFilename] = useState<string | null>(null);
  const [structure, setStructure] = useState<ParsedStructure | null>(null);
  const [coordinateSha256, setCoordinateSha256] = useState<string | null>(null);
  const [coordinateBytes, setCoordinateBytes] = useState<number | null>(null);
  const [pae, setPae] = useState<ParsedPae | null>(null);
  const [paeSha256, setPaeSha256] = useState<string | null>(null);
  const [paeOrderConfirmed, setPaeOrderConfirmed] = useState(false);
  const [receptorChain, setReceptorChain] = useState("");
  const [vhhChain, setVhhChain] = useState("");
  const [confidenceMode, setConfidenceMode] = useState<ConfidenceMode>("none");
  const [chainConfirmed, setChainConfirmed] = useState(false);
  const [audit, setAudit] = useState<InterfaceAudit | null>(null);
  const [ensemble, setEnsemble] = useState<PoseEnsembleSummary | null>(null);
  const [ensembleRejected, setEnsembleRejected] = useState<RejectedEnsemblePose[]>([]);
  const [ensembleMode, setEnsembleMode] = useState<string | null>(null);
  const [statePairResult, setStatePairResult] = useState<StatePairAuditJobResult | null>(null);
  const [topologyInput, setTopologyInput] = useState<UserTopologyAnnotationInput>(EMPTY_TOPOLOGY_ANNOTATION);
  const [researchContext, setResearchContext] = useState<ResearchContext>(EMPTY_RESEARCH_CONTEXT);
  const [notebookEntries, setNotebookEntries] = useState<NotebookEntry[]>([]);
  const [importedDossier, setImportedDossier] = useState<WorkspaceBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [cancelToken, setCancelToken] = useState(0);
  const [predictionRunResetToken, setPredictionRunResetToken] = useState(0);
  const [predictionRunStatus, setPredictionRunStatus] = useState({ hasDraft: false, hasCommitted: false, busy: false });
  const operationId = useRef(0);
  const coordinateText = useRef<string | null>(null);
  const demoAbort = useRef<AbortController | null>(null);
  const analysisWorker = useRef<Worker | null>(null);
  const analysisWorkerReject = useRef<((error: Error) => void) | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);
  const ensembleRef = useRef<HTMLElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const topologyState = useMemo(() => {
    try {
      return {
        analysis: computeTopologyAnnotation(structure, receptorChain, audit, topologyInput),
        error: null as string | null,
      };
    } catch (caught) {
      return {
        analysis: null,
        error: caught instanceof Error ? caught.message : "The supplied topology annotation is invalid.",
      };
    }
  }, [structure, receptorChain, audit, topologyInput]);

  const cancelAnalysisWorker = (message = "The background operation was cancelled.") => {
    const worker = analysisWorker.current;
    const reject = analysisWorkerReject.current;
    analysisWorker.current = null;
    analysisWorkerReject.current = null;
    worker?.terminate();
    reject?.(new Error(message));
  };

  useEffect(() => () => {
    operationId.current += 1;
    const worker = analysisWorker.current;
    const reject = analysisWorkerReject.current;
    analysisWorker.current = null;
    analysisWorkerReject.current = null;
    worker?.terminate();
    reject?.(new Error("The ConfoVHH workspace was closed."));
    demoAbort.current?.abort();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(NOTEBOOK_STORAGE_KEY);
        if (!stored) return;
        const parsed: unknown = JSON.parse(stored);
        if (!Array.isArray(parsed)) throw new Error("The local notebook is not an array.");
        const normalized = normalizeNotebookEntries(parsed);
        setNotebookEntries(normalized);
        if (normalized.length !== parsed.length) {
          setNotice("One or more invalid, unsupported, or duplicate local notebook summaries were ignored. The live analysis workspace is unaffected.");
        }
      } catch {
        setNotice("A previous local summary notebook could not be read; the live analysis workspace is unaffected.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!error) return;
    window.requestAnimationFrame(() => errorRef.current?.focus());
  }, [error]);

  const reset = () => {
    operationId.current += 1;
    demoAbort.current?.abort();
    demoAbort.current = null;
    cancelAnalysisWorker();
    setFilename(null);
    coordinateText.current = null;
    setStructure(null);
    setCoordinateSha256(null);
    setCoordinateBytes(null);
    setPae(null);
    setPaeSha256(null);
    setPaeOrderConfirmed(false);
    setReceptorChain("");
    setVhhChain("");
    setConfidenceMode("none");
    setChainConfirmed(false);
    setAudit(null);
    setEnsemble(null);
    setEnsembleRejected([]);
    setEnsembleMode(null);
    setStatePairResult(null);
    setTopologyInput(EMPTY_TOPOLOGY_ANNOTATION);
    setError(null);
    setNotice(null);
    setLoading(null);
    setPredictionRunResetToken((value) => value + 1);
  };

  const cancelCurrentOperation = () => {
    operationId.current += 1;
    demoAbort.current?.abort();
    demoAbort.current = null;
    cancelAnalysisWorker();
    setCancelToken((value) => value + 1);
    setLoading(null);
    setError(null);
    setNotice("The background operation was cancelled. The last completed workspace state was preserved.");
  };

  const sha256 = async (bytes: ArrayBuffer) => {
    return {
      bytes: bytes.byteLength,
      hex: await sha256Hex(bytes),
    };
  };

  const decodeUtf8 = (bytes: ArrayBuffer, label: string) => {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`${label} is not valid UTF-8 text. Binary CIF, gzip, and legacy encodings are not supported.`);
    }
  };

  const downloadText = (content: string, mimeType: string, downloadName: string) => {
    const blob = new Blob([content], { type: mimeType });
    let url: string | null = null;
    let anchor: HTMLAnchorElement | null = null;
    let cleanupScheduled = false;
    try {
      url = URL.createObjectURL(blob);
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeDownloadFilename(downloadName);
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url as string), 0);
      cleanupScheduled = true;
    } finally {
      anchor?.remove();
      if (url && !cleanupScheduled) URL.revokeObjectURL(url);
    }
  };

  const createAnalysisWorker = () => {
    cancelAnalysisWorker("A newer background operation replaced this request.");
    const worker = new Worker(
      new URL("../lib/audit-worker.ts", import.meta.url),
      { type: "module", name: "confovhh-audit" },
    );
    analysisWorker.current = worker;
    return worker;
  };

  const executeParseInWorker = (
    requestId: number,
    job: ParseCoordinateJob,
  ): Promise<ParsedStructure> => new Promise((resolve, reject) => {
    const worker = createAnalysisWorker();
    let timeoutId: number | null = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      worker.terminate();
      if (analysisWorker.current === worker) {
        analysisWorker.current = null;
        analysisWorkerReject.current = null;
      }
    };
    analysisWorkerReject.current = (error) => {
      finish();
      reject(error);
    };
    worker.onmessage = (event: MessageEvent<AuditWorkerResponse>) => {
      const response = event.data;
      if (finished || response.requestId !== requestId) return;
      if (response.type === "parse-result") {
        finish();
        resolve(response.structure);
      } else if (response.type === "error") {
        finish();
        reject(new Error(response.error));
      } else {
        finish();
        reject(new Error("The coordinate parser returned an unexpected response type."));
      }
    };
    worker.onerror = (event) => {
      if (finished) return;
      finish();
      reject(new Error(event.message || "The background coordinate parser stopped unexpectedly."));
    };
    worker.onmessageerror = () => {
      if (finished) return;
      finish();
      reject(new Error("The coordinate parser returned an unreadable message."));
    };
    const request: AuditWorkerRequest = { requestId, type: "parse-coordinate", job };
    timeoutId = window.setTimeout(() => {
      finish();
      reject(new Error("The coordinate parser exceeded the three-minute browser time limit."));
    }, 180_000);
    try {
      worker.postMessage(request);
    } catch (caught) {
      finish();
      reject(caught instanceof Error ? caught : new Error("The coordinate parser could not be started."));
    }
  });

  const executePaeParseInWorker = (
    requestId: number,
    job: ParsePaeJob,
  ): Promise<ParsedPae> => new Promise((resolve, reject) => {
    const worker = createAnalysisWorker();
    let timeoutId: number | null = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      worker.terminate();
      if (analysisWorker.current === worker) {
        analysisWorker.current = null;
        analysisWorkerReject.current = null;
      }
    };
    analysisWorkerReject.current = (error) => {
      finish();
      reject(error);
    };
    worker.onmessage = (event: MessageEvent<AuditWorkerResponse>) => {
      const response = event.data;
      if (finished || response.requestId !== requestId) return;
      if (response.type === "pae-result") {
        finish();
        resolve(response.pae);
      } else if (response.type === "error") {
        finish();
        reject(new Error(response.error));
      } else {
        finish();
        reject(new Error("The PAE parser returned an unexpected response type."));
      }
    };
    worker.onerror = (event) => {
      if (finished) return;
      finish();
      reject(new Error(event.message || "The background PAE parser stopped unexpectedly."));
    };
    worker.onmessageerror = () => {
      if (finished) return;
      finish();
      reject(new Error("The PAE parser returned an unreadable message."));
    };
    const request: AuditWorkerRequest = { requestId, type: "parse-pae", job };
    timeoutId = window.setTimeout(() => {
      finish();
      reject(new Error("The PAE parser exceeded the three-minute browser time limit."));
    }, 180_000);
    try {
      worker.postMessage(request);
    } catch (caught) {
      finish();
      reject(caught instanceof Error ? caught : new Error("The PAE parser could not be started."));
    }
  });

  const executeNativePaeParseInWorker = (
    requestId: number,
    source: PredictionRunAuditSourceFile,
    targetStructure: ParsedStructure,
  ): Promise<ParsedPae> => new Promise((resolve, reject) => {
    cancelAnalysisWorker("A newer background operation replaced this request.");
    const worker = new Worker(
      new URL("../lib/prediction-run-worker.ts", import.meta.url),
      { type: "module", name: "confovhh-native-pae" },
    );
    analysisWorker.current = worker;
    let timeoutId: number | null = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      worker.terminate();
      if (analysisWorker.current === worker) {
        analysisWorker.current = null;
        analysisWorkerReject.current = null;
      }
    };
    analysisWorkerReject.current = (nextError) => {
      finish();
      reject(nextError);
    };
    worker.onmessage = (event: MessageEvent<PredictionRunWorkerResponse>) => {
      const response = event.data;
      if (finished || response.requestId !== requestId) return;
      if (response.type === "native-pae-result") {
        finish();
        resolve(response.pae);
      } else if (response.type === "error") {
        finish();
        reject(new Error(response.error));
      } else {
        finish();
        reject(new Error("The native PAE parser returned an unexpected response type."));
      }
    };
    worker.onerror = (event) => {
      if (finished) return;
      finish();
      reject(new Error(event.message || "The native PAE parser stopped unexpectedly."));
    };
    worker.onmessageerror = () => {
      if (finished) return;
      finish();
      reject(new Error("The native PAE parser returned an unreadable response."));
    };
    const request: PredictionRunWorkerRequest = {
      requestId,
      type: "parse-native-pae",
      job: { source, structure: targetStructure },
    };
    timeoutId = window.setTimeout(() => {
      finish();
      reject(new Error("The native PAE parser exceeded the three-minute browser time limit."));
    }, 180_000);
    try {
      worker.postMessage(request);
    } catch (caught) {
      finish();
      reject(caught instanceof Error ? caught : new Error("The native PAE parser could not be started."));
    }
  });

  const executeSingleInWorker = (
    requestId: number,
    job: SingleAuditJob,
  ): Promise<InterfaceAudit> => new Promise((resolve, reject) => {
    const worker = createAnalysisWorker();
    let timeoutId: number | null = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      worker.terminate();
      if (analysisWorker.current === worker) {
        analysisWorker.current = null;
        analysisWorkerReject.current = null;
      }
    };
    analysisWorkerReject.current = (error) => {
      finish();
      reject(error);
    };
    worker.onmessage = (event: MessageEvent<AuditWorkerResponse>) => {
      const response = event.data;
      if (finished || response.requestId !== requestId) return;
      if (response.type === "single-result") {
        finish();
        resolve(response.audit);
      } else if (response.type === "error") {
        finish();
        reject(new Error(response.error));
      } else {
        finish();
        reject(new Error("The audit worker returned an unexpected response type."));
      }
    };
    worker.onerror = (event) => {
      if (finished) return;
      finish();
      reject(new Error(event.message || "The background audit worker stopped unexpectedly."));
    };
    worker.onmessageerror = () => {
      if (finished) return;
      finish();
      reject(new Error("The audit worker returned an unreadable message."));
    };
    const paeForWorker = job.pae ? { ...job.pae, matrix: job.pae.matrix.slice() } : null;
    const request: AuditWorkerRequest = {
      requestId,
      type: "single",
      job: { ...job, pae: paeForWorker },
    };
    timeoutId = window.setTimeout(() => {
      finish();
      reject(new Error("The interface audit exceeded the three-minute browser time limit."));
    }, 180_000);
    try {
      worker.postMessage(request, paeForWorker ? [paeForWorker.matrix.buffer] : []);
    } catch (caught) {
      finish();
      reject(caught instanceof Error ? caught : new Error("The interface audit could not be started."));
    }
  });

  const executeEnsembleInWorker = (
    requestId: number,
    job: Extract<AuditWorkerRequest, { type: "ensemble" }>["job"],
  ): Promise<EnsembleAuditJobResult> => new Promise((resolve, reject) => {
    const worker = createAnalysisWorker();
    let timeoutId: number | null = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      worker.terminate();
      if (analysisWorker.current === worker) {
        analysisWorker.current = null;
        analysisWorkerReject.current = null;
      }
    };
    analysisWorkerReject.current = (error) => {
      finish();
      reject(error);
    };
    worker.onmessage = (event: MessageEvent<AuditWorkerResponse>) => {
      const response = event.data;
      if (finished || response.requestId !== requestId) return;
      if (response.type === "progress") {
        setLoading(
          `Audited ensemble pose ${response.completed}/${response.total}: ${response.filename}`,
        );
      } else if (response.type === "ensemble-result") {
        finish();
        resolve(response.result);
      } else if (response.type === "error") {
        finish();
        reject(new Error(response.error));
      } else {
        finish();
        reject(new Error("The ensemble worker returned an unexpected response type."));
      }
    };
    worker.onerror = (event) => {
      if (finished) return;
      finish();
      reject(new Error(event.message || "The background audit worker stopped unexpectedly."));
    };
    worker.onmessageerror = () => {
      if (finished) return;
      finish();
      reject(new Error("The ensemble worker returned an unreadable message."));
    };
    const request: AuditWorkerRequest = { requestId, type: "ensemble", job };
    timeoutId = window.setTimeout(() => {
      finish();
      reject(new Error("The ensemble audit exceeded the three-minute browser time limit."));
    }, 180_000);
    try {
      worker.postMessage(request);
    } catch (caught) {
      finish();
      reject(caught instanceof Error ? caught : new Error("The ensemble audit could not be started."));
    }
  });

  const applyParsedStructure = (
    parsed: ParsedStructure,
    name: string,
    checksum: { bytes: number; hex: string },
    text: string,
  ) => {
    if (parsed.chains.length < 2) {
      throw new Error("Only one polymer chain was detected. The receptor and VHH must be separate chains.");
    }
    const suggestions = suggestChains(parsed);
    setStructure(parsed);
    setCoordinateSha256(checksum.hex);
    setCoordinateBytes(checksum.bytes);
    coordinateText.current = text;
    setPae(null);
    setPaeSha256(null);
    setPaeOrderConfirmed(false);
    setFilename(name);
    setReceptorChain(suggestions.receptorChain ?? parsed.chains[0].id);
    setVhhChain(suggestions.vhhChain ?? parsed.chains[1].id);
    setConfidenceMode("none");
    setChainConfirmed(false);
    setAudit(null);
    setEnsemble(null);
    setEnsembleRejected([]);
    setEnsembleMode(null);
    setStatePairResult(null);
    setTopologyInput(EMPTY_TOPOLOGY_ANNOTATION);
    setNotice(null);
  };

  const readFile = async (file: File) => {
    if (file.size > MAX_COORDINATE_FILE_BYTES) {
      setError("This coordinate file is larger than the 12 MB browser-analysis limit.");
      return;
    }
    if (!/\.(?:pdb|ent|cif|mmcif)$/i.test(file.name)) {
      setError("Choose a text .pdb, .ent, .cif, or .mmcif coordinate file.");
      return;
    }
    demoAbort.current?.abort();
    demoAbort.current = null;
    cancelAnalysisWorker();
    const currentOperation = operationId.current + 1;
    operationId.current = currentOperation;
    setLoading("Parsing chains, models, and deposited assemblies in the background…");
    setError(null);
    setNotice(null);
    try {
      const bytes = await file.arrayBuffer();
      const [text, checksum] = await Promise.all([
        Promise.resolve(decodeUtf8(bytes, file.name)),
        sha256(bytes),
      ]);
      if (operationId.current !== currentOperation) return;
      const parsed = await executeParseInWorker(currentOperation, {
        filename: file.name,
        text,
        assemblyId: null,
      });
      if (operationId.current !== currentOperation) return;
      applyParsedStructure(parsed, file.name, checksum, text);
    } catch (caught) {
      if (operationId.current !== currentOperation) return;
      setError(caught instanceof Error ? caught.message : "We couldn’t read this coordinate file.");
    } finally {
      if (operationId.current === currentOperation) setLoading(null);
    }
  };

  const openPredictionRunPose = async ({
    coordinate,
    pae: proposedPae,
    chainSelection,
  }: PredictionRunOpenPoseRequest): Promise<void> => {
    if (coordinate.text == null) throw new Error("The selected run coordinate is not decoded text.");
    if (coordinate.bytes > MAX_COORDINATE_FILE_BYTES) {
      throw new Error("The selected run coordinate exceeds the 12 MiB browser-analysis limit.");
    }
    demoAbort.current?.abort();
    demoAbort.current = null;
    cancelAnalysisWorker();
    const currentOperation = operationId.current + 1;
    operationId.current = currentOperation;
    setLoading(`Opening prediction-run pose ${coordinate.filename}…`);
    setError(null);
    setNotice(null);
    try {
      const parsed = await executeParseInWorker(currentOperation, {
        filename: coordinate.filename,
        text: coordinate.text,
        assemblyId: null,
      });
      if (operationId.current !== currentOperation) {
        throw new Error("A newer operation replaced the prediction-run pose request.");
      }
      let parsedPae: ParsedPae | null = null;
      if (proposedPae != null) {
        if (proposedPae.text == null) throw new Error("The proposed PAE association is not supported JSON text.");
        parsedPae = await executeNativePaeParseInWorker(currentOperation, {
          id: proposedPae.id,
          path: proposedPae.path,
          filename: proposedPae.filename,
          bytes: proposedPae.bytes,
          sha256: proposedPae.sha256,
          text: proposedPae.text,
        }, parsed);
      }
      if (operationId.current !== currentOperation) {
        throw new Error("A newer operation replaced the prediction-run pose request.");
      }
      if (chainSelection != null) {
        const receptorExists = parsed.chains.some((chain) => chain.id === chainSelection.receptor);
        const vhhExists = parsed.chains.some((chain) => chain.id === chainSelection.vhh);
        if (!receptorExists || !vhhExists || chainSelection.receptor === chainSelection.vhh) {
          throw new Error("The audited run chain selection is absent from the reloaded coordinate pose.");
        }
      }
      applyParsedStructure(
        parsed,
        coordinate.filename,
        { bytes: coordinate.bytes, hex: coordinate.sha256 },
        coordinate.text,
      );
      if (parsedPae != null && proposedPae != null) {
        setPae(parsedPae);
        setPaeSha256(proposedPae.sha256);
        setPaeOrderConfirmed(false);
      }
      if (chainSelection != null) {
        setReceptorChain(chainSelection.receptor);
        setVhhChain(chainSelection.vhh);
        setChainConfirmed(false);
      }
    } finally {
      if (operationId.current === currentOperation) setLoading(null);
    }
  };

  const loadDemo = async () => {
    demoAbort.current?.abort();
    cancelAnalysisWorker();
    const controller = new AbortController();
    demoAbort.current = controller;
    const currentOperation = operationId.current + 1;
    operationId.current = currentOperation;
    setLoading("Loading and parsing public β₂AR–Nb80 mmCIF 3P0G…");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(DEMO_URL, { signal: controller.signal });
      if (!response.ok) throw new Error("The public demo structure could not be retrieved.");
      const bytes = await readBoundedResponseBytes(
        response,
        MAX_COORDINATE_FILE_BYTES,
        "The public 3P0G demo",
      );
      const [text, checksum] = await Promise.all([
        Promise.resolve(decodeUtf8(bytes, "3P0G.cif")),
        sha256(bytes),
      ]);
      if (operationId.current !== currentOperation) return;
      const parsed = await executeParseInWorker(currentOperation, {
        filename: "3P0G_beta2AR_Nb80.cif",
        text,
        assemblyId: null,
      });
      if (operationId.current !== currentOperation) return;
      applyParsedStructure(parsed, "3P0G_beta2AR_Nb80.cif", checksum, text);
    } catch (caught) {
      if (controller.signal.aborted || operationId.current !== currentOperation) return;
      setError(caught instanceof Error ? caught.message : "The public demo could not be loaded.");
    } finally {
      if (operationId.current === currentOperation) setLoading(null);
      if (demoAbort.current === controller) demoAbort.current = null;
    }
  };

  const changeCoordinateScope = async (value: string) => {
    if (!filename || !coordinateText.current || !coordinateSha256 || coordinateBytes == null) return;
    const sourceText = coordinateText.current;
    const currentOperation = operationId.current + 1;
    operationId.current = currentOperation;
    cancelAnalysisWorker();
    setLoading(value === AS_SUPPLIED_SCOPE
      ? "Restoring the as-supplied coordinate scope…"
      : `Reconstructing deposited assembly ${value}…`);
    setError(null);
    setNotice(null);
    try {
      const parsed = await executeParseInWorker(currentOperation, {
        filename,
        text: sourceText,
        assemblyId: value === AS_SUPPLIED_SCOPE ? null : value,
        modelId: structure?.selectedModelId ?? null,
      });
      if (operationId.current !== currentOperation) return;
      applyParsedStructure(parsed, filename, { bytes: coordinateBytes, hex: coordinateSha256 }, sourceText);
    } catch (caught) {
      if (operationId.current !== currentOperation) return;
      setError(caught instanceof Error ? caught.message : "The selected coordinate scope could not be reconstructed.");
    } finally {
      if (operationId.current === currentOperation) setLoading(null);
    }
  };

  const changeCoordinateModel = async (modelId: string) => {
    if (!filename || !coordinateText.current || !coordinateSha256 || coordinateBytes == null) return;
    const sourceText = coordinateText.current;
    const currentOperation = operationId.current + 1;
    operationId.current = currentOperation;
    cancelAnalysisWorker();
    setLoading(`Selecting coordinate model ${modelId}…`);
    setError(null);
    setNotice(null);
    try {
      const parsed = await executeParseInWorker(currentOperation, {
        filename,
        text: sourceText,
        assemblyId: structure?.selectedAssembly?.id ?? null,
        modelId,
      });
      if (operationId.current !== currentOperation) return;
      applyParsedStructure(parsed, filename, { bytes: coordinateBytes, hex: coordinateSha256 }, sourceText);
    } catch (caught) {
      if (operationId.current !== currentOperation) return;
      setError(caught instanceof Error ? caught.message : "The selected coordinate model could not be parsed.");
    } finally {
      if (operationId.current === currentOperation) setLoading(null);
    }
  };

  const readPaeFile = async (file: File) => {
    if (!structure) return;
    if (structure.coordinateScope === "deposited-assembly") {
      setError("PAE is disabled for generated assembly copies because assembly operators do not create model confidence values.");
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      setError("This PAE JSON is larger than the 16 MiB browser-analysis limit.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".json")) {
      setError("Choose a .json PAE matrix. Boltz .npz files must be converted to JSON first.");
      return;
    }
    const currentOperation = operationId.current + 1;
    operationId.current = currentOperation;
    setLoading("Validating PAE shape and dimensions…");
    setError(null);
    setNotice(null);
    try {
      const bytes = await file.arrayBuffer();
      if (operationId.current !== currentOperation) return;
      const text = decodeUtf8(bytes, file.name);
      if (operationId.current !== currentOperation) return;
      const checksumPromise = sha256(bytes);
      const parsed = await executePaeParseInWorker(currentOperation, {
        filename: file.name,
        text,
        structure,
      });
      if (operationId.current !== currentOperation) return;
      const checksum = await checksumPromise;
      if (operationId.current !== currentOperation) return;
      setPae(parsed);
      setPaeSha256(checksum.hex);
      setPaeOrderConfirmed(false);
      setAudit(null);
      setEnsemble(null);
      setEnsembleRejected([]);
      setEnsembleMode(null);
    } catch (caught) {
      if (operationId.current !== currentOperation) return;
      setError(caught instanceof Error ? caught.message : "The PAE JSON could not be mapped.");
    } finally {
      if (operationId.current === currentOperation) setLoading(null);
    }
  };

  const runAudit = async () => {
    if (!structure) return;
    const currentOperation = operationId.current + 1;
    operationId.current = currentOperation;
    setError(null);
    setNotice(null);
    setLoading("Calculating contacts, IMGT mapping, PAE, and buried area…");
    try {
      const nextAudit = await executeSingleInWorker(currentOperation, {
        structure,
        receptorChain,
        vhhChain,
        confidenceMode,
        pae,
        paeOrderConfirmed,
      });
      if (operationId.current !== currentOperation) return;
      setAudit(nextAudit);
      setEnsemble(null);
      setEnsembleRejected([]);
      setEnsembleMode(null);
      window.requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "start",
        });
        resultsRef.current?.focus({ preventScroll: true });
      });
    } catch (caught) {
      if (operationId.current !== currentOperation) return;
      setError(caught instanceof Error ? caught.message : "The interface audit could not be completed.");
    } finally {
      if (operationId.current === currentOperation) setLoading(null);
    }
  };

  const runEnsemble = async (fileList: FileList) => {
    if (!structure || !audit || !filename || !coordinateSha256) return;
    const files = Array.from(fileList);
    if (!files.length) return;
    if (files.length + 1 > MAX_ENSEMBLE_POSES) {
      setError(
        `Choose at most ${MAX_ENSEMBLE_POSES - 1} additional poses; the current audited pose is the reference.`,
      );
      return;
    }
    const invalidFile = files.find((file) => (
      file.size > MAX_COORDINATE_FILE_BYTES ||
      !/\.(?:pdb|ent|cif|mmcif)$/i.test(file.name)
    ));
    if (invalidFile) {
      setError(
        `${invalidFile.name}: every ensemble member must be text PDB/mmCIF no larger than 12 MB.`,
      );
      return;
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_ENSEMBLE_TOTAL_BYTES) {
      setError("The additional ensemble files exceed the 48 MB combined browser-memory limit.");
      return;
    }

    const currentOperation = operationId.current + 1;
    operationId.current = currentOperation;
    setError(null);
    setNotice(null);
    setLoading(`Reading ${files.length} additional pose file${files.length === 1 ? "" : "s"}…`);

    try {
      const candidates: EnsembleCoordinateFile[] = [];
      for (const file of files) {
        const bytes = await file.arrayBuffer();
        if (operationId.current !== currentOperation) return;
        const text = decodeUtf8(bytes, file.name);
        const checksum = await sha256(bytes);
        if (operationId.current !== currentOperation) return;
        candidates.push({
          filename: file.name,
          text,
          sha256: checksum.hex,
          bytes: checksum.bytes,
        });
      }
      if (operationId.current !== currentOperation) return;
      setLoading("Starting background ensemble audit…");
      const result = await executeEnsembleInWorker(currentOperation, {
        reference: {
          filename,
          sha256: coordinateSha256,
          bytes: coordinateBytes,
          structure,
          receptorChain: audit.receptorChain,
          vhhChain: audit.vhhChain,
        },
        candidates,
      });
      if (operationId.current !== currentOperation) return;
      setEnsemble(result.summary);
      setEnsembleRejected(result.rejected);
      setEnsembleMode(result.comparisonMode);
      window.requestAnimationFrame(() => {
        ensembleRef.current?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "start",
        });
        ensembleRef.current?.focus({ preventScroll: true });
      });
    } catch (caught) {
      if (operationId.current !== currentOperation) return;
      setError(caught instanceof Error ? caught.message : "The pose ensemble could not be compared.");
    } finally {
      if (operationId.current === currentOperation) setLoading(null);
    }
  };

  const createCanonicalAuditReport = () => {
    if (!audit || !structure || !filename || !coordinateSha256 || coordinateBytes == null) {
      throw new Error("A completed, provenance-bound single-pose audit is required.");
    }
    return createSingleAuditExportReport({
      filename,
      coordinateSha256,
      coordinateBytes,
      structure,
      receptorChain,
      vhhChain,
      chainIdentityConfirmed: chainConfirmed,
      pae,
      paeSha256,
      paeOrderConfirmed,
      audit,
    });
  };

  const exportAudit = () => {
    if (!audit || !filename) return;
    try {
      const payload = createCanonicalAuditReport();
      downloadText(
        JSON.stringify(payload, null, 2),
        "application/json",
        `${filename.replace(/\.[^.]+$/, "")}_audit.json`,
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error
        ? `Audit export failed: ${caught.message}`
        : "Audit export failed unexpectedly.");
    }
  };

  const workflowCoverage = {
    paeAttached: Boolean(pae && paeOrderConfirmed),
    ensemblePoseCount: ensemble?.poseCount ?? (audit ? 1 : 0),
    pairedContextCompared: statePairResult != null,
  };
  const decisionBrief = audit
    ? deriveCoordinateTriageBrief(audit, workflowCoverage)
    : null;
  const currentIntendedFootprint = () => {
    if (!audit || !structure || !researchContext.intendedFootprint.trim()) return null;
    return analyzeIntendedFootprint(
      structure,
      receptorChain,
      audit,
      researchContext.intendedFootprint,
    );
  };

  const persistNotebook = (entries: NotebookEntry[]) => {
    window.localStorage.setItem(NOTEBOOK_STORAGE_KEY, JSON.stringify(entries));
    setNotebookEntries(entries);
  };

  const saveNotebookSummary = () => {
    if (!audit || !decisionBrief || !filename || !coordinateSha256) return;
    try {
      const report = createCanonicalAuditReport();
      const entry = createNotebookEntry({
        singleAuditReport: report,
        context: researchContext,
        workflow: workflowCoverage,
      });
      persistNotebook(upsertNotebookEntry(notebookEntries, entry));
      setError(null);
      setNotice("The user-entered study context and a derived summary were saved locally. Loaded coordinates and residue-level evidence were not automatically copied.");
    } catch (caught) {
      setError(caught instanceof Error ? `Local summary save failed: ${caught.message}` : "Local summary save failed unexpectedly.");
    }
  };

  const importNotebook = (text: string) => {
    const imported = parseNotebookExport(text);
    let merged = notebookEntries;
    for (const entry of imported) merged = upsertNotebookEntry(merged, entry);
    persistNotebook(merged);
    setNotice(`${imported.length} schema-checked notebook summar${imported.length === 1 ? "y was" : "ies were"} imported. Metrics and screening fingerprints were not recomputed or authenticated, and no coordinates were loaded.`);
  };

  const removeNotebookEntry = (id: string) => {
    try {
      persistNotebook(notebookEntries.filter((entry) => entry.id !== id));
    } catch (caught) {
      setError(caught instanceof Error ? `Notebook update failed: ${caught.message}` : "Notebook update failed unexpectedly.");
    }
  };

  const clearNotebook = () => {
    try {
      window.localStorage.removeItem(NOTEBOOK_STORAGE_KEY);
      setNotebookEntries([]);
      setNotice("The local derived-summary notebook was cleared. Downloaded reports are unaffected.");
    } catch (caught) {
      setError(caught instanceof Error ? `Notebook clear failed: ${caught.message}` : "Notebook clear failed unexpectedly.");
    }
  };

  const exportNotebook = () => {
    try {
      downloadText(
        JSON.stringify(createNotebookExport(notebookEntries), null, 2),
        "application/json",
        "confovhh_summary_notebook.json",
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? `Notebook export failed: ${caught.message}` : "Notebook export failed unexpectedly.");
    }
  };

  const exportDossier = () => {
    if (!decisionBrief || !filename || !coordinateSha256) return;
    try {
      const bundle = createWorkspaceBundle({
        context: researchContext,
        userDefinedFootprint: currentIntendedFootprint(),
        singleAuditReport: createCanonicalAuditReport(),
        poseEnsembleReport: ensemble == null
          ? null
          : createPoseEnsembleExportReport(
              ensemble,
              ensembleMode ?? "Coordinate-only ensemble comparison.",
              ensembleRejected,
            ),
        pairedContextReport: statePairResult == null
          ? null
          : createStatePairExportReport(
              statePairResult.summary,
              statePairResult.comparisonMode,
            ),
      });
      downloadText(
        JSON.stringify(bundle, null, 2),
        "application/json",
        `${researchContext.candidateId || filename.replace(/\.[^.]+$/, "")}_workspace_dossier.json`,
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? `Workspace dossier export failed: ${caught.message}` : "Workspace dossier export failed unexpectedly.");
    }
  };

  const exportHandoffMarkdown = () => {
    if (!audit || !decisionBrief || !filename || !coordinateSha256) return;
    try {
      downloadText(
        createHandoffMarkdown({
          singleAuditReport: createCanonicalAuditReport(),
          context: researchContext,
          workflow: workflowCoverage,
          userDefinedFootprint: currentIntendedFootprint(),
        }),
        "text/markdown;charset=utf-8",
        `${researchContext.candidateId || filename.replace(/\.[^.]+$/, "")}_coordinate_handoff.md`,
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? `Handoff export failed: ${caught.message}` : "Handoff export failed unexpectedly.");
    }
  };

  const importDossier = (text: string) => {
    setImportedDossier(parseWorkspaceBundle(text));
    setNotice("A ConfoVHH dossier was opened in read-only mode. Its scientific values were not recomputed.");
  };

  const exportEnsemble = (format: "json" | "csv") => {
    if (!ensemble) return;
    try {
      const content = format === "json"
        ? JSON.stringify(createPoseEnsembleExportReport(
            ensemble,
            ensembleMode ?? "Coordinate-only ensemble comparison.",
            ensembleRejected,
          ), null, 2)
        : poseEnsembleToCsv(ensemble);
      downloadText(
        content,
        format === "json" ? "application/json" : "text/csv;charset=utf-8",
        `confovhh_ensemble.${format}`,
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error
        ? `Ensemble ${format.toUpperCase()} export failed: ${caught.message}`
        : `Ensemble ${format.toUpperCase()} export failed unexpectedly.`);
    }
  };

  const totalResidues = structure?.chains.reduce((sum, chain) => sum + chain.residueCount, 0) ?? 0;
  const paeExpectedOrder = structure?.chains
    .map((chain) => `${chain.id} (${chain.residueCount})`)
    .join(" → ") ?? "";
  const ensembleProvenanceSignatures = new Set(ensemble?.poses.map((pose) => (
    `${pose.sourceFormat}|${pose.coordinateScope}|${pose.selectedModelId}|${pose.selectedAssemblyId ?? "none"}`
  )) ?? []);
  const workspaceStatus = loading || predictionRunStatus.busy
    ? "Working"
    : predictionRunStatus.hasCommitted
      ? "Prediction run complete"
    : statePairResult
      ? "Context comparison complete"
      : ensemble
        ? "Ensemble complete"
        : audit
          ? "Audit complete"
          : structure
            ? "Input ready"
            : "No file";

  return (
    <main className="app-shell" id="main-content" aria-busy={Boolean(loading || predictionRunStatus.busy)}>
      <a className="skip-link" href="#coordinate-setup">Skip to analysis workspace</a>
      <p className="sr-only" aria-live="polite">
        {audit ? `Audit complete: ${evidenceLabel[audit.evidenceLevel]}.` : loading ?? ""}
      </p>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Atom /></div>
          <div>
            <div className="brand-title">ConfoVHH <span>product {CONFOVHH_PRODUCT_RELEASE} · engine {CONFOVHH_VERSION}</span></div>
            <p>Researcher-led GPCR–VHH interface audit and structural triage</p>
          </div>
        </div>
        <div className="topbar-actions">
          <Badge variant="outline" className="status-badge">
            {loading || predictionRunStatus.busy ? <LoaderCircle className="animate-spin" /> : structure || predictionRunStatus.hasCommitted ? <CheckCircle2 /> : <span className="status-dot" />}
            {workspaceStatus}
          </Badge>
          {(loading || predictionRunStatus.busy) && <Button aria-label="Cancel current background operation" variant="outline" size="sm" onClick={cancelCurrentOperation}><XCircle /> <span className="button-label">Cancel</span></Button>}
          <DossierImportControl onImportText={importDossier} />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button aria-label="Start a new coordinate analysis" variant="ghost" size="sm" disabled={!structure && !error && !loading && !predictionRunStatus.hasDraft && !predictionRunStatus.hasCommitted}>
                <RotateCcw /> <span className="button-label">New analysis</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear the current coordinate analysis and prediction run?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the loaded coordinate, PAE, audit, ensemble, paired-context result, prediction-run draft, and committed run snapshot from the tab. Study metadata, locally saved summaries, and downloaded reports are kept.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep analysis</AlertDialogCancel>
                <AlertDialogAction onClick={reset}>Clear analysis</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button aria-label="Export audit as JSON" variant="outline" size="sm" onClick={exportAudit} disabled={!audit || Boolean(loading)}>
            <Download /> <span className="button-label">Export audit</span>
          </Button>
        </div>
      </header>

      <WorkspaceNavigator
        hasStructure={Boolean(structure)}
        hasAudit={Boolean(audit)}
        predictionRunHasDraft={predictionRunStatus.hasDraft}
        predictionRunHasCommitted={predictionRunStatus.hasCommitted}
        ensemblePoseCount={workflowCoverage.ensemblePoseCount}
        pairedContextCompared={workflowCoverage.pairedContextCompared}
      />

      {notice && (
        <Alert className="workspace-notice" role="status">
          <CheckCircle2 />
          <AlertTitle>Workspace update</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {error && (
        <div ref={errorRef} className="workspace-error-focus" tabIndex={-1} aria-label="Operation error">
          <Alert variant="destructive" className="workspace-error" role="alert" aria-live="assertive">
            <AlertTriangle />
            <AlertTitle>Operation stopped</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {importedDossier && <ImportedDossier bundle={importedDossier} onClose={() => setImportedDossier(null)} />}

      <PredictionRunIntake
        currentCoordinateSha256={coordinateSha256}
        currentStructure={structure}
        currentAudit={audit}
        receptorChain={receptorChain}
        vhhChain={vhhChain}
        chainConfirmed={chainConfirmed}
        topologyAnnotation={topologyState.analysis?.annotation ?? null}
        topologyAnnotationError={topologyState.error}
        onOpenPose={openPredictionRunPose}
        cancelToken={cancelToken}
        resetToken={predictionRunResetToken}
        onStatusChange={setPredictionRunStatus}
      />

      <ResearchContextPanel
        context={researchContext}
        onChange={(field, value) => setResearchContext((current) => ({ ...current, [field]: value }))}
      />

      <NotebookPanel
        entries={notebookEntries}
        onRemove={removeNotebookEntry}
        onClear={clearNotebook}
        onExport={exportNotebook}
        onImportText={importNotebook}
      />

      {!structure && <EntryWorkflowCards onDemo={() => void loadDemo()} />}

      <section className="workspace" id="coordinate-setup" tabIndex={-1} aria-label="ConfoVHH analysis workspace">
        <aside className="panel import-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">01 · Coordinate input</p>
              <h1>Import coordinate complex</h1>
            </div>
            <FileCode2 className="panel-icon" />
          </div>

          {!structure ? (
            <div
              className="drop-zone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (loading) return;
                const file = event.dataTransfer.files[0];
                if (file) void readFile(file);
              }}
            >
              <UploadCloud className="upload-icon" />
              <h2>Drop PDB or mmCIF coordinates here</h2>
              <p>The receptor and VHH must be separate polymer chains.</p>
              <p>Raw coordinates and PAE stay in this tab; they are never uploaded or written to the local summary notebook.</p>
              <Input
                id="coordinate-file"
                type="file"
                accept=".pdb,.ent,.cif,.mmcif,chemical/x-pdb,chemical/x-cif"
                aria-label="Choose a PDB or PDBx/mmCIF coordinate file"
                disabled={Boolean(loading)}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readFile(file);
                  event.currentTarget.value = "";
                }}
              />
              <div className="or-divider"><span>or</span></div>
              <Button variant="secondary" onClick={() => void loadDemo()} disabled={Boolean(loading)}>
                <FlaskConical /> Load β₂AR–Nb80 demo
              </Button>
              <p className="demo-note">Public experimental PDBx/mmCIF · PDB 3P0G</p>
            </div>
          ) : (
            <div className="file-context">
              <div className="file-summary">
                <div className="file-icon"><FileCode2 /></div>
                <div>
                  <strong title={filename ?? undefined}>{filename}</strong>
                  <p>
                    {structure.chains.length} chains · {totalResidues} residues · {structure.sourceFormat.toUpperCase()} · model ID {structure.selectedModelId}{structure.modelCount > 1 ? ` · ${structure.modelCount} models` : ""}
                  </p>
                </div>
                <label className="button-file-label replace-coordinate">
                  <UploadCloud /> Replace coordinate
                  <Input
                    type="file"
                    accept=".pdb,.ent,.cif,.mmcif,chemical/x-pdb,chemical/x-cif"
                    aria-label="Replace the current coordinate file"
                    disabled={Boolean(loading)}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void readFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              <p className="replace-note">Replacing the coordinate clears the current PAE, audit, ensemble, and paired-context result; saved notebook summaries remain.</p>

              {structure.sourceFormat === "mmcif" && structure.availableAssemblies.length > 0 && (
                <div className="assembly-selection">
                  <label>
                    <span>Coordinate scope</span>
                    <Select
                      value={structure.selectedAssembly?.id ?? AS_SUPPLIED_SCOPE}
                      disabled={Boolean(loading)}
                      onValueChange={(value) => void changeCoordinateScope(value)}
                    >
                      <SelectTrigger className="w-full" aria-label="Coordinate scope and deposited assembly">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={AS_SUPPLIED_SCOPE}>As supplied (mmCIF atom-site coordinates)</SelectItem>
                        {structure.availableAssemblies.map((assembly) => (
                          <SelectItem key={assembly.id} value={assembly.id}>
                            Deposited assembly {assembly.id} · {assembly.oligomericDetails ?? assembly.details ?? "annotated"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <p>
                    {structure.selectedAssembly
                      ? `${structure.selectedAssembly.generatedChainCount} protein chain instances and ${structure.selectedAssembly.generatedProteinHeavyAtomCount.toLocaleString()} protein heavy atoms reconstructed from ${structure.selectedAssembly.generatorCount} generator row(s). Non-protein components are omitted. This is a depositor/PDB annotation, not a determination of physiological state.`
                      : `${structure.availableAssemblies.length} deposited assembly annotation${structure.availableAssemblies.length === 1 ? " is" : "s are"} available. Selection is explicit; no operators are applied by default.`}
                  </p>
                </div>
              )}

              {structure.availableModelIds.length > 1 && (
                <div className="model-selection">
                  <label>
                    <span>Coordinate model</span>
                    <Select
                      value={structure.selectedModelId}
                      disabled={Boolean(loading)}
                      onValueChange={(value) => void changeCoordinateModel(value)}
                    >
                      <SelectTrigger className="w-full" aria-label="Coordinate model">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {structure.availableModelIds.map((modelId) => (
                          <SelectItem key={modelId} value={modelId}>Model {modelId}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <p>One coordinate model is analyzed at a time. Changing it clears PAE, chain confirmation, audits, and ensemble results.</p>
                </div>
              )}

              <div className="assignment-grid">
                <label>
                  <span>Receptor chain</span>
                  <Select value={receptorChain} disabled={Boolean(loading)} onValueChange={(value) => { setReceptorChain(value); setChainConfirmed(false); setAudit(null); setTopologyInput(EMPTY_TOPOLOGY_ANNOTATION); }}>
                    <SelectTrigger className="w-full" aria-label="Receptor chain"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {structure.chains.map((chain) => (
                        <SelectItem key={chain.id} value={chain.id} disabled={chain.id === vhhChain}>
                          {chain.id}{chain.authAsymId ? ` · auth ${chain.authAsymId}` : ""}{chain.labelAsymId ? ` · label ${chain.labelAsymId}` : ""}{chain.assemblyOperationIds?.length ? ` · op ${chain.assemblyOperationIds.join("×")}` : ""} · {chain.residueCount} aa · {chain.roleHint}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label>
                  <span>VHH chain</span>
                  <Select value={vhhChain} disabled={Boolean(loading)} onValueChange={(value) => { setVhhChain(value); setChainConfirmed(false); setAudit(null); setTopologyInput(EMPTY_TOPOLOGY_ANNOTATION); }}>
                    <SelectTrigger className="w-full" aria-label="VHH chain"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {structure.chains.map((chain) => (
                        <SelectItem key={chain.id} value={chain.id} disabled={chain.id === receptorChain}>
                          {chain.id}{chain.authAsymId ? ` · auth ${chain.authAsymId}` : ""}{chain.labelAsymId ? ` · label ${chain.labelAsymId}` : ""}{chain.assemblyOperationIds?.length ? ` · op ${chain.assemblyOperationIds.join("×")}` : ""} · {chain.residueCount} aa · {chain.roleHint}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label>
                  <span>B-factor interpretation</span>
                  <Select value={confidenceMode} disabled={Boolean(loading)} onValueChange={(value) => { setConfidenceMode(value as ConfidenceMode); setAudit(null); }}>
                    <SelectTrigger className="w-full" aria-label="B-factor interpretation"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Do not interpret as pLDDT</SelectItem>
                      <SelectItem value="plddt">B-factor field is pLDDT</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>

              <div className="pae-input-row">
                <div>
                  <span>Optional cross-chain PAE</span>
                  <p>{structure.coordinateScope === "deposited-assembly"
                    ? "Disabled for generated assembly copies; operators do not create confidence values"
                    : pae
                    ? `${pae.filename} · ${pae.residueCount} × ${pae.residueCount} · ${pae.sourceFormat}`
                    : "AlphaFold/ColabFold-style JSON · matching coordinate residue order required"}</p>
                </div>
                <Input
                  type="file"
                  accept=".json,application/json"
                  aria-label="Choose an optional PAE JSON file"
                  disabled={Boolean(loading) || structure.coordinateScope === "deposited-assembly"}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void readPaeFile(file);
                    event.currentTarget.value = "";
                  }}
                />
                {pae && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPae(null);
                      setPaeSha256(null);
                      setPaeOrderConfirmed(false);
                      setAudit(null);
                    }}
                    disabled={Boolean(loading)}
                  >
                    Remove PAE
                  </Button>
                )}
              </div>

              {pae && (
                <label className="confirmation-row">
                  <input
                    type="checkbox"
                    checked={paeOrderConfirmed}
                    disabled={Boolean(loading)}
                    onChange={(event) => {
                      setPaeOrderConfirmed(event.target.checked);
                      setAudit(null);
                    }}
                  />
                  <span>
                    I confirmed the AlphaFold convention (row = alignment frame, column = evaluated residue) and that both axes follow this parsed protein-residue order: {paeExpectedOrder}.
                  </span>
                </label>
              )}

              <label className="confirmation-row">
                  <input
                    type="checkbox"
                    checked={chainConfirmed}
                    disabled={Boolean(loading)}
                    onChange={(event) => {
                      setChainConfirmed(event.target.checked);
                      setAudit(null);
                      setEnsemble(null);
                      setEnsembleRejected([]);
                      setEnsembleMode(null);
                    }}
                  />
                <span>I confirmed the selected receptor and VHH chain roles.</span>
              </label>

              <Button className="run-button" onClick={runAudit} disabled={!receptorChain || !vhhChain || receptorChain === vhhChain || !chainConfirmed || Boolean(pae && !paeOrderConfirmed) || Boolean(loading)}>
                {loading ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
                Run interface audit
              </Button>
              <p className="scope-note">Chain suggestions use length + coordinate contact · selected pair only · no docking or affinity prediction</p>
            </div>
          )}

          {loading && (
            <div className="loading-line" aria-live="polite">
              <LoaderCircle className="animate-spin" /> {loading}
            </div>
          )}
        </aside>

        <section className="panel structure-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">02 · Coordinate view</p>
              <h2>Structure</h2>
            </div>
            {structure && <Badge variant="secondary">Cα trace</Badge>}
          </div>
          <StructureViewport
            structure={structure}
            receptorChain={receptorChain}
            vhhChain={vhhChain}
            audit={audit}
          />
        </section>
      </section>

      {audit ? (
        <section className="results" id="audit-results" tabIndex={-1} aria-label="Interface audit results" ref={resultsRef}>
          <div className={`evidence-banner evidence-${audit.evidenceLevel}`}>
            <div className="evidence-icon"><ShieldCheck /></div>
            <div>
              <p className="eyebrow">03 · Evidence summary</p>
              <h2>Interface evidence: {evidenceLabel[audit.evidenceLevel]}</h2>
              <p>{audit.rationale}</p>
            </div>
            <Badge variant="outline">Chains {audit.receptorChain} ↔ {audit.vhhChain}</Badge>
          </div>
          {predictionRunStatus.hasDraft && (
            <a className="continue-run-link" href="#prediction-run-intake">
              <span><strong>Reference audit complete.</strong> Return to the prediction run to analyze every ready pose.</span>
              <span aria-hidden="true">Continue prediction run ↑</span>
            </a>
          )}

          <div className="metrics-grid">
            <MetricCard label="Contact residue pairs" value={String(audit.contactPairCount)} detail="Unique pairs within 4.5 Å" />
            <MetricCard label="Interface residues" value={`${audit.receptorInterfaceResidues} + ${audit.vhhInterfaceResidues}`} detail="Receptor + VHH residues" />
            <MetricCard label="Potential polar contacts" value={String(audit.polarContactProxyCount)} detail="Typed donor–acceptor pairs within 3.5 Å" />
            <MetricCard label="Salt-bridge proxies" value={String(audit.saltBridgeProxyCount)} detail="Charged side-chain atoms within 4.0 Å" />
            <MetricCard label="Clashing residue pairs" value={String(audit.severeClashCount)} detail={`Max vdW overlap ${audit.maximumOverlapAngstrom.toFixed(2)} Å; severe at 0.6 Å`} />
            <MetricCard
              label="Protein ΔSASA"
              value={`${audit.deltaSasaAngstrom2.toFixed(0)} Å²`}
              detail={`½ΔSASA interface-area convention ${audit.halfDeltaSasaInterfaceAreaAngstrom2.toFixed(0)} Å²`}
            />
            <MetricCard
              label="IMGT CDR-contact share"
              value={audit.paratopeProxyShare == null ? "Unavailable" : `${Math.round(audit.paratopeProxyShare * 100)}%`}
              detail={audit.vhhNumbering.status === "numbered"
                ? `CDR1/2/3 lengths ${audit.vhhNumbering.cdrLengths?.cdr1}/${audit.vhhNumbering.cdrLengths?.cdr2}/${audit.vhhNumbering.cdrLengths?.cdr3}`
                : "V-domain numbering unavailable"}
            />
            <MetricCard
              label="IMGT CDR3-contact share"
              value={audit.cdr3ProxyShare == null ? "Unavailable" : `${Math.round(audit.cdr3ProxyShare * 100)}%`}
              detail="Contacting residue pairs assigned to CDR3-IMGT"
            />
            <MetricCard
              label="Interface PAE"
              value={audit.interfacePaeMedianAngstrom == null ? "Unavailable" : `${audit.interfacePaeMedianAngstrom.toFixed(1)} Å`}
              detail={audit.interfacePaeMedianAngstrom == null
                ? !pae
                  ? "Attach a matching PAE JSON"
                  : audit.contactPairCount === 0
                    ? "Attached PAE has no contacting residue pairs to summarize"
                    : "Attached PAE could not be summarized for the selected interface"
                : `Conservative median; receptor-frame→VHH ${audit.receptorFrameToVhhPaeMedianAngstrom?.toFixed(1)} Å / VHH-frame→receptor ${audit.vhhFrameToReceptorPaeMedianAngstrom?.toFixed(1)} Å`}
            />
            <MetricCard
              label="Interface pLDDT"
              value={audit.interfaceConfidence == null ? "Unavailable" : audit.interfaceConfidence.toFixed(1)}
              detail={audit.confidenceMode === "plddt" && audit.interfaceConfidence != null
                ? `Median from B-factor field · ${Math.round((audit.interfaceConfidenceCoverage ?? 0) * 100)}% coverage`
                : audit.confidenceMode === "plddt"
                  ? audit.contactPairCount === 0 ? "No interface residues to summarize" : "Invalid, missing, sparse, or out-of-range values"
                  : "Off unless explicitly enabled"}
            />
          </div>

          {decisionBrief && (
            <AuditDecisionSummary
              brief={decisionBrief}
              workflow={workflowCoverage}
              onSaveNotebook={saveNotebookSummary}
              onExportDossier={exportDossier}
              onExportMarkdown={exportHandoffMarkdown}
            />
          )}

          <div className="results-grid">
            <section className="panel findings-panel">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">Explainable audit</p>
                  <h2>What supports—or weakens—the pose</h2>
                </div>
              </div>
              <div className="finding-list">
                {audit.findings.map((finding) => (
                  <article key={finding.label} className="finding-row">
                    <FindingIcon level={finding.level} />
                    <div>
                      <div className="finding-title">
                        <h3>{finding.label}</h3>
                        <span className={`finding-status status-${finding.level}`}>{finding.level}</span>
                      </div>
                      <p>{finding.evidence}</p>
                      <small>{finding.action}</small>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel methods-panel">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">Scope control</p>
                  <h2>Methods and limitations</h2>
                </div>
                <CircleHelp className="panel-icon" />
              </div>
              <Alert className="scope-alert">
                <AlertTriangle />
                <AlertTitle>Prioritization evidence—not binding proof</AlertTitle>
                <AlertDescription>
                  Favorable geometry does not establish biological binding. ConfoVHH does not predict affinity, specificity, stability, signaling, or experimental validity.
                </AlertDescription>
              </Alert>
              <ul className="warning-list">
                {audit.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
              <details>
                <summary>Show calculation definitions</summary>
                <dl className="method-list">
                  <div><dt>Residue contact</dt><dd>Any cross-chain heavy atoms ≤ {audit.methods.residueContactCutoffAngstrom} Å</dd></div>
                  <div><dt>Potential polar contact</dt><dd>Typed donor–acceptor pairs from 2.4–{audit.methods.polarProxyCutoffAngstrom} Å; angular geometry is not assessed</dd></div>
                  <div><dt>Salt bridge proxy</dt><dd>Selected acidic/basic side-chain atoms from 2.4–{audit.methods.saltBridgeProxyCutoffAngstrom} Å</dd></div>
                  <div><dt>Severe overlap</dt><dd>Element-specific van der Waals overlap ≥ {audit.methods.severeClashOverlapAngstrom} Å, collapsed by residue pair</dd></div>
                  <div><dt>Buried area</dt><dd>Shrake–Rupley, {audit.methods.sasaSpherePoints} points/atom, {audit.methods.sasaProbeRadiusAngstrom} Å probe. {audit.methods.sasaRadii}</dd></div>
                  <div><dt>SASA orientation</dt><dd>{audit.methods.sasaOrientation}</dd></div>
                  <div><dt>SASA frame algorithm</dt><dd>{audit.methods.sasaFrameAlgorithm}</dd></div>
                  <div><dt>IMGT regions</dt><dd>{audit.methods.cdrAnnotation}</dd></div>
                  <div><dt>Interface PAE</dt><dd>{audit.methods.paeSummary}</dd></div>
                </dl>
              </details>
            </section>
          </div>

          <ContactExplorer audit={audit} onDownload={downloadText} />

          {structure && (
            <IntendedFootprintPanel
              structure={structure}
              receptorChain={receptorChain}
              audit={audit}
              input={researchContext.intendedFootprint}
            />
          )}

          {structure && (
            <TopologyAnnotationPanel
              structure={structure}
              receptorChain={receptorChain}
              audit={audit}
              value={topologyInput}
              onChange={setTopologyInput}
            />
          )}

          {pae && paeOrderConfirmed && structure && (
            <PaeExplorer
              pae={pae}
              structure={structure}
              receptorChain={receptorChain}
              vhhChain={vhhChain}
              audit={audit}
            />
          )}

          <section className="panel ensemble-panel" id="ensemble-comparison" ref={ensembleRef} tabIndex={-1} aria-label="Multi-pose ensemble comparison">
            <div className="panel-heading compact ensemble-heading">
              <div>
                <p className="eyebrow">04 · Multi-pose consistency</p>
                <h2>Compare model seeds or poses</h2>
                <p className="ensemble-intro">
                  Upload matching poses to measure whether the same receptor epitope, VHH paratope, and residue contacts recur.
                </p>
              </div>
              <Layers3 className="panel-icon" />
            </div>

            {!ensemble ? (
              <div className="ensemble-upload">
                <div>
                  <strong>Current audited pose becomes the reference.</strong>
                  <p>
                    Add 1–{MAX_ENSEMBLE_POSES - 1} text PDB/mmCIF poses with exact matching observed receptor and VHH sequences. Chain IDs and file formats may differ.
                  </p>
                </div>
                <Input
                  type="file"
                  multiple
                  accept=".pdb,.ent,.cif,.mmcif,chemical/x-pdb,chemical/x-cif"
                  aria-label="Choose additional PDB or mmCIF poses for ensemble comparison"
                  disabled={Boolean(loading)}
                  onChange={(event) => {
                    const files = event.currentTarget.files;
                    if (files?.length) void runEnsemble(files);
                    event.currentTarget.value = "";
                  }}
                />
                <small>
                  Ensemble comparison intentionally ignores PAE and pLDDT. Candidates must contain one model and are compared as supplied; pre-expand a candidate if a deposited assembly copy is required.
                </small>
              </div>
            ) : (
              <>
                <div className="ensemble-actions">
                  <div>
                    <strong>{ensemble.poseCount} compatible poses compared</strong>
                    <p>{ensembleMode}</p>
                  </div>
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label="Export accepted ensemble poses as CSV"
                      onClick={() => exportEnsemble("csv")}
                      disabled={Boolean(loading)}
                    >
                      <Download /> Accepted poses CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label="Export ensemble report as JSON"
                      onClick={() => exportEnsemble("json")}
                      disabled={Boolean(loading)}
                    >
                      <Download /> JSON
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Clear ensemble comparison"
                      disabled={Boolean(loading)}
                      onClick={() => {
                        setEnsemble(null);
                        setEnsembleRejected([]);
                        setEnsembleMode(null);
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                </div>

                {ensembleProvenanceSignatures.size > 1 && (
                  <Alert className="ensemble-rejections">
                    <AlertTriangle />
                    <AlertTitle>Mixed coordinate provenance</AlertTitle>
                    <AlertDescription>
                      Formats, scopes, model IDs, or assembly selections differ across poses. Recurrence remains descriptive and should be interpreted with those differences in view.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="ensemble-table-wrap">
                  <Table containerLabel="Scrollable pose-ensemble comparison table">
                  <TableHeader>
                      <TableRow>
                        <TableHead>Recurrence rank</TableHead>
                        <TableHead>Pose</TableHead>
                        <TableHead>Geometry band</TableHead>
                        <TableHead>Ensemble consensus</TableHead>
                        <TableHead>Recurrent contacts</TableHead>
                        <TableHead>Contacts</TableHead>
                        <TableHead>Clashes</TableHead>
                        <TableHead>ΔSASA</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ensemble.poses.map((pose) => (
                        <TableRow key={pose.id}>
                          <TableCell className="mono-cell">{pose.rank}</TableCell>
                          <TableCell>
                            <strong className="pose-filename" title={pose.filename}>{pose.filename}</strong>
                            <small
                              className="pose-digest"
                              title={pose.sha256 == null ? "SHA-256 digest unavailable" : `Full SHA-256: ${pose.sha256}`}
                            >
                              {pose.isReference ? "reference · " : ""}{pose.sha256 == null
                                ? "SHA-256 unavailable"
                                : `SHA-256 prefix ${pose.sha256.slice(0, 12)}…`}
                            </small>
                            <small className="pose-digest">
                              {pose.sourceFormat.toUpperCase()} · {pose.coordinateScope} · model {pose.selectedModelId}{pose.selectedAssemblyId ? ` · assembly ${pose.selectedAssemblyId}` : ""}
                            </small>
                          </TableCell>
                          <TableCell>
                            <span className={`ensemble-group ensemble-${pose.triageGroup}`}>{pose.triageGroup}</span>
                          </TableCell>
                          <TableCell className="mono-cell">
                            {pose.ensembleConsensus == null ? "—" : pose.ensembleConsensus.toFixed(3)}
                          </TableCell>
                          <TableCell className="mono-cell">
                            {pose.recurrentContactShare == null ? "—" : `${Math.round(pose.recurrentContactShare * 100)}%`}
                          </TableCell>
                          <TableCell className="mono-cell">{pose.contactPairCount}</TableCell>
                          <TableCell className="mono-cell">{pose.severeClashCount}</TableCell>
                          <TableCell className="mono-cell">{pose.deltaSasaAngstrom2.toFixed(0)} Å²</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {ensembleRejected.length > 0 && (
                  <Alert className="ensemble-rejections">
                    <AlertTriangle />
                    <AlertTitle>{ensembleRejected.length} pose{ensembleRejected.length === 1 ? " was" : "s were"} excluded</AlertTitle>
                    <AlertDescription>
                      {ensembleRejected.map((pose) => `${pose.filename}: ${pose.reason}`).join(" · ")}
                    </AlertDescription>
                  </Alert>
                )}

                <EnsembleConsensusMatrix ensemble={ensemble} rejected={ensembleRejected} />

                <details className="ensemble-methods">
                  <summary>How consensus and recurrence-first rank are calculated</summary>
                  <dl className="method-list">
                    <div><dt>Residue mapping</dt><dd>{ensemble.methods.residueMapping}</dd></div>
                    <div><dt>Ensemble consensus</dt><dd>{ensemble.methods.ensembleConsensus}</dd></div>
                    <div><dt>Rank order</dt><dd>{ensemble.methods.ranking}</dd></div>
                    <div><dt>Recurrent contacts</dt><dd>{ensemble.methods.recurrentContactShare}</dd></div>
                  </dl>
                  <ul className="warning-list">
                    {ensemble.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </details>
              </>
            )}
          </section>

          {structure && filename && (
            <StatePairPanel
              key={[
                coordinateSha256 ?? "digest-unavailable",
                structure.coordinateScope,
                structure.selectedModelId,
                structure.selectedAssembly?.id ?? "as-supplied",
                receptorChain,
                vhhChain,
              ].join(":")}
              reference={{
                filename,
                sha256: coordinateSha256,
                bytes: coordinateBytes,
                structure,
                receptorChain,
                vhhChain,
              }}
              busy={Boolean(loading)}
              onBusyChange={setLoading}
              onResultChange={setStatePairResult}
              cancelToken={cancelToken}
            />
          )}

        </section>
      ) : (
        <section className="empty-results" aria-label="Analysis status">
          <span>03</span>
          <div>
            <h2>Interface evidence will appear here</h2>
            <p>Import a complex, confirm the chain assignment, and run the geometry audit.</p>
          </div>
        </section>
      )}

      <ValidationRecord />

      <footer>
        <span>ConfoVHH product {CONFOVHH_PRODUCT_RELEASE} · engine {CONFOVHH_VERSION}</span>
        <span>Local-first single-pose and prediction-run structural triage</span>
        <a href="https://github.com/darwinxcai/ConfoVHH" target="_blank" rel="noreferrer">Source, methods, and citation</a>
        <a href="https://www.rcsb.org/structure/3P0G" target="_blank" rel="noreferrer">Demo source: RCSB PDB 3P0G</a>
      </footer>
    </main>
  );
}
