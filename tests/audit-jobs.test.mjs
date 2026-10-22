import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  executeEnsembleAuditJob,
  executeParseCoordinateJob,
  executeSingleAuditJob,
  executeStatePairAuditJob,
} from "../lib/audit-jobs.ts";
import { parsePdb } from "../lib/confovhh.ts";

const SHA = Object.freeze({
  a: "a".repeat(64),
  b: "b".repeat(64),
  c: "c".repeat(64),
  d: "d".repeat(64),
  e: "e".repeat(64),
  f: "f".repeat(64),
});

const MEBIBYTE = 1024 * 1024;

function atomLine({ serial, chain, residueNumber, x, y = 0, residueName = "ALA" }) {
  return [
    "ATOM  ",
    String(serial).padStart(5),
    " ",
    "  CA",
    " ",
    residueName.padStart(3),
    " ",
    chain,
    String(residueNumber).padStart(4),
    "    ",
    x.toFixed(3).padStart(8),
    y.toFixed(3).padStart(8),
    "0.000".padStart(8),
    "1.00".padStart(6),
    "85.00".padStart(6),
    "           C",
  ].join("");
}

function complexText(offset = 0) {
  return [
    atomLine({ serial: 1, chain: "A", residueNumber: 1, x: 0 }),
    atomLine({ serial: 2, chain: "A", residueNumber: 2, x: 4 }),
    atomLine({ serial: 3, chain: "B", residueNumber: 1, x: 3 + offset, residueName: "GLY" }),
    atomLine({ serial: 4, chain: "B", residueNumber: 2, x: 7 + offset, residueName: "GLY" }),
  ].join("\n");
}

function complexTextWithExtraSidechainAtom(offset = 0) {
  const extraCa = atomLine({
    serial: 5,
    chain: "A",
    residueNumber: 1,
    x: 1,
  });
  const extraCb = `${extraCa.slice(0, 12)}  CB${extraCa.slice(16)}`;
  return `${complexText(offset)}\n${extraCb}`;
}

function denseComplexText(offset = 0, residuesPerChain = 72) {
  const lines = [];
  for (let index = 0; index < residuesPerChain; index += 1) {
    lines.push(atomLine({
      serial: index + 1,
      chain: "A",
      residueNumber: index + 1,
      x: 0,
    }));
    lines.push(atomLine({
      serial: residuesPerChain + index + 1,
      chain: "B",
      residueNumber: index + 1,
      x: 3 + offset,
      residueName: "GLY",
    }));
  }
  return lines.join("\n");
}

function complexCifText(offset = 0) {
  return `data_pose
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.auth_asym_id
_atom_site.auth_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
ATOM 1 C CA ALA RA 1 X 1 0 0 0
ATOM 2 C CA ALA RA 2 X 2 4 0 0
ATOM 3 C CA GLY NB 1 Y 1 ${3 + offset} 0 0
ATOM 4 C CA GLY NB 2 Y 2 ${7 + offset} 0 0
#`;
}

test("single audit jobs preserve the requested confidence policy", () => {
  const structure = parsePdb(complexText());
  const audit = executeSingleAuditJob({
    structure,
    receptorChain: "A",
    vhhChain: "B",
    confidenceMode: "none",
    pae: null,
    paeOrderConfirmed: false,
  });
  assert.equal(audit.confidenceMode, "none");
  assert.equal(audit.contactPairCount, 3);
});

test("coordinate parse jobs reject malformed envelopes and oversized decoded text before parsing", () => {
  assert.throws(
    () => executeParseCoordinateJob(null),
    /coordinate parse job must be an object/i,
  );
  assert.throws(() => executeParseCoordinateJob({
    filename: "oversized.pdb",
    text: "X".repeat(12 * MEBIBYTE + 1),
  }), /12 MiB decoded-text limit/i);
  assert.throws(() => executeParseCoordinateJob({
    filename: "broken.pdb",
    text: "not coordinates",
    modelId: "bad\nselection",
  }), /model identifier.*bounded string/i);
});

test("ensemble metadata and decoded-text limits are enforced before any candidate parse", () => {
  const reference = {
    filename: "reference.pdb",
    sha256: SHA.f,
    bytes: complexText().length,
    structure: parsePdb(complexText()),
    receptorChain: "A",
    vhhChain: "B",
  };

  assert.throws(() => executeEnsembleAuditJob({
    reference,
    candidates: [
      { filename: "would-parse-first.pdb", text: "not coordinates", sha256: SHA.a, bytes: 15 },
      { filename: "bad-digest.pdb", text: complexText(0.2), sha256: "not-a-digest", bytes: 1 },
    ],
  }), /64-character hexadecimal SHA-256/i);

  assert.throws(() => executeEnsembleAuditJob({
    reference,
    candidates: [{
      filename: "declared-small.pdb",
      text: "X".repeat(12 * MEBIBYTE + 1),
      sha256: SHA.a,
      bytes: 1,
    }],
  }), /12 MiB decoded-text limit/i);

  const tenMiB = "X".repeat(10 * MEBIBYTE);
  assert.throws(() => executeEnsembleAuditJob({
    reference,
    candidates: [SHA.a, SHA.b, SHA.c, SHA.d, SHA.e].map((sha256, index) => ({
      filename: `aggregate-${index}.pdb`,
      text: tenMiB,
      sha256,
      bytes: 1,
    })),
  }), /48 MiB aggregate decoded-text limit/i);
});

test("ensemble declared-byte, pose-count, and parsed-reference caps fail before candidate parsing", () => {
  const reference = {
    filename: "reference.pdb",
    sha256: SHA.f,
    bytes: 12 * MEBIBYTE,
    structure: parsePdb(complexText()),
    receptorChain: "A",
    vhhChain: "B",
  };
  const candidate = (index, bytes = 1) => ({
    filename: `candidate-${index}.pdb`,
    text: "not coordinates",
    sha256: index.toString(16).padStart(64, "0"),
    bytes,
  });
  assert.throws(() => executeEnsembleAuditJob({
    reference,
    candidates: Array.from({ length: 12 }, (_, index) => candidate(index)),
  }), /at most 11 candidates/i);
  assert.throws(() => executeEnsembleAuditJob({
    reference,
    candidates: Array.from({ length: 4 }, (_, index) => candidate(index, 12 * MEBIBYTE)),
  }), /48 MiB aggregate declared-byte limit/i);

  const oversizedReference = {
    ...reference,
    bytes: 1,
    structure: {
      ...reference.structure,
      atoms: new Array(60_001).fill(reference.structure.atoms[0]),
    },
  };
  assert.throws(() => executeEnsembleAuditJob({
    reference: oversizedReference,
    candidates: [candidate(0)],
  }), /60,000-atom parsed-structure limit/i);

  const inconsistentNestedReference = {
    ...reference,
    bytes: 1,
    structure: {
      ...reference.structure,
      atoms: [reference.structure.atoms[0]],
      chains: [{
        ...reference.structure.chains[0],
        atomCount: 60_001,
        residues: [{
          ...reference.structure.chains[0].residues[0],
          atoms: new Array(60_001).fill(reference.structure.atoms[0]),
        }],
        residueCount: 1,
      }],
    },
  };
  assert.throws(() => executeEnsembleAuditJob({
    reference: inconsistentNestedReference,
    candidates: [candidate(0)],
  }), /bounded nested-atom inventory/i);

  const excessiveChainReference = {
    ...reference,
    bytes: 1,
    structure: {
      ...reference.structure,
      chains: Array.from({ length: 257 }, (_, index) => ({
        ...reference.structure.chains[0],
        id: index === 0 ? "A" : `chain-${index}`,
      })),
    },
  };
  assert.throws(() => executeEnsembleAuditJob({
    reference: excessiveChainReference,
    candidates: [candidate(0)],
  }), /between 1 and 256 parsed chains/i);
});

test("ensemble jobs bound the aggregate retained contact inventory", () => {
  const referenceText = denseComplexText();
  const candidateText = denseComplexText(0.2);
  assert.throws(() => executeEnsembleAuditJob({
    reference: {
      filename: "dense-reference.pdb",
      sha256: SHA.a,
      bytes: referenceText.length,
      structure: parsePdb(referenceText),
      receptorChain: "A",
      vhhChain: "B",
    },
    candidates: [{
      filename: "dense-candidate.pdb",
      text: candidateText,
      sha256: SHA.b,
      bytes: candidateText.length,
    }],
  }), /10,000-contact aggregate audit budget/i);
});

test("paired-state jobs enforce comparison text and metadata before coordinate parsing", () => {
  const reference = {
    filename: "reference.pdb",
    sha256: SHA.f,
    bytes: complexText().length,
    structure: parsePdb(complexText()),
    receptorChain: "A",
    vhhChain: "B",
  };
  assert.throws(() => executeStatePairAuditJob({
    reference,
    comparison: {
      filename: "declared-small.pdb",
      text: "X".repeat(12 * MEBIBYTE + 1),
      sha256: SHA.a,
      bytes: 1,
    },
  }), /12 MiB decoded-text limit/i);
  assert.throws(() => executeStatePairAuditJob({
    reference,
    comparison: {
      filename: "broken.pdb",
      text: "not coordinates",
      sha256: "bad",
      bytes: 1,
    },
  }), /64-character hexadecimal SHA-256/i);
});

test("paired-state jobs reject incompatible atom inventories before scientific re-audit", () => {
  const referenceText = complexText();
  const comparisonText = complexTextWithExtraSidechainAtom(0.2);
  assert.throws(() => executeStatePairAuditJob({
    reference: {
      filename: "reference.pdb",
      sha256: SHA.f,
      bytes: referenceText.length,
      structure: parsePdb(referenceText),
      receptorChain: "A",
      vhhChain: "B",
    },
    comparison: {
      filename: "extra-sidechain.pdb",
      text: comparisonText,
      sha256: SHA.a,
      bytes: comparisonText.length,
    },
  }), /atom inventory is incompatible with the reference/i);
});

test("ensemble jobs keep compatible poses and report malformed poses without aborting", () => {
  const progress = [];
  const result = executeEnsembleAuditJob({
    reference: {
      filename: "reference.pdb",
      sha256: SHA.c,
      bytes: 100,
      structure: parsePdb(complexText()),
      receptorChain: "A",
      vhhChain: "B",
    },
    candidates: [
      { filename: "compatible.pdb", text: complexText(0.2), sha256: SHA.b, bytes: 101 },
      { filename: "broken.pdb", text: "not a pdb", sha256: SHA.a, bytes: 9 },
    ],
  }, (completed, total, filename) => progress.push({ completed, total, filename }));
  assert.equal(result.summary.poseCount, 2);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].filename, "broken.pdb");
  assert.equal(result.rejected[0].sha256, SHA.a);
  assert.equal(result.rejected[0].bytes, 9);
  assert.deepEqual(progress, [
    { completed: 1, total: 2, filename: "broken.pdb" },
    { completed: 2, total: 2, filename: "compatible.pdb" },
  ]);
  assert.match(result.comparisonMode, /PAE is omitted/i);
});

test("ensemble jobs reject duplicates individually and fail only when no candidate survives", () => {
  const reference = {
    filename: "reference.pdb",
    sha256: SHA.d,
    bytes: 100,
    structure: parsePdb(complexText()),
    receptorChain: "A",
    vhhChain: "B",
  };
  assert.throws(() => executeEnsembleAuditJob({
    reference,
    candidates: [
      { filename: "duplicate.pdb", text: complexText(), sha256: SHA.d, bytes: 100 },
    ],
  }), /no additional compatible pose/i);

  const result = executeEnsembleAuditJob({
    reference,
    candidates: [
      { filename: "duplicate.pdb", text: complexText(), sha256: SHA.d, bytes: 100 },
      { filename: "survivor.pdb", text: complexText(0.1), sha256: SHA.e, bytes: 100 },
    ],
  });
  assert.equal(result.summary.poseCount, 2);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].sha256, SHA.d);
});

test("ensemble jobs accept mixed PDB/mmCIF coordinates and preserve format provenance", () => {
  const result = executeEnsembleAuditJob({
    reference: {
      filename: "reference.pdb",
      sha256: SHA.f,
      bytes: 100,
      structure: parsePdb(complexText()),
      receptorChain: "A",
      vhhChain: "B",
    },
    candidates: [{
      filename: "candidate.cif",
      text: complexCifText(0.2),
      sha256: SHA.e,
      bytes: 200,
    }],
  });
  assert.equal(result.summary.poseCount, 2);
  const candidate = result.summary.poses.find((pose) => pose.sha256 === SHA.e);
  assert.equal(candidate.sourceFormat, "mmcif");
  assert.equal(candidate.receptorChain.labelAsymId, "RA");
  assert.equal(candidate.vhhChain.authAsymId, "Y");
});

test("ensemble deduplication is rigid-transform invariant and keeps the reference privileged", () => {
  const translated = complexText().split("\n").map((line) => {
    const x = Number(line.slice(30, 38)) + 25;
    const y = Number(line.slice(38, 46)) - 7;
    const z = Number(line.slice(46, 54)) + 3;
    return `${line.slice(0, 30)}${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}` +
      `${z.toFixed(3).padStart(8)}${line.slice(54)}`;
  }).join("\n");
  assert.throws(() => executeEnsembleAuditJob({
    reference: {
      filename: "reference.pdb", sha256: SHA.f, bytes: 100,
      structure: parsePdb(complexText()), receptorChain: "A", vhhChain: "B",
    },
    candidates: [{
      filename: "translated.pdb", text: translated, sha256: SHA.a, bytes: 100,
    }],
  }), /near-duplicate selected receptor–VHH geometry.*reference\.pdb/i);
});

test("candidate deduplication is upload-order stable even across a contact cutoff", () => {
  const reference = {
    filename: "reference.pdb", sha256: SHA.e, bytes: 100,
    structure: parsePdb(complexText()), receptorChain: "A", vhhChain: "B",
  };
  const lowSha = {
    filename: "inside.pdb", text: complexText(1.499), sha256: SHA.a, bytes: 100,
  };
  const highSha = {
    filename: "outside.pdb", text: complexText(1.501), sha256: SHA.f, bytes: 100,
  };
  const forward = executeEnsembleAuditJob({ reference, candidates: [lowSha, highSha] });
  const reverse = executeEnsembleAuditJob({ reference, candidates: [highSha, lowSha] });
  assert.deepEqual(forward, reverse);
  assert.equal(forward.summary.poseCount, 2);
  const retainedCandidate = forward.summary.poses.find((pose) => !pose.isReference);
  assert.ok(retainedCandidate);
  assert.ok([SHA.a, SHA.f].includes(retainedCandidate.sha256));
  assert.equal(forward.rejected.length, 1);
  assert.notEqual(forward.rejected[0].sha256, retainedCandidate.sha256);
  assert.match(forward.rejected[0].reason, /deterministic geometry medoid/i);
});

test("non-transitive duplicate chains use a geometry medoid across SHA and upload permutations", () => {
  const reference = {
    filename: "reference.pdb", sha256: SHA.f, bytes: 100,
    structure: parsePdb(complexText()), receptorChain: "A", vhhChain: "B",
  };
  const first = executeEnsembleAuditJob({
    reference,
    candidates: [
      { filename: "left.pdb", text: complexText(1), sha256: SHA.a, bytes: 100 },
      { filename: "medoid.pdb", text: complexText(1.04), sha256: SHA.b, bytes: 100 },
      { filename: "right.pdb", text: complexText(1.08), sha256: SHA.c, bytes: 100 },
    ],
  });
  const progress = [];
  const permuted = executeEnsembleAuditJob({
    reference,
    candidates: [
      { filename: "right.pdb", text: complexText(1.08), sha256: SHA.a, bytes: 100 },
      { filename: "left.pdb", text: complexText(1), sha256: SHA.c, bytes: 100 },
      { filename: "medoid.pdb", text: complexText(1.04), sha256: SHA.e, bytes: 100 },
    ],
  }, (completed, total, filename) => progress.push({ completed, total, filename }));

  const retainedFilenames = (result) => result.summary.poses
    .filter((pose) => !pose.isReference)
    .map((pose) => pose.filename);
  assert.deepEqual(retainedFilenames(first), ["medoid.pdb"]);
  assert.deepEqual(retainedFilenames(permuted), ["medoid.pdb"]);
  assert.deepEqual(
    first.rejected.map((pose) => pose.filename).sort(),
    ["left.pdb", "right.pdb"],
  );
  assert.deepEqual(
    permuted.rejected.map((pose) => pose.filename).sort(),
    ["left.pdb", "right.pdb"],
  );
  assert.ok(first.rejected.every((pose) => /deterministic geometry medoid medoid\.pdb/i.test(pose.reason)));
  assert.deepEqual(progress.map(({ completed, total }) => ({ completed, total })), [
    { completed: 1, total: 3 },
    { completed: 2, total: 3 },
    { completed: 3, total: 3 },
  ]);
  assert.equal(new Set(progress.map(({ filename }) => filename)).size, 3);
});

test("ensemble jobs fail closed when a matched pose has a different selected atom inventory", () => {
  const result = executeEnsembleAuditJob({
    reference: {
      filename: "reference.pdb", sha256: SHA.f, bytes: 100,
      structure: parsePdb(complexText()), receptorChain: "A", vhhChain: "B",
    },
    candidates: [
      {
        filename: "extra-sidechain.pdb",
        text: complexTextWithExtraSidechainAtom(0.2),
        sha256: SHA.a,
        bytes: 200,
      },
      { filename: "compatible.pdb", text: complexText(0.2), sha256: SHA.b, bytes: 100 },
    ],
  });
  assert.equal(result.summary.poseCount, 2);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].filename, "extra-sidechain.pdb");
  assert.match(result.rejected[0].reason, /atom inventory is incompatible with the reference/i);
});

test("duplicate candidates cannot allocate scientific audit ledgers before component selection", () => {
  const source = readFileSync(
    new URL("../lib/audit-jobs.ts", import.meta.url),
    "utf8",
  );
  const preparedType = source.match(
    /interface PreparedEnsembleGeometry \{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(preparedType, "PreparedEnsembleGeometry declaration is present");
  assert.doesNotMatch(preparedType, /\b(?:audit|input)\b/);

  const preparationStart = source.indexOf(
    "for (let index = 0; index < orderedCandidates.length; index += 1)",
  );
  const graphStart = source.indexOf("// Duplicate membership is a graph property");
  const representativeAuditStart = source.indexOf(
    "// Scientific ledgers are allocated only for the one selected",
  );
  assert.ok(preparationStart >= 0 && graphStart > preparationStart);
  assert.ok(representativeAuditStart > graphStart);
  assert.doesNotMatch(
    source.slice(preparationStart, graphStart),
    /\banalyzeInterface\s*\(/,
  );
  assert.match(
    source.slice(representativeAuditStart),
    /\banalyzeInterface\s*\(/,
  );
});

test("a localized deviation above 0.05 Å is not diluted by low global RMSD", () => {
  const lines = [];
  for (let index = 0; index < 60; index += 1) {
    lines.push(atomLine({ serial: index + 1, chain: "A", residueNumber: index + 1, x: index * 3 }));
    lines.push(atomLine({
      serial: index + 61, chain: "B", residueNumber: index + 1,
      x: index * 3, y: 4 + (index === 59 ? 0.1 : 0), residueName: "GLY",
    }));
  }
  const referenceText = lines.map((line) => line).join("\n");
  const candidateText = lines.map((line, index) => {
    if (index !== 119) return line;
    return `${line.slice(0, 38)}${"4.000".padStart(8)}${line.slice(46)}`;
  }).join("\n");
  const result = executeEnsembleAuditJob({
    reference: {
      filename: "reference.pdb", sha256: SHA.c, bytes: referenceText.length,
      structure: parsePdb(referenceText), receptorChain: "A", vhhChain: "B",
    },
    candidates: [{
      filename: "localized-change.pdb", text: candidateText,
      sha256: SHA.d, bytes: candidateText.length,
    }],
  });
  assert.equal(result.summary.poseCount, 2);
});
