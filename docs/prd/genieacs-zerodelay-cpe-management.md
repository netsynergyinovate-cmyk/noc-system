# Product Requirement Document (PRD)
## Zero-Delay Real-Time CPE & Anomaly Management System (GenieACS TR-069 + Go Backend)

**Document Version:** 1.0.0  
**Target Architecture:** Monorepo (`noc-system`) — Go Backend (`backend/`) + Next.js App Router (`src/`) + GenieACS (`docker/genieacs/`)  
**Status:** Approved for Implementation  
**Owner:** NOC & Core Network Engineering Team  

---

## 1. Executive Summary & Problem Statement

### 1.1 Objective
Membangun dan menstandarisasi subsistem manajemen Customer Premises Equipment (CPE / ONT) berbasis **TR-069 (GenieACS)** dan **Go Backend** yang beroperasi secara **Zero Delay (< 2 detik respon on-demand)**, **100% faktual (bebas data tiruan / dummy)**, serta **tanpa membebani CPU perangkat OLT dan ONT**.

### 1.2 Masalah Sistem Saat Ini
1. **Delay & Kegagalan Respon GenieACS**:
   - Skrip provision `noc-connreq.js` men-generate password Connection Request secara acak setiap kali dieksekusi (`Math.random()`), menyebabkan kegagalan autentikasi HTTP Digest (401 Unauthorized / Timeout) saat GenieACS mencoba membangunkan ONT.
   - Panggilan API di Next.js membaca cache statis MongoDB GenieACS, bukan memicu *live query* ke ONT.
   - Variasi *TR-069 data model* antar vendor (TR-098 `InternetGatewayDevice.` vs TR-181 `Device.`) tidak tertangani di `rxPower.js`, membuat pembacaan redaman optik sering bernilai `null` atau `N/A`.
2. **Ketergantungan VPN WireGuard yang Tidak Perlu**:
   - Pemaksaan rute TR-069 melalui WireGuard menimbulkan beban enkripsi CPU di MikroTik dan overhead MTU.
3. **Double Evaluation & Dummy Fallback pada Deteksi Anomali**:
   - Layer service Next.js masih mengevaluasi anomali sendiri dan melakukan *fallback* ke mock data jika tabel kosong (`rows.length === 0`).

---

## 2. Arsitektur Jaringan & Alur Zero-Delay

### 2.1 Diagram Topologi

```
[ Pelanggan / ONT ]
      │ (Koneksi Optik PON)
      ▼
[ OLT HSGQ (EPON / GPON) ]
      │ (Uplink Trunk VLAN 100/200)
      ▼
[ Router MikroTik Core / BRAS ]
      │
      ├───────────────────────┬────────────────────────┐
      │ (Direct Routing L3)   │ (Syslog UDP 514)       │ (NetFlow UDP 2055)
      ▼                       ▼                        ▼
[ GenieACS Server ]     [ Go Backend Engine ]    [ Traffic Analyzer ]
 (Port 7547 CWMP,         (Port 8080 HTTP &        (Internal Engine)
  Port 7557 NBI)           WebSocket Hub)
      │                       │
      └───────────┬───────────┘
                  │ (Live REST & WebSocket /ws)
                  ▼
          [ Frontend Next.js ]
        (Dashboard NOC /app/cpe & /app/anomali)
```

### 2.2 Prinsip Desain Zero-Delay
1. **On-Demand Live Refresh (`connection_request`)**:  
   Saat pengguna menekan tombol *Refresh*, *Ganti Wi-Fi*, atau *Reboot* di UI, backend langsung mengirim tugas ke GenieACS NBI dengan parameter query `?connection_request`. GenieACS segera mengirim HTTP GET ke port `7547` ONT, memaksa ONT membuka sesi CWMP dalam waktu < 1 detik.
2. **Bypass Polling via Syslog Push**:  
   Kondisi kabel putus (*Loss of Signal*) atau mati listrik (*Dying Gasp*) tidak menunggu polling OLT/ONT, melainkan dikirim oleh OLT via Syslog UDP 514 langsung ke Go Backend.
3. **Direct Routing Non-VPN**:  
   Server NOC memiliki rute langsung (*L3 Direct Subnet*) ke subnet PPPoE/ONT pelanggan, meniadakan WireGuard.

---

## 3. Spesifikasi Fungsional & Parameter TR-069

### 3.1 Fitur 1: Pembacaan Redaman Optik (Optical Rx/Tx Power)
* **Kebutuhan**: Membaca daya terima optik (Rx Power dBm), daya kirim (Tx Power dBm), dan suhu laser ONT secara akurat.
* **Peta Parameter Multi-Vendor**:
  | Vendor | Parameter Path | Format / Konversi |
  | :--- | :--- | :--- |
  | **ZTE / Huawei GPON** | `InternetGatewayDevice.DeviceInfo.XponInterface.RXPower` | Float langsung (dBm) |
  | **Alcatel / Nokia** | `InternetGatewayDevice.X_ALU_OntOpticalParam.RXPower` | Float langsung (dBm) |
  | **HSGQ / V-SOL / CT-COM EPON** | `InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower` | $10 \times \log_{10}(\text{raw} \times 0.0001)$ |
  | **CT-COM GPON** | `InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower` | $10 \times \log_{10}(\text{raw} \times 0.0001)$ |
  | **TR-181 Standard** | `Device.Optical.Interface.1.OpticalSignalLevel` | $0.001 \times \text{raw}$ (dBm) |

### 3.2 Fitur 2: Daftar Perangkat Terhubung (Connected Devices / Hosts)
* **Kebutuhan**: Menampilkan nama perangkat (Hostname), IP Address, MAC Address, dan status aktif untuk setiap HP/laptop yang terhubung via LAN maupun Wi-Fi.
* **Parameter Path**:
  * Hostname: `InternetGatewayDevice.LANDevice.1.Hosts.Host.*.HostName` (atau `Device.Hosts.Host.*.HostName`)
  * IP Address: `InternetGatewayDevice.LANDevice.1.Hosts.Host.*.IPAddress` (atau `Device.Hosts.Host.*.IPAddress`)
  * MAC Address: `InternetGatewayDevice.LANDevice.1.Hosts.Host.*.MACAddress` (atau `Device.Hosts.Host.*.PhysAddress`)
  * Active Flag: `InternetGatewayDevice.LANDevice.1.Hosts.Host.*.Active`
  * Wi-Fi Associated Clients: `InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice.*.AssociatedDeviceMACAddress`

### 3.3 Fitur 3: Pengubahan Nama & Password Wi-Fi (SSID & KeyPassphrase)
* **Kebutuhan**: Mengubah SSID dan password Wi-Fi 2.4 GHz / 5 GHz langsung aktif tanpa reboot manual.
* **Parameter Path**:
  * SSID (TR-098): `InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID`
  * WPA Password (TR-098): `InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase`
  * SSID (TR-181): `Device.WiFi.SSID.1.SSID`
  * WPA Password (TR-181): `Device.WiFi.AccessPoint.1.Security.KeyPassphrase`
* **Validasi**: Password minimal 8 karakter, enkripsi otomatis WPA2-PSK (AES).

### 3.4 Fitur 4: Reboot ONT On-Demand
* **Kebutuhan**: Merestart ONT secara remote saat terjadi kendala jaringan atau atas permintaan pelanggan.
* **Mekanisme**: Memanggil RPC Method TR-069 standar `reboot` via GenieACS NBI.

---

## 4. Konfigurasi Teknis GenieACS (Zero-Delay Config)

### 4.1 Presets Configuration

#### Preset 1: `01-bootstrap-connreq`
* **Events**: `0 BOOTSTRAP`, `1 BOOT`
* **Weight**: `0`
* **Channel**: `default`
* **Provisions**: `noc-connreq`

#### Preset 2: `02-periodic-inform`
* **Events**: `2 PERIODIC`, `value change`
* **Weight**: `10`
* **Channel**: `default`
* **Provisions**: `noc-vital-refresh`

---

### 4.2 Script Provision: `noc-connreq.js`
Menetapkan kredensial *Connection Request* statis yang dapat dihitung ulang (*deterministic hash*) dan mengatur interval inform 300 detik:

```javascript
// docker/genieacs/config/provisions/noc-connreq.js
const now = Date.now();
const deviceId = declare("DeviceID.ID").value[0];

// Kunci rahasia statis untuk kalkulasi password konsisten
const SECRET_SALT = "NOC_SYSTEM_TR069_STABLE_V1";
const connUser = "noc_acs";
const connPass = "CPE_" + deviceId.slice(-6) + "_" + SECRET_SALT.slice(0, 8);

// Kunci kredensial Connection Request di ONT (TR-098 & TR-181)
declare("InternetGatewayDevice.ManagementServer.ConnectionRequestUsername", {value: now}, {value: connUser});
declare("InternetGatewayDevice.ManagementServer.ConnectionRequestPassword", {value: now}, {value: connPass});
declare("Device.ManagementServer.ConnectionRequestUsername", {value: now}, {value: connUser});
declare("Device.ManagementServer.ConnectionRequestPassword", {value: now}, {value: connPass});

// Atur Inform Otomatis setiap 300 detik (5 menit)
declare("InternetGatewayDevice.ManagementServer.PeriodicInformEnable", {value: now}, {value: true});
declare("InternetGatewayDevice.ManagementServer.PeriodicInformInterval", {value: now}, {value: 300});
declare("Device.ManagementServer.PeriodicInformEnable", {value: now}, {value: true});
declare("Device.ManagementServer.PeriodicInformInterval", {value: now}, {value: 300});
```

---

### 4.3 Script Provision: `noc-vital-refresh.js`
Hanya merefresh parameter vital (Optik, LAN, Wi-Fi) pada Inform rutin tanpa merayapi (*crawling*) seluruh tree agar CPU ONT tidak kelebihan beban:

```javascript
// docker/genieacs/config/provisions/noc-vital-refresh.js
const now = Date.now();

// Refresh parameter optik
declare("InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.*", {value: now});
declare("InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.*", {value: now});
declare("InternetGatewayDevice.DeviceInfo.XponInterface.*", {value: now});
declare("InternetGatewayDevice.X_ALU_OntOpticalParam.*", {value: now});
declare("Device.Optical.Interface.*.*", {value: now});

// Refresh klien LAN & Wi-Fi
declare("InternetGatewayDevice.LANDevice.1.Hosts.Host.*", {value: now});
declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice.*", {value: now});

// Refresh Wi-Fi SSID
declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", {value: now});
declare("Device.WiFi.SSID.1.SSID", {value: now});
```

---

### 4.4 Virtual Parameters (Semua Vendor)

#### A. `rxPower.js`
```javascript
// docker/genieacs/config/virtual_parameters/rxPower.js
const candidates = [
  "InternetGatewayDevice.DeviceInfo.XponInterface.RXPower",
  "InternetGatewayDevice.X_ALU_OntOpticalParam.RXPower",
  "InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower",
  "InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower",
  "Device.Optical.Interface.1.OpticalSignalLevel"
];

for (let path of candidates) {
  let item = declare(path, {value: 1});
  if (item && item.value && item.value[0] !== undefined) {
    let raw = parseFloat(item.value[0]);
    if (isNaN(raw)) continue;
    // Format integer uW dari CT-COM
    if (raw > 0) {
      return {writable: false, value: [(10 * Math.log10(raw * 0.0001)).toFixed(2), "xsd:string"]};
    }
    // Format integer 0.01 dBm
    if (raw < -100) {
      return {writable: false, value: [(raw / 100).toFixed(2), "xsd:string"]};
    }
    return {writable: false, value: [raw.toFixed(2), "xsd:string"]};
  }
}
return {writable: false, value: ["-", "xsd:string"]};
```

#### B. `connectedDevices.js`
```javascript
// docker/genieacs/config/virtual_parameters/connectedDevices.js
let result = [];
let hostNames = declare("InternetGatewayDevice.LANDevice.1.Hosts.Host.*.HostName", {value: 1});
let ipAddrs = declare("InternetGatewayDevice.LANDevice.1.Hosts.Host.*.IPAddress", {value: 1});
let macAddrs = declare("InternetGatewayDevice.LANDevice.1.Hosts.Host.*.MACAddress", {value: 1});
let activeFlags = declare("InternetGatewayDevice.LANDevice.1.Hosts.Host.*.Active", {value: 1});

if (hostNames && hostNames.path) {
  for (let i = 0; i < hostNames.path.length; i++) {
    let isActive = activeFlags.value[i] === true || activeFlags.value[i] === "true" || activeFlags.value[i] === 1;
    if (isActive && ipAddrs.value[i]) {
      result.push({
        hostname: hostNames.value[i] || "Perangkat Terhubung",
        ip: ipAddrs.value[i],
        mac: macAddrs.value[i] || "",
        type: "LAN/Wi-Fi"
      });
    }
  }
}
return {writable: false, value: [JSON.stringify(result), "xsd:string"]};
```

---

## 5. Implementasi Backend & API Next.js

### 5.1 Service Layer: `src/services/cpe-detail.service.ts`

```typescript
const GENIEACS_NBI = process.env.GENIEACS_NBI_URL || "http://localhost:7557";

// 1. Force Live Refresh Real-Time
export async function refreshCpeLive(deviceId: string) {
  const url = `${GENIEACS_NBI}/devices/${encodeURIComponent(deviceId)}/tasks?timeout=5000&connection_request`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "refreshObject",
      objectName: "InternetGatewayDevice.LANDevice.1.Hosts."
    })
  });
  return res.ok;
}

// 2. Ganti Nama & Password Wi-Fi
export async function updateCpeWifi(deviceId: string, ssid: string, password?: string) {
  const url = `${GENIEACS_NBI}/devices/${encodeURIComponent(deviceId)}/tasks?timeout=5000&connection_request`;
  const params: [string, string][] = [
    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", ssid]
  ];
  if (password && password.length >= 8) {
    params.push(["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", password]);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "setParameterValues",
      parameterValues: params
    })
  });
  return res.ok;
}

// 3. Reboot ONT
export async function rebootCpe(deviceId: string) {
  const url = `${GENIEACS_NBI}/devices/${encodeURIComponent(deviceId)}/tasks?timeout=5000&connection_request`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "reboot" })
  });
  return res.ok;
}
```

---

## 6. Konfigurasi MikroTik (Tanpa WireGuard)

Jalankan perintah berikut pada Terminal MikroTik untuk memastikan komunikasi L3 direct routing dan deteksi Syslog zero-delay:

```routeros
# 1. Izinkan Koneksi HTTP Connection Request GenieACS ke port 7547 ONT:
/ip firewall filter
add chain=forward action=accept src-address=192.168.1.100 dst-port=7547 protocol=tcp comment="NOC Server ke TR069 ONT" place-before=1

# 2. Remote Syslog Event Push (Zero Delay Anomali ke Port 514 UDP):
/system logging action
add name=noc-go remote=192.168.1.100 remote-port=514 src-address=192.168.1.1 target=remote

/system logging
add action=noc-go topics=ppp,info
add action=noc-go topics=interface,info
add action=noc-go topics=critical

# 3. Direct Route Subnet Pelanggan (Pastikan tidak ada Masquerade ke IP Server NOC)
/ip firewall nat
add chain=srcnat action=accept src-address=10.10.0.0/16 dst-address=192.168.1.100 comment="Bypass NAT untuk Server NOC" place-before=1
```

---

## 7. Rencana Rilis & Validasi Kualitas (QA Checklist)

| No | Kasus Pengujian (Test Case) | Expected Result | Status |
| :--- | :--- | :--- | :--- |
| **TC-01** | Klik tombol *Refresh Live* di `/app/cpe/[id]` | Redaman optik terupdate < 2 detik tanpa timeout 401 | Wajib Pass |
| **TC-02** | Ubah SSID menjadi `Wifi-Baru` & Password | SSID di ONT langsung berganti seketika | Wajib Pass |
| **TC-03** | Eksekusi tombol *Reboot* ONT | Lampu indikator ONT restart dalam 3 detik | Wajib Pass |
| **TC-04** | Cek daftar perangkat terhubung | Daftar HP/Laptop muncul dengan IP & MAC aktif | Wajib Pass |
| **TC-05** | Cabut kabel fiber optik (LOS) | OLT kirim Syslog 514, anomali merah muncul di board < 1 detik | Wajib Pass |
| **TC-06** | Jaringan normal (0 anomali di DB) | UI menampilkan status bersih (bebas data mock/dummy) | Wajib Pass |
