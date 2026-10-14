#!/usr/bin/env node
// Menjalankan simulator OLT HSGQ mandiri: node scripts/mock-hsgq-server.mjs
// Env: MOCK_OLT_PORT (default 9080), MOCK_OLT_USER, MOCK_OLT_PASSWORD (default admin/admin).
import { register } from "tsx/esm/api";

register();
const { createHsgqSimulator } = await import("../src/lib/olt/hsgq-simulator.ts");

const sim = createHsgqSimulator({
  port: Number(process.env.MOCK_OLT_PORT ?? 9080),
  username: process.env.MOCK_OLT_USER,
  password: process.env.MOCK_OLT_PASSWORD,
});
await sim.ready;
console.log(`Simulator OLT HSGQ berjalan di ${sim.url} (kontrol: POST /_control/fault, /_control/reset)`);

const stop = async () => {
  await sim.close();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
