import test from "node:test";
import assert from "node:assert/strict";
import { parseBillingScrapeError } from "../src/lib/dashboard/billing-scrape-errors.ts";

const cat = (msg, n) => parseBillingScrapeError(msg, n).category;

test("kredensial ditolak", () => {
  const d = parseBillingScrapeError(
    "Login ke sistem billing ditolak. Periksa BILLING_USERNAME dan BILLING_PASSWORD. Status lama dipertahankan.",
  );
  assert.equal(d.category, "credentials");
  assert.equal(d.tone, "danger");
  assert.doesNotMatch(d.retryBehavior, /^Gagal \d+ kali/);
});

test("sumber kosong: drop guard", () => {
  const d = parseBillingScrapeError(
    "Sumber billing tidak mengembalikan satu pun tagihan; status lama dipertahankan.",
  );
  assert.equal(d.category, "empty_source");
  assert.match(d.explanation, /drop guard/);
  assert.match(d.explanation, /terisolir massal/);
});

test("penurunan tagihan janggal: drop guard", () => {
  const d = parseBillingScrapeError(
    "Jumlah tagihan turun drastis (dari 500 ke 3). Periksa tampilan sistem billing. Bila penurunan ini memang benar, atur BILLING_DROP_PERCENT.",
  );
  assert.equal(d.category, "anomalous_drop");
  assert.match(d.explanation, /terisolir massal/);
  assert.match(d.actionHint, /BILLING_DROP_PERCENT/);
});

test("timeout dan jaringan", () => {
  assert.equal(
    cat(
      "Sistem billing tidak menjawab dalam batas waktu. Status lama dipertahankan.",
    ),
    "timeout",
  );
  assert.equal(cat("Sinkron melewati batas waktu."), "timeout");
  assert.equal(
    cat(
      "Sistem billing tidak dapat dihubungi (jaringan terputus atau layanan mati).",
    ),
    "network",
  );
  assert.equal(
    cat("Sertifikat TLS sistem billing tidak dapat diverifikasi."),
    "network",
  );
  assert.equal(
    parseBillingScrapeError("Sistem billing mengalami gangguan (HTTP 503).")
      .category,
    "server_error",
  );
});

test("struktur halaman berubah", () => {
  assert.equal(
    cat("Tampilan sistem billing berubah; selektor profil perlu disesuaikan."),
    "source_changed",
  );
  assert.equal(
    cat("Tabel tagihan tidak terbaca: susunan halaman billing berubah."),
    "source_changed",
  );
});

test("status tidak dikenal dan pesan asing", () => {
  assert.equal(
    cat(
      'Status tagihan tidak dikenal: "Pending". Tambahkan ke StatusMap profil bila sah.',
    ),
    "unknown_status",
  );
  assert.equal(cat("hmm"), "unknown");
  assert.equal(cat(undefined), "unknown");
});

test("backoff 6 jam muncul bila kredensial gagal >= 3 kali", () => {
  const msg = "Login ke sistem billing ditolak.";
  assert.doesNotMatch(
    parseBillingScrapeError(msg, 2).retryBehavior,
    /^Gagal 2 kali/,
  );
  assert.match(parseBillingScrapeError(msg, 2).retryBehavior, /6 jam/); // peringatan dini
  const d = parseBillingScrapeError(msg, 3);
  assert.match(d.retryBehavior, /Gagal 3 kali berturut-turut/);
  assert.match(d.retryBehavior, /setiap 6 jam/);
});

test("semua kategori memuat penjelasan data lama dipertahankan", () => {
  for (const m of [
    "Login ditolak",
    "turun drastis",
    "struktur",
    "timeout",
    "jaringan",
    "x",
  ]) {
    assert.match(parseBillingScrapeError(m).explanation, /tidak terhapus/);
  }
});
