import { connect } from "node:net";

// Uji login ke CLI telnet OLT HSGQ (seri XE). Hanya login, lalu keluar: tidak ada
// perintah yang mengubah konfigurasi. Kata sandi tidak pernah masuk hasil.

export const HSGQ_TELNET_DRIVER = "hsgq-telnet";

export interface TelnetLoginResult {
  ok: boolean;
  code: "OK" | "TIMEOUT" | "CONNECTION_REFUSED" | "DNS_ERROR" | "AUTH_FAILED" | "NETWORK_ERROR" | "PROTOCOL_ERROR";
  message: string;
  latencyMs: number;
  // Baris pengenal perangkat dari banner (mis. "HSGQ-XE08ID EPON OLT Operating System").
  banner?: string;
}

const USER_RE = /(user ?name|login)\s*:\s*$/i;
const PASS_RE = /pass(word)?\s*:\s*$/i;
const PROMPT_RE = /(?:^|\n)[^\s<>#]+(?:\([a-z0-9-]+\))?[>#][ ]?\n?$/;

// Mengurai alamat "host" atau "host:port" (bawaan 23). Menolak skema dan karakter aneh.
export function parseTelnetHost(raw: string): { host: string; port: number } | null {
  const m = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(raw.trim());
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : 23;
  if (port < 1 || port > 65535) return null;
  return { host: m[1].toLowerCase(), port };
}

// Memisahkan teks dari perintah telnet (IAC) dan menjawab negosiasi dengan menolak semuanya.
export function stripTelnet(data: Buffer): { text: string; reply: Buffer } {
  const reply: number[] = [];
  let text = "";
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b !== 255) {
      text += String.fromCharCode(b);
      continue;
    }
    const cmd = data[i + 1];
    if (cmd >= 251 && cmd <= 254 && i + 2 < data.length) {
      reply.push(255, cmd === 253 || cmd === 254 ? 252 : 254, data[i + 2]);
      i += 2;
    } else if (cmd === 250) {
      while (i + 1 < data.length && !(data[i] === 255 && data[i + 1] === 240)) i++;
      i++;
    } else {
      i++;
    }
  }
  const clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
  return { text: clean, reply: Buffer.from(reply) };
}

export function testHsgqTelnetLogin(opts: {
  host: string;
  username: string;
  password: string;
  timeoutMs?: number;
}): Promise<TelnetLoginResult> {
  const target = parseTelnetHost(opts.host);
  const started = Date.now();
  const fail = (code: TelnetLoginResult["code"], message: string): TelnetLoginResult => ({
    ok: false,
    code,
    message,
    latencyMs: Date.now() - started,
  });
  if (!target) {
    return Promise.resolve(fail("PROTOCOL_ERROR", "Alamat OLT tidak valid: tulis alamat IP atau alamat:port tanpa skema."));
  }
  const timeoutMs = opts.timeoutMs ?? 10_000;

  return new Promise((resolve) => {
    const sock = connect({ host: target.host, port: target.port });
    let buf = "";
    let stage: "user" | "pass" | "prompt" = "user";
    let banner = "";
    let done = false;
    const finish = (r: TelnetLoginResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        if (r.ok) sock.write("exit\r\n");
      } catch {
        /* sudah tertutup */
      }
      setTimeout(() => sock.destroy(), 150);
      resolve(r);
    };
    const timer = setTimeout(() => {
      finish(
        fail(
          "TIMEOUT",
          stage === "user"
            ? `OLT ${target.host}:${target.port} tidak menampilkan prompt login (timeout). Pastikan ini port telnet OLT.`
            : "OLT tidak menjawab setelah login dikirim (timeout).",
        ),
      );
    }, timeoutMs);

    sock.on("data", (d: Buffer) => {
      const { text, reply } = stripTelnet(d);
      if (reply.length) sock.write(reply);
      buf += text;
      if (stage === "user" && USER_RE.test(buf)) {
        banner = (/^\s*(.*?\bOperating System)\s*$/im.exec(buf)?.[1] ?? "").trim();
        buf = "";
        stage = "pass";
        sock.write(`${opts.username}\r\n`);
      } else if (stage === "pass" && PASS_RE.test(buf)) {
        buf = "";
        stage = "prompt";
        sock.write(`${opts.password}\r\n`);
      } else if (stage === "prompt") {
        // Gagal bila prompt login muncul lagi; berhasil bila prompt CLI muncul.
        // Banner sesudah login memuat kata "fail" (tabel login gagal), jadi tidak dipakai.
        if (USER_RE.test(buf) && !PROMPT_RE.test(buf)) {
          finish(fail("AUTH_FAILED", "OLT menolak login: periksa username dan kata sandi."));
        } else if (PROMPT_RE.test(buf)) {
          finish({
            ok: true,
            code: "OK",
            message: `Login ke OLT berhasil${banner ? ` (${banner})` : ""}.`,
            latencyMs: Date.now() - started,
            ...(banner ? { banner } : {}),
          });
        }
      }
    });
    sock.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ECONNREFUSED") {
        finish(fail("CONNECTION_REFUSED", `Koneksi ditolak oleh ${target.host}:${target.port}. Pastikan port telnet OLT benar dan terbuka.`));
      } else if (e.code === "ENOTFOUND" || e.code === "EAI_AGAIN") {
        finish(fail("DNS_ERROR", "Host tidak ditemukan. Pastikan alamat OLT benar."));
      } else if (e.code === "ETIMEDOUT" || e.code === "EHOSTUNREACH" || e.code === "ENETUNREACH") {
        finish(fail("TIMEOUT", `OLT ${target.host}:${target.port} tidak dapat dijangkau.`));
      } else {
        finish(fail("NETWORK_ERROR", `Gagal menghubungi OLT: ${e.code ?? e.message}`));
      }
    });
    sock.on("close", () => {
      if (!done) finish(fail("NETWORK_ERROR", "OLT menutup koneksi sebelum login selesai."));
    });
  });
}
