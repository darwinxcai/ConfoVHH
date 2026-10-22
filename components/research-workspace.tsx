"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  ClipboardCheck,
  Download,
  FileArchive,
  FileDown,
  FileUp,
  FlaskConical,
  Layers3,
  Save,
  ShieldCheck,
  Trash2,
  X,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { RejectedEnsemblePose } from "@/lib/audit-jobs";
import type { PoseEnsembleSummary } from "@/lib/pose-ensemble";
import {
  CONFOVHH_PRODUCT_RELEASE,
  MAX_NOTEBOOK_SERIALIZED_BYTES,
  MAX_WORKSPACE_BUNDLE_SERIALIZED_BYTES,
  type CoordinateTriageBrief,
  type NotebookEntry,
  type ResearchContext,
  type WorkflowCoverage,
  type WorkspaceBundle,
} from "@/lib/research-workspace";

export function WorkspaceNavigator({
  hasStructure,
  hasAudit,
  predictionRunHasDraft = false,
  predictionRunHasCommitted = false,
  ensemblePoseCount,
  pairedContextCompared,
}: {
  hasStructure: boolean;
  hasAudit: boolean;
  predictionRunHasDraft?: boolean;
  predictionRunHasCommitted?: boolean;
  ensemblePoseCount: number;
  pairedContextCompared: boolean;
}) {
  const steps = [
    { href: "#coordinate-setup", label: "Input", detail: hasStructure ? "ready" : "required", ready: hasStructure, available: true },
    { href: "#audit-results", label: "Single pose", detail: hasAudit ? "complete" : "required", ready: hasAudit, available: hasAudit },
    { href: "#prediction-run-intake", label: "Batch run", detail: predictionRunHasCommitted ? "complete" : predictionRunHasDraft ? "in progress" : "optional", ready: predictionRunHasCommitted, available: true },
    { href: "#ensemble-comparison", label: "Pose ensemble", detail: ensemblePoseCount > 1 ? `${ensemblePoseCount} poses` : "optional", ready: ensemblePoseCount > 1, available: hasAudit },
    { href: "#paired-context", label: "Context pair", detail: pairedContextCompared ? "complete" : "optional", ready: pairedContextCompared, available: hasAudit },
    { href: "#handoff", label: "Report", detail: hasAudit ? "available" : "locked", ready: hasAudit, available: hasAudit },
  ];
  return (
    <nav className="workflow-navigator" aria-label="Analysis workflow">
      <div className="workflow-intro">
        <span>Research workflow</span>
        <small>Begin with one reference pose; additional comparisons become available after the first audit.</small>
      </div>
      <ol>
        {steps.map((step, index) => (
          <li key={step.href} className={step.ready ? "workflow-ready" : ""}>
            {step.available ? <a href={step.href} aria-label={`${step.label}: ${step.detail}`}>
              <span className="workflow-index">{step.ready ? <Check /> : index + 1}</span>
              <span><strong>{step.label}</strong><small>{step.detail}</small></span>
            </a> : <span className="workflow-step-locked" aria-disabled="true" aria-label={`${step.label}: ${step.detail}`}>
              <span className="workflow-index">{index + 1}</span>
              <span><strong>{step.label}</strong><small>{step.detail}</small></span>
            </span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function ResearchContextPanel({
  context,
  onChange,
}: {
  context: ResearchContext;
  onChange: (field: keyof ResearchContext, value: string) => void;
}) {
  return (
    <details className="panel research-context">
      <summary>
        <span><ClipboardCheck /> Study context</span>
        <small>Optional metadata for the handoff dossier</small>
      </summary>
      <div className="research-context-grid">
        <label><span>Study name</span><Input value={context.studyName} maxLength={100} placeholder="e.g. β₂AR intracellular VHH screen" onChange={(event) => onChange("studyName", event.target.value)} /></label>
        <label><span>Receptor</span><Input value={context.receptorName} maxLength={80} placeholder="e.g. ADRB2" onChange={(event) => onChange("receptorName", event.target.value)} /></label>
        <label><span>Candidate ID</span><Input value={context.candidateId} maxLength={80} placeholder="e.g. VHH-042 / seed 7" onChange={(event) => onChange("candidateId", event.target.value)} /></label>
        <label><span>Coordinate context</span><Input value={context.coordinateContext} maxLength={100} placeholder="e.g. agonist-bound model" onChange={(event) => onChange("coordinateContext", event.target.value)} /></label>
        <label className="research-notes"><span>User-defined intended receptor footprint</span><Textarea value={context.intendedFootprint} maxLength={1_000} placeholder="Optional exact residue identifiers, comma/newline separated; e.g. A:131, A:135, A:272. ConfoVHH reports mapping and observed overlap only." onChange={(event) => onChange("intendedFootprint", event.target.value)} /></label>
        <label className="research-notes"><span>Research notes</span><Textarea value={context.notes} maxLength={1_000} placeholder="Intended use, construct notes, hypotheses, or follow-up decisions. These notes are not interpreted as scientific evidence." onChange={(event) => onChange("notes", event.target.value)} /></label>
      </div>
    </details>
  );
}

export function AuditDecisionSummary({
  brief,
  workflow,
  onSaveNotebook,
  onExportDossier,
  onExportMarkdown,
}: {
  brief: CoordinateTriageBrief;
  workflow: WorkflowCoverage;
  onSaveNotebook: () => void;
  onExportDossier: () => void;
  onExportMarkdown: () => void;
}) {
  const icon = brief.band === "retain-for-comparison" || brief.band === "coordinate-geometry-coherent"
    ? <ShieldCheck />
    : <AlertTriangle />;
  return (
    <section className={`panel decision-summary decision-${brief.band}`} id="handoff" aria-labelledby="decision-summary-title">
      <div className="decision-head">
        <div className="decision-icon">{icon}</div>
        <div>
          <p className="eyebrow">Coordinate review brief</p>
          <h2 id="decision-summary-title">{brief.title}</h2>
          <p>{brief.summary}</p>
        </div>
        <Badge variant="outline">No composite score</Badge>
      </div>

      <div className="workflow-coverage" aria-label="Workflow coverage">
        <article className={workflow.paeAttached ? "coverage-complete" : ""}><span>{workflow.paeAttached ? <Check /> : "1"}</span><div><strong>Directional PAE</strong><small>{workflow.paeAttached ? "attached + confirmed" : "not assessed"}</small></div></article>
        <article className={workflow.ensemblePoseCount > 1 ? "coverage-complete" : ""}><span>{workflow.ensemblePoseCount > 1 ? <Check /> : "2"}</span><div><strong>Pose recurrence</strong><small>{workflow.ensemblePoseCount > 1 ? `${workflow.ensemblePoseCount} poses` : "not assessed"}</small></div></article>
        <article className={workflow.pairedContextCompared ? "coverage-complete" : ""}><span>{workflow.pairedContextCompared ? <Check /> : "3"}</span><div><strong>Paired context</strong><small>{workflow.pairedContextCompared ? "compared" : "not assessed"}</small></div></article>
        <article><span>4</span><div><strong>Experiment</strong><small>required for biological claims</small></div></article>
      </div>

      <div className="decision-columns">
        <article>
          <h3>Items to review</h3>
          {brief.reviewItems.length ? <ul>{brief.reviewItems.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No limited/review coordinate findings were recorded.</p>}
        </article>
        <article>
          <h3>Evidence gaps</h3>
          <ul>{brief.evidenceGaps.map((item) => <li key={item}>{item}</li>)}</ul>
        </article>
        <article>
          <h3>Next checks</h3>
          <ol>{brief.nextActions.map((item) => <li key={item}>{item}</li>)}</ol>
        </article>
      </div>

      <Alert className="decision-boundary" role="note">
        <AlertTriangle />
        <AlertTitle>Interpretation boundary</AlertTitle>
        <AlertDescription>{brief.boundary}</AlertDescription>
      </Alert>

      <div className="handoff-actions">
        <Button onClick={onExportDossier}><FileArchive /> Workspace dossier JSON</Button>
        <Button variant="outline" onClick={onExportMarkdown}><FileDown /> Lab-note Markdown</Button>
        <Button variant="outline" onClick={onSaveNotebook}><Save /> Save summary locally</Button>
      </div>
      <p className="export-privacy-note">The workspace dossier contains complete selected receptor/VHH sequences, residue-level contacts, metrics, hashes, provenance, and user notes. It excludes raw coordinate text and complete PAE matrices. Review exports before sharing.</p>
    </section>
  );
}

export function NotebookPanel({
  entries,
  onRemove,
  onClear,
  onExport,
  onImportText,
}: {
  entries: readonly NotebookEntry[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onExport: () => void;
  onImportText: (text: string) => void;
}) {
  const [localError, setLocalError] = useState<string | null>(null);
  const readImport = async (file: File) => {
    if (file.size > MAX_NOTEBOOK_SERIALIZED_BYTES) {
      setLocalError("Notebook import is larger than the 1 MB derived-summary limit.");
      return;
    }
    try {
      const text = await file.text();
      onImportText(text);
      setLocalError(null);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "Notebook import failed.");
    }
  };
  return (
    <details className="panel notebook-panel">
      <summary>
        <span><BookOpen /> Local summary notebook</span>
        <Badge variant="secondary">{entries.length} saved</Badge>
      </summary>
      <div className="notebook-intro">
        <div>
          <strong>Opt-in, derived summaries on this device only</strong>
          <p>The notebook saves the study context and notes you enter plus derived summary metrics. It does not automatically copy loaded coordinates, parsed sequences, PAE matrices, or residue-contact tables.</p>
          <p>Imported notebook files are schema-checked summaries only: their metrics and non-cryptographic fingerprints are not recomputed or authenticated. Use a complete dossier plus the source coordinates for scientific review.</p>
        </div>
        <div className="notebook-actions">
          <Button variant="outline" size="sm" disabled={!entries.length} onClick={onExport}><Download /> Export notebook</Button>
          <label className="button-file-label"><FileUp /> Import notebook<Input type="file" accept=".json,application/json" aria-label="Import a ConfoVHH summary notebook" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readImport(file); event.currentTarget.value = ""; }} /></label>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="ghost" size="sm" disabled={!entries.length}><Trash2 /> Clear all</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear all saved notebook summaries?</AlertDialogTitle>
                <AlertDialogDescription>This removes the local derived summaries and saved user-entered context from this browser. Downloaded dossier and notebook files are unaffected.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep summaries</AlertDialogCancel>
                <AlertDialogAction onClick={onClear}>Clear saved summaries</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {localError && <Alert variant="destructive" role="alert"><AlertTriangle /><AlertTitle>Notebook import stopped</AlertTitle><AlertDescription>{localError}</AlertDescription></Alert>}
      {entries.length ? (
        <div className="notebook-list">
          {entries.map((entry) => (
            <article key={entry.id}>
              <div>
                <span className={`notebook-band notebook-${entry.triage.band}`} />
                <div>
                  <strong>{entry.context.candidateId || entry.context.studyName || entry.coordinate.filename}</strong>
                  <p>{entry.triage.title}</p>
                  <small>Summary only · source data not attached · {new Date(entry.savedAt).toLocaleString()} · model {entry.coordinate.selectedModelId} · {entry.coordinate.coordinateScope}{entry.coordinate.selectedAssemblyId ? ` ${entry.coordinate.selectedAssemblyId}` : ""} · {entry.metrics.contactPairCount} contacts · {entry.metrics.severeClashCount} clashes · SHA-256 {entry.coordinate.sha256.slice(0, 12)}…</small>
                </div>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove saved summary for ${entry.coordinate.filename}`} onClick={() => onRemove(entry.id)}><X /></Button>
            </article>
          ))}
        </div>
      ) : (
        <div className="notebook-empty"><BookOpen /><div><strong>No summaries saved</strong><p>Run an audit, then use “Save summary locally” in the coordinate review brief.</p></div></div>
      )}
    </details>
  );
}

export function ImportedDossier({ bundle, onClose }: { bundle: WorkspaceBundle; onClose: () => void }) {
  const audit = bundle.reports.singleAudit.audit;
  const evidenceLabel = {
    supported: "Coherent coordinate geometry",
    mixed: "Mixed coordinate evidence",
    limited: "Weak coordinate evidence",
    "not-assessable": "Not assessable",
  }[audit.evidenceLevel];
  return (
    <section className="panel imported-dossier" aria-labelledby="imported-dossier-title">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">Read-only handoff</p>
          <h2 id="imported-dossier-title">{bundle.context.studyName || bundle.context.candidateId || bundle.coordinate.filename}</h2>
          <p>Imported dossier generated {new Date(bundle.generatedAt).toLocaleString()}; values are displayed from the exported report and have not been recomputed in this browser.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}><X /> Close</Button>
      </div>
      <div className="imported-dossier-grid">
        <article><span>Decision brief</span><strong>{bundle.decisionBrief.title}</strong><p>{bundle.decisionBrief.summary}</p></article>
        <article><span>Coordinate source</span><strong>{bundle.coordinate.filename}</strong><p>Model {bundle.coordinate.selectedModelId} · {bundle.coordinate.coordinateScope}{bundle.coordinate.selectedAssemblyId ? ` ${bundle.coordinate.selectedAssemblyId}` : ""} · chains {bundle.coordinate.receptorChain} ↔ {bundle.coordinate.vhhChain} · SHA-256 {bundle.coordinate.sha256.slice(0, 16)}…</p></article>
        <article><span>Audit snapshot</span><strong>{evidenceLabel}</strong><p>{audit.contactPairCount} contacts · {audit.severeClashCount} severe clashes · ΔSASA {audit.deltaSasaAngstrom2.toFixed(0)} Å²</p></article>
        <article><span>Workflow coverage</span><strong>{bundle.workflow.ensemblePoseCount} ensemble pose{bundle.workflow.ensemblePoseCount === 1 ? "" : "s"}</strong><p>PAE {bundle.workflow.paeAttached ? "attached" : "not attached"} · context pair {bundle.workflow.pairedContextCompared ? "included" : "not included"}</p></article>
        {bundle.userDefinedFootprint && <article><span>User-defined footprint</span><strong>{bundle.userDefinedFootprint.contactedCount} / {bundle.userDefinedFootprint.mappedCount} mapped residues contacted</strong><p>{bundle.userDefinedFootprint.unmapped.length} identifiers unmapped · overlap only, not specificity</p></article>}
      </div>
      <Alert role="note"><AlertTriangle /><AlertTitle>Validated report structure—not a coordinate replay</AlertTitle><AlertDescription>The dossier format, internal relationships, internal result checksum, and cross-report provenance were checked, but coordinate geometry and PAE values were not recomputed and the screening fingerprints are not cryptographic authentication. {bundle.claimBoundary} Re-upload coordinates to recompute or extend the analysis.</AlertDescription></Alert>
    </section>
  );
}

export function EnsembleConsensusMatrix({
  ensemble,
  rejected,
}: {
  ensemble: PoseEnsembleSummary;
  rejected: readonly RejectedEnsemblePose[];
}) {
  const poseById = new Map(ensemble.poses.map((pose) => [pose.id, pose]));
  return (
    <details className="ensemble-inspector" open>
      <summary><Layers3 /> Inspect recurrence evidence</summary>
      <div className="ensemble-component-grid">
        {ensemble.poses.map((pose) => (
          <article key={pose.id}>
            <div><strong>#{pose.rank} {pose.filename}</strong><Badge variant="outline">{
              pose.triageGroup === "coherent"
                ? "Coherent coordinate geometry"
                : pose.triageGroup === "review"
                  ? "Coordinate geometry to review"
                  : "Weak coordinate geometry"
            }</Badge></div>
            <dl>
              <div><dt>Contact-pair consensus</dt><dd>{pose.contactPairConsensus == null ? "—" : pose.contactPairConsensus.toFixed(3)}</dd></div>
              <div><dt>Receptor footprint</dt><dd>{pose.receptorEpitopeConsensus == null ? "—" : pose.receptorEpitopeConsensus.toFixed(3)}</dd></div>
              <div><dt>VHH footprint</dt><dd>{pose.vhhParatopeConsensus == null ? "—" : pose.vhhParatopeConsensus.toFixed(3)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      <div className="ensemble-matrix-wrap">
        <h3>Pairwise ensemble consensus</h3>
        <Table containerLabel="Scrollable pairwise pose-consensus matrix">
          <TableHeader><TableRow><TableHead>Pose</TableHead>{ensemble.pairwisePoseIds.map((id) => <TableHead key={id} title={poseById.get(id)?.filename}>{id}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {ensemble.pairwisePoseIds.map((rowId, rowIndex) => (
              <TableRow key={rowId}>
                <TableCell title={poseById.get(rowId)?.filename}><strong>{rowId}</strong></TableCell>
                {ensemble.pairwisePoseIds.map((columnId, columnIndex) => {
                  const value = ensemble.pairwiseConsensus[rowIndex]?.[columnIndex] ?? null;
                  return <TableCell key={columnId} className="mono-cell ensemble-matrix-cell" style={value == null ? undefined : { backgroundColor: `rgb(114 214 196 / ${0.06 + value * 0.3})` }}>{value == null ? "—" : value.toFixed(2)}</TableCell>;
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rejected.length > 0 && (
        <div className="rejection-ledger">
          <h3>Excluded-pose ledger</h3>
          {rejected.map((pose) => <article key={`${pose.filename}:${pose.sha256}`}><AlertTriangle /><div><strong>{pose.filename}</strong><p>{pose.reason}</p><small>Correct the reported compatibility or parsing issue, then upload the pose again.</small></div></article>)}
        </div>
      )}
      <p className="ensemble-boundary"><AlertTriangle /> Highest recurrence means most recurrent within this uploaded set—not best binder, seed independence, near-native probability, or experimental priority.</p>
    </details>
  );
}

export function DossierImportControl({ onImportText }: { onImportText: (text: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const read = async (file: File) => {
    try {
      if (file.size > MAX_WORKSPACE_BUNDLE_SERIALIZED_BYTES) {
        throw new Error("Workspace dossier exceeds the 32 MiB report limit.");
      }
      onImportText(await file.text());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workspace dossier import failed.");
    }
  };
  return (
    <div className="dossier-import">
      <label className="button-file-label"><FileUp /> Review a dossier<Input type="file" accept=".json,application/json" aria-label="Review a ConfoVHH workspace dossier" onChange={(event) => { const file = event.target.files?.[0]; if (file) void read(file); event.currentTarget.value = ""; }} /></label>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

export function EntryWorkflowCards({ onDemo }: { onDemo: () => void }) {
  return (
    <section className="entry-workflows" aria-labelledby="entry-workflows-title">
      <div><p className="eyebrow">Start here</p><h2 id="entry-workflows-title">Start with one pose, a prediction folder, or the worked example</h2></div>
      <div className="entry-workflow-grid">
        <article><ShieldCheck /><span>Single-pose path</span><h3>Audit one coordinate pose</h3><p>Confirm the receptor and VHH chains, then inspect contacts, clashes, buried interface area, IMGT CDR involvement, optional pLDDT, and directional PAE.</p><a href="#coordinate-setup">Import coordinates <ArrowRight /></a></article>
        <article><Layers3 /><span>Batch path · desktop recommended</span><h3>Audit a prediction output run</h3><p>Check the proposed file associations, audit one reference pose, and compare up to 12 compatible AlphaFold, ColabFold, or Boltz models.</p><a href="#prediction-run-intake">Choose a prediction folder <ArrowRight /></a></article>
        <article><FlaskConical /><span>Experimental worked example</span><h3>Explore β₂AR–Nb80</h3><p>Open experimental structure PDB 3P0G to see the full workflow. It demonstrates interface review, not prediction accuracy or prospective ranking.</p><button type="button" onClick={onDemo}>Open worked example <ArrowRight /></button></article>
      </div>
      <p className="product-release-note">ConfoVHH product {CONFOVHH_PRODUCT_RELEASE} · scientific engine v0.5.0 · frozen validation digests preserved</p>
    </section>
  );
}
