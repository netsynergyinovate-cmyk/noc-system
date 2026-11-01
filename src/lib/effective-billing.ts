// Aturan status isolir efektif: router dulu (customers.isolir_router, ditulis poller Go),
// billing hanya cadangan saat router belum memberi bukti (null/undefined).
// Versi SQL-nya: src/services/customer-isolir.ts; Go: state.Customer.EffectiveBillingStatus.
export function effectiveBillingStatus(
  isolirRouter: boolean | null | undefined,
  billing: "lunas" | "isolir",
): "lunas" | "isolir" {
  return (isolirRouter ?? billing === "isolir") ? "isolir" : "lunas";
}
