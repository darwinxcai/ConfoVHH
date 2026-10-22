"use client";

import { AlertTriangle, MapPinned } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { InterfaceAudit, ParsedStructure } from "@/lib/confovhh";
import {
  analyzeAnnotatedFootprint,
  TOPOLOGY_ANNOTATION_CLAIM_BOUNDARY,
  type AnnotatedFootprintResult,
  type NormalizedTopologyAnnotation,
  type UserTopologyAnnotationInput,
} from "@/lib/topology-annotation";

export const EMPTY_TOPOLOGY_ANNOTATION: UserTopologyAnnotationInput = {
  intendedSide: "unspecified",
  extracellularResidues: "",
  intracellularResidues: "",
  transmembraneResidues: "",
  annotationSource: "",
};

export function computeTopologyAnnotation(
  structure: ParsedStructure | null,
  receptorChain: string,
  audit: InterfaceAudit | null,
  input: UserTopologyAnnotationInput,
): { annotation: NormalizedTopologyAnnotation; result: AnnotatedFootprintResult } | null {
  if (!structure || !audit) return null;
  if (!input.extracellularResidues.trim() && !input.intracellularResidues.trim() && !input.transmembraneResidues.trim()) {
    return null;
  }
  return analyzeAnnotatedFootprint(structure, receptorChain, audit, input);
}

function metric(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export function TopologyAnnotationPanel({
  structure,
  receptorChain,
  audit,
  value,
  onChange,
}: {
  structure: ParsedStructure;
  receptorChain: string;
  audit: InterfaceAudit;
  value: UserTopologyAnnotationInput;
  onChange: (value: UserTopologyAnnotationInput) => void;
}) {
  let analysis: ReturnType<typeof computeTopologyAnnotation> = null;
  let error: string | null = null;
  try {
    analysis = computeTopologyAnnotation(structure, receptorChain, audit, value);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "The supplied receptor labels could not be mapped.";
  }
  const unmapped = analysis == null ? [] : [
    ...analysis.annotation.extracellular.unmapped.map((identifier) => `extracellular: ${identifier}`),
    ...analysis.annotation.intracellular.unmapped.map((identifier) => `intracellular: ${identifier}`),
    ...analysis.annotation.transmembrane.unmapped.map((identifier) => `transmembrane: ${identifier}`),
  ];
  const hasAnnotationMetadataWithoutResidues = analysis == null && error == null && Boolean(
    value.annotationSource.trim() || value.intendedSide !== "unspecified",
  );
  const update = <K extends keyof UserTopologyAnnotationInput>(
    field: K,
    next: UserTopologyAnnotationInput[K],
  ) => onChange({ ...value, [field]: next });
  return (
    <details className="panel topology-panel" id="annotated-topology">
      <summary>
        <span><MapPinned /> Annotated receptor-footprint consistency</span>
        <small>Optional · researcher-supplied residue classes only</small>
      </summary>
      <fieldset className="topology-fieldset">
        <legend>User-annotated GPCR topology</legend>
        <div className="topology-grid">
          <label>
            <span>Intended contact side</span>
            <Select value={value.intendedSide} onValueChange={(next) => update("intendedSide", next as UserTopologyAnnotationInput["intendedSide"])}>
              <SelectTrigger aria-label="Intended receptor contact side"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unspecified">Unspecified · describe overlap only</SelectItem>
                <SelectItem value="extracellular">Extracellular</SelectItem>
                <SelectItem value="intracellular">Intracellular</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label>
            <span>Annotation source / version</span>
            <Input
              value={value.annotationSource}
              maxLength={500}
              placeholder="e.g. GPCRdb mapping exported 2026-08-28"
              onChange={(event) => update("annotationSource", event.target.value)}
            />
          </label>
          <label>
            <span>Extracellular residues</span>
            <Textarea
              value={value.extracellularResidues}
              maxLength={1_000}
              placeholder="Exact identifiers; e.g. A:1, A:96, order:131"
              onChange={(event) => update("extracellularResidues", event.target.value)}
            />
          </label>
          <label>
            <span>Intracellular residues</span>
            <Textarea
              value={value.intracellularResidues}
              maxLength={1_000}
              placeholder="Exact identifiers; one mutually exclusive class per residue"
              onChange={(event) => update("intracellularResidues", event.target.value)}
            />
          </label>
          <label>
            <span>Transmembrane residues</span>
            <Textarea
              value={value.transmembraneResidues}
              maxLength={1_000}
              placeholder="Optional TM residue identifiers; excluded from intended-side share"
              onChange={(event) => update("transmembraneResidues", event.target.value)}
            />
          </label>
        </div>
      </fieldset>

      {error && (
        <Alert variant="destructive" role="note">
          <AlertTriangle />
          <AlertTitle>Annotation needs review</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {hasAnnotationMetadataWithoutResidues && (
        <Alert className="topology-unmapped" role="note">
          <AlertTriangle />
          <AlertTitle>Topology check not assessed</AlertTitle>
          <AlertDescription>
            An intended side or annotation source is present, but no receptor residue classes were supplied. Add exact extracellular, intracellular, or transmembrane identifiers to evaluate contact overlap.
          </AlertDescription>
        </Alert>
      )}
      {unmapped.length > 0 && (
        <Alert className="topology-unmapped" role="note">
          <AlertTriangle />
          <AlertTitle>{unmapped.length} supplied identifier{unmapped.length === 1 ? " did" : "s did"} not map</AlertTitle>
          <AlertDescription>
            Correct or intentionally remove these identifiers before interpreting coverage: {unmapped.join(" · ")}.
          </AlertDescription>
        </Alert>
      )}
      {analysis && (
        <div className="topology-result" role="group" aria-label="Annotated footprint overlap result">
          <div className="topology-result-head">
            <div>
              {analysis.result.status === "no-intended-side-overlap" || analysis.result.status === "insufficient-annotation"
                ? <AlertTriangle />
                : <MapPinned />}
              <strong>Observed contact overlap with supplied annotation</strong>
            </div>
            <Badge variant="outline">{analysis.result.status.replaceAll("-", " ")}</Badge>
          </div>
          <dl>
            <div><dt>Interface receptor residues</dt><dd>{analysis.result.interfaceResidueCount}</dd></div>
            <div><dt>Extracellular labeled</dt><dd>{analysis.result.extracellularContactResidueCount}</dd></div>
            <div><dt>Intracellular labeled</dt><dd>{analysis.result.intracellularContactResidueCount}</dd></div>
            <div><dt>Transmembrane labeled</dt><dd>{analysis.result.transmembraneContactResidueCount}</dd></div>
            <div><dt>Other / unannotated</dt><dd>{analysis.result.otherOrUnannotatedContactResidueCount}</dd></div>
            <div><dt>Annotation coverage</dt><dd>{metric(analysis.result.annotationCoverage)}</dd></div>
            <div><dt>Side-evaluable coverage</dt><dd>{metric(analysis.result.sideEvaluableCoverage)}</dd></div>
            <div><dt>Intended-side share</dt><dd>{metric(analysis.result.intendedSideShare)}</dd></div>
          </dl>
        </div>
      )}
      <Alert className="topology-boundary" role="note">
        <AlertTriangle />
        <AlertTitle>No membrane or state inference</AlertTitle>
        <AlertDescription>{TOPOLOGY_ANNOTATION_CLAIM_BOUNDARY}</AlertDescription>
      </Alert>
    </details>
  );
}
