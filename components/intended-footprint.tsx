"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clipboard, MapPinned, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InterfaceAudit, ParsedStructure } from "@/lib/confovhh";
import {
  analyzeIntendedFootprint,
  observedFootprintIdentifiers,
  type IntendedFootprintSummary,
} from "@/lib/user-footprint";

export function IntendedFootprintPanel({
  structure,
  receptorChain,
  audit,
  input,
  onSummaryChange,
}: {
  structure: ParsedStructure;
  receptorChain: string;
  audit: InterfaceAudit;
  input: string;
  onSummaryChange?: (summary: IntendedFootprintSummary | null) => void;
}) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const result = useMemo(() => {
    try {
      const summary = analyzeIntendedFootprint(structure, receptorChain, audit, input);
      return { summary, error: null };
    } catch (caught) {
      return {
        summary: null,
        error: caught instanceof Error ? caught.message : "The intended footprint could not be mapped.",
      };
    }
  }, [audit, input, receptorChain, structure]);

  const summary = result.summary;
  useEffect(() => {
    onSummaryChange?.(summary);
  }, [onSummaryChange, summary]);
  const copyObserved = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(observedFootprintIdentifiers(summary));
      setCopyStatus("Observed receptor footprint copied.");
    } catch {
      setCopyStatus("Clipboard access was unavailable; the identifiers remain visible below.");
    }
  };

  return (
    <section className="panel intended-footprint" aria-labelledby="intended-footprint-title">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">User-defined question</p>
          <h2 id="intended-footprint-title">Intended receptor-footprint overlap</h2>
          <p>Enter exact residue identifiers in Study context, then verify how they map to the selected receptor chain and observed coordinate contacts.</p>
        </div>
        <Badge variant="secondary"><MapPinned /> Chain {receptorChain}</Badge>
      </div>

      {result.error ? (
        <Alert variant="destructive" role="alert"><TriangleAlert /><AlertTitle>Footprint mapping stopped</AlertTitle><AlertDescription>{result.error}</AlertDescription></Alert>
      ) : summary && (
        <>
          <div className="footprint-summary-grid">
            <article><span>Requested</span><strong>{summary.requestedCount}</strong><small>unique user identifiers</small></article>
            <article><span>Mapped to receptor</span><strong>{summary.mappedCount}</strong><small>unique receptor residues · {summary.unmapped.length} unmapped · {summary.duplicateAliases.length} aliases</small></article>
            <article><span>Observed as contacts</span><strong>{summary.contactedCount}</strong><small>{summary.mappedContactShare == null ? "No mapped denominator" : `${Math.round(summary.mappedContactShare * 100)}% of mapped residues`}</small></article>
            <article><span>Observed receptor footprint</span><strong>{summary.observedReceptorFootprint.length}</strong><small>contacting receptor residues</small></article>
          </div>

          {summary.requestedCount === 0 ? (
            <div className="footprint-empty"><MapPinned /><div><strong>No intended residues supplied</strong><p>Add comma-, space-, or newline-separated identifiers such as {receptorChain}:131 in Study context. Number-only identifiers are accepted for the selected receptor chain.</p></div></div>
          ) : (
            <Table containerLabel="Scrollable user-defined receptor-footprint mapping table">
              <TableHeader><TableRow><TableHead>Requested</TableHead><TableHead>Coordinate residue</TableHead><TableHead>Sequence order</TableHead><TableHead>Observed contact</TableHead></TableRow></TableHeader>
              <TableBody>
                {summary.mapped.map((entry) => <TableRow key={entry.requestedIdentifier}><TableCell className="mono-cell">{entry.requestedIdentifier}</TableCell><TableCell className="mono-cell">{entry.coordinateLabel}</TableCell><TableCell className="mono-cell">{entry.sequenceOrder}</TableCell><TableCell>{entry.contacted ? <span className="footprint-contacted"><Check /> contacted</span> : "not in observed footprint"}</TableCell></TableRow>)}
                {summary.duplicateAliases.map((alias) => <TableRow key={alias.requestedIdentifier}><TableCell className="mono-cell">{alias.requestedIdentifier}</TableCell><TableCell className="mono-cell">Alias of {alias.residueKey}</TableCell><TableCell>—</TableCell><TableCell>Counted once as a mapped residue</TableCell></TableRow>)}
                {summary.unmapped.map((identifier) => <TableRow key={identifier}><TableCell className="mono-cell">{identifier}</TableCell><TableCell>Unmapped or ambiguous</TableCell><TableCell>—</TableCell><TableCell>Not assessable</TableCell></TableRow>)}
              </TableBody>
            </Table>
          )}

          <div className="observed-footprint-copy">
            <div><strong>Observed receptor footprint identifiers</strong><code>{observedFootprintIdentifiers(summary) || "No contacting receptor residues"}</code></div>
            <Button variant="outline" size="sm" onClick={() => void copyObserved()} disabled={!summary.observedReceptorFootprint.length}><Clipboard /> Copy</Button>
          </div>
          {copyStatus && <p className="copy-status" role="status">{copyStatus}</p>}
          <Alert className="footprint-boundary" role="note"><TriangleAlert /><AlertTitle>Overlap—not specificity</AlertTitle><AlertDescription>{summary.interpretation}</AlertDescription></Alert>
        </>
      )}
    </section>
  );
}
