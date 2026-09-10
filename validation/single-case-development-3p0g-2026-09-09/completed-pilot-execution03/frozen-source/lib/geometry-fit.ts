import {
  MAX_ABSOLUTE_COORDINATE_ANGSTROM,
  MAX_CANONICAL_COORDINATE_ANGSTROM,
} from "./geometry-constants.ts";
import type {
  AtomRecord,
  ParsedStructure,
} from "./confovhh.ts";

/**
 * Rigid-body geometry helpers for ConfoVHH v0.5.
 *
 * Atom identity is deliberately encoded as JSON tuples rather than a delimiter-
 * joined string.  This keeps identifiers injective even when source fields contain
 * punctuation or control characters.
 */

export const GEOMETRY_DUPLICATE_RMSD_ANGSTROM = 0.02;
export const GEOMETRY_DUPLICATE_MAX_DEVIATION_ANGSTROM = 0.05;

export type SelectedAtomRole = "receptor" | "vhh";
export type SelectedAtomIdentity = readonly [
  role: SelectedAtomRole,
  residueOrder: number,
  residueOneLetter: string,
  atomName: string,
  element: string,
];

export interface SelectedGeometryAtom {
  id: string;
  identity: SelectedAtomIdentity;
  atom: AtomRecord;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface RigidGeometryComparison {
  atomCount: number;
  rmsdAngstrom: number;
  maximumDeviationAngstrom: number;
  rotation: [[number, number, number], [number, number, number], [number, number, number]];
  translation: [number, number, number];
}

export interface CanonicalSelectedFrame {
  origin: Point3;
  xAxis: Point3;
  yAxis: Point3;
  zAxis: Point3;
  atomCount: number;
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function selectedChain(
  structure: ParsedStructure,
  role: SelectedAtomRole,
  chainId: string,
) {
  const chain = structure.chains.find((candidate) => candidate.id === chainId);
  if (!chain) {
    throw new Error(`Selected ${role} chain ${chainId} is missing while comparing coordinates.`);
  }
  return chain;
}

export function selectedGeometryAtoms(
  structure: ParsedStructure,
  receptorChainId: string,
  vhhChainId: string,
  maximumAbsoluteCoordinate = MAX_ABSOLUTE_COORDINATE_ANGSTROM,
): SelectedGeometryAtom[] {
  if (receptorChainId === vhhChainId) {
    throw new Error("Selected receptor and VHH chains must be different while comparing geometry.");
  }
  const result: SelectedGeometryAtom[] = [];
  for (const [role, chainId] of [
    ["receptor", receptorChainId],
    ["vhh", vhhChainId],
  ] as const) {
    const chain = selectedChain(structure, role, chainId);
    for (const residue of chain.residues) {
      for (const atom of residue.atoms) {
        if (
          !Number.isFinite(atom.x) || !Number.isFinite(atom.y) || !Number.isFinite(atom.z) ||
          Math.abs(atom.x) > maximumAbsoluteCoordinate ||
          Math.abs(atom.y) > maximumAbsoluteCoordinate ||
          Math.abs(atom.z) > maximumAbsoluteCoordinate
        ) {
          throw new Error(
            `Selected ${role} coordinates contain a non-finite value or one outside ` +
            `±${maximumAbsoluteCoordinate.toLocaleString()} Å.`,
          );
        }
        const identity: SelectedAtomIdentity = [
          role,
          residue.order,
          residue.oneLetter,
          atom.name,
          atom.element,
        ];
        result.push({ id: JSON.stringify(identity), identity, atom });
      }
    }
  }
  result.sort((left, right) => codeUnitCompare(left.id, right.id));
  for (let index = 1; index < result.length; index += 1) {
    if (result[index - 1].id === result[index].id) {
      throw new Error(
        `Selected geometry contains an ambiguous duplicate atom identity ${result[index].id}.`,
      );
    }
  }
  if (!result.length) throw new Error("Selected receptor–VHH geometry contains no atoms.");
  return result;
}

function squaredNorm(point: Point3): number {
  return point.x * point.x + point.y * point.y + point.z * point.z;
}

function subtract(left: Point3, right: Point3): Point3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function dot(left: Point3, right: Point3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left: Point3, right: Point3): Point3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function normalizeOrNull(point: Point3): Point3 | null {
  const length = Math.sqrt(squaredNorm(point));
  if (!Number.isFinite(length) || length <= 1e-12) return null;
  return { x: point.x / length, y: point.y / length, z: point.z / length };
}

function deterministicPerpendicular(axis: Point3): Point3 {
  // Degenerate collinear selections contain no information that can define a
  // unique transverse direction.  Choose a numerically stable world-basis
  // fallback; every selected point has zero transverse component, so its
  // canonical coordinates remain rigid-transform invariant.
  const basis = Math.abs(axis.x) <= Math.abs(axis.y) && Math.abs(axis.x) <= Math.abs(axis.z)
    ? { x: 1, y: 0, z: 0 }
    : Math.abs(axis.y) <= Math.abs(axis.z)
      ? { x: 0, y: 1, z: 0 }
      : { x: 0, y: 0, z: 1 };
  return normalizeOrNull(cross(axis, basis)) ?? { x: 0, y: 1, z: 0 };
}

function centroid(points: readonly Point3[]): Point3 {
  // Average offsets from the first point.  Global translations then cancel
  // before accumulation instead of consuming most floating-point precision.
  const anchor = points[0];
  let offsetX = 0;
  let offsetY = 0;
  let offsetZ = 0;
  for (const point of points) {
    offsetX += point.x - anchor.x;
    offsetY += point.y - anchor.y;
    offsetZ += point.z - anchor.z;
  }
  return {
    x: anchor.x + offsetX / points.length,
    y: anchor.y + offsetY / points.length,
    z: anchor.z + offsetZ / points.length,
  };
}

/**
 * Choose the first atom (already in canonical identity order) whose invariant
 * score is within a relative tolerance of the maximum.  Picking the earliest
 * near-tied atom is essential: exact distance ties otherwise flip under large
 * translations or innocuous rigid rotations because of floating-point noise.
 */
function farthestIndex(scores: readonly number[]): number {
  if (!scores.length) throw new Error("Cannot choose a canonical anchor from an empty geometry.");
  let maximum = Number.NEGATIVE_INFINITY;
  for (const score of scores) maximum = Math.max(maximum, score);
  // Scores that are mathematically tied can differ by a few ulps after a large
  // rigid translation has already rounded the input coordinates.  Snap only
  // the anchor-selection scores (never exported coordinates) to a very fine
  // relative quantum before applying the documented near-tie rule.
  const stabilityQuantum = Math.max(1e-12, Math.abs(maximum) * 1e-8);
  const stableScores = scores.map((score) => Math.round(score / stabilityQuantum) * stabilityQuantum);
  maximum = Number.NEGATIVE_INFINITY;
  for (const score of stableScores) maximum = Math.max(maximum, score);
  const nearTieTolerance = Math.max(1e-10, Math.abs(maximum) * 1e-9);
  for (let index = 0; index < stableScores.length; index += 1) {
    if (maximum - stableScores[index] <= nearTieTolerance) return index;
  }
  return 0;
}

export function canonicalSelectedFrame(
  structure: ParsedStructure,
  receptorChainId: string,
  vhhChainId: string,
): CanonicalSelectedFrame {
  const selected = selectedGeometryAtoms(structure, receptorChainId, vhhChainId);
  const points = selected.map(({ atom }) => ({ x: atom.x, y: atom.y, z: atom.z }));
  const origin = centroid(points);
  const centered = points.map((point) => subtract(point, origin));
  const primaryIndex = farthestIndex(centered.map(squaredNorm));
  // A fully coincident inventory is represented by the origin with a fixed
  // frame.  It is valid (if biologically unhelpful) and must not crash hashing.
  const xAxis = normalizeOrNull(centered[primaryIndex]) ?? { x: 1, y: 0, z: 0 };

  const perpendicular = centered.map((point) => {
    const projection = dot(point, xAxis);
    return {
      x: point.x - projection * xAxis.x,
      y: point.y - projection * xAxis.y,
      z: point.z - projection * xAxis.z,
    };
  });
  const secondaryIndex = farthestIndex(perpendicular.map(squaredNorm));
  const yAxis = normalizeOrNull(perpendicular[secondaryIndex]) ?? deterministicPerpendicular(xAxis);
  const zAxis = normalizeOrNull(cross(xAxis, yAxis)) ?? { x: 0, y: 0, z: 1 };

  return { origin, xAxis, yAxis, zAxis, atomCount: selected.length };
}

export function applyCanonicalFrame(point: Point3, frame: CanonicalSelectedFrame): Point3 {
  const centered = subtract(point, frame.origin);
  return {
    x: dot(centered, frame.xAxis),
    y: dot(centered, frame.yAxis),
    z: dot(centered, frame.zAxis),
  };
}

/**
 * Return a coordinate clone in a deterministic selected-complex frame.  This is
 * used only for the orientation-sensitive discretized SASA approximation.  The
 * source-frame structure must still be used for contacts, distances, clashes,
 * PAE mapping, labels, and provenance.
 */
export function canonicalizeSelectedGeometry(
  structure: ParsedStructure,
  receptorChainId: string,
  vhhChainId: string,
): ParsedStructure {
  const frame = canonicalSelectedFrame(structure, receptorChainId, vhhChainId);
  const selectedChainIds = [receptorChainId, vhhChainId] as const;
  const atomClones = new Map<AtomRecord, AtomRecord>();
  const cloneAtom = (atom: AtomRecord): AtomRecord => {
    const existing = atomClones.get(atom);
    if (existing) return existing;
    const point = applyCanonicalFrame(atom, frame);
    const clone = { ...atom, x: point.x, y: point.y, z: point.z };
    atomClones.set(atom, clone);
    return clone;
  };
  const chains = selectedChainIds.map((chainId) => {
    const chain = structure.chains.find((candidate) => candidate.id === chainId);
    if (!chain) {
      throw new Error(`Selected chain ${chainId} is missing while canonicalizing coordinates.`);
    }
    return {
      ...chain,
      assemblyOperationIds: chain.assemblyOperationIds
        ? [...chain.assemblyOperationIds]
        : undefined,
      assemblyTransform: chain.assemblyTransform
        ? chain.assemblyTransform.map((row) => [...row]) as typeof chain.assemblyTransform
        : undefined,
      residues: chain.residues.map((residue) => ({
        ...residue,
        atoms: residue.atoms.map(cloneAtom),
      })),
    };
  });
  const atoms = chains.flatMap((chain) => (
    chain.residues.flatMap((residue) => residue.atoms)
  ));
  const canonical: ParsedStructure = {
    ...structure,
    atoms,
    chains,
  };
  return canonical;
}

/**
 * Independently verify that an alternate SASA structure is exactly the
 * deterministic canonical frame derived from the supplied source structure.
 * No caller-provided brand or registry entry is trusted.
 */
export function canonicalSasaFrameMatches(
  source: ParsedStructure,
  candidate: ParsedStructure,
  receptorChainId: string,
  vhhChainId: string,
): boolean {
  let sourceAtoms: SelectedGeometryAtom[];
  let candidateAtoms: SelectedGeometryAtom[];
  let frame: CanonicalSelectedFrame;
  try {
    sourceAtoms = selectedGeometryAtoms(
      source,
      receptorChainId,
      vhhChainId,
      MAX_ABSOLUTE_COORDINATE_ANGSTROM,
    );
    candidateAtoms = selectedGeometryAtoms(
      candidate,
      receptorChainId,
      vhhChainId,
      MAX_CANONICAL_COORDINATE_ANGSTROM,
    );
    frame = canonicalSelectedFrame(source, receptorChainId, vhhChainId);
  } catch {
    return false;
  }
  if (sourceAtoms.length !== candidateAtoms.length) return false;
  for (let index = 0; index < sourceAtoms.length; index += 1) {
    if (sourceAtoms[index].id !== candidateAtoms[index].id) return false;
    const expected = applyCanonicalFrame(sourceAtoms[index].atom, frame);
    const observed = candidateAtoms[index].atom;
    if (
      !Object.is(expected.x, observed.x) ||
      !Object.is(expected.y, observed.y) ||
      !Object.is(expected.z, observed.z)
    ) return false;
  }
  return true;
}

/** Compatibility alias for early v0.5 drafts. */
export const canonicalizeSelectedStructure = canonicalizeSelectedGeometry;

function selectedAtomInventoriesMatch(
  reference: SelectedGeometryAtom[],
  candidate: SelectedGeometryAtom[],
): boolean {
  if (reference.length !== candidate.length) return false;
  for (let index = 0; index < reference.length; index += 1) {
    if (reference[index].id !== candidate[index].id) return false;
  }
  return true;
}

function largestEigenvectorSymmetric4(
  source: readonly (readonly number[])[],
): [number, number, number, number] {
  const matrix = source.map((row) => [...row]);
  const vectors: number[][] = Array.from({ length: 4 }, (_, row) => (
    Array.from({ length: 4 }, (__, column) => row === column ? 1 : 0)
  ));
  for (let sweep = 0; sweep < 64; sweep += 1) {
    let p = 0;
    let q = 1;
    let largest = 0;
    for (let row = 0; row < 4; row += 1) {
      for (let column = row + 1; column < 4; column += 1) {
        const magnitude = Math.abs(matrix[row][column]);
        if (magnitude > largest) {
          largest = magnitude;
          p = row;
          q = column;
        }
      }
    }
    const diagonalScale = Math.max(1, ...matrix.map((row, index) => Math.abs(row[index])));
    if (largest <= diagonalScale * 1e-15) break;

    const angle = 0.5 * Math.atan2(
      2 * matrix[p][q],
      matrix[q][q] - matrix[p][p],
    );
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const app = matrix[p][p];
    const aqq = matrix[q][q];
    const apq = matrix[p][q];
    matrix[p][p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
    matrix[q][q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
    matrix[p][q] = 0;
    matrix[q][p] = 0;
    for (let index = 0; index < 4; index += 1) {
      if (index === p || index === q) continue;
      const aip = matrix[index][p];
      const aiq = matrix[index][q];
      matrix[index][p] = cosine * aip - sine * aiq;
      matrix[p][index] = matrix[index][p];
      matrix[index][q] = sine * aip + cosine * aiq;
      matrix[q][index] = matrix[index][q];
    }
    for (let row = 0; row < 4; row += 1) {
      const vip = vectors[row][p];
      const viq = vectors[row][q];
      vectors[row][p] = cosine * vip - sine * viq;
      vectors[row][q] = sine * vip + cosine * viq;
    }
  }
  let largestIndex = 0;
  for (let index = 1; index < 4; index += 1) {
    if (matrix[index][index] > matrix[largestIndex][largestIndex]) largestIndex = index;
  }
  const result = vectors.map((row) => row[largestIndex]);
  const magnitude = Math.hypot(...result);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-15) {
    throw new Error("The proper-rotation least-squares fit did not converge.");
  }
  return result.map((value) => value / magnitude) as [number, number, number, number];
}

function quaternionRotation(
  quaternion: readonly [number, number, number, number],
): RigidGeometryComparison["rotation"] {
  const [w, x, y, z] = quaternion;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

function rotate(
  rotation: RigidGeometryComparison["rotation"],
  point: Point3,
): Point3 {
  return {
    x: rotation[0][0] * point.x + rotation[0][1] * point.y + rotation[0][2] * point.z,
    y: rotation[1][0] * point.x + rotation[1][1] * point.y + rotation[1][2] * point.z,
    z: rotation[2][0] * point.x + rotation[2][1] * point.y + rotation[2][2] * point.z,
  };
}

/** Horn quaternion fit of candidate (moving) onto reference (fixed). */
export function selectedGeometryFit(
  referenceStructure: ParsedStructure,
  referenceReceptorChainId: string,
  referenceVhhChainId: string,
  candidateStructure: ParsedStructure,
  candidateReceptorChainId: string,
  candidateVhhChainId: string,
): RigidGeometryComparison | null {
  const reference = selectedGeometryAtoms(
    referenceStructure,
    referenceReceptorChainId,
    referenceVhhChainId,
  );
  const candidate = selectedGeometryAtoms(
    candidateStructure,
    candidateReceptorChainId,
    candidateVhhChainId,
  );
  if (!selectedAtomInventoriesMatch(reference, candidate)) return null;

  const fixed = reference.map(({ atom }) => ({ x: atom.x, y: atom.y, z: atom.z }));
  const moving = candidate.map(({ atom }) => ({ x: atom.x, y: atom.y, z: atom.z }));
  const fixedCenter = centroid(fixed);
  const movingCenter = centroid(moving);
  const covariance = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let index = 0; index < fixed.length; index += 1) {
    const source = subtract(moving[index], movingCenter);
    const target = subtract(fixed[index], fixedCenter);
    covariance[0][0] += source.x * target.x;
    covariance[0][1] += source.x * target.y;
    covariance[0][2] += source.x * target.z;
    covariance[1][0] += source.y * target.x;
    covariance[1][1] += source.y * target.y;
    covariance[1][2] += source.y * target.z;
    covariance[2][0] += source.z * target.x;
    covariance[2][1] += source.z * target.y;
    covariance[2][2] += source.z * target.z;
  }
  const [[sxx, sxy, sxz], [syx, syy, syz], [szx, szy, szz]] = covariance;
  const trace = sxx + syy + szz;
  const horn = [
    [trace, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];
  const rotation = quaternionRotation(largestEigenvectorSymmetric4(horn));
  const rotatedMovingCenter = rotate(rotation, movingCenter);
  const translation: [number, number, number] = [
    fixedCenter.x - rotatedMovingCenter.x,
    fixedCenter.y - rotatedMovingCenter.y,
    fixedCenter.z - rotatedMovingCenter.z,
  ];

  let squaredResidualSum = 0;
  let maximumDeviationAngstrom = 0;
  for (let index = 0; index < fixed.length; index += 1) {
    const aligned = rotate(rotation, moving[index]);
    const residual = Math.hypot(
      aligned.x + translation[0] - fixed[index].x,
      aligned.y + translation[1] - fixed[index].y,
      aligned.z + translation[2] - fixed[index].z,
    );
    squaredResidualSum += residual * residual;
    maximumDeviationAngstrom = Math.max(maximumDeviationAngstrom, residual);
  }
  const rmsdAngstrom = Math.sqrt(squaredResidualSum / fixed.length);
  return {
    atomCount: fixed.length,
    rmsdAngstrom,
    maximumDeviationAngstrom,
    rotation,
    translation,
  };
}

export function geometryFitIsDuplicate(fit: RigidGeometryComparison | null): boolean {
  return fit != null &&
    fit.rmsdAngstrom <= GEOMETRY_DUPLICATE_RMSD_ANGSTROM + 1e-12 &&
    fit.maximumDeviationAngstrom <= GEOMETRY_DUPLICATE_MAX_DEVIATION_ANGSTROM + 1e-12;
}

/** Compatibility alias for early v0.5 drafts. */
export const compareSelectedRigidGeometry = selectedGeometryFit;
