import net from "node:net";

export interface TcpPingResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Menguji keterjangkauan port TCP dan mengukur latensi roundtrip jaringan.
 * Tanpa login kredensial (aman dari risiko lockout / bad password limit).
 */
export function pingTcp(host: string, port: number, timeoutMs = 4000): Promise<TcpPingResult> {
  const { promise, resolve } = Promise.withResolvers<TcpPingResult>();
  const start = performance.now();
  const socket = new net.Socket();
  let settled = false;

  const finish = (ok: boolean, error?: string) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    const latencyMs = Math.round(performance.now() - start);
    resolve({ ok, latencyMs, error });
  };

  socket.setTimeout(timeoutMs);
  socket.once("connect", () => finish(true));
  socket.once("timeout", () => finish(false, "Timeout (tidak ada balasan dalam batas waktu)"));
  socket.once("error", (err) => finish(false, err.message));
  socket.connect(port, host);

  return promise;
}
