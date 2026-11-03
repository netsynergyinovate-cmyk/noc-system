import net from "node:net";
import tls from "node:tls";

// Klien API biner RouterOS v7 (8728 plain / 8729 TLS) untuk jalur bootstrap.
// Hanya login v7 (=name=/=password=); login challenge pra-6.43 tidak didukung.

export type RouterOsApiErrorCode =
  | "TIMEOUT"
  | "CONNECTION_REFUSED"
  | "NETWORK_ERROR"
  | "AUTH_FAILED"
  | "TRAP"
  | "TLS_ERROR"
  | "PROTOCOL";

export class RouterOsApiError extends Error {
  constructor(
    public code: RouterOsApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RouterOsApiError";
  }
}

function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) return Buffer.from([(len >> 8) | 0x80, len & 0xff]);
  if (len < 0x200000) return Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
  if (len < 0x10000000) {
    return Buffer.from([(len >> 24) | 0xe0, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  }
  throw new RouterOsApiError("PROTOCOL", "Kata terlalu panjang.");
}

export function encodeSentence(words: string[]): Buffer {
  const parts: Buffer[] = [];
  for (const w of words) {
    if (w === "") throw new RouterOsApiError("PROTOCOL", "Kata kosong tidak valid (terminator kalimat).");
    const b = Buffer.from(w, "utf8");
    parts.push(encodeLength(b.length), b);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

export class SentenceParser {
  private buf: Buffer = Buffer.alloc(0);

  // Mengembalikan kalimat yang sudah lengkap; sisa parsial ditahan sampai chunk berikutnya.
  push(chunk: Buffer): string[][] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: string[][] = [];
    let pos = 0;
    let words: string[] = [];
    let sentenceStart = 0;
    for (;;) {
      if (pos >= this.buf.length) break;
      const b0 = this.buf[pos];
      let len: number;
      let hdr: number;
      if (b0 < 0x80) {
        len = b0;
        hdr = 1;
      } else if (b0 < 0xc0) {
        hdr = 2;
        if (pos + hdr > this.buf.length) break;
        len = ((b0 & 0x3f) << 8) | this.buf[pos + 1];
      } else if (b0 < 0xe0) {
        hdr = 3;
        if (pos + hdr > this.buf.length) break;
        len = ((b0 & 0x1f) << 16) | (this.buf[pos + 1] << 8) | this.buf[pos + 2];
      } else if (b0 < 0xf0) {
        hdr = 4;
        if (pos + hdr > this.buf.length) break;
        len = ((b0 & 0x0f) << 24) | (this.buf[pos + 1] << 16) | (this.buf[pos + 2] << 8) | this.buf[pos + 3];
      } else {
        throw new RouterOsApiError("PROTOCOL", "Panjang kata tidak didukung.");
      }
      if (len === 0 && hdr === 1) {
        out.push(words);
        words = [];
        pos += 1;
        sentenceStart = pos;
        continue;
      }
      if (pos + hdr + len > this.buf.length) break;
      words.push(this.buf.toString("utf8", pos + hdr, pos + hdr + len));
      pos += hdr + len;
    }
    // Buang kalimat selesai; kata dari kalimat belum lengkap diulang dari awal kalimat berikutnya.
    this.buf = this.buf.subarray(sentenceStart);
    return out;
  }
}

export class RouterOsApi {
  private parser = new SentenceParser();
  private queue: string[][] = [];
  private waiter: (() => void) | null = null;
  private failure: Error | null = null;
  private tag = 0;

  constructor(private socket: net.Socket) {
    socket.on("data", (chunk) => {
      try {
        this.queue.push(...this.parser.push(chunk));
      } catch (e) {
        this.failure = e as Error;
      }
      this.wake();
    });
    socket.on("error", (e) => {
      this.failure = mapSocketError(e);
      this.wake();
    });
    socket.on("close", () => {
      this.failure ??= new RouterOsApiError("NETWORK_ERROR", "Koneksi ditutup router.");
      this.wake();
    });
  }

  private wake() {
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }

  private async next(): Promise<string[]> {
    for (;;) {
      const s = this.queue.shift();
      if (s) return s;
      if (this.failure) throw this.failure;
      await new Promise<void>((r) => (this.waiter = r));
    }
  }

  // Satu perintah pada satu waktu; pemanggil menunggu (await) tiap run().
  async run(words: string[]): Promise<Array<Record<string, string>>> {
    const tag = String(++this.tag);
    this.socket.write(encodeSentence([...words, `.tag=${tag}`]));
    const rows: Array<Record<string, string>> = [];
    let trap: string | null = null;
    for (;;) {
      let s: string[];
      try {
        s = await this.next();
      } catch (e) {
        // Router menutup soket tepat setelah !trap: alasan penolakan ada di trap, bukan di penutupan.
        if (trap !== null) throw new RouterOsApiError("TRAP", trap);
        throw e;
      }
      const type = s[0];
      const attrs: Record<string, string> = {};
      for (const w of s.slice(1)) {
        const m = /^=([^=]*)=([\s\S]*)$/.exec(w);
        if (m) attrs[m[1]] = m[2];
      }
      if (type === "!re") rows.push(attrs);
      else if (type === "!trap") trap = attrs.message ?? "trap";
      else if (type === "!done") {
        if (trap !== null) throw new RouterOsApiError("TRAP", trap);
        return rows;
      } else if (type === "!fatal") throw new RouterOsApiError("PROTOCOL", s.slice(1).join(" ") || "fatal");
    }
  }
}

function mapSocketError(e: Error): RouterOsApiError {
  const code = (e as NodeJS.ErrnoException).code;
  if (code === "ECONNREFUSED") return new RouterOsApiError("CONNECTION_REFUSED", "Koneksi ditolak router.");
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") {
    return new RouterOsApiError("NETWORK_ERROR", "Router tidak terjangkau dari server.");
  }
  if (code === "ETIMEDOUT") return new RouterOsApiError("TIMEOUT", "Waktu koneksi habis.");
  if (/tls|ssl|certificate|handshake/i.test(`${code} ${e.message}`)) {
    return new RouterOsApiError("TLS_ERROR", e.message);
  }
  return new RouterOsApiError("NETWORK_ERROR", e.message);
}

export type RouterOsConn = {
  host: string;
  port?: number;
  tls?: boolean;
  username: string;
  password: string;
  timeoutMs?: number;
};

export async function withRouterOsApi<T>(opts: RouterOsConn, fn: (api: RouterOsApi) => Promise<T>): Promise<T> {
  const port = opts.port ?? (opts.tls ? 8729 : 8728);
  const timeoutMs = opts.timeoutMs ?? 8000;
  // rejectUnauthorized:false: sertifikat API biasanya self-signed; ini hanya jalur bootstrap ke IP yang
  // dimasukkan operator sendiri, dan kredensial admin tidak disimpan.
  const socket: net.Socket = opts.tls
    ? tls.connect({ host: opts.host, port, rejectUnauthorized: false })
    : net.connect({ host: opts.host, port });
  let timer: NodeJS.Timeout | undefined;
  try {
    const work = (async () => {
      const api = new RouterOsApi(socket);
      try {
        await api.run(["/login", `=name=${opts.username}`, `=password=${opts.password}`]);
      } catch (e) {
        if (e instanceof RouterOsApiError && e.code === "TRAP") throw new RouterOsApiError("AUTH_FAILED", e.message);
        throw e;
      }
      return fn(api);
    })();
    work.catch(() => undefined); // cegah unhandled rejection bila timeout menang
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RouterOsApiError("TIMEOUT", "Router tidak menjawab (timeout).")), timeoutMs);
    });
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    socket.destroy();
  }
}
