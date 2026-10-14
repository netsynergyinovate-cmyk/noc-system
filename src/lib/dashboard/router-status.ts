import type { ConnectionStatus } from "./device-config";

export type RouterStatusKind = "testing" | "connected" | "error" | "timeout" | "untested";

export interface RouterStatusBadgeOptions {
  active?: boolean;
  status?: ConnectionStatus;
  isTesting?: boolean;
  latencyMs?: number | null;
  showLatency?: boolean;
  label?: string;
}

export interface RouterStatusBadgeModel {
  kind: RouterStatusKind;
  label: string;
  ariaLabel: string;
  busy: boolean;
}

const PREFIX = "Status koneksi router: ";

/** Model badge status REST router. `isTesting` menimpa status; `status` menimpa `active`. */
export function getRouterStatusBadgeModel(opts: RouterStatusBadgeOptions): RouterStatusBadgeModel {
  const { active, status, isTesting = false, latencyMs = null, showLatency = false, label } = opts;
  if (isTesting) {
    return { kind: "testing", label: "Menguji REST...", ariaLabel: `${PREFIX}sedang menguji`, busy: true };
  }
  const resolved: ConnectionStatus = status ?? (active ? "connected" : "disconnected");
  switch (resolved) {
    case "connected": {
      const text = label ?? (showLatency && latencyMs ? `REST OK · ${latencyMs} ms` : "REST OK");
      return { kind: "connected", label: text, ariaLabel: `${PREFIX}${text}`, busy: false };
    }
    case "timeout":
      return { kind: "timeout", label: label ?? "Timeout", ariaLabel: `${PREFIX}Timeout`, busy: false };
    case "untested":
      return { kind: "untested", label: label ?? "Belum Diuji", ariaLabel: `${PREFIX}Belum Diuji`, busy: false };
    default:
      return { kind: "error", label: label ?? "Terputus", ariaLabel: `${PREFIX}Terputus`, busy: false };
  }
}
