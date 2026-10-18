import { db } from "../src/db/index.js";
import {
  runsnetCustomers,
  runsnetInvoices,
  runsnetPayments,
  runsnetSyncLogs,
} from "../src/db/schema/index.js";
import { runRunsnetSync, getRunsnetOverview } from "../src/services/runsnet-billing.service.js";

async function main() {
  console.log("=== 1. Starting Full RunsNet Synchronization Test ===");
  const startTime = Date.now();
  
  const result = await runRunsnetSync();
  console.log(`Sync completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s!`);
  console.log("Result summary:", result);

  console.log("\n=== 2. Querying PostgreSQL Database Overview ===");
  const overview = await getRunsnetOverview();
  console.log("Overview from DB:", JSON.stringify(overview, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL ERROR IN SYNC TEST:", err);
  process.exit(1);
});

