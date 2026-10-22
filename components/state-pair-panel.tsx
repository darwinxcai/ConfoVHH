"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileDiff,
  LoaderCircle,
  ShieldAlert,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { safeDownloadFilename } from "@/lib/download";
import { sha256Hex } from "@/lib/sha256";
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
import type { StatePairAuditJobResult } from "@/lib/audit-jobs";
import type {
  AuditWorkerRequest,
  AuditWorkerResponse,
} from "@/lib/audit-worker-protocol";
import type { ParsedStructure } from "@/lib/confovhh";
import {
  createStatePairExportReport,
  statePairToCsv,
  type StateContextLabel,
  type StatePairContactSummary,
  type StatePairCoordinateSummary,
} from "@/lib/state-pair";

const MAX_COORDINATE_FILE_BYTES = 12 * 1024 * 1024;
const UNLABELED = "__unlabeled__";
const DISPLAY_CONTACTS_PER_GROUP = 40;

export interface StatePairReference {
  filename: string;
  sha256: string | null;
  bytes: number | null;
  structure: ParsedStructure;
  receptorChain: string;
  vhhChain: string;
}

export interface StatePairPanelProps {
  reference: StatePairReference;
  busy: boolean;
  onBusyChange: (message: string | null) => void;
  onResultChange?: (result: StatePairAuditJobResult | null) => void;
  cancelToken?: number;
}

type ContactGroup = "shared" | "reference only" | "comparison only";

interface ContactDisplayRow {
  group: ContactGroup;
  contact: StatePairContactSummary;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "size unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatLabel(label: StateContextLabel | null): string {
  return label == null ? "unlabeled" : label;
}

function coordinateEvidenceLabel(value: StatePairCoordinateSummary["evidenceLevel"]): string {
  if (value === "supported") return "Coherent coordinate geometry";
  if (value === "mixed") return "Mixed coordinate evidence";
  if (value === "limited") return "Weak coordinate evidence";
  return "Not assessable";
}

function formatJaccard(value: number | null): string {
  return value == null ? "Not defined" : `${value.toFixed(3)} (${Math.round(value * 100)}%)`;
}

function formatSigned(value: number, digits = 0, unit = ""): string {
  const roundedNumber = Number(value.toFixed(digits));
  const rounded = Object.is(roundedNumber, -0)
    ? (0).toFixed(digits)
    : roundedNumber.toFixed(digits);
  const prefix = roundedNumber > 0 ? "+" : "";
  return `${prefix}${rounded}${unit}`;
}

function chainProvenance(chain: StatePairCoordinateSummary["receptorChain"]): string {
  const identifiers = [
    chain.labelAsymId ? `label ${chain.labelAsymId}` : null,
    chain.authAsymId ? `auth ${chain.authAsymId}` : null,
    chain.assemblyCopyIndex == null ? null : `copy ${chain.assemblyCopyIndex}`,
    chain.assemblyOperationIds.length ? `op ${chain.assemblyOperationIds.join("×")}` : null,
  ].filter(Boolean);
  return identifiers.length ? `${chain.id} · ${identifiers.join(" · ")}` : chain.id;
}

function coordinateProvenance(pose: StatePairCoordinateSummary): string {
  return [
    pose.sourceFormat.toUpperCase(),
    pose.coordinateScope,
    `model ${pose.selectedModelId}`,
    pose.selectedAssemblyId ? `assembly ${pose.selectedAssemblyId}` : null,
  ].filter(Boolean).join(" · ");
}

function contactName(contact: StatePairContactSummary): string {
  const receptor = contact.receptorResidue || `R:${contact.receptorResidueOrder}`;
  const vhh = contact.vhhResidue || `VHH:${contact.vhhResidueOrder}`;
  return `${receptor} ↔ ${vhh}`;
}

function PairMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="state-pair-metric">
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function PoseCard({
  role,
  pose,
}: {
  role: "Reference" | "Comparison";
  pose: StatePairCoordinateSummary;
}) {
  return (
    <article className="state-pose-card">
      <div className="state-pose-title">
        <div>
          <p>{role}</p>
          <h3 title={pose.filename}>{pose.filename}</h3>
        </div>
        <Badge variant="outline">
          {pose.label == null ? "unlabeled" : `${formatLabel(pose.label)} · user label`}
        </Badge>
      </div>
      <dl>
        <div><dt>Evidence</dt><dd>{coordinateEvidenceLabel(pose.evidenceLevel)}</dd></div>
        <div><dt>Contacts</dt><dd>{pose.contactPairCount}</dd></div>
        <div><dt>Severe clashes</dt><dd>{pose.severeClashCount}</dd></div>
        <div><dt>Protein ΔSASA</dt><dd>{pose.deltaSasaAngstrom2.toFixed(0)} Å²</dd></div>
        <div><dt>Coordinates</dt><dd>{coordinateProvenance(pose)}</dd></div>
        <div><dt>Experimental method</dt><dd>{pose.experimentalMethod ?? "not reported"}</dd></div>
        <div><dt>Receptor</dt><dd>{chainProvenance(pose.receptorChain)}</dd></div>
        <div><dt>VHH</dt><dd>{chainProvenance(pose.vhhChain)}</dd></div>
        <div>
          <dt>File</dt>
          <dd title={pose.sha256 ?? undefined}>
            {formatBytes(pose.bytes)} · {pose.sha256 == null
              ? "SHA-256 unavailable"
              : `SHA-256 prefix ${pose.sha256.slice(0, 16)}…`}
          </dd>
        </div>
        <div><dt>Coordinate fingerprint</dt><dd title={pose.coordinateFingerprint}>{pose.coordinateFingerprint}</dd></div>
        <div><dt>Rigid-geometry fingerprint</dt><dd title={pose.geometryFingerprint}>{pose.geometryFingerprint}</dd></div>
      </dl>
    </article>
  );
}

export function StatePairPanel({ reference, busy, onBusyChange, onResultChange, cancelToken = 0 }: StatePairPanelProps) {
  const [referenceLabel, setReferenceLabel] = useState<StateContextLabel | null>(null);
  const [comparisonLabel, setComparisonLabel] = useState<StateContextLabel | null>(null);
  const [comparisonFile, setComparisonFile] = useState<File | null>(null);
  const [result, setResult] = useState<StatePairAuditJobResult | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerTimeoutRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const ownsBusyRef = useRef(false);
  const operationActiveRef = useRef(false);

  useEffect(() => () => {
    requestIdRef.current += 1;
    if (workerTimeoutRef.current != null) window.clearTimeout(workerTimeoutRef.current);
    workerTimeoutRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    operationActiveRef.current = false;
    if (ownsBusyRef.current) {
      ownsBusyRef.current = false;
      onBusyChange(null);
    }
    onResultChange?.(null);
  }, [onBusyChange, onResultChange]);

  useEffect(() => {
    if (!operationActiveRef.current) return;
    const timer = window.setTimeout(() => {
      requestIdRef.current += 1;
      if (workerTimeoutRef.current != null) window.clearTimeout(workerTimeoutRef.current);
      workerTimeoutRef.current = null;
      workerRef.current?.terminate();
      workerRef.current = null;
      operationActiveRef.current = false;
      setLocalBusy(false);
      setProgress(null);
      setLocalError("The paired-coordinate comparison was cancelled.");
      if (ownsBusyRef.current) {
        ownsBusyRef.current = false;
        onBusyChange(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cancelToken, onBusyChange]);

  const contactRows = useMemo<ContactDisplayRow[]>(() => {
    if (!result) return [];
    return [
      ...result.summary.contacts.shared.slice(0, DISPLAY_CONTACTS_PER_GROUP)
        .map((contact) => ({ group: "shared" as const, contact })),
      ...result.summary.contacts.referenceOnly.slice(0, DISPLAY_CONTACTS_PER_GROUP)
        .map((contact) => ({ group: "reference only" as const, contact })),
      ...result.summary.contacts.comparisonOnly.slice(0, DISPLAY_CONTACTS_PER_GROUP)
        .map((contact) => ({ group: "comparison only" as const, contact })),
    ];
  }, [result]);

  const hiddenContactCount = result == null ? 0 : (
    Math.max(0, result.summary.contacts.shared.length - DISPLAY_CONTACTS_PER_GROUP) +
    Math.max(0, result.summary.contacts.referenceOnly.length - DISPLAY_CONTACTS_PER_GROUP) +
    Math.max(0, result.summary.contacts.comparisonOnly.length - DISPLAY_CONTACTS_PER_GROUP)
  );

  const deltaRows = useMemo(() => {
    if (!result) return [];
    const referenceAudit = result.summary.reference.audit;
    const comparisonAudit = result.summary.comparison.audit;
    const deltas = result.summary.deltas;
    return [
      { label: "Residue-contact pairs", reference: referenceAudit.contactPairCount, comparison: comparisonAudit.contactPairCount, delta: deltas.contactPairCount, digits: 0, unit: "" },
      { label: "Atom contacts", reference: referenceAudit.atomContactCount, comparison: comparisonAudit.atomContactCount, delta: deltas.atomContactCount, digits: 0, unit: "" },
      { label: "Receptor interface residues", reference: referenceAudit.receptorInterfaceResidues, comparison: comparisonAudit.receptorInterfaceResidues, delta: deltas.receptorInterfaceResidues, digits: 0, unit: "" },
      { label: "VHH interface residues", reference: referenceAudit.vhhInterfaceResidues, comparison: comparisonAudit.vhhInterfaceResidues, delta: deltas.vhhInterfaceResidues, digits: 0, unit: "" },
      { label: "Polar-contact proxies", reference: referenceAudit.polarContactProxyCount, comparison: comparisonAudit.polarContactProxyCount, delta: deltas.polarContactProxyCount, digits: 0, unit: "" },
      { label: "Salt-bridge proxies", reference: referenceAudit.saltBridgeProxyCount, comparison: comparisonAudit.saltBridgeProxyCount, delta: deltas.saltBridgeProxyCount, digits: 0, unit: "" },
      { label: "Severe-clash residue pairs", reference: referenceAudit.severeClashCount, comparison: comparisonAudit.severeClashCount, delta: deltas.severeClashCount, digits: 0, unit: "" },
      { label: "Possible interchain disulfides", reference: referenceAudit.possibleInterchainDisulfideCount, comparison: comparisonAudit.possibleInterchainDisulfideCount, delta: deltas.possibleInterchainDisulfideCount, digits: 0, unit: "" },
      { label: "Maximum vdW overlap", reference: referenceAudit.maximumOverlapAngstrom, comparison: comparisonAudit.maximumOverlapAngstrom, delta: deltas.maximumOverlapAngstrom, digits: 2, unit: " Å" },
      { label: "Protein ΔSASA", reference: referenceAudit.deltaSasaAngstrom2, comparison: comparisonAudit.deltaSasaAngstrom2, delta: deltas.deltaSasaAngstrom2, digits: 0, unit: " Å²" },
      { label: "Receptor buried area", reference: referenceAudit.receptorBuriedSurfaceAreaAngstrom2, comparison: comparisonAudit.receptorBuriedSurfaceAreaAngstrom2, delta: deltas.receptorBuriedSurfaceAreaAngstrom2, digits: 0, unit: " Å²" },
      { label: "VHH buried area", reference: referenceAudit.vhhBuriedSurfaceAreaAngstrom2, comparison: comparisonAudit.vhhBuriedSurfaceAreaAngstrom2, delta: deltas.vhhBuriedSurfaceAreaAngstrom2, digits: 0, unit: " Å²" },
      { label: "½ΔSASA interface area", reference: referenceAudit.halfDeltaSasaInterfaceAreaAngstrom2, comparison: comparisonAudit.halfDeltaSasaInterfaceAreaAngstrom2, delta: deltas.halfDeltaSasaInterfaceAreaAngstrom2, digits: 0, unit: " Å²" },
      { label: "IMGT CDR-contact share", reference: referenceAudit.paratopeProxyShare, comparison: comparisonAudit.paratopeProxyShare, delta: deltas.paratopeProxyShare, digits: 3, unit: "" },
      { label: "IMGT CDR3-contact share", reference: referenceAudit.cdr3ProxyShare, comparison: comparisonAudit.cdr3ProxyShare, delta: deltas.cdr3ProxyShare, digits: 3, unit: "" },
    ];
  }, [result]);

  const mixedProvenance = result != null && (
    result.summary.reference.sourceFormat !== result.summary.comparison.sourceFormat ||
    result.summary.reference.coordinateScope !== result.summary.comparison.coordinateScope ||
    result.summary.reference.selectedModelId !== result.summary.comparison.selectedModelId ||
    result.summary.reference.selectedAssemblyId !== result.summary.comparison.selectedAssemblyId ||
    result.summary.reference.experimentalMethod !== result.summary.comparison.experimentalMethod ||
    result.summary.reference.coordinateProvenance !== result.summary.comparison.coordinateProvenance
  );

  const sha256 = (bytes: ArrayBuffer): Promise<string> => sha256Hex(bytes);

  const decodeUtf8 = (bytes: ArrayBuffer, label: string): string => {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(
        `${label} is not valid UTF-8 text. Binary CIF, gzip, and legacy encodings are not supported.`,
      );
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

  const finishOperation = (worker: Worker, requestId: number): boolean => {
    if (
      requestIdRef.current !== requestId ||
      workerRef.current !== worker ||
      !operationActiveRef.current
    ) return false;
    requestIdRef.current += 1;
    if (workerTimeoutRef.current != null) window.clearTimeout(workerTimeoutRef.current);
    workerTimeoutRef.current = null;
    worker.terminate();
    workerRef.current = null;
    operationActiveRef.current = false;
    setLocalBusy(false);
    setProgress(null);
    if (ownsBusyRef.current) {
      ownsBusyRef.current = false;
      onBusyChange(null);
    }
    return true;
  };

  const compare = async () => {
    if (!comparisonFile || busy || localBusy) return;
    if (comparisonFile.size > MAX_COORDINATE_FILE_BYTES) {
      setLocalError("The comparison coordinate file is larger than the 12 MB browser-analysis limit.");
      return;
    }
    if (!/\.(?:pdb|ent|cif|mmcif)$/i.test(comparisonFile.name)) {
      setLocalError("Choose a text .pdb, .ent, .cif, or .mmcif comparison coordinate file.");
      return;
    }

    workerRef.current?.terminate();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    operationActiveRef.current = true;
    setLocalBusy(true);
    setLocalError(null);
    setProgress("Reading and hashing the comparison coordinates…");
    ownsBusyRef.current = true;
    onBusyChange("Preparing paired-coordinate state-context comparison…");

    try {
      const bytes = await comparisonFile.arrayBuffer();
      if (requestIdRef.current !== requestId) return;
      const [text, digest] = await Promise.all([
        Promise.resolve(decodeUtf8(bytes, comparisonFile.name)),
        sha256(bytes),
      ]);
      if (requestIdRef.current !== requestId) return;

      const worker = new Worker(
        new URL("../lib/audit-worker.ts", import.meta.url),
        { type: "module", name: "confovhh-state-pair" },
      );
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent<AuditWorkerResponse>) => {
        const response = event.data;
        if (response.requestId !== requestId || requestIdRef.current !== requestId) return;
        if (response.type === "progress") {
          const nextProgress = response.total > 0
            ? `Auditing coordinate context ${response.completed}/${response.total}: ${response.filename}`
            : `Auditing coordinate context: ${response.filename}`;
          setProgress(nextProgress);
          onBusyChange(nextProgress);
          return;
        }
        if (response.type === "state-pair-result") {
          if (!finishOperation(worker, requestId)) return;
          setResult(response.result);
          onResultChange?.(response.result);
          setComparisonFile(null);
          return;
        }
        if (response.type === "error") {
          if (!finishOperation(worker, requestId)) return;
          setLocalError(response.error);
          return;
        }
        if (!finishOperation(worker, requestId)) return;
        setLocalError("The paired-coordinate worker returned an unexpected response type.");
      };
      worker.onerror = (event) => {
        if (requestIdRef.current !== requestId) return;
        if (!finishOperation(worker, requestId)) return;
        setLocalError(event.message || "The paired-coordinate worker stopped unexpectedly.");
      };
      worker.onmessageerror = () => {
        if (requestIdRef.current !== requestId) return;
        if (!finishOperation(worker, requestId)) return;
        setLocalError("The paired-coordinate worker returned an unreadable message.");
      };

      const request: AuditWorkerRequest = {
        requestId,
        type: "state-pair",
        job: {
          reference: {
            filename: reference.filename,
            sha256: reference.sha256,
            bytes: reference.bytes,
            structure: reference.structure,
            receptorChain: reference.receptorChain,
            vhhChain: reference.vhhChain,
            label: referenceLabel,
          },
          comparison: {
            filename: comparisonFile.name,
            text,
            sha256: digest,
            bytes: bytes.byteLength,
            assemblyId: null,
            label: comparisonLabel,
          },
        },
      };
      setProgress("Auditing both coordinate contexts with one coordinate-only policy…");
      workerTimeoutRef.current = window.setTimeout(() => {
        if (requestIdRef.current !== requestId) return;
        if (!finishOperation(worker, requestId)) return;
        setLocalError("The paired-coordinate comparison exceeded the three-minute browser time limit.");
      }, 180_000);
      try {
        worker.postMessage(request);
      } catch (caught) {
        if (!finishOperation(worker, requestId)) return;
        setLocalError(caught instanceof Error ? caught.message : "The paired-coordinate comparison could not be started.");
      }
    } catch (caught) {
      if (requestIdRef.current !== requestId) return;
      requestIdRef.current += 1;
      workerRef.current?.terminate();
      workerRef.current = null;
      operationActiveRef.current = false;
      setLocalBusy(false);
      setProgress(null);
      if (ownsBusyRef.current) {
        ownsBusyRef.current = false;
        onBusyChange(null);
      }
      setLocalError(
        caught instanceof Error ? caught.message : "The paired-coordinate comparison could not be completed.",
      );
    }
  };

  const clear = () => {
    if (localBusy) return;
    setComparisonFile(null);
    setResult(null);
    onResultChange?.(null);
    setProgress(null);
    setLocalError(null);
  };

  const exportResult = (format: "json" | "csv") => {
    if (!result || busy || localBusy) return;
    try {
      const content = format === "json"
        ? JSON.stringify(
          createStatePairExportReport(result.summary, result.comparisonMode),
          null,
          2,
        )
        : statePairToCsv(result.summary);
      downloadText(
        content,
        format === "json" ? "application/json" : "text/csv;charset=utf-8",
        `confovhh_state_pair.${format}`,
      );
      setLocalError(null);
    } catch (caught) {
      setLocalError(caught instanceof Error
        ? `Paired-coordinate ${format.toUpperCase()} export failed: ${caught.message}`
        : `Paired-coordinate ${format.toUpperCase()} export failed unexpectedly.`);
    }
  };

  return (
    <section className="panel state-pair-panel" id="paired-context" aria-label="Paired-coordinate state-context comparison">
      <div className="panel-heading compact state-pair-heading">
        <div>
          <p className="eyebrow">05 · Paired coordinate context</p>
          <h2>Compare two receptor–VHH coordinate contexts</h2>
          <p className="state-pair-intro">
            Hold the observed receptor and VHH sequences fixed, then compare interface geometry between the current reference and one uploaded coordinate model.
          </p>
        </div>
        <FileDiff className="panel-icon" />
      </div>

      <Alert className="state-boundary-alert" role="note">
        <ShieldAlert />
        <AlertTitle>Descriptive coordinate comparison only</AlertTitle>
        <AlertDescription>
          Neutral, active, and inactive are optional user-supplied labels—not states inferred by ConfoVHH. Similarity, deltas, and interface evidence do not establish binding, affinity, specificity, signaling, thermodynamic stability, or conformational selectivity.
        </AlertDescription>
      </Alert>

      {!result ? (
        <div className="state-pair-setup">
          <div className="state-reference-context">
            <div>
              <span>Current reference</span>
              <strong title={reference.filename}>{reference.filename}</strong>
              <small>
                Chains {reference.receptorChain} ↔ {reference.vhhChain} · {reference.structure.sourceFormat.toUpperCase()} · {reference.structure.coordinateScope} · model {reference.structure.selectedModelId}
              </small>
            </div>
            <label>
              <span>Reference label</span>
              <Select
                value={referenceLabel ?? UNLABELED}
                disabled={busy || localBusy}
                onValueChange={(value) => setReferenceLabel(
                  value === UNLABELED ? null : value as StateContextLabel,
                )}
              >
                <SelectTrigger aria-label="Optional user-supplied reference state label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNLABELED}>No state label</SelectItem>
                  <SelectItem value="neutral">Neutral (user label)</SelectItem>
                  <SelectItem value="active">Active (user label)</SelectItem>
                  <SelectItem value="inactive">Inactive (user label)</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>

          <div className="state-pair-arrow" aria-hidden="true"><ArrowRight /></div>

          <div className="state-comparison-context">
            <div>
              <span>Comparison coordinate</span>
              <strong>{comparisonFile?.name ?? "No file selected"}</strong>
              <small>
                {comparisonFile
                  ? `${formatBytes(comparisonFile.size)} · parsed in its as-supplied scope`
                  : "One text PDB/mmCIF, at most 12 MB"}
              </small>
            </div>
            <Input
              type="file"
              accept=".pdb,.ent,.cif,.mmcif,chemical/x-pdb,chemical/x-cif"
              aria-label="Choose a comparison PDB or mmCIF coordinate file"
              disabled={busy || localBusy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                event.currentTarget.value = "";
                setLocalError(null);
                setResult(null);
                if (!file) return;
                if (file.size > MAX_COORDINATE_FILE_BYTES) {
                  setComparisonFile(null);
                  setLocalError("The comparison coordinate file is larger than the 12 MB browser-analysis limit.");
                  return;
                }
                if (!/\.(?:pdb|ent|cif|mmcif)$/i.test(file.name)) {
                  setComparisonFile(null);
                  setLocalError("Choose a text .pdb, .ent, .cif, or .mmcif comparison coordinate file.");
                  return;
                }
                setComparisonFile(file);
              }}
            />
            <label>
              <span>Comparison label</span>
              <Select
                value={comparisonLabel ?? UNLABELED}
                disabled={busy || localBusy}
                onValueChange={(value) => setComparisonLabel(
                  value === UNLABELED ? null : value as StateContextLabel,
                )}
              >
                <SelectTrigger aria-label="Optional user-supplied comparison state label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNLABELED}>No state label</SelectItem>
                  <SelectItem value="neutral">Neutral (user label)</SelectItem>
                  <SelectItem value="active">Active (user label)</SelectItem>
                  <SelectItem value="inactive">Inactive (user label)</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>

          <div className="state-pair-run-row">
            <Button
              onClick={() => void compare()}
              disabled={!comparisonFile || busy || localBusy}
            >
              {localBusy ? <LoaderCircle className="animate-spin" /> : <FileDiff />}
              Compare coordinate contexts
            </Button>
            <small>
              Exact observed receptor and VHH sequences are required. Ambiguous copies, duplicate coordinates, multi-model comparison files, PAE, and pLDDT are excluded.
            </small>
          </div>
        </div>
      ) : (
        <div className="state-pair-results">
          <p className="sr-only" role="status" aria-live="polite">
            Paired coordinate audit complete.
          </p>
          <div className="ensemble-actions state-pair-actions">
            <div>
              <strong>Paired coordinate audit complete</strong>
              <p>{result.comparisonMode}</p>
            </div>
            <div>
              <Button
                variant="outline"
                size="sm"
                aria-label="Export paired-coordinate contacts and metrics as CSV"
                onClick={() => exportResult("csv")}
                disabled={busy || localBusy}
              >
                <Download /> CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label="Export paired-coordinate report as JSON"
                onClick={() => exportResult("json")}
                disabled={busy || localBusy}
              >
                <Download /> JSON
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Clear paired-coordinate comparison"
                onClick={clear}
                disabled={busy || localBusy}
              >Clear</Button>
            </div>
          </div>

          <div className="state-pose-grid">
            <PoseCard role="Reference" pose={result.summary.reference} />
            <PoseCard role="Comparison" pose={result.summary.comparison} />
          </div>

          {mixedProvenance && (
            <Alert className="state-pair-provenance-alert" role="note">
              <AlertTriangle />
              <AlertTitle>Coordinate provenance differs</AlertTitle>
              <AlertDescription>
                File format, coordinate scope, selected model or assembly, reported experimental method, or experimental/model provenance differs between the two inputs. The comparison remains descriptive; inspect both provenance records before attributing a change to receptor context.
              </AlertDescription>
            </Alert>
          )}

          <div className="state-pair-metrics">
            <PairMetric
              label="Contact-pair Jaccard"
              value={formatJaccard(result.summary.similarity.contactPairs)}
              detail="Same receptor–VHH residue-pair contacts"
            />
            <PairMetric
              label="Receptor-epitope Jaccard"
              value={formatJaccard(result.summary.similarity.receptorEpitope)}
              detail="Same contacting receptor residue orders"
            />
            <PairMetric
              label="VHH-paratope Jaccard"
              value={formatJaccard(result.summary.similarity.vhhParatope)}
              detail="Same contacting VHH residue orders"
            />
            <PairMetric
              label="Δ contact pairs"
              value={formatSigned(result.summary.deltas.contactPairCount)}
              detail="Comparison minus reference"
            />
            <PairMetric
              label="Δ severe clashes"
              value={formatSigned(result.summary.deltas.severeClashCount)}
              detail="Comparison minus reference"
            />
            <PairMetric
              label="Δ protein ΔSASA"
              value={formatSigned(result.summary.deltas.deltaSasaAngstrom2, 0, " Å²")}
              detail="Comparison minus reference"
            />
          </div>

          <details className="state-delta-details">
            <summary>All signed coordinate-audit deltas</summary>
            <div className="ensemble-table-wrap state-delta-table">
              <Table containerLabel="Scrollable paired-coordinate audit delta table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Comparison</TableHead>
                    <TableHead>Comparison − reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deltaRows.map((row) => (
                    <TableRow key={row.label}>
                      <TableCell>{row.label}</TableCell>
                      <TableCell className="mono-cell">
                        {row.reference == null ? "—" : `${row.reference.toFixed(row.digits)}${row.unit}`}
                      </TableCell>
                      <TableCell className="mono-cell">
                        {row.comparison == null ? "—" : `${row.comparison.toFixed(row.digits)}${row.unit}`}
                      </TableCell>
                      <TableCell className="mono-cell">
                        {row.delta == null ? "—" : formatSigned(row.delta, row.digits, row.unit)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p>Signs are arithmetic only. Positive and negative values are not favorable or unfavorable scores.</p>
          </details>

          <section className="state-contact-section" aria-labelledby="state-contact-heading">
            <div className="state-contact-heading">
              <div>
                <h3 id="state-contact-heading">Residue-contact changes</h3>
                <p>
                  {result.summary.contacts.shared.length} shared · {result.summary.contacts.referenceOnly.length} reference only · {result.summary.contacts.comparisonOnly.length} comparison only
                </p>
              </div>
              <Badge variant="secondary">4.5 Å heavy-atom cutoff</Badge>
            </div>
            {contactRows.length ? (
              <div className="ensemble-table-wrap state-contact-table">
                <Table containerLabel="Scrollable paired-coordinate residue-contact table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Context</TableHead>
                      <TableHead>Residue pair</TableHead>
                      <TableHead>Reference distance</TableHead>
                      <TableHead>Comparison distance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contactRows.map(({ group, contact }) => (
                      <TableRow key={`${group}:${contact.receptorResidueOrder}:${contact.vhhResidueOrder}`}>
                        <TableCell>
                          <span className={`state-contact-group state-contact-${group.replaceAll(" ", "-")}`}>
                            {group}
                          </span>
                        </TableCell>
                        <TableCell className="mono-cell">{contactName(contact)}</TableCell>
                        <TableCell className="mono-cell">
                          {contact.referenceMinimumDistanceAngstrom == null
                            ? "—"
                            : `${contact.referenceMinimumDistanceAngstrom.toFixed(2)} Å`}
                        </TableCell>
                        <TableCell className="mono-cell">
                          {contact.comparisonMinimumDistanceAngstrom == null
                            ? "—"
                            : `${contact.comparisonMinimumDistanceAngstrom.toFixed(2)} Å`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="state-contact-empty">Neither coordinate context contains an assessable residue contact.</div>
            )}
            {hiddenContactCount > 0 && (
              <p className="state-contact-limit">
                {hiddenContactCount} additional contact rows are omitted from the browser table and retained in both the JSON and CSV exports.
              </p>
            )}
          </section>

          <details className="ensemble-methods state-pair-methods">
            <summary>Methods, provenance, and interpretation boundaries</summary>
            <dl className="method-list">
              <div><dt>Residue mapping</dt><dd>{result.summary.methods.residueMapping}</dd></div>
              <div><dt>Contact definition</dt><dd>{result.summary.methods.contactDefinition}</dd></div>
              <div><dt>Comparison direction</dt><dd>{result.summary.methods.comparisonDirection}</dd></div>
              <div><dt>Jaccard sets</dt><dd>{result.summary.methods.jaccard}</dd></div>
              <div><dt>Coordinate frame</dt><dd>{result.summary.methods.coordinateFrame}</dd></div>
              <div><dt>SASA orientation</dt><dd>{result.summary.auditPolicy.sasaOrientation}</dd></div>
              <div><dt>SASA frame algorithm</dt><dd>{result.summary.auditPolicy.sasaFrameAlgorithm}</dd></div>
              <div><dt>User labels</dt><dd>{result.summary.methods.labels}</dd></div>
              <div><dt>Duplicate detection</dt><dd>{result.summary.methods.duplicateDetection}</dd></div>
              <div>
                <dt>Selected-atom fit</dt>
                <dd>
                  RMSD {result.summary.selectedGeometryFit.rmsdAngstrom.toFixed(4)} Å · maximum residual {result.summary.selectedGeometryFit.maximumDeviationAngstrom.toFixed(4)} Å
                </dd>
              </div>
              <div><dt>Audit-policy fingerprint</dt><dd>{result.summary.methods.auditPolicyFingerprint}</dd></div>
            </dl>
            <ul className="warning-list">
              {result.summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </details>
        </div>
      )}

      {(localBusy || progress) && (
        <div className="state-pair-progress" role="status" aria-live="polite">
          <LoaderCircle className="animate-spin" />
          <span>{progress ?? "Running paired-coordinate audit…"}</span>
        </div>
      )}

      {localError && (
        <Alert
          variant="destructive"
          className="state-pair-error"
          role="alert"
          aria-live="assertive"
        >
          <AlertTriangle />
          <AlertTitle>Paired comparison stopped</AlertTitle>
          <AlertDescription>{localError}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Alert className="state-pair-complete-boundary" role="note">
          <CheckCircle2 />
          <AlertTitle>What this result supports</AlertTitle>
          <AlertDescription>
            The export supports a reproducible statement about differences between these two selected coordinate interfaces. It does not support a claim that either user label is correct or that the VHH recognizes one receptor state preferentially.
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
