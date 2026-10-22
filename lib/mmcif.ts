import {
  MAX_ABSOLUTE_COORDINATE_ANGSTROM,
  type AssemblyDescriptor,
  type AtomRecord,
  type ChainSummary,
  type ParsedStructure,
  type ResidueRecord,
  type SelectedAssembly,
} from "./confovhh.ts";

const AMINO_ACIDS: Record<string, string> = {
  ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C", GLN: "Q", GLU: "E",
  GLY: "G", HIS: "H", ILE: "I", LEU: "L", LYS: "K", MET: "M", PHE: "F",
  PRO: "P", SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V", MSE: "M",
  SEC: "U", PYL: "O",
};

const MAX_PARSED_ATOMS = 60_000;
const MAX_CANDIDATE_ATOMS = MAX_PARSED_ATOMS * 8;
const MAX_ASSEMBLY_CHAIN_COPIES = 256;
const MAX_AVAILABLE_ASSEMBLIES = 256;
const MAX_PARSED_PROTEIN_CHAINS = 256;
const MAX_OPERATION_COMBINATIONS = 512;
const MAX_CIF_TEXT_CHARACTERS = 16 * 1024 * 1024;
const MAX_LOOP_COLUMNS = 256;
const MAX_GENERATOR_ROWS = 1_000;
const MAX_ASYM_IDS_PER_GENERATOR = 512;
const MAX_ASYM_ID_LIST_CHARACTERS = 32_768;
const MAX_RETAINED_METADATA_ROWS = 20_000;
const MAX_SCALAR_ITEMS = 20_000;
const MAX_DATA_NAMES = 20_000;
const MAX_SOURCE_ASYM_IDS = 20_000;
const MAX_MODELS = 100;
const MAX_OPERATION_EXPRESSION_LENGTH = 4_096;
const MAX_OPERATION_FACTORS = 8;
const MAX_SELECTED_ASSEMBLY_OPERATION_TUPLES = 2_048;
const MAX_SELECTED_ASSEMBLY_CHAIN_APPLICATIONS = 4_096;
const MAX_CIF_DATA_NAME_CHARACTERS = 512;
const MAX_CIF_BLOCK_NAME_CHARACTERS = 512;
const MAX_CIF_IDENTIFIER_CHARACTERS = 256;
const MAX_CIF_ATOM_NAME_CHARACTERS = 64;

interface CifToken {
  value: string;
  quoted: boolean;
  line: number;
}

interface AtomCandidate {
  serial: number;
  name: string;
  residueName: string;
  labelAsymId: string;
  authAsymId: string;
  residueNumber: number;
  insertionCode: string;
  x: number;
  y: number;
  z: number;
  element: string;
  bFactor: number | null;
  occupancy: number;
  alternateLocation: string;
}

interface SourceResidue {
  sourceKey: string;
  labelAsymId: string;
  authAsymId: string;
  name: string;
  number: number;
  insertionCode: string;
  order: number;
  oneLetter: string;
  labelSequenceId: number | null;
  candidatesByAtom: Map<string, AtomCandidate[]>;
}

interface SelectedSourceResidue extends Omit<SourceResidue, "candidatesByAtom"> {
  atoms: AtomCandidate[];
}

interface AffineOperation {
  rotation: [[number, number, number], [number, number, number], [number, number, number]];
  translation: [number, number, number];
}

interface AssemblyGenerator {
  sourceRowIndex: number;
  assemblyId: string;
  operationExpression: string;
  labelAsymIds: string[];
}

interface ChainInstance {
  labelAsymId: string;
  authAsymId: string;
  operationIds: string[];
  operation: AffineOperation;
  copyIndex: number | undefined;
  generatorRowIndex: number | undefined;
  chainId: string;
}

const QUOTED_MISSING_SENTINEL = "\u0000confovhh-quoted-missing:";

export interface ParseMmcifOptions {
  assemblyId?: string | null;
  modelId?: string | null;
}

class TokenStream {
  private readonly iterator: Generator<CifToken>;
  private buffered: CifToken | null = null;

  constructor(text: string) {
    this.iterator = tokenizeCif(text);
  }

  next(): CifToken | null {
    if (this.buffered) {
      const token = this.buffered;
      this.buffered = null;
      return token;
    }
    return this.iterator.next().value ?? null;
  }

  push(token: CifToken): void {
    if (this.buffered) throw new Error("Internal mmCIF parser error: multiple buffered tokens.");
    this.buffered = token;
  }
}

function* tokenizeCif(text: string): Generator<CifToken> {
  let index = 0;
  let line = 1;
  let atLineStart = true;

  while (index < text.length) {
    const character = text[index];
    if (character === "\r") {
      index += 1;
      if (text[index] === "\n") index += 1;
      line += 1;
      atLineStart = true;
      continue;
    }
    if (character === "\n") {
      index += 1;
      line += 1;
      atLineStart = true;
      continue;
    }
    if (/\s/.test(character)) {
      index += 1;
      atLineStart = false;
      continue;
    }
    if (character === "#") {
      while (index < text.length && text[index] !== "\n" && text[index] !== "\r") index += 1;
      continue;
    }
    if (character === ";" && atLineStart) {
      const openingLine = line;
      index += 1;
      const contentStart = index;
      let closingStart = -1;
      while (index < text.length) {
        if (text[index] === "\n") {
          line += 1;
          index += 1;
          if (text[index] === ";") {
            closingStart = index;
            break;
          }
          continue;
        }
        if (text[index] === "\r") {
          line += 1;
          index += 1;
          if (text[index] === "\n") index += 1;
          if (text[index] === ";") {
            closingStart = index;
            break;
          }
          continue;
        }
        index += 1;
      }
      if (closingStart < 0) {
        throw new Error(`Unterminated semicolon-delimited mmCIF value beginning on line ${openingLine}.`);
      }
      let value = text.slice(contentStart, closingStart);
      value = value.replace(/(?:\r?\n)$/, "");
      yield { value, quoted: true, line: openingLine };
      index = closingStart + 1;
      while (index < text.length && text[index] !== "\n" && text[index] !== "\r") {
        if (text[index] !== " " && text[index] !== "\t") {
          throw new Error(`Unexpected text after a semicolon delimiter on line ${line}.`);
        }
        index += 1;
      }
      atLineStart = false;
      continue;
    }
    if (character === "'" || character === '"') {
      const quote = character;
      const openingLine = line;
      index += 1;
      let value = "";
      let closed = false;
      while (index < text.length) {
        const current = text[index];
        if (current === "\n" || current === "\r") {
          throw new Error(`Quoted mmCIF value on line ${openingLine} crosses a line boundary.`);
        }
        if (current === quote) {
          const next = text[index + 1];
          if (next == null || /\s/.test(next) || next === "#") {
            index += 1;
            closed = true;
            break;
          }
        }
        value += current;
        index += 1;
      }
      if (!closed) throw new Error(`Unterminated quoted mmCIF value on line ${openingLine}.`);
      yield { value, quoted: true, line: openingLine };
      atLineStart = false;
      continue;
    }

    const tokenLine = line;
    const start = index;
    while (index < text.length && !/\s/.test(text[index])) index += 1;
    yield { value: text.slice(start, index), quoted: false, line: tokenLine };
    atLineStart = false;
  }
}

function missingToNull(value: string | undefined): string | null {
  if (value?.startsWith(QUOTED_MISSING_SENTINEL)) {
    return value.slice(QUOTED_MISSING_SENTINEL.length);
  }
  if (value == null || value === "." || value === "?") return null;
  return value;
}

function storedTokenValue(token: CifToken): string {
  if (token.quoted && (token.value === "." || token.value === "?")) {
    return `${QUOTED_MISSING_SENTINEL}${token.value}`;
  }
  return token.value;
}

function categoryName(itemName: string): string {
  const normalized = itemName.toLowerCase();
  const dot = normalized.indexOf(".");
  return dot < 0 ? normalized.slice(1) : normalized.slice(1, dot);
}

function isControlToken(token: CifToken): boolean {
  if (token.quoted) return false;
  const normalized = token.value.toLowerCase();
  return token.value.startsWith("_") || normalized === "loop_" || normalized === "stop_" ||
    normalized === "global_" || normalized.startsWith("data_") || normalized.startsWith("save_");
}

function rowValue(row: Record<string, string>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = missingToNull(row[key.toLowerCase()]);
    if (value != null) return value;
  }
  return null;
}

function assertBoundedIdentifier(
  value: string | null,
  maximum: number,
  label: string,
): void {
  if (value != null && value.length > maximum) {
    throw new Error(`${label} exceeds the bounded identifier-length limit of ${maximum} characters.`);
  }
  if (value != null && /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) {
    throw new Error(`${label} contains an unsupported control or invisible formatting character.`);
  }
}

function parseStrictNumber(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const trimmed = value.trim();
  if (!/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:\(\d+\))?(?:[Ee][+-]?\d+)?$/.test(trimmed)) {
    return null;
  }
  const normalized = trimmed.replace(/\(\d+\)(?=[Ee]|$)/, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStrictInteger(value: string | null): number | null {
  if (value == null || !/^[+-]?\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function atomElement(atomName: string, explicitElement: string | null): string {
  if (explicitElement) return explicitElement.toUpperCase();
  const letters = atomName.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (letters === "SE") return "SE";
  return letters.charAt(0);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function roleHint(residueCount: number): ChainSummary["roleHint"] {
  if (residueCount >= 80 && residueCount <= 155) return "VHH-like";
  if (residueCount >= 180) return "receptor-like";
  return "other";
}

function identityOperation(): AffineOperation {
  return {
    rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    translation: [0, 0, 0],
  };
}

function multiplyOperations(left: AffineOperation, right: AffineOperation): AffineOperation {
  const rotation: AffineOperation["rotation"] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const translation: AffineOperation["translation"] = [0, 0, 0];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      rotation[row][column] = (
        left.rotation[row][0] * right.rotation[0][column] +
        left.rotation[row][1] * right.rotation[1][column] +
        left.rotation[row][2] * right.rotation[2][column]
      );
    }
    translation[row] = (
      left.rotation[row][0] * right.translation[0] +
      left.rotation[row][1] * right.translation[1] +
      left.rotation[row][2] * right.translation[2] +
      left.translation[row]
    );
  }
  if (
    rotation.flat().some((value) => !Number.isFinite(value)) ||
    translation.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("Deposited-assembly operation composition produced non-finite values.");
  }
  return { rotation, translation };
}

function applyOperation(operation: AffineOperation, x: number, y: number, z: number): [number, number, number] {
  return [
    operation.rotation[0][0] * x + operation.rotation[0][1] * y + operation.rotation[0][2] * z + operation.translation[0],
    operation.rotation[1][0] * x + operation.rotation[1][1] * y + operation.rotation[1][2] * z + operation.translation[1],
    operation.rotation[2][0] * x + operation.rotation[2][1] * y + operation.rotation[2][2] * z + operation.translation[2],
  ];
}

function expandOperationGroup(group: string): string[] {
  const values: string[] = [];
  for (const rawPart of group.split(",")) {
    const part = rawPart.trim();
    if (!part) throw new Error(`Malformed deposited-assembly operation group “${group}”.`);
    assertBoundedIdentifier(part, MAX_CIF_IDENTIFIER_CHARACTERS, "Assembly operation ID");
    const range = part.match(/^(\d+)-(\d+)$/);
    if (!range) {
      values.push(part);
      continue;
    }
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      throw new Error(`Assembly-operation range “${part}” exceeds the safe-integer range.`);
    }
    if (end < start) throw new Error(`Descending assembly-operation range “${part}” is not supported.`);
    if (end - start + 1 > MAX_OPERATION_COMBINATIONS) {
      throw new Error(`Assembly-operation range “${part}” exceeds the browser expansion limit.`);
    }
    for (let value = start; value <= end; value += 1) values.push(String(value));
  }
  return values;
}

export function expandOperationExpression(expression: string): string[][] {
  const compact = expression.replace(/\s+/g, "");
  if (!compact) throw new Error("A deposited-assembly generator has an empty operation expression.");
  if (compact.length > MAX_OPERATION_EXPRESSION_LENGTH) {
    throw new Error("A deposited-assembly operation expression exceeds the bounded parser length limit.");
  }
  const groups: string[][] = [];
  if (compact.startsWith("(")) {
    let index = 0;
    while (index < compact.length) {
      if (compact[index] !== "(") {
        throw new Error(`Malformed deposited-assembly operation expression “${expression}”.`);
      }
      const closing = compact.indexOf(")", index + 1);
      if (closing < 0) throw new Error(`Unclosed deposited-assembly operation expression “${expression}”.`);
      groups.push(expandOperationGroup(compact.slice(index + 1, closing)));
      if (groups.length > MAX_OPERATION_FACTORS) {
        throw new Error(`Assembly operation expressions support at most ${MAX_OPERATION_FACTORS} Cartesian factors.`);
      }
      index = closing + 1;
    }
  } else {
    if (compact.includes("(") || compact.includes(")")) {
      throw new Error(`Malformed deposited-assembly operation expression “${expression}”.`);
    }
    groups.push(expandOperationGroup(compact));
  }

  let combinations: string[][] = [[]];
  for (const group of groups) {
    const next: string[][] = [];
    for (const prefix of combinations) {
      for (const operationId of group) {
        next.push([...prefix, operationId]);
        if (next.length > MAX_OPERATION_COMBINATIONS) {
          throw new Error(
            `Assembly operation expression “${expression}” expands beyond ${MAX_OPERATION_COMBINATIONS} combinations.`,
          );
        }
      }
    }
    combinations = next;
  }
  return combinations;
}

function selectAlternateLocations(
  sourceResidues: SourceResidue[],
  diagnostics: {
    ignoredAlternateLocations: number;
    duplicateAtomRecords: number;
  },
): SelectedSourceResidue[] {
  return sourceResidues.map((residue) => {
    const deduplicatedByAtom = new Map<string, Map<string, AtomCandidate>>();
    const alternateOccupancyTotals = new Map<string, number>();
    for (const [atomName, candidates] of residue.candidatesByAtom) {
      const bestByAlternate = new Map<string, AtomCandidate>();
      const conflictingBestAlternates = new Set<string>();
      for (const candidate of candidates) {
        const existing = bestByAlternate.get(candidate.alternateLocation);
        if (existing) {
          diagnostics.duplicateAtomRecords += 1;
          if (candidate.occupancy > existing.occupancy) {
            bestByAlternate.set(candidate.alternateLocation, candidate);
            conflictingBestAlternates.delete(candidate.alternateLocation);
          } else if (
            candidate.occupancy === existing.occupancy &&
            (
              candidate.x !== existing.x || candidate.y !== existing.y || candidate.z !== existing.z ||
              candidate.element !== existing.element
            )
          ) {
            conflictingBestAlternates.add(candidate.alternateLocation);
          }
        } else {
          bestByAlternate.set(candidate.alternateLocation, candidate);
        }
      }
      if (conflictingBestAlternates.size) {
        throw new Error(
          `The mmCIF contains conflicting highest-occupancy duplicate records for atom ${atomName} ` +
          `at label asym ${residue.labelAsymId}, residue ${residue.number}${residue.insertionCode}.`,
        );
      }
      deduplicatedByAtom.set(atomName, bestByAlternate);
      for (const [alternateLocation, candidate] of bestByAlternate) {
        if (!alternateLocation) continue;
        alternateOccupancyTotals.set(
          alternateLocation,
          (alternateOccupancyTotals.get(alternateLocation) ?? 0) + candidate.occupancy,
        );
      }
    }

    let preferredAlternate: string | null = null;
    let preferredOccupancy = Number.NEGATIVE_INFINITY;
    for (const [alternateLocation, occupancy] of alternateOccupancyTotals) {
      if (
        occupancy > preferredOccupancy ||
        (
          occupancy === preferredOccupancy &&
          (
            preferredAlternate == null || alternateLocation === "A" ||
            (preferredAlternate !== "A" && compareCodeUnits(alternateLocation, preferredAlternate) < 0)
          )
        )
      ) {
        preferredAlternate = alternateLocation;
        preferredOccupancy = occupancy;
      }
    }
    const atoms: AtomCandidate[] = [];
    for (const bestByAlternate of deduplicatedByAtom.values()) {
      const blank = bestByAlternate.get("");
      const selected = blank ?? (preferredAlternate ? bestByAlternate.get(preferredAlternate) : undefined);
      for (const [alternateLocation, candidate] of bestByAlternate) {
        if (alternateLocation && candidate !== selected) diagnostics.ignoredAlternateLocations += 1;
      }
      if (selected) atoms.push(selected);
    }
    return {
      sourceKey: residue.sourceKey,
      labelAsymId: residue.labelAsymId,
      authAsymId: residue.authAsymId,
      name: residue.name,
      number: residue.number,
      insertionCode: residue.insertionCode,
      order: residue.order,
      oneLetter: residue.oneLetter,
      labelSequenceId: residue.labelSequenceId,
      atoms,
    };
  }).filter((residue) => residue.atoms.length > 0);
}

function materializeStructure(
  sourceChains: Map<string, SelectedSourceResidue[]>,
  instances: ChainInstance[],
): { atoms: AtomRecord[]; chains: ChainSummary[] } {
  const atoms: AtomRecord[] = [];
  const chains: ChainSummary[] = [];
  let serial = 0;
  for (const instance of instances) {
    const sourceResidues = sourceChains.get(instance.labelAsymId);
    if (!sourceResidues) continue;
    const residues: ResidueRecord[] = sourceResidues.map((sourceResidue) => {
      const residueKey = JSON.stringify([
        instance.chainId,
        sourceResidue.number,
        sourceResidue.insertionCode,
        sourceResidue.order,
      ]);
      const residueAtoms = sourceResidue.atoms.map((sourceAtom) => {
        const [x, y, z] = applyOperation(instance.operation, sourceAtom.x, sourceAtom.y, sourceAtom.z);
        if ([x, y, z].some((value) => (
          !Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_COORDINATE_ANGSTROM
        ))) {
          throw new Error("Deposited-assembly materialization produced a non-finite or implausibly large coordinate.");
        }
        const atom: AtomRecord = {
          serial: serial += 1,
          name: sourceAtom.name,
          residueName: sourceAtom.residueName,
          chainId: instance.chainId,
          residueNumber: sourceResidue.number,
          insertionCode: sourceResidue.insertionCode,
          residueKey,
          residueOrder: sourceResidue.order,
          x,
          y,
          z,
          element: sourceAtom.element,
          bFactor: sourceAtom.bFactor,
        };
        atoms.push(atom);
        if (atoms.length > MAX_PARSED_ATOMS) {
          throw new Error(
            `The selected coordinate scope expands beyond ${MAX_PARSED_ATOMS.toLocaleString()} protein heavy atoms. ` +
            "Choose a smaller deposited assembly or reduce the file to the receptor and VHH chains.",
          );
        }
        return atom;
      });
      return {
        key: residueKey,
        chainId: instance.chainId,
        name: sourceResidue.name,
        number: sourceResidue.number,
        insertionCode: sourceResidue.insertionCode,
        order: sourceResidue.order,
        oneLetter: sourceResidue.oneLetter,
        atoms: residueAtoms,
        labelSequenceId: sourceResidue.labelSequenceId,
        authSequenceId: sourceResidue.number,
      };
    });
    chains.push({
      id: instance.chainId,
      atomCount: residues.reduce((sum, residue) => sum + residue.atoms.length, 0),
      residueCount: residues.length,
      sequence: residues.map((residue) => residue.oneLetter).join(""),
      backboneCompleteness: residues.length === 0 ? 0 : residues.filter((residue) => (
        ["N", "CA", "C", "O"].every((name) => residue.atoms.some((atom) => atom.name === name))
      )).length / residues.length,
      roleHint: roleHint(residues.length),
      residues,
      labelAsymId: instance.labelAsymId,
      authAsymId: instance.authAsymId,
      assemblyCopyIndex: instance.copyIndex,
      assemblyGeneratorRowIndex: instance.generatorRowIndex,
      assemblyOperationIds: [...instance.operationIds],
      assemblyTransform: [
        [...instance.operation.rotation[0], instance.operation.translation[0]],
        [...instance.operation.rotation[1], instance.operation.translation[1]],
        [...instance.operation.rotation[2], instance.operation.translation[2]],
      ],
    });
  }
  return { atoms, chains };
}

function recordsForCategory(
  category: string,
  loopRecords: Map<string, Array<Record<string, string>>>,
  scalarItems: Map<string, string>,
): Array<Record<string, string>> {
  const loopRows = loopRecords.get(category);
  if (loopRows?.length) return loopRows;
  const prefix = `_${category}.`;
  const record: Record<string, string> = {};
  for (const [key, value] of scalarItems) {
    if (key.startsWith(prefix)) record[key] = value;
  }
  return Object.keys(record).length ? [record] : [];
}

function buildAssemblyDescriptors(
  assemblyRows: Array<Record<string, string>>,
  generators: AssemblyGenerator[],
): AssemblyDescriptor[] {
  const generatorsByAssemblyId = new Map<string, AssemblyGenerator[]>();
  for (const generator of generators) {
    const matching = generatorsByAssemblyId.get(generator.assemblyId) ?? [];
    matching.push(generator);
    generatorsByAssemblyId.set(generator.assemblyId, matching);
  }
  return assemblyRows.flatMap((row) => {
    const id = rowValue(row, "_pdbx_struct_assembly.id");
    if (!id) return [];
    assertBoundedIdentifier(id, MAX_CIF_IDENTIFIER_CHARACTERS, "Deposited-assembly ID");
    const matching = generatorsByAssemblyId.get(id) ?? [];
    return [{
      id,
      details: rowValue(row, "_pdbx_struct_assembly.details"),
      methodDetails: rowValue(row, "_pdbx_struct_assembly.method_details"),
      oligomericDetails: rowValue(row, "_pdbx_struct_assembly.oligomeric_details"),
      oligomericCount: parseStrictInteger(rowValue(row, "_pdbx_struct_assembly.oligomeric_count")),
      generatorCount: matching.length,
      generators: matching.map((generator) => ({
        sourceRowIndex: generator.sourceRowIndex,
        operationExpression: generator.operationExpression,
        labelAsymIds: [...generator.labelAsymIds],
      })),
    } satisfies AssemblyDescriptor];
  });
}

function parseOperation(row: Record<string, string>): [string, AffineOperation] | null {
  const id = rowValue(row, "_pdbx_struct_oper_list.id");
  if (!id) throw new Error("A deposited-assembly operation row is missing its ID.");
  assertBoundedIdentifier(id, MAX_CIF_IDENTIFIER_CHARACTERS, "Assembly operation ID");
  const operation = identityOperation();
  for (let matrixRow = 0; matrixRow < 3; matrixRow += 1) {
    for (let matrixColumn = 0; matrixColumn < 3; matrixColumn += 1) {
      const value = parseStrictNumber(rowValue(
        row,
        `_pdbx_struct_oper_list.matrix[${matrixRow + 1}][${matrixColumn + 1}]`,
      ));
      if (value == null) throw new Error(`Assembly operation “${id}” has an invalid rotation matrix.`);
      operation.rotation[matrixRow][matrixColumn] = value;
    }
    const vector = parseStrictNumber(rowValue(row, `_pdbx_struct_oper_list.vector[${matrixRow + 1}]`));
    if (vector == null) throw new Error(`Assembly operation “${id}” has an invalid translation vector.`);
    operation.translation[matrixRow] = vector;
  }
  const rowNorms = operation.rotation.map((matrixRow) => Math.hypot(...matrixRow));
  const dot01 = operation.rotation[0].reduce((sum, value, index) => sum + value * operation.rotation[1][index], 0);
  const dot02 = operation.rotation[0].reduce((sum, value, index) => sum + value * operation.rotation[2][index], 0);
  const dot12 = operation.rotation[1].reduce((sum, value, index) => sum + value * operation.rotation[2][index], 0);
  const determinant = (
    operation.rotation[0][0] * (operation.rotation[1][1] * operation.rotation[2][2] - operation.rotation[1][2] * operation.rotation[2][1]) -
    operation.rotation[0][1] * (operation.rotation[1][0] * operation.rotation[2][2] - operation.rotation[1][2] * operation.rotation[2][0]) +
    operation.rotation[0][2] * (operation.rotation[1][0] * operation.rotation[2][1] - operation.rotation[1][1] * operation.rotation[2][0])
  );
  if (
    rowNorms.some((norm) => Math.abs(norm - 1) > 0.001) ||
    Math.max(Math.abs(dot01), Math.abs(dot02), Math.abs(dot12)) > 0.001 ||
    Math.abs(determinant - 1) > 0.001
  ) {
    throw new Error(`Assembly operation “${id}” is not a proper rigid-body transform.`);
  }
  return [id, operation];
}

export function parseMmcif(text: string, options: ParseMmcifOptions = {}): ParsedStructure {
  if (typeof text !== "string" || text.length > MAX_CIF_TEXT_CHARACTERS) {
    throw new Error("This PDBx/mmCIF text exceeds the bounded parser size limit.");
  }
  if (text.includes("\u0000")) {
    throw new Error("PDBx/mmCIF coordinate text cannot contain NUL characters.");
  }
  assertBoundedIdentifier(options.assemblyId ?? null, MAX_CIF_IDENTIFIER_CHARACTERS, "Requested assembly ID");
  assertBoundedIdentifier(options.modelId ?? null, MAX_CIF_IDENTIFIER_CHARACTERS, "Requested model ID");
  const stream = new TokenStream(text);
  const scalarItems = new Map<string, string>();
  const seenDataNames = new Set<string>();
  const loopRecords = new Map<string, Array<Record<string, string>>>();
  const sourceResidues = new Map<string, SourceResidue>();
  const labelSequenceByAuthorSite = new Map<string, number | null>();
  const residueOrderByChain = new Map<string, number>();
  const modelIds = new Set<string>();
  const sourceAsymIds = new Set<string>();
  const parsedProteinLabelAsymIds = new Set<string>();
  let selectedModelId: string | null = null;
  let candidateAtomCount = 0;
  let uniqueCandidateAtomIdentityCount = 0;
  let ignoredHydrogens = 0;
  let malformedAtomRecords = 0;
  let unsupportedResidueRecords = 0;
  let zeroOccupancyAtomRecords = 0;
  let residueNameConflicts = 0;

  const processAtomRow = (row: Record<string, string>) => {
    const group = rowValue(row, "_atom_site.group_pdb")?.toUpperCase() ?? "ATOM";
    if (group !== "ATOM" && group !== "HETATM") return;
    const modelId = rowValue(row, "_atom_site.pdbx_pdb_model_num") ?? "1";
    assertBoundedIdentifier(modelId, MAX_CIF_IDENTIFIER_CHARACTERS, "Coordinate model ID");
    modelIds.add(modelId);
    if (modelIds.size > MAX_MODELS) throw new Error(`The mmCIF contains more than ${MAX_MODELS} coordinate models.`);
    if (selectedModelId == null) selectedModelId = options.modelId ?? modelId;
    if (modelId !== selectedModelId) return;

    const sourceLabelAsymId = rowValue(row, "_atom_site.label_asym_id");
    assertBoundedIdentifier(sourceLabelAsymId, MAX_CIF_IDENTIFIER_CHARACTERS, "Source label asym ID");
    if (sourceLabelAsymId && !sourceAsymIds.has(sourceLabelAsymId)) {
      if (sourceAsymIds.size >= MAX_SOURCE_ASYM_IDS) {
        throw new Error("The mmCIF exceeds the distinct source asym-ID limit.");
      }
      sourceAsymIds.add(sourceLabelAsymId);
    }

    const residueName = (rowValue(row, "_atom_site.label_comp_id", "_atom_site.auth_comp_id") ?? "").toUpperCase();
    if (!AMINO_ACIDS[residueName]) {
      if (group === "ATOM") unsupportedResidueRecords += 1;
      return;
    }
    const atomName = rowValue(row, "_atom_site.label_atom_id", "_atom_site.auth_atom_id")?.trim() ?? "";
    const labelAsymId = rowValue(row, "_atom_site.label_asym_id");
    const authAsymId = rowValue(row, "_atom_site.auth_asym_id") ?? labelAsymId;
    const residueNumber = parseStrictInteger(rowValue(row, "_atom_site.auth_seq_id", "_atom_site.label_seq_id"));
    const labelSequenceValue = rowValue(row, "_atom_site.label_seq_id");
    const labelSequenceId = parseStrictInteger(labelSequenceValue);
    const insertionCode = rowValue(row, "_atom_site.pdbx_pdb_ins_code") ?? "";
    assertBoundedIdentifier(atomName, MAX_CIF_ATOM_NAME_CHARACTERS, "Atom name");
    assertBoundedIdentifier(labelAsymId, MAX_CIF_IDENTIFIER_CHARACTERS, "Label asym ID");
    assertBoundedIdentifier(authAsymId, MAX_CIF_IDENTIFIER_CHARACTERS, "Author asym ID");
    assertBoundedIdentifier(insertionCode, MAX_CIF_IDENTIFIER_CHARACTERS, "Insertion code");
    const x = parseStrictNumber(rowValue(row, "_atom_site.cartn_x"));
    const y = parseStrictNumber(rowValue(row, "_atom_site.cartn_y"));
    const z = parseStrictNumber(rowValue(row, "_atom_site.cartn_z"));
    if (
      !atomName || !labelAsymId || !authAsymId || residueNumber == null ||
      (labelSequenceValue != null && labelSequenceId == null) ||
      x == null || y == null || z == null
    ) {
      malformedAtomRecords += 1;
      return;
    }
    const element = atomElement(atomName, rowValue(row, "_atom_site.type_symbol"));
    if (element === "H" || element === "D") {
      ignoredHydrogens += 1;
      return;
    }
    const occupancyRaw = rowValue(row, "_atom_site.occupancy");
    const occupancy = occupancyRaw == null ? 1 : parseStrictNumber(occupancyRaw);
    if (occupancy == null || occupancy < 0 || occupancy > 1) {
      malformedAtomRecords += 1;
      return;
    }
    if (occupancy === 0) {
      zeroOccupancyAtomRecords += 1;
      return;
    }
    if (!parsedProteinLabelAsymIds.has(labelAsymId)) {
      if (parsedProteinLabelAsymIds.size >= MAX_PARSED_PROTEIN_CHAINS) {
        throw new Error(
          `This mmCIF contains more than ${MAX_PARSED_PROTEIN_CHAINS} parsed protein chains. ` +
          "Reduce it to the receptor and VHH chains before analysis.",
        );
      }
      parsedProteinLabelAsymIds.add(labelAsymId);
    }
    const alternateLocation = rowValue(row, "_atom_site.label_alt_id", "_atom_site.auth_alt_id") ?? "";
    assertBoundedIdentifier(alternateLocation, MAX_CIF_IDENTIFIER_CHARACTERS, "Alternate-location ID");
    const authorSiteKey = `${labelAsymId}\u0000${residueNumber}\u0000${insertionCode}`;
    if (
      labelSequenceByAuthorSite.has(authorSiteKey) &&
      labelSequenceByAuthorSite.get(authorSiteKey) !== labelSequenceId
    ) {
      throw new Error(
        `Mixed or inconsistent label sequence IDs were found for author residue ${authAsymId} ` +
        `${residueNumber}${insertionCode}; parsing fails closed.`,
      );
    }
    labelSequenceByAuthorSite.set(authorSiteKey, labelSequenceId);
    const sourceKey = labelSequenceId != null
      ? `${labelAsymId}\u0000label:${labelSequenceId}`
      : `${labelAsymId}\u0000auth:${residueNumber}\u0000${insertionCode}`;
    let residue = sourceResidues.get(sourceKey);
    if (!residue) {
      const order = (residueOrderByChain.get(labelAsymId) ?? 0) + 1;
      residueOrderByChain.set(labelAsymId, order);
      residue = {
        sourceKey,
        labelAsymId,
        authAsymId,
        name: residueName,
        number: residueNumber,
        insertionCode,
        order,
        oneLetter: AMINO_ACIDS[residueName],
        labelSequenceId,
        candidatesByAtom: new Map(),
      };
      sourceResidues.set(sourceKey, residue);
    } else if (residue.name !== residueName) {
      residueNameConflicts += 1;
      throw new Error(
        `Microheterogeneous residue identities were found at label asym ${labelAsymId}, ` +
        `label sequence ${labelSequenceId ?? "unavailable"}; parsing fails closed.`,
      );
    } else if (
      residue.authAsymId !== authAsymId || residue.number !== residueNumber ||
      residue.insertionCode !== insertionCode
    ) {
      throw new Error(
        `Inconsistent author residue metadata were found at label asym ${labelAsymId}, ` +
        `label sequence ${labelSequenceId ?? "unavailable"}.`,
      );
    }
    const candidate: AtomCandidate = {
      serial: parseStrictInteger(rowValue(row, "_atom_site.id")) ?? candidateAtomCount + 1,
      name: atomName,
      residueName,
      labelAsymId,
      authAsymId,
      residueNumber,
      insertionCode,
      x,
      y,
      z,
      element,
      bFactor: parseStrictNumber(rowValue(row, "_atom_site.b_iso_or_equiv")),
      occupancy,
      alternateLocation,
    };
    if (!residue.candidatesByAtom.has(atomName)) {
      uniqueCandidateAtomIdentityCount += 1;
      if (uniqueCandidateAtomIdentityCount > MAX_PARSED_ATOMS) {
        throw new Error(
          `This mmCIF contains more than ${MAX_PARSED_ATOMS.toLocaleString()} unique protein heavy-atom sites. ` +
          "Reduce it to the receptor and VHH chains before analysis.",
        );
      }
    }
    const candidates = residue.candidatesByAtom.get(atomName) ?? [];
    candidates.push(candidate);
    residue.candidatesByAtom.set(atomName, candidates);
    candidateAtomCount += 1;
    if (candidateAtomCount > MAX_CANDIDATE_ATOMS) {
      throw new Error(
        "This mmCIF contains too many alternate or duplicate protein atom records for a browser audit. " +
        "Reduce it to the receptor and VHH chains before analysis.",
      );
    }
  };

  let token: CifToken | null;
  let dataBlockCount = 0;
  let inDataBlock = false;
  while ((token = stream.next())) {
    const normalized = token.value.toLowerCase();
    if (!token.quoted && normalized.startsWith("data_")) {
      if (token.value.length <= 5) throw new Error("The mmCIF data block requires a nonempty name.");
      if (token.value.length > MAX_CIF_BLOCK_NAME_CHARACTERS + 5) {
        throw new Error("The mmCIF data-block name exceeds the bounded identifier-length limit.");
      }
      dataBlockCount += 1;
      if (dataBlockCount > 1) {
        throw new Error("Coordinate uploads with multiple mmCIF data blocks are not supported.");
      }
      inDataBlock = true;
      continue;
    }
    if (!token.quoted && (normalized === "global_" || normalized.startsWith("save_"))) {
      throw new Error("mmCIF global blocks and save frames are not supported for coordinate uploads.");
    }
    if (!token.quoted && normalized === "loop_") {
      if (!inDataBlock) throw new Error("mmCIF loops must occur inside a named data block.");
      const headers: string[] = [];
      let next = stream.next();
      while (next && !next.quoted && next.value.startsWith("_")) {
        if (next.value.length > MAX_CIF_DATA_NAME_CHARACTERS) {
          throw new Error("An mmCIF loop data name exceeds the bounded identifier-length limit.");
        }
        if (headers.length >= MAX_LOOP_COLUMNS) {
          throw new Error(`mmCIF loop on line ${token.line} exceeds ${MAX_LOOP_COLUMNS} columns.`);
        }
        headers.push(next.value.toLowerCase());
        next = stream.next();
      }
      if (!headers.length) throw new Error(`mmCIF loop on line ${token.line} has no item names.`);
      if (headers.length > MAX_LOOP_COLUMNS) {
        throw new Error(`mmCIF loop on line ${token.line} exceeds ${MAX_LOOP_COLUMNS} columns.`);
      }
      const category = categoryName(headers[0]);
      if (headers.some((header) => categoryName(header) !== category)) {
        throw new Error(`mmCIF loop on line ${token.line} mixes multiple categories.`);
      }
      if (new Set(headers).size !== headers.length) {
        throw new Error(`mmCIF loop on line ${token.line} contains a duplicate item name.`);
      }
      for (const header of headers) {
        if (seenDataNames.has(header)) {
          throw new Error(`mmCIF data name ${header} is defined more than once.`);
        }
        if (seenDataNames.size >= MAX_DATA_NAMES) {
          throw new Error("The mmCIF exceeds the distinct data-name limit.");
        }
        seenDataNames.add(header);
      }
      const values: string[] = [];
      while (next) {
        if (isControlToken(next)) {
          if (values.length !== 0) {
            throw new Error(`mmCIF loop on line ${token.line} encounters a control token inside an incomplete row.`);
          }
          if (next.value.toLowerCase() !== "stop_") stream.push(next);
          break;
        }
        values.push(storedTokenValue(next));
        if (values.length === headers.length) {
          const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
          if (category === "atom_site") {
            processAtomRow(row);
          } else if (
            category === "pdbx_struct_assembly" ||
            category === "pdbx_struct_assembly_gen" ||
            category === "pdbx_struct_oper_list" ||
            category === "exptl"
          ) {
            const records = loopRecords.get(category) ?? [];
            if (category === "pdbx_struct_assembly" && records.length >= MAX_AVAILABLE_ASSEMBLIES) {
              throw new Error(
                `The mmCIF defines more than ${MAX_AVAILABLE_ASSEMBLIES} deposited assemblies.`,
              );
            }
            if (records.length >= MAX_RETAINED_METADATA_ROWS) {
              throw new Error(`mmCIF category ${category} exceeds the retained metadata-row limit.`);
            }
            records.push(row);
            loopRecords.set(category, records);
          }
          values.length = 0;
        }
        next = stream.next();
      }
      if (values.length) {
        throw new Error(`mmCIF loop on line ${token.line} ends with an incomplete row.`);
      }
      continue;
    }
    if (!token.quoted && token.value.startsWith("_")) {
      if (!inDataBlock) throw new Error("mmCIF data items must occur inside a named data block.");
      if (token.value.length > MAX_CIF_DATA_NAME_CHARACTERS) {
        throw new Error("An mmCIF data name exceeds the bounded identifier-length limit.");
      }
      const itemName = token.value.toLowerCase();
      if (seenDataNames.has(itemName)) {
        throw new Error(`mmCIF data name ${itemName} is defined more than once.`);
      }
      if (seenDataNames.size >= MAX_DATA_NAMES) {
        throw new Error("The mmCIF exceeds the distinct data-name limit.");
      }
      seenDataNames.add(itemName);
      if (scalarItems.size >= MAX_SCALAR_ITEMS) {
        throw new Error("The mmCIF exceeds the retained scalar-item limit.");
      }
      const value = stream.next();
      if (!value || isControlToken(value)) {
        if (value) stream.push(value);
        throw new Error(`mmCIF item ${token.value} on line ${token.line} has no value.`);
      }
      scalarItems.set(itemName, storedTokenValue(value));
      continue;
    }
    throw new Error(`Unexpected mmCIF token “${token.value}” on line ${token.line}.`);
  }

  if (dataBlockCount !== 1) throw new Error("A coordinate mmCIF must contain exactly one named data block.");

  if (!candidateAtomCount || sourceResidues.size === 0) {
    if (options.modelId != null && modelIds.size > 0 && !modelIds.has(options.modelId)) {
      throw new Error(`Coordinate model “${options.modelId}” is not defined in this PDBx/mmCIF file.`);
    }
    throw new Error("No readable protein coordinate records were found in this PDBx/mmCIF file.");
  }

  const alternateDiagnostics = { ignoredAlternateLocations: 0, duplicateAtomRecords: 0 };
  const selectedResidues = selectAlternateLocations(Array.from(sourceResidues.values()), alternateDiagnostics);
  const sourceChains = new Map<string, SelectedSourceResidue[]>();
  for (const residue of selectedResidues) {
    const residues = sourceChains.get(residue.labelAsymId) ?? [];
    residues.push(residue);
    sourceChains.set(residue.labelAsymId, residues);
  }
  for (const residues of sourceChains.values()) {
    if (residues.every((residue) => residue.labelSequenceId != null)) {
      residues.sort((left, right) => left.labelSequenceId! - right.labelSequenceId!);
    } else {
      residues.sort((left, right) => left.order - right.order);
    }
    residues.forEach((residue, index) => { residue.order = index + 1; });
  }

  const generators: AssemblyGenerator[] = recordsForCategory(
    "pdbx_struct_assembly_gen",
    loopRecords,
    scalarItems,
  ).map((row, sourceRowIndex) => {
    const assemblyId = rowValue(row, "_pdbx_struct_assembly_gen.assembly_id");
    const operationExpression = rowValue(row, "_pdbx_struct_assembly_gen.oper_expression");
    const asymIdList = rowValue(row, "_pdbx_struct_assembly_gen.asym_id_list");
    if (!assemblyId || !operationExpression || !asymIdList) {
      throw new Error(`Deposited-assembly generator row ${sourceRowIndex + 1} is missing a required field.`);
    }
    assertBoundedIdentifier(assemblyId, MAX_CIF_IDENTIFIER_CHARACTERS, "Deposited-assembly ID");
    if (asymIdList.length > MAX_ASYM_ID_LIST_CHARACTERS) {
      throw new Error(
        `Deposited-assembly generator row ${sourceRowIndex + 1} exceeds the bounded asym-ID list length.`,
      );
    }
    let asymIdCount = 1;
    for (const character of asymIdList) {
      if (character === ",") asymIdCount += 1;
      if (asymIdCount > MAX_ASYM_IDS_PER_GENERATOR) {
        throw new Error(
          `Deposited-assembly generator row ${sourceRowIndex + 1} lists more than ` +
          `${MAX_ASYM_IDS_PER_GENERATOR} label asym IDs.`,
        );
      }
    }
    const labelAsymIds = asymIdList.split(",").map((value) => value.trim()).filter(Boolean);
    for (const labelAsymId of labelAsymIds) {
      assertBoundedIdentifier(labelAsymId, MAX_CIF_IDENTIFIER_CHARACTERS, "Assembly-generator label asym ID");
    }
    if (!labelAsymIds.length || new Set(labelAsymIds).size !== labelAsymIds.length) {
      throw new Error(`Deposited-assembly generator row ${sourceRowIndex + 1} has an empty or duplicate label asym ID.`);
    }
    return {
      sourceRowIndex: sourceRowIndex + 1,
      assemblyId,
      operationExpression,
      labelAsymIds,
    };
  });
  if (generators.length > MAX_GENERATOR_ROWS) {
    throw new Error(`The mmCIF defines more than ${MAX_GENERATOR_ROWS} deposited-assembly generator rows.`);
  }
  const availableAssemblies = buildAssemblyDescriptors(
    recordsForCategory("pdbx_struct_assembly", loopRecords, scalarItems),
    generators,
  );
  if (availableAssemblies.length > MAX_AVAILABLE_ASSEMBLIES) {
    throw new Error(`The mmCIF defines more than ${MAX_AVAILABLE_ASSEMBLIES} deposited assemblies.`);
  }
  if (new Set(availableAssemblies.map((assembly) => assembly.id)).size !== availableAssemblies.length) {
    throw new Error("The mmCIF defines a deposited assembly ID more than once.");
  }

  let instances: ChainInstance[] = [];
  let selectedAssembly: SelectedAssembly | null = null;
  if (options.assemblyId != null) {
    const descriptor = availableAssemblies.find((assembly) => assembly.id === options.assemblyId);
    if (!descriptor) throw new Error(`Deposited assembly “${options.assemblyId}” is not defined in this mmCIF file.`);
    const matchingGenerators = generators.filter((generator) => generator.assemblyId === options.assemblyId);
    if (!matchingGenerators.length) {
      throw new Error(`Deposited assembly “${options.assemblyId}” has no generator records.`);
    }
    const operations = new Map<string, AffineOperation>();
    for (const row of recordsForCategory("pdbx_struct_oper_list", loopRecords, scalarItems)) {
      const parsed = parseOperation(row);
      if (parsed) {
        if (operations.has(parsed[0])) throw new Error(`Assembly operation ID “${parsed[0]}” is defined more than once.`);
        operations.set(...parsed);
      }
    }
    const pending: Array<Omit<ChainInstance, "chainId" | "copyIndex">> = [];
    const skippedNonProteinLabelAsymIds = new Set<string>();
    const seenGeneratedInstances = new Set<string>();
    const seenGeneratedTransforms = new Set<string>();
    let generatedOperationCount = 0;
    let generatedChainApplications = 0;
    const expandedGenerators: SelectedAssembly["generators"] = [];
    for (const generator of matchingGenerators) {
      const combinations = expandOperationExpression(generator.operationExpression);
      if (generatedOperationCount + combinations.length > MAX_SELECTED_ASSEMBLY_OPERATION_TUPLES) {
        throw new Error(
          `Deposited assembly “${options.assemblyId}” exceeds the ${MAX_SELECTED_ASSEMBLY_OPERATION_TUPLES} operation-tuple limit.`,
        );
      }
      const generatorApplications = combinations.length * generator.labelAsymIds.length;
      if (generatedChainApplications + generatorApplications > MAX_SELECTED_ASSEMBLY_CHAIN_APPLICATIONS) {
        throw new Error(
          `Deposited assembly “${options.assemblyId}” exceeds the ${MAX_SELECTED_ASSEMBLY_CHAIN_APPLICATIONS} chain-application limit.`,
        );
      }
      generatedChainApplications += generatorApplications;
      expandedGenerators.push({
        sourceRowIndex: generator.sourceRowIndex,
        operationExpression: generator.operationExpression,
        labelAsymIds: [...generator.labelAsymIds],
        expandedOperationTuples: combinations.map((combination) => [...combination]),
      });
      generatedOperationCount += combinations.length;
      for (const operationIds of combinations) {
        let composed = identityOperation();
        for (const operationId of operationIds) {
          const operation = operations.get(operationId);
          if (!operation) {
            throw new Error(
              `Deposited assembly “${options.assemblyId}” references missing operation “${operationId}”.`,
            );
          }
          composed = multiplyOperations(composed, operation);
        }
        for (const labelAsymId of generator.labelAsymIds) {
          if (!sourceAsymIds.has(labelAsymId)) {
            throw new Error(
              `Deposited assembly “${options.assemblyId}” references unknown label asym ID “${labelAsymId}”.`,
            );
          }
          const residues = sourceChains.get(labelAsymId);
          if (!residues?.length) {
            skippedNonProteinLabelAsymIds.add(labelAsymId);
            continue;
          }
          const generatedInstanceKey = `${labelAsymId}\u0000${operationIds.join("\u0000")}`;
          if (seenGeneratedInstances.has(generatedInstanceKey)) {
            throw new Error(
              `Deposited assembly “${options.assemblyId}” defines the same label asym ID and operation tuple more than once.`,
            );
          }
          seenGeneratedInstances.add(generatedInstanceKey);
          const transformSignature = [
            ...composed.rotation.flat(),
            ...composed.translation,
          ].map((value) => value.toFixed(9)).join(",");
          const generatedTransformKey = `${labelAsymId}\u0000${transformSignature}`;
          if (seenGeneratedTransforms.has(generatedTransformKey)) {
            throw new Error(
              `Deposited assembly “${options.assemblyId}” generates duplicate coordinates for label asym ID “${labelAsymId}”.`,
            );
          }
          seenGeneratedTransforms.add(generatedTransformKey);
          pending.push({
            labelAsymId,
            authAsymId: residues[0].authAsymId,
            operationIds,
            operation: composed,
            generatorRowIndex: generator.sourceRowIndex,
          });
          if (pending.length > MAX_ASSEMBLY_CHAIN_COPIES) {
            throw new Error(
              `Deposited assembly “${options.assemblyId}” expands beyond ${MAX_ASSEMBLY_CHAIN_COPIES} protein chain copies.`,
            );
          }
        }
      }
    }
    if (!pending.length) {
      throw new Error(`Deposited assembly “${options.assemblyId}” does not generate a supported protein chain.`);
    }
    const copyCounters = new Map<string, number>();
    instances = pending.map((instance, instanceIndex) => {
      const copyIndex = (copyCounters.get(instance.labelAsymId) ?? 0) + 1;
      copyCounters.set(instance.labelAsymId, copyIndex);
      return {
        ...instance,
        copyIndex,
        chainId: `mmcif-chain-${String(instanceIndex + 1).padStart(4, "0")}`,
      };
    });
    selectedAssembly = {
      id: descriptor.id,
      details: descriptor.details,
      generatorCount: matchingGenerators.length,
      generatedChainCount: instances.length,
      generatedProteinHeavyAtomCount: 0,
      generatedOperationCount,
      skippedNonProteinLabelAsymIds: Array.from(skippedNonProteinLabelAsymIds),
      materializationPolicy: "Supported protein heavy atoms only; non-protein components and hydrogens are not materialized.",
      generators: expandedGenerators,
    };
  } else {
    for (const [labelAsymId, residues] of sourceChains) {
      const authAsymId = residues[0].authAsymId;
      instances.push({
        labelAsymId,
        authAsymId,
        operationIds: [],
        operation: identityOperation(),
        copyIndex: undefined,
        generatorRowIndex: undefined,
        chainId: labelAsymId,
      });
    }
  }

  const materialized = materializeStructure(sourceChains, instances);
  if (selectedAssembly) selectedAssembly.generatedProteinHeavyAtomCount = materialized.atoms.length;
  const title = missingToNull(scalarItems.get("_struct.title"));
  const experimentalMethod = missingToNull(scalarItems.get("_exptl.method")) ??
    rowValue(loopRecords.get("exptl")?.[0] ?? {}, "_exptl.method");
  return {
    ...materialized,
    title,
    experimentalMethod,
    modelCount: Math.max(modelIds.size, 1),
    ignoredAlternateLocations: alternateDiagnostics.ignoredAlternateLocations,
    ignoredHydrogens,
    duplicateAtomRecords: alternateDiagnostics.duplicateAtomRecords,
    malformedAtomRecords,
    unsupportedResidueRecords,
    zeroOccupancyAtomRecords,
    residueNameConflicts,
    sourceFormat: "mmcif",
    coordinateScope: selectedAssembly ? "deposited-assembly" : "as-supplied",
    selectedModelId: selectedModelId ?? "1",
    availableModelIds: modelIds.size ? Array.from(modelIds) : ["1"],
    availableAssemblies,
    selectedAssembly,
  };
}
