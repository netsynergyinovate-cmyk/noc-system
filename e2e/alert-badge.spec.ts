import { expect, test } from "@playwright/test";
import { ALERT_BADGE_MAX, alertBadge } from "../src/lib/dashboard/alert-badge";
import {
  mockActiveAlerts,
  summarizeAlertSeverity,
} from "../src/lib/dashboard/alerts";
import { GRID } from "./alert-moments";

// Lencana jumlah alert aktif di menu: tulisan, batas, dan kesamaannya dengan angka
// yang dipakai kartu daftar aktif dan lencana di dasbor. Tanpa browser.

const alerts = (counts: {
  critical?: number;
  warning?: number;
  info?: number;
}) =>
  [
    ...Array(counts.critical ?? 0).fill({ severity: "critical" as const }),
    ...Array(counts.warning ?? 0).fill({ severity: "warning" as const }),
    ...Array(counts.info ?? 0).fill({ severity: "info" as const }),
  ] as Array<{ severity: "critical" | "warning" | "info" }>;

const badge = (counts: Parameters<typeof alerts>[0], stale = false) =>
  alertBadge(summarizeAlertSeverity(alerts(counts)), stale);

test.describe("lencana jumlah alert aktif", () => {
  test("belum ada daftar berarti belum ada lencana, bukan angka nol", () => {
    expect(alertBadge(null, false)).toBeNull();
    expect(alertBadge(null, true)).toBeNull();
  });

  test("tanpa alert: hanya tanda normal, dengan kalimat yang utuh", () => {
    expect(badge({})).toEqual({
      tone: "ok",
      total: 0,
      critical: 0,
      text: "",
      description: "Tidak ada alert aktif",
      stale: false,
    });
  });

  test("tanpa yang kritis: angka dan tingkat peringatan, tanpa kata kritis", () => {
    const model = badge({ warning: 4 })!;
    expect(model.tone).toBe("warning");
    expect(model.text).toBe("4");
    expect(model.description).toBe("4 alert aktif");
    expect(model.critical).toBe(0);
    // Info saja juga hanya dihitung, dengan tingkat peringatan seperti kartu.
    const info = badge({ info: 2 })!;
    expect(info.text).toBe("2");
    expect(info.description).toBe("2 alert aktif");
    expect(info.tone).toBe(summarizeAlertSeverity(alerts({ info: 2 })).tone);
  });

  test("ada yang kritis: tingkat kritis, dan jumlah kritisnya disebut", () => {
    const model = badge({ critical: 1, warning: 4 })!;
    expect(model.tone).toBe("critical");
    expect(model.text).toBe("5");
    expect(model.critical).toBe(1);
    expect(model.description).toBe("5 alert aktif, 1 kritis");
  });

  test("angka di lencana dibatasi 99+, tegas di batasnya, sedangkan kalimatnya menyebut jumlah sebenarnya", () => {
    expect(ALERT_BADGE_MAX).toBe(99);
    expect(badge({ warning: 98 })!.text).toBe("98");
    expect(badge({ warning: 99 })!.text).toBe("99");
    expect(badge({ warning: 100 })!.text).toBe("99+");
    const big = badge({ critical: 12, warning: 1_222 })!;
    expect(big.text).toBe("99+");
    expect(big.total).toBe(1_234);
    expect(big.description).toBe("1.234 alert aktif, 12 kritis");
    expect(badge({ warning: 100 })!.description).toBe("100 alert aktif");
  });

  test("sambungan terputus: tulisannya sama, kalimatnya menyebut data terakhir", () => {
    for (const counts of [{}, { warning: 3 }, { critical: 2, warning: 3 }]) {
      const live = badge(counts)!;
      const stale = badge(counts, true)!;
      expect(stale.text).toBe(live.text);
      expect(stale.tone).toBe(live.tone);
      expect(stale.stale).toBe(true);
      expect(stale.description).toBe(
        `${live.description} (koneksi terputus, data terakhir)`,
      );
    }
    expect(badge({ warning: 1 })!.stale).toBe(false);
  });

  test("di sepanjang data tiruan angkanya sama dengan jumlah alert aktif dan tingkatnya sama dengan ringkasan", () => {
    const problems: string[] = [];
    let withCritical = 0;
    let zero = 0;
    for (const t of GRID) {
      const active = mockActiveAlerts(t);
      const summary = summarizeAlertSeverity(active);
      const model = alertBadge(summary, false)!;
      if (model.total !== active.length) problems.push(`${t}: jumlah`);
      if (
        model.critical !==
        active.filter((alert) => alert.severity === "critical").length
      )
        problems.push(`${t}: kritis`);
      if (model.tone !== summary.tone) problems.push(`${t}: tingkat`);
      if (active.length > 0 && active.length <= ALERT_BADGE_MAX) {
        if (model.text !== String(active.length)) problems.push(`${t}: teks`);
      }
      if (active.length === 0 && model.text !== "") problems.push(`${t}: nol`);
      if (model.critical > 0) withCritical += 1;
      if (active.length === 0) zero += 1;
    }
    expect(problems).toEqual([]);
    // Datanya memuat ketiga keadaan, jadi uji ini bermakna.
    expect(withCritical).toBeGreaterThan(50);
    expect(zero).toBeGreaterThan(5);
  });
});
