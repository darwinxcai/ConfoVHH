import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

function atomLine({ serial, atomName, chain, residueNumber, x, y, z, element }) {
  return [
    "ATOM  ", String(serial).padStart(5), " ", atomName.padStart(4), " ", "ALA", " ", chain,
    String(residueNumber).padStart(4), "    ", x.toFixed(3).padStart(8), y.toFixed(3).padStart(8),
    z.toFixed(3).padStart(8), "  1.00", "80.00", "          ", element.padStart(2),
  ].join("");
}

function coordinateFixture() {
  const lines = ["TITLE     BROWSER ACCEPTANCE FIXTURE"];
  let serial = 1;
  for (const [chain, y] of [["R", 0], ["V", 3.4]]) {
    for (let residueNumber = 1; residueNumber <= 4; residueNumber += 1) {
      const x = residueNumber * 3.8;
      lines.push(atomLine({ serial: serial++, atomName: "N", chain, residueNumber, x: x - 1.1, y, z: 0, element: "N" }));
      lines.push(atomLine({ serial: serial++, atomName: "CA", chain, residueNumber, x, y, z: 0, element: "C" }));
      lines.push(atomLine({ serial: serial++, atomName: "C", chain, residueNumber, x: x + 1.1, y, z: 0.2, element: "C" }));
      lines.push(atomLine({ serial: serial++, atomName: "O", chain, residueNumber, x: x + 1.4, y: y + 0.7, z: 0.4, element: "O" }));
    }
  }
  lines.push("END");
  return lines.join("\n");
}

async function expectNoSeriousAxeViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

test("initial shell is accessible and serves defensive response headers", async ({ page, request }) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const response = await request.get("/");
  expect(response.headers()["content-security-policy"]).toContain("default-src 'self'");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");

  const rejectedWrite = await request.post("/", { data: "unused" });
  expect(rejectedWrite.status()).toBe(405);
  expect(rejectedWrite.headers().allow).toBe("GET, HEAD");
  expect(rejectedWrite.headers()["cache-control"]).toBe("no-store");

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Audit GPCR–VHH coordinate poses/i })).toBeVisible();
  await expect(page.getByText(/without treating ConfoVHH output as.*candidate-selection evidence/i)).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  expect(errors).toEqual([]);
});

test("single-pose entry reflows at a 390-pixel mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Audit GPCR–VHH coordinate poses/i })).toBeVisible();
  await expect(page.getByLabel("Choose a PDB or PDBx/mmCIF coordinate file")).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth > window.innerWidth + 1
  ));
  expect(hasHorizontalOverflow).toBe(false);
  await expectNoSeriousAxeViolations(page);
});

test("local coordinate audit runs in the browser and exports a bound report", async ({ page }) => {
  const errors = [];
  const offOriginRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");

  const applicationOrigin = new URL(page.url()).origin;
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("http") && new URL(url).origin !== applicationOrigin) offOriginRequests.push(url);
  });

  const coordinate = coordinateFixture();
  await page.getByLabel("Choose a PDB or PDBx/mmCIF coordinate file").setInputFiles({
    name: "browser-acceptance.pdb",
    mimeType: "chemical/x-pdb",
    buffer: Buffer.from(coordinate),
  });
  await expect(page.getByText(/2 chains · 8 residues/i)).toBeVisible();
  await page.getByRole("checkbox", { name: /confirmed the selected receptor and VHH chain roles/i }).check();
  await page.getByRole("button", { name: "Run interface audit" }).click();

  const results = page.getByLabel("Interface audit results");
  await expect(results).toBeVisible({ timeout: 60_000 });
  await expect(results).toBeFocused();
  await expect(results.getByText(/Coordinate geometry/i).first()).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Single-pose audit JSON/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/confovhh-product-0\.9\.0_single-pose-audit\.json$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const report = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(report.file).toBe("browser-acceptance.pdb");
  expect(report.structure.sourceFileSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(report.audit.auditAttestation.resultFingerprint).toMatch(/^fnv1a32x2-audit-result:/);

  expect(offOriginRequests).toEqual([]);
  expect(errors).toEqual([]);
});
