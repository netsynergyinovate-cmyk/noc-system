# Jalur ACS GenieACS: WireGuard sekarang, port LAN MikroTik nanti

Runbook ini menyambungkan modem/ONT pelanggan (di belakang MikroTik DIST-TUNGGAL-JAYA)
ke GenieACS di server Coolify, lalu kelak memindahkan jalurnya ke kabel langsung dari
port LAN MikroTik ke server, **tanpa mengubah ACS URL di modem**.

## Ide utama: satu IP tetap untuk ACS

```
ONT --PPPoE--> MikroTik --route 10.99.0.10/32--> [ wg-acs  ATAU  kabel LAN ] --> server :7547 --> container genieacs
```

- GenieACS punya satu alamat layanan tetap: `10.99.0.10`. ACS URL semua modem:
  `http://10.99.0.10:7547` (lolos `acsUrlProblem` / `ValidateACSURL`).
- Fase WireGuard: alamat itu menempel di interface `wg-acs` server.
- Fase LAN: alamat itu pindah ke NIC yang dicolok ke MikroTik.
- Pindah jalur = ganti gateway SATU route di MikroTik + route balik di server.
  Modem tidak disentuh lagi.

Tidak ada toggle di aplikasi: jalur ditentukan routing MikroTik dan host server.
Aplikasi berjalan di container dan hanya-baca ke perangkat, jadi toggle di UI hanya
akan berbohong.

`compose.coolify.yaml` sudah mem-publish `7547:7547` di semua alamat host, jadi
`10.99.0.10:7547` langsung sampai ke container `genieacs` tanpa mengubah compose.

## Nilai yang dipakai (ganti bila bentrok)

| Nama | Nilai contoh | Keterangan |
| --- | --- | --- |
| `ACS_IP` | `10.99.0.10/32` | Alamat layanan GenieACS, tetap selamanya |
| Transit WireGuard | `10.98.0.1/30` (MikroTik), `10.98.0.2/30` (server) | Interface `wg-acs` |
| Transit LAN | `10.98.1.1/30` (MikroTik), `10.98.1.2/30` (server) | Fase LAN |
| `ONT_POOLS` | `172.16.0.0/20`, `172.172.0.0/20`, `10.30.0.0/21` | Dicek di router 2026-11-16: `POOL-BRAS-RUNSNET`, `POOL-BRAS-RUNSNET-ISOLIR`, `NOC-MGMT-P1..P6` (10.30.1–6.x) |
| Port WireGuard MikroTik | `13232/udp` | Interface baru, tidak menyentuh WireGuard `10.167.80.1` yang sudah ada |

Cari `ONT_POOLS` di MikroTik: `/ip pool print` dan `/ppp profile print` (kolom
`remote-address`). Pastikan subnet contoh belum dipakai:

```routeros
/ip route print where dst-address in 10.98.0.0/16 or dst-address in 10.99.0.0/16
/ip address print where address in 10.98.0.0/16 or address in 10.99.0.0/16
```

Route balik (server ke `ONT_POOLS`) **wajib**: GenieACS mengirim *connection request*
ke IP modem. Tanpa route itu, modem tetap bisa inform, tapi perintah tidak langsung jalan
(baru jalan di inform berikutnya).

## Fase 1: WireGuard di host server (bukan template Coolify)

WireGuard dipasang di host karena alamat `ACS_IP` dan route ke `ONT_POOLS` harus ada
di tabel route host, tempat Docker meneruskan port 7547. Container `wg-easy` lewat
Coolify mengurung routing di container dan bisa hilang saat redeploy.

### 1a. Server (Ubuntu/Debian, sebagai root)

```bash
apt-get update && apt-get install -y wireguard
umask 077
wg genkey | tee /etc/wireguard/wg-acs.key | wg pubkey > /etc/wireguard/wg-acs.pub
cat /etc/wireguard/wg-acs.pub   # salin ke MikroTik (langkah 1b)
```

`/etc/wireguard/wg-acs.conf` (ganti `<...>`; `ONT_POOLS` dipisah koma):

```ini
[Interface]
# Alamat transit + alamat layanan ACS. wg-quick memasang keduanya di wg-acs.
Address = 10.98.0.2/30, 10.99.0.10/32
PrivateKey = <isi dari /etc/wireguard/wg-acs.key>

[Peer]
PublicKey = <public key interface wg-acs MikroTik>
# Server yang menyambung keluar: kantor tidak perlu port forward.
Endpoint = 103.167.70.136:13232
# wg-quick membuat route ke subnet ini lewat wg-acs (route balik ke modem).
AllowedIPs = 10.98.0.0/30, <ONT_POOLS>
PersistentKeepalive = 25
```

Jangan isi `AllowedIPs` dengan `0.0.0.0/0`: semua lalu lintas server akan lewat
MikroTik.

```bash
systemctl enable --now wg-quick@wg-acs
```

### 1b. MikroTik (RouterOS 7)

```routeros
/interface wireguard add name=wg-acs listen-port=13232 comment="GenieACS"
# salin public-key dari perintah berikut ke wg-acs.conf server
/interface wireguard print where name=wg-acs
/interface wireguard peers add interface=wg-acs public-key="<isi /etc/wireguard/wg-acs.pub>" \
    allowed-address=10.98.0.2/32,10.99.0.10/32 comment="server GenieACS"
/ip address add address=10.98.0.1/30 interface=wg-acs comment="GenieACS transit"
/ip route add dst-address=10.99.0.10/32 gateway=10.98.0.2 comment="ACS GenieACS"
/ip firewall filter add chain=input protocol=udp dst-port=13232 action=accept \
    comment="wg-acs" place-before=0
```

Rule `nat-ip-local-internet` (masquerade `src-address-list=POOL-BRAS-RUNSNET` tanpa
`out-interface`) akan men-NAT modem ke `10.98.0.1`. GenieACS butuh IP modem yang asli,
jadi kecualikan `wg-acs` di paling atas:

```routeros
/ip firewall nat add chain=srcnat out-interface=wg-acs action=accept \
    comment="wg-acs tanpa NAT" place-before=0
```

Bila ada rule `chain=forward` yang memblok lalu lintas pelanggan ke jaringan privat,
izinkan `dst-address=10.99.0.10 dst-port=7547 protocol=tcp` dan arah sebaliknya
(server ke `ONT_POOLS`).

### 1c. Uji fase 1

```bash
# server
wg show wg-acs                      # "latest handshake" < 2 menit
ip route get <IP WAN salah satu ONT> # harus "dev wg-acs"
```

```routeros
# MikroTik: jawaban HTTP apa pun (termasuk 405) = port CWMP tercapai; timeout = belum
/tool fetch url="http://10.99.0.10:7547/" output=none
```

## Fase 2: ganti ACS URL modem (sekali saja)

1. Di `/app/genieacs`, ikon ⚙: ACS URL = `http://10.99.0.10:7547`, simpan.
2. Modem baru: "Pasang GenieACS lewat web ONT" seperti biasa.
3. Modem lama masih menyimpan alamat GenieACS lokal yang sudah mati: `http://172.16.0.1:7547`
   (dst-nat lama sudah tidak ada di router per 2026-11-16) atau `http://10.167.80.2:7547`
   (PC dev lewat "WireGuard Remote"; masquerade `Masq-GenieACS-WireGuard`). Belokkan
   keduanya sementara ke ACS baru agar modem lama inform ke server:

   ```routeros
   /ip firewall nat add chain=dstnat protocol=tcp dst-address=172.16.0.1 dst-port=7547 \
       action=dst-nat to-addresses=10.99.0.10 comment="ACS lama ke GenieACS server (sementara)" place-before=0
   /ip firewall nat add chain=dstnat protocol=tcp dst-address=10.167.80.2 dst-port=7547 \
       action=dst-nat to-addresses=10.99.0.10 comment="ACS lama ke GenieACS server (sementara)" place-before=0
   ```

4. Modem yang sudah inform ke GenieACS server: kirim
   `SetParameterValues` `InternetGatewayDevice.ManagementServer.URL` (TR-098) atau
   `Device.ManagementServer.URL` (TR-181) = `http://10.99.0.10:7547` dari GenieACS UI
   SELAGI URL lama masih hidup. Setelah inform pertama ke alamat baru, modem tampil
   "Tersambung" di aplikasi.
5. Setelah `packets` kedua rule sementara itu tidak bertambah lagi, nonaktifkan keduanya
   beserta masquerade lama `Masq-GenieACS-WireGuard`.

Ini satu-satunya kali modem perlu disentuh.

## Fase 3: pindah ke port LAN MikroTik

Urutan di bawah membuat jeda beberapa detik. Modem mengulang inform sendiri. Kerjakan di
luar jam sibuk dan lewat konsol/SSH yang TIDAK melewati `wg-acs`.

1. Colok kabel: port MikroTik (contoh `ether5`) ke NIC kedua server (`<NIC_MIKROTIK>`,
   lihat `ip -br link`).
2. MikroTik (rule srcnat wajib: `nat-ip-local-internet` tanpa `out-interface` akan
   men-NAT modem ke `10.98.1.1`):

   ```routeros
   /ip address add address=10.98.1.1/30 interface=ether5 comment="GenieACS LAN"
   /ip firewall nat add chain=srcnat out-interface=ether5 action=accept \
       comment="GenieACS LAN tanpa NAT" place-before=0
   ```

3. Server: tambah alamat transit saja dulu di netplan
   (`/etc/netplan/60-acs.yaml`, `chmod 600`), lalu `netplan apply`:

   ```yaml
   network:
     version: 2
     ethernets:
       <NIC_MIKROTIK>:
         addresses: [10.98.1.2/30]
   ```

   Uji: `ping -c3 10.98.1.1`.
4. Server: matikan WireGuard (melepas `10.99.0.10` dan route `ONT_POOLS` dari `wg-acs`):

   ```bash
   systemctl disable --now wg-quick@wg-acs
   ```

5. Server: pindahkan alamat ACS + route balik ke NIC, `netplan apply`:

   ```yaml
   network:
     version: 2
     ethernets:
       <NIC_MIKROTIK>:
         addresses: [10.98.1.2/30, 10.99.0.10/32]
         routes:
           - to: <ONT_POOL_1>
             via: 10.98.1.1
           # satu entri per subnet ONT_POOLS
   ```

6. MikroTik: arahkan route ACS ke kabel, lalu matikan peer lama:

   ```routeros
   /ip route set [find dst-address=10.99.0.10/32] gateway=10.98.1.2
   /interface wireguard disable [find name=wg-acs]
   ```

7. Uji seperti 1c (`ip route get` sekarang `dev <NIC_MIKROTIK>`).

### Kembali ke WireGuard (rollback)

Kebalikan urutan: MikroTik `gateway=10.98.0.2` + enable `wg-acs`; server hapus
`10.99.0.10/32` dan `routes` dari netplan, `netplan apply`, lalu
`systemctl enable --now wg-quick@wg-acs`.

## Opsional: batasi port 7547

Docker mem-publish 7547 di semua alamat dan melewati `ufw`. Bila modem hanya datang
lewat jalur ini, batasi di chain `DOCKER-USER` SETELAH fase 2 terbukti (modem yang masih
memakai URL lama akan terputus):

```bash
iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 7547 --ctdir ORIGINAL -j DROP
iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 7547 --ctdir ORIGINAL -s <ONT_POOL_1> -j RETURN
# ulangi baris RETURN per subnet ONT_POOLS; simpan dengan iptables-persistent
```

## Yang belum diverifikasi

- `ONT_POOLS` diambil dari dokumentasi, belum dicocokkan ke router hari ini; modem dengan
  WAN TR-069 terpisah (VLAN lain) butuh subnetnya ditambahkan.
- Kantor tempat server juga pelanggan PPPoE (`172.16.15.221`): route `172.16.0.0/20`
  lewat `wg-acs` tidak boleh memotong jalur server ke router kantor (cek `ip route get
  <IP gateway kantor>` setelah fase 1).
- Nama NIC server dan port MikroTik untuk fase 3.
- Rule `chain=forward` MikroTik yang ada.
