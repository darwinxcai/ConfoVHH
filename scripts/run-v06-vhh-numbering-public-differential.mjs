import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeInterface, parsePdb } from "../lib/confovhh.ts";
import { numberVhhSequence } from "../lib/vhh-numbering.ts";
import {
  VHH_NUMBERING_V06_CANDIDATE_VERSION,
  numberVhhSequenceV06,
} from "../lib/vhh-numbering-v06.ts";
import { downloadPublicCoordinate } from "./public-coordinate-download.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASELINE_PATH = path.join(
  ROOT,
  "validation",
  "v0.5-public-regression-attestation-v1",
  "native-interfaces.json",
);
const DEFAULT_OUTPUT_PATH = path.join(
  ROOT,
  "validation",
  "v0.6-vhh-numbering-candidate-v1",
  "public-panel-differential.json",
);
const CDR_REGIONS = new Set(["CDR1-IMGT", "CDR2-IMGT", "CDR3-IMGT"]);
const REPORTED_REGIONS = [
  "FR1-IMGT",
  "CDR1-IMGT",
  "FR2-IMGT",
  "CDR2-IMGT",
  "FR3-IMGT",
  "CDR3-IMGT",
  "FR4-IMGT",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function rounded(value) {
  return value == null ? null : Number(value.toFixed(12));
}

function parseOutputPath(argv) {
  const index = argv.indexOf("--output");
  if (index === -1) return DEFAULT_OUTPUT_PATH;
  assert.ok(argv[index + 1], "--output requires a path");
  const resolved = path.resolve(ROOT, argv[index + 1]);
  const containment = path.relative(ROOT, resolved);
  assert.ok(
    containment &&
      containment !== ".." &&
      !containment.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(containment),
    "Output path must remain inside the repository",
  );
  return resolved;
}

function sequenceForRegion(annotation, region) {
  return annotation.residues
    .filter((residue) => residue.region === region)
    .map((residue) => residue.aminoAcid)
    .join("");
}

function regionRecord(annotation) {
  if (annotation.status !== "numbered") return null;
  return Object.fromEntries(REPORTED_REGIONS.map((region) => {
    const sequence = sequenceForRegion(annotation, region);
    return [region, {
      length: sequence.length,
      sha256: sha256(sequence),
      sequence: region.startsWith("CDR") ? sequence : null,
    }];
  }));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function candidateContactClassification(structure, vhhChainId, audit, annotation) {
  if (annotation.status !== "numbered") {
    return {
      paratopeProxyShare: null,
      cdr3ProxyShare: null,
      changedContactPairCount: null,
      changedContactPairs: [],
    };
  }

  const chain = structure.chains.find((candidate) => candidate.id === vhhChainId);
  assert.ok(chain, `Missing VHH chain ${vhhChainId}`);
  assert.equal(chain.residues.length, annotation.residues.length);

  const annotationByResidueOrder = new Map();
  for (let index = 0; index < chain.residues.length; index += 1) {
    const residue = chain.residues[index];
    const numbered = annotation.residues[index];
    assert.equal(
      residue.oneLetter,
      numbered.aminoAcid,
      `${vhhChainId}:${residue.key} sequence-to-coordinate map drift`,
    );
    annotationByResidueOrder.set(residue.order, numbered);
  }

  let cdrContacts = 0;
  let cdr3Contacts = 0;
  const changedContactPairs = [];
  for (const contact of audit.contacts) {
    const numbered = annotationByResidueOrder.get(contact.vhhResidueOrder);
    assert.ok(numbered, `Missing candidate annotation for ${contact.vhhResidue}`);
    if (CDR_REGIONS.has(numbered.region)) cdrContacts += 1;
    if (numbered.region === "CDR3-IMGT") cdr3Contacts += 1;
    if (numbered.region !== contact.vhhRegion) {
      changedContactPairs.push({
        receptorResidue: contact.receptorResidue,
        vhhResidue: contact.vhhResidue,
        minimumDistanceAngstrom: Number(contact.minimumDistance.toFixed(6)),
        legacyRegion: contact.vhhRegion,
        candidateRegion: numbered.region,
      });
    }
  }

  return {
    paratopeProxyShare: audit.contacts.length
      ? cdrContacts / audit.contacts.length
      : null,
    cdr3ProxyShare: audit.contacts.length
      ? cdr3Contacts / audit.contacts.length
      : null,
    changedContactPairCount: changedContactPairs.length,
    changedContactPairs,
  };
}

async function main() {
  const outputPath = parseOutputPath(process.argv.slice(2));
  const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
  assert.equal(baseline.schemaVersion, "1.0.0");
  assert.equal(baseline.softwareVersion, "0.5.0");
  assert.equal(baseline.structures, 17);
  assert.equal(baseline.results.length, 17);

  const downloads = new Map(await Promise.all(baseline.results.map(async (entry) => {
    const source = await downloadPublicCoordinate(
      `https://files.rcsb.org/download/${entry.pdb}.pdb`,
      entry.pdb,
    );
    assert.equal(source.byteLength, entry.sourceBytes, `${entry.pdb}: source-byte drift`);
    assert.equal(sha256(source), entry.sourceSha256, `${entry.pdb}: source-hash drift`);
    return [entry.pdb, source];
  })));

  const records = [];
  for (const entry of baseline.results) {
    const source = downloads.get(entry.pdb);
    assert.ok(source, `${entry.pdb}: download missing`);
    const structure = parsePdb(source.toString("utf8"));
    const [receptorChainId, vhhChainId] = entry.pair.split(":");
    const vhhChain = structure.chains.find((chain) => chain.id === vhhChainId);
    assert.ok(vhhChain, `${entry.pdb}: VHH chain ${vhhChainId} missing`);

    const audit = analyzeInterface(
      structure,
      receptorChainId,
      vhhChainId,
      "none",
    );
    assert.equal(audit.contactPairCount, entry.contactPairs, `${entry.pdb}: contact drift`);
    assert.equal(audit.severeClashCount, entry.severeClashPairs, `${entry.pdb}: clash drift`);
    assert.equal(
      Number(audit.deltaSasaAngstrom2.toFixed(1)),
      entry.deltaSasaAngstrom2,
      `${entry.pdb}: delta-SASA drift`,
    );

    const legacy = numberVhhSequence(vhhChain.sequence);
    const candidate = numberVhhSequenceV06(vhhChain.sequence);
    assert.equal(legacy.status, audit.vhhNumbering.status, `${entry.pdb}: legacy audit drift`);
    if (candidate.status === "numbered") {
      assert.equal(candidate.completeImgtRegionCoverage, true);
      assert.equal(candidate.numberingSegmentationAgreement, true);
    } else {
      assert.equal(candidate.completeImgtRegionCoverage, false);
      assert.equal(candidate.numberingSegmentationAgreement, false);
    }

    const legacyRegions = regionRecord(legacy);
    const candidateRegions = regionRecord(candidate);
    const candidateContacts = candidateContactClassification(
      structure,
      vhhChainId,
      audit,
      candidate,
    );

    records.push({
      pdb: entry.pdb,
      receptor: entry.receptor,
      pair: entry.pair,
      sourceBytes: entry.sourceBytes,
      sourceSha256: entry.sourceSha256,
      vhhSequenceLength: vhhChain.sequence.length,
      vhhSequenceSha256: sha256(vhhChain.sequence),
      geometryControl: {
        contactPairCount: audit.contactPairCount,
        severeClashCount: audit.severeClashCount,
        deltaSasaAngstrom2: Number(audit.deltaSasaAngstrom2.toFixed(1)),
      },
      legacy: {
        status: legacy.status,
        engine: legacy.engine,
        confidence: legacy.confidence,
        queryStart: legacy.queryStart,
        queryEnd: legacy.queryEnd,
        cdrLengths: legacy.cdrLengths,
        regions: legacyRegions,
        paratopeProxyShare: rounded(audit.paratopeProxyShare),
        cdr3ProxyShare: rounded(audit.cdr3ProxyShare),
        error: legacy.error,
      },
      candidate: {
        status: candidate.status,
        policyVersion: candidate.policyVersion,
        engine: candidate.engine,
        confidence: candidate.confidence,
        queryStart: candidate.queryStart,
        queryEnd: candidate.queryEnd,
        completeImgtRegionCoverage: candidate.completeImgtRegionCoverage,
        numberingSegmentationAgreement: candidate.numberingSegmentationAgreement,
        cdrLengths: candidate.cdrLengths,
        regions: candidateRegions,
        paratopeProxyShare: rounded(candidateContacts.paratopeProxyShare),
        cdr3ProxyShare: rounded(candidateContacts.cdr3ProxyShare),
        error: candidate.error,
      },
      differences: {
        statusChanged: legacy.status !== candidate.status,
        queryBoundsChanged:
          legacy.queryStart !== candidate.queryStart ||
          legacy.queryEnd !== candidate.queryEnd,
        cdrLengthsChanged: !sameJson(legacy.cdrLengths, candidate.cdrLengths),
        regionAssignmentsChanged: !sameJson(legacyRegions, candidateRegions),
        paratopeProxyShareChanged:
          rounded(audit.paratopeProxyShare) !==
          rounded(candidateContacts.paratopeProxyShare),
        cdr3ProxyShareChanged:
          rounded(audit.cdr3ProxyShare) !==
          rounded(candidateContacts.cdr3ProxyShare),
        changedContactPairCount: candidateContacts.changedContactPairCount,
        changedContactPairs: candidateContacts.changedContactPairs,
      },
    });
  }

  const output = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-v0.6-vhh-numbering-public-panel-differential-v1",
    status: "EXECUTED_PUBLIC_DEVELOPMENT_DIFFERENTIAL_NOT_PRODUCTION_VALIDATION",
    candidateVersion: VHH_NUMBERING_V06_CANDIDATE_VERSION,
    sourcePanel: {
      path: "validation/v0.5-public-regression-attestation-v1/native-interfaces.json",
      softwareVersion: baseline.softwareVersion,
      structures: baseline.structures,
      allSourceBytesAndSha256Reverified: true,
    },
    accounting: {
      structures: records.length,
      legacyNumbered: records.filter((record) => record.legacy.status === "numbered").length,
      candidateNumbered: records.filter((record) => record.candidate.status === "numbered").length,
      statusChanges: records.filter((record) => record.differences.statusChanged).length,
      queryBoundChanges: records.filter((record) => record.differences.queryBoundsChanged).length,
      cdrLengthChanges: records.filter((record) => record.differences.cdrLengthsChanged).length,
      regionAssignmentChanges: records.filter((record) => record.differences.regionAssignmentsChanged).length,
      paratopeShareChanges: records.filter((record) => record.differences.paratopeProxyShareChanged).length,
      cdr3ShareChanges: records.filter((record) => record.differences.cdr3ProxyShareChanged).length,
      changedContactPairs: records.reduce(
        (sum, record) => sum + (record.differences.changedContactPairCount ?? 0),
        0,
      ),
      coordinateGeometryRegressions: 0,
    },
    integrity: {
      historicalArtifactsModified: false,
      candidateIntegratedIntoProduction: false,
      usesNativeHoldoutCoordinates: false,
      usesNativeHoldoutRelativePoses: false,
      usesNativeHoldoutEpitopes: false,
      usesDockqLabels: false,
      establishesBindingPredictionAccuracy: false,
      establishesRankingValidity: false,
      constitutesIndependentHoldoutEvidence: false,
    },
    records,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output.accounting, null, 2));
}

await main();
