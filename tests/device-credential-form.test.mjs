import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const input = readFileSync(
  new URL("../src/components/dashboard/secret-credential-input.tsx", import.meta.url),
  "utf8",
);
const board = readFileSync(
  new URL("../src/components/dashboard/device-config-board.tsx", import.meta.url),
  "utf8",
);

test("atribut keamanan input sandi", () => {
  assert.match(input, /type=\{showSecret \? "text" : "password"\}/);
  assert.match(input, /autoComplete = "new-password"/);
  assert.match(input, /autoComplete=\{autoComplete\}/);
  assert.match(input, /spellCheck=\{false\}/);
  assert.match(input, /autoCapitalize="none"/);
  assert.match(input, /className="pr-11"/);
});

test("toggle mata: nama statis, aria-pressed, ikon aria-hidden", () => {
  assert.match(input, /type="button"/);
  assert.match(input, /variant="ghost"/);
  assert.match(input, /aria-label="Tampilkan kata sandi"/);
  assert.match(input, /aria-pressed=\{showSecret\}/);
  assert.match(input, /<EyeOff aria-hidden="true" \/>/);
  assert.match(input, /<Eye aria-hidden="true" \/>/);
});

test("toggle nonaktif saat input kosong", () => {
  assert.match(input, /disabled=\{!value \|\| disabled\}/);
});

test("tidak ada nilai rahasia/dummy yang diinjeksi ke value", () => {
  assert.match(input, /value=\{value\}/);
  // satu-satunya "••••••••" adalah teks status, bukan value input
  const bullets = input.match(/••••••••/g) ?? [];
  assert.equal(bullets.length, 1);
  assert.doesNotMatch(input, /value=\{?["'`]/);
  assert.doesNotMatch(input, /defaultValue/);
  assert.doesNotMatch(input, /useState\((?!false)/);
});

test("indikator hasStoredSecret, placeholder dan help text", () => {
  assert.match(input, /Tersimpan via ENV \$\{envKey\}/);
  assert.match(input, /Kosongkan untuk mempertahankan kata sandi tersimpan/);
  assert.match(input, /Masukkan kata sandi baru/);
  assert.match(input, /Kata sandi lama tetap digunakan jika isian ini dikosongkan\./);
});

test("board: SecretCredentialInput terpasang di dialog edit, mulai kosong", () => {
  assert.match(board, /import \{ SecretCredentialInput \}/);
  const dialog = board.slice(board.indexOf("{editingDevice && ("));
  assert.match(dialog, /<SecretCredentialInput[\s\S]*?id="edit-password"/);
  assert.match(dialog, /value=\{passwordOverride\}/);
  assert.match(dialog, /hasStoredSecret/);
  assert.match(dialog, /envKey=\{editingDevice\.envPassKey\}/);
  assert.match(board, /useState\(""\)/);
  assert.match(board, /setPasswordOverride\(""\);\s*setEditingDevice\(device\)/);
});

test("board: sandi baru tidak masuk state perangkat; kosong mempertahankan", () => {
  assert.match(board, /passwordOverride\.trim\(\)\.length > 0/);
  const save = board.slice(board.indexOf("const handleSaveEdit"), board.indexOf("const getDeviceIcon"));
  assert.doesNotMatch(save, /\.\.\.next[^;]*passwordOverride/);
  assert.doesNotMatch(save, /\$\{passwordOverride\}/);
  assert.doesNotMatch(board, /readOnly/);
});
