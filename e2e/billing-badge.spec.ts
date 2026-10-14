import { expect, test } from "@playwright/test";
import { billingStatusLabels } from "../src/lib/dashboard/billing";
import {
  billingBadge,
  billingBadgeLegend,
  unknownBillingLabel,
  type BillingBadgeState,
} from "../src/lib/dashboard/billing-badge";
import type { BillingStatus } from "../src/lib/dashboard/types";

// Penanda status pembayaran (Lunas, Isolir, dan netral): artinya ditentukan di
// sini, tanpa layar. Tampilannya diuji di billing-badge-ui.spec.ts.

const states: BillingBadgeState[] = ["lunas", "isolir", "unknown"];
const inputFor = (state: BillingBadgeState): BillingStatus | null =>
  state === "unknown" ? null : state;

test.describe("penanda status pembayaran", () => {
  test("tiga keadaan: lunas hijau dengan centang, isolir merah dengan larangan, netral abu-abu dengan tanda tanya", () => {
    expect(billingBadge("lunas")).toEqual({
      state: "lunas",
      tone: "success",
      icon: "check",
      label: "Lunas",
      hint: "Tagihan sudah dibayar.",
    });
    expect(billingBadge("isolir")).toEqual({
      state: "isolir",
      tone: "danger",
      icon: "ban",
      label: "Isolir",
      hint: "Layanan dibatasi karena tagihan belum dibayar.",
    });
    expect(billingBadge(null)).toEqual({
      state: "unknown",
      tone: "neutral",
      icon: "help",
      label: "Belum ada data",
      hint: "Status pembayaran belum diketahui, misalnya sebelum sinkron billing pertama berhasil.",
    });
  });

  test("tulisan Lunas dan Isolir sama dengan yang dipakai di tabel dan daftar tagihan", () => {
    expect(billingBadge("lunas").label).toBe(billingStatusLabels.lunas);
    expect(billingBadge("isolir").label).toBe(billingStatusLabels.isolir);
    expect(billingBadge(null).label).toBe(unknownBillingLabel);
  });

  test("kosong, tidak dikenal, atau ditulis lain menjadi netral, bukan lunas dan bukan galat", () => {
    const unexpected: unknown[] = [
      null,
      undefined,
      "",
      " ",
      "LUNAS",
      "Lunas",
      "isolir ",
      "pending",
      "paid",
      0,
      1,
      false,
      true,
      {},
      [],
      ["lunas"],
    ];
    for (const value of unexpected) {
      const model = billingBadge(value as BillingStatus | null | undefined);
      expect(model.state, JSON.stringify(value)).toBe("unknown");
      expect(model.tone, JSON.stringify(value)).toBe("neutral");
      expect(model.label, JSON.stringify(value)).toBe("Belum ada data");
    }
  });

  test("ketiganya dibedakan oleh tulisan, bentuk ikon, dan nada, jadi bukan hanya warna", () => {
    const models = states.map((state) => billingBadge(inputFor(state)));
    expect(new Set(models.map((model) => model.label)).size).toBe(3);
    expect(new Set(models.map((model) => model.icon)).size).toBe(3);
    expect(new Set(models.map((model) => model.tone)).size).toBe(3);
    expect(new Set(models.map((model) => model.hint)).size).toBe(3);
    expect(models.map((model) => model.state)).toEqual(states);
  });

  test("tulisan dan keterangan terisi dan berupa kalimat bahasa Indonesia yang wajar", () => {
    for (const state of states) {
      const model = billingBadge(inputFor(state));
      expect(model.label.trim()).toBe(model.label);
      expect(model.label.length).toBeGreaterThan(3);
      expect(model.label.length).toBeLessThan(20);
      expect(model.hint).toMatch(/^[A-Z].{15,}\.$/);
      expect(model.hint).not.toMatch(/undefined|null|NaN/);
    }
  });

  test("netral tidak memakai nada hijau atau merah, supaya tidak tampak benar atau salah", () => {
    expect(billingBadge(null).tone).not.toBe(billingBadge("lunas").tone);
    expect(billingBadge(null).tone).not.toBe(billingBadge("isolir").tone);
    expect(billingBadge(undefined)).toBe(billingBadge(null));
  });

  test("model yang dibagikan tidak bisa diubah pemanggil", () => {
    for (const state of states) {
      const model = billingBadge(inputFor(state));
      expect(Object.isFrozen(model), state).toBe(true);
      const label = model.label;
      try {
        (model as { label: string }).label = "diubah";
      } catch {
        // Mode ketat melempar galat, mode biasa diam; hasilnya sama.
      }
      // Yang diminta lagi tetap yang asli.
      expect(billingBadge(inputFor(state)).label).toBe(label);
      expect(billingBadge(inputFor(state))).toBe(model);
    }
  });

  test("legenda memuat ketiga keadaan tepat sekali, urut lunas, isolir, netral", () => {
    expect(billingBadgeLegend).toEqual(["lunas", "isolir", null]);
    expect(
      billingBadgeLegend.map((status) => billingBadge(status).state),
    ).toEqual(states);
  });
});
