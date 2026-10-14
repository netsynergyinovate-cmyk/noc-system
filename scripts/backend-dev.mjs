// Menjalankan backend Go untuk pengembangan dengan pengaturan yang sama dengan
// aplikasi Next.js: rahasia tiket login dan origin dashboard dibaca dari
// .env.local, jadi kedua sisi tidak perlu disamakan dengan tangan.
import { spawn } from "node:child_process";
import { assertNode, prepareEnvironment, root } from "./lib.mjs";

assertNode();
// Membuat REALTIME_TOKEN_SECRET di .env.local bila belum ada (nilai yang sudah
// ada tidak disentuh), lalu memuat semuanya ke process.env.
await prepareEnvironment();

const env = { ...process.env };
if (!env.ALLOWED_ORIGINS && env.BETTER_AUTH_URL) {
  // Dashboard dibuka dari BETTER_AUTH_URL; hanya origin itu yang boleh
  // memakai WebSocket dan REST backend.
  env.ALLOWED_ORIGINS = new URL(env.BETTER_AUTH_URL).origin;
}

const child = spawn("go", ["-C", "backend", "run", "./cmd/server"], {
  cwd: root,
  env,
  stdio: "inherit",
});
child.once("error", (error) => {
  console.error(
    error.code === "ENOENT"
      ? "Go belum terpasang. Pasang dari https://go.dev/dl lalu coba lagi."
      : error.message,
  );
  process.exit(1);
});
child.once("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
