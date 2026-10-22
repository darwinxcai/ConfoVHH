import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("state-pair source preserves bounded input, raw-byte provenance, and worker failure paths", async () => {
  const source = await readFile(
    path.join(root, "components", "state-pair-panel.tsx"),
    "utf8",
  );

  assert.match(source, /MAX_COORDINATE_FILE_BYTES = 12 \* 1024 \* 1024/);
  assert.match(source, /await comparisonFile\.arrayBuffer\(\)/);
  assert.match(source, /import \{ sha256Hex \} from "@\/lib\/sha256"/);
  assert.match(source, /const sha256 = \(bytes: ArrayBuffer\): Promise<string> => sha256Hex\(bytes\)/);
  assert.match(source, /new TextDecoder\("utf-8", \{ fatal: true \}\)/);
  assert.match(source, /new URL\("\.\.\/lib\/audit-worker\.ts", import\.meta\.url\)/);
  assert.match(source, /type: "state-pair"/);
  assert.match(source, /response\.requestId !== requestId/);
  assert.match(source, /worker\.onmessageerror/);
  assert.match(source, /workerRef\.current\?\.terminate\(\)/);
  assert.match(source, /ownsBusyRef\.current/);
  assert.match(source, /cancelToken = 0/);
  assert.match(source, /180_000/);
  assert.match(source, /exceeded the three-minute browser time limit/);
  assert.match(source, /unexpected response type/);
  assert.match(source, /workerTimeoutRef/);
  assert.match(source, /operationActiveRef/);
  assert.match(source, /if \(!operationActiveRef\.current\) return/);
  assert.match(source, /finishOperation = \(worker: Worker, requestId: number\): boolean/);
  assert.match(source, /requestIdRef\.current \+= 1/);
  assert.match(source, /if \(!finishOperation\(worker, requestId\)\) return/);

  const compareStart = source.indexOf("const compare = async () =>");
  const comparisonRead = source.indexOf("const bytes = await comparisonFile.arrayBuffer()", compareStart);
  assert.ok(compareStart >= 0 && comparisonRead > compareStart);
  const stagedOperation = source.slice(compareStart, comparisonRead);
  assert.doesNotMatch(stagedOperation, /setResult\(null\)|onResultChange\?\.\(null\)/);
});

test("state-pair source exposes all three optional labels and reproducible exports", async () => {
  const source = await readFile(
    path.join(root, "components", "state-pair-panel.tsx"),
    "utf8",
  );

  for (const label of ["neutral", "active", "inactive"]) {
    assert.match(source, new RegExp(`<SelectItem value="${label}">`));
  }
  assert.ok((source.match(/value=\{UNLABELED\}/g) ?? []).length >= 2);
  assert.match(source, /createStatePairExportReport/);
  assert.match(source, /statePairToCsv/);
  assert.match(source, /confovhh_state_pair\.\$\{format\}/);
  for (const label of [
    "Export paired-coordinate contacts and metrics as CSV",
    "Export paired-coordinate report as JSON",
    "Clear paired-coordinate comparison",
  ]) {
    assert.match(source, new RegExp(`aria-label="${label}"`));
  }
  assert.match(source, /Paired-coordinate \$\{format\.toUpperCase\(\)\} export failed:/);
  assert.match(source, /cleanupScheduled = false/);
  assert.match(source, /URL\.revokeObjectURL\(url\)/);
});

test("browser contact rendering is capped while the complete result remains exportable", async () => {
  const source = await readFile(
    path.join(root, "components", "state-pair-panel.tsx"),
    "utf8",
  );

  assert.match(source, /DISPLAY_CONTACTS_PER_GROUP = 40/);
  assert.ok((source.match(/slice\(0, DISPLAY_CONTACTS_PER_GROUP\)/g) ?? []).length >= 3);
  assert.match(source, /retained in both the JSON and CSV exports/);
  assert.match(source, /comparison minus reference/i);
  assert.match(source, /Possible interchain disulfides/);
  assert.match(source, /Paired coordinate audit complete/);
  assert.match(source, /SHA-256 prefix/);
  assert.match(source, /title=\{pose\.sha256 \?\? undefined\}/);
  assert.match(source, /roundedNumber > 0/);
  assert.match(source, /Positive and negative values are not favorable or unfavorable scores/);
});

test("state-pair UI exposes provenance, policy, numbering, and assertive errors", async () => {
  const source = await readFile(
    path.join(root, "components", "state-pair-panel.tsx"),
    "utf8",
  );

  assert.match(source, /05 · Paired coordinate context/);
  assert.match(
    source,
    /reference\.experimentalMethod !== result\.summary\.comparison\.experimentalMethod/,
  );
  assert.match(source, /reported experimental method/);
  assert.match(source, /<dt>Experimental method<\/dt>/);
  assert.match(source, /<dt>SASA orientation<\/dt>/);
  assert.match(source, /<dt>SASA frame algorithm<\/dt>/);
  assert.match(source, /className="state-pair-error"[\s\S]*?role="alert"[\s\S]*?aria-live="assertive"/);
});
