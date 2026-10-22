import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || ".");
const { buildDevelopmentComparison } = await import(pathToFileURL(path.join(root, "scripts/hard-decoy-v3/compare-domain-remainder-development.mjs")));
const base = path.join(root, "validation/hard-decoy-holdout-v3");
const ids = new Set("9JRO 9JRT 9JQY 9JQZ 9AU0 9E9S 9EE5 9EI5 9EKH 8ZVZ 8ZW0 9UWD".split(" "));
const rows = (name) => fs.readFileSync(path.join(base, name), "utf8").trim().split("\n").map(JSON.parse);
const json = (name) => JSON.parse(fs.readFileSync(path.join(base, name), "utf8"));
const entries = ["global-text-discovery", "domain-remainder"].flatMap((n) => rows(`${n}-2026-09-04/entries.jsonl`)).filter((e) => ids.has(e.pdbId));
assert.equal(entries.length, ids.size);
const entityScreens = ["global-text-screen", "domain-remainder-screen"].flatMap((n) => rows(`${n}-2026-09-04/entity-screens.jsonl`)).filter((e) => ids.has(e.pdbId));
const required = new Set(entityScreens.map((e) => e.sequenceSha256));
const seqs = new Map();
for (const n of ["global-text-screen", "domain-remainder-screen"]) {
  for (const row of rows(`${n}-2026-09-04/sequence-screens.jsonl`)) {
    if (!required.has(row.sequenceSha256)) continue;
    if (seqs.has(row.sequenceSha256)) assert.deepEqual(seqs.get(row.sequenceSha256).heavyChainDomains, row.heavyChainDomains);
    else seqs.set(row.sequenceSha256, row);
  }
}
const result = buildDevelopmentComparison({ entries, entityScreens, sequenceScreens: [...seqs.values()],
  developmentVhh: rows("vhh-sequence-pregraph-2026-08-29/development-vhh-profiles.jsonl"),
  developmentReceptors: rows("receptor-tm-pregraph-2026-08-30/development-receptor-profiles.jsonl"),
  canonicalProfiles: rows("receptor-tm-pregraph-2026-08-30/candidate-receptor-profiles.jsonl"),
  vhhContract: json("vhh-sequence-contract-2026-08-29.json"),
  receptorContract: json("receptor-tm-contract-2026-08-30.json") });
console.log(JSON.stringify(result));
