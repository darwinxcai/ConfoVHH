import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyDesignRecord } from "../scripts/hard-decoy-v3/verify-design-record.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

async function fixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-design-"));
  const root = path.join(temporary, "repo");
  await mkdir(path.join(root, "validation/hard-decoy-holdout-v2/prelabel-census"), { recursive: true });
  await cp(
    path.join(ROOT, "validation/hard-decoy-holdout-v3"),
    path.join(root, "validation/hard-decoy-holdout-v3"),
    { recursive: true },
  );
  await cp(
    path.join(ROOT, "validation/hard-decoy-holdout-v2/prelabel-census/checksums.sha256"),
    path.join(root, "validation/hard-decoy-holdout-v2/prelabel-census/checksums.sha256"),
  );
  for (const filename of [
    "HARD_DECOY_PROTOCOL.md",
    "HARD_DECOY_PROTOCOL_V2.md",
    "HARD_DECOY_PROTOCOL_V3.md",
    "LEAKAGE_COMPONENT_DEVELOPMENT_PROTOCOL.md",
  ]) await cp(path.join(ROOT, filename), path.join(root, filename));
  return { temporary, root, design: path.join(root, "validation/hard-decoy-holdout-v3/design-record") };
}

async function refreshChecksum(design, relative) {
  const manifestPath = path.join(design, "checksums.sha256");
  const digest = createHash("sha256").update(await readFile(path.join(design, relative))).digest("hex");
  const rows = (await readFile(manifestPath, "utf8")).trimEnd().split("\n");
  await writeFile(manifestPath, `${rows.map((row) => row.endsWith(`  ${relative}`) ? `${digest}  ${relative}` : row).join("\n")}\n`);
}

test("v3 records the selected oracle design without claiming a frozen request", async () => {
  const result = await verifyDesignRecord(ROOT);
  assert.deepEqual(result, {
    status: "DRAFT",
    selectedDesign: "sealed-one-way-native-epitope-boolean-oracle",
    requiredIndependentGroups: 10,
    screenedProvisionalGroups: 7,
    formallyClearedGroups: 0,
    oracleRequestFrozen: false,
    nativeCoordinatesAccessedByOracle: false,
    dockqLabelsAccessed: false,
    executionAuthorized: false,
  });
});

test("rechecksumming a changed v3 state cannot rewrite the pinned release root", async () => {
  const { temporary, root, design } = await fixture();
  try {
    const filename = path.join(design, "design-state.json");
    const state = JSON.parse(await readFile(filename, "utf8"));
    state.oracleRequestFrozen = true;
    await writeFile(filename, `${JSON.stringify(state, null, 2)}\n`);
    await refreshChecksum(design, "design-state.json");
    await assert.rejects(() => verifyDesignRecord(root), /pinned release root/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("protocol ancestry cannot be self-authenticated after mutation", async () => {
  const { temporary, root, design } = await fixture();
  try {
    const protocolPath = path.join(root, "HARD_DECOY_PROTOCOL_V3.md");
    await writeFile(protocolPath, `${await readFile(protocolPath, "utf8")}\nmutation\n`);
    const digest = createHash("sha256").update(await readFile(protocolPath)).digest("hex");
    const lockPath = path.join(design, "protocol-lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    lock.protocols.find((row) => row.path === "HARD_DECOY_PROTOCOL_V3.md").sha256 = digest;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    await refreshChecksum(design, "protocol-lock.json");
    await assert.rejects(() => verifyDesignRecord(root), /pinned release root/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("unlisted and symlinked v3 package entries fail closed", async () => {
  for (const mode of ["unlisted", "symlink"]) {
    const { temporary, root, design } = await fixture();
    try {
      if (mode === "unlisted") await writeFile(path.join(design, "extra.json"), "{}\n");
      else {
        await unlink(path.join(design, "README.md"));
        await symlink("design-state.json", path.join(design, "README.md"));
      }
      await assert.rejects(() => verifyDesignRecord(root), /inventory drifted|direct file/);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
});

test("FAIL_CLOSED is frozen as target ineligibility, not a selectable graph edge", async () => {
  const contract = JSON.parse(await readFile(path.join(ROOT, "validation/hard-decoy-holdout-v3/design-record/isolation-contract.json"), "utf8"));
  assert.equal(contract.failurePolicy.targetFailure, "signed-FAIL_CLOSED-and-target-mechanically-ineligible");
  assert.equal(contract.failurePolicy.sameVersionRerunForbidden, true);
});
