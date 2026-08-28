"use client";

import { useEffect, useMemo, useRef } from "react";
import { Grid3X3, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { InterfaceAudit, ParsedPae, ParsedStructure } from "@/lib/confovhh";
import {
  MAX_PAE_CONTACT_MARKERS,
  createPaeCrossBlockSample,
  deterministicPaeMarkerSample,
} from "@/lib/pae-visualization";

const CANVAS_WIDTH = 520;
const CANVAS_HEIGHT = 280;

function paeColor(value: number, maximum: number): string {
  const denominator = Math.max(1, Math.min(35, maximum));
  const ratio = Math.max(0, Math.min(1, value / denominator));
  if (ratio < 0.5) {
    const local = ratio / 0.5;
    return `rgb(${Math.round(49 + 178 * local)} ${Math.round(166 + 31 * local)} ${Math.round(151 - 51 * local)})`;
  }
  const local = (ratio - 0.5) / 0.5;
  return `rgb(${Math.round(227 - 151 * local)} ${Math.round(197 - 112 * local)} ${Math.round(100 - 6 * local)})`;
}

function DirectionalPaeCanvas({
  values,
  width,
  height,
  maximum,
  receptorResidueCount,
  vhhResidueCount,
  contacts,
  label,
}: {
  values: Float32Array;
  width: number;
  height: number;
  maximum: number;
  receptorResidueCount: number;
  vhhResidueCount: number;
  contacts: InterfaceAudit["contacts"];
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const cellWidth = CANVAS_WIDTH / width;
    const cellHeight = CANVAS_HEIGHT / height;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        context.fillStyle = paeColor(values[y * width + x], maximum);
        context.fillRect(x * cellWidth, y * cellHeight, Math.ceil(cellWidth), Math.ceil(cellHeight));
      }
    }
    context.lineWidth = 1.5;
    context.strokeStyle = "rgba(255, 255, 255, 0.9)";
    context.fillStyle = "rgba(8, 13, 12, 0.45)";
    for (const contact of deterministicPaeMarkerSample(contacts)) {
      const x = ((contact.vhhResidueOrder - 0.5) / vhhResidueCount) * CANVAS_WIDTH;
      const y = ((contact.receptorResidueOrder - 0.5) / receptorResidueCount) * CANVAS_HEIGHT;
      context.beginPath();
      context.arc(x, y, 2.2, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }, [contacts, height, maximum, receptorResidueCount, values, vhhResidueCount, width]);

  return (
    <figure className="pae-figure">
      <div className="pae-canvas-frame">
        <span className="pae-axis pae-axis-y">Receptor residue order →</span>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          role="img"
          aria-label={`${label}. Receptor residue order on the vertical axis and VHH residue order on the horizontal axis. White points mark audited residue contacts.`}
        />
        <span className="pae-axis pae-axis-x">VHH residue order →</span>
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function PaeExplorer({
  pae,
  structure,
  receptorChain,
  vhhChain,
  audit,
}: {
  pae: ParsedPae;
  structure: ParsedStructure;
  receptorChain: string;
  vhhChain: string;
  audit: InterfaceAudit;
}) {
  const sample = useMemo(() => createPaeCrossBlockSample(
    pae,
    structure,
    receptorChain,
    vhhChain,
  ), [pae, receptorChain, structure, vhhChain]);
  const formatted = (value: number | null) => value == null ? "Unavailable" : `${value.toFixed(1)} Å`;

  return (
    <section className="panel pae-explorer" id="pae-explorer" aria-labelledby="pae-explorer-title">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">Directional uncertainty</p>
          <h2 id="pae-explorer-title">Cross-chain PAE explorer</h2>
          <p>
            The panels preserve the two directional values. The reverse block is transposed only for an aligned display, so both plots use receptor order vertically and VHH order horizontally.
          </p>
        </div>
        <Badge variant="secondary"><Grid3X3 /> {pae.residueCount} × {pae.residueCount}</Badge>
      </div>

      <div className="pae-summary-grid" aria-label="Directional interface PAE summary">
        <article><span>Receptor frame → VHH</span><strong>{formatted(audit.receptorFrameToVhhPaeMedianAngstrom)}</strong><small>contact median · p90 {formatted(audit.receptorFrameToVhhPaeP90Angstrom)}</small></article>
        <article><span>VHH frame → receptor</span><strong>{formatted(audit.vhhFrameToReceptorPaeMedianAngstrom)}</strong><small>contact median · p90 {formatted(audit.vhhFrameToReceptorPaeP90Angstrom)}</small></article>
        <article><span>Conservative interface median</span><strong>{formatted(audit.interfacePaeMedianAngstrom)}</strong><small>larger directional value per contact pair</small></article>
        <article><span>Contacts ≤10 Å conservative PAE</span><strong>{audit.lowPaeContactShare == null ? "Unavailable" : `${Math.round(audit.lowPaeContactShare * 100)}%`}</strong><small>{audit.contactPairCount} contact pairs · descriptive rule, not a calibrated cutoff</small></article>
      </div>

      <div className="pae-heatmap-grid">
        <DirectionalPaeCanvas
          values={sample.receptorFrameToVhh}
          width={sample.width}
          height={sample.height}
          maximum={sample.maximumPaeAngstrom}
          receptorResidueCount={sample.receptorResidueCount}
          vhhResidueCount={sample.vhhResidueCount}
          contacts={audit.contacts}
          label="Receptor-frame → VHH values (source matrix row: receptor; column: VHH)"
        />
        <DirectionalPaeCanvas
          values={sample.vhhFrameToReceptor}
          width={sample.width}
          height={sample.height}
          maximum={sample.maximumPaeAngstrom}
          receptorResidueCount={sample.receptorResidueCount}
          vhhResidueCount={sample.vhhResidueCount}
          contacts={audit.contacts}
          label="VHH-frame → receptor values (source matrix row: VHH; column: receptor; transposed to the shared display axes)"
        />
      </div>
      <div className="pae-legend" aria-hidden="true">
        <span>0 Å</span><i /><span>{Math.min(35, pae.maxPaeAngstrom).toFixed(0)}+ Å</span>
      </div>
      <Alert className="pae-boundary" role="note">
        <Info />
        <AlertTitle>Confidence context—not a binding score</AlertTitle>
        <AlertDescription>
          Each heatmap is deterministically averaged to at most 180 × 180 display bins, and at most {MAX_PAE_CONTACT_MARKERS} evenly sampled contact markers are drawn; the audit summaries use every confirmed matrix value at every contacting residue pair. PAE does not establish binding, affinity, or state selectivity.
        </AlertDescription>
      </Alert>
    </section>
  );
}
