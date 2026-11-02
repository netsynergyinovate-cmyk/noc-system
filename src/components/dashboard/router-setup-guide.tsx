"use client";

import { useState, useSyncExternalStore } from "react";

// Panduan langkah demi langkah menambah router MikroTik. Dipakai di halaman Tambah Router.
// Semua perintah RouterOS di sini adalah perintah baca/aktifkan layanan yang umum; nilai
// dalam <...> harus diganti. Penyebab-penyebab di tabel sama dengan pesan hasil "Uji Koneksi".

function Cmd({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-1 flex items-start gap-2 rounded bg-background px-2 py-1.5 font-mono text-xs">
      <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all">{children}</pre>
      <button
        type="button"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => {
          void navigator.clipboard?.writeText(children).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Tersalin" : "Salin"}
      </button>
    </div>
  );
}

const PROBLEMS: Array<[string, string]> = [
  ["Router menutup koneksi", "IP server NOC belum ada di kolom ADDRESS layanan www. Ulangi langkah 4 (tambahkan, jangan mengganti)."],
  ["Koneksi ditolak", "Layanan www mati atau portnya salah. Ulangi langkah 2 dan 3, lalu isi Port REST yang benar."],
  ["Timeout / lambat", "Tidak ada rute ke alamat itu atau firewall router (chain input) menjatuhkan paket. Periksa langkah 1 (alamat) dan `/ip firewall filter print where chain=input`; dari server coba `ping <alamat-router>`."],
  ["Login ditolak (401)", "Username atau kata sandi salah, atau grup akun tidak memiliki izin REST. Lihat langkah 5 dan `/user group print`."],
  ["Endpoint tidak ditemukan (404)", "RouterOS di bawah v7.1, atau port yang diisi bukan layanan www/www-ssl."],
  ["Sertifikat HTTPS tidak dipercaya", "www-ssl memakai sertifikat self-signed. Pasang sertifikat valid, atau pakai www (HTTP) lewat jaringan privat."],
  ["Port 8728 / 8729 / 8291", "Itu API biner dan Winbox, bukan REST. Pakai port layanan www (80) atau www-ssl (443)."],
];

export function RouterSetupGuide() {
  // Hostname hanya ada di browser: snapshot server kosong, tanpa setState di dalam effect.
  const serverHost = useSyncExternalStore(
    () => () => {},
    () => window.location.hostname,
    () => "",
  );

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
          <b>Tentukan alamat router (kolom Host).</b> Pakai alamat yang bisa dijangkau dari <b>server NOC</b>, biasanya
          alamat yang sama dengan yang Anda pakai di Winbox atau SSH. Semua alamat router:
          <Cmd>{"/ip address print"}</Cmd>
          Pilih alamat pada jaringan yang sama dengan server, atau yang dilewati server untuk sampai ke router (di
          server: <code>ip route get &lt;alamat&gt;</code> atau <code>tracepath &lt;alamat&gt;</code>). Alamat publik
          (WAN) biasanya tidak diizinkan layanan www.
        </li>

        <li>
          <b>Cek layanan REST dan port-nya.</b>
          <Cmd>{'/ip service print where name~"www"'}</Cmd>
          Isi kolom <b>Port REST</b> sesuai kolom PORT (bawaan 80 untuk <code>www</code>, 443 untuk{" "}
          <code>www-ssl</code>; bisa juga port lain, mis. 8081). Jika layanan bertanda <code>X</code> (nonaktif):
          <Cmd>{"/ip service enable www"}</Cmd>
        </li>

        <li>
          <b>Izinkan IP server NOC.</b> Kolom ADDRESS layanan itu menentukan siapa yang boleh mengakses. Jika kosong,
          semua alamat diizinkan. Jika berisi daftar, <b>tambahkan</b> IP server ke daftar yang sudah ada (jangan
          mengganti, supaya perangkat lain tidak terkunci):
          <Cmd>{"/ip service set www address=<DAFTAR-LAMA>,<IP-SERVER-NOC>/32"}</Cmd>
          {serverHost ? (
            <>
              Alamat server NOC yang Anda buka sekarang: <code>{serverHost}</code>. Itu belum tentu alamat yang
              dilihat router (bisa berbeda bila ada NAT atau proxy). Cek yang sebenarnya saat uji gagal:
            </>
          ) : (
            <>Jika ada NAT di jalur, alamat yang dilihat router bisa berbeda. Cek yang sebenarnya saat uji gagal:</>
          )}
          <Cmd>{'/ip firewall connection print where dst-port=<port-www>'}</Cmd>
        </li>

        <li>
          <b>Siapkan akun router.</b> Pakai akun khusus (bukan <code>admin</code>) dengan izin baca; tambah izin tulis
          hanya bila memakai kontrol isolir. Lihat grup yang ada dan izinnya:
          <Cmd>{"/user group print"}</Cmd>
          Buat akun pada grup bawaan <code>read</code> (atau <code>write</code> bila perlu isolir):
          <Cmd>{"/user add name=noc-api group=read password=<KATA-SANDI>"}</Cmd>
          Jika uji koneksi nanti menjawab 401 padahal kata sandi benar, grup itu belum punya izin REST: sesuaikan
          izin grup di <code>/user group</code>.
        </li>

        <li>
          <b>Isi form di bawah:</b> Nama, Host (langkah 2), Port REST (langkah 3), centang HTTPS hanya untuk{" "}
          <code>www-ssl</code>, lalu Username dan Password (langkah 5). Port juga boleh ditulis di host:{" "}
          <code>10.20.30.1:8081</code>.
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
