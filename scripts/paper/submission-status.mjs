#!/usr/bin/env node
// Report which ConfoVHH submission gates are open, and who has to close them.
//
// paper/SUBMISSION_READINESS.md states the five gates in prose. This command
// checks the machine-checkable part of each one against the repository and
// fails closed: an absent record, an unfilled field, or a stale binding is an
// open gate, never a pass. It cannot judge scientific merit, and it never
// infers that a person did something from the fact that a file exists.
//
// Usage:
//   node scripts/paper/submission-status.mjs [--json]
//
// Exit status is 0 only when every gate is closed.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const KIT = path.join(REPOSITORY_ROOT, "paper", "submission-kit");
const RECORD_PATH = path.join(KIT, "submission-record.json");
const MANIFEST_PATH = path.join(KIT, "deposition-manifest.json");
const EVALUATIONS_DIR = path.join(KIT, "independent-evaluations");
const RECEIPTS_DIR = path.join(REPOSITORY_ROOT, "paper", "evidence");

/** Who can close a gate. Repository work is executable here; author work is not. */
const OWNER = Object.freeze({ repository: "repository", author: "author", participant: "outside participant" });

async function readJson(file) {
  try {
    return { value: JSON.parse(await readFile(file, "utf8")), missing: false };
  } catch (error) {
    if (error.code === "ENOENT") return { value: null, missing: true };
    throw new Error(`${path.relative(REPOSITORY_ROOT, file)}: ${error.message}`, { cause: error });
  }
}

function git(args) {
  return execFileSync("git", args, { cwd: REPOSITORY_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
}

function gitSucceeds(args) {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
}

/** Collect every unfilled required field, by dotted path. Empty means complete. */
function missingFields(source, required, prefix = "") {
  const missing = [];
  for (const [key, rule] of Object.entries(required)) {
    const label = prefix ? `${prefix}.${key}` : key;
    const value = source?.[key];
    if (typeof rule === "object" && rule !== null && !Array.isArray(rule)) {
      if (value == null || typeof value !== "object") missing.push(label);
      else missing.push(...missingFields(value, rule, label));
      continue;
    }
    if (rule === "text") {
      if (typeof value !== "string" || value.trim().length === 0) missing.push(label);
    } else if (rule === "list") {
      if (!Array.isArray(value) || value.length === 0) missing.push(label);
    }
  }
  return missing;
}

const REQUIRED_RECORD_FIELDS = Object.freeze({
  completedBy: "text",
  completedOn: "text",
  venue: { name: "text", articleType: "text", guidelinesUrl: "text", guidelinesCheckedOn: "text" },
  authors: "list",
  funding: "text",
  competingInterests: "text",
  aiDisclosure: "text",
  dataAvailabilityStatement: "text",
  softwareAvailability: { repositoryUrl: "text", releaseTag: "text", archiveDoi: "text", license: "text" },
});

const REQUIRED_AUTHOR_FIELDS = Object.freeze({ name: "text", affiliation: "text", contributorRoles: "list" });

function checkAuthors(record) {
  const authors = Array.isArray(record?.authors) ? record.authors : [];
  const problems = [];
  authors.forEach((author, index) => {
    for (const field of missingFields(author, REQUIRED_AUTHOR_FIELDS)) {
      problems.push(`authors[${index}].${field}`);
    }
  });
  const corresponding = authors.filter((author) => author?.corresponding === true);
  if (authors.length > 0 && corresponding.length !== 1) {
    problems.push(`exactly one corresponding author required, found ${corresponding.length}`);
  }
  return problems;
}

async function loadEvaluations() {
  let entries;
  try {
    entries = await readdir(EVALUATIONS_DIR);
  } catch (error) {
    if (error.code === "ENOENT") return { records: [], problems: ["paper/submission-kit/independent-evaluations/ is absent"] };
    throw error;
  }
  const records = [];
  const problems = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const { value } = await readJson(path.join(EVALUATIONS_DIR, entry));
    const missing = missingFields(value, {
      participant: "text",
      relationshipToImplementation: "text",
      completedOn: "text",
      repositoryCommit: "text",
      environment: "text",
      stepsCompleted: "list",
      outcome: "text",
    });
    if (missing.length > 0) {
      problems.push(`${entry}: incomplete (${missing.join(", ")})`);
      continue;
    }
    records.push({ file: entry, ...value });
  }
  return { records, problems };
}

/** Does the newest reviewer-demonstration receipt still describe this source? */
async function checkReceiptBinding() {
  let entries;
  try {
    entries = (await readdir(RECEIPTS_DIR)).filter((name) => name.startsWith("reviewer-demo") && name.endsWith(".json"));
  } catch (error) {
    if (error.code === "ENOENT") return { receipt: null, drifted: [], problem: "paper/evidence/ is absent" };
    throw error;
  }
  if (entries.length === 0) return { receipt: null, drifted: [], problem: "no reviewer demonstration receipt is retained" };

  const newest = entries.sort().at(-1);
  const { value } = await readJson(path.join(RECEIPTS_DIR, newest));
  const recorded = value?.sourceSha256;
  if (!recorded || typeof recorded !== "object") {
    return { receipt: newest, drifted: [], problem: `${newest} records no source digests` };
  }

  const drifted = [];
  for (const [relativePath, expected] of Object.entries(recorded)) {
    let bytes;
    try {
      bytes = await readFile(path.join(REPOSITORY_ROOT, relativePath));
    } catch {
      drifted.push(`${relativePath} (absent)`);
      continue;
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) drifted.push(relativePath);
  }
  return { receipt: newest, drifted, problem: null };
}

/** Has anything under paper/ changed since the recorded claims audit? */
function claimsAuditStaleness(audit) {
  const commit = audit?.atCommit;
  if (typeof commit !== "string" || commit.trim().length === 0) return { known: false, changed: [] };
  if (!gitSucceeds(["cat-file", "-e", `${commit}^{commit}`])) {
    return { known: false, changed: [], unknownCommit: commit };
  }
  const output = git(["diff", "--name-only", `${commit}`, "HEAD", "--", "paper"]);
  return { known: true, changed: output.length > 0 ? output.split("\n") : [] };
}

export async function evaluateGates() {
  const [recordRead, manifestRead, evaluations, receiptBinding] = await Promise.all([
    readJson(RECORD_PATH),
    readJson(MANIFEST_PATH),
    loadEvaluations(),
    checkReceiptBinding(),
  ]);

  const record = recordRead.value;
  const manifest = manifestRead.value;
  const gates = [];

  // Gate 1 - a reviewer can reproduce the software workflow.
  {
    const blockers = [];
    if (receiptBinding.problem) blockers.push({ owner: OWNER.repository, text: receiptBinding.problem });
    if (receiptBinding.drifted.length > 0) {
      blockers.push({
        owner: OWNER.repository,
        text:
          `the retained ${receiptBinding.receipt} run no longer describes this source ` +
          `(${receiptBinding.drifted.length} changed: ${receiptBinding.drifted.slice(0, 4).join(", ")}` +
          `${receiptBinding.drifted.length > 4 ? ", ..." : ""}); rerun scripts/paper/reviewer-demo.mjs`,
      });
    }
    const independent = evaluations.records.filter(
      (item) => item.relationshipToImplementation === "independent" && item.outcome === "completed",
    );
    if (independent.length === 0) {
      blockers.push({ owner: OWNER.participant, text: "no independent completion of paper/WORKFLOW_EVALUATION.md is retained" });
    }
    if (!record?.softwareAvailability?.releaseTag) {
      blockers.push({ owner: OWNER.author, text: "no reviewed release tag is recorded" });
    }
    gates.push({
      id: "software-reproduction",
      title: "A reviewer can reproduce the software workflow",
      blockers,
      passing:
        receiptBinding.problem == null && receiptBinding.drifted.length === 0
          ? `the retained ${receiptBinding.receipt} run still matches every source file it recorded`
          : null,
    });
  }

  // Gate 2 - the claimed application results have available inputs.
  {
    const blockers = [];
    let stale = false;
    if (manifestRead.missing) {
      blockers.push({ owner: OWNER.repository, text: "paper/submission-kit/deposition-manifest.json is absent" });
    } else {
      const deposit = manifest?.deposit ?? {};
      for (const field of ["archive", "recordUrl", "doi", "license", "redistributionTermsClearedBy", "depositedCommit"]) {
        if (!deposit[field]) blockers.push({ owner: OWNER.author, text: `deposit.${field} is not recorded` });
      }
      try {
        execFileSync("node", ["scripts/paper/build-deposition-manifest.mjs", "--check"], {
          cwd: REPOSITORY_ROOT,
          stdio: "pipe",
        });
      } catch {
        stale = true;
        blockers.push({ owner: OWNER.repository, text: "the manifest no longer matches the tracked evidence; regenerate it" });
      }
    }
    gates.push({
      id: "input-availability",
      title: "Claimed application results have available inputs",
      blockers,
      passing:
        !manifestRead.missing && !stale
          ? `${manifest.fileCount} tracked evidence files are listed and their digests match the working tree`
          : null,
      note: "85 preliminary cognate model coordinates and full per-model PAE remain unavailable and must stay explicit in the text.",
    });
  }

  // Gate 3 - usefulness is demonstrated within the stated scope.
  {
    const blockers = evaluations.problems.map((text) => ({ owner: OWNER.author, text }));
    const completed = evaluations.records.filter(
      (item) => item.relationshipToImplementation === "independent" && item.outcome === "completed",
    );
    if (completed.length === 0) {
      blockers.push({ owner: OWNER.participant, text: "zero independent participants have completed the predefined review task" });
    }
    const other = evaluations.records.length - completed.length;
    gates.push({
      id: "demonstrated-use",
      title: "Usefulness is demonstrated within the stated scope",
      blockers,
      passing: completed.length > 0 ? `${completed.length} independent completion(s) retained` : null,
      note:
        `Automated browser tests do not satisfy this gate. Completion evidences software mechanics, not selection accuracy.` +
        (other > 0 ? ` ${other} further record(s) are retained but do not count toward it.` : ""),
    });
  }

  // Gate 4 - claims match the evidence.
  {
    const blockers = [];
    const audit = record?.claimsAudit;
    const missing = missingFields(audit, { performedBy: "text", performedOn: "text", atCommit: "text", statement: "text" });
    if (missing.length > 0) {
      blockers.push({ owner: OWNER.author, text: `claimsAudit incomplete (${missing.join(", ")})` });
    } else {
      const staleness = claimsAuditStaleness(audit);
      if (staleness.unknownCommit) {
        blockers.push({ owner: OWNER.author, text: `claimsAudit.atCommit ${staleness.unknownCommit} is not a commit in this repository` });
      } else if (staleness.changed.length > 0) {
        blockers.push({
          owner: OWNER.author,
          text:
            `paper/ changed in ${staleness.changed.length} file(s) since the recorded audit ` +
            `(${staleness.changed.slice(0, 3).join(", ")}${staleness.changed.length > 3 ? ", ..." : ""})`,
        });
      }
    }
    gates.push({
      id: "claims-match-evidence",
      title: "Claims match the evidence",
      blockers,
      passing: blockers.length === 0 ? "the recorded claims audit still describes the current paper/ tree" : null,
      note: "The retained application shows no selection superiority (18/33 versus 19/33) across only four mixed-quality jobs, all on one reference. The text must say so.",
    });
  }

  // Gate 5 - the submission record is complete.
  {
    const blockers = [];
    if (recordRead.missing) {
      blockers.push({ owner: OWNER.repository, text: "paper/submission-kit/submission-record.json is absent" });
    } else {
      for (const field of missingFields(record, REQUIRED_RECORD_FIELDS)) {
        blockers.push({ owner: OWNER.author, text: `${field} is not recorded` });
      }
      for (const problem of checkAuthors(record)) blockers.push({ owner: OWNER.author, text: problem });
    }
    gates.push({
      id: "submission-record",
      title: "The submission record is complete",
      blockers,
      passing: blockers.length === 0 ? "every author-supplied submission fact is recorded" : null,
    });
  }

  return gates;
}

function render(gates) {
  const closed = gates.filter((gate) => gate.blockers.length === 0);
  const lines = ["", `ConfoVHH submission gates: ${closed.length} of ${gates.length} closed.`, ""];
  for (const gate of gates) {
    lines.push(`${gate.blockers.length === 0 ? "CLOSED " : "OPEN   "} ${gate.title}`);
    if (gate.passing) lines.push(`        ok:   ${gate.passing}`);
    for (const blocker of gate.blockers) lines.push(`        [${blocker.owner}] ${blocker.text}`);
    if (gate.note) lines.push(`        note: ${gate.note}`);
    lines.push("");
  }

  const byOwner = new Map();
  for (const gate of gates) {
    for (const blocker of gate.blockers) byOwner.set(blocker.owner, (byOwner.get(blocker.owner) ?? 0) + 1);
  }
  if (byOwner.size > 0) {
    lines.push("Open items by owner:");
    for (const [owner, count] of [...byOwner].sort((a, b) => b[1] - a[1])) lines.push(`  ${count}  ${owner}`);
    lines.push("");
  }
  lines.push("Gate prose and scope: paper/SUBMISSION_READINESS.md");
  lines.push("Forms to complete:    paper/submission-kit/README.md");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const gates = await evaluateGates();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ gates, submissionReady: gates.every((gate) => gate.blockers.length === 0) }, null, 2)}\n`);
  } else {
    process.stdout.write(render(gates));
  }
  process.exitCode = gates.every((gate) => gate.blockers.length === 0) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
