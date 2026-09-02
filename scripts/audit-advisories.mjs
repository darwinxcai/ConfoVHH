#!/usr/bin/env node
/**
 * Dependency-advisory gate.
 *
 * `npm audit --audit-level=moderate` is all-or-nothing: one advisory in a
 * build-only tool fails the release gate with no way to record a reviewed,
 * time-bounded exception. This wrapper keeps the same coverage and adds an
 * explicit allowlist, so an accepted advisory is visible in the repository
 * with its justification and a review date rather than silently tolerated.
 *
 * Two properties are deliberately not waivable:
 *   - An advisory reachable from the production dependency tree always fails,
 *     even if it is allowlisted. The allowlist can only ever excuse a
 *     dependency that does not ship to users.
 *   - An allowlist entry past its reviewBy date always fails, so an exception
 *     cannot outlive its review.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const ALLOWLIST_PATH = path.join(repositoryRoot, "security-advisory-allowlist.json");
const SEVERITY_ORDER = ["info", "low", "moderate", "high", "critical"];

function severityRank(severity) {
  const rank = SEVERITY_ORDER.indexOf(String(severity).toLowerCase());
  return rank === -1 ? SEVERITY_ORDER.length : rank;
}

/** `npm audit` exits non-zero when it finds anything, so read stdout either way. */
function auditReport(extraArguments) {
  const command = ["audit", "--json", ...extraArguments];
  let stdout;
  try {
    stdout = execFileSync("npm", command, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    stdout = error.stdout;
    if (!stdout) {
      throw new Error(
        `\`npm ${command.join(" ")}\` produced no output. The registry may be unreachable.\n` +
          `${error.stderr ?? error.message}`,
      );
    }
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`\`npm ${command.join(" ")}\` did not return JSON:\n${stdout.slice(0, 2000)}`);
  }
}

/** Flatten an audit report into one entry per distinct GHSA identifier. */
function advisoriesByIdentifier(report) {
  const advisories = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== "object" || !via.url) continue;
      const identifier = via.url.split("/").pop();
      if (!identifier) continue;
      const existing = advisories.get(identifier);
      if (existing) {
        existing.packages.add(via.name ?? vulnerability.name);
        continue;
      }
      advisories.set(identifier, {
        identifier,
        url: via.url,
        title: via.title ?? "(no title)",
        severity: via.severity ?? vulnerability.severity,
        packages: new Set([via.name ?? vulnerability.name]),
      });
    }
  }
  return advisories;
}

function readAllowlist() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${ALLOWLIST_PATH}: ${error.message}`);
  }
  const entries = new Map();
  for (const entry of parsed.allowed ?? []) {
    for (const field of ["advisory", "package", "scope", "justification", "reviewBy"]) {
      if (!entry[field]) {
        throw new Error(`Allowlist entry ${entry.advisory ?? "(unnamed)"} is missing "${field}".`);
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewBy)) {
      throw new Error(`Allowlist entry ${entry.advisory} has a malformed reviewBy date.`);
    }
    entries.set(entry.advisory, entry);
  }
  return { minimumSeverity: parsed.minimumSeverity ?? "moderate", entries };
}

const { minimumSeverity, entries } = readAllowlist();
const threshold = severityRank(minimumSeverity);
const today = new Date().toISOString().slice(0, 10);

const everywhere = advisoriesByIdentifier(auditReport([]));
const production = advisoriesByIdentifier(auditReport(["--omit=dev"]));

const failures = [];
const waived = [];

for (const advisory of everywhere.values()) {
  if (severityRank(advisory.severity) < threshold) continue;
  const packages = [...advisory.packages].sort().join(", ");
  const label = `${advisory.identifier} (${advisory.severity}, ${packages})`;

  if (production.has(advisory.identifier)) {
    failures.push(
      `${label} is reachable from the production dependency tree.\n` +
        `    ${advisory.title}\n    ${advisory.url}\n` +
        `    Production advisories are never waivable. Resolve the dependency.`,
    );
    continue;
  }

  const entry = entries.get(advisory.identifier);
  if (!entry) {
    failures.push(
      `${label} is not allowlisted.\n    ${advisory.title}\n    ${advisory.url}\n` +
        `    Resolve it, or add a reviewed entry to security-advisory-allowlist.json.`,
    );
    continue;
  }

  if (entry.reviewBy < today) {
    failures.push(
      `${label} is allowlisted but its review date passed on ${entry.reviewBy}.\n` +
        `    ${advisory.url}\n    Re-review the exception and set a new reviewBy date, or resolve it.`,
    );
    continue;
  }

  waived.push(`${label} — accepted until ${entry.reviewBy}: ${entry.justification}`);
}

for (const entry of entries.values()) {
  if (!everywhere.has(entry.advisory)) {
    console.log(
      `[advisories] note: allowlist entry ${entry.advisory} (${entry.package}) no longer matches ` +
        `any reported advisory and can be removed.`,
    );
  }
}

for (const line of waived) console.log(`[advisories] waived: ${line}`);

if (failures.length > 0) {
  console.error(`\n[advisories] ${failures.length} advisory finding(s) at or above ${minimumSeverity}:\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}

console.log(
  `[advisories] pass: no unreviewed advisory at or above ${minimumSeverity}; ` +
    `production tree clean; ${waived.length} reviewed exception(s).`,
);
