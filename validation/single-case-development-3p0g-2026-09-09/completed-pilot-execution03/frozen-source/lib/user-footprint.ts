import type { InterfaceAudit, ParsedStructure } from "./confovhh.ts";

export const MAX_USER_FOOTPRINT_RESIDUES = 200;
export const MAX_USER_FOOTPRINT_CHARACTERS = 1_000;
export const USER_FOOTPRINT_INTERPRETATION =
  "Overlap is the fraction of mapped, user-supplied receptor residues present in this coordinate contact footprint. It is not specificity, binding, epitope correctness, or state compatibility.";

export interface IntendedFootprintMapping {
  requestedIdentifier: string;
  residueKey: string;
  canonicalIdentifier: string;
  coordinateLabel: string;
  sequenceOrder: number;
  contacted: boolean;
}

export interface IntendedFootprintAlias {
  requestedIdentifier: string;
  residueKey: string;
  canonicalIdentifier: string;
  canonicalRequestedIdentifier: string;
}

export interface IntendedFootprintSummary {
  receptorChain: string;
  requestedCount: number;
  mappedCount: number;
  contactedCount: number;
  mappedContactShare: number | null;
  mapped: IntendedFootprintMapping[];
  duplicateAliases: IntendedFootprintAlias[];
  unmapped: string[];
  observedReceptorFootprint: Array<{
    residueKey: string;
    canonicalIdentifier: string;
    coordinateLabel: string;
    sequenceOrder: number;
  }>;
  interpretation: string;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && value.length <= MAX_USER_FOOTPRINT_CHARACTERS &&
    !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp},;\s]/u.test(value) && value.normalize("NFKC") === value;
}

function codeUnitCompare(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function validateIntendedFootprintSummary(
  value: unknown,
  expectedReceptorChain?: string,
): asserts value is IntendedFootprintSummary {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("User-defined footprint summary must be an object.");
  }
  const summary = value as IntendedFootprintSummary;
  if (
    !hasExactKeys(summary, [
      "receptorChain", "requestedCount", "mappedCount", "contactedCount",
      "mappedContactShare", "mapped", "duplicateAliases", "unmapped",
      "observedReceptorFootprint", "interpretation",
    ]) ||
    typeof summary.receptorChain !== "string" || !summary.receptorChain ||
    (expectedReceptorChain != null && summary.receptorChain !== expectedReceptorChain) ||
    !Number.isSafeInteger(summary.requestedCount) || summary.requestedCount < 0 || summary.requestedCount > MAX_USER_FOOTPRINT_RESIDUES ||
    !Number.isSafeInteger(summary.mappedCount) || summary.mappedCount < 0 ||
    !Number.isSafeInteger(summary.contactedCount) || summary.contactedCount < 0 ||
    summary.contactedCount > summary.mappedCount || summary.mappedCount > summary.requestedCount ||
    !Array.isArray(summary.mapped) || summary.mapped.length !== summary.mappedCount ||
    !Array.isArray(summary.duplicateAliases) ||
    !Array.isArray(summary.unmapped) ||
    summary.mapped.length + summary.duplicateAliases.length + summary.unmapped.length !== summary.requestedCount ||
    !Array.isArray(summary.observedReceptorFootprint) ||
    summary.interpretation !== USER_FOOTPRINT_INTERPRETATION
  ) {
    throw new Error("User-defined footprint summary counts, chain, or interpretation are invalid.");
  }
  const mappedKeys = new Set<string>();
  const mappedOrders = new Set<number>();
  const mappedCanonicalIdentifiers = new Set<string>();
  const requestedIdentifiers = new Set<string>();
  for (const entry of summary.mapped) {
    if (
      entry == null || typeof entry !== "object" ||
      !hasExactKeys(entry, [
        "requestedIdentifier", "residueKey", "canonicalIdentifier", "coordinateLabel", "sequenceOrder", "contacted",
      ]) ||
      !validIdentifier(entry.requestedIdentifier) ||
      typeof entry.residueKey !== "string" || !entry.residueKey ||
      !validIdentifier(entry.canonicalIdentifier) ||
      !entry.canonicalIdentifier.startsWith(`${encodeURIComponent(summary.receptorChain)}:`) ||
      typeof entry.coordinateLabel !== "string" || !entry.coordinateLabel || entry.coordinateLabel.length > 500 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(entry.coordinateLabel) ||
      !Number.isSafeInteger(entry.sequenceOrder) || entry.sequenceOrder <= 0 ||
      typeof entry.contacted !== "boolean" ||
      mappedKeys.has(entry.residueKey) || mappedOrders.has(entry.sequenceOrder) ||
      mappedCanonicalIdentifiers.has(entry.canonicalIdentifier) ||
      requestedIdentifiers.has(entry.requestedIdentifier)
    ) {
      throw new Error("User-defined footprint mapped-residue records are invalid or duplicated.");
    }
    mappedKeys.add(entry.residueKey);
    mappedOrders.add(entry.sequenceOrder);
    mappedCanonicalIdentifiers.add(entry.canonicalIdentifier);
    requestedIdentifiers.add(entry.requestedIdentifier);
  }
  for (const alias of summary.duplicateAliases) {
    if (
      alias == null || typeof alias !== "object" ||
      !hasExactKeys(alias, ["requestedIdentifier", "residueKey", "canonicalIdentifier", "canonicalRequestedIdentifier"]) ||
      !validIdentifier(alias.requestedIdentifier) ||
      typeof alias.residueKey !== "string" || !mappedKeys.has(alias.residueKey) ||
      !validIdentifier(alias.canonicalIdentifier) ||
      !validIdentifier(alias.canonicalRequestedIdentifier) ||
      summary.mapped.find((entry) => entry.residueKey === alias.residueKey)?.canonicalIdentifier !== alias.canonicalIdentifier ||
      summary.mapped.find((entry) => entry.residueKey === alias.residueKey)?.requestedIdentifier !== alias.canonicalRequestedIdentifier ||
      requestedIdentifiers.has(alias.requestedIdentifier)
    ) {
      throw new Error("User-defined footprint duplicate-alias records are invalid or inconsistent.");
    }
    requestedIdentifiers.add(alias.requestedIdentifier);
  }
  const unmapped = new Set<string>();
  for (const identifier of summary.unmapped) {
    if (
      !validIdentifier(identifier) ||
      requestedIdentifiers.has(identifier) || unmapped.has(identifier)
    ) {
      throw new Error("User-defined footprint unmapped identifiers are invalid or duplicated.");
    }
    unmapped.add(identifier);
  }
  if (requestedIdentifiers.size + unmapped.size !== summary.requestedCount) {
    throw new Error("User-defined footprint requested identifiers do not reconcile with requestedCount.");
  }
  for (let index = 1; index < summary.mapped.length; index += 1) {
    const previous = summary.mapped[index - 1];
    const current = summary.mapped[index];
    if (
      previous.sequenceOrder > current.sequenceOrder ||
      (previous.sequenceOrder === current.sequenceOrder && codeUnitCompare(previous.requestedIdentifier, current.requestedIdentifier) > 0)
    ) throw new Error("User-defined footprint mapped residues are not in deterministic order.");
  }
  const observedKeys = new Set<string>();
  const observedOrders = new Set<number>();
  const observedCanonicalIdentifiers = new Set<string>();
  for (const entry of summary.observedReceptorFootprint) {
    if (
      entry == null || typeof entry !== "object" ||
      !hasExactKeys(entry, ["residueKey", "canonicalIdentifier", "coordinateLabel", "sequenceOrder"]) ||
      typeof entry.residueKey !== "string" || !entry.residueKey ||
      !validIdentifier(entry.canonicalIdentifier) ||
      !entry.canonicalIdentifier.startsWith(`${encodeURIComponent(summary.receptorChain)}:`) ||
      typeof entry.coordinateLabel !== "string" || !entry.coordinateLabel || entry.coordinateLabel.length > 500 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(entry.coordinateLabel) ||
      !Number.isSafeInteger(entry.sequenceOrder) || entry.sequenceOrder <= 0 ||
      observedKeys.has(entry.residueKey) || observedOrders.has(entry.sequenceOrder) ||
      observedCanonicalIdentifiers.has(entry.canonicalIdentifier)
    ) {
      throw new Error("User-defined footprint observed-residue records are invalid or duplicated.");
    }
    observedKeys.add(entry.residueKey);
    observedOrders.add(entry.sequenceOrder);
    observedCanonicalIdentifiers.add(entry.canonicalIdentifier);
  }
  for (let index = 1; index < summary.observedReceptorFootprint.length; index += 1) {
    if (summary.observedReceptorFootprint[index - 1].sequenceOrder >= summary.observedReceptorFootprint[index].sequenceOrder) {
      throw new Error("User-defined footprint observed residues are not in deterministic sequence order.");
    }
  }
  const observedContactedCount = summary.mapped.filter((entry) => entry.contacted).length;
  if (
    observedContactedCount !== summary.contactedCount ||
    summary.mapped.some((entry) => entry.contacted !== observedKeys.has(entry.residueKey)) ||
    summary.mapped.some((entry) => {
      const observed = summary.observedReceptorFootprint.find((candidate) => candidate.residueKey === entry.residueKey);
      return observed != null && (
        observed.canonicalIdentifier !== entry.canonicalIdentifier ||
        observed.coordinateLabel !== entry.coordinateLabel ||
        observed.sequenceOrder !== entry.sequenceOrder
      );
    })
  ) {
    throw new Error("User-defined footprint contacted records do not reconcile with the observed footprint.");
  }
  const expectedShare = summary.mappedCount ? summary.contactedCount / summary.mappedCount : null;
  if (
    (expectedShare == null && summary.mappedContactShare != null) ||
    (expectedShare != null && (
      !Number.isFinite(summary.mappedContactShare) ||
      Math.abs((summary.mappedContactShare as number) - expectedShare) > 1e-12
    ))
  ) {
    throw new Error("User-defined footprint overlap share does not reconcile with mapped contacts.");
  }
}

export function normalizeIntendedFootprintIdentifiers(input: string): string[] {
  if (typeof input !== "string") throw new Error("Intended footprint input must be text.");
  if (input.length > MAX_USER_FOOTPRINT_CHARACTERS) {
    throw new Error("Intended footprint input exceeds the 1,000-character limit.");
  }
  const identifiers = input
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .split(/[,;\s]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
  const unique = [...new Set(identifiers)];
  if (unique.length > MAX_USER_FOOTPRINT_RESIDUES) {
    throw new Error(`Intended footprint input exceeds ${MAX_USER_FOOTPRINT_RESIDUES} unique residue identifiers.`);
  }
  return unique;
}

export function analyzeIntendedFootprint(
  structure: ParsedStructure,
  receptorChainId: string,
  audit: InterfaceAudit,
  input: string,
): IntendedFootprintSummary {
  const receptor = structure.chains.find((chain) => chain.id === receptorChainId);
  if (!receptor) throw new Error("The intended footprint receptor chain is absent from the structure.");
  if (audit.receptorChain !== receptorChainId) {
    throw new Error("The intended footprint chain does not match the completed interface audit.");
  }
  const requested = normalizeIntendedFootprintIdentifiers(input);
  const contactedKeys = new Set(audit.receptorInterfaceKeys);
  const aliases = new Map<string, typeof receptor.residues>();
  const addAlias = (alias: string, residue: typeof receptor.residues[number]) => {
    const current = aliases.get(alias) ?? [];
    if (!current.includes(residue)) current.push(residue);
    aliases.set(alias, current);
  };
  for (const residue of receptor.residues) {
    const number = `${residue.number}${residue.insertionCode}`;
    const canonicalIdentifier = `${encodeURIComponent(receptor.id)}:${number}`;
    addAlias(residue.key, residue);
    addAlias(canonicalIdentifier, residue);
    addAlias(`${receptor.id}:${number}`, residue);
    addAlias(number, residue);
    addAlias(`order:${residue.order}`, residue);
    if (receptor.authAsymId && residue.authSequenceId != null) {
      addAlias(`auth:${encodeURIComponent(receptor.authAsymId)}:${residue.authSequenceId}${residue.insertionCode}`, residue);
    }
    if (receptor.labelAsymId && residue.labelSequenceId != null) {
      addAlias(`label:${encodeURIComponent(receptor.labelAsymId)}:${residue.labelSequenceId}`, residue);
    }
  }

  const mapped: IntendedFootprintMapping[] = [];
  const duplicateAliases: IntendedFootprintAlias[] = [];
  const unmapped: string[] = [];
  const canonicalIdentifierByResidueKey = new Map<string, string>();
  for (const identifier of requested) {
    const candidates = aliases.get(identifier) ?? [];
    if (candidates.length !== 1) {
      unmapped.push(identifier);
      continue;
    }
    const residue = candidates[0];
    const canonicalRequestedIdentifier = canonicalIdentifierByResidueKey.get(residue.key);
    if (canonicalRequestedIdentifier) {
      duplicateAliases.push({
        requestedIdentifier: identifier,
        residueKey: residue.key,
        canonicalIdentifier: `${encodeURIComponent(receptor.id)}:${residue.number}${residue.insertionCode}`,
        canonicalRequestedIdentifier,
      });
      continue;
    }
    canonicalIdentifierByResidueKey.set(residue.key, identifier);
    mapped.push({
      requestedIdentifier: identifier,
      residueKey: residue.key,
      canonicalIdentifier: `${encodeURIComponent(receptor.id)}:${residue.number}${residue.insertionCode}`,
      coordinateLabel: `${residue.name} ${receptor.id}:${residue.number}${residue.insertionCode}`,
      sequenceOrder: residue.order,
      contacted: contactedKeys.has(residue.key),
    });
  }
  mapped.sort((left, right) => left.sequenceOrder - right.sequenceOrder ||
    codeUnitCompare(left.requestedIdentifier, right.requestedIdentifier));
  const contactedCount = mapped.filter((entry) => entry.contacted).length;
  const observedReceptorFootprint = receptor.residues
    .filter((residue) => contactedKeys.has(residue.key))
    .map((residue) => ({
      residueKey: residue.key,
      canonicalIdentifier: `${encodeURIComponent(receptor.id)}:${residue.number}${residue.insertionCode}`,
      coordinateLabel: `${residue.name} ${receptor.id}:${residue.number}${residue.insertionCode}`,
      sequenceOrder: residue.order,
    }));
  return {
    receptorChain: receptorChainId,
    requestedCount: requested.length,
    mappedCount: mapped.length,
    contactedCount,
    mappedContactShare: mapped.length ? contactedCount / mapped.length : null,
    mapped,
    duplicateAliases,
    unmapped,
    observedReceptorFootprint,
    interpretation: USER_FOOTPRINT_INTERPRETATION,
  };
}

export function observedFootprintIdentifiers(summary: IntendedFootprintSummary): string {
  return summary.observedReceptorFootprint.map((entry) => entry.canonicalIdentifier).join(", ");
}
