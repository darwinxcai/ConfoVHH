import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAuditWorkerRequest,
  recoverAuditWorkerRequestId,
} from "../lib/audit-worker-protocol.ts";

const SIMPLE_PDB = [
  "ATOM      1   CA ALA A   1       0.000   0.000   0.000  1.00 85.00           C",
  "ATOM      2   CA GLY B   1       3.000   0.000   0.000  1.00 85.00           C",
].join("\n");

test("worker protocol validates request envelopes without trusting a request identifier", () => {
  assert.equal(recoverAuditWorkerRequestId(null), -1);
  assert.equal(recoverAuditWorkerRequestId({ requestId: -3 }), -1);
  assert.equal(recoverAuditWorkerRequestId({ requestId: 7 }), 7);
  assert.throws(() => parseAuditWorkerRequest(null), /must be an object/i);
  assert.throws(
    () => parseAuditWorkerRequest({ requestId: -1, type: "single", job: {} }),
    /identifier is invalid/i,
  );
  assert.throws(
    () => parseAuditWorkerRequest({ requestId: 2, type: "unknown", job: {} }),
    /type is unsupported/i,
  );
  assert.throws(
    () => parseAuditWorkerRequest({ requestId: 3, type: "parse-coordinate", job: null }),
    /job must be an object/i,
  );
});

test("worker reports malformed requests and remains reusable for a valid request", async () => {
  const messages = [];
  const priorSelf = globalThis.self;
  const mockWorker = {
    onmessage: null,
    postMessage(message) {
      messages.push(message);
    },
  };
  globalThis.self = mockWorker;
  try {
    await import(`../lib/audit-worker.ts?worker-test=${Date.now()}`);
    const handler = mockWorker.onmessage;
    assert.equal(typeof handler, "function");

    handler({ data: null });
    handler({ data: { requestId: 5, type: "unknown", job: {} } });
    handler({ data: { requestId: 6, type: "parse-coordinate", job: null } });
    handler({
      data: {
        requestId: 7,
        type: "parse-coordinate",
        job: { filename: "valid.pdb", text: SIMPLE_PDB },
      },
    });

    assert.deepEqual(messages.slice(0, 3), [
      { requestId: -1, type: "error", error: "The background audit request must be an object." },
      { requestId: 5, type: "error", error: "The background audit request type is unsupported." },
      { requestId: 6, type: "error", error: "The background audit request job must be an object." },
    ]);
    assert.equal(messages[3].requestId, 7);
    assert.equal(messages[3].type, "parse-result");
    assert.equal(messages[3].structure.atoms.length, 2);
    assert.strictEqual(mockWorker.onmessage, handler);
  } finally {
    if (priorSelf === undefined) delete globalThis.self;
    else globalThis.self = priorSelf;
  }
});
