"use client";

import { useMemo, useState } from "react";
import { Download, Search, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  auditContactsToCsv,
  filterAuditContacts,
  type ContactEvidenceFilter,
  type ContactRegionFilter,
  type ContactSort,
} from "@/lib/contact-explorer";
import type { InterfaceAudit } from "@/lib/confovhh";

const PAGE_SIZE = 50;

export function ContactExplorer({
  audit,
  onDownload,
}: {
  audit: InterfaceAudit;
  onDownload: (content: string, mimeType: string, filename: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [evidence, setEvidence] = useState<ContactEvidenceFilter>("all");
  const [region, setRegion] = useState<ContactRegionFilter>("all");
  const [sort, setSort] = useState<ContactSort>("distance");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => filterAuditContacts(audit.contacts, {
    query,
    evidence,
    region,
    sort,
  }), [audit.contacts, evidence, query, region, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const activePage = Math.min(page, pageCount);
  const visible = filtered.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE);
  const updateFilter = (setter: () => void) => {
    setter();
    setPage(1);
  };

  return (
    <section className="panel evidence-table-panel contact-explorer" id="contact-explorer" aria-labelledby="contact-explorer-title">
      <div className="panel-heading compact contact-heading">
        <div>
          <p className="eyebrow">Interface footprint</p>
          <h2 id="contact-explorer-title">Contact explorer</h2>
          <p>Filter the complete residue-contact ledger; exports always use the selected filtered view.</p>
        </div>
        <div className="contact-heading-actions">
          <Badge variant="secondary">{filtered.length} of {audit.contacts.length} pairs</Badge>
          <Button
            variant="outline"
            size="sm"
            disabled={!filtered.length}
            onClick={() => onDownload(
              auditContactsToCsv(filtered),
              "text/csv;charset=utf-8",
              "confovhh_contacts.csv",
            )}
          >
            <Download /> Contacts CSV
          </Button>
        </div>
      </div>

      <div className="contact-filters" aria-label="Contact filters">
        <label className="contact-search">
          <span className="sr-only">Search residue contacts</span>
          <Search aria-hidden="true" />
          <Input
            type="search"
            value={query}
            placeholder="Search residue, IMGT position, or evidence"
            onChange={(event) => updateFilter(() => setQuery(event.target.value))}
          />
        </label>
        <label>
          <span className="sr-only">Geometry evidence filter</span>
          <Select value={evidence} onValueChange={(value) => updateFilter(() => setEvidence(value as ContactEvidenceFilter))}>
            <SelectTrigger aria-label="Geometry evidence filter"><SlidersHorizontal /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All geometry evidence</SelectItem>
              <SelectItem value="severe-overlap">Severe overlaps</SelectItem>
              <SelectItem value="polar">Potential polar</SelectItem>
              <SelectItem value="salt-bridge">Salt-bridge proxies</SelectItem>
              <SelectItem value="disulfide">Possible disulfides</SelectItem>
              <SelectItem value="close-contact">Close contacts</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label>
          <span className="sr-only">VHH region filter</span>
          <Select value={region} onValueChange={(value) => updateFilter(() => setRegion(value as ContactRegionFilter))}>
            <SelectTrigger aria-label="VHH region filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All VHH regions</SelectItem>
              <SelectItem value="CDR1-IMGT">CDR1-IMGT</SelectItem>
              <SelectItem value="CDR2-IMGT">CDR2-IMGT</SelectItem>
              <SelectItem value="CDR3-IMGT">CDR3-IMGT</SelectItem>
              <SelectItem value="framework">Framework regions</SelectItem>
              <SelectItem value="Unnumbered">Unnumbered</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label>
          <span className="sr-only">Contact sort order</span>
          <Select value={sort} onValueChange={(value) => updateFilter(() => setSort(value as ContactSort))}>
            <SelectTrigger aria-label="Contact sort order"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="distance">Closest first</SelectItem>
              <SelectItem value="receptor-order">Receptor order</SelectItem>
              <SelectItem value="vhh-order">VHH order</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      {visible.length ? (
        <Table containerLabel="Scrollable filtered receptor–VHH residue-contact table">
          <TableHeader>
            <TableRow>
              <TableHead>Receptor residue</TableHead>
              <TableHead>VHH residue</TableHead>
              <TableHead>IMGT position</TableHead>
              <TableHead>VHH region</TableHead>
              <TableHead>Minimum distance</TableHead>
              <TableHead>Geometry evidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((contact) => (
              <TableRow key={`${contact.receptorResidueOrder}:${contact.vhhResidueOrder}`}>
                <TableCell className="mono-cell">{contact.receptorResidue}</TableCell>
                <TableCell className="mono-cell">{contact.vhhResidue}</TableCell>
                <TableCell className="mono-cell">{contact.vhhImgtPosition ?? "—"}</TableCell>
                <TableCell>{contact.vhhRegion}</TableCell>
                <TableCell className="mono-cell">{contact.minimumDistance.toFixed(2)} Å</TableCell>
                <TableCell>
                  <div className="contact-tags">
                    {contact.contactTypes.map((type) => <span key={type}>{type}</span>)}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="contact-empty" role="status">
          <Search />
          <div><strong>No contacts match these filters</strong><p>Clear or broaden the search, evidence, and VHH-region filters.</p></div>
        </div>
      )}

      {pageCount > 1 && (
        <nav className="contact-pagination" aria-label="Contact result pages">
          <Button variant="outline" size="sm" disabled={activePage === 1} onClick={() => setPage(activePage - 1)}>Previous</Button>
          <span>Page {activePage} of {pageCount}</span>
          <Button variant="outline" size="sm" disabled={activePage === pageCount} onClick={() => setPage(activePage + 1)}>Next</Button>
        </nav>
      )}
    </section>
  );
}
