import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: {
    middlewareMode: true,
    hmr: false,
    watch: {
      ignored: [
        "**/.bench-venv/**",
        "**/.bench-cache/**",
        "**/.sites-runtime/**",
        "**/.next/**",
        "**/dist/**",
      ],
    },
  },
});

after(async () => {
  await vite.close();
});

function statePairReferenceFixture() {
  return {
    filename: "reference-model.cif",
    sha256: "a".repeat(64),
    bytes: 4096,
    receptorChain: "R",
    vhhChain: "V",
    structure: {
      sourceFormat: "mmcif",
      coordinateScope: "as-supplied",
      selectedModelId: "1",
      selectedAssembly: null,
      chains: [],
      atoms: [],
    },
  };
}

test("renders the state-pair setup with a strict scientific boundary", async () => {
  const { StatePairPanel } = await vite.ssrLoadModule(
    "/components/state-pair-panel.tsx",
  );
  const html = renderToStaticMarkup(React.createElement(StatePairPanel, {
    reference: statePairReferenceFixture(),
    busy: false,
    onBusyChange: () => {},
  }));

  assert.match(html, /Compare two receptor–VHH coordinate contexts/);
  assert.match(html, /reference-model\.cif/);
  assert.match(html, /Chains R ↔ V/);
  assert.match(html, /optional user-supplied labels—not states inferred by ConfoVHH/);
  assert.match(html, /do not establish binding, affinity, specificity, signaling/);
  assert.match(html, /Exact observed receptor and VHH sequences are required/);
  assert.match(html, /aria-label="Choose a comparison PDB or mmCIF coordinate file"/);
});

test("disables state-pair inputs while another workspace operation is busy", async () => {
  const { StatePairPanel } = await vite.ssrLoadModule(
    "/components/state-pair-panel.tsx",
  );
  const html = renderToStaticMarkup(React.createElement(StatePairPanel, {
    reference: statePairReferenceFixture(),
    busy: true,
    onBusyChange: () => {},
  }));

  assert.match(
    html,
    /aria-label="Choose a comparison PDB or mmCIF coordinate file"[^>]*disabled=""/,
  );
  assert.match(html, /Compare coordinate contexts/);
});

test("renders the task-centered researcher workspace and privacy-bounded handoff controls", async () => {
  const {
    AuditDecisionSummary,
    EntryWorkflowCards,
    NotebookPanel,
    ResearchContextPanel,
    WorkspaceNavigator,
  } = await vite.ssrLoadModule("/components/research-workspace.tsx");
  const brief = {
    band: "retain-for-comparison",
    title: "Retain this coordinate pose for comparative review",
    summary: "Coordinate evidence only.",
    reviewItems: [],
    evidenceGaps: ["No experiment is represented."],
    nextActions: ["Validate experimentally."],
    boundary: "ConfoVHH does not establish binding, affinity, specificity, stability, signaling, membrane compatibility, receptor-state identity, or conformational selectivity.",
  };
  const workflow = { paeAttached: true, ensemblePoseCount: 3, pairedContextCompared: false };
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(WorkspaceNavigator, {
      hasStructure: true,
      hasAudit: true,
      ensemblePoseCount: 3,
      pairedContextCompared: false,
    }),
    React.createElement(ResearchContextPanel, {
      context: { studyName: "", receptorName: "", candidateId: "", coordinateContext: "", intendedFootprint: "", notes: "" },
      onChange: () => {},
    }),
    React.createElement(AuditDecisionSummary, {
      brief,
      workflow,
      onSaveNotebook: () => {},
      onExportDossier: () => {},
      onExportMarkdown: () => {},
    }),
    React.createElement(NotebookPanel, {
      entries: [],
      onRemove: () => {},
      onClear: () => {},
      onExport: () => {},
      onImportText: () => {},
    }),
    React.createElement(EntryWorkflowCards, { onDemo: () => {} }),
  ));

  assert.match(html, /Research workflow/);
  assert.match(html, /Optional metadata for the handoff dossier/);
  assert.match(html, /No composite score/);
  assert.match(html, /Export complete dossier/);
  assert.match(html, /Lab-note Markdown/);
  assert.match(html, /does not automatically copy loaded coordinates, parsed sequences, PAE matrices, or residue-contact tables/);
  assert.match(html, /Clear all/);
  assert.match(html, /Audit one coordinate pose/);
  assert.match(html, /Compare seeds or poses/);
});

test("keeps unavailable workflow stages non-interactive until a reference audit exists", async () => {
  const { WorkspaceNavigator } = await vite.ssrLoadModule("/components/research-workspace.tsx");
  const html = renderToStaticMarkup(React.createElement(WorkspaceNavigator, {
    hasStructure: false,
    hasAudit: false,
    ensemblePoseCount: 0,
    pairedContextCompared: false,
  }));
  assert.match(html, /href="#coordinate-setup"/);
  assert.doesNotMatch(html, /href="#audit-results"|href="#ensemble-comparison"|href="#paired-context"|href="#handoff"/);
  assert.equal((html.match(/aria-disabled="true"/g) ?? []).length, 4);
});

test("renders directional PAE views with an accessible non-binding boundary", async () => {
  const { PaeExplorer } = await vite.ssrLoadModule("/components/pae-explorer.tsx");
  const structure = {
    chains: [
      { id: "R", residueCount: 1 },
      { id: "V", residueCount: 1 },
    ],
  };
  const pae = {
    matrix: new Float32Array([0, 2, 8, 0]),
    residueCount: 2,
    maxPaeAngstrom: 31.75,
    sourceFormat: "raw matrix",
    filename: "pae.json",
  };
  const audit = {
    contacts: [{ receptorResidueOrder: 1, vhhResidueOrder: 1 }],
    contactPairCount: 1,
    receptorFrameToVhhPaeMedianAngstrom: 2,
    receptorFrameToVhhPaeP90Angstrom: 2,
    vhhFrameToReceptorPaeMedianAngstrom: 8,
    vhhFrameToReceptorPaeP90Angstrom: 8,
    interfacePaeMedianAngstrom: 8,
    lowPaeContactShare: 1,
  };
  const html = renderToStaticMarkup(React.createElement(PaeExplorer, {
    pae,
    structure,
    receptorChain: "R",
    vhhChain: "V",
    audit,
  }));
  assert.match(html, /Cross-chain PAE explorer/);
  assert.match(html, /Receptor frame → VHH/);
  assert.match(html, /VHH frame → receptor/);
  assert.match(html, /transposed to the shared display axes/);
  assert.match(html, /at most 240 evenly sampled contact markers/);
  assert.match(html, /Confidence context—not a binding score/);
  assert.match(html, /role="img"/);
});

test("renders native prediction-run intake with bounded, review-first controls", async () => {
  const { PredictionRunIntake } = await vite.ssrLoadModule(
    "/components/prediction-run-intake.tsx",
  );
  const html = renderToStaticMarkup(React.createElement(PredictionRunIntake, {
    currentCoordinateSha256: null,
    currentStructure: null,
    currentAudit: null,
    receptorChain: "",
    vhhChain: "",
    chainConfirmed: false,
    topologyAnnotation: null,
    topologyAnnotationError: null,
    onOpenPose: async () => {},
  }));

  assert.match(html, /Prediction-run batch audit/);
  assert.match(html, /does not accept FASTA sequences or run a structure predictor/);
  assert.match(html, /Four-step prediction-run workflow/i);
  assert.match(html, /Choose prediction folder/);
  assert.match(html, /Choose multiple files/);
  assert.match(html, /Scan up to 12 poses locally/);
  assert.match(html, /review every proposed PAE association/);
  assert.match(html, /Files stay in this tab and are not uploaded/);
  assert.match(html, /Filename matching proposes an association; it never proves model identity or residue order/);

  const source = await readFile(path.join(root, "components", "prediction-run-intake.tsx"), "utf8");
  assert.match(source, /await onOpenPose\(\{ coordinate, pae: null \}\)/);
  assert.match(source, /canAcceptPredictionRunWorkerEvent/);
  assert.match(source, /nextPredictionRunProgress/);
  assert.match(source, /aria-label="Prediction-run audit progress"/);
  assert.match(source, /id="prediction-run-results" tabIndex=\{-1\}/);
  assert.match(source, /Draft changed after this run completed/);
  assert.match(source, /chainSelection: \{ receptor: pose\.chains\.receptor, vhh: pose\.chains\.vhh \}/);
  assert.match(source, /Prediction-run \$\{format\.toUpperCase\(\)\} export failed/);
  assert.match(source, /pose\.associationBasis === "unresolved" \? "unresolved" : "coordinate-only"/);
  assert.match(source, /PAE decision required/);
  assert.match(source, /<TableHead>Pose<\/TableHead><TableHead>Researcher decision<\/TableHead><TableHead>Recurrence<\/TableHead>/);
});

test("renders user-annotated topology as an optional non-inferential check", async () => {
  const {
    EMPTY_TOPOLOGY_ANNOTATION,
    TopologyAnnotationPanel,
  } = await vite.ssrLoadModule("/components/topology-annotation.tsx");
  const html = renderToStaticMarkup(React.createElement(TopologyAnnotationPanel, {
    structure: { chains: [], atoms: [] },
    receptorChain: "R",
    audit: { contacts: [], contactPairCount: 0 },
    value: EMPTY_TOPOLOGY_ANNOTATION,
    onChange: () => {},
  }));

  assert.match(html, /Annotated receptor-footprint consistency/);
  assert.match(html, /researcher-supplied residue classes only/);
  assert.match(html, /Intended receptor contact side/);
  assert.match(html, /No membrane or state inference/);
  assert.match(html, /does not infer or validate a membrane plane/i);
});

async function readCssTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readCssTree(entryPath);
      }
      return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

test("emits ConfoVHH interaction and reduced-motion styles", async () => {
  const css = await readCssTree(path.join(root, "dist"));

  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(css, /structure-svg/);
  assert.match(css, /touch-action:\s*none/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("production audit worker embeds the IMGT WASM without a Node filesystem loader", async () => {
  const assetsDirectory = path.join(root, "dist", "client", "assets");
  const assets = await readdir(assetsDirectory);
  const workerAsset = assets.find((name) => /^audit-worker-.*\.js$/.test(name));
  assert.ok(workerAsset, "expected a production audit-worker asset");
  const source = await readFile(path.join(assetsDirectory, workerAsset), "utf8");

  assert.doesNotMatch(source, /__dirname|readFileSync/);
  assert.match(source, /Uint8Array\.from\(atob/);
});

test("development and production transforms expose immunum as named ESM", async () => {
  const config = await readFile(path.join(root, "vite.config.ts"), "utf8");
  assert.match(config, /const commonJsExport = "exports\.Annotator = Annotator;"/);
  assert.match(config, /transformedCode = code\.replace\(commonJsExport, "export \{ Annotator \};"\)/);
  assert.match(config, /return transformedCode\.replace\(`\$\{nodeLoader\}\\n\$\{wasmRuntime\}`/);
  assert.match(config, /plugins: \(\) => \[immunumWorkerWasmPlugin\(true\)\]/);
});

test("production page bundles never instantiate the IMGT WASM during SSR or hydration", async () => {
  const bundleDirectories = [
    path.join(root, "dist", "server", "ssr", "assets"),
    path.join(root, "dist", "client", "assets"),
  ];
  let pageBundles = 0;
  for (const directory of bundleDirectories) {
    const assets = await readdir(directory);
    const pages = assets.filter((name) => /^page-.*\.js$/.test(name));
    assert.ok(pages.length > 0, `expected a production page asset in ${directory}`);
    for (const page of pages) {
      pageBundles += 1;
      const source = await readFile(path.join(directory, page), "utf8");
      assert.doesNotMatch(source, /WebAssembly\.Module/);
      assert.doesNotMatch(source, /Uint8Array\.from\(atob/);
      assert.match(source, /IMGT numbering is available only inside the ConfoVHH audit worker/);
    }
  }
  assert.equal(pageBundles, 2);
});

test("workspace source preserves raw-byte provenance and bounded worker handoff", async () => {
  const source = await readFile(path.join(root, "app", "page.tsx"), "utf8");
  assert.match(source, /MAX_COORDINATE_FILE_BYTES = 12 \* 1024 \* 1024/);
  assert.match(source, /MAX_ENSEMBLE_TOTAL_BYTES = 48 \* 1024 \* 1024/);
  assert.match(source, /await file\.arrayBuffer\(\)/);
  assert.match(source, /import \{ sha256Hex \} from "@\/lib\/sha256"/);
  assert.match(source, /hex: await sha256Hex\(bytes\)/);
  assert.match(source, /new TextDecoder\("utf-8", \{ fatal: true \}\)/);
  assert.match(source, /matrix: job\.pae\.matrix\.slice\(\)/);
  assert.match(source, /\[paeForWorker\.matrix\.buffer\]/);
  assert.ok((source.match(/worker\.onmessageerror/g) ?? []).length >= 4);
  assert.ok((source.match(/event\.currentTarget\.value = ""/g) ?? []).length >= 3);
  assert.match(source, /cleanupScheduled = false/);
  assert.match(source, /finally \{/);
  assert.match(source, /URL\.revokeObjectURL\(url\)/);
  assert.match(source, /createSingleAuditExportReport/);
  assert.match(source, /MAX_VIEWPORT_TRACE_POINTS_PER_CHAIN = 1_500/);
  assert.match(source, /MAX_VIEWPORT_INTERFACE_MARKERS = 500/);
  assert.match(source, /deterministicViewportSample/);
  assert.match(source, /viewportTracePath/);
  assert.match(source, /audit metrics and exports use the complete parsed coordinates/);
  assert.match(source, /<path/);
  assert.doesNotMatch(source, /<polyline/);
});

test("workspace source preserves accessibility, cancellation, replacement, and local-summary privacy contracts", async () => {
  const source = await readFile(path.join(root, "app", "page.tsx"), "utf8");
  assert.match(source, /className="skip-link"/);
  assert.match(source, /id="coordinate-setup" tabIndex=\{-1\}/);
  assert.match(source, /aria-busy=\{Boolean\(loading \|\| predictionRunStatus\.busy\)\}/);
  assert.match(source, /id="audit-results" tabIndex=\{-1\}/);
  assert.match(source, /resultsRef\.current\?\.focus/);
  assert.match(source, /Cancel current background operation/i);
  assert.match(source, /Replace the current coordinate file/i);
  assert.match(source, /never uploaded or written to the local summary notebook/i);
  assert.ok((source.match(/180_000/g) ?? []).length >= 4);
  assert.ok((source.match(/unexpected response type/g) ?? []).length >= 4);
  assert.ok((source.match(/if \(finished \|\| response\.requestId !== requestId\) return/g) ?? []).length >= 4);
  assert.match(source, /AlertDialogTitle>Clear the current coordinate analysis/);
  assert.match(source, /setPredictionRunResetToken\(\(value\) => value \+ 1\)/);
  assert.match(source, /setCancelToken\(\(value\) => value \+ 1\)/);
  assert.match(source, /resetToken=\{predictionRunResetToken\}/);
  assert.match(source, /onStatusChange=\{setPredictionRunStatus\}/);

  const paeStart = source.indexOf("const readPaeFile = async");
  const paeRead = source.indexOf("const bytes = await file.arrayBuffer()", paeStart);
  const paeCatch = source.indexOf("} catch (caught) {", paeRead);
  const auditStart = source.indexOf("const runAudit = async");
  const auditTry = source.indexOf("try {", auditStart);
  const ensembleStart = source.indexOf("const runEnsemble = async");
  const ensembleTry = source.indexOf("try {", ensembleStart);
  assert.ok(paeStart >= 0 && paeRead > paeStart && paeCatch > paeRead);
  assert.doesNotMatch(source.slice(paeStart, paeRead), /setAudit\(null\)|setEnsemble\(null\)/);
  assert.doesNotMatch(source.slice(paeCatch, source.indexOf("} finally", paeCatch)), /setPae\(null\)|setAudit\(null\)|setEnsemble\(null\)/);
  assert.doesNotMatch(source.slice(auditStart, auditTry), /setAudit\(null\)|setEnsemble\(null\)/);
  assert.doesNotMatch(source.slice(ensembleStart, ensembleTry), /setEnsemble\(null\)/);

  const css = await readFile(path.join(root, "app", "globals.css"), "utf8");
  assert.match(css, /\.skip-link/);
  assert.match(css, /\.button-file-label:focus-within/);
  assert.match(css, /\.workflow-navigator/);
  assert.match(css, /\.pae-heatmap-grid/);
});

test("viewport sampling and one-path trace construction remain deterministic and bounded", async () => {
  const {
    deterministicViewportSample,
    viewportTracePath,
    MAX_VIEWPORT_TRACE_POINTS_PER_CHAIN,
    MAX_VIEWPORT_INTERFACE_MARKERS,
  } = await vite.ssrLoadModule("/app/page.tsx");
  const source = Array.from({ length: 100_003 }, (_, index) => index);
  const first = deterministicViewportSample(source, MAX_VIEWPORT_TRACE_POINTS_PER_CHAIN);
  const second = deterministicViewportSample(source, MAX_VIEWPORT_TRACE_POINTS_PER_CHAIN);
  assert.equal(first.length, 1_500);
  assert.deepEqual(first, second);
  assert.equal(first[0], 0);
  assert.equal(first.at(-1), source.at(-1));
  assert.equal(deterministicViewportSample(source, MAX_VIEWPORT_INTERFACE_MARKERS).length, 500);
  assert.deepEqual(deterministicViewportSample(source, 0), []);
  assert.throws(() => deterministicViewportSample(source, -1), /non-negative safe integer/);

  const points = [
    { x: 1, y: 2, key: "R:1", segmentId: 0, interface: false },
    { x: 3, y: 4, key: "R:2", segmentId: 0, interface: true },
    { x: 5, y: 6, key: "R:9", segmentId: 1, interface: false },
  ];
  assert.equal(viewportTracePath(points), "M1.00,2.00 L3.00,4.00 M5.00,6.00");

  const pageSource = await readFile(path.join(root, "app", "page.tsx"), "utf8");
  const boundedSampling = pageSource.indexOf("traces: completeTraces.map");
  const pointerRotation = pageSource.indexOf("const rotate =", boundedSampling);
  assert.ok(boundedSampling >= 0 && pointerRotation > boundedSampling);
  assert.match(pageSource, /rotatedTraces = viewportModel\.traces\.map/);
});

test("public demo response reading is byte-bounded before parsing", async () => {
  const { readBoundedResponseBytes } = await vite.ssrLoadModule("/app/page.tsx");
  const payload = new Uint8Array([1, 2, 3, 4, 5]);
  const accepted = await readBoundedResponseBytes(
    new Response(payload, { headers: { "content-length": "5" } }),
    5,
    "Fixture",
  );
  assert.deepEqual([...new Uint8Array(accepted)], [...payload]);

  await assert.rejects(
    readBoundedResponseBytes(
      new Response("x", { headers: { "content-length": "12582913" } }),
      12 * 1024 * 1024,
      "The public 3P0G demo",
    ),
    /larger than the 12 MiB browser-analysis limit/,
  );
  await assert.rejects(
    readBoundedResponseBytes(
      new Response("x", { headers: { "content-length": "not-a-number" } }),
      12 * 1024 * 1024,
      "Fixture",
    ),
    /invalid Content-Length/,
  );

  const streamed = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4]));
      controller.enqueue(new Uint8Array([5, 6, 7, 8]));
      controller.close();
    },
  });
  await assert.rejects(
    readBoundedResponseBytes(new Response(streamed), 7, "Fixture"),
    /larger than the 12 MiB browser-analysis limit/,
  );
  await assert.rejects(
    readBoundedResponseBytes(new Response(), -1, "Fixture"),
    /non-negative safe integer/,
  );
});

test("workspace export controls, errors, provenance, and method labels are explicit", async () => {
  const source = await readFile(path.join(root, "app", "page.tsx"), "utf8");
  for (const label of [
    "Export accepted ensemble poses as CSV",
    "Export ensemble report as JSON",
    "Clear ensemble comparison",
  ]) {
    assert.match(source, new RegExp(`aria-label="${label}"`));
  }
  assert.match(source, /Accepted poses CSV/);
  assert.match(source, /role="alert"/);
  assert.match(source, /aria-live="assertive"/);
  assert.match(source, /Audit export failed:/);
  assert.match(source, /Ensemble \$\{format\.toUpperCase\(\)\} export failed:/);
  assert.match(source, /SHA-256 prefix \$\{pose\.sha256\.slice\(0, 12\)\}…/);
  assert.match(source, /Full SHA-256:/);
  assert.match(source, /<dt>SASA orientation<\/dt>/);
  assert.match(source, /<dt>SASA frame algorithm<\/dt>/);
});

test("application text styles do not render below the ten-pixel floor", async () => {
  const css = await readFile(path.join(root, "app", "globals.css"), "utf8");
  const sizes = [...css.matchAll(/font-size:\s*(0?\.\d+)rem/g)]
    .map((match) => Number(match[1]));
  assert.ok(sizes.length > 0);
  assert.deepEqual(sizes.filter((size) => size < 0.625), []);
});

test("ten-pixel workflow and PAE labels meet WCAG AA contrast", async () => {
  const css = await readFile(path.join(root, "app", "globals.css"), "utf8");
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrast = (foreground, background) => {
    const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
    return (lighter + 0.05) / (darker + 0.05);
  };

  assert.match(css, /\.workflow-navigator small \{[\s\S]*?color: #71877e/);
  assert.match(css, /\.pae-summary-grid small \{[^}]*color: #71877e/);
  assert.match(css, /\.pae-axis \{[^}]*color: #71877e/);
  assert.doesNotMatch(css, /\.workflow-navigator \.workflow-step-locked \{[^}]*opacity:/);
  for (const background of ["#0d1412", "#0d1513", "#111816"]) {
    assert.ok(contrast("#71877e", background) >= 4.5);
  }
});

test("project and test Vite watchers ignore generated and benchmark trees", async () => {
  const config = await readFile(path.join(root, "vite.config.ts"), "utf8");
  const testSource = await readFile(path.join(root, "tests", "ui-components.test.mjs"), "utf8");
  for (const ignoredTree of [".bench-venv", ".bench-cache", ".sites-runtime", ".next", "dist"]) {
    assert.match(config, new RegExp(`"\\*\\*/${ignoredTree.replace(".", "\\.")}/\\*\\*"`));
    assert.match(testSource, new RegExp(`"\\*\\*/${ignoredTree.replace(".", "\\.")}/\\*\\*"`));
  }
});

test("forwards progress semantics to the primitive", async () => {
  const { Progress } = await vite.ssrLoadModule("/components/ui/progress.tsx");
  const html = renderToStaticMarkup(React.createElement(Progress, { value: 37 }));

  assert.match(html, /aria-valuenow="37"/);
  assert.match(html, /aria-valuetext="37%"/);
  assert.match(html, /data-state="loading"/);
});

test("renders the release record with exact results and an explicit claim boundary", async () => {
  const { ValidationRecord } = await vite.ssrLoadModule(
    "/components/validation-record.tsx",
  );
  const html = renderToStaticMarkup(React.createElement(ValidationRecord));
  assert.match(html, /06 · Release evidence/);
  assert.match(html, /17\/17/);
  assert.match(html, /5\/5/);
  assert.match(html, /360\/360/);
  assert.match(html, /same-VHH cross-context inventory pairs/);
  assert.match(html, />0\.688</);
  assert.match(html, />0\.773</);
  assert.match(html, /Post-label regression replay passed—not new validation/);
  assert.match(html, /all 20 controls\/cross-checks passed/);
  assert.match(html, /adds no independent performance evidence/);
  assert.match(html, /No holdout dataset exists for this release/);
  assert.match(html, /none has been assembled, labeled, frozen, opened, or evaluated/);
});

test("emits chart themes for the starter's media dark mode", async () => {
  const { ChartStyle } = await vite.ssrLoadModule("/components/ui/chart.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ChartStyle, {
      id: "contract",
      config: {
        latency: { theme: { light: "#ffffff", dark: "#000000" } },
      },
    }),
  );

  assert.match(html, /\[data-chart=contract\]/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(html, /\.dark/);
});

test("renders sidebar skeletons deterministically", async () => {
  const { SidebarMenuSkeleton } = await vite.ssrLoadModule(
    "/components/ui/sidebar.tsx",
  );
  const first = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));
  const second = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));

  assert.equal(first, second);
  assert.match(first, /--skeleton-width:70%/);
});
