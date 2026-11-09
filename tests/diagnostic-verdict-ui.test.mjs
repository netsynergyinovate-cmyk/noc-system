import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

test("diagnostic-run-view mengekspor VerdictConclusion dan scopeBadgeLabels", () => {
  const source = readFileSync(
    "src/components/dashboard/diagnostic-run-view.tsx",
    "utf8",
  );

  assert.match(source, /export const scopeBadgeLabels/);
  assert.match(source, /export function VerdictConclusion/);
  assert.match(source, /export function DiagnosticRunView/);

  // Periksa 3 label cakupan (scope badge)
  assert.match(source, /own:\s*"Gangguan pelanggan ini"/);
  assert.match(source, /shared:\s*"Gangguan bersama"/);
  assert.match(source, /unknown:\s*"Cakupan belum dapat dipastikan"/);

  // Periksa testid yang disyaratkan
  assert.ok(source.includes('data-testid="verdict-scope"'));
  assert.ok(source.includes('data-testid="verdict-root"'));
  assert.ok(source.includes('data-testid="verdict-secondary"'));
  assert.ok(source.includes('data-testid="verdict-held"'));

  // Periksa teks peringatan & kalimat penjelas
  assert.match(
    source,
    /Gangguan bersama di sisi hulu: bukan masalah perangkat\s+pelanggan\./,
  );
  assert.match(
    source,
    /Jangan kirim teknisi ke rumah pelanggan sebelum sumber bersama\s+diperiksa\./,
  );
  assert.match(
    source,
    /Dipertahankan dari diagnosa sebelumnya \(anti-flapping\)/,
  );
  assert.match(source, /Temuan terkait/);

  // Periksa pola kalimat sumber akar
  assert.match(
    source,
    /Sumber:\s*\{run\.verdictRoot\.name\}[\s\S]*?\{run\.verdictRoot\.affected\}[\s\S]*?dari[\s\S]*?\{run\.verdictRoot\.served\}[\s\S]*?pelanggan terganggu/,
  );
});

test("diagnostic-run-history menggunakan scope pada status text", () => {
  const source = readFileSync(
    "src/components/dashboard/diagnostic-run-history.tsx",
    "utf8",
  );

  // Memastikan verdictScope diperiksa untuk scope status
  assert.match(source, /r\.verdictScope\s*\?\?\s*\(r\.isSharedFault/);
  assert.match(source, /scope === "shared"\s*\?\s*" \(gangguan bersama\)"/);
  assert.match(source, /"diagnosa per pelanggan ditahan"/);
  assert.match(source, /"tidak ada lapisan bermasalah"/);
});
