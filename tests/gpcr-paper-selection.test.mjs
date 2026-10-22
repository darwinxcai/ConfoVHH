import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("development selection audit preserves complete jobs, fixed thresholds, unfavorable ties and identity", () => {
  const file = fileURLToPath(new URL("./gpcr-paper-selection-test.py", import.meta.url));
  const result = spawnSync("python3", ["-B", file], {
    encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
