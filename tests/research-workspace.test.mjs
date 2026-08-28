import assert from "node:assert/strict";
import test from "node:test";

import { createSingleAuditExportReport } from "../lib/audit-export.ts";
import { analyzeInterface, parsePdb } from "../lib/confovhh.ts";
import { analyzeIntendedFootprint } from "../lib/user-footprint.ts";

import {
  CONFOVHH_PRODUCT_RELEASE,
  createHandoffMarkdown,
  createNotebookEntry,
  createNotebookExport,
  createWorkspaceBundle,
  deriveCoordinateTriageBrief,
  normalizeNotebookEntries,
  normalizeResearchContext,
  parseNotebookExport,
  parseWorkspaceBundle,
  upsertNotebookEntry,
} from "../lib/research-workspace.ts";

const SHA256 = "a".repeat(64);
const PAE_SHA256 = "b".repeat(64);
const GENERATED_AT = "2026-08-27T12:34:56.000Z";

function atomLine({ serial, atomName, chain, residueNumber, x, y, z, element }) {
  return [
    "ATOM  ", String(serial).padStart(5), " ", atomName.padStart(4), " ", "ALA", " ", chain,
    String(residueNumber).padStart(4), "    ", x.toFixed(3).padStart(8), y.toFixed(3).padStart(8),
    z.toFixed(3).padStart(8), "  1.00", "80.00", "          ", element.padStart(2),
  ].join("");
}

function coordinateFixture({ withPae = false, title = null } = {}) {
  const lines = ["TITLE     PRODUCT WORKSPACE FIXTURE"];
  let serial = 1;
  for (const [chain, y] of [["R", 0], ["V", 3.4]]) {
    for (let residueNumber = 1; residueNumber <= 4; residueNumber += 1) {
      const x = residueNumber * 3.8;
      lines.push(atomLine({ serial: serial++, atomName: "N", chain, residueNumber, x: x - 1.1, y, z: 0, element: "N" }));
      lines.push(atomLine({ serial: serial++, atomName: "CA", chain, residueNumber, x, y, z: 0, element: "C" }));
      lines.push(atomLine({ serial: serial++, atomName: "C", chain, residueNumber, x: x + 1.1, y, z: 0.2, element: "C" }));
      lines.push(atomLine({ serial: serial++, atomName: "O", chain, residueNumber, x: x + 1.4, y: y + 0.7, z: 0.4, element: "O" }));
    }
  }
  lines.push("END");
  const text = lines.join("\n");
  const structure = parsePdb(text);
  if (title != null) structure.title = title;
  const residueCount = structure.chains.reduce((sum, chain) => sum + chain.residueCount, 0);
  const pae = withPae ? {
    matrix: new Float32Array(residueCount * residueCount).fill(3),
    residueCount,
    maxPaeAngstrom: 3,
    sourceFormat: "raw matrix",
    filename: "candidate_scores.json",
  } : null;
  const interfaceAudit = analyzeInterface(structure, "R", "V", "none", pae, withPae);
  const report = createSingleAuditExportReport({
    filename: "candidate.pdb",
    coordinateSha256: SHA256,
    coordinateBytes: new TextEncoder().encode(text).byteLength,
    structure,
    receptorChain: "R",
    vhhChain: "V",
    chainIdentityConfirmed: true,
    pae,
    paeSha256: withPae ? PAE_SHA256 : null,
    paeOrderConfirmed: withPae,
    audit: interfaceAudit,
    generatedAt: GENERATED_AT,
  });
  return { text, structure, interfaceAudit, report };
}

function audit(overrides = {}) {
  return {
    evidenceLevel: "supported",
    findings: [
      { level: "supported", label: "Interface extent", evidence: "Observed", action: "Retain for comparison." },
    ],
    contactPairCount: 12,
    severeClashCount: 0,
    deltaSasaAngstrom2: 900,
    paratopeProxyShare: 0.75,
    cdr3ProxyShare: 0.5,
    interfacePaeMedianAngstrom: null,
    ...overrides,
  };
}

const workflow = {
  paeAttached: false,
  ensemblePoseCount: 1,
  pairedContextCompared: false,
};

function context(overrides = {}) {
  return {
    studyName: "β2AR screen",
    receptorName: "ADRB2",
    candidateId: "VHH-042",
    coordinateContext: "agonist model",
    intendedFootprint: "",
    notes: "Review in lab meeting.",
    ...overrides,
  };
}

function canonicalReport() {
  return coordinateFixture().report;
}

test("normalizes bounded study metadata without invisible controls", () => {
  const normalized = normalizeResearchContext(context({
    candidateId: "  VHH\u200B-042\u0000  ",
    notes: `line 1\n  line 2${"x".repeat(2_000)}`,
  }));
  assert.equal(normalized.candidateId, "VHH -042");
  assert.equal(normalized.notes.length, 1_000);
  assert.doesNotMatch(JSON.stringify(normalized), /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
});

test("derives conservative coordinate decisions for every evidence band", () => {
  const expected = new Map([
    ["supported", "retain-for-comparison"],
    ["mixed", "review-before-comparison"],
    ["limited", "deprioritize-coordinate-pose"],
    ["not-assessable", "not-assessable"],
  ]);
  for (const [evidenceLevel, band] of expected) {
    const brief = deriveCoordinateTriageBrief(audit({ evidenceLevel }), workflow);
    assert.equal(brief.band, band);
    assert.match(brief.boundary, /does not establish binding/i);
    assert.ok(brief.evidenceGaps.some((item) => /experimental/i.test(item)));
    assert.ok(brief.nextActions.some((item) => /experiment/i.test(item)));
    assert.doesNotMatch(brief.title, /best binder|experiment-ready|active-compatible/i);
  }
});

test("coordinate review actions are tied to observed gaps and flags", () => {
  const brief = deriveCoordinateTriageBrief(audit({
    evidenceLevel: "mixed",
    severeClashCount: 3,
    paratopeProxyShare: 0.2,
    findings: [{ level: "review", label: "Sterics", evidence: "Three", action: "Inspect overlaps." }],
  }), workflow);
  assert.deepEqual(brief.reviewItems, ["Sterics: Inspect overlaps."]);
  assert.ok(brief.nextActions.some((item) => /severe overlap/i.test(item)));
  assert.ok(brief.nextActions.some((item) => /framework-dominated/i.test(item)));
  assert.ok(brief.nextActions.some((item) => /multiple seeds/i.test(item)));
});

test("local notebook entries contain allowlisted summaries and exact selection provenance", () => {
  const report = canonicalReport();
  const entry = createNotebookEntry({
    singleAuditReport: report,
    context: context(),
    workflow,
    savedAt: GENERATED_AT,
  });
  assert.deepEqual(entry.privacy, {
    rawCoordinatesAutomaticallyCopied: false,
    parsedSequencesAutomaticallyCopied: false,
    paeMatrixAutomaticallyCopied: false,
    residueContactTableAutomaticallyCopied: false,
    userEnteredContextStored: true,
  });
  assert.equal(entry.coordinate.selectedModelId, report.structure.selectedModelId);
  assert.equal(entry.coordinate.selectedCoordinateFingerprint, report.structure.selectedCoordinateFingerprint);
  assert.equal(entry.coordinate.auditInputFingerprint, report.audit.auditAttestation.inputFingerprint);
  const serialized = JSON.stringify(entry);
  assert.doesNotMatch(serialized, /"atoms":|"matrix":|"sequence":|AutomaticallyCopied":true/);

  const replacement = createNotebookEntry({
    singleAuditReport: report,
    context: context({ candidateId: "VHH-042-revised" }),
    workflow,
    savedAt: "2026-08-27T12:35:56.000Z",
  });
  const upserted = upsertNotebookEntry([entry], replacement);
  assert.equal(upserted.length, 1);
  assert.equal(upserted[0].context.candidateId, "VHH-042-revised");
  assert.equal(normalizeNotebookEntries([entry, replacement]).length, 1);
});

test("notebook export round-trips atomically and rejects malformed entries", () => {
  const entry = createNotebookEntry({
    singleAuditReport: canonicalReport(),
    context: context(),
    workflow,
    savedAt: GENERATED_AT,
  });
  const exported = createNotebookExport([entry], GENERATED_AT);
  assert.deepEqual(parseNotebookExport(JSON.stringify(exported)), [entry]);
  assert.throws(() => createNotebookExport([entry, entry], GENERATED_AT), /duplicate/i);
  const invalidRuntimeEntry = structuredClone(entry);
  invalidRuntimeEntry.rawCoordinates = "ATOM SECRET";
  assert.throws(() => createNotebookExport([invalidRuntimeEntry], GENERATED_AT), /invalid/i);
  const corrupted = structuredClone(exported);
  corrupted.entries[0].metrics.deltaSasaAngstrom2 = Number.NaN;
  assert.throws(() => parseNotebookExport(JSON.stringify(corrupted)), /invalid|non-finite/i);
  const smuggled = structuredClone(exported);
  smuggled.entries[0].rawCoordinates = "ATOM SECRET";
  assert.throws(() => parseNotebookExport(JSON.stringify(smuggled)), /invalid|unsupported/i);
  const renderBomb = structuredClone(exported);
  renderBomb.entries[0].triage.title = { persistent: true };
  assert.throws(() => parseNotebookExport(JSON.stringify(renderBomb)), /invalid/i);
  const forgedIdentity = structuredClone(exported);
  forgedIdentity.entries[0].coordinate.selectedModelId = "forged-model";
  assert.throws(() => parseNotebookExport(JSON.stringify(forgedIdentity)), /identity|invalid/i);
  assert.throws(() => parseNotebookExport('{"schemaVersion":"9.0.0","entries":[]}'), /incompatible|unsupported/i);
});

test("v0.8 emits current records while importing intact v0.6 and v0.7 notebook records", () => {
  const currentEntry = createNotebookEntry({
    singleAuditReport: canonicalReport(),
    context: context(),
    workflow,
    savedAt: GENERATED_AT,
  });
  const currentExport = createNotebookExport([currentEntry], GENERATED_AT);
  assert.equal(currentEntry.productRelease, "0.8.0");
  assert.equal(currentExport.productRelease, "0.8.0");

  const legacyExport = structuredClone(currentExport);
  legacyExport.productRelease = "0.6.0";
  legacyExport.entries[0].productRelease = "0.6.0";
  const imported = parseNotebookExport(JSON.stringify(legacyExport));
  assert.equal(imported.length, 1);
  assert.equal(imported[0].productRelease, "0.6.0");

  const mixedExport = structuredClone(currentExport);
  mixedExport.productRelease = "0.6.0";
  assert.equal(parseNotebookExport(JSON.stringify(mixedExport))[0].productRelease, "0.8.0");

  const unsupported = structuredClone(currentExport);
  unsupported.productRelease = "0.5.0";
  assert.throws(() => parseNotebookExport(JSON.stringify(unsupported)), /incompatible/i);
});

test("workspace dossier round-trips validated reports and rejects provenance drift", () => {
  const fixture = coordinateFixture();
  const intendedFootprint = "R:1, R:4";
  const footprint = analyzeIntendedFootprint(
    fixture.structure,
    "R",
    fixture.interfaceAudit,
    intendedFootprint,
  );
  const bundle = createWorkspaceBundle({
    context: context({ intendedFootprint }),
    userDefinedFootprint: footprint,
    singleAuditReport: fixture.report,
    generatedAt: GENERATED_AT,
  });
  assert.equal(bundle.productRelease, CONFOVHH_PRODUCT_RELEASE);
  assert.deepEqual(bundle.userDefinedFootprint, footprint);
  assert.deepEqual(parseWorkspaceBundle(JSON.stringify(bundle)), bundle);

  const drifted = structuredClone(bundle);
  drifted.reports.singleAudit.structure.sourceFileSha256 = "b".repeat(64);
  assert.throws(() => parseWorkspaceBundle(JSON.stringify(drifted)), /provenance|coordinate|attestation/i);

  const fabricatedDecision = structuredClone(bundle);
  fabricatedDecision.decisionBrief.band = "deprioritize-coordinate-pose";
  assert.throws(() => parseWorkspaceBundle(JSON.stringify(fabricatedDecision)), /decision brief/i);

  const fabricatedWorkflow = structuredClone(bundle);
  fabricatedWorkflow.workflow.ensemblePoseCount = 12;
  assert.throws(() => parseWorkspaceBundle(JSON.stringify(fabricatedWorkflow)), /workflow coverage/i);

  const mismatchedFootprintContext = structuredClone(bundle);
  mismatchedFootprintContext.context.intendedFootprint = "R:2";
  assert.throws(() => parseWorkspaceBundle(JSON.stringify(mismatchedFootprintContext)), /requested identifiers/i);

  const falsifiedFootprintMetadata = structuredClone(bundle);
  const observed = falsifiedFootprintMetadata.userDefinedFootprint.observedReceptorFootprint[0];
  observed.canonicalIdentifier = "R:999";
  const correspondingMapped = falsifiedFootprintMetadata.userDefinedFootprint.mapped
    .find((entry) => entry.residueKey === observed.residueKey);
  if (correspondingMapped) correspondingMapped.canonicalIdentifier = observed.canonicalIdentifier;
  assert.throws(() => parseWorkspaceBundle(JSON.stringify(falsifiedFootprintMetadata)), /residue metadata|canonical/i);

  const future = structuredClone(bundle);
  future.schemaVersion = "9.0.0";
  assert.throws(() => parseWorkspaceBundle(JSON.stringify(future)), /incompatible/i);

  const unsafe = JSON.stringify(bundle).replace('"context":{', '"context":{"__proto__":{},');
  assert.throws(() => parseWorkspaceBundle(unsafe), /unsafe/i);
});

test("v0.8 emits current dossiers while importing intact v0.6 and v0.7 dossiers", () => {
  const current = createWorkspaceBundle({
    context: context(),
    singleAuditReport: canonicalReport(),
    generatedAt: GENERATED_AT,
  });
  assert.equal(current.productRelease, "0.8.0");

  const legacy = structuredClone(current);
  legacy.productRelease = "0.6.0";
  assert.equal(parseWorkspaceBundle(JSON.stringify(legacy)).productRelease, "0.8.0");

  const unsupported = structuredClone(current);
  unsupported.productRelease = "0.5.0";
  assert.throws(() => parseWorkspaceBundle(JSON.stringify(unsupported)), /incompatible/i);
});

test("workspace dossier rejects false fixed-policy and parser provenance while accepting multiline metadata", () => {
  const canonical = createWorkspaceBundle({
    context: context(),
    singleAuditReport: coordinateFixture({ title: "A canonical multiline\ncoordinate title" }).report,
    generatedAt: GENERATED_AT,
  });
  assert.deepEqual(parseWorkspaceBundle(JSON.stringify(canonical)), canonical);

  const mutations = [
    (bundle) => { bundle.reports.singleAudit.file = "candidate\u202E.pdb"; },
    (bundle) => { bundle.reports.singleAudit.structure.coordinateProvenance = "experimentally proven binder"; },
    (bundle) => { bundle.reports.singleAudit.structure.fingerprintPolicy.decisionBoundary = "Cryptographic proof of binding"; },
    (bundle) => { bundle.reports.singleAudit.structure.availableAssemblies = "anything"; },
    (bundle) => { bundle.reports.singleAudit.structure.parserDiagnostics.malformedAtomRecords = -1; },
    (bundle) => { bundle.reports.singleAudit.structure.selectedAssembly = {}; },
    (bundle) => { bundle.reports.singleAudit.structure.experimentalMethod = { forged: true }; },
    (bundle) => { bundle.reports.singleAudit.structure.modelPolicy = "All models were biologically validated."; },
  ];
  for (const mutate of mutations) {
    const falsified = structuredClone(canonical);
    mutate(falsified);
    assert.throws(() => parseWorkspaceBundle(JSON.stringify(falsified)), /invalid|policy|provenance|assembly|diagnostic|description/i);
  }
});

test("workspace dossier rejects PAE convention and selected-chain mapping drift", () => {
  const { report } = coordinateFixture({ withPae: true });
  const bundle = createWorkspaceBundle({
    context: context(),
    singleAuditReport: report,
    generatedAt: GENERATED_AT,
  });
  assert.deepEqual(parseWorkspaceBundle(JSON.stringify(bundle)), bundle);

  const swappedBlocks = structuredClone(bundle);
  for (const entry of swappedBlocks.reports.singleAudit.pae.residueIndexMap) {
    entry.chainId = entry.chainId === "R" ? "V" : entry.chainId === "V" ? "R" : entry.chainId;
  }
  assert.throws(() => parseWorkspaceBundle(JSON.stringify(swappedBlocks)), /PAE.*contact ledger|PAE.*provenance/i);

  const driftedConvention = structuredClone(bundle);
  driftedConvention.reports.singleAudit.pae.directionConvention = "row is evaluated; column is alignment frame";
  assert.throws(() => parseWorkspaceBundle(JSON.stringify(driftedConvention)), /PAE provenance/i);
});

test("workspace dossier rejects non-finite nested report values before export", () => {
  const report = canonicalReport();
  report.audit.deltaSasaAngstrom2 = Number.NaN;
  assert.throws(() => createWorkspaceBundle({
    context: context(),
    singleAuditReport: report,
    generatedAt: GENERATED_AT,
  }), /non-finite/i);
});

test("human handoff includes provenance, next checks, and explicit claim limits", () => {
  const report = canonicalReport();
  const markdown = createHandoffMarkdown({
    singleAuditReport: report,
    context: context({ notes: "Test *without* overclaim." }),
    workflow,
    generatedAt: GENERATED_AT,
  });
  assert.match(markdown, /# ConfoVHH coordinate-triage handoff/);
  assert.match(markdown, new RegExp(SHA256));
  assert.match(markdown, /Selected model:/);
  assert.match(markdown, /Selected-coordinate fingerprint:/);
  assert.match(markdown, /Audit-input fingerprint:/);
  assert.match(markdown, /Validate retained candidates experimentally/);
  assert.match(markdown, /does not establish binding/i);
  assert.ok(markdown.includes("Test \\*without\\* overclaim\\."));

  const fixture = coordinateFixture();
  const footprint = analyzeIntendedFootprint(fixture.structure, "R", fixture.interfaceAudit, "R:1");
  assert.throws(() => createHandoffMarkdown({
    singleAuditReport: fixture.report,
    context: context({ intendedFootprint: "R:2" }),
    workflow,
    userDefinedFootprint: footprint,
    generatedAt: GENERATED_AT,
  }), /requested identifiers/i);
});
