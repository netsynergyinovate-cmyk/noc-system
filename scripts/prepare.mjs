import { assertNode, prepareEnvironment, runNpm } from "./lib.mjs";

try {
  assertNode();
  await prepareEnvironment();
  // `npm run all:server`: DB server hanya-baca lewat tunnel; migrasi ke produksi hanya lewat deploy.
  if (process.env.NOC_READONLY_DB !== "1") {
    runNpm(["run", "db:up"]);
    runNpm(["run", "db:migrate"]);
  }
} catch (error) {
  console.error(`Setup needs attention: ${error.message}`);
  process.exitCode = 1;
}
