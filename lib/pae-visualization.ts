import type { ParsedPae, ParsedStructure } from "./confovhh.ts";

export const MAX_PAE_HEATMAP_COLUMNS = 180;
export const MAX_PAE_HEATMAP_ROWS = 180;
export const MAX_PAE_CONTACT_MARKERS = 240;

export interface PaeCrossBlockSample {
  width: number;
  height: number;
  receptorResidueCount: number;
  vhhResidueCount: number;
  receptorOffset: number;
  vhhOffset: number;
  receptorFrameToVhh: Float32Array;
  vhhFrameToReceptor: Float32Array;
  maximumPaeAngstrom: number;
}

function requirePositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function meanPaeBin(
  pae: ParsedPae,
  receptorOffset: number,
  vhhOffset: number,
  receptorStart: number,
  receptorEnd: number,
  vhhStart: number,
  vhhEnd: number,
  reverse: boolean,
): number {
  let sum = 0;
  let count = 0;
  for (let receptorIndex = receptorStart; receptorIndex < receptorEnd; receptorIndex += 1) {
    for (let vhhIndex = vhhStart; vhhIndex < vhhEnd; vhhIndex += 1) {
      const row = reverse ? vhhOffset + vhhIndex : receptorOffset + receptorIndex;
      const column = reverse ? receptorOffset + receptorIndex : vhhOffset + vhhIndex;
      const value = pae.matrix[row * pae.residueCount + column];
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("The PAE heatmap source contains an invalid value.");
      }
      sum += value;
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

export function createPaeCrossBlockSample(
  pae: ParsedPae,
  structure: ParsedStructure,
  receptorChainId: string,
  vhhChainId: string,
  maximumColumns = MAX_PAE_HEATMAP_COLUMNS,
  maximumRows = MAX_PAE_HEATMAP_ROWS,
): PaeCrossBlockSample {
  requirePositiveSafeInteger(maximumColumns, "Maximum PAE heatmap columns");
  requirePositiveSafeInteger(maximumRows, "Maximum PAE heatmap rows");
  if (!(pae.matrix instanceof Float32Array) || pae.matrix.length !== pae.residueCount ** 2) {
    throw new Error("The PAE heatmap requires a square Float32 matrix.");
  }
  if (!Number.isFinite(pae.maxPaeAngstrom) || pae.maxPaeAngstrom < 0) {
    throw new Error("The PAE heatmap maximum must be finite and non-negative.");
  }
  const totalResidues = structure.chains.reduce((sum, chain) => sum + chain.residueCount, 0);
  if (totalResidues !== pae.residueCount) {
    throw new Error("The PAE heatmap matrix no longer matches the parsed chain residue inventory.");
  }
  const receptorIndex = structure.chains.findIndex((chain) => chain.id === receptorChainId);
  const vhhIndex = structure.chains.findIndex((chain) => chain.id === vhhChainId);
  if (receptorIndex < 0 || vhhIndex < 0 || receptorIndex === vhhIndex) {
    throw new Error("The PAE heatmap requires two distinct selected coordinate chains.");
  }
  const receptor = structure.chains[receptorIndex];
  const vhh = structure.chains[vhhIndex];
  const receptorOffset = structure.chains
    .slice(0, receptorIndex)
    .reduce((sum, chain) => sum + chain.residueCount, 0);
  const vhhOffset = structure.chains
    .slice(0, vhhIndex)
    .reduce((sum, chain) => sum + chain.residueCount, 0);
  const width = Math.min(vhh.residueCount, maximumColumns);
  const height = Math.min(receptor.residueCount, maximumRows);
  const receptorFrameToVhh = new Float32Array(width * height);
  const vhhFrameToReceptor = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const receptorStart = Math.floor(y * receptor.residueCount / height);
    const receptorEnd = Math.max(
      receptorStart + 1,
      Math.floor((y + 1) * receptor.residueCount / height),
    );
    for (let x = 0; x < width; x += 1) {
      const vhhStart = Math.floor(x * vhh.residueCount / width);
      const vhhEnd = Math.max(vhhStart + 1, Math.floor((x + 1) * vhh.residueCount / width));
      const outputIndex = y * width + x;
      receptorFrameToVhh[outputIndex] = meanPaeBin(
        pae,
        receptorOffset,
        vhhOffset,
        receptorStart,
        receptorEnd,
        vhhStart,
        vhhEnd,
        false,
      );
      vhhFrameToReceptor[outputIndex] = meanPaeBin(
        pae,
        receptorOffset,
        vhhOffset,
        receptorStart,
        receptorEnd,
        vhhStart,
        vhhEnd,
        true,
      );
    }
  }

  return {
    width,
    height,
    receptorResidueCount: receptor.residueCount,
    vhhResidueCount: vhh.residueCount,
    receptorOffset,
    vhhOffset,
    receptorFrameToVhh,
    vhhFrameToReceptor,
    maximumPaeAngstrom: pae.maxPaeAngstrom,
  };
}

export function deterministicPaeMarkerSample<T>(
  values: readonly T[],
  maximumCount = MAX_PAE_CONTACT_MARKERS,
): T[] {
  if (!Number.isSafeInteger(maximumCount) || maximumCount < 0) {
    throw new Error("Maximum PAE marker count must be a non-negative safe integer.");
  }
  if (values.length <= maximumCount) return [...values];
  if (maximumCount === 0) return [];
  if (maximumCount === 1) return [values[0]];
  return Array.from({ length: maximumCount }, (_, index) => (
    values[Math.floor(index * (values.length - 1) / (maximumCount - 1))]
  ));
}
