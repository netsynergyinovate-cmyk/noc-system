import { expect, test } from "@playwright/test";
import {
  AUDIT_MAX_LIMIT,
  AUDIT_MOCK_DAY_MAX,
  AUDIT_MOCK_DAY_MIN,
  AUDIT_MOCK_START,
  AUDIT_PAGE_SIZE,
  AUDIT_SYSTEM_ACTOR,
  AUDIT_WINDOW_DAYS,
  AUDIT_WINDOW_SECONDS,
  AuditEntryError,
  AuditLoadError,
  auditActionList,
  auditActions,
  auditGroupLabels,
  auditOperators,
  auditView,
  buildAuditEntry,
  changed,
  describeChange,
  findSecret,
  isAuditAction,
  isSecretField,
  loadAudit,
  mockAuditLog,
  pageAudit,
  redacted,
  summarizeAudit,
  type AuditAction,
  type AuditChange,
  type AuditEntry,
  type AuditEntryInput,
} from "../src/lib/dashboard/audit";

// Logika murni jejak aktivitas (audit.ts): data tiruan yang deterministik,
// jendela 30 hari, aturan rahasia, pembagian halaman, ringkasan, dan keadaan
// layar. Tanpa browser.

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400;
// Awal jendela yang aman: 100 hari sesudah log tiruan dimulai.
const NOW = AUDIT_MOCK_START + 100 * DAY + 13 * 3_600 + 17;

const EXPECTED_ACTIONS: AuditAction[] = [
  "login",
  "logout",
  "alert-handled",
  "threshold-changed",
  "router-added",
  "router-updated",
  "cpe-changed",
  "billing-sync",
  "settings-changed",
];

// Beberapa waktu acak (seed tetap) yang semuanya punya jendela penuh.
function randomNows(seed: number, count: number) {
  const random = mulberry32(seed);
  return Array.from(
    { length: count },
    () =>
      AUDIT_MOCK_START +
      (AUDIT_WINDOW_DAYS + 1) * DAY +
      Math.floor(random() * 400 * DAY),
  );
}

// expect() di dalam putaran besar sangat lambat (puluhan ribu panggilan memakan
// menit), jadi pelanggaran dikumpulkan dan dinilai sekali di akhir.
function collector() {
  const found: string[] = [];
  return {
    check(ok: boolean, message: string) {
      if (!ok) found.push(message);
    },
    done() {
      expect(found.slice(0, 10)).toEqual([]);
    },
  };
}

test.describe("data tiruan", () => {
  test("nowSec yang sama selalu memberi daftar yang sama, dan detiknya dibulatkan ke bawah", () => {
    for (const now of [NOW, ...randomNows(1, 10)]) {
      const first = JSON.stringify(mockAuditLog(now));
      expect(JSON.stringify(mockAuditLog(now))).toBe(first);
    }
    // Urutan pemanggilan tidak berpengaruh.
    const later = JSON.stringify(mockAuditLog(NOW + 7 * DAY));
    const base = JSON.stringify(mockAuditLog(NOW));
    expect(JSON.stringify(mockAuditLog(NOW + 7 * DAY))).toBe(later);
    expect(JSON.stringify(mockAuditLog(NOW))).toBe(base);
    expect(JSON.stringify(mockAuditLog(NOW + 0.9))).toBe(base);
  });

  test("terbaru di atas, tidak ada yang di masa depan, semua detik bulat dalam jendela 30 hari", () => {
    const bad = collector();
    for (const now of [NOW, ...randomNows(2, 60)]) {
      const entries = mockAuditLog(now);
      bad.check(entries.length > 0, `${now}: kosong`);
      for (let i = 0; i < entries.length; i += 1) {
        const { at, id } = entries[i];
        bad.check(Number.isInteger(at), `${id}: bukan bilangan bulat`);
        bad.check(at <= now, `${id}: di masa depan`);
        bad.check(at > now - AUDIT_WINDOW_SECONDS, `${id}: di luar jendela`);
        if (i > 0) {
          bad.check(at <= entries[i - 1].at, `${id}: urutan tidak menurun`);
        }
      }
    }
    bad.done();
  });

  test("kedua ujung jendela tepat sampai ke detik: lama masuk sehari penuh dikurangi satu detik, baru masuk di detiknya", () => {
    const entries = mockAuditLog(NOW);
    // Contoh: catatan tertua dan yang terbaru, serta satu di tengah.
    for (const entry of [
      entries[entries.length - 1],
      entries[0],
      entries[Math.floor(entries.length / 2)],
    ]) {
      const inList = (now: number) =>
        mockAuditLog(now).some((candidate) => candidate.id === entry.id);
      // Batas lama: jendela adalah (now - 30 hari, now], jadi catatan yang
      // persis 30 hari lalu sudah keluar, satu detik sebelumnya masih ada.
      expect(
        inList(entry.at + AUDIT_WINDOW_SECONDS - 1),
        `${entry.id} masuk`,
      ).toBe(true);
      expect(
        inList(entry.at + AUDIT_WINDOW_SECONDS),
        `${entry.id} keluar`,
      ).toBe(false);
      // Batas baru: catatan di detik "sekarang" sudah terlihat, sedetik lebih
      // awal belum.
      expect(inList(entry.at), `${entry.id} baru`).toBe(true);
      expect(inList(entry.at - 1), `${entry.id} belum terjadi`).toBe(false);
    }
  });

  test("tidak ada catatan sebelum log dimulai, dan masukan yang tidak sah memberi daftar kosong", () => {
    expect(mockAuditLog(AUDIT_MOCK_START - 1)).toEqual([]);
    expect(mockAuditLog(0)).toEqual([]);
    expect(mockAuditLog(Number.NaN)).toEqual([]);
    expect(mockAuditLog(Number.POSITIVE_INFINITY)).toEqual([]);
    // Begitu log dimulai, hari pertamanya terisi dan tidak ada yang lebih tua.
    const early = mockAuditLog(AUDIT_MOCK_START + 5 * DAY);
    expect(early.length).toBeGreaterThan(0);
    for (const entry of early) {
      expect(entry.at).toBeGreaterThanOrEqual(AUDIT_MOCK_START);
    }
  });

  test("id unik dalam satu daftar dan di seluruh waktu, serta isinya sama di mana pun muncul", () => {
    const bad = collector();
    const seen = new Map<string, string>();
    for (const now of randomNows(3, 80)) {
      const entries = mockAuditLog(now);
      bad.check(
        new Set(entries.map((entry) => entry.id)).size === entries.length,
        `${now}: id kembar dalam satu daftar`,
      );
      for (const entry of entries) {
        const text = JSON.stringify(entry);
        // Satu id tidak pernah membawa dua isi berbeda.
        bad.check(
          (seen.get(entry.id) ?? text) === text,
          `${entry.id}: isi berbeda`,
        );
        seen.set(entry.id, text);
      }
    }
    bad.done();
  });

  test("jendela yang bergeser hanya mengganti catatan yang keluar atau masuk", () => {
    const bad = collector();
    const shifts = [1, 3_600, 6 * 3_600, DAY, 3 * DAY, 29 * DAY, 31 * DAY];
    for (const base of [NOW, ...randomNows(4, 12)]) {
      for (const shift of shifts) {
        const older = mockAuditLog(base);
        const newer = mockAuditLog(base + shift);
        const olderById = new Map(older.map((entry) => [entry.id, entry]));
        const newerById = new Map(newer.map((entry) => [entry.id, entry]));
        const newerSince = base + shift - AUDIT_WINDOW_SECONDS;
        const where = `${base}+${shift}`;

        // Yang ada di keduanya identik (isi dan id).
        for (const [id, entry] of olderById) {
          const twin = newerById.get(id);
          if (twin) {
            bad.check(
              JSON.stringify(twin) === JSON.stringify(entry),
              `${where}: ${id} berbeda isi`,
            );
          } else {
            // Catatan lama yang masih dalam jendela baru tidak boleh hilang.
            bad.check(entry.at <= newerSince, `${where}: ${id} hilang`);
          }
        }
        // Catatan baru yang sudah ada pada waktu lama harus sudah ada di sana.
        for (const [id, entry] of newerById) {
          if (!olderById.has(id)) {
            bad.check(entry.at > base, `${where}: ${id} muncul terlambat`);
          }
        }
        // Irisan sama persis, dan urutannya pun sama.
        const common = older
          .filter((entry) => newerById.has(entry.id))
          .map((entry) => entry.id);
        const commonNewer = newer
          .filter((entry) => olderById.has(entry.id))
          .map((entry) => entry.id);
        bad.check(
          common.join() === commonNewer.join(),
          `${where}: irisan berbeda urutan`,
        );
      }
    }
    bad.done();
  });

  test("tiap hari penuh dalam jendela punya 4 sampai 8 catatan, hari di ujung tidak lebih dari 8", () => {
    const bad = collector();
    for (const now of [NOW, ...randomNows(5, 60)]) {
      const since = now - AUDIT_WINDOW_SECONDS;
      const perDay = new Map<number, number>();
      for (const entry of mockAuditLog(now)) {
        const day = Math.floor(entry.at / DAY);
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
      }
      for (
        let day = Math.floor(since / DAY);
        day <= Math.floor(now / DAY);
        day += 1
      ) {
        const count = perDay.get(day) ?? 0;
        bad.check(
          count <= AUDIT_MOCK_DAY_MAX,
          `${now}: hari ${day} ada ${count}`,
        );
        const full = day * DAY > since && (day + 1) * DAY - 1 <= now;
        if (full) {
          bad.check(
            count >= AUDIT_MOCK_DAY_MIN,
            `${now}: hari penuh ${day} hanya ${count}`,
          );
        }
      }
    }
    bad.done();
    // Sekilas: rata-rata sekitar 6 sehari, jadi daftar 30 hari sekitar 180.
    const total = mockAuditLog(NOW).length;
    expect(total).toBeGreaterThan(AUDIT_MOCK_DAY_MIN * (AUDIT_WINDOW_DAYS - 2));
    expect(total).toBeLessThan(AUDIT_MOCK_DAY_MAX * (AUDIT_WINDOW_DAYS + 1));
  });

  test("empat sampai lima petugas, kejadian otomatis hanya oleh Sistem, dan nama tidak pernah kosong", () => {
    expect(auditOperators.length).toBeGreaterThanOrEqual(4);
    expect(auditOperators.length).toBeLessThanOrEqual(5);
    const ids = new Set<string>();
    for (const entry of mockAuditLog(NOW)) {
      expect(entry.actor.name.trim()).not.toBe("");
      expect(entry.actor.id.trim()).not.toBe("");
      ids.add(entry.actor.id);
      expect(entry.actor.id === AUDIT_SYSTEM_ACTOR.id).toBe(
        entry.action === "billing-sync",
      );
      if (entry.actor.id !== AUDIT_SYSTEM_ACTOR.id) {
        expect(auditOperators).toContainEqual(entry.actor);
      }
    }
    // Setiap petugas muncul dalam 30 hari, plus Sistem.
    for (const operator of auditOperators)
      expect(ids.has(operator.id)).toBe(true);
    expect(ids.has(AUDIT_SYSTEM_ACTOR.id)).toBe(true);
    expect(new Set(auditOperators.map((o) => o.name)).size).toBe(
      auditOperators.length,
    );
  });

  test("tiap catatan lengkap: aksi dikenal, objek dan ringkasan satu kalimat Indonesia, perubahan tak kosong dan beku", () => {
    const seenActions = new Set<AuditAction>();
    for (const entry of mockAuditLog(NOW)) {
      expect(isAuditAction(entry.action)).toBe(true);
      seenActions.add(entry.action);
      expect(entry.target.trim()).not.toBe("");
      expect(entry.summary.trim()).not.toBe("");
      expect(entry.summary).toMatch(/^\p{Lu}.*\.$/u);
      expect(entry.summary).not.toMatch(/\n/);
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.changes)).toBe(true);
      for (const change of entry.changes) {
        expect(change.field.trim()).not.toBe("");
        if (!change.redacted) {
          expect(change.from.trim()).not.toBe("");
          expect(change.to.trim()).not.toBe("");
          // Yang "berubah" memang beda.
          expect(change.to).not.toBe(change.from);
        }
      }
    }
    // Data tiruan memakai semua aksi.
    expect([...seenActions].sort()).toEqual([...EXPECTED_ACTIONS].sort());
  });
});

test.describe("tabel aksi", () => {
  test("memuat tepat sembilan aksi dari PRD, beku, dengan label, ikon, dan kelompok", () => {
    expect([...auditActionList].sort()).toEqual([...EXPECTED_ACTIONS].sort());
    expect(Object.keys(auditActions).sort()).toEqual(
      [...EXPECTED_ACTIONS].sort(),
    );
    expect(Object.isFrozen(auditActions)).toBe(true);
    const groups = new Set(Object.keys(auditGroupLabels));
    expect([...groups].sort()).toEqual([
      "akses",
      "alert",
      "pengaturan",
      "perangkat",
    ]);
    const labels = new Set<string>();
    const usedGroups = new Set<string>();
    for (const action of EXPECTED_ACTIONS) {
      const info = auditActions[action];
      expect(Object.isFrozen(info), action).toBe(true);
      expect(info.label.trim(), action).not.toBe("");
      expect(info.icon, action).toMatch(/^[A-Z][A-Za-z]+$/);
      expect(groups.has(info.group), action).toBe(true);
      labels.add(info.label);
      usedGroups.add(info.group);
    }
    // Label tak kembar (lencana dibedakan oleh tulisannya) dan semua kelompok terpakai.
    expect(labels.size).toBe(EXPECTED_ACTIONS.length);
    expect(usedGroups.size).toBe(groups.size);
    expect(auditActions["alert-handled"].label).toBe("Tandai ditangani");
    expect(isAuditAction("hapus-semua")).toBe(false);
    expect(isAuditAction("toString")).toBe(false);
    expect(isAuditAction(undefined)).toBe(false);
  });
});

// Pola rahasia yang ditulis di sini sendiri, tidak diambil dari audit.ts, supaya
// pengujian tidak ikut salah bila pola di sana melemah.
const forbidden: { name: string; pattern: RegExp }[] = [
  { name: "password", pattern: /pass(word|wd|phrase)/i },
  { name: "kata sandi dengan nilai", pattern: /kata\s*sandi\s*[:=]/i },
  {
    name: "kunci dengan nilai",
    pattern: /(token|secret|api[-_ ]?key|kunci|psk)\s*[:=]/i,
  },
  { name: "bearer", pattern: /bearer\s+\S{6,}/i },
  { name: "token Telegram", pattern: /\d{6,}:[A-Za-z0-9_-]{25,}/ },
  { name: "awalan kunci", pattern: /(ngpk_|sk-[A-Za-z0-9]|ghp_|AKIA[A-Z0-9])/ },
  { name: "kredensial di alamat", pattern: /:\/\/[^/\s]*:[^/\s]*@/ },
  { name: "teks acak panjang", pattern: /[A-Za-z0-9+/=_-]{28,}/ },
];

const allowedKeys = new Set([
  "id",
  "at",
  "actor",
  "action",
  "target",
  "summary",
  "changes",
  "name",
  "field",
  "from",
  "to",
  "redacted",
]);

// Semua teks (dan semua nama properti) sebuah catatan, kecuali id.
function collect(value: unknown, texts: string[], keys: string[], skip = "") {
  if (typeof value === "string") texts.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collect(item, texts, keys);
  } else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      keys.push(key);
      if (key !== skip) collect(inner, texts, keys);
    }
  }
}

// Seluruh catatan unik yang muncul di seluruh jendela selama lebih dari setahun.
function everyEntry() {
  const byId = new Map<string, AuditEntry>();
  for (let day = 0; day < 420; day += 1) {
    const now = AUDIT_MOCK_START + day * DAY + 12 * 3_600;
    for (const entry of mockAuditLog(now)) byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

test.describe("aturan rahasia", () => {
  test("tidak ada rahasia di seluruh teks semua catatan selama lebih dari setahun", () => {
    const entries = everyEntry();
    expect(entries.length).toBeGreaterThan(2_000);
    let redactedCount = 0;
    const bad = collector();
    for (const entry of entries) {
      const texts: string[] = [];
      const keys: string[] = [];
      collect(entry, texts, keys, "id");
      for (const key of keys) {
        bad.check(allowedKeys.has(key), `${entry.id}: properti ${key}`);
      }
      for (const text of texts) {
        for (const { name, pattern } of forbidden) {
          bad.check(!pattern.test(text), `${entry.id}: ${name}`);
        }
      }
      for (const change of entry.changes) {
        const secretField = /sandi|token|kunci|password|rahasia|secret/i.test(
          change.field,
        );
        // Bidang rahasia selalu tanpa nilai; yang berisi nilai tak pernah rahasia.
        if (secretField) {
          bad.check(change.redacted === true, `${entry.id}: ${change.field}`);
        }
        if (change.redacted) {
          redactedCount += 1;
          bad.check(
            Object.keys(change).sort().join() === "field,redacted",
            `${entry.id}: bidang tersembunyi membawa nilai`,
          );
        }
      }
    }
    bad.done();
    // Pengujiannya tidak kosong: ada perubahan rahasia yang dicatat tanpa nilai.
    expect(redactedCount).toBeGreaterThan(100);
    const fields = new Set(
      entries.flatMap((entry) =>
        entry.changes.filter((c) => c.redacted).map((c) => c.field),
      ),
    );
    expect([...fields].sort()).toEqual([
      "Kata sandi Wi-Fi",
      "Kata sandi router",
      "Kunci API billing",
      "Token bot Telegram",
    ]);
  });

  test("changed() menolak bidang rahasia dan nilai yang tampak seperti rahasia, tanpa menyebut nilainya", () => {
    for (const field of [
      "Kata sandi Wi-Fi",
      "kata sandi",
      "Password",
      "Wi-Fi password",
      "Token bot Telegram",
      "Kunci API billing",
      "API key",
      "api_key",
      "PSK",
      "Rahasia",
      "Secret",
      "OTP",
    ]) {
      expect(isSecretField(field), field).toBe(true);
      expect(() => changed(field, "a", "b"), field).toThrow(AuditEntryError);
    }
    for (const field of [
      "SSID Wi-Fi",
      "Alamat router",
      "Ambang CPU",
      "Status",
      "Retensi data trafik",
    ]) {
      expect(isSecretField(field), field).toBe(false);
      expect(() => changed(field, "a", "b"), field).not.toThrow();
    }

    const telegram = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
    const secrets = [
      "password=abc123",
      "Password: hunter2",
      "kata sandi=rahasia1",
      "kata sandi: rahasia1",
      "token=abcdef",
      `bot ${telegram}`,
      "Bearer abcdefgh12345678",
      "ngpk_abcdefghijklmno",
      "sk-abcdefghijklmnopqrstuvwxyz",
      "https://admin:s3cret@10.10.0.1/",
      "0123456789abcdef0123456789abcdef0123",
      "api_key=zzz",
      "kunci API: zzz",
    ];
    for (const value of secrets) {
      expect(findSecret(value), value).not.toBeNull();
      for (const side of ["from", "to"] as const) {
        const call = () =>
          side === "from"
            ? changed("Catatan", value, "baik")
            : changed("Catatan", "baik", value);
        try {
          call();
          throw new Error(`seharusnya menolak: ${value}`);
        } catch (error) {
          expect(error).toBeInstanceOf(AuditEntryError);
          // Pesan galat tidak boleh menyalin nilai yang dicurigai.
          expect((error as Error).message).not.toContain(value);
        }
      }
    }
    // Tiap pola dikenali sendiri-sendiri (beberapa nilai kebetulan kena dua
    // pola, jadi nama pola pertama yang cocok ikut dicek).
    const named: [string, string][] = [
      ["password=abc123", "password"],
      ["kata sandi=rahasia1", "kata sandi dengan nilai"],
      ["token=abcdef", "kunci dengan nilai"],
      ["Bearer abcdefgh12345678", "bearer"],
      [telegram, "token bot Telegram"],
      ["ngpk_abcdefghijklmno", "awalan kunci layanan"],
      ["https://admin:s3cret@10.10.0.1/", "kredensial di alamat"],
      ["0123456789abcdef0123456789abcdef0123", "teks acak panjang"],
    ];
    for (const [value, name] of named) {
      expect(findSecret(value), value).toBe(name);
    }
    // Teks biasa yang menyebut jenis rahasia tanpa nilainya tetap boleh.
    for (const text of [
      "Andi mengganti kata sandi Wi-Fi pelanggan.",
      "Andi mengganti token bot Telegram.",
      "Andi mengganti kunci API billing.",
      "RTR-Pusat-01",
      "Alert alt-123",
    ]) {
      expect(findSecret(text), text).toBeNull();
    }
  });

  test("redacted() hanya membawa nama bidang, dan tipe melarang nilai pada bidang yang disembunyikan", () => {
    const change = redacted("Kata sandi Wi-Fi");
    expect(change).toEqual({ field: "Kata sandi Wi-Fi", redacted: true });
    expect(Object.isFrozen(change)).toBe(true);
    expect(describeChange(change)).toBe(
      "Kata sandi Wi-Fi: nilai disembunyikan",
    );

    const fine: AuditChange = { field: "Token bot Telegram", redacted: true };
    expect(fine.redacted).toBe(true);
    // Diperiksa oleh tsc: nilai tidak boleh ada pada bidang yang disembunyikan.
    // @ts-expect-error from tidak boleh ada pada AuditRedactedChange
    const withFrom: AuditChange = { field: "x", redacted: true, from: "a" };
    // @ts-expect-error to tidak boleh ada pada AuditRedactedChange
    const withTo: AuditChange = { field: "x", redacted: true, to: "a" };
    expect([withFrom, withTo]).toHaveLength(2);
  });

  test("buildAuditEntry menolak catatan yang tidak sah dan menerima yang sah", () => {
    const valid: AuditEntryInput = {
      id: "audit-1-1",
      at: AUDIT_MOCK_START + 10,
      actor: { id: "op-andi", name: "Andi Prasetyo" },
      action: "cpe-changed",
      target: "Pelanggan Budi",
      summary: "Andi mengganti kata sandi Wi-Fi pelanggan Budi.",
      changes: [redacted("Kata sandi Wi-Fi")],
    };
    const built = buildAuditEntry(valid);
    expect(built).toEqual(valid);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.actor)).toBe(true);
    // changes boleh tidak ada.
    expect(buildAuditEntry({ ...valid, changes: undefined }).changes).toEqual(
      [],
    );

    const bad = (patch: Record<string, unknown>) =>
      buildAuditEntry({ ...valid, ...patch } as AuditEntryInput);
    const cases: Record<string, Record<string, unknown>> = {
      "id kosong": { id: " " },
      "waktu pecahan": { at: 1.5 },
      "waktu negatif": { at: -1 },
      "waktu NaN": { at: Number.NaN },
      "waktu teks": { at: "123" },
      "aksi tidak dikenal": { action: "hapus-semua" },
      "nama petugas kosong": { actor: { id: "op-andi", name: "  " } },
      "id petugas kosong": { actor: { id: "", name: "Andi" } },
      "petugas tidak ada": { actor: undefined },
      "objek kosong": { target: "" },
      "ringkasan kosong": { summary: "   " },
      "ringkasan memuat kata sandi": {
        summary: "Andi mengganti kata sandi=abc123.",
      },
      "objek memuat token": {
        target: "bot 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw",
      },
      "nama petugas memuat rahasia": {
        actor: { id: "x", name: "password: hunter2" },
      },
      "bidang rahasia tanpa redacted": {
        changes: [{ field: "Kata sandi Wi-Fi", from: "a", to: "b" }],
      },
      "bidang disembunyikan membawa nilai": {
        changes: [{ field: "Kata sandi Wi-Fi", redacted: true, to: "abc" }],
      },
      "bidang disembunyikan membawa nilai lama": {
        changes: [{ field: "Token", redacted: true, from: "abc" }],
      },
      "nilai baru memuat rahasia": {
        changes: [
          { field: "Catatan", from: "a", to: "Bearer abcdefgh12345678" },
        ],
      },
      "nilai lama kosong": {
        changes: [{ field: "Catatan", from: "", to: "b" }],
      },
      "penanda redacted palsu": {
        changes: [{ field: "Catatan", redacted: false, from: "a", to: "b" }],
      },
    };
    for (const [name, patch] of Object.entries(cases)) {
      expect(() => bad(patch), name).toThrow(AuditEntryError);
    }
  });

  test("describeChange: dari-ke untuk bidang biasa, nilai disembunyikan untuk yang rahasia", () => {
    expect(describeChange(changed("Ambang CPU", "85%", "90%"))).toBe(
      "Ambang CPU: dari 85% ke 90%",
    );
    expect(describeChange(redacted("Kunci API billing"))).toBe(
      "Kunci API billing: nilai disembunyikan",
    );
  });
});

test.describe("pembagian halaman", () => {
  // Rujukan yang ditulis lain dari pageAudit: tanpa paginate, dari definisi.
  function reference<T>(items: readonly T[], page: unknown, size: unknown) {
    const validSize =
      typeof size === "number" &&
      Number.isFinite(size) &&
      Math.floor(size) === size &&
      size >= 1;
    const perPage = validSize ? (size as number) : AUDIT_PAGE_SIZE;
    const pages = Math.max(1, Math.ceil(items.length / perPage));
    const wanted =
      typeof page === "number" &&
      Number.isFinite(page) &&
      Math.floor(page) === page
        ? page
        : 1;
    const current = Math.min(Math.max(wanted, 1), pages);
    const slice = items.slice((current - 1) * perPage, current * perPage);
    return {
      page: current,
      pageCount: pages,
      items: slice,
      from: slice.length ? (current - 1) * perPage + 1 : 0,
      to: slice.length ? (current - 1) * perPage + slice.length : 0,
      total: items.length,
    };
  }

  test("ukuran bawaan 20 dan kasus pinggir: halaman pertama, terakhir, di luar rentang, daftar kosong", () => {
    expect(AUDIT_PAGE_SIZE).toBe(20);
    const items = Array.from({ length: 45 }, (_, i) => i);
    const first = pageAudit(items, 1);
    expect(first.items).toEqual(items.slice(0, 20));
    expect([first.page, first.pageCount, first.from, first.to]).toEqual([
      1, 3, 1, 20,
    ]);
    const last = pageAudit(items, 3);
    expect(last.items).toEqual(items.slice(40));
    expect([last.page, last.pageCount, last.from, last.to, last.total]).toEqual(
      [3, 3, 41, 45, 45],
    );
    // Di luar rentang dipaksa masuk; bukan bilangan bulat jatuh ke halaman 1.
    expect(pageAudit(items, 99).page).toBe(3);
    expect(pageAudit(items, 0).page).toBe(1);
    expect(pageAudit(items, -4).page).toBe(1);
    expect(pageAudit(items, 2.5).page).toBe(1);
    expect(pageAudit(items, Number.NaN).page).toBe(1);
    expect(pageAudit(items, Number.POSITIVE_INFINITY).page).toBe(1);
    // Pas kelipatan ukuran: tidak ada halaman kosong di ujung.
    expect(
      pageAudit(
        Array.from({ length: 40 }, (_, i) => i),
        2,
      ).items,
    ).toHaveLength(20);
    expect(
      pageAudit(
        Array.from({ length: 40 }, (_, i) => i),
        3,
      ).page,
    ).toBe(2);
    // Kosong: satu halaman, tanpa baris.
    expect(pageAudit([], 1)).toEqual({
      page: 1,
      pageCount: 1,
      items: [],
      from: 0,
      to: 0,
      total: 0,
    });
    // Ukuran nol, negatif, pecahan, atau bukan angka jatuh ke ukuran bawaan.
    for (const size of [
      0,
      -1,
      -20,
      2.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(pageAudit(items, 2, size), String(size)).toEqual(
        pageAudit(items, 2, AUDIT_PAGE_SIZE),
      );
    }
  });

  test("sama dengan rujukan independen pada 3000 kasus acak, dan halaman-halamannya menyusun ulang daftar", () => {
    const random = mulberry32(20250101);
    const sizes = [
      undefined,
      -5,
      -1,
      0,
      1,
      2,
      3,
      7,
      19,
      20,
      21,
      50,
      2.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ];
    const pages = [
      -3,
      -1,
      0,
      1,
      2,
      3,
      4,
      5,
      8,
      99,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ];
    for (let n = 0; n < 3_000; n += 1) {
      const length = Math.floor(random() * 130);
      const items = Array.from({ length }, (_, i) => `e${i}`);
      const size = sizes[Math.floor(random() * sizes.length)];
      const page = pages[Math.floor(random() * pages.length)];
      const actual = pageAudit(items, page, size);
      const expected = reference(items, page, size);
      expect(actual).toEqual(expected);
    }
    // Menyambung semua halaman memberi daftar semula, tanpa duplikat atau hilang.
    for (const length of [0, 1, 19, 20, 21, 40, 41, 100, 137]) {
      for (const size of [undefined, 1, 3, 20, 50, 0, -2]) {
        const items = Array.from({ length }, (_, i) => i);
        const count = pageAudit(items, 1, size).pageCount;
        const joined = Array.from(
          { length: count },
          (_, i) => pageAudit(items, i + 1, size).items,
        ).flat();
        expect(joined).toEqual(items);
      }
    }
  });

  test("membagi catatan sungguhan dari data tiruan", () => {
    const entries = mockAuditLog(NOW);
    const first = pageAudit(entries, 1);
    expect(first.items).toEqual(entries.slice(0, AUDIT_PAGE_SIZE));
    expect(first.pageCount).toBe(Math.ceil(entries.length / AUDIT_PAGE_SIZE));
  });
});

test.describe("ringkasan dan keadaan layar", () => {
  test("summarizeAudit dihitung dari catatan, sama dengan hitungan lain", () => {
    for (const now of [NOW, ...randomNows(6, 20)]) {
      const entries = mockAuditLog(now);
      const summary = summarizeAudit(entries, now);
      const last24 = entries.filter(
        (entry) => now - entry.at < DAY && entry.at <= now,
      ).length;
      const people = new Set(
        entries
          .filter((entry) => entry.actor.name !== "Sistem")
          .map((entry) => entry.actor.id),
      );
      expect(summary).toEqual({
        total: entries.length,
        last24h: last24,
        operators: people.size,
      });
    }
    expect(summarizeAudit([], NOW)).toEqual({
      total: 0,
      last24h: 0,
      operators: 0,
    });
    // Tepat 24 jam yang lalu belum termasuk, 24 jam kurang satu detik termasuk.
    const make = (id: string, at: number) =>
      buildAuditEntry({
        id,
        at,
        actor: { id: "op-x", name: "Petugas X" },
        action: "login",
        target: "Akun Petugas X",
        summary: "Petugas X masuk ke dasbor NOC.",
      });
    expect(
      summarizeAudit([make("a", NOW - DAY), make("b", NOW - DAY + 1)], NOW)
        .last24h,
    ).toBe(1);
  });

  test("auditView: memuat, galat, kosong, siap, dan data lama tetap tampil bila pembaruan gagal", () => {
    const some = mockAuditLog(NOW);
    expect(auditView(null, false)).toEqual({ kind: "loading", stale: false });
    expect(auditView(null, true)).toEqual({ kind: "error", stale: false });
    expect(auditView([], false)).toEqual({ kind: "empty", stale: false });
    expect(auditView([], true)).toEqual({ kind: "empty", stale: true });
    expect(auditView(some, false)).toEqual({ kind: "ready", stale: false });
    expect(auditView(some, true)).toEqual({ kind: "ready", stale: true });
  });
});

test.describe("loadAudit", () => {
  test("mengembalikan log tiruan pada waktu yang diminta, dengan limit dan before", async () => {
    const all = await loadAudit({ nowSec: NOW });
    expect(all).toEqual(mockAuditLog(NOW));
    const limited = await loadAudit({ nowSec: NOW, limit: 5 });
    expect(limited).toEqual(all.slice(0, 5));
    const before = all[10].at;
    const older = await loadAudit({ nowSec: NOW, before });
    expect(older).toEqual(all.filter((entry) => entry.at < before));
    expect(await loadAudit({ nowSec: NOW, before, limit: 3 })).toEqual(
      older.slice(0, 3),
    );
    expect(await loadAudit({ nowSec: NOW, limit: AUDIT_MAX_LIMIT })).toEqual(
      all,
    );
  });

  test("menolak limit dan before yang tidak sah", async () => {
    for (const limit of [0, -1, 1.5, Number.NaN, AUDIT_MAX_LIMIT + 1]) {
      await expect(
        loadAudit({ nowSec: NOW, limit }),
        String(limit),
      ).rejects.toBeInstanceOf(RangeError);
    }
    await expect(
      loadAudit({ nowSec: NOW, before: 1.5 }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  test("gagal dengan AuditLoadError saat peramban offline", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: false },
      configurable: true,
      writable: true,
    });
    try {
      await expect(loadAudit({ nowSec: NOW })).rejects.toBeInstanceOf(
        AuditLoadError,
      );
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
    // Online lagi: berhasil.
    expect((await loadAudit({ nowSec: NOW })).length).toBeGreaterThan(0);
  });
});
