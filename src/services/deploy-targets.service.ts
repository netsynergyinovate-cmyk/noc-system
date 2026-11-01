import net from "net";
import { db } from "@/db";
import {
  deployTargets,
  type DeployTarget,
  type DeployMode,
  type DeviceAccessLevel,
} from "@/db/schema/deploy-targets";
import { eq } from "drizzle-orm";

export interface SaveTargetInput {
  nama?: string;
  host: string;
  port?: number;
  sshUser: string;
  mode?: DeployMode;
  tailscaleHost?: string | null;
  connectionReason?: string | null;
  deviceAccessLevel?: DeviceAccessLevel;
}

export interface NetworkDetectionResult {
  lanReachable: boolean;
  tailscaleReachable: boolean;
  resolvedMode: DeployMode;
  resolvedHost: string;
  reason: string;
  isManualOverride: boolean;
}

/**
 * Uji keterjangkauan port TCP sederhana tanpa overhead dependensi eksternal.
 */
export async function probeTcpPort(
  host: string,
  port: number,
  timeoutMs = 2500,
): Promise<boolean> {
  if (!host || !port) return false;
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const socket = new net.Socket();
  let settled = false;

  const cleanup = (ok: boolean) => {
    if (!settled) {
      settled = true;
      socket.destroy();
      resolve(ok);
    }
  };

  socket.setTimeout(timeoutMs);
  socket.once("connect", () => cleanup(true));
  socket.once("timeout", () => cleanup(false));
  socket.once("error", () => cleanup(false));

  try {
    socket.connect(port, host);
  } catch {
    cleanup(false);
  }

  return promise;
}
/**
 * Deteksi jalur koneksi otomatis (LAN vs Tailscale vs Tunnel) sesuai PRD.
 * Aturan:
 * 1. Bila di jaringan yang sama (LAN reachable) -> gunakan LAN, Tailscale tidak diaktifkan.
 * 2. Bila di luar jaringan lokal (LAN unreachable) & Tailscale reachable -> gunakan Tailscale.
 * 3. Bila operator memaksa Tailscale saat LAN reachable -> tandai sebagai Paksaan Manual.
 */
export async function detectConnectionPath(
  target: Pick<DeployTarget, "host" | "port" | "mode" | "tailscaleHost">,
  probeFn: (host: string, port: number) => Promise<boolean> = probeTcpPort,
): Promise<NetworkDetectionResult> {
  const lanReachable = await probeFn(target.host, target.port);
  let tailscaleReachable = false;

  if (target.tailscaleHost) {
    tailscaleReachable = await probeFn(target.tailscaleHost, target.port);
  }

  // Jika mode Tunnel kustom
  if (target.mode === "tunnel") {
    return {
      lanReachable,
      tailscaleReachable,
      resolvedMode: "tunnel",
      resolvedHost: target.host,
      reason: "Tunnel / Port Kustom — koneksi melalui jalur tunnel khusus.",
      isManualOverride: false,
    };
  }

  // Jika operator memaksa Tailscale padahal LAN terjangkau
  if (target.mode === "tailscale" && lanReachable) {
    return {
      lanReachable,
      tailscaleReachable,
      resolvedMode: "tailscale",
      resolvedHost: target.tailscaleHost || target.host,
      reason: "Tailscale (Paksaan Manual) — server terjangkau di jaringan lokal, tetapi Tailscale dipaksa aktif oleh operator.",
      isManualOverride: true,
    };
  }

  // Aturan standar: Prioritaskan LAN jika terjangkau
  if (lanReachable) {
    return {
      lanReachable,
      tailscaleReachable,
      resolvedMode: "lan",
      resolvedHost: target.host,
      reason: "LAN — server terjangkau langsung di jaringan lokal (Tailscale tidak diaktifkan).",
      isManualOverride: false,
    };
  }

  // Di luar LAN: gunakan Tailscale jika tersedia
  if (target.tailscaleHost && tailscaleReachable) {
    return {
      lanReachable,
      tailscaleReachable,
      resolvedMode: "tailscale",
      resolvedHost: target.tailscaleHost,
      reason: "Tailscale — di luar jaringan lokal, terhubung aman via tailnet.",
      isManualOverride: false,
    };
  }

  // Tidak ada jalur yang merespons
  return {
    lanReachable,
    tailscaleReachable,
    resolvedMode: target.mode,
    resolvedHost: target.mode === "tailscale" && target.tailscaleHost ? target.tailscaleHost : target.host,
    reason: target.tailscaleHost
      ? "Tidak terjangkau — host LAN maupun Tailscale tidak merespons pada port SSH."
      : "Tidak terjangkau — host LAN tidak merespons pada port SSH.",
    isManualOverride: false,
  };
}

/**
 * Mengambil konfigurasi target server deploy yang tersimpan.
 */
export async function getDeployTarget(): Promise<DeployTarget | null> {
  const rows = await db.select().from(deployTargets).limit(1);
  return rows[0] || null;
}

/**
 * Menyimpan atau memperbarui konfigurasi target server deploy (tunggal).
 */
export async function saveDeployTarget(input: SaveTargetInput): Promise<DeployTarget> {
  const existing = await getDeployTarget();

  if (existing) {
    const [updated] = await db
      .update(deployTargets)
      .set({
        nama: input.nama?.trim() || existing.nama,
        host: input.host.trim(),
        port: input.port ?? existing.port,
        sshUser: input.sshUser.trim(),
        mode: input.mode ?? existing.mode,
        tailscaleHost: input.tailscaleHost !== undefined ? input.tailscaleHost?.trim() || null : existing.tailscaleHost,
        connectionReason: input.connectionReason !== undefined ? input.connectionReason : existing.connectionReason,
        deviceAccessLevel: input.deviceAccessLevel ?? existing.deviceAccessLevel,
        updatedAt: new Date(),
      })
      .where(eq(deployTargets.id, existing.id))
      .returning();
    return updated;
  }

  const [inserted] = await db
    .insert(deployTargets)
    .values({
      nama: input.nama?.trim() || "SERVER NATIVE",
      host: input.host.trim(),
      port: input.port ?? 22,
      sshUser: input.sshUser.trim(),
      mode: input.mode ?? "lan",
      tailscaleHost: input.tailscaleHost?.trim() || null,
      connectionReason: input.connectionReason || null,
      deviceAccessLevel: input.deviceAccessLevel ?? "simulator",
    })
    .returning();

  return inserted;
}

/**
 * Memperbarui tingkat akses perangkat untuk mode pengembangan berdampingan.
 */
export async function updateDeviceAccessLevel(
  targetId: string,
  level: DeviceAccessLevel,
): Promise<DeployTarget | null> {
  const [updated] = await db
    .update(deployTargets)
    .set({
      deviceAccessLevel: level,
      updatedAt: new Date(),
    })
    .where(eq(deployTargets.id, targetId))
    .returning();
  return updated || null;
}
