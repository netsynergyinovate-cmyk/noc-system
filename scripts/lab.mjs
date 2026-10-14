// Pengelola lab lokal: npm run lab:up | lab:down | lab:status
// `down` menjaga volume data; tidak pernah memakai --volumes.
import { spawnSync } from "node:child_process";
import { root } from "./lib.mjs";

const commands = {
  up: ["up", "-d", "--wait", "--wait-timeout", "60"],
  down: ["down"],
  status: ["ps"],
  logs: ["logs", "--tail", "100"],
};

const name = process.argv[2];
if (!Object.hasOwn(commands, name)) {
  console.error(`Pakai: node scripts/lab.mjs <${Object.keys(commands).join("|")}>`);
  process.exit(2);
}

const result = spawnSync(
  "docker",
  ["compose", "-f", "compose.lab.yaml", ...commands[name]],
  { cwd: root, stdio: "inherit" },
);
if (result.error) {
  console.error(`Docker tidak bisa dijalankan: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
