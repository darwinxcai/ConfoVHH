import { parsePdb, type ParsedStructure } from "./confovhh.ts";
import { parseMmcif } from "./mmcif.ts";

export type CoordinateFormat = "pdb" | "mmcif";

export interface CoordinateParseOptions {
  assemblyId?: string | null;
  modelId?: string | null;
}

export function detectCoordinateFormat(text: string, filename = ""): CoordinateFormat {
  const normalizedName = filename.toLowerCase();
  if (normalizedName.endsWith(".cif") || normalizedName.endsWith(".mmcif")) return "mmcif";
  if (normalizedName.endsWith(".pdb") || normalizedName.endsWith(".ent")) return "pdb";
  const prefix = text.slice(0, 16_384);
  if (/^\s*data_[^\s]+/im.test(prefix) && /_atom_site\./i.test(text)) return "mmcif";
  if (/^(?:ATOM  |HETATM|HEADER|TITLE |MODEL )/m.test(prefix)) return "pdb";
  throw new Error("The coordinate format could not be identified. Use text PDB, .cif, or .mmcif input.");
}

export function parseCoordinateText(
  text: string,
  filename = "",
  options: CoordinateParseOptions = {},
): ParsedStructure {
  const format = detectCoordinateFormat(text, filename);
  if (format === "pdb") {
    if (options.assemblyId != null) {
      throw new Error("Deposited-assembly reconstruction is available only for PDBx/mmCIF input.");
    }
    return parsePdb(text, options.modelId ?? null);
  }
  return parseMmcif(text, { assemblyId: options.assemblyId, modelId: options.modelId });
}
