import net from "node:net";

// Alamat sumber yang dipakai SERVER ini untuk menyambung ke host:port (socket.localAddress).
// Dipakai uji koneksi router: router harus mengizinkan alamat ini di /ip service ... address=.
// Catatan: bila ada NAT di jalur, router melihat alamat lain; fungsi ini hanya melaporkan sisi server.
// Hanya dipanggil untuk target yang sama dengan yang baru saja diuji (sudah lolos sanitasi host).
export function outboundSourceIp(host: string, port: number, timeoutMs = 2000): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const socket = net.connect({ host, port });
  const done = (value: string | null) => {
    socket.destroy();
    resolve(value);
  };
  socket.setTimeout(timeoutMs, () => done(null));
  socket.once("connect", () => done(socket.localAddress ?? null));
  socket.once("error", () => done(null));
  return promise;
}
