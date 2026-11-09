import {
  handleFailureMessages,
  type AlertActions,
  type HandleAlertFailure,
  type HandleAlertResult,
} from "./alert-actions.ts";
import { toLiveResolvedAlerts, type LiveAlertItem } from "./alerts-live.ts";

// Tindakan petugas NYATA: POST /api/alerts/{id}/handle. Siapa yang menandai dan
// kapan diambil server dari sesi login dan jamnya sendiri; nama dari argumen
// tidak dikirim.
export function createLiveAlertActions(): AlertActions {
  const fail = (
    reason: HandleAlertFailure,
    message?: string,
  ): HandleAlertResult => ({
    ok: false,
    reason,
    message: message ?? handleFailureMessages[reason],
  });

  return {
    async handle(alertId) {
      let res: Response;
      try {
        res = await fetch(`/api/alerts/${encodeURIComponent(alertId)}/handle`, {
          method: "POST",
        });
      } catch {
        return fail("offline");
      }
      if (res.status === 404 || res.status === 409) return fail("not-active");
      if (res.status === 403) return fail("forbidden");
      if (!res.ok) {
        // Server menjawab tetapi gagal memproses: belum ada yang berubah, boleh coba lagi.
        return fail(
          "offline",
          `Server gagal memproses permintaan (HTTP ${res.status}). Coba lagi.`,
        );
      }
      const json = (await res.json().catch(() => null)) as {
        data?: LiveAlertItem;
      } | null;
      const [alert] = json?.data ? toLiveResolvedAlerts([json.data]) : [];
      return alert ? { ok: true, alert } : fail("not-active");
    },
  };
}
