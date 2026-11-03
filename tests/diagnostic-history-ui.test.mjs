import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

test("diagnostic-history mengekspor DiagnosticHistory dan mengimplementasikan semua testid serta kontrak", () => {
  const source = readFileSync(
    "src/components/dashboard/diagnostic-history.tsx",
    "utf8",
  );

  // Ekspor komponen
  assert.match(source, /export function DiagnosticHistory/);

  // Testid yang disyaratkan
  assert.ok(source.includes('data-testid="diagnostic-history"'));
  assert.ok(source.includes('data-testid="history-run"'));
  assert.ok(source.includes('data-testid="history-compare"'));
  assert.ok(source.includes('data-testid="history-change"'));
  assert.ok(source.includes('data-testid="history-copy"'));
  assert.ok(source.includes('data-testid="history-attach"'));

  // Testid data-run-id pada item run
  assert.ok(source.includes("data-run-id={r.id}"));

  // Checkbox perbandingan dengan batas maksimal 2
  assert.match(source, /type="checkbox"/);
  assert.match(source, /selectedIds\.length\s*>=\s*2/);

  // Pengurutan waktu sebelum memanggil API perbandingan (lama = before, baru = after)
  assert.match(source, /t1\s*<=\s*t2\s*\?\s*\[r1,\s*r2\]\s*:\s*\[r2,\s*r1\]/);
  assert.match(source, /\/api\/anomalies\/diagnostics\/compare\?before=/);

  // Label pill perbandingan (worse, better, changed, new, gone)
  assert.match(source, /"memburuk"/);
  assert.match(source, /"membaik"/);
  assert.match(source, /"berubah"/);
  assert.match(source, /"baru"/);
  assert.match(source, /"hilang"/);

  // Catatan sameCount temuan yang tidak berubah
  assert.match(source, /temuan lainnya tidak berubah/);

  // Salin ringkasan menggunakan runSummaryText dan status 'Tersalin'
  assert.match(source, /runSummaryText/);
  assert.match(source, /Salin ringkasan/);
  assert.match(source, /Tersalin/);

  // Lampirkan ke tiket dengan error 403 izin menangani alert
  assert.match(source, /Lampirkan ke tiket/);
  assert.match(source, /res\.status\s*===\s*403/);
  assert.match(source, /Butuh izin menangani alert/);
  assert.match(source, /\/api\/anomalies\/diagnostics\/.*\/attach/);

  // Keadaan kosong, memuat, dan galat dalam bahasa Indonesia
  assert.match(source, /Memuat riwayat diagnosa/);
  assert.match(source, /Belum ada riwayat diagnosa/);
  assert.match(source, /Gagal memuat riwayat diagnosa/);
});

test("diagnostic-panel memasang DiagnosticHistory saat pelanggan dipilih", () => {
  const source = readFileSync(
    "src/components/dashboard/diagnostic-panel.tsx",
    "utf8",
  );

  assert.match(source, /import\s*\{\s*DiagnosticHistory\s*\}\s*from/);
  assert.match(source, /<DiagnosticHistory\s+customerId=\{customer\.id\}/);
});

test("detail pelanggan (page.tsx) memasang DiagnosticHistory dengan alerts", () => {
  const source = readFileSync(
    "src/app/(protected)/app/pelanggan/[id]/page.tsx",
    "utf8",
  );

  assert.match(source, /import\s*\{\s*DiagnosticHistory\s*\}\s*from/);
  assert.match(
    source,
    /<DiagnosticHistory\s+customerId=\{detail\.id\}\s+alerts=\{alerts\}/,
  );
});
