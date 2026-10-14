import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ponytail: `git check-ignore` memakai aturan git asli; keluar 0 = diabaikan, 1 = tidak.
const ignored = (path) =>
  spawnSync("git", ["check-ignore", "-q", "--no-index", path], { cwd: root }).status === 0;

test("berkas .env privat diabaikan git", () => {
  for (const p of [".env", ".env.local", ".env.production", ".env.test.local", "sub/.env.local"]) {
    assert.ok(ignored(p), `${p} harus diabaikan`);
  }
});

test(".env.example tidak diabaikan", () => {
  assert.equal(ignored(".env.example"), false);
});

test("sertifikat dan kunci privat diabaikan git", () => {
  for (const p of ["server.key", "tls/cert.pem", "a/b/ca.crt", "id_rsa.pem"]) {
    assert.ok(ignored(p), `${p} harus diabaikan`);
  }
});

test(".env.example tidak berisi secret berisi nilai", () => {
  const text = readFileSync(join(root, ".env.example"), "utf8");
  const bad = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) continue; // komentar dan baris kosong dilewati
    if (/(_SECRET|_PASSWORD|_KEY|_TOKEN)$/.test(m[1]) && m[2].trim() !== "") bad.push(m[1]);
  }
  assert.deepEqual(bad, []);
  for (const k of ["DEVICE_SECRET", "PPP_WEBHOOK_TOKEN", "WHATSAPP_API_KEY"]) {
    assert.match(text, new RegExp(`^${k}=$`, "m"), `${k}= harus ada dan kosong`);
  }
  assert.match(text.split(/\r?\n/)[0], /PERINGATAN KEAMANAN/);
});
