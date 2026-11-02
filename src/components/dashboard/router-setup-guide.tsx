"use client";

import { useState, useSyncExternalStore } from "react";

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
  ["Login ditolak (401)", "Username atau kata sandi salah, atau grup akun tidak memiliki izin REST. Lihat langkah 5 dan `/user group print`."],
  ["Endpoint tidak ditemukan (404)", "RouterOS di bawah v7.1, atau port yang diisi bukan layanan www/www-ssl."],
  ["Sertifikat HTTPS tidak dipercaya", "www-ssl memakai sertifikat self-signed. Pasang sertifikat valid, atau pakai www (HTTP) lewat jaringan privat."],
  ["Port 8728 / 8729 / 8291 / 2024", "Itu API biner dan Winbox, bukan REST. Pakai port layanan www atau www-ssl dari langkah 3."],
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
        </li>

        <li>
          <b>Cek layanan REST dan port-nya.</b>
          <Cmd>{'/ip service print where name~"www"'}</Cmd>
          Isi kolom <b>Port REST</b> sesuai kolom PORT (bawaan 80 untuk <code>www</code>, 443 untuk{" "}
          <code>www-ssl</code>; bisa juga port lain, mis. 8081). <b>Jangan mengubah port</b> yang sudah berjalan, cukup
          isi port itu di form. Jika layanan bertanda <code>X</code> (nonaktif):
          <Cmd>{"/ip service enable www"}</Cmd>
        </li>

        <li>
          <b>Izinkan IP server NOC.</b> Kolom ADDRESS layanan itu menentukan siapa yang boleh mengakses. Jika kosong,
          semua alamat diizinkan. Jika berisi daftar, <b>tambahkan</b> IP server ke daftar yang sudah ada (jangan
          mengganti, supaya perangkat lain tidak terkunci):
          <Cmd>{"/ip service set www address=<DAFTAR-LAMA>,<IP-SERVER-NOC>/32"}</Cmd>
          {serverHost ? (
            <>
              Alamat yang Anda pakai untuk membuka aplikasi ini: <code>{serverHost}</code>. Itu hanya perkiraan: alamat
              yang dipakai server NOC untuk menyambung ke router bisa berbeda (domain, beberapa antarmuka, NAT). Nilai
              pastinya ditampilkan di hasil &quot;Uji Koneksi&quot; saat gagal; cek juga di router:
            </>
          ) : (
            <>Jika ada NAT di jalur, alamat yang dilihat router bisa berbeda. Cek yang sebenarnya saat uji gagal:</>
          )}
          <Cmd>{"/ip firewall connection print where dst-port=<port-www>"}</Cmd>
        </li>

        <li>
          <b>Siapkan akun router.</b> Pakai akun khusus (bukan <code>admin</code>) dengan izin baca; tambah izin tulis
          hanya bila memakai kontrol isolir. Lihat grup yang ada dan izinnya:
          <Cmd>{"/user group print"}</Cmd>
          Buat akun pada grup bawaan <code>read</code> (atau <code>write</code> bila perlu isolir):
          <Cmd>{"/user add name=noc-api group=read password=<KATA-SANDI>"}</Cmd>
          Jika uji koneksi nanti menjawab 401 padahal kata sandi benar, grup itu belum punya izin REST: sesuaikan izin
          grup di <code>/user group</code>.
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
