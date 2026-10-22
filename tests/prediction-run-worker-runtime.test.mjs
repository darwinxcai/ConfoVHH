import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function findUniquePredictionWorkerAsset() {
  const matches = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (/^prediction-run-worker-.*\.js$/.test(entry.name)) matches.push(entryPath);
    }
  }
  await visit(path.join(root, "dist", "client"));
  assert.equal(matches.length, 1, "expected exactly one production prediction-run-worker asset");
  return matches[0];
}

function atomLine({ serial, chain, residue, x, y, residueName }) {
  return [
    "ATOM".padEnd(6), String(serial).padStart(5), " ", " CA ", " ", residueName, " ", chain,
    String(residue).padStart(4), "    ", x.toFixed(3).padStart(8), y.toFixed(3).padStart(8),
    "   0.000", "  1.00", "80.00", "          C",
  ].join("");
}

function coordinateFixture() {
  const lines = ["TITLE     PRODUCTION PREDICTION RUN WORKER"];
  let serial = 1;
  for (const [chain, y, residueName] of [["R", 0, "ALA"], ["V", 3.4, "CYS"]]) {
    for (let residue = 1; residue <= 4; residue += 1) {
      lines.push(atomLine({
        serial: serial++,
        chain,
        residue,
        x: residue * 3.8,
        y,
        residueName,
      }));
    }
  }
  lines.push("END");
  return lines.join("\n");
}

test("production prediction-run worker boots and audits one coordinate-only pose", async (context) => {
  const workerAsset = await findUniquePredictionWorkerAsset();
  const assetUrl = pathToFileURL(workerAsset).href;
  const wrapper = `
    import { parentPort } from "node:worker_threads";
    globalThis.self = {
      postMessage: (message, transfer) => parentPort.postMessage(message, transfer),
      onmessage: null,
    };
    await import(${JSON.stringify(assetUrl)});
    parentPort.on("message", (data) => globalThis.self.onmessage({ data }));
    parentPort.postMessage({ ready: true });
  `;
  const worker = new Worker(
    new URL(`data:text/javascript,${encodeURIComponent(wrapper)}`),
    { type: "module" },
  );
  context.after(() => worker.terminate());

  const coordinate = coordinateFixture();
  const coordinateBytes = Buffer.byteLength(coordinate);
  const coordinateSha256 = createHash("sha256").update(coordinate).digest("hex");
  const requestId = 17;
  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("production prediction-run worker timed out")),
      10_000,
    );
    worker.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.on("message", (message) => {
      if (message.ready) {
        worker.postMessage({
          requestId,
          type: "prediction-run",
          job: {
            poses: [{
              id: "pose-runtime",
              provider: "unknown",
              poseKey: null,
              variant: null,
              associationBasis: "none",
              coordinate: {
                id: "coordinate-runtime",
                path: "runtime/pose.pdb",
                filename: "pose.pdb",
                bytes: coordinateBytes,
                sha256: coordinateSha256,
                text: coordinate,
              },
              pae: null,
            }],
            referenceCoordinateFileId: "coordinate-runtime",
            referenceReceptorChain: "R",
            referenceVhhChain: "V",
            paeAssociationsAndOrderConfirmed: false,
            topologyAnnotation: null,
          },
        });
        return;
      }
      if (message.type === "progress") {
        assert.equal(message.requestId, requestId);
        return;
      }
      clearTimeout(timeout);
      resolve(message);
    });
  });

  assert.equal(response.type, "result");
  assert.equal(response.requestId, requestId);
  assert.equal(response.result.counts.selected, 1);
  assert.equal(response.result.counts.coordinateAccepted, 1);
  assert.equal(response.result.poseAudits.length, 1);
});
