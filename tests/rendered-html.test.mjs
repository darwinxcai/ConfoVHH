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
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
  const html = await response.text();
  assert.match(html, /ConfoVHH/);
  assert.match(html, /GPCR.{0,20}VHH interface audit/i);
  assert.match(html, /product(?:\s|<!--[^>]*-->)*0\.9\.1/i);
  assert.match(html, /engine(?:\s|<!--[^>]*-->)*0\.5\.0/i);
  assert.match(html, /Prediction-run batch audit/i);
  assert.match(html, /AlphaFold, ColabFold, or Boltz/i);
  assert.match(html, /Research workflow/);
  assert.match(html, /Local summary notebook/);
  assert.match(html, /does not automatically copy loaded coordinates, parsed sequences, PAE matrices, or residue-contact tables/i);
  assert.match(html, /Skip to analysis workspace/);
  assert.match(html, /Start with one pose, a prediction folder, or the worked example/);
  assert.doesNotMatch(html, developmentPreviewMeta);
});

test("production entry rejects write methods before framework routing", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("method-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", { method: "POST", body: "unused" }),
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

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
});
