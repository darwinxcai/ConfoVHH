import type { InterfaceAudit } from "./confovhh.ts";

export type ContactEvidenceFilter =
  | "all"
  | "severe-overlap"
  | "polar"
  | "salt-bridge"
  | "disulfide"
  | "close-contact";

export type ContactRegionFilter =
  | "all"
  | "CDR1-IMGT"
  | "CDR2-IMGT"
  | "CDR3-IMGT"
  | "framework"
  | "Unnumbered";

export type ContactSort = "distance" | "receptor-order" | "vhh-order";

export interface ContactExplorerFilter {
  query: string;
  evidence: ContactEvidenceFilter;
  region: ContactRegionFilter;
  sort: ContactSort;
}

function normalizedQuery(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function evidenceMatches(
  contact: InterfaceAudit["contacts"][number],
  evidence: ContactEvidenceFilter,
): boolean {
  if (evidence === "all") return true;
  const expected: Record<Exclude<ContactEvidenceFilter, "all">, string> = {
    "severe-overlap": "severe vdW overlap",
    polar: "potential polar contact",
    "salt-bridge": "salt-bridge proxy",
    disulfide: "possible interchain disulfide",
    "close-contact": "close contact",
  };
  return contact.contactTypes.includes(expected[evidence]);
}

function regionMatches(
  contact: InterfaceAudit["contacts"][number],
  region: ContactRegionFilter,
): boolean {
  if (region === "all") return true;
  if (region === "framework") return contact.vhhRegion.startsWith("FR");
  return contact.vhhRegion === region;
}

export function filterAuditContacts(
  contacts: readonly InterfaceAudit["contacts"][number][],
  filter: ContactExplorerFilter,
): InterfaceAudit["contacts"] {
  if (!Array.isArray(contacts)) throw new Error("Contact explorer requires an array of contact records.");
  const query = normalizedQuery(filter.query);
  const selected = contacts.filter((contact) => {
    if (!evidenceMatches(contact, filter.evidence) || !regionMatches(contact, filter.region)) return false;
    if (!query) return true;
    const searchable = [
      contact.receptorResidue,
      contact.vhhResidue,
      contact.receptorResidueName,
      contact.vhhResidueName,
      contact.vhhImgtPosition ?? "",
      contact.vhhRegion,
      ...contact.contactTypes,
    ].join(" ").toLocaleLowerCase("en-US");
    return searchable.includes(query);
  });
  return [...selected].sort((left, right) => {
    if (filter.sort === "receptor-order") {
      return left.receptorResidueOrder - right.receptorResidueOrder ||
        left.vhhResidueOrder - right.vhhResidueOrder;
    }
    if (filter.sort === "vhh-order") {
      return left.vhhResidueOrder - right.vhhResidueOrder ||
        left.receptorResidueOrder - right.receptorResidueOrder;
    }
    return left.minimumDistance - right.minimumDistance ||
      left.receptorResidueOrder - right.receptorResidueOrder ||
      left.vhhResidueOrder - right.vhhResidueOrder;
  });
}

function safeCsvCell(value: string | number | null): string {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Contact CSV cannot represent a non-finite number.");
  }
  let text = value == null ? "" : String(value);
  text = text
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ");
  if (/^[\s]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function auditContactsToCsv(
  contacts: readonly InterfaceAudit["contacts"][number][],
): string {
  const headers = [
    "receptor_residue",
    "receptor_sequence_order",
    "vhh_residue",
    "vhh_sequence_order",
    "vhh_imgt_position",
    "vhh_region",
    "minimum_distance_angstrom",
    "geometry_evidence",
    "receptor_confidence",
    "vhh_confidence",
  ];
  const rows = contacts.map((contact) => [
    contact.receptorResidue,
    contact.receptorResidueOrder,
    contact.vhhResidue,
    contact.vhhResidueOrder,
    contact.vhhImgtPosition,
    contact.vhhRegion,
    contact.minimumDistance,
    contact.contactTypes.join("; "),
    contact.receptorConfidence,
    contact.vhhConfidence,
  ].map(safeCsvCell).join(","));
  return [headers.map(safeCsvCell).join(","), ...rows].join("\r\n");
}
