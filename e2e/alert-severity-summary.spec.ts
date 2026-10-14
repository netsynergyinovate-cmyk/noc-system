import { expect, test } from "@playwright/test";
import {
  mockActiveAlerts,
  summarizeAlertSeverity,
} from "../src/lib/dashboard/alerts";
import { GRID, findMoments } from "./alert-moments";

// Ringkasan tingkat alert aktif (jumlah kritis, peringatan, info, dan warna
// menurut yang paling genting). Tanpa browser.

test.describe("ringkasan tingkat alert", () => {
  test("sama dengan hitungan sendiri pada setiap momen, dan jumlahnya cocok", () => {
    for (const t of GRID) {
      const alerts = mockActiveAlerts(t);
      const summary = summarizeAlertSeverity(alerts);
      const count = (severity: string) =>
        alerts.filter((alert) => alert.severity === severity).length;
      expect(summary.total, String(t)).toBe(alerts.length);
      expect(summary.critical, String(t)).toBe(count("critical"));
      expect(summary.warning, String(t)).toBe(count("warning"));
      expect(summary.info, String(t)).toBe(count("info"));
      expect(summary.critical + summary.warning + summary.info).toBe(
        summary.total,
      );
    }
  });

  test("warna menurut yang paling genting: kosong ok, ada kritis critical, selain itu warning", () => {
    expect(summarizeAlertSeverity([]).tone).toBe("ok");
    expect(summarizeAlertSeverity([{ severity: "warning" }]).tone).toBe(
      "warning",
    );
    expect(summarizeAlertSeverity([{ severity: "info" }]).tone).toBe("warning");
    expect(
      summarizeAlertSeverity([
        { severity: "warning" },
        { severity: "critical" },
      ]).tone,
    ).toBe("critical");
    // Urutan masukan tidak memengaruhi, dan masukannya tidak diubah.
    const input = [
      { severity: "info" },
      { severity: "critical" },
      { severity: "warning" },
    ] as const;
    const copy = JSON.stringify(input);
    expect(summarizeAlertSeverity(input)).toEqual(
      summarizeAlertSeverity([...input].reverse()),
    );
    expect(JSON.stringify(input)).toBe(copy);
    expect(summarizeAlertSeverity(input)).toEqual({
      total: 3,
      critical: 1,
      warning: 1,
      info: 1,
      tone: "critical",
    });
  });

  test("data tiruan punya momen kosong, hanya peringatan, dan campuran, jadi ketiga keadaan bisa diuji", () => {
    const { mixed, warningOnly, empty } = findMoments();
    expect(mixed.summary.tone).toBe("critical");
    expect(warningOnly.summary.tone).toBe("warning");
    expect(warningOnly.summary.warning).toBeGreaterThan(0);
    expect(empty.summary).toEqual({
      total: 0,
      critical: 0,
      warning: 0,
      info: 0,
      tone: "ok",
    });
  });
});
