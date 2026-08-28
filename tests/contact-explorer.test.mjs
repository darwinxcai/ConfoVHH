import assert from "node:assert/strict";
import test from "node:test";

import {
  auditContactsToCsv,
  filterAuditContacts,
} from "../lib/contact-explorer.ts";

function contact(overrides = {}) {
  return {
    receptorResidue: "GLU R:100",
    receptorResidueName: "GLU",
    receptorResidueOrder: 100,
    vhhResidue: "ARG V:30",
    vhhResidueName: "ARG",
    vhhResidueOrder: 30,
    vhhImgtPosition: "30",
    vhhRegion: "CDR1-IMGT",
    minimumDistance: 3.2,
    contactTypes: ["salt-bridge proxy", "potential polar contact"],
    receptorConfidence: null,
    vhhConfidence: null,
    ...overrides,
  };
}

const contacts = [
  contact(),
  contact({
    receptorResidue: "ALA R:20",
    receptorResidueName: "ALA",
    receptorResidueOrder: 20,
    vhhResidue: "TRP V:105",
    vhhResidueName: "TRP",
    vhhResidueOrder: 105,
    vhhImgtPosition: "105",
    vhhRegion: "CDR3-IMGT",
    minimumDistance: 2.1,
    contactTypes: ["severe vdW overlap"],
  }),
  contact({
    receptorResidue: "LEU R:50",
    receptorResidueName: "LEU",
    receptorResidueOrder: 50,
    vhhResidue: "SER V:45",
    vhhResidueName: "SER",
    vhhResidueOrder: 45,
    vhhImgtPosition: "45",
    vhhRegion: "FR2-IMGT",
    minimumDistance: 4.2,
    contactTypes: ["close contact"],
  }),
];

test("filters complete contact evidence by query, geometry, and IMGT region", () => {
  const severe = filterAuditContacts(contacts, {
    query: "TRP",
    evidence: "severe-overlap",
    region: "CDR3-IMGT",
    sort: "distance",
  });
  assert.equal(severe.length, 1);
  assert.equal(severe[0].vhhResidueOrder, 105);

  const framework = filterAuditContacts(contacts, {
    query: "",
    evidence: "all",
    region: "framework",
    sort: "distance",
  });
  assert.equal(framework.length, 1);
  assert.equal(framework[0].vhhRegion, "FR2-IMGT");
});

test("sorts contacts deterministically by distance or sequence order", () => {
  const base = { query: "", evidence: "all", region: "all" };
  assert.deepEqual(
    filterAuditContacts(contacts, { ...base, sort: "distance" }).map((value) => value.minimumDistance),
    [2.1, 3.2, 4.2],
  );
  assert.deepEqual(
    filterAuditContacts(contacts, { ...base, sort: "receptor-order" }).map((value) => value.receptorResidueOrder),
    [20, 50, 100],
  );
  assert.deepEqual(
    filterAuditContacts(contacts, { ...base, sort: "vhh-order" }).map((value) => value.vhhResidueOrder),
    [30, 45, 105],
  );
});

test("contact CSV exports every filtered field and neutralizes spreadsheet controls", () => {
  const malicious = contact({
    receptorResidue: "\u200B=HYPERLINK(\"https://example.invalid\")",
    vhhResidue: "\u0000+CMD",
  });
  const csv = auditContactsToCsv([malicious]);
  assert.match(csv, /receptor_sequence_order/);
  assert.match(csv, /geometry_evidence/);
  assert.doesNotMatch(csv.replace(/\r\n/g, ""), /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
  assert.match(csv, /' =HYPERLINK/);
  assert.match(csv, /' \+CMD/);
  assert.throws(
    () => auditContactsToCsv([contact({ minimumDistance: Number.NaN })]),
    /non-finite/i,
  );
});
