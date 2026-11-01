/**
 * Single source of truth untuk metadata sumber data diagnosa dan anomali.
 * Pure TypeScript (tanpa React, tanpa DB/IO).
 *
 * Seluruh endpoint MikroTik diverifikasi langsung terhadap:
 * - src/services/diagnostics.service.ts (createRouterReads, readFirewall, readActive, readTraffic)
 * - src/lib/mikrotik/client.ts (MikrotikRestClient)
 * - backend/internal/collector/{client.go, poller.go, backup.go, queue.go, ifrate.go} (REST API RouterOS v7)
 * Seluruh skema database diverifikasi terhadap src/db/schema/*.ts (Drizzle pgTable).
 */

export const INTERNET_PROBE = "8.8.8.8";
export const DNS_PROBE_NAME = "google.com";

export type SourceSystem =
  | "MikroTik"
  | "OLT"
  | "GenieACS"
  | "Database"
  | "Billing"
  | "Syslog"
  | "NetFlow";

export interface SourceInfo {
  system: SourceSystem;
  path: string; /* RouterOS menu path for MikroTik e.g. '/ppp/active'; table name for Database */
  via: string; /* how it is read, e.g. 'REST GET /rest/ppp/active?name=<pppoe-user>' or 'SQL: customer_traffic_samples' */
  fields?: string[]; /* the fields/columns actually used */
}

export interface MetricInfo {
  title: string;
  explain: string; /* what it is, why checked, how to read value vs ambang; 1-3 short sentences */
  sources: SourceInfo[];
}

export type AnomalyKind = "queue" | "cpu" | "port" | "optical" | "offline";

/**
 * Filter sumber data khusus perangkat MikroTik.
 */
export function mikrotikSources(info: { sources: SourceInfo[] }): SourceInfo[] {
  return (info?.sources ?? []).filter((s) => s.system === "MikroTik");
}

/**
 * Format satu baris sumber data dalam bentuk teks ringkas.
 * Contoh: 'MikroTik · /ppp/active · REST GET /rest/ppp/active (name, address, uptime)'
 */
export function formatSource(s: SourceInfo): string {
  const base = `${s.system} · ${s.path} · ${s.via}`;
  if (s.fields && s.fields.length > 0) {
    return `${base} (${s.fields.join(", ")})`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Verified Sources Library (RouterOS REST allowlist & sistem penunjang)
// ---------------------------------------------------------------------------

// --- MikroTik: Poller Go (backend/internal/collector/*.go) ---
// verified: backend/internal/collector/queue.go line 13 (const queueProplist)
const MIKROTIK_QUEUE_POLLER: SourceInfo = {
  system: "MikroTik",
  path: "/queue/simple",
  via: "REST GET /rest/queue/simple?.proplist=name,rate,max-limit,parent,disabled",
  fields: ["name", "rate", "max-limit", "parent", "disabled"],
};

// verified: backend/internal/collector/backup.go line 18 (const pppActiveProplist)
const MIKROTIK_PPP_ACTIVE_POLLER: SourceInfo = {
  system: "MikroTik",
  path: "/ppp/active",
  via: "REST GET /rest/ppp/active?.proplist=name,service,address",
  fields: ["name", "service", "address"],
};

// verified: backend/internal/collector/backup.go line 19 (const resourceProplist)
const MIKROTIK_SYSTEM_RESOURCE: SourceInfo = {
  system: "MikroTik",
  path: "/system/resource",
  via: "REST GET /rest/system/resource?.proplist=cpu-load,free-memory,total-memory,uptime,version,board-name",
  fields: ["cpu-load", "free-memory", "total-memory", "uptime", "version", "board-name"],
};

// verified: backend/internal/collector/backup.go line 20 (const interfaceProplist)
const MIKROTIK_INTERFACE_POLLER: SourceInfo = {
  system: "MikroTik",
  path: "/interface",
  via: "REST GET /rest/interface?.proplist=name,type,running,disabled,rx-error,tx-error,rx-drop,tx-drop",
  fields: ["name", "type", "running", "disabled", "rx-error", "tx-error", "rx-drop", "tx-drop"],
};

// --- MikroTik: Service TypeScript (src/services/diagnostics.service.ts) ---
// verified: diagnostics.service.ts line 270 (read("active", "/rest/ppp/active"))
const MIKROTIK_PPP_ACTIVE_SERVICE: SourceInfo = {
  system: "MikroTik",
  path: "/ppp/active",
  via: "REST GET /rest/ppp/active",
  fields: ["name", "service", "caller-id", "address", "uptime", "session-id", "radius"],
};

// verified: diagnostics.service.ts line 320, 328 (read("queue1"|"queue2", "/rest/queue/simple", { name: iface }))
const MIKROTIK_QUEUE_SERVICE: SourceInfo = {
  system: "MikroTik",
  path: "/queue/simple",
  via: "REST GET /rest/queue/simple?name=<pppoe-interface>",
  fields: ["name", "max-limit", "rate", "bytes", "packets", "disabled"],
};

// verified: diagnostics.service.ts line 287, 318, 321, 329 (read("uplink1"|"ppp1", "/rest/interface", { name }))
const MIKROTIK_INTERFACE_SERVICE: SourceInfo = {
  system: "MikroTik",
  path: "/interface",
  via: "REST GET /rest/interface?name=<interface-name>",
  fields: ["name", "type", "running", "disabled", "rx-byte", "tx-byte", "rx-error", "tx-error", "rx-drop", "tx-drop", "comment"],
};

// verified: diagnostics.service.ts line 282 (read("route", "/rest/ip/route", { "dst-address": "0.0.0.0/0" }))
const MIKROTIK_IP_ROUTE: SourceInfo = {
  system: "MikroTik",
  path: "/ip/route",
  via: "REST GET /rest/ip/route?dst-address=0.0.0.0%2F0",
  fields: ["active", "immediate-gw", "dst-address", "gateway", "disabled"],
};

// verified: diagnostics.service.ts line 290 (client.measure("/rest/interface/ethernet/monitor", { numbers, once }))
const MIKROTIK_ETHERNET_MONITOR: SourceInfo = {
  system: "MikroTik",
  path: "/interface/ethernet/monitor",
  via: "REST POST /rest/interface/ethernet/monitor { numbers: '<uplink>', once: '' }",
  fields: ["rate", "status"],
};

// verified: diagnostics.service.ts line 262, 313, 314 (client.measure("/rest/tool/ping", { address, count: "10", interval: "0.2" }))
const MIKROTIK_PING_PROBE: SourceInfo = {
  system: "MikroTik",
  path: "/tool/ping",
  via: "REST POST /rest/tool/ping { address: '<target>', count: '10', interval: '0.2' }",
  fields: ["seq", "host", "time", "packet-loss", "min-rtt", "avg-rtt", "max-rtt", "status"],
};

// verified: diagnostics.service.ts line 1491 (client.measure("/rest/tool/ping", { address: custIp, count: "10", interval: "0.2" }))
const MIKROTIK_PING_CUSTOMER: SourceInfo = {
  system: "MikroTik",
  path: "/tool/ping",
  via: "REST POST /rest/tool/ping { address: '<customer-ip>', count: '10', interval: '0.2' }",
  fields: ["seq", "host", "time", "packet-loss", "min-rtt", "avg-rtt", "max-rtt", "status"],
};

// verified: diagnostics.service.ts line 1534 (client.measure("/rest/tool/ping", { address: DNS_PROBE_NAME, count: "2" }))
const MIKROTIK_PING_DNS: SourceInfo = {
  system: "MikroTik",
  path: "/tool/ping",
  via: "REST POST /rest/tool/ping { address: 'google.com', count: '2' }",
  fields: ["host", "packet-loss", "status"],
};

// verified: diagnostics.service.ts line 1513 (client.measure("/rest/tool/traceroute", { address: INTERNET_PROBE, count: "2" }))
const MIKROTIK_TRACEROUTE: SourceInfo = {
  system: "MikroTik",
  path: "/tool/traceroute",
  via: "REST POST /rest/tool/traceroute { address: '8.8.8.8', count: '2' }",
  fields: ["loss", "address", "sent", "avg", "status"],
};

// verified: diagnostics.service.ts line 297, 298
const MIKROTIK_BGP_CONN: SourceInfo = {
  system: "MikroTik",
  path: "/routing/bgp/connection",
  via: "REST GET /rest/routing/bgp/connection",
  fields: ["name", "remote.address", "disabled"],
};

const MIKROTIK_BGP_SESS: SourceInfo = {
  system: "MikroTik",
  path: "/routing/bgp/session",
  via: "REST GET /rest/routing/bgp/session",
  fields: ["name", "remote.address", "uptime", "prefix-count"],
};

// verified: diagnostics.service.ts line 299, 300, 301
const MIKROTIK_IPV6_ADDR: SourceInfo = {
  system: "MikroTik",
  path: "/ipv6/address",
  via: "REST GET /rest/ipv6/address",
  fields: ["address", "interface", "disabled", "link-local"],
};

const MIKROTIK_IPV6_ROUTE: SourceInfo = {
  system: "MikroTik",
  path: "/ipv6/route",
  via: "REST GET /rest/ipv6/route?dst-address=%3A%3A%2F0",
  fields: ["dst-address", "gateway", "active"],
};

const MIKROTIK_IPV6_BINDING: SourceInfo = {
  system: "MikroTik",
  path: "/ipv6/dhcp-server/binding",
  via: "REST GET /rest/ipv6/dhcp-server/binding",
  fields: ["address", "interface", "status"],
};

// verified: diagnostics.service.ts line 337, 338
const MIKROTIK_ARP: SourceInfo = {
  system: "MikroTik",
  path: "/ip/arp",
  via: "REST GET /rest/ip/arp?address=<session.address>",
  fields: ["address", "mac-address", "interface"],
};

const MIKROTIK_DHCP_LEASE: SourceInfo = {
  system: "MikroTik",
  path: "/ip/dhcp-server/lease",
  via: "REST GET /rest/ip/dhcp-server/lease?address=<session.address>",
  fields: ["address", "mac-address", "server", "status"],
};

// verified: diagnostics.service.ts line 341
const MIKROTIK_ADDRESS_LIST: SourceInfo = {
  system: "MikroTik",
  path: "/ip/firewall/address-list",
  via: "REST GET /rest/ip/firewall/address-list",
  fields: ["list", "address", "disabled"],
};

// verified: diagnostics.service.ts line 277
const MIKROTIK_CONNTRACK: SourceInfo = {
  system: "MikroTik",
  path: "/ip/firewall/connection/tracking",
  via: "REST GET /rest/ip/firewall/connection/tracking",
  fields: ["enabled", "total-entries", "max-entries"],
};

// verified: diagnostics.service.ts line 348 (FIREWALL_TABLES: filter, raw, nat, mangle)
const MIKROTIK_FW_FILTER: SourceInfo = {
  system: "MikroTik",
  path: "/ip/firewall/filter",
  via: "REST GET /rest/ip/firewall/filter",
  fields: ["chain", "action", "src-address", "dst-address", "src-address-list", "dst-address-list", "bytes", "packets", "disabled", "comment"],
};

const MIKROTIK_FW_RAW: SourceInfo = {
  system: "MikroTik",
  path: "/ip/firewall/raw",
  via: "REST GET /rest/ip/firewall/raw",
  fields: ["chain", "action", "src-address", "dst-address", "bytes", "packets", "disabled"],
};

const MIKROTIK_FW_NAT: SourceInfo = {
  system: "MikroTik",
  path: "/ip/firewall/nat",
  via: "REST GET /rest/ip/firewall/nat",
  fields: ["chain", "action", "src-address", "dst-address", "dst-port", "to-addresses", "to-ports", "protocol", "disabled", "bytes", "packets"],
};

const MIKROTIK_FW_MANGLE: SourceInfo = {
  system: "MikroTik",
  path: "/ip/firewall/mangle",
  via: "REST GET /rest/ip/firewall/mangle",
  fields: ["chain", "action", "new-connection-mark", "new-packet-mark", "bytes", "packets"],
};

// verified: diagnostics.service.ts line 349-357 (props: { ".proplist": "fasttrack,connection-mark,protocol" })
const MIKROTIK_FW_CONNECTION: SourceInfo = {
  system: "MikroTik",
  path: "/ip/firewall/connection",
  via: "REST GET /rest/ip/firewall/connection?src-address=<session.address>&.proplist=fasttrack,connection-mark,protocol",
  fields: ["fasttrack", "connection-mark", "protocol"],
};

// verified: diagnostics.service.ts line 251 (readLog)
const MIKROTIK_LOG: SourceInfo = {
  system: "MikroTik",
  path: "/log",
  via: "REST GET /rest/log",
  fields: ["time", "topics", "message"],
};

// verified: diagnostics.service.ts line 330, 334
const MIKROTIK_PPPOE_SERVER_BINDING: SourceInfo = {
  system: "MikroTik",
  path: "/interface/pppoe-server",
  via: "REST GET /rest/interface/pppoe-server?name=<pppoe-interface>",
  fields: ["name", "interface", "user", "service"],
};

const MIKROTIK_VLAN_DEF: SourceInfo = {
  system: "MikroTik",
  path: "/interface/vlan",
  via: "REST GET /rest/interface/vlan?name=<vlanName>",
  fields: ["name", "interface"],
};

// --- Database Tables (src/db/schema/*.ts) ---
// verified: src/db/schema/customer-traffic-samples.ts
const DB_CUSTOMER_TRAFFIC_SAMPLES: SourceInfo = {
  system: "Database",
  path: "customer_traffic_samples",
  via: "SQL: customer_traffic_samples",
  fields: ["customer_id", "bucket_start", "samples", "download_mbps_avg", "upload_mbps_avg", "download_mbps_max", "upload_mbps_max", "download_bytes", "upload_bytes"],
};

// verified: src/db/schema/traffic-samples.ts
const DB_TRAFFIC_SAMPLES: SourceInfo = {
  system: "Database",
  path: "traffic_samples",
  via: "SQL: traffic_samples",
  fields: ["router_id", "sampled_at", "rx_mbps", "tx_mbps"],
};

// verified: src/db/schema/netflow-samples.ts & backend/internal/netflow/
const DB_NETFLOW_SAMPLES: SourceInfo = {
  system: "NetFlow",
  path: "netflow_samples",
  via: "NetFlow v5 (UDP 2055) / SQL: netflow_samples",
  fields: ["customer_id", "direction", "src_ip", "dst_ip", "dst_port", "protocol", "bytes", "packets", "flows", "captured_at"],
};

// verified: src/db/schema/syslog-events.ts
const DB_SYSLOG_EVENTS: SourceInfo = {
  system: "Syslog",
  path: "syslog_events",
  via: "Syslog UDP listener / SQL: syslog_events",
  fields: ["router_id", "received_at", "facility", "severity", "topics", "message"],
};

// verified: src/db/schema/billing-status.ts
const DB_BILLING_STATUS: SourceInfo = {
  system: "Billing",
  path: "billing_status",
  via: "SQL: billing_status / Sync API RunsNet",
  fields: ["customer_id", "status", "invoice_ref", "synced_at"],
};

// verified: src/db/schema/runsnet-billing.ts
const DB_RUNSNET_INVOICES: SourceInfo = {
  system: "Billing",
  path: "runsnet_invoices",
  via: "SQL: runsnet_invoices / RunsNet Invoices API",
  fields: ["cust_id", "invoice_code", "due_date", "amount", "status"],
};

// verified: src/db/schema/billing-mismatches.ts
const DB_BILLING_MISMATCHES: SourceInfo = {
  system: "Database",
  path: "billing_mismatches",
  via: "SQL: billing_mismatches",
  fields: ["run_id", "invoice_name", "invoice_ref", "invoice_status", "reason", "customer_ids", "created_at"],
};

// verified: src/db/schema/firewall-snapshots.ts
const DB_FIREWALL_SNAPSHOTS: SourceInfo = {
  system: "Database",
  path: "firewall_snapshots",
  via: "SQL: firewall_snapshots",
  fields: ["run_id", "router_id", "customer_id", "taken_at", "customer_ip", "fasttrack_active", "conntrack_count", "conntrack_total", "conntrack_max", "raw_drop_matched", "address_list_matched"],
};

// verified: src/db/schema/diagnostics.ts (diagnosticFindings)
const DB_DIAGNOSTIC_FINDINGS: SourceInfo = {
  system: "Database",
  path: "diagnostic_findings",
  via: "SQL: diagnostic_findings",
  fields: ["run_id", "layer", "metric", "label", "value", "threshold", "comparator", "status", "detail", "source_ref", "sampled_at", "checked_at"],
};

// verified: src/db/schema/olt-onus.ts & backend/internal/olt/
const OLT_ONUS: SourceInfo = {
  system: "OLT",
  path: "olt_onus",
  via: "OLT Poller (HSGQ REST/Telnet) / SQL: olt_onus",
  fields: ["id", "olt_id", "pon_index", "onu_index", "customer_id", "rx_power", "tx_power", "attenuation", "status", "captured_at"],
};

// verified: GenieACS Client
const GENIEACS_DEVICES: SourceInfo = {
  system: "GenieACS",
  path: "/devices",
  via: "GenieACS NBI REST GET /devices (TR-069 data model)",
  fields: ["_id", "_lastInform", "InternetGatewayDevice.DeviceInfo.UpTime", "InternetGatewayDevice.WANDevice.*", "InternetGatewayDevice.LANDevice.*.Hosts.HostNumberOfEntries"],
};

/** Sumber angka "Gangguan per pelanggan" (src/lib/customer-incidents.ts); kolom = yang dibaca src/services/customer-incidents.service.ts. */
export const incidentSources: SourceInfo[] = [
  {
    system: "Database",
    path: "customer_connection_events",
    via: "SQL: customer_connection_events (ditulis backend Go OnlineWriter)",
    fields: ["customer_id", "kind", "occurred_at", "source"],
  },
  {
    system: "Database",
    path: "customer_traffic_samples",
    via: "SQL: customer_traffic_samples (bucket 5 menit queue pelanggan)",
    fields: ["customer_id", "bucket_start", "samples", "download_mbps_avg"],
  },
];

// ---------------------------------------------------------------------------
// 5 Anomaly Kinds Single Source of Truth
// ---------------------------------------------------------------------------

export const anomalyKindInfo: Record<
  AnomalyKind,
  {
    explain: string;
    sources: SourceInfo[];
    rule: string;
  }
> = {
  queue: {
    rule: "Pemakaian antrean di atas 95% selama 30 detik",
    explain:
      "Memantau pemakaian bandwidth pada simple queue pelanggan. Penggunaan di atas ambang 95% selama 30 detik menandakan antrean penuh sehingga pelanggan berisiko mengalami pelambatan atau packet drop.",
    sources: [MIKROTIK_QUEUE_POLLER, DB_CUSTOMER_TRAFFIC_SAMPLES],
  },
  cpu: {
    rule: "CPU router di atas 85% selama 3 menit",
    explain:
      "Memantau utilisasi beban prosesor (CPU load) router utama. Beban di atas 85% selama 3 menit menandakan prosesor kelebihan beban yang memicu lonjakan latensi, antrean paket tertahan, dan kegagalan proses rute.",
    sources: [MIKROTIK_SYSTEM_RESOURCE],
  },
  port: {
    rule: "Error interface naik lebih dari 20 per menit",
    explain:
      "Memantau kenaikan counter error dan packet drop pada interface fisik router. Kenaikan > 20 error per menit mengindikasikan gangguan fisik seperti kabel LAN/fiber tertekuk, modul SFP rusak, atau frame CRC korup.",
    sources: [MIKROTIK_INTERFACE_POLLER],
  },
  optical: {
    rule: "Rx ONU di bawah -25 dBm (bukan CCQ)",
    explain:
      "Memantau kekuatan daya terima optik (Rx Power) pada modem ONU/ONT pelanggan dari OLT. Nilai di bawah -25 dBm menandakan redaman kabel fiber optik terlalu tinggi dan berisiko putus permanen.",
    sources: [OLT_ONUS],
  },
  offline: {
    rule: "Pelanggan terputus lebih dari 30 detik",
    explain:
      "Mendeteksi hilangnya sesi PPPoE aktif pelanggan di router MikroTik selama lebih dari 30 detik. Jeda 30 detik memisahkan gangguan fisik nyata dari sekadar restart modem atau fluktuasi sesaat.",
    sources: [MIKROTIK_PPP_ACTIVE_POLLER, DB_SYSLOG_EVENTS],
  },
};

// ---------------------------------------------------------------------------
// Diagnostic Layers Single Source of Truth
// ---------------------------------------------------------------------------

const LAYER_INFO_MAP: Record<string, { explain: string; sources: SourceInfo[] }> = {
  hulu: {
    explain:
      "Memeriksa jalur keluar router ke jaringan upstream (ISP/transit), mencakup default route, utilisasi fisik antarmuka uplink, latensi ke gateway dan internet global, riwayat beban 24 jam, status peer BGP, serta kesiapan IPv6.",
    sources: [
      MIKROTIK_IP_ROUTE,
      MIKROTIK_INTERFACE_SERVICE,
      MIKROTIK_ETHERNET_MONITOR,
      MIKROTIK_PING_PROBE,
      DB_TRAFFIC_SAMPLES,
      DB_CUSTOMER_TRAFFIC_SAMPLES,
      MIKROTIK_BGP_CONN,
      MIKROTIK_BGP_SESS,
      MIKROTIK_IPV6_ADDR,
      MIKROTIK_IPV6_ROUTE,
      MIKROTIK_IPV6_BINDING,
    ],
  },
  mikrotik: {
    explain:
      "Memeriksa status sesi PPPoE pelanggan di router, konfigurasi batas kecepatan (simple queue), pemakaian bandwidth real-time, paket dibuang (drop), error antarmuka PPPoE, laju jalur VLAN PON, dan potensi bentrok IP pada tabel ARP/DHCP.",
    sources: [
      MIKROTIK_PPP_ACTIVE_SERVICE,
      MIKROTIK_QUEUE_SERVICE,
      MIKROTIK_INTERFACE_SERVICE,
      MIKROTIK_PPPOE_SERVER_BINDING,
      MIKROTIK_VLAN_DEF,
      MIKROTIK_ARP,
      MIKROTIK_DHCP_LEASE,
    ],
  },
  log: {
    explain:
      "Menganalisis riwayat rekaman log MikroTik pada jendela waktu keluhan untuk mendeteksi flapping sesi PPPoE, penolakan autentikasi, kegagalan alokasi IP, link jalur down, bentrok alamat, dan aksi firewall.",
    sources: [MIKROTIK_LOG],
  },
  firewall: {
    explain:
      "Memeriksa isolir atau blokir pada address-list, kapasitas connection tracking global, rule filter drop, rule raw no-track, translasi source NAT (masquerade), port forward (dst-nat), bypass fasttrack, koneksi aktif per pelanggan, mangle marking, dan rule usang.",
    sources: [
      MIKROTIK_ADDRESS_LIST,
      MIKROTIK_CONNTRACK,
      MIKROTIK_FW_FILTER,
      MIKROTIK_FW_RAW,
      MIKROTIK_FW_NAT,
      MIKROTIK_FW_CONNECTION,
      MIKROTIK_FW_MANGLE,
      DB_FIREWALL_SNAPSHOTS,
    ],
  },
  optik: {
    explain:
      "Memeriksa daya terima optik (Rx Power) ONU pelanggan pada OLT (Optical Line Terminal). Nilai normal berada pada rentang -24 s.d. -8 dBm.",
    sources: [OLT_ONUS],
  },
  ont: {
    explain:
      "Memeriksa kondisi modem ONT pelanggan dari protokol manajemen TR-069 melalui GenieACS, mencakup waktu laporan terakhir (inform), status dialer WAN PPPoE, uptime perangkat, jumlah klien terhubung, dan pembacaan sinyal optik internal modem.",
    sources: [GENIEACS_DEVICES],
  },
  trafik: {
    explain:
      "Memeriksa tren volume trafik pelanggan terhadap baseline kebiasaan jam yang sama selama 7 hari, serta menganalisis sampel NetFlow untuk melihat tujuan teratas, perbandingan arah unggah/unduh, dan pola koneksi P2P.",
    sources: [DB_CUSTOMER_TRAFFIC_SAMPLES, DB_NETFLOW_SAMPLES],
  },
  aktif: {
    explain:
      "Menjalankan pengujian proaktif langsung dari router saat diagnosa berlangsung (ping ke IP pelanggan, traceroute multi-hop upstream, resolusi DNS) dan membandingkan pemakaian p95 14 hari terhadap kapasitas paket.",
    sources: [MIKROTIK_PING_CUSTOMER, MIKROTIK_PING_DNS, MIKROTIK_TRACEROUTE, DB_CUSTOMER_TRAFFIC_SAMPLES],
  },
  billing: {
    explain:
      "Memeriksa status administratif pelanggan pada sistem billing (Aktif/Isolir), faktur tagihan yang lewat jatuh tempo, keselarasan status billing dengan kondisi jaringan, serta ketidaksesuaian data isolir.",
    sources: [DB_BILLING_STATUS, DB_RUNSNET_INVOICES, DB_BILLING_MISMATCHES],
  },
};

export function layerInfo(layer: string): { explain: string; sources: SourceInfo[] } {
  return (
    LAYER_INFO_MAP[layer] ?? {
      explain: "Lapisan diagnosa belum terdaftar dalam katalog sumber sistem.",
      sources: [],
    }
  );
}

// ---------------------------------------------------------------------------
// Metric Registry
// ---------------------------------------------------------------------------

const METRIC_REGISTRY: Record<string, Record<string, MetricInfo>> = {
  hulu: {
    default_route: {
      title: "Default Route & Link Uplink",
      explain:
        "Status rute keluar default gateway upstream dan kondisi antarmuka fisik uplink (running, kecepatan negosiasi). Memastikan router memiliki gateway aktif yang dapat dijangkau.",
      sources: [MIKROTIK_IP_ROUTE, MIKROTIK_INTERFACE_SERVICE, MIKROTIK_ETHERNET_MONITOR],
    },
    uplink_util: {
      title: "Utilisasi Bandwidth Uplink",
      explain:
        "Persentase pemakaian bandwidth pada antarmuka uplink saat pengujian. Nilai di atas ambang 80% mengindikasikan kapasitas uplink hampir penuh sehingga berpotensi menimbulkan kongesti.",
      sources: [MIKROTIK_INTERFACE_SERVICE],
    },
    upstream_gateway: {
      title: "Kualitas Hop Gateway ISP",
      explain:
        "Pengukuran latensi (RTT) dan packet loss dari router ke IP gateway hop pertama ISP penyedia. RTT tinggi atau packet loss menandakan kendala pada link transmisi ke upstream penyedia.",
      sources: [MIKROTIK_PING_PROBE],
    },
    upstream_internet: {
      title: "Kualitas Akses Internet Global",
      explain:
        `Pengukuran latensi dan packet loss dari router ke tujuan probe internet (INTERNET_PROBE, saat ini ${INTERNET_PROBE}). Membedakan apakah kelambatan terjadi di jaringan lokal/gateway ISP atau di interkoneksi transit internet.`,
      sources: [MIKROTIK_PING_PROBE],
    },
    uplink_history: {
      title: "Riwayat Utilisasi Uplink 24 Jam",
      explain:
        "Grafik beban trafik puncak dan rata-rata antarmuka uplink selama 24 jam terakhir dari database. Menilai apakah waktu keluhan bertepatan dengan jam sibuk (peak hours) jaringan.",
      sources: [DB_TRAFFIC_SAMPLES, DB_CUSTOMER_TRAFFIC_SAMPLES],
    },
    contention: {
      title: "Rasio Kontensi & Beban Berbagi",
      explain:
        "Perbandingan pemakaian bandwidth pelanggan terhadap total pemakaian uplink di waktu yang sama. Menilai apakah kelambatan disebabkan oleh perebutan kapasitas (contention) dengan pengguna lain.",
      sources: [DB_TRAFFIC_SAMPLES, DB_CUSTOMER_TRAFFIC_SAMPLES],
    },
    bgp: {
      title: "Status Sesi BGP Peer",
      explain:
        "Kondisi sesi Border Gateway Protocol (BGP) ke upstream peer. Sesi yang down atau sering flap menyebabkan tabel rute internet hilang atau trafik dialihkan secara mendadak.",
      sources: [MIKROTIK_BGP_CONN, MIKROTIK_BGP_SESS],
    },
    ipv6: {
      title: "Alamat & Rute IPv6 Pelanggan",
      explain:
        "Status alokasi alamat global IPv6, default route IPv6, dan binding DHCPv6 prefix delegation. Menilai kesiapan konektivitas dual-stack IPv6 pelanggan.",
      sources: [MIKROTIK_IPV6_ADDR, MIKROTIK_IPV6_ROUTE, MIKROTIK_IPV6_BINDING],
    },
    ringkasan: {
      title: "Ringkasan Jalur Hulu",
      explain:
        "Status kelengkapan pembacaan rute default, utilitas uplink, BGP, dan IPv6 pada router. Ditampilkan bila router tidak terjangkau atau gagal membaca jalur hulu secara menyeluruh.",
      sources: [MIKROTIK_IP_ROUTE, MIKROTIK_INTERFACE_SERVICE],
    },
    pelanggan_terganggu: {
      title: "Dampak Gangguan Massal Hulu",
      explain:
        "Jumlah pelanggan lain pada router yang sama yang turut mengalami gangguan akibat masalah bersama di lapisan hulu.",
      sources: [DB_DIAGNOSTIC_FINDINGS],
    },
  },

  mikrotik: {
    pppoe_active: {
      title: "Sesi PPPoE Aktif",
      explain:
        "Memverifikasi apakah akun PPPoE pelanggan sedang tersambung aktif di router MikroTik. Jika tidak ada di daftar sesi aktif, koneksi fisik atau autentikasi pelanggan terputus.",
      sources: [MIKROTIK_PPP_ACTIVE_SERVICE],
    },
    queue_limit: {
      title: "Batas Kecepatan Simple Queue",
      explain:
        "Konfigurasi batas kecepatan unduh dan unggah (max-limit) pada simple queue pelanggan. Memastikan profile queue aktif dan sesuai paket langganan.",
      sources: [MIKROTIK_QUEUE_SERVICE],
    },
    queue_usage: {
      title: "Pemakaian Bandwidth terhadap Batas",
      explain:
        "Persentase pemakaian kecepatan real-time terhadap batas maksimal paket langganan. Nilai di atas 95% menandakan bandwidth pelanggan sedang terpakai penuh.",
      sources: [MIKROTIK_QUEUE_SERVICE],
    },
    queue_drop: {
      title: "Paket Dibuang pada Antrean (Queue Drop)",
      explain:
        "Jumlah dan persentase paket yang dibuang oleh router akibat trafik pelanggan melebihi kapasitas antrean bandwidth. Drop tinggi memicu retransmisi TCP dan kelambatan koneksi.",
      sources: [MIKROTIK_QUEUE_SERVICE],
    },
    iface_errors: {
      title: "Error & Drop Antarmuka PPPoE",
      explain:
        "Penghitung error fisik/CRC dan paket drop pada antarmuka virtual PPPoE pelanggan. Nilai di atas 0 menunjukkan gangguan framing PPP atau kendala transmisi.",
      sources: [MIKROTIK_INTERFACE_SERVICE],
    },
    pon_vlan_rate: {
      title: "Utilisasi Jalur VLAN PON",
      explain:
        "Laju trafik gabungan pada antarmuka VLAN PON yang menghubungkan router ke OLT. Memastikan kapasitas uplink port PON tidak mengalami kepadatan (congestion).",
      sources: [MIKROTIK_PPPOE_SERVER_BINDING, MIKROTIK_INTERFACE_SERVICE, MIKROTIK_VLAN_DEF],
    },
    ip_conflict: {
      title: "Bentrok Alamat IP (ARP/DHCP)",
      explain:
        "Memeriksa adanya alamat IP ganda pada tabel ARP atau lease DHCP di router. Bentrok alamat menyebabkan koneksi terputus-putus atau paket salah sasaran.",
      sources: [MIKROTIK_ARP, MIKROTIK_DHCP_LEASE],
    },
    sesi_detail: {
      title: "Detail Sesi MikroTik",
      explain:
        "Evaluasi mendalam sesi aktif (queue, error interface, VLAN PON, dan ARP). Ditampilkan bila sesi pelanggan offline sehingga detail antrean dan antarmuka dinamis tidak dapat dibaca.",
      sources: [MIKROTIK_PPP_ACTIVE_SERVICE],
    },
  },

  log: {
    log_coverage: {
      title: "Cakupan Jendela Log",
      explain:
        "Rentang waktu rekaman log router yang tersedia untuk dianalisis. Log harus mencakup setidaknya 1 jam sebelum keluhan pelanggan terjadi.",
      sources: [MIKROTIK_LOG],
    },
    ppp_flap: {
      title: "Sesi PPPoE Putus (Flapping)",
      explain:
        "Frekuensi sesi PPPoE terputus pada log router. Flapping berulang mengindikasikan masalah kabel optik, modem restart, atau gangguan catu daya.",
      sources: [MIKROTIK_LOG],
    },
    ppp_no_address: {
      title: "Sesi Tanpa Alamat IP",
      explain:
        "Kejadian router gagal memberikan IP address ke sesi PPPoE pelanggan. Terjadi bila pool IP habis atau atribut RADIUS tidak lengkap.",
      sources: [MIKROTIK_LOG],
    },
    ppp_auth_fail: {
      title: "Login PPPoE Ditolak",
      explain:
        "Upaya login PPPoE yang gagal karena username atau password salah, atau akun dinonaktifkan.",
      sources: [MIKROTIK_LOG],
    },
    link_flap: {
      title: "Link Antarmuka Turun (Link Down)",
      explain:
        "Kejadian antarmuka fisik atau VLAN jalur pelanggan terputus (down) pada log router.",
      sources: [MIKROTIK_LOG],
    },
    addr_conflict: {
      title: "Bentrok Alamat di Log",
      explain:
        "Peringatan bentrok alamat IP atau MAC address pelanggan yang tercatat dalam log router.",
      sources: [MIKROTIK_LOG],
    },
    firewall_log: {
      title: "Log Pemblokiran Firewall",
      explain:
        "Catatan rule firewall yang menandai atau memblokir paket milik IP pelanggan pada periode diagnosa.",
      sources: [MIKROTIK_LOG],
    },
    log_noise: {
      title: "Baris Log Rutin yang Disaring",
      explain:
        "Jumlah baris log operasional biasa yang disaring agar fokus pada kejadian penting yang berhubungan dengan keluhan.",
      sources: [MIKROTIK_LOG],
    },
  },

  firewall: {
    address_list: {
      title: "Address-List Firewall Pelanggan",
      explain:
        "Memeriksa apakah IP pelanggan terdaftar dalam address-list isolir, penalti, atau blokir keamanan di router.",
      sources: [MIKROTIK_ADDRESS_LIST],
    },
    conntrack: {
      title: "Kapasitas Connection Tracking Global",
      explain:
        "Persentase pemakaian tabel connection tracking router. Utilisasi di atas 85% berisiko menyebabkan router menolak pembukaan koneksi baru.",
      sources: [MIKROTIK_CONNTRACK],
    },
    filter_block: {
      title: "Rule Firewall Filter Pemblokir",
      explain:
        "Mendeteksi rule filter firewall beraksi drop atau reject yang mencocokkan trafik IP pelanggan.",
      sources: [MIKROTIK_FW_FILTER],
    },
    raw: {
      title: "Rule Firewall Raw (Drop & No-Track)",
      explain:
        "Mendeteksi rule raw firewall yang membuang paket atau mematikan pelacakan sebelum connection tracking.",
      sources: [MIKROTIK_FW_RAW],
    },
    nat_src: {
      title: "NAT Keluar (Masquerade / Source NAT)",
      explain:
        "Memastikan paket dari IP pelanggan ditranslasikan dengan benar (masquerade/src-nat) agar dapat berkomunikasi ke internet publik.",
      sources: [MIKROTIK_FW_NAT],
    },
    nat_dst: {
      title: "Port Forward & Redirect (Destination NAT)",
      explain:
        "Memeriksa konfigurasi port forwarding (dst-nat) dan mendeteksi adanya konflik port yang diarahkan ke pelanggan.",
      sources: [MIKROTIK_FW_NAT],
    },
    fasttrack: {
      title: "Bypass Fasttrack terhadap Simple Queue",
      explain:
        "Mendeteksi apakah koneksi pelanggan terkena rule fasttrack-connection yang membypass perhitungan simple queue.",
      sources: [MIKROTIK_FW_FILTER, MIKROTIK_FW_CONNECTION],
    },
    conntrack_customer: {
      title: "Jumlah Koneksi Aktif Pelanggan",
      explain:
        "Jumlah total koneksi jaringan aktif milik pelanggan di tabel connection tracking. Koneksi sangat tinggi (> 1.000) menandakan indikasi P2P, botnet, atau malware.",
      sources: [MIKROTIK_FW_CONNECTION],
    },
    mangle: {
      title: "Rule Mangle & Connection Mark",
      explain:
        "Memeriksa keselarasan packet mark antara rule mangle dengan simple queue pelanggan agar alokasi kuota dan prioritas berjalan semestinya.",
      sources: [MIKROTIK_FW_MANGLE],
    },
    rule_stale: {
      title: "Rule Firewall Khusus Tanpa Trafik",
      explain:
        "Mendeteksi rule firewall khusus pelanggan yang tidak pernah mengalami peningkatan counter hit (rule usang yang tertinggal).",
      sources: [MIKROTIK_FW_FILTER, MIKROTIK_FW_NAT],
    },
    ringkasan: {
      title: "Ringkasan Firewall & NAT",
      explain:
        "Status pengumpulan tabel firewall, NAT, dan koneksi aktif pelanggan di router MikroTik.",
      sources: [MIKROTIK_FW_FILTER],
    },
    audit: {
      title: "Audit Snapshot Firewall",
      explain:
        "Pencatatan riwayat snapshot konfigurasi firewall pelanggan ke database untuk kepatuhan dan audit investigasi.",
      sources: [DB_FIREWALL_SNAPSHOTS],
    },
  },

  optik: {
    onu_rx: {
      title: "Daya Sinyal Optik ONU (Rx Power)",
      explain:
        "Kekuatan sinyal optik yang diterima oleh ONU pelanggan dari OLT. Rentang normal berada di antara -24 dBm hingga -8 dBm; sinyal di bawah -25 dBm menyebabkan redaman tinggi dan drop koneksi.",
      sources: [OLT_ONUS],
    },
  },

  ont: {
    ont_found: {
      title: "Registrasi Modem di GenieACS",
      explain:
        "Memverifikasi apakah modem ONT pelanggan terdaftar dan dapat dihubungi melalui sistem manajemen TR-069 GenieACS.",
      sources: [GENIEACS_DEVICES],
    },
    ont_inform: {
      title: "Laporan Terakhir Modem (Last Inform)",
      explain:
        "Waktu kontak terakhir modem ONT ke server GenieACS. Selang waktu lebih dari 60 menit menandakan modem mati atau kehilangan rute manajemen.",
      sources: [GENIEACS_DEVICES],
    },
    ont_wan: {
      title: "Status WAN PPPoE di Modem",
      explain:
        "Status antarmuka WAN PPPoE langsung dari sisi modem (Connected/Disconnected) melalui parameter TR-069.",
      sources: [GENIEACS_DEVICES],
    },
    ont_uptime: {
      title: "Uptime Modem ONT",
      explain:
        "Lamanya modem menyala tanpa restart. Uptime di bawah 10 menit menunjukkan modem baru saja reboot akibat listrik mati atau adaptor rusak.",
      sources: [GENIEACS_DEVICES],
    },
    ont_hosts: {
      title: "Perangkat Klien Terhubung ke Modem",
      explain:
        "Jumlah perangkat pengguna (ponsel, komputer, TV) yang tersambung ke port LAN atau Wi-Fi modem pelanggan.",
      sources: [GENIEACS_DEVICES],
    },
    ont_rx: {
      title: "Daya Optik Sisi Modem ONT",
      explain:
        "Nilai daya terima optik yang diukur oleh sensor internal modem ONT, dicocokkan dengan pembacaan di OLT untuk memastikan tidak ada selisih redaman besar.",
      sources: [GENIEACS_DEVICES],
    },
  },

  trafik: {
    traffic_trend: {
      title: "Tren Trafik vs Baseline Kebiasaan",
      explain:
        "Membandingkan konsumsi bandwidth 30 menit terakhir dengan pola historis jam yang sama selama 7 hari terakhir untuk mendeteksi penurunan drastis atau lonjakan abnormal.",
      sources: [DB_CUSTOMER_TRAFFIC_SAMPLES],
    },
    netflow_top: {
      title: "Tujuan Teratas Trafik (NetFlow Top Destinations)",
      explain:
        "Identifikasi host tujuan dan aplikasi yang mengonsumsi proporsi bandwidth terbesar dari sampel NetFlow pelanggan.",
      sources: [DB_NETFLOW_SAMPLES],
    },
    netflow_direction: {
      title: "Keseimbangan Arah Trafik (Unggah vs Unduh)",
      explain:
        "Perbandingan volume unduh terhadap unggah. Proporsi unggah yang sangat dominan mengindikasikan aktivitas seeding torrent, CCTV online, atau transmisi file besar.",
      sources: [DB_NETFLOW_SAMPLES],
    },
    netflow_peers: {
      title: "Banyak Lawan Trafik Kecil (Pola P2P/Torrent)",
      explain:
        "Mendeteksi sebaran koneksi ke banyak host lawan kecil secara simultan, ciri khas aplikasi peer-to-peer (P2P) yang dapat memenuhi kapasitas router.",
      sources: [DB_NETFLOW_SAMPLES],
    },
  },

  aktif: {
    ping_customer: {
      title: "Ping Langsung ke IP Pelanggan",
      explain:
        "Uji latensi dan packet loss dari router MikroTik langsung ke IP pelanggan secara real-time. Memastikan konektivitas segmen lokal router-modem bebas hambatan.",
      sources: [MIKROTIK_PING_CUSTOMER],
    },
    traceroute_upstream: {
      title: "Traceroute ke Upstream Internet",
      explain:
        `Pelacakan rute hop-by-hop dari router menuju tujuan probe internet (INTERNET_PROBE, saat ini ${INTERNET_PROBE}) untuk mendeteksi hop yang mengalami lonjakan latensi atau rute terputus.`,
      sources: [MIKROTIK_TRACEROUTE],
    },
    dns_resolve: {
      title: "Resolusi Domain DNS",
      explain:
        `Menguji kecepatan dan keberhasilan router dalam menyelesaikan nama domain internet (${DNS_PROBE_NAME}). Kegagalan DNS menyebabkan website tidak dapat dibuka meski link terhubung.`,
      sources: [MIKROTIK_PING_DNS],
    },
    rate_baseline: {
      title: "Baseline Pemakaian & Kapasitas Paket",
      explain:
        "Statistik pemakaian bandwidth persentil ke-95 (p95) selama 14 hari dibandingkan dengan kapasitas langganan pelanggan.",
      sources: [DB_CUSTOMER_TRAFFIC_SAMPLES],
    },
    rate_unused: {
      title: "Pemanfaatan Kapasitas Paket",
      explain:
        "Menilai utilisasi paket berlangganan. Jika pemakaian puncak (p95) di bawah 30% dari kapasitas paket, pelanggan belum memanfaatkan kuota kecepatan secara optimal.",
      sources: [DB_CUSTOMER_TRAFFIC_SAMPLES],
    },
  },

  billing: {
    billing_status: {
      title: "Status Layanan di Billing",
      explain:
        "Status administratif akun pelanggan di sistem billing (Aktif/Isolir). Memastikan langganan terdaftar aktif dan tidak terisolir akibat administrasi.",
      sources: [DB_BILLING_STATUS],
    },
    arrears: {
      title: "Tagihan Lewat Jatuh Tempo (Tunggakan)",
      explain:
        "Memeriksa faktur tagihan pelanggan yang sudah melewati batas waktu jatuh tempo pembayaran.",
      sources: [DB_RUNSNET_INVOICES],
    },
    billing_network: {
      title: "Keselarasan Status Billing dengan Jaringan",
      explain:
        "Memverifikasi keselarasan status billing dengan kondisi teknis jaringan di router (misalnya akun isolir yang masih memiliki koneksi internet aktif).",
      sources: [DB_BILLING_STATUS, MIKROTIK_PPP_ACTIVE_SERVICE, MIKROTIK_ADDRESS_LIST],
    },
    billing_mismatch: {
      title: "Ketidaksesuaian Billing (Billing Mismatch)",
      explain:
        "Audit ketidaksinkronan data pelanggan antara catatan operasional dan tagihan billing eksternal.",
      sources: [DB_BILLING_MISMATCHES],
    },
  },
};

// Common derived-only indicators (tanpa pembacaan hardware langsung)
// shortcut: metrik status runtime agregat tidak memerlukan entri hardware terpisah
const COMMON_DERIVED_METRICS: Record<string, Omit<MetricInfo, "sources">> = {
  belum_diperiksa: {
    title: "Pemeriksaan Belum Diperiksa",
    explain:
      "Pemeriksaan pada lapisan ini belum dijalankan atau baru akan diimplementasikan pada fase berikutnya.",
  },
  galat: {
    title: "Galat Pemeriksaan Lapisan",
    explain:
      "Terjadi kesalahan teknis atau timeout koneksi saat sistem mencoba membaca data diagnosa pada lapisan ini.",
  },
  kosong: {
    title: "Data Diagnosa Kosong",
    explain:
      "Tidak ada data metrik atau sampel yang berhasil dikumpulkan untuk dievaluasi pada lapisan diagnosa ini.",
  },
};

/**
 * Mengambil informasi judul, penjelasan, dan sumber data dari satu metrik diagnosa.
 * Tidak pernah melempar error; metrik yang tidak dikenal mengembalikan entri generik
 * dengan sources=[] agar UI dapat menampilkan label 'sumber belum terdaftar'.
 */
export function metricInfo(layer: string, metric: string): MetricInfo {
  const layerMap = METRIC_REGISTRY[layer];
  if (layerMap && layerMap[metric]) {
    return layerMap[metric];
  }

  // Cek metrik derived umum (belum_diperiksa, galat, kosong)
  if (COMMON_DERIVED_METRICS[metric]) {
    return {
      title: COMMON_DERIVED_METRICS[metric].title,
      explain: COMMON_DERIVED_METRICS[metric].explain,
      sources: [],
    };
  }

  // Fallback generik bila metrik belum terdaftar
  const humanTitle = metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    title: humanTitle,
    explain: `Metrik ini belum memiliki deskripsi terdaftar dalam peta sumber diagnosa (${layer}.${metric}).`,
    sources: [],
  };
}
