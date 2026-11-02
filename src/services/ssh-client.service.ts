import crypto from "crypto";
import { Client, type ConnectConfig } from "ssh2";
import type { DeployTarget } from "@/db/schema/deploy-targets";
import type { DecryptedSshCredential } from "./ssh-credentials.service";

export type SshFailureCategory =
  | "HOST_UNREACHABLE"
  | "AUTH_FAILED"
  | "TAILSCALE_INACTIVE"
  | "HOST_KEY_CHANGED"
  | "UNKNOWN";

export interface SshTestResult {
  success: boolean;
  category?: SshFailureCategory;
  message: string;
  details?: string;
  serverBanner?: string;
  latencyMs?: number;
  serverHostKeyFingerprint?: string;
}

export interface SshExecutionResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Menganalisis error koneksi SSH untuk membedakan kategori kegagalan sesuai PRD:
 * 1. Host key berubah (kemungkinan spoofing / MITM / re-install)
 * 2. Autentikasi ditolak (kunci / passphrase salah)
 * 3. Tailscale tidak aktif (khusus jalur Tailscale)
 * 4. Host tidak terjangkau (LAN / jaringan mati)
 */
export function classifySshError(
  err: Error & { level?: string; code?: string },
  host: string,
  mode: string,
): { category: SshFailureCategory; message: string } {
  const msg = err.message || "";
  const code = err.code || "";
  const isTailscaleHost =
    mode === "tailscale" ||
    host.startsWith("100.") ||
    host.includes(".ts.net") ||
    host.includes("tailscale");

  // 1. Host key berubah (verifikasi gagal)
  if (
    err.level === "client-hostkey" ||
    msg.toLowerCase().includes("hostkey") ||
    msg.toLowerCase().includes("host key")
  ) {
    return {
      category: "HOST_KEY_CHANGED",
      message:
        "Host key SERVER NATIVE berubah dari yang tercatat sebelumnya. Kemungkinan adanya serangan spoofing/MITM atau server telah diinstal ulang.",
    };
  }

  // 2. Autentikasi ditolak
  if (
    err.level === "client-authentication" ||
    msg.includes("authentication methods failed") ||
    msg.includes("Encrypted private key") ||
    msg.includes("Bad passphrase") ||
    msg.includes("Permission denied")
  ) {
    return {
      category: "AUTH_FAILED",
      message:
        "Kunci SSH atau passphrase ditolak oleh SERVER NATIVE. Periksa user SSH dan pastikan public key sudah ada di ~/.ssh/authorized_keys server.",
    };
  }

  // 3. Tailscale tidak aktif
  if (
    isTailscaleHost &&
    (code === "ETIMEDOUT" ||
      code === "EHOSTUNREACH" ||
      code === "ENETUNREACH" ||
      code === "ENOTFOUND" ||
      code === "ECONNREFUSED" ||
      msg.includes("timed out") ||
      msg.includes("getaddrinfo"))
  ) {
    return {
      category: "TAILSCALE_INACTIVE",
      message:
        "Tailscale tidak aktif atau tidak terhubung. Antarmuka Tailscale lokal belum menyala, MagicDNS tidak merespons, atau SERVER NATIVE offline dari tailnet.",
    };
  }

  // 4. Host tidak terjangkau (Jaringan / LAN)
  if (
    code === "ETIMEDOUT" ||
    code === "ECONNREFUSED" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "ENOTFOUND" ||
    msg.includes("timed out") ||
    msg.includes("Connection refused")
  ) {
    return {
      category: "HOST_UNREACHABLE",
      message: `Host ${host} tidak terjangkau. Periksa kabel LAN, subnet, firewall, atau apakah server tujuan dalam keadaan menyala.`,
    };
  }

  return {
    category: "UNKNOWN",
    message: `Koneksi SSH gagal: ${msg || "Galat tak dikenal."}`,
  };
}

/**
 * Uji koneksi SSH ke SERVER NATIVE dan catat host key server (Trust-On-First-Use).
 */
export async function testSshConnection(
  target: Pick<DeployTarget, "host" | "port" | "sshUser" | "mode"> & { hostKeyFingerprint?: string | null },
  credential: Pick<DecryptedSshCredential, "privateKey" | "passphrase" | "password">,
  effectiveHost?: string,
  timeoutMs = 7000,
): Promise<SshTestResult> {
  const host = effectiveHost || target.host;
  const startTime = Date.now();
  const { promise, resolve } = Promise.withResolvers<SshTestResult>();
  let seenHostKey: string | undefined;

  const conn = new Client();
  let settled = false;

  const finalize = (res: SshTestResult) => {
    if (!settled) {
      settled = true;
      try {
        conn.end();
      } catch {
        // Abaikan
      }
      resolve(res);
    }
  };

  const timer = setTimeout(() => {
    const isTailscale = target.mode === "tailscale" || host.startsWith("100.");
    finalize({
      success: false,
      category: isTailscale ? "TAILSCALE_INACTIVE" : "HOST_UNREACHABLE",
      message: isTailscale
        ? "Waktu koneksi SSH ke Tailscale habis (timeout 7s). Tailscale mungkin tidak aktif."
        : `Waktu koneksi SSH ke ${host}:${target.port} habis (timeout 7s). Host tidak merespons.`,
      latencyMs: Date.now() - startTime,
    });
  }, timeoutMs);

  conn.on("ready", () => {
    clearTimeout(timer);
    finalize({
      success: true,
      message: `Koneksi SSH berhasil ke ${target.sshUser}@${host}:${target.port}.`,
      latencyMs: Date.now() - startTime,
      serverHostKeyFingerprint: seenHostKey,
    });
  });

  conn.on("error", (err: Error & { level?: string; code?: string }) => {
    clearTimeout(timer);
    const classification = classifySshError(err, host, target.mode);
    finalize({
      success: false,
      category: classification.category,
      message: classification.message,
      details: err.message,
      latencyMs: Date.now() - startTime,
    });
  });
  if (credential.password) {
    conn.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => credential.password || ""));
    });
  }

  const connectConfig: ConnectConfig = {
    host,
    port: target.port,
    username: target.sshUser,
    privateKey: credential.privateKey,
    passphrase: credential.passphrase,
    password: credential.password,
    tryKeyboard: Boolean(credential.password),
    readyTimeout: timeoutMs,
    hostVerifier: (key: Buffer) => {
      const hash = crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
      seenHostKey = `SHA256:${hash}`;
      // Jika host key sudah pernah disimpan, lakukan verifikasi ketat (anti-MITM)
      if (target.hostKeyFingerprint && seenHostKey !== target.hostKeyFingerprint) {
        return false;
      }
      return true;
    },
  };

  try {
    conn.connect(connectConfig);
  } catch (err: unknown) {
    clearTimeout(timer);
    const e = err instanceof Error ? err : new Error(String(err));
    const classification = classifySshError(e, host, target.mode);
    finalize({
      success: false,
      category: classification.category,
      message: classification.message,
      details: e.message,
      latencyMs: Date.now() - startTime,
    });
  }

  return promise;
}

/**
 * Menjalankan satu perintah SSH di SERVER NATIVE dan mengembalikan stdout/stderr.
 */
export async function executeSshCommand(
  target: Pick<DeployTarget, "host" | "port" | "sshUser"> & { hostKeyFingerprint?: string | null },
  credential: Pick<DecryptedSshCredential, "privateKey" | "passphrase" | "password">,
  command: string,
  effectiveHost?: string,
  timeoutMs = 60000,
  onOutput?: (chunk: string) => void,
): Promise<SshExecutionResult> {
  const host = effectiveHost || target.host;
  const { promise, resolve, reject } = Promise.withResolvers<SshExecutionResult>();

  const conn = new Client();
  let stdout = "";
  let stderr = "";
  let settled = false;

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      try {
        conn.end();
      } catch {
        // ignore
      }
      reject(new Error(`Perintah SSH melampaui batas waktu (${timeoutMs / 1000} detik): ${command}`));
    }
  }, timeoutMs);

  conn.on("ready", () => {
    conn.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        conn.end();
        return reject(err);
      }

      stream.on("close", (code: number) => {
        clearTimeout(timer);
        conn.end();
        if (!settled) {
          settled = true;
          resolve({
            code: code ?? 0,
            stdout,
            stderr,
          });
        }
      });

      stream.on("data", (data: Buffer) => {
        const str = data.toString();
        stdout += str;
        onOutput?.(str);
      });

      stream.stderr.on("data", (data: Buffer) => {
        const str = data.toString();
        stderr += str;
        onOutput?.(str);
      });
    });
  });

  conn.on("error", (err) => {
    clearTimeout(timer);
    if (!settled) {
      settled = true;
      reject(err);
    }
  });
  if (credential.password) {
    conn.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => credential.password || ""));
    });
  }

  conn.connect({
    host,
    port: target.port,
    username: target.sshUser,
    privateKey: credential.privateKey,
    passphrase: credential.passphrase,
    password: credential.password,
    tryKeyboard: Boolean(credential.password),
    readyTimeout: 10000,
    hostVerifier: (key: Buffer) => {
      if (target.hostKeyFingerprint) {
        const hash = crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
        return `SHA256:${hash}` === target.hostKeyFingerprint;
      }
      return true;
    },
  });
  return promise;
}

/**
 * Menjalankan perintah SSH dengan mengalirkan data melalui stdin stream.
 */
export async function executeSshScript(
  target: Pick<DeployTarget, "host" | "port" | "sshUser"> & { hostKeyFingerprint?: string | null },
  credential: Pick<DecryptedSshCredential, "privateKey" | "passphrase" | "password">,
  command: string,
  stdinContent: string,
  effectiveHost?: string,
  timeoutMs = 60000,
  onOutput?: (chunk: string) => void,
): Promise<SshExecutionResult> {
  const host = effectiveHost || target.host;
  const { promise, resolve, reject } = Promise.withResolvers<SshExecutionResult>();

  const conn = new Client();
  let stdout = "";
  let stderr = "";
  let settled = false;

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      try {
        conn.end();
      } catch {
        // ignore
      }
      reject(new Error(`Skrip SSH melampaui batas waktu (${timeoutMs / 1000} detik)`));
    }
  }, timeoutMs);

  conn.on("ready", () => {
    conn.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        conn.end();
        return reject(err);
      }

      stream.on("close", (code: number) => {
        clearTimeout(timer);
        conn.end();
        if (!settled) {
          settled = true;
          resolve({
            code: code ?? 0,
            stdout,
            stderr,
          });
        }
      });

      stream.on("data", (data: Buffer) => {
        const str = data.toString();
        stdout += str;
        onOutput?.(str);
      });

      stream.stderr.on("data", (data: Buffer) => {
        const str = data.toString();
        stderr += str;
        onOutput?.(str);
      });

      stream.end(stdinContent);
    });
  });

  conn.on("error", (err) => {
    clearTimeout(timer);
    if (!settled) {
      settled = true;
      reject(err);
    }
  });
  if (credential.password) {
    conn.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => credential.password || ""));
    });
  }

  conn.connect({
    host,
    port: target.port,
    username: target.sshUser,
    privateKey: credential.privateKey,
    passphrase: credential.passphrase,
    password: credential.password,
    tryKeyboard: Boolean(credential.password),
    readyTimeout: 10000,
    hostVerifier: (key: Buffer) => {
      if (target.hostKeyFingerprint) {
        const hash = crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
        return `SHA256:${hash}` === target.hostKeyFingerprint;
      }
      return true;
    },
  });

  return promise;
}
