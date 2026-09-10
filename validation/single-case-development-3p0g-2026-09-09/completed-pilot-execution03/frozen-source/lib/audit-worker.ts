import {
  executeEnsembleAuditJob,
  executeParseCoordinateJob,
  executeParsePaeJob,
  executeSingleAuditJob,
  executeStatePairAuditJob,
} from "./audit-jobs.ts";
import {
  parseAuditWorkerRequest,
  recoverAuditWorkerRequestId,
  type AuditWorkerRequest,
  type AuditWorkerResponse,
} from "./audit-worker-protocol.ts";
/*
 * Keep request dispatch synchronous inside one message turn. An exception is
 * converted to a response and does not replace or disable this handler, so a
 * malformed request cannot make the long-lived worker unusable.
 */

const workerScope = self as unknown as {
  postMessage: (message: AuditWorkerResponse, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
};

workerScope.onmessage = (event) => {
  const raw = event.data;
  const requestId = recoverAuditWorkerRequestId(raw);
  try {
    const request: AuditWorkerRequest = parseAuditWorkerRequest(raw);
    if (request.type === "parse-coordinate") {
      workerScope.postMessage({
        requestId: request.requestId,
        type: "parse-result",
        structure: executeParseCoordinateJob(request.job),
      });
      return;
    }
    if (request.type === "parse-pae") {
      const pae = executeParsePaeJob(request.job);
      workerScope.postMessage({
        requestId: request.requestId,
        type: "pae-result",
        pae,
      }, [pae.matrix.buffer]);
      return;
    }
    if (request.type === "single") {
      workerScope.postMessage({
        requestId: request.requestId,
        type: "single-result",
        audit: executeSingleAuditJob(request.job),
      });
      return;
    }
    if (request.type === "state-pair") {
      workerScope.postMessage({
        requestId: request.requestId,
        type: "state-pair-result",
        result: executeStatePairAuditJob(request.job),
      });
      return;
    }
    if (request.type === "ensemble") {
      const result = executeEnsembleAuditJob(
        request.job,
        (completed, total, filename) => workerScope.postMessage({
          requestId: request.requestId,
          type: "progress",
          completed,
          total,
          filename,
        }),
      );
      workerScope.postMessage({
        requestId: request.requestId,
        type: "ensemble-result",
        result,
      });
      return;
    }
    throw new Error("The background audit request type is unsupported.");
  } catch (caught) {
    workerScope.postMessage({
      requestId,
      type: "error",
      error: caught instanceof Error ? caught.message : "The background audit could not be completed.",
    });
  }
};
