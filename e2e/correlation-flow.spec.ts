import { expect, test } from "@playwright/test";
import type { ActiveAlert } from "../src/lib/dashboard/alerts";
import {
  BURST_MIN,
  BURST_WINDOW,
  IMPACT_AFTER,
  IMPACT_BEFORE,
  IMPACT_MIN,
  ODP_WINDOW,
  ROUTER_WINDOW,
  correlateAlerts,
  timeGap,
} from "../src/lib/dashboard/correlation";
import {
  buildIncidentCards,
  type IncidentCard,
} from "../src/lib/dashboard/incident-cards";
import { defaultSeverity } from "../src/lib/dashboard/incidents";
import {
  createMockIncidentHub,
  listSignature,
  mergeIncidentCards,
} from "../src/lib/dashboard/incident-sync";
import type { IncidentKind } from "../src/lib/dashboard/types";

// Uji korelasi alert se-penyebab menjadi satu kartu insiden. Tiga bagian:
// skenario berurutan (linimasa) lewat hub dan store, sifat-sifat umum pada ribuan
// kumpulan alert acak, dan perbandingan dengan penghitung referensi yang ditulis
// terpisah dari aturan di kepala correlation.ts.

const T0 = 1_791_400_000;
let counter = 0;

interface Spec {
  kind: IncidentKind;
  at: number; // detik sejak T0
  router?: string;
  odp?: string | null;
  uncertainty?: number;
  id?: string;
}

function alert(spec: Spec): ActiveAlert {
  counter += 1;
  const isCustomer = spec.kind === "offline" || spec.kind === "optical";
  const router = spec.router ?? "router-1";
  const odp = isCustomer ? (spec.odp === undefined ? "ODP-A" : spec.odp) : null;
  const startedAt = T0 + spec.at;
  const id = spec.id ?? `a${counter}`;
  return {
    id,
    kind: spec.kind,
    severity: defaultSeverity[spec.kind],
    startedAt,
    endedAt: null,
    routerId: router,
    customerId: isCustomer ? `cust-${id}` : null,
    interfaceName: null,
    measured: null,
    rootSource: { kind: "router", id: router, name: router },
    affectedCustomers: 0,
    servedCustomers: 0,
    correlationId: null,
    detectedAt: startedAt + 30,
    timeSource: spec.uncertainty ? "poll" : "event",
    timeUncertaintySeconds: spec.uncertainty ?? 0,
    location: {
      name: isCustomer ? (odp ?? "alamat") : router,
      address: null,
      odpName: odp,
      latitude: isCustomer ? -6.2 : null,
      longitude: isCustomer ? 106.8 : null,
    },
  };
}

const ids = (alerts: ActiveAlert[]) => alerts.map((a) => a.id);
const cardIds = (cards: IncidentCard[]) => cards.map((c) => c.id);
const members = (cards: IncidentCard[]) =>
  cards.map((card) => ids(card.alerts).sort().join("+")).sort();

test.describe("skenario berurutan: alert datang dan selesai satu per satu", () => {
  // Dunia tiruan yang dijalankan tangan: daftar alert aktif berubah per langkah.
  function world() {
    let active: ActiveAlert[] = [];
    const hub = createMockIncidentHub(() => buildIncidentCards(active));
    let screen: IncidentCard[] | null = null;
    let messages = 0;
    screen = mergeIncidentCards(screen, hub.snapshot(0));
    return {
      set(next: ActiveAlert[]) {
        active = next;
        const sent = hub.changes(0);
        if (sent) {
          messages += 1;
          screen = mergeIncidentCards(screen, sent);
        }
        return screen!;
      },
      get messages() {
        return messages;
      },
    };
  }

  test("pelanggan satu ODP bergabung ke satu kartu yang sama, di tempat", () => {
    const w = world();
    const first = alert({ kind: "offline", at: 0, id: "p1" });
    const second = alert({ kind: "offline", at: 40, id: "p2" });
    const third = alert({ kind: "optical", at: 80, id: "p3" });

    let screen = w.set([first]);
    expect(cardIds(screen)).toEqual(["grp-p1"]);
    expect(screen[0].alertCount).toBe(1);
    expect(screen[0].correlationId).toBeNull();
    const single = screen[0];

    // Yang kedua dari ODP sama: kartu yang sama (id sama) kini berisi dua alert.
    screen = w.set([first, second]);
    expect(cardIds(screen)).toEqual(["grp-p1"]);
    expect(screen[0]).not.toBe(single);
    expect(screen[0].alertCount).toBe(2);
    expect(screen[0].correlationId).toBe("grp-p1");
    expect(screen[0].rootSource.kind).toBe("odp");

    screen = w.set([first, second, third]);
    expect(cardIds(screen)).toEqual(["grp-p1"]);
    expect(screen[0].alertCount).toBe(3);
    expect(screen[0].affectedCustomers).toBe(3);
    expect(w.messages).toBe(3); // tiga perubahan, tiga pesan

    // Tidak ada perubahan: tidak ada pesan, dan kartunya objek yang sama.
    const before = screen[0];
    expect(w.set([first, second, third])[0]).toBe(before);
    expect(w.messages).toBe(3);
  });

  test("alert dari penyebab lain tetap kartu sendiri", () => {
    const w = world();
    const a1 = alert({ kind: "offline", at: 0, id: "q1", odp: "ODP-A" });
    const a2 = alert({ kind: "offline", at: 30, id: "q2", odp: "ODP-A" });
    const other = alert({ kind: "optical", at: 60, id: "q3", odp: "ODP-B" });
    const elsewhere = alert({
      kind: "offline",
      at: 20,
      id: "q4",
      router: "router-2",
    });
    const screen = w.set([a1, a2, other, elsewhere]);
    expect(members(screen)).toEqual(["q1+q2", "q3", "q4"]);
  });

  test("dua kartu terpisah bergabung saat alert penghubung muncul; id mengikuti alert tertua", () => {
    const w = world();
    // Dua kartu router terpisah: jaraknya 1.000 detik (> jendela 900).
    const early = alert({ kind: "cpu", at: 0, id: "r1" });
    const late = alert({ kind: "queue", at: ROUTER_WINDOW + 100, id: "r2" });
    let screen = w.set([early, late]);
    expect(cardIds(screen).sort()).toEqual(["grp-r1", "grp-r2"]);

    // Alert penghubung di tengah (port) berjarak <= 900 dari keduanya.
    const bridge = alert({ kind: "port", at: 500, id: "r3" });
    screen = w.set([early, late, bridge]);
    expect(cardIds(screen)).toEqual(["grp-r1"]);
    expect(screen[0].alertCount).toBe(3);
    expect(screen[0].rootSource.kind).toBe("router");
  });

  test("kartu menyusut saat anggota selesai, lalu hilang bila alert terakhir selesai", () => {
    const w = world();
    const a = alert({ kind: "offline", at: 0, id: "s1" });
    const b = alert({ kind: "offline", at: 30, id: "s2" });
    const c = alert({ kind: "offline", at: 60, id: "s3" });
    let screen = w.set([a, b, c]);
    expect(screen[0].alertCount).toBe(3);

    screen = w.set([b, c]); // yang tertua selesai: id kartu pindah ke yang tertua kini
    expect(cardIds(screen)).toEqual(["grp-s2"]);
    expect(screen[0].alertCount).toBe(2);

    screen = w.set([c]);
    expect(cardIds(screen)).toEqual(["grp-s3"]);
    expect(screen[0].correlationId).toBeNull();

    screen = w.set([]);
    expect(screen).toEqual([]);
    expect(w.messages).toBe(4);
  });

  test("router bermasalah: pelanggan yang ikut putus bergabung ke kartu router, bukan kartu sendiri", () => {
    const w = world();
    const cpu = alert({ kind: "cpu", at: 0, id: "t1" });
    let screen = w.set([cpu]);
    expect(screen[0].affectedCustomers).toBe(0);

    // Satu pelanggan putus: belum cukup untuk menyalahkan router.
    const c1 = alert({ kind: "offline", at: 20, id: "t2", odp: "ODP-A" });
    screen = w.set([cpu, c1]);
    expect(members(screen)).toEqual(["t1", "t2"].map((x) => x).sort());

    // Pelanggan kedua di ODP lain: sekarang router jelas penyebabnya.
    const c2 = alert({ kind: "offline", at: 90, id: "t3", odp: "ODP-B" });
    screen = w.set([cpu, c1, c2]);
    expect(members(screen)).toEqual(["t1+t2+t3"]);
    expect(screen[0].cause).toBe("router");
    expect(screen[0].rootSource.kind).toBe("router");
    expect(screen[0].affectedCustomers).toBe(2);
  });

  test("lonjakan offline menjadi satu kartu uplink, dan alert di router lain tidak ikut", () => {
    const w = world();
    const burst = [0, 60, 120].map((at, i) =>
      alert({ kind: "offline", at, id: `u${i}`, odp: `ODP-${i}` }),
    );
    const other = alert({
      kind: "offline",
      at: 30,
      id: "ux",
      router: "router-9",
      odp: "ODP-Z",
    });
    const screen = w.set([...burst, other]);
    expect(members(screen)).toEqual(["u0+u1+u2", "ux"]);
    const card = screen.find((c) => c.alertCount === 3)!;
    expect(card.cause).toBe("uplink");
    expect(card.rootSource.kind).toBe("uplink");
  });
});

// --- Bagian acak ---------------------------------------------------------

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS: IncidentKind[] = ["offline", "optical", "queue", "cpu", "port"];

function randomAlerts(seed: number, count: number): ActiveAlert[] {
  const random = rng(seed);
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  return Array.from({ length: count }, (_, index) =>
    alert({
      id: `r${seed}-${index}`,
      kind: pick(KINDS),
      at: Math.floor(random() * 2400),
      router: pick(["router-1", "router-1", "router-2"]),
      odp: pick(["ODP-A", "ODP-A", "ODP-B", "ODP-C", null]),
      uncertainty: pick([0, 0, 5, 30, 60]),
    }),
  );
}

const normalize = (groups: { alerts: ActiveAlert[] }[]) =>
  groups.map((g) => ids(g.alerts).sort().join("+")).sort();

// Penghitung referensi: aturan yang sama ditulis ulang dari komentar di kepala
// correlation.ts, dengan graf pasangan eksplisit dan komponen terhubung.
function referenceGroups(alerts: ActiveAlert[]) {
  const sorted = [...alerts].sort(
    (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id),
  );
  const parent = new Map(sorted.map((a) => [a.id, a.id]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  const link = (x: string, y: string) => parent.set(find(x), find(y));
  const isCustomer = (a: ActiveAlert) =>
    a.kind === "offline" || a.kind === "optical";
  const isRouter = (a: ActiveAlert) =>
    ["queue", "cpu", "port"].includes(a.kind);

  for (const a of sorted) {
    for (const b of sorted) {
      if (a.id >= b.id || a.routerId !== b.routerId) continue;
      if (
        isCustomer(a) &&
        isCustomer(b) &&
        a.location.odpName !== null &&
        a.location.odpName === b.location.odpName &&
        timeGap(a, b) <= ODP_WINDOW
      )
        link(a.id, b.id);
      if (isRouter(a) && isRouter(b) && timeGap(a, b) <= ROUTER_WINDOW)
        link(a.id, b.id);
    }
  }
  const routers = new Set(sorted.map((a) => a.routerId));
  for (const router of routers) {
    const offline = sorted.filter(
      (a) => a.routerId === router && a.kind === "offline",
    );
    let run: ActiveAlert[] = [];
    const flush = () => {
      if (run.length >= BURST_MIN) run.forEach((m) => link(run[0].id, m.id));
      run = [];
    };
    for (const a of offline) {
      if (run.length > 0 && timeGap(run[run.length - 1], a) > BURST_WINDOW)
        flush();
      run.push(a);
    }
    flush();
    for (const r of sorted.filter(
      (a) => a.routerId === router && isRouter(a),
    )) {
      const hits = offline.filter((o) => {
        const delta = o.startedAt - r.startedAt;
        const slack = r.timeUncertaintySeconds + o.timeUncertaintySeconds;
        return delta >= -IMPACT_BEFORE - slack && delta <= IMPACT_AFTER + slack;
      });
      if (hits.length >= IMPACT_MIN) hits.forEach((h) => link(r.id, h.id));
    }
  }
  const byRoot = new Map<string, string[]>();
  for (const a of sorted)
    byRoot.set(find(a.id), [...(byRoot.get(find(a.id)) ?? []), a.id]);
  return [...byRoot.values()].map((group) => group.sort().join("+")).sort();
}

test.describe("sifat umum pada kumpulan alert acak", () => {
  const SEEDS = Array.from({ length: 600 }, (_, i) => 1000 + i);

  test("hasil sama dengan penghitung referensi, untuk berbagai ukuran", () => {
    const problems: string[] = [];
    for (const seed of SEEDS) {
      const alerts = randomAlerts(seed, 1 + (seed % 14));
      const got = normalize(correlateAlerts(alerts));
      const want = referenceGroups(alerts);
      if (JSON.stringify(got) !== JSON.stringify(want))
        problems.push(
          `seed ${seed}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`,
        );
    }
    expect(problems.slice(0, 3)).toEqual([]);
  });

  test("setiap alert tepat di satu kelompok, dan urutan masukan tidak berpengaruh", () => {
    const problems: string[] = [];
    for (const seed of SEEDS) {
      const alerts = randomAlerts(seed, 2 + (seed % 12));
      const groups = correlateAlerts(alerts);
      const all = groups.flatMap((g) => ids(g.alerts)).sort();
      if (JSON.stringify(all) !== JSON.stringify(ids(alerts).sort()))
        problems.push(`seed ${seed}: bukan sekatan`);
      const shuffled = [...alerts].sort(() => rng(seed)() - 0.5).reverse();
      if (
        JSON.stringify(normalize(correlateAlerts(shuffled))) !==
        JSON.stringify(normalize(groups))
      )
        problems.push(`seed ${seed}: bergantung urutan`);
      if (
        JSON.stringify(correlateAlerts(shuffled).map((g) => g.id)) !==
        JSON.stringify(groups.map((g) => g.id))
      )
        problems.push(
          `seed ${seed}: id/urutan kelompok bergantung urutan masukan`,
        );
    }
    expect(problems.slice(0, 3)).toEqual([]);
  });

  test("kelompok itu tertutup: menghitung ulang anggotanya saja tetap satu kelompok yang sama", () => {
    const problems: string[] = [];
    for (const seed of SEEDS) {
      const alerts = randomAlerts(seed, 2 + (seed % 12));
      for (const group of correlateAlerts(alerts)) {
        if (group.alerts.length < 2) continue;
        const again = correlateAlerts(group.alerts);
        if (
          again.length !== 1 ||
          JSON.stringify(ids(again[0].alerts).sort()) !==
            JSON.stringify(ids(group.alerts).sort())
        )
          problems.push(
            `seed ${seed}: ${group.id} pecah saat dihitung sendirian`,
          );
      }
    }
    expect(problems.slice(0, 3)).toEqual([]);
  });

  test("menambah alert tidak pernah memecah kelompok yang sudah ada", () => {
    const problems: string[] = [];
    for (const seed of SEEDS) {
      const alerts = randomAlerts(seed, 3 + (seed % 10));
      const extra = randomAlerts(seed + 50_000, 1)[0];
      const before = correlateAlerts(alerts);
      const afterGroups = correlateAlerts([...alerts, extra]);
      const groupOf = new Map<string, string>();
      for (const g of afterGroups)
        for (const a of g.alerts) groupOf.set(a.id, g.id);
      for (const g of before) {
        const roots = new Set(g.alerts.map((a) => groupOf.get(a.id)));
        if (roots.size > 1)
          problems.push(
            `seed ${seed}: ${g.id} terpecah setelah ${extra.id} ditambah`,
          );
      }
    }
    expect(problems.slice(0, 3)).toEqual([]);
  });

  test("menghapus alert tidak menggabungkan kelompok yang terpisah", () => {
    const problems: string[] = [];
    for (const seed of SEEDS) {
      const alerts = randomAlerts(seed, 4 + (seed % 10));
      const removed = alerts[seed % alerts.length];
      const rest = alerts.filter((a) => a.id !== removed.id);
      const full = correlateAlerts(alerts);
      const groupOf = new Map<string, string>();
      for (const g of full) for (const a of g.alerts) groupOf.set(a.id, g.id);
      for (const g of correlateAlerts(rest)) {
        const origins = new Set(g.alerts.map((a) => groupOf.get(a.id)));
        if (origins.size > 1)
          problems.push(
            `seed ${seed}: ${g.id} menggabungkan kelompok berbeda setelah ${removed.id} dihapus`,
          );
      }
    }
    expect(problems.slice(0, 3)).toEqual([]);
  });

  test("kartu: satu kartu per kelompok, anggota sama, id sama, dan kartu tunggal tanpa id korelasi", () => {
    const problems: string[] = [];
    for (const seed of SEEDS) {
      const alerts = randomAlerts(seed, 1 + (seed % 13));
      const groups = correlateAlerts(alerts);
      const cards = buildIncidentCards(alerts);
      if (cards.length !== groups.length)
        problems.push(`seed ${seed}: jumlah kartu`);
      if (
        JSON.stringify(cardIds(cards)) !==
        JSON.stringify(groups.map((g) => g.id))
      )
        problems.push(`seed ${seed}: id/urutan kartu`);
      for (const card of cards) {
        const group = groups.find((g) => g.id === card.id)!;
        if (
          JSON.stringify(ids(card.alerts)) !== JSON.stringify(ids(group.alerts))
        )
          problems.push(`seed ${seed}: anggota ${card.id}`);
        if (card.alertCount > 1 !== (card.correlationId === card.id))
          problems.push(`seed ${seed}: correlationId ${card.id}`);
        if (card.alertCount === 1 && card.correlationId !== null)
          problems.push(`seed ${seed}: tunggal bercorrelationId`);
      }
    }
    expect(problems.slice(0, 3)).toEqual([]);
  });

  test("hub: menerapkan hanya pesan perubahan selalu sama dengan hitung penuh pada tiap langkah acak", () => {
    const problems: string[] = [];
    for (const seed of SEEDS.slice(0, 120)) {
      const random = rng(seed);
      const pool = randomAlerts(seed, 12);
      let active = pool.filter(() => random() < 0.5);
      const hub = createMockIncidentHub(() => buildIncidentCards(active));
      let screen: IncidentCard[] | null = null;
      screen = mergeIncidentCards(screen, hub.snapshot(0));
      for (let step = 0; step < 25; step += 1) {
        // Beberapa alert muncul atau selesai.
        active = pool.filter((a) =>
          active.includes(a) ? random() > 0.15 : random() < 0.12,
        );
        const sent = hub.changes(step);
        if (sent) screen = mergeIncidentCards(screen, sent);
        if (
          listSignature(screen!) !== listSignature(buildIncidentCards(active))
        )
          problems.push(
            `seed ${seed} langkah ${step}: layar berbeda dari hitung penuh`,
          );
      }
    }
    expect(problems.slice(0, 3)).toEqual([]);
  });
});
