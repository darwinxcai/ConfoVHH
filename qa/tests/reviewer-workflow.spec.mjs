import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { verifyReviewerExports } from "../../scripts/paper/verify-reviewer-exports.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

test("paper reviewer workflow preserves role gates, missing evidence and both browser exports", async ({ page, browser }, testInfo) => {
  const directory = await mkdtemp(path.join(tmpdir(), "confovhh-reviewer-browser-"));
  const example = path.join(directory, "example");
  try {
    execFileSync(process.execPath, ["scripts/paper/reviewer-demo.mjs", `--output=${example}`], { cwd: ROOT });
    const receiptBytes = await readFile(path.join(example, "receipt.json"));
    await writeFile(testInfo.outputPath("generator-receipt.json"), receiptBytes);
    const generatedReportBytes = {};
    const browserReportBytes = {};
    const errors = [];
    const unexpectedRequests = [];
    const observedCases = [];
    page.on("pageerror", error => errors.push(error.message));
    const origin = new URL(testInfo.project.use.baseURL).origin;
    page.on("request", request => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) unexpectedRequests.push(request.url());
    });
    await page.goto("/");

    for (const name of ["near", "separated"]) {
      await page.getByLabel(name === "near"
        ? "Choose a PDB or PDBx/mmCIF coordinate file"
        : "Replace the current coordinate file")
        .setInputFiles(path.join(example, `synthetic-${name}.pdb`));
      await expect(page.getByText(/2 chains · 8 residues/i)).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Receptor chain", exact: true })).toHaveText(/^R(?:\s|·)/u);
      await expect(page.getByRole("combobox", { name: "VHH chain", exact: true })).toHaveText(/^V(?:\s|·)/u);
      const confidence = page.getByRole("combobox", { name: "B-factor interpretation" });
      await confidence.click();
      await page.getByRole("option", { name: "Do not interpret as pLDDT", exact: true }).click();
      const roleGate = page.getByRole("checkbox", { name: /confirmed the selected receptor and VHH chain roles/i });
      const run = page.getByRole("button", { name: "Run interface audit", exact: true });
      await expect(roleGate).not.toBeChecked();
      await expect(run).toBeDisabled();
      await roleGate.check();
      await expect(run).toBeEnabled();
      await run.click();
      const results = page.getByLabel("Interface audit results");
      await expect(results).toBeVisible();
      await expect(results).toBeFocused();
      const expected = name === "near" ? 10 : 0;
      await expect(results.locator("article.metric-card").filter({ hasText: "Contact residue pairs" })
        .getByText(String(expected), { exact: true })).toBeVisible();
      for (const label of ["Interface PAE", "Interface pLDDT", "IMGT CDR-contact share", "IMGT CDR3-contact share"]) {
        await expect(results.locator("article.metric-card").filter({ hasText: label })
          .getByText("Unavailable", { exact: true })).toBeVisible();
      }

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download the single-pose audit as JSON" }).click();
      const download = await downloadPromise;
      const destination = testInfo.outputPath(`browser-${name}.json`);
      await download.saveAs(destination);
      browserReportBytes[name] = await readFile(destination);
      generatedReportBytes[name] = await readFile(path.join(example, `synthetic-${name}.audit.json`));
      await writeFile(testInfo.outputPath(`synthetic-${name}.audit.json`), generatedReportBytes[name]);
      await testInfo.attach(`synthetic-browser-${name}.json`, { body: browserReportBytes[name], contentType: "application/json" });
      observedCases.push({ name, roleConfirmationRequired: true, roleInitiallyUnchecked: true,
        newFileClearedPriorConfirmation: name === "separated", displayedContactPairs: expected });
    }
    const comparison = await verifyReviewerExports({ receiptBytes, generatedReportBytes, browserReportBytes });
    expect(unexpectedRequests).toEqual([]);
    expect(errors).toEqual([]);
    const sourceSha256 = {};
    for (const relative of ["app/page.tsx", "qa/tests/reviewer-workflow.spec.mjs", "qa/playwright.config.mjs", "qa/package-lock.json", "scripts/paper/verify-reviewer-exports.mjs"]) {
      sourceSha256[relative] = sha(await readFile(path.join(ROOT, relative)));
    }
    const execution = {
      schemaVersion: "1.0.0", scope: "automated synthetic browser workflow only",
      browserVersion: browser.version(), nodeVersion: process.version, sourceSha256,
      projectName: testInfo.project.name, baseURL: testInfo.project.use.baseURL,
      servedBuildIdentityVerified: false,
      observedCases, offOriginRequests: unexpectedRequests, pageErrors: errors, comparison,
      independentResearcherCompletion: false, biologicalValidation: false,
    };
    const receiptPath = testInfo.outputPath("synthetic-reviewer-browser-receipt.json");
    await writeFile(receiptPath, `${JSON.stringify(execution, null, 2)}\n`);
    await testInfo.attach("synthetic-reviewer-browser-receipt.json", { path: receiptPath, contentType: "application/json" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
