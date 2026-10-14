import { expect, test } from "@playwright/test";
import {
  mockActiveAlerts,
  type ActiveAlert,
} from "../src/lib/dashboard/alerts";
import {
  BURST_MIN,
  BURST_WINDOW,
  IMPACT_AFTER,
  IMPACT_BEFORE,
  ODP_WINDOW,
  ROUTER_WINDOW,
  correlateAlerts,
  summarizeCorrelation,
  timeGap,
} from "../src/lib/dashboard/correlation";
import { defaultSeverity } from "../src/lib/dashboard/incidents";
import type { IncidentKind } from "../src/lib/dashboard/types";

// Engine korelasi alert se-penyebab: murni, jadi diuji dengan alert buatan
// tangan (satu aturan per test) dan dengan invarian pada seluruh data tiruan.

const T0 = 1_791_400_000;
let counter = 0;

interface Spec {
  kind: IncidentKind;
  at?: number; // detik sejak T0
  router?: string;
  odp?: string | null;
  uncertainty?: number;
  customer?: string | null;
  id?: string;
}

function alert(spec: Spec): ActiveAlert {
  counter += 1;
  const isCustomer = spec.kind === "offline" || spec.kind === "optical";
  const customerId = isCustomer ? (spec.customer ?? `cust-${counter}`) : null;
  const router = spec.router ?? "router-1";
  const odp = isCustomer ? (spec.odp === undefined ? "ODP-A" : spec.odp) : null;
  const startedAt = T0 + (spec.at ?? 0);
  return {
    id: spec.id ?? `a${counter}`,
    kind: spec.kind,
    severity: defaultSeverity[spec.kind],
    startedAt,
    endedAt: null,
    routerId: router,
    customerId,
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
      name: isCustomer ? (odp ?? "alamat") : `Nama-${router}`,
      address: isCustomer ? "Jl. Contoh" : null,
      odpName: odp,
      latitude: isCustomer ? -6.9 : null,
      longitude: isCustomer ? 107.6 : null,
    },
  };
}

const groupsOf = (alerts: ActiveAlert[]) => correlateAlerts(alerts);
const sizes = (alerts: ActiveAlert[]) =>
  groupsOf(alerts)
    .map((group) => group.alerts.length)
    .sort((a, b) => b - a);

test.describe("pengelompokan dasar", () => {
  test("tanpa alert tidak ada kelompok", () => {
    expect(correlateAlerts([])).toEqual([]);
    expect(summarizeCorrelation([])).toEqual({
      alerts: 0,
      groups: 0,
      correlated: 0,
      saved: 0,
    });
  });

  test("satu alert menjadi kelompok tunggal tanpa keyakinan", () => {
    const [group] = groupsOf([alert({ kind: "offline", odp: "ODP-A" })]);
    expect(group.cause).toBe("single");
    expect(group.confidence).toBeNull();
    expect(group.alerts).toHaveLength(1);
    expect(group.customerCount).toBe(1);
    expect(group.title).toContain("Pelanggan offline");
    expect(group.reasons).toEqual([]);
    const [router] = groupsOf([alert({ kind: "cpu" })]);
    expect(router.cause).toBe("single");
    expect(router.customerCount).toBe(0);
  });

  test("pelanggan di ODP yang sama yang mulai berdekatan menjadi satu kelompok ODP", () => {
    const groups = groupsOf([
      alert({ kind: "offline", at: 0 }),
      alert({ kind: "offline", at: 30 }),
      alert({ kind: "optical", at: 90 }),
    ]);
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group.cause).toBe("odp");
    expect(group.odpName).toBe("ODP-A");
    expect(group.customerCount).toBe(3);
    expect(group.title).toBe("ODP-A: 3 pelanggan terdampak");
    expect(group.confidence).toBe("high"); // tiga alert dalam 90 detik
    expect(group.reasons[0]).toContain("3 pelanggan di ODP yang sama");
  });

  test("keyakinan: sedang untuk dua alert atau tiga yang tersebar, tinggi untuk banyak", () => {
    const conf = (alerts: ActiveAlert[]) => groupsOf(alerts)[0].confidence;
    expect(
      conf([
        alert({ kind: "offline", at: 0 }),
        alert({ kind: "offline", at: 10 }),
      ]),
    ).toBe("medium");
    expect(
      conf([
        alert({ kind: "offline", at: 0 }),
        alert({ kind: "offline", at: 200 }),
        alert({ kind: "offline", at: 400 }),
      ]),
    ).toBe("medium");
    expect(
      conf([0, 200, 400, 500].map((at) => alert({ kind: "offline", at }))),
    ).toBe("high");
  });
});

test.describe("aturan ODP", () => {
  test("ODP yang berbeda, atau router yang berbeda, tidak disatukan", () => {
    expect(
      sizes([
        alert({ kind: "optical", odp: "ODP-A", at: 0 }),
        alert({ kind: "optical", odp: "ODP-B", at: 10 }),
      ]),
    ).toEqual([1, 1]);
    // Nama ODP yang sama di router berbeda bukan ODP yang sama.
    expect(
      sizes([
        alert({ kind: "optical", odp: "ODP-A", router: "router-1", at: 0 }),
        alert({ kind: "optical", odp: "ODP-A", router: "router-2", at: 10 }),
      ]),
    ).toEqual([1, 1]);
  });

  test("pelanggan tanpa ODP tidak pernah disatukan lewat ODP", () => {
    expect(
      sizes([
        alert({ kind: "optical", odp: null, at: 0 }),
        alert({ kind: "optical", odp: null, at: 10 }),
      ]),
    ).toEqual([1, 1]);
  });

  test("jendela waktu: tepat batas masuk, satu detik lewat tidak", () => {
    expect(
      sizes([
        alert({ kind: "optical", at: 0 }),
        alert({ kind: "optical", at: ODP_WINDOW }),
      ]),
    ).toEqual([2]);
    expect(
      sizes([
        alert({ kind: "optical", at: 0 }),
        alert({ kind: "optical", at: ODP_WINDOW + 1 }),
      ]),
    ).toEqual([1, 1]);
  });

  test("ketidakpastian waktu dari polling memperlebar jendela", () => {
    // 700 detik terpisah; masing-masing bisa mulai sampai 60 detik lebih awal.
    expect(
      sizes([
        alert({ kind: "optical", at: 0, uncertainty: 60 }),
        alert({ kind: "optical", at: 700, uncertainty: 60 }),
      ]),
    ).toEqual([2]);
    // Waktu persis dari router tidak diberi kelonggaran.
    expect(
      sizes([
        alert({ kind: "optical", at: 0 }),
        alert({ kind: "optical", at: 700 }),
      ]),
    ).toEqual([1, 1]);
    const a = alert({ kind: "optical", at: 0, uncertainty: 60 });
    const b = alert({ kind: "optical", at: 700, uncertainty: 10 });
    expect(timeGap(a, b)).toBe(630);
    expect(
      timeGap(a, alert({ kind: "optical", at: 30, uncertainty: 60 })),
    ).toBe(0);
  });

  test("offline dan sinyal optik di ODP yang sama saling berkaitan", () => {
    const [group] = groupsOf([
      alert({ kind: "offline", at: 0 }),
      alert({ kind: "optical", at: 100 }),
    ]);
    expect(group.alerts.map((a) => a.kind)).toEqual(["offline", "optical"]);
  });

  test("pelanggan yang sama dengan dua alert dihitung satu pelanggan", () => {
    const [group] = groupsOf([
      alert({ kind: "offline", customer: "c-1", at: 0 }),
      alert({ kind: "optical", customer: "c-1", at: 20 }),
    ]);
    expect(group.alerts).toHaveLength(2);
    expect(group.customerCount).toBe(1);
  });
});

test.describe("aturan router", () => {
  test("alert router pada router yang sama dalam jendela menjadi satu kelompok", () => {
    const [group] = groupsOf([
      alert({ kind: "queue", at: 0 }),
      alert({ kind: "cpu", at: ROUTER_WINDOW }),
    ]);
    expect(group.cause).toBe("router");
    expect(group.customerCount).toBe(0);
    expect(group.title).toBe(
      "router-1: jalur traffic penuh, beban router tinggi",
    );
    expect(group.severity).toBe("critical");
    expect(
      sizes([
        alert({ kind: "queue", at: 0 }),
        alert({ kind: "cpu", at: ROUTER_WINDOW + 1 }),
      ]),
    ).toEqual([1, 1]);
    expect(
      sizes([
        alert({ kind: "queue", at: 0, router: "router-1" }),
        alert({ kind: "queue", at: 5, router: "router-2" }),
      ]),
    ).toEqual([1, 1]);
  });

  test("nama router untuk judul diambil dari pemanggil", () => {
    const [group] = correlateAlerts(
      [alert({ kind: "queue", at: 0 }), alert({ kind: "port", at: 10 })],
      { routerName: (id) => `RTR ${id.toUpperCase()}` },
    );
    expect(group.title).toBe(
      "RTR ROUTER-1: jalur traffic penuh, error pada port",
    );
  });

  test("rantai alert yang saling berdekatan menjadi satu kelompok walau ujungnya jauh", () => {
    const alerts = [0, 800, 1600].map((at) => alert({ kind: "cpu", at }));
    expect(sizes(alerts)).toEqual([3]);
  });
});

test.describe("dampak router pada pelanggan", () => {
  const offlineAt = (at: number, odp: string, extra: Partial<Spec> = {}) =>
    alert({ kind: "offline", at, odp, ...extra });

  test("alert router dan beberapa pelanggan offline di router itu menjadi satu penyebab", () => {
    const [group] = groupsOf([
      alert({ kind: "cpu", at: 0 }),
      offlineAt(30, "ODP-A"),
      offlineAt(200, "ODP-B"),
    ]);
    expect(group.cause).toBe("router");
    expect(group.customerCount).toBe(2);
    expect(group.alerts).toHaveLength(3);
    expect(group.reasons.join(" ")).toContain("2 pelanggan di router ini");
  });

  test("satu pelanggan offline saja tidak cukup untuk menyalahkan router", () => {
    expect(
      sizes([alert({ kind: "cpu", at: 0 }), offlineAt(30, "ODP-A")]),
    ).toEqual([1, 1]);
  });

  test("batas jendela dampak: sedikit sebelum sampai beberapa menit sesudah", () => {
    // Satu pelanggan penjangkar di dalam jendela supaya syarat dua pelanggan
    // terpenuhi; yang diuji adalah dua pelanggan lain tepat di batas.
    const base = alert({ kind: "cpu", at: 1000 });
    const run = (before: number, after: number) =>
      sizes([
        base,
        offlineAt(1010, "ODP-C"),
        offlineAt(1000 - before, "ODP-A"),
        offlineAt(1000 + after, "ODP-B"),
      ]);
    expect(run(IMPACT_BEFORE, IMPACT_AFTER)).toEqual([4]);
    expect(run(IMPACT_BEFORE + 1, IMPACT_AFTER)).toEqual([3, 1]);
    expect(run(IMPACT_BEFORE, IMPACT_AFTER + 1)).toEqual([3, 1]);
  });

  test("pelanggan di router lain tidak ikut", () => {
    // Tiga pelanggan di router-2 membentuk lonjakan sendiri, terpisah dari
    // alert CPU di router-1.
    expect(
      sizes([
        alert({ kind: "cpu", at: 0, router: "router-1" }),
        offlineAt(10, "ODP-A", { router: "router-2" }),
        offlineAt(20, "ODP-B", { router: "router-2" }),
        offlineAt(30, "ODP-C", { router: "router-2" }),
      ]),
    ).toEqual([3, 1]);
  });
});

test.describe("lonjakan offline", () => {
  const offline = (at: number, odp: string) =>
    alert({ kind: "offline", at, odp });

  test("banyak pelanggan di ODP berbeda yang putus berurutan menjadi satu penyebab uplink", () => {
    const [group] = correlateAlerts(
      [offline(0, "ODP-A"), offline(100, "ODP-B"), offline(200, "ODP-C")],
      { routerName: () => "RTR-Barat-02" },
    );
    expect(group.cause).toBe("uplink");
    expect(group.customerCount).toBe(3);
    expect(group.title).toBe("3 pelanggan offline bersamaan di RTR-Barat-02");
    expect(group.reasons[0]).toContain("ODP berbeda");
  });

  test("kurang dari batas minimum, atau jeda terlalu panjang, tidak disebut lonjakan", () => {
    expect(BURST_MIN).toBe(3);
    expect(sizes([offline(0, "ODP-A"), offline(50, "ODP-B")])).toEqual([1, 1]);
    // Jeda BURST_WINDOW + 1 memutus rangkaian menjadi dua pasang.
    expect(
      sizes([
        offline(0, "ODP-A"),
        offline(100, "ODP-B"),
        offline(100 + BURST_WINDOW + 1, "ODP-C"),
        offline(200 + BURST_WINDOW + 1, "ODP-D"),
      ]),
    ).toEqual([1, 1, 1, 1]);
    // Tepat BURST_WINDOW masih satu rangkaian.
    expect(
      sizes([
        offline(0, "ODP-A"),
        offline(BURST_WINDOW, "ODP-B"),
        offline(2 * BURST_WINDOW, "ODP-C"),
      ]),
    ).toEqual([3]);
  });

  test("lonjakan di satu ODP tetap dinamai ODP-nya, bukan uplink", () => {
    const [group] = groupsOf([
      offline(0, "ODP-A"),
      offline(60, "ODP-A"),
      offline(120, "ODP-A"),
    ]);
    expect(group.cause).toBe("odp");
  });

  test("lonjakan di router yang berbeda tidak digabung", () => {
    expect(
      sizes([
        alert({ kind: "offline", at: 0, odp: "ODP-A", router: "router-1" }),
        alert({ kind: "offline", at: 10, odp: "ODP-B", router: "router-2" }),
        alert({ kind: "offline", at: 20, odp: "ODP-C", router: "router-1" }),
      ]),
    ).toEqual([1, 1, 1]);
  });

  test("ODP yang berdekatan ikut lonjakan, menjadi satu kelompok uplink", () => {
    const [group] = groupsOf([
      offline(0, "ODP-A"),
      offline(40, "ODP-A"),
      offline(80, "ODP-B"),
    ]);
    expect(group.alerts).toHaveLength(3);
    expect(group.cause).toBe("uplink");
    expect(group.odpName).toBeNull();
  });
});

test.describe("sifat umum", () => {
  const sample = () => [
    alert({ id: "z1", kind: "cpu", at: 0 }),
    alert({ id: "z2", kind: "offline", at: 20, odp: "ODP-A" }),
    alert({ id: "z3", kind: "offline", at: 90, odp: "ODP-B" }),
    alert({ id: "z4", kind: "optical", at: 3000, odp: "ODP-C" }),
    alert({ id: "z5", kind: "optical", at: 3100, odp: "ODP-C" }),
    alert({ id: "z6", kind: "queue", at: 5000, router: "router-2" }),
  ];

  test("urutan masukan tidak memengaruhi hasil", () => {
    const base = correlateAlerts(sample());
    const shape = (groups: typeof base) =>
      groups.map((group) => [
        group.id,
        group.cause,
        group.alerts.map((a) => a.id),
      ]);
    const input = sample();
    for (const permutation of [
      [...input].reverse(),
      [input[3], input[0], input[5], input[1], input[4], input[2]],
      [input[2], input[5], input[4], input[3], input[1], input[0]],
    ]) {
      expect(shape(correlateAlerts(permutation))).toEqual(shape(base));
    }
  });

  test("masukan tidak diubah", () => {
    const input = sample();
    const snapshot = JSON.stringify(input);
    correlateAlerts(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  test("kelompok urut dari yang paling genting, lalu terbesar, lalu terbaru", () => {
    const groups = correlateAlerts(sample());
    expect(groups.map((g) => g.alerts.map((a) => a.id))).toEqual([
      ["z1", "z2", "z3"], // kritis (CPU) dan terbesar
      ["z6"], // kritis, tunggal
      ["z4", "z5"], // peringatan
    ]);
    expect(groups[0].severity).toBe("critical");
    expect(groups[2].severity).toBe("warning");
  });

  test("ringkasan menghitung baris yang dihemat", () => {
    expect(summarizeCorrelation(correlateAlerts(sample()))).toEqual({
      alerts: 6,
      groups: 3,
      correlated: 2,
      saved: 3,
    });
  });

  test("id kelompok mengikuti alert tertuanya dan stabil saat anggota bertambah", () => {
    const first = alert({ id: "tua", kind: "offline", at: 0, odp: "ODP-A" });
    const second = alert({ id: "muda", kind: "offline", at: 30, odp: "ODP-A" });
    expect(correlateAlerts([first])[0].id).toBe("grp-tua");
    expect(correlateAlerts([first, second])[0].id).toBe("grp-tua");
  });
});

test.describe("pada seluruh data tiruan", () => {
  const times = Array.from({ length: 2016 }, (_, i) => T0 + i * 300);

  test("setiap alert ada di tepat satu kelompok, dan kelompok konsisten", () => {
    const problems: string[] = [];
    for (const t of times) {
      const alerts = mockActiveAlerts(t);
      const groups = correlateAlerts(alerts);
      const ids = groups
        .flatMap((group) => group.alerts.map((a) => a.id))
        .sort();
      if (
        JSON.stringify(ids) !== JSON.stringify(alerts.map((a) => a.id).sort())
      )
        problems.push(`t=${t}: sekatan tidak lengkap`);
      if (new Set(groups.map((g) => g.id)).size !== groups.length)
        problems.push(`t=${t}: id kelompok ganda`);
      for (const group of groups) {
        if (new Set(group.alerts.map((a) => a.routerId)).size !== 1)
          problems.push(`${group.id}: lintas router`);
        const starts = group.alerts.map((a) => a.startedAt);
        if (starts.join() !== [...starts].sort((a, b) => a - b).join())
          problems.push(`${group.id}: anggota tidak urut`);
        if (group.startedAt !== Math.min(...starts))
          problems.push(`${group.id}: startedAt`);
        const customers = new Set(
          group.alerts.flatMap((a) => (a.customerId ? [a.customerId] : [])),
        );
        if (group.customerCount !== customers.size)
          problems.push(`${group.id}: customerCount`);
        if ((group.alerts.length === 1) !== (group.cause === "single"))
          problems.push(`${group.id}: sebab tunggal`);
        if ((group.confidence === null) !== (group.alerts.length === 1))
          problems.push(`${group.id}: keyakinan`);
      }
      if (JSON.stringify(correlateAlerts(alerts)) !== JSON.stringify(groups))
        problems.push(`t=${t}: tidak deterministik`);
    }
    expect(problems).toEqual([]);
  });
});
