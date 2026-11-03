"use client";

import { useState } from "react";

// Panduan langkah demi langkah menambah router MikroTik. Dipakai di halaman Tambah Router.
// Semua perintah RouterOS di sini adalah perintah baca/aktifkan layanan yang umum; nilai
// dalam <...> harus diganti. Alamat IP pada contoh (mis. 192.168.88.1) HANYA contoh: alamat
// router Anda berbeda. Penyebab di tabel sama dengan pesan hasil "Uji Koneksi".

// navigator.clipboard hanya ada di konteks aman (HTTPS atau localhost). Aplikasi ini sering dibuka lewat
// http://<IP-LAN>:3000, jadi di sana harus memakai execCommand sebagai cadangan.
async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // jatuh ke cadangan di bawah
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

function Cmd({ children }: { children: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <div className="mt-1 flex items-start gap-2 rounded bg-background px-2 py-1.5 font-mono text-xs">
      <pre className="min-w-0 flex-1 select-all whitespace-pre-wrap break-all">{children}</pre>
      <button
        type="button"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => {
          void copyText(children).then((ok) => {
            setState(ok ? "ok" : "fail");
            setTimeout(() => setState("idle"), 2000);
          });
        }}
      >
        {state === "ok" ? "Tersalin" : state === "fail" ? "Gagal: blok lalu Ctrl+C" : "Salin"}
      </button>
    </div>
  );
}

const PROBLEMS: Array<[string, string]> = [
  ["Router menutup koneksi", "IP server NOC belum ada di kolom ADDRESS layanan www. Ulangi langkah 4 (tambahkan, jangan mengganti)."],
  ["Koneksi ditolak", "Layanan www mati atau port-nya salah (mis. kolom Port kosong = 80, padahal router memakai 8081). Ulangi langkah 3, lalu isi Port REST yang benar."],
  ["Timeout / Router tidak terjangkau", "Tidak ada rute ke alamat itu, alamatnya salah, atau firewall router (chain input) menjatuhkan paket. Periksa langkah 2 (alamat); dari server coba `ping <alamat-router>` dan `/ip firewall filter print where chain=input` di router."],
  ["Login ditolak (401)", "Username atau kata sandi salah, atau grup akun belum punya izin `api` dan `rest-api`. Lihat langkah 5."],
  ["Endpoint tidak ditemukan (404)", "RouterOS di bawah v7.1, atau port yang diisi bukan layanan www/www-ssl."],
  ["Sertifikat HTTPS tidak dipercaya", "www-ssl memakai sertifikat self-signed. Pasang sertifikat valid, atau pakai www (HTTP) lewat jaringan privat."],
  ["Port 8728 / 8729 / 8291 / 2024", "Itu API biner dan Winbox, bukan REST. Pakai port layanan www atau www-ssl dari langkah 3."],
];

type Candidate = { address: string; via: string[]; rest: Array<{ port: number; status: number | "reset" }> };

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: json?.error?.message ?? `Gagal (HTTP ${res.status}).` };
    return { ok: true, data: json?.data as T };
  } catch {
    return { ok: false, error: "Server aplikasi tidak menjawab. Coba lagi." };
  }
}

// Mencari kandidat alamat router dari server NOC: gateway server, tetangga bermerek MikroTik, dan satu rentang
// jaringan privat yang disebut operator (mis. 10.20.30.0/24).
function RouterFinder({ onUse }: { onUse?: (address: string, port?: number) => void }) {
  const [cidr, setCidr] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ candidates: Candidate[]; scanned: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const find = async () => {
    setBusy(true);
    setError(null);
    const r = await postJson<{ candidates: Candidate[]; scanned: number }>("/api/routers/discover", { cidr: cidr.trim() || undefined });
    setBusy(false);
    if (r.ok && r.data) setResult(r.data);
    else setError(r.error ?? "Gagal mencari.");
  };
  return (
    <div className="mt-3 rounded border bg-background p-3">
      <p className="font-medium">Cari alamat router otomatis dari server NOC</p>
      <p className="mt-1 text-muted-foreground">
        Server memeriksa gateway-nya dan perangkat bermerek MikroTik di jaringannya. Jika router Anda ada di jaringan lain,
        isi rentang jaringannya (alamat privat, maksimal /24, mis. <code>192.168.88.0/24</code>; lihat kolom NETWORK pada{" "}
        <code>/ip address print</code>).
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={cidr}
          onChange={(e) => setCidr(e.target.value)}
          placeholder="Rentang jaringan (opsional), mis. 192.168.88.0/24"
          className="min-w-64 flex-1 rounded border bg-background px-2 py-1 text-xs"
        />
        <button type="button" onClick={find} disabled={busy} className="rounded border px-3 py-1 text-xs hover:bg-muted">
          {busy ? "Mencari..." : "Cari router"}
        </button>
      </div>
      {error && <p className="mt-2 text-destructive">{error}</p>}
      {result && (
        <div className="mt-2 space-y-1">
          {result.candidates.length === 0 ? (
            <p className="text-muted-foreground">
              Tidak ada kandidat. Isi rentang jaringan router, atau pakai alamat dari Winbox/SSH (cara di atas).
            </p>
          ) : (
            result.candidates.map((c) => (
              <div key={c.address} className="flex flex-wrap items-center gap-2 text-xs">
                <code className="font-mono">{c.address}</code>
                <span className="text-muted-foreground">({c.via.join(", ")})</span>
                {c.rest.some((p) => p.status !== "reset") ? (
                  <span className="text-success">
                    REST hidup di port {c.rest.filter((p) => p.status !== "reset").map((p) => p.port).join(", ")}
                  </span>
                ) : c.rest.length > 0 ? (
                  <span className="text-warning">
                    port {c.rest.map((p) => p.port).join(", ")} tersambung lalu diputus: kemungkinan router, tetapi IP server
                    belum diizinkan di /ip service (langkah 4)
                  </span>
                ) : (
                  <span className="text-muted-foreground">REST tidak terdeteksi di port 80/8081/8080</span>
                )}
                {onUse && (
                  <button
                    type="button"
                    className="rounded border px-2 py-0.5 hover:bg-muted"
                    onClick={() => onUse(c.address, c.rest.find((p) => p.status !== "reset")?.port ?? c.rest[0]?.port)}
                  >
                    Pakai
                  </button>
                )}
              </div>
            ))
          )}
          {result.scanned > 0 && <p className="text-muted-foreground">{result.scanned} alamat dipindai.</p>}
        </div>
      )}
    </div>
  );
}

// Alamat sumber server NOC ke host yang sedang diisi di form: persis yang harus diizinkan di /ip service.
function ServerIpHelper({ host, port }: { host?: string; port?: string }) {
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ host: string; sourceIp: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trimmed = (host ?? "").trim();
  const lookup = async () => {
    setBusy(true);
    setError(null);
    const p = Number(port);
    const r = await postJson<{ host: string; sourceIp: string | null }>("/api/routers/source-ip", {
      host: trimmed,
      port: Number.isInteger(p) && p > 0 ? p : undefined,
    });
    setBusy(false);
    if (r.ok && r.data) setInfo(r.data);
    else setError(r.error ?? "Gagal mengambil alamat.");
  };
  return (
    <div className="mt-2 rounded border bg-background p-3">
      <button
        type="button"
        onClick={lookup}
        disabled={busy || trimmed === ""}
        className="rounded border px-3 py-1 text-xs hover:bg-muted disabled:opacity-50"
      >
        {busy ? "Memeriksa..." : "Ambil IP server NOC untuk host di form"}
      </button>
      {trimmed === "" && <span className="ml-2 text-xs text-muted-foreground">Isi kolom Host di bawah dulu.</span>}
      {error && <p className="mt-2 text-destructive">{error}</p>}
      {info && info.sourceIp && (
        <>
          <p className="mt-2">
            Server NOC menyambung ke <code>{info.host}</code> dengan alamat <code className="font-mono">{info.sourceIp}</code>.
            Tulis alamat itu ke daftar. Ganti <code>&lt;DAFTAR-LAMA&gt;</code> dengan isi kolom ADDRESS dari langkah 3
            (dipisah koma, mis. <code>10.20.30.0/24,192.168.101.0/24</code>); jika kolomnya kosong, tidak perlu perintah ini.
          </p>
          <Cmd>{`/ip service set www address=<DAFTAR-LAMA>,${info.sourceIp}/32`}</Cmd>
        </>
      )}
      {info && !info.sourceIp && <p className="mt-2 text-destructive">Server tidak menemukan rute ke {info.host}.</p>}
    </div>
  );
}

type GuideProps = {
  // Nilai form saat ini, agar petunjuk memakai host/port yang sedang diisi.
  host?: string;
  port?: string;
  onUseRouter?: (address: string, port?: number) => void;
};

export function RouterSetupGuide({ host, port, onUseRouter }: GuideProps) {
  return (
    <details className="mb-6 rounded-md border bg-muted/40 p-4 text-sm" open>
      <summary className="cursor-pointer font-medium">
        Panduan langkah demi langkah menambah router (baca sebelum &quot;Uji Koneksi&quot;)
      </summary>

      <ol className="mt-3 list-decimal space-y-4 pl-5">
        <li>
          <b>Pastikan versi RouterOS.</b> Aplikasi memakai REST API yang baru ada di RouterOS <b>v7.1 ke atas</b>.
          <Cmd>{"/system resource print"}</Cmd>
        </li>

        <li>
          <b>Tentukan alamat router (kolom Host).</b> Alamat ini <b>tidak diisi otomatis</b>: Anda mengambilnya dari
          router Anda sendiri. Angka seperti <code>192.168.88.1</code> di bawah hanyalah <b>contoh</b>. Ada tiga cara
          mendapatkannya:
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              <b>Cara paling mudah:</b> pakai alamat yang Anda ketik di <b>Winbox, SSH, atau WebFig</b> saat masuk ke
              router.
            </li>
            <li>
              <b>Dari router:</b> jalankan perintah di bawah. Setiap baris adalah satu alamat router; ambil bagian
              sebelum tanda <code>/</code> (mis. <code>192.168.88.1/24</code> → <code>192.168.88.1</code>).
              <Cmd>{"/ip address print"}</Cmd>
              Contoh keluaran (nilai Anda berbeda):
              <pre className="mt-1 overflow-x-auto rounded bg-background px-2 py-1.5 text-xs">
                {`#  ADDRESS            NETWORK       INTERFACE
0  192.168.88.1/24    192.168.88.0  bridge-lan    <- alamat LAN (pilih ini bila server NOC satu jaringan)
1  100.64.10.2/30     100.64.10.0   ether1-wan    <- alamat WAN/publik (hindari)`}
              </pre>
              Pilih alamat pada jaringan yang sama dengan server NOC, atau yang dilewati server untuk sampai ke router.
              Alamat WAN/publik biasanya tidak diizinkan layanan www.
            </li>
            <li>
              <b>Dari server NOC:</b> <code>ip route show default</code> menampilkan <code>default via X</code>. Bila
              router Anda adalah gateway jaringan itu, <code>X</code> adalah alamat router. Pastikan alamat itu
              menjawab: <code>ping X</code>.
            </li>
          </ul>
          <RouterFinder onUse={onUseRouter} />
        </li>

        <li>
          <b>Aktifkan layanan REST (www).</b> REST RouterOS berjalan di atas layanan web router. Lihat statusnya:
          <Cmd>{'/ip service print where name~"www"'}</Cmd>
          Baris yang diawali <code>X</code> berarti <b>nonaktif</b>; kolom <code>PORT</code> adalah port yang diisi di
          form. Pilih salah satu:
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              <b>HTTP (www), paling sederhana. Pakai di jaringan privat/VPN, jangan dibuka ke internet.</b> Di form,
              jangan centang HTTPS.
              <Cmd>{"/ip service set www disabled=no"}</Cmd>
              Port bawaan 80. Bila sudah dipakai layanan lain (mis. 8081), <b>jangan diubah</b>; cukup isi port itu di
              form.
            </li>
            <li>
              <b>HTTPS (www-ssl)</b>, di form centang HTTPS. Aplikasi <b>menolak sertifikat self-signed</b>, jadi
              butuh sertifikat yang dipercaya (mis. Let&apos;s Encrypt untuk nama domain publik yang menunjuk ke router;
              perintah <code>/certificate enable-ssl-certificate</code> ada di RouterOS terbaru). Setelah sertifikat
              ada di <code>/certificate print</code>:
              <Cmd>{"/ip service set www-ssl certificate=<NAMA-SERTIFIKAT> disabled=no"}</Cmd>
              Bila belum punya sertifikat tepercaya, pakai HTTP di atas.
            </li>
          </ul>
          Pastikan hasilnya: baris <code>www</code> tidak lagi berawalan <code>X</code> saat dicek ulang.
        </li>

        <li>
          <b>Izinkan IP server NOC.</b> Kolom ADDRESS layanan itu menentukan siapa yang boleh mengakses. Jika kosong,
          semua alamat diizinkan. Jika berisi daftar, <b>tambahkan</b> IP server ke daftar yang sudah ada (jangan
          mengganti, supaya perangkat lain tidak terkunci):
          <ServerIpHelper host={host} port={port} />
          Jika ada NAT di jalur, alamat yang dilihat router bisa berbeda dari yang ditampilkan di atas. Cek yang
          sebenarnya di router saat uji gagal:
          <Cmd>{"/ip firewall connection print where dst-port=<port-www>"}</Cmd>
        </li>

        <li>
          <b>Buat akun REST khusus.</b> Grup harus punya <b>kedua</b> izin <code>api</code> dan <code>rest-api</code>
          (tanpa keduanya, hasilnya 401 walau kata sandi benar), ditambah <code>read</code> dan <code>test</code>.
          Tambahkan <code>write</code> hanya bila memakai kontrol isolir.
          <Cmd>{"/user group add name=noc-rest policy=read,api,rest-api,test"}</Cmd>
          <Cmd>{"/user add name=noc-api group=noc-rest password=<KATA-SANDI>"}</Cmd>
          Periksa hasilnya; kolom <code>POLICY</code> grup <code>noc-rest</code> harus memuat <code>rest-api</code>:
          <Cmd>{"/user group print"}</Cmd>
          Bila router Anda menolak nama izin <code>rest-api</code> (RouterOS di bawah 7.1), perbarui RouterOS terlebih
          dahulu.
        </li>

        <li>
          <b>Isi form di bawah:</b> Nama, Host (langkah 2), Port REST (langkah 3), centang HTTPS hanya untuk{" "}
          <code>www-ssl</code>, lalu Username dan Password (langkah 5). Port juga boleh ditulis di host, mis.{" "}
          <code>192.168.88.1:8081</code> (contoh).
        </li>

        <li>
          <b>Klik &quot;Uji Koneksi&quot;</b>, lalu <b>Simpan</b> hanya setelah hasilnya berhasil. Setelah disimpan,
          backend mulai mengambil data router dalam sekitar 15 detik.
        </li>
      </ol>

      <div className="mt-4">
        <p className="font-medium">Jika uji koneksi gagal:</p>
        <table className="mt-2 w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b">
              <th className="py-1 pr-3 font-medium">Pesan</th>
              <th className="py-1 font-medium">Artinya dan yang dilakukan</th>
            </tr>
          </thead>
          <tbody>
            {PROBLEMS.map(([msg, fix]) => (
              <tr key={msg} className="border-b align-top last:border-0">
                <td className="py-1 pr-3 font-medium">{msg}</td>
                <td className="py-1">{fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
