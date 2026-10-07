import { createHistoricalReplayContext } from "./historical-replay-context.mjs";

const context = await createHistoricalReplayContext();
try {
  const { verifyIntegrationState } = await context.importModule("scripts/hard-decoy-v3/verify-integration-state.mjs");
  const result = await verifyIntegrationState(context.root);
  console.log(JSON.stringify({
    verification: "Historical evidence replay with archived lock and byte-verified executed numbering implementation",
    currentProductDependencyEnvironmentMatchesHistorical: false,
    ...result,
  }, null, 2));
} finally {
  await context.cleanup();
}
