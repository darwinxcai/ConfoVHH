import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { restoreGlobalTextArtifacts } from "../scripts/hard-decoy-v3/restore-global-text-artifacts.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGE = "validation/hard-decoy-holdout-v3/prostanoid-source-review-2026-09-05";
const read = async (name) => JSON.parse(await readFile(path.join(ROOT, PACKAGE, name), "utf8"));
const python = (code) => spawnSync("python3", ["-B", "-c", `import importlib.util, pathlib, json, xml.etree.ElementTree as E
p=pathlib.Path(${JSON.stringify(PACKAGE)})
spec=importlib.util.spec_from_file_location('prostanoid_review',p/'build.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
${code}`], { cwd: ROOT, encoding: "utf8" });
const passed = (result) => assert.equal(result.status, 0, result.stderr || result.stdout);

test("prostanoid sources replay all captured bytes and the full development pair space offline", async () => {
  await restoreGlobalTextArtifacts({ repositoryRoot: ROOT });
  const result = spawnSync("python3", ["-B", `${PACKAGE}/build.py`, "verify", "--repository-root", ROOT], { cwd: ROOT, encoding: "utf8" });
  passed(result);
  assert.deepEqual(JSON.parse(result.stdout), { status: "PASS", entryCount: 12, polymerCount: 47, newIndependentComponents: 0, freezeStatus: "BLOCKED" });
});

test("all 12 exact primary deposition links account for 47 polymers, not 12 components", async () => {
  const r = await read("source-review.json");
  assert.equal(r.entries.length, 12);
  assert.equal(r.entries.reduce((n, e) => n + e.polymers.length, 0), 47);
  assert.ok(r.entries.every((e) => e.primaryDepositionLinkVerified));
  assert.deepEqual(r.groups.map((g) => g.polymerCount), [14, 22, 11]);
  assert.ok(r.groups.every((g) => !g.independentComponentClaim));
  assert.equal(r.authority.newFormallyClearedIndependentComponents, 0);
  assert.equal(r.authority.wholeCensusUpperBound, null);
});

test("EP2 and DP1 anti-Fab domains retain five development 8QOT signals without formal graph authority", async () => {
  const r = await read("development-review.json");
  assert.equal(r.summary.reproducedDevelopmentVhhProfileCount, 18);
  assert.equal(r.vhhMatrix.length, 288);
  assert.equal(r.comparisonRows.length, 108);
  assert.equal(r.receptorMatrix.length, 187);
  const positive = r.entityRows.filter((e) => e.positiveDevelopmentProfileIds.length);
  assert.deepEqual(positive.map((e) => e.entityKey), ["9EE5_2", "9EI5_3", "9EKH_3", "9JRO_3", "9JRT_3"]);
  assert.ok(positive.every((e) => e.positiveDevelopmentProfileIds.join() === "development:8QOT#entity:5"));
  assert.ok(r.vhhMatrix.every((e) => !e.formalLeakageEdgeAuthority && !e.formalNoEdgeAuthority));
  assert.equal(r.summary.noRecognizedCanonicalProfileEntryCount, 7);
});

test("EP4 range, DP1 tag, and 9UWD polymer discrepancies stay explicit and unresolved", async () => {
  const r = await read("source-review.json");
  assert.deepEqual(r.constructChecks.ep4.depositedCanonicalExtensionBeyondStatedBoundary, [347, 366]);
  assert.equal(r.constructChecks.ep4.discrepancyResolved, false);
  assert.equal(r.constructChecks.dp1NatureInactive.depositedTerminalHistidineCount, 10);
  assert.equal(r.constructChecks.dp1NatureInactive.methodsReportedHistidineTagCount, 8);
  assert.equal(r.coverageDiscrepancy.retainedPolymerCount, 1);
  assert.equal(r.coverageDiscrepancy.binderAbsenceEstablished, false);
  assert.equal(r.coverageDiscrepancy.binderFusionEstablished, false);
  assert.equal(r.authority.formalExclusionAuthority, false);
  assert.equal(r.exposure.cleanBlindCertification, false);
});

test("bounded extraction ignores synthetic Results and rejects figures, captions and nested sections", () => {
  passed(python(`raw=(p/'sources/ep2-ep4-article.body').read_bytes()
r=E.fromstring(raw); sec=E.SubElement(r.find('body'),'sec',{'sec-type':'results'});E.SubElement(sec,'title').text='Results';E.SubElement(sec,'p').text='SYNTHETIC_FORBIDDEN_CANARY'
assert 'SYNTHETIC_FORBIDDEN_CANARY' not in json.dumps(m.extract_article(E.tostring(r),'ep2-ep4'))
for tag in ['fig','caption','table-wrap','graphic','sec']:
 r=E.fromstring(raw); target=next(n for n in r.iter('sec') if n.get('id')=='Sec11');E.SubElement(target,tag)
 try:m.extract_article(E.tostring(r),'ep2-ep4')
 except AssertionError:pass
 else:raise AssertionError('Forbidden content accepted: '+tag)
`));
});

test("source extraction rejects a wrong DOI and duplicate allowlisted section IDs", () => {
  passed(python(`raw=(p/'sources/ep2-ep4-article.body').read_bytes()
for mode in ['doi','duplicate']:
 r=E.fromstring(raw)
 if mode=='doi':r.find("./front/article-meta/article-id[@pub-id-type='doi']").text='10.0000/wrong'
 else:E.SubElement(r.find('body'),'sec',{'id':'Sec11'})
 try:m.extract_article(E.tostring(r),'ep2-ep4')
 except AssertionError:pass
 else:raise AssertionError('Source identity mutation accepted')
`));
});

test("exact construct recipes reject an altered deposited EP4 terminus", () => {
  passed(python(`r=json.loads((p/'source-review.json').read_text());entries=[{'pdbId':e['pdbId'],'polymerEntities':e['polymers']} for e in r['entries']]
canon={a:json.loads((p/'sources'/('uniprot-'+a+'.body')).read_text()) for a in ['P43116','P35408','Q13258','P0ABE7']}
m.construct_checks(entries,canon)
ep4=next(e for e in entries if e['pdbId']=='9JQY');receptor=next(e for e in ep4['polymerEntities'] if e['entityId']=='3');receptor['sequence']=receptor['sequence'][:-1]+'X'
try:m.construct_checks(entries,canon)
except AssertionError:pass
else:raise AssertionError('Altered construct accepted')
`));
});

test("relocated packet replays and rejects both extra files and altered derived output", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "prostanoid-review-"));
  try {
    const packet = path.join(temp, "packet");
    await cp(path.join(ROOT, PACKAGE), packet, { recursive: true });
    const verify = () => spawnSync("python3", ["-B", path.join(packet, "build.py"), "verify", "--repository-root", ROOT], { cwd: temp, encoding: "utf8" });
    passed(verify());
    await writeFile(path.join(packet, "unexpected.txt"), "synthetic canary");
    assert.notEqual(verify().status, 0);
    await rm(path.join(packet, "unexpected.txt"));
    await writeFile(path.join(packet, "source-review.json"), "{}\n");
    assert.notEqual(verify().status, 0);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
