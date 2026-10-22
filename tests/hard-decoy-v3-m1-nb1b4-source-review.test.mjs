import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { restoreGlobalTextArtifacts } from "../scripts/hard-decoy-v3/restore-global-text-artifacts.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGE = "validation/hard-decoy-holdout-v3/m1-nb1b4-source-review-2026-09-04";
const read = async (name) => JSON.parse(await readFile(path.join(ROOT, PACKAGE, name)));

test("M1 source packet binds the exact primary citation and replays its complete source inventory", async () => {
  await restoreGlobalTextArtifacts({ repositoryRoot: ROOT });
  const result = spawnSync("python3", ["-B", `${PACKAGE}/build.py`, "verify"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).status, "PASS");
});

test("bounded article extraction ignores Results and rejects figures inserted into allowed Methods", () => {
  const code = `import importlib.util, pathlib, json, xml.etree.ElementTree as E
p=pathlib.Path(${JSON.stringify(PACKAGE)})
s=importlib.util.spec_from_file_location('bounded_m1',p/'build.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
raw=(p/'source-capture/primary-article.xml').read_bytes()
r=E.fromstring(raw)
fake=E.SubElement(r.find('body'),'sec',{'sec-type':'results'})
E.SubElement(fake,'title').text='Results'
E.SubElement(fake,'p').text='SYNTHETIC_EXCLUDED_CONTACT_CANARY'
assert 'SYNTHETIC_EXCLUDED_CONTACT_CANARY' not in json.dumps(m.extract_allowed_article_sections(E.tostring(r)))
allowed=r.find("./body/sec[@id='s11']/sec[@id='s14']")
E.SubElement(allowed,'fig')
try:m.extract_allowed_article_sections(E.tostring(r))
except AssertionError:print('PASS')
else:raise AssertionError('Unexpected figure escaped allowlist guard')
`;
  const result = spawnSync("python3", ["-B", "-c", code], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout); assert.equal(result.stdout.trim(), "PASS");
});

test("NbA12 citation versus negative polymer screen remains a coverage discrepancy, not absence", async () => {
  const review = await read("source-review.json");
  assert.equal(review.doi, "10.1073/pnas.2508879122");
  assert.equal(review.coverageDiscrepancy.entry, "9UAZ");
  assert.equal(review.coverageDiscrepancy.primaryDepositionCitationNamesNbA12, true);
  assert.equal(review.coverageDiscrepancy.retainedProteinEntityCount, 1);
  assert.equal(review.coverageDiscrepancy.retainedHeavyDomainCallCount, 0);
  assert.equal(review.coverageDiscrepancy.absenceOfVhhEstablished, false);
  assert.equal(review.coverageDiscrepancy.binderFusionEstablished, false);
  assert.equal(review.authority.formalExclusionAuthority, false);
});

test("expression tags and missing receptor mapping are not silently equated with deposited sequences", async () => {
  const review = await read("source-review.json");
  assert.equal(review.metadataFacts.nb1b4DepositedLength, 122);
  assert.equal(review.metadataFacts.nb1b4DepositedSequenceHasTerminalSixHistidines, false);
  assert.equal(review.metadataFacts.receptorDepositedUniprotMappingPresent, false);
  assert.equal(review.metadataFacts.receptorDepositedSequenceEndsWithSixHistidines, true);
  assert.ok(review.openItems.some((item) => item.includes("expression-tag")));
  assert.equal(review.authority.targetFreezePermitted, false);
  assert.equal(review.authority.formallyClearedIndependentComponentCount, 0);
});
