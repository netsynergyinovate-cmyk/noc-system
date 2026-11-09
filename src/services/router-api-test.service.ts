import "server-only";

import { issueRealtimeTicket } from "@/lib/realtime-ticket";

// Uji pre-flight untuk protokol API biner RouterOS (8728/8729). PRD FR-02:
// tes koneksi fisik dijalankan oleh backend Go, bukan oleh proses Next.js.
// Backend memakai satu soket TCP, membatasi total waktu 5 detik, dan
// mengembalikan rincian error (AUTH_FAILED, CONNECTION_TIMEOUT, ...).

export interface ApiResource {
  version: string;
  cpuLoad: number;
  uptime: string;
  boardName: string;
  freeMemory: number;
  totalMemory: number;
  architecture: string;
}

export interface GroupCheck {
  group: string;
  policy: string;
  missing: string[];
  fix: string | null;
}

export interface ApiProbeResult {
  ok: boolean;
  code: string;
  message: string;
  latencyMs: number;
  port: number;
  tls: boolean;
  endpointTested: string;
  resource?: ApiResource;
  groupCheck?: GroupCheck | null;
  /** Alamat publik backend yang dilihat router (dihitung backend Go). */
  sourceIp?: string;
  /** Alamat LAN backend; dipakai bila router melihat alamat lokal. */
  localSourceIp?: string;
}

export const API_PREFLIGHT_TIMEOUT_MS = 5000;

export interface ApiProbeInput {
  host: string;
  port?: number;
  protocol?: "rest" | "api";
  useSsl?: boolean;
  username: string;
  password: string;
  timeoutMs?: number;
}

type BackendPreflight = {
  ok: boolean;
  code: string;
  message: string;
  latencyMs: number;
  port: number;
  tls: boolean;
  endpointTested: string;
  version?: string;
  cpuLoad?: number;
  uptime?: string;
  boardName?: string;
  freeMemory?: number;
  totalMemory?: number;
  groupCheck?: GroupCheck | null;
  sourceIp?: string;
  localSourceIp?: string;
};

function backendBase(): string | null {
  // Sama dengan env.BACKEND_INTERNAL_URL: BACKEND_INTERNAL_URL -> BACKEND_URL
  // -> bawaan lokal. Tanpa bawaan ini, uji router di host (bukan Docker)
  // selalu gagal "Backend Go belum dikonfigurasi".
  return (
    process.env.BACKEND_INTERNAL_URL ??
    process.env.BACKEND_URL ??
    "http://localhost:8080"
  );
}

function failure(
  message: string,
  port?: number,
  tls?: boolean,
  code = "CONNECTION_FAILED",
): ApiProbeResult {
  return {
    ok: false,
    code,
    message,
    latencyMs: 0,
    port: port ?? 8728,
    tls: tls ?? false,
    endpointTested: "API",
    groupCheck: null,
  };
}

export async function probeRouterApi(
  input: ApiProbeInput,
): Promise<ApiProbeResult> {
  // Port API biner bukan layanan REST: tolak segera dengan pesan yang jelas,
  // bukan menunggu timeout 5 detik.
  if (
    (input.protocol ?? "api") === "rest" &&
    (input.port === 8728 || input.port === 8729)
  ) {
    return failure(
      `Port ${input.port} adalah API biner, bukan REST. Aktifkan layanan www (80) atau www-ssl (443), atau pilih protokol Binary API.`,
      input.port,
      input.useSsl,
      "WRONG_PORT",
    );
  }
  const base = backendBase();
  const secret = process.env.REALTIME_TOKEN_SECRET;
  if (!base || !secret) {
    return failure(
      "Backend Go belum dikonfigurasi (BACKEND_INTERNAL_URL dan REALTIME_TOKEN_SECRET). Uji router wajib lewat backend Go.",
      input.port,
      input.useSsl,
    );
  }
  const { token } = issueRealtimeTicket({
    userId: "noc-server",
    secret,
    perms: ["router:manage"],
  });
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? API_PREFLIGHT_TIMEOUT_MS + 2000,
  );
  try {
    const res = await fetch(new URL("/api/v1/routers/preflight", base), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        host: input.host,
        port: input.port ?? 0,
        protocol: input.protocol ?? "api",
        useSsl: input.useSsl ?? false,
        username: input.username,
        password: input.password,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as {
        message?: string;
        error?: string;
        code?: string;
      } | null;
      return failure(
        json?.message ??
          json?.error ??
          `Backend Go menjawab HTTP ${res.status} untuk uji router.`,
        input.port,
        input.useSsl,
        json?.code ??
          (res.status === 408 || res.status === 504
            ? "TIMEOUT"
            : "CONNECTION_FAILED"),
      );
    }
    const json = (await res.json()) as { data?: BackendPreflight };
    const d = json.data;
    if (!d)
      return failure(
        "Backend Go tidak mengembalikan hasil uji router.",
        input.port,
        input.useSsl,
      );
    return {
      ok: d.ok,
      code: d.code,
      message: d.message,
      latencyMs: d.latencyMs,
      port: d.port,
      tls: d.tls,
      endpointTested: d.endpointTested,
      groupCheck: d.groupCheck ?? null,
      sourceIp: d.sourceIp,
      localSourceIp: d.localSourceIp,
      resource: d.ok
        ? {
            version: d.version ?? "",
            cpuLoad: d.cpuLoad ?? 0,
            uptime: d.uptime ?? "",
            boardName: d.boardName ?? "",
            freeMemory: d.freeMemory ?? 0,
            totalMemory: d.totalMemory ?? 0,
            architecture: "",
          }
        : undefined,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return failure(
      aborted
        ? "Backend Go tidak menjawab dalam batas waktu uji router (5 detik)."
        : `Gagal menghubungi backend Go: ${err instanceof Error ? err.message : String(err)}`,
      input.port,
      input.useSsl,
    );
  } finally {
    clearTimeout(timer);
  }
}
