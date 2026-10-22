import {
  executePredictionRunAuditJob,
  extractNativePredictionPae,
} from "./prediction-run-jobs.ts";
import {
  parsePredictionRunWorkerRequest,
  recoverPredictionRunRequestId,
  type PredictionRunWorkerResponse,
} from "./prediction-run-worker-protocol.ts";

const workerScope = self as unknown as {
  postMessage: (message: PredictionRunWorkerResponse, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
};

workerScope.onmessage = (event) => {
  const requestId = recoverPredictionRunRequestId(event.data);
  try {
    const request = parsePredictionRunWorkerRequest(event.data);
    if (request.type === "parse-native-pae") {
      const parsed = extractNativePredictionPae(request.job.source, request.job.structure);
      workerScope.postMessage({
        requestId: request.requestId,
        type: "native-pae-result",
        pae: parsed.pae,
        mapping: parsed.mapping,
      }, [parsed.pae.matrix.buffer]);
      return;
    }
    const result = executePredictionRunAuditJob(request.job, (progress) => {
      workerScope.postMessage({ requestId: request.requestId, type: "progress", ...progress });
    });
    workerScope.postMessage({ requestId: request.requestId, type: "result", result });
  } catch (caught) {
    workerScope.postMessage({
      requestId,
      type: "error",
      error: caught instanceof Error ? caught.message : "Prediction-run audit could not be completed.",
    });
  }
};
