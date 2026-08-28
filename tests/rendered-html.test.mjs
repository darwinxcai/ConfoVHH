import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders the ConfoVHH application shell without preview-only metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /ConfoVHH/);
  assert.match(html, /GPCR.{0,20}VHH interface audit/i);
  assert.match(html, /product(?:\s|<!--[^>]*-->)*0\.8\.0/i);
  assert.match(html, /Prediction-run batch audit/i);
  assert.match(html, /AlphaFold, ColabFold, or Boltz/i);
  assert.match(html, /Research workflow/);
  assert.match(html, /Local summary notebook/);
  assert.match(html, /does not automatically copy loaded coordinates, parsed sequences, PAE matrices, or residue-contact tables/i);
  assert.match(html, /Skip to analysis workspace/);
  assert.match(html, /Choose the structural question you need to answer/);
  assert.doesNotMatch(html, developmentPreviewMeta);
});
