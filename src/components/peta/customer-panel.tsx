"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  X,
  Wifi,
  Radio,
  Receipt,
  MapPin,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronLeft,
  Router,
  Bell,
  Cable,
  Activity,
  Gauge,
  Zap,
} from "lucide-react";
import {
  CableSegment,
  CustomerDetail,
  CustomerTraffic,
  MapCustomer,
  MapDevice,
} from "@/services/map/types";
import {
  customerDrop,
  lossBudget,
  upstreamPath,
} from "@/services/map/loss-budget";
import { LossBudgetView } from "./loss-budget-view";
import { DeviceBadge } from "./device-badge";
import { COORD_ERROR, parseCoordinates } from "./coords";
import { toPoint, type TrafficPoint } from "./traffic";
import { bitRate, byteSize, TrafficChart } from "./traffic-chart";

interface CustomerPanelProps {
  customer: MapCustomer;
  subPanel: "detail" | "cpe" | "onu" | "billing" | null;
  onSubPanelChange: (panel: "detail" | "cpe" | "onu" | "billing") => void;
  onClose: () => void;
  onUpdateCoordinates: (
    id: string,
    lat: number,
    lng: number,
    odpId?: string,
  ) => Promise<void>;
  /** Semua perangkat peta (ODP pilihan + nama titik di jalur kabel) */
  devices: MapDevice[];
  /** Semua segmen kabel, untuk menghitung jarak kabel ke pelanggan */
  segments: CableSegment[];
  /** Draft koordinat (null = tidak sedang mengubah). Dibagi dua arah dengan peta. */
  coordDraft: { lat: string; lng: string } | null;
  onCoordDraftChange: (draft: { lat: string; lng: string } | null) => void;
}

const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const dateTime = (v: string | number | null | undefined) =>
  v == null || v === ""
    ? "-"
    : new Date(v).toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      });
const date = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("id-ID", { dateStyle: "medium" }) : "-";
const dbm = (v: number | null | undefined) =>
  v == null ? "-" : `${v.toFixed(2)} dBm`;
const meters = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;

const CHART_POINTS = 300; // 5 menit pada 1 sampel/detik

function Row({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between items-start gap-3 py-1 border-b border-border/50 last:border-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span
        className={`font-medium text-foreground text-right break-all ${mono ? "font-mono" : ""}`}
      >
        {children ?? "-"}
      </span>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="p-3 rounded-xl bg-muted/30 border border-border space-y-1">
      <h4 className="font-medium text-foreground flex items-center gap-1.5 pb-1">
        {icon}
        {title}
      </h4>
      {children}
    </section>
  );
}

const Muted = ({ children }: { children: ReactNode }) => (
  <p className="text-[11px] text-muted-foreground">{children}</p>
);

export function CustomerPanel({
  customer,
  subPanel = "detail",
  onSubPanelChange,
  onClose,
  onUpdateCoordinates,
  devices,
  segments,
  coordDraft,
  onCoordDraftChange,
}: CustomerPanelProps) {
  // Pelanggan dilayani ODP, atau langsung dari port ODC
  const servers = devices.filter((d) => d.type === "odp" || d.type === "odc");
  const [odpId, setOdpId] = useState(customer.odpId ?? "");
  const server = servers.find((d) => d.id === customer.odpId);
  const isEditingCoord = coordDraft !== null;
  const lat = coordDraft?.lat ?? "";
  const lng = coordDraft?.lng ?? "";
  const setLat = (v: string) => onCoordDraftChange({ lat: v, lng });
  const setLng = (v: string) => onCoordDraftChange({ lat, lng: v });
  const setIsEditingCoord = (on: boolean) =>
    onCoordDraftChange(
      on
        ? {
            lat: customer.latitude?.toFixed(6) || "",
            lng: customer.longitude?.toFixed(6) || "",
          }
        : null,
    );
  const [savingCoord, setSavingCoord] = useState(false);
  const [coordError, setCoordError] = useState<string | null>(null);

  // Rincian dari aplikasi pusat; panel di-key per pelanggan jadi cukup dimuat sekali
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [detailState, setDetailState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  useEffect(() => {
    let alive = true;
    fetch(`/api/peta/customers/${encodeURIComponent(customer.id)}/detail`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body: { data: CustomerDetail | null } = await res.json();
        if (alive) {
          setDetail(body.data);
          setDetailState("ready");
        }
      })
      .catch(() => alive && setDetailState("error"));
    return () => {
      alive = false;
    };
  }, [customer.id]);

  // Trafik live tiap 1 detik. Permintaan berikutnya baru jalan setelah yang sebelumnya selesai,
  // jadi tidak menumpuk/terbalik urutan saat router lambat. Dilewati saat tab tidak terlihat.
  const [traffic, setTraffic] = useState<CustomerTraffic | null | undefined>(
    undefined,
  );
  const [trafficError, setTrafficError] = useState(false);
  const [history, setHistory] = useState<TrafficPoint[]>([]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let prev: CustomerTraffic | null = null;
    const load = async () => {
      const started = Date.now();
      if (!document.hidden) {
        try {
          const res = await fetch(
            `/api/peta/customers/${encodeURIComponent(customer.id)}/traffic`,
          );
          if (!res.ok) throw new Error();
          const body: { data: CustomerTraffic | null } = await res.json();
          if (!alive) return;
          setTraffic(body.data);
          setTrafficError(false);
          // Field rate MikroTik baru berganti tiap beberapa detik; selisih byte berubah tiap detik
          const point = body.data && toPoint(prev, body.data);
          prev = body.data;
          if (point)
            setHistory((h) => [...h.slice(-(CHART_POINTS - 1)), point]);
        } catch {
          if (alive) setTrafficError(true);
        }
      }
      if (alive)
        timer = setTimeout(load, Math.max(0, 1000 - (Date.now() - started)));
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [customer.id]);

  const cpe = detail?.cpe ?? null;
  const onu = detail?.onu ?? null;
  const activeAlerts =
    detail?.alerts.filter((a) => a.status !== "resolved") ?? [];
  const debt =
    detail?.invoices
      .filter((i) => i.status !== "paid")
      .reduce((sum, i) => sum + i.remainingAmount, 0) ?? 0;
  const ssid = cpe?.wifi?.ssid || customer.cpeSsid;
  const clientCount = cpe?.wifi?.clientCount ?? customer.cpeHosts;
  const rx = onu?.rxPower ?? cpe?.rxDbm ?? customer.opticalPower ?? null;
  // Jalur fisik: kabel drop (atau garis lurus dari ODP) lalu naik ke OLT
  const drop = customerDrop(customer, devices, segments);
  const path = drop ? upstreamPath(drop.odp.id, devices, segments) : null;
  const budget = drop && path ? lossBudget(path, drop) : null;
  const cable =
    drop && path
      ? {
          dropM: drop.lengthM,
          dropEstimated: drop.estimated,
          totalM:
            drop.lengthM + path.links.reduce((sum, l) => sum + l.lengthM, 0),
          totalEstimated: drop.estimated || path.links.some((l) => l.estimated),
          hops: path.nodes.map((d) => d.name),
        }
      : null;

  // Status badge styling
  const renderStatusBadge = (status: MapCustomer["status"]) => {
    switch (status) {
      case "terhubung":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" /> Terhubung
          </span>
        );
      case "isolir":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <AlertTriangle className="w-3 h-3" /> Isolir
          </span>
        );
      case "loss":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-500 border border-rose-500/20">
            <XCircle className="w-3 h-3" /> Loss / Gangguan
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
            Offline
          </span>
        );
    }
  };

  const handleSaveCoords = async (e: React.FormEvent) => {
    e.preventDefault();
    setCoordError(null);
    const coords = parseCoordinates(lat, lng);
    if (!coords) {
      setCoordError(COORD_ERROR);
      return;
    }

    try {
      setSavingCoord(true);
      await onUpdateCoordinates(
        customer.id,
        coords.lat,
        coords.lng,
        odpId || undefined,
      );
      setIsEditingCoord(false);
    } catch (err: unknown) {
      setCoordError(
        err instanceof Error ? err.message : "Gagal memperbarui posisi.",
      );
    } finally {
      setSavingCoord(false);
    }
  };

  const loadingNote =
    detailState === "loading" ? (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" /> Memuat data dari NOC...
      </p>
    ) : detailState === "error" ? (
      <p className="text-[11px] text-destructive">
        Gagal memuat rincian dari data NOC. Data di bawah hanya ringkasan peta.
      </p>
    ) : detail && detail.unavailable.length > 0 ? (
      <p className="text-[11px] text-amber-500">
        Sebagian data tidak tersedia: {detail.unavailable.join(", ")}.
      </p>
    ) : null;

  const alertSection = (
    <Section
      icon={<Bell className="w-3.5 h-3.5 text-rose-500" />}
      title={`Alert${activeAlerts.length ? ` (${activeAlerts.length} aktif)` : ""}`}
    >
      {detail && detail.alerts.length > 0 ? (
        <ul className="space-y-1.5">
          {detail.alerts.map((a) => {
            const active = a.status !== "resolved";
            return (
              <li
                key={a.id}
                className={`p-2 rounded-lg border ${
                  active
                    ? a.severity === "critical"
                      ? "border-rose-500/30 bg-rose-500/10"
                      : "border-amber-500/30 bg-amber-500/10"
                    : "border-border/60"
                }`}
              >
                <div className="flex justify-between gap-2">
                  <span className="font-medium text-foreground">{a.title}</span>
                  <span
                    className={`text-[10px] uppercase ${
                      active
                        ? "text-rose-500 font-semibold"
                        : "text-muted-foreground"
                    }`}
                  >
                    {active ? "aktif" : "selesai"} • {a.severity}
                  </span>
                </div>
                {a.message && <Muted>{a.message}</Muted>}
                <Muted>
                  {dateTime(a.startedAt)}
                  {a.endedAt ? ` s/d ${dateTime(a.endedAt)}` : ""}
                </Muted>
              </li>
            );
          })}
        </ul>
      ) : (
        <Muted>{detailState === "ready" ? "Tidak ada alert." : "-"}</Muted>
      )}
    </Section>
  );

  const connectionSection = (
    <Section
      icon={<Activity className="w-3.5 h-3.5 text-emerald-500" />}
      title="Status Koneksi"
    >
      <Row label="Status">{renderStatusBadge(customer.status)}</Row>
      <Row label="Modem (CPE)">
        {cpe ? (cpe.isOnline ? "Online" : "Offline") : "-"}
      </Row>
      <Row label="Uptime modem">{cpe?.uptimeText || "-"}</Row>
      <Row label="Terakhir lapor ACS">
        {cpe?.lastInformAt ? dateTime(cpe.lastInformAt * 1000) : "-"}
      </Row>
      <Row label="ONU">
        {customer.onuStatus
          ? customer.onuStatus === "online"
            ? "Online"
            : "Offline"
          : "-"}
      </Row>
      <Row label="Data diperbarui">{dateTime(detail?.lastUpdatedAt)}</Row>
    </Section>
  );

  const rateBar = (label: string, bps: number, max: number, color: string) => (
    <div className="py-1">
      <div className="flex justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold text-foreground">
          {bitRate(bps)}
          {max > 0 && (
            <span className="text-muted-foreground font-normal">
              {" "}
              / {bitRate(max)}
            </span>
          )}
        </span>
      </div>
      {max > 0 && (
        <div className="h-1.5 mt-1 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full ${color} transition-[width] duration-500`}
            style={{ width: `${Math.min(100, (bps / max) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );

  const trafficSection = (
    <Section
      icon={<Gauge className="w-3.5 h-3.5 text-cyan-500" />}
      title="Trafik Live"
    >
      {traffic ? (
        <>
          <TrafficChart points={history} />
          {rateBar(
            "Download",
            history.at(-1)?.down ?? traffic.downloadBps,
            traffic.maxDownloadBps,
            "bg-blue-400",
          )}
          {rateBar(
            "Upload",
            history.at(-1)?.up ?? traffic.uploadBps,
            traffic.maxUploadBps,
            "bg-orange-400",
          )}
          <Row label="Pemakaian sesi ini">
            ↓ {byteSize(traffic.downloadBytes)} • ↑{" "}
            {byteSize(traffic.uploadBytes)}
          </Row>
          <Muted>
            Dihitung dari penghitung byte simple queue MikroTik tiap 1 detik (5
            menit terakhir). Pemakaian dihitung sejak sesi PPPoE terakhir
            tersambung.
          </Muted>
        </>
      ) : (
        <Muted>
          {trafficError
            ? "Gagal membaca trafik dari router."
            : traffic === null
              ? "Sesi PPPoE tidak aktif, tidak ada trafik."
              : "Memuat trafik..."}
        </Muted>
      )}
    </Section>
  );

  const wifiSection = (
    <Section
      icon={<Wifi className="w-3.5 h-3.5 text-blue-500" />}
      title="Wi-Fi & Perangkat Terhubung"
    >
      <Row label="Nama Wi-Fi (SSID)">{ssid || "-"}</Row>
      <Row label="Wi-Fi aktif">
        {cpe?.wifi ? (cpe.wifi.enabled ? "Ya" : "Tidak") : "-"}
      </Row>
      <Row label="Keamanan">{cpe?.wifi?.security || "-"}</Row>
      <Row label="Frekuensi">{cpe?.wifi?.radioFrequency || "-"}</Row>
      <Row label="Klien Wi-Fi">
        {clientCount != null ? `${clientCount} perangkat` : "-"}
      </Row>
      {cpe && cpe.hosts.length > 0 ? (
        <ul className="pt-1 space-y-1">
          {cpe.hosts.map((h, i) => (
            <li
              key={`${h.ip}-${i}`}
              className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-background/60 border border-border/60"
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`w-2 h-2 shrink-0 rounded-full ${h.active ? "bg-emerald-500" : "bg-zinc-400"}`}
                  title={h.active ? "Aktif" : "Tidak aktif"}
                />
                <span className="truncate text-foreground">
                  {h.hostname || "(tanpa nama)"}
                </span>
              </span>
              <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                {h.ip} • {h.interfaceType.replace(/_/g, " ")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Muted>Belum ada daftar perangkat terhubung.</Muted>
      )}
    </Section>
  );

  const modemSection = (
    <Section
      icon={<Router className="w-3.5 h-3.5 text-sky-500" />}
      title="Modem (CPE)"
    >
      {cpe ? (
        <>
          <Row label="Model">
            {`${cpe.manufacturer} ${cpe.model}`.trim() || "-"}
          </Row>
          <Row label="Nomor seri" mono>
            {cpe.serialNumber || "-"}
          </Row>
          <Row label="Firmware">{cpe.softwareVersion || "-"}</Row>
          <Row label="IP WAN" mono>
            {cpe.wanIp || "-"}
          </Row>
          <Row label="IP LAN" mono>
            {cpe.lanIp || customer.cpeIp || "-"}
          </Row>
          <Row label="MAC" mono>
            {cpe.macAddress || "-"}
          </Row>
          <Row label="Suhu modul optik">
            {cpe.temperatureC != null
              ? `${cpe.temperatureC.toFixed(1)} °C`
              : "-"}
          </Row>
        </>
      ) : (
        <Muted>
          {detailState === "loading"
            ? "-"
            : "Modem pelanggan tidak ditemukan di GenieACS."}
        </Muted>
      )}
    </Section>
  );

  const onuSection = (
    <Section
      icon={<Radio className="w-3.5 h-3.5 text-purple-500" />}
      title="Optik ONU"
    >
      <div className="flex items-center justify-between py-1 border-b border-border/50">
        <span className="text-muted-foreground">Redaman (Rx)</span>
        <span className="flex items-center gap-2">
          <span className="font-bold font-mono text-foreground">{dbm(rx)}</span>
          {rx != null &&
            (rx <= -15 && rx >= -24 ? (
              <span className="text-[10px] font-medium text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-full border border-emerald-500/20">
                Ideal
              </span>
            ) : (
              <span className="text-[10px] font-medium text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full border border-amber-500/20">
                Peringatan
              </span>
            ))}
        </span>
      </div>
      <Row label="Tx">{dbm(onu?.txPower ?? cpe?.txDbm)}</Row>
      <Row label="Atenuasi">
        {onu?.attenuation != null ? `${onu.attenuation.toFixed(2)} dB` : "-"}
      </Row>
      <Row label="Nomor seri ONU" mono>
        {onu?.serialNumber || customer.onuSerial || "-"}
      </Row>
      <Row label="Model ONU">{onu?.model || "-"}</Row>
      <Row label="Keterangan OLT">{onu?.description || "-"}</Row>
      <Row label="Port OLT">{customer.onuLocation || "-"}</Row>
      <Row label="Dibaca">{dateTime(onu?.capturedAt)}</Row>
    </Section>
  );

  const billingSection = (
    <Section
      icon={<Receipt className="w-3.5 h-3.5 text-emerald-500" />}
      title="Tagihan"
    >
      <Row label="Status pembayaran">
        <span className="capitalize">{customer.billingStatus || "-"}</span>
      </Row>
      <Row label="Status langganan">{detail?.billing?.status || "-"}</Row>
      <Row label="Jenis">{detail?.billing?.type || "-"}</Row>
      <Row label="Tanggal aktif">{date(detail?.billing?.activeDate)}</Row>
      <Row label="Jatuh tempo">{detail?.billing?.expiredDate || "-"}</Row>
      <Row label="Tunggakan">
        <span className={debt > 0 ? "text-rose-500" : ""}>{rupiah(debt)}</span>
      </Row>

      <p className="pt-2 text-[11px] font-medium text-foreground">
        Invoice terakhir
      </p>
      {detail && detail.invoices.length > 0 ? (
        <ul className="space-y-1">
          {detail.invoices.map((inv) => (
            <li
              key={inv.invoiceCode}
              className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-background/60 border border-border/60"
            >
              <span className="min-w-0">
                <span className="block text-foreground">
                  {new Date(inv.periode).toLocaleDateString("id-ID", {
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                <span className="block font-mono text-[10px] text-muted-foreground">
                  {inv.invoiceCode} • tempo {date(inv.dueDate)}
                </span>
              </span>
              <span className="text-right shrink-0">
                <span className="block font-medium text-foreground">
                  {rupiah(inv.amount)}
                </span>
                <span
                  className={`block text-[10px] ${inv.status === "paid" ? "text-emerald-500" : "text-rose-500"}`}
                >
                  {inv.status === "paid"
                    ? "Lunas"
                    : `Sisa ${rupiah(inv.remainingAmount)}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Muted>Belum ada invoice.</Muted>
      )}

      <p className="pt-2 text-[11px] font-medium text-foreground">
        Pembayaran terakhir
      </p>
      {detail && detail.payments.length > 0 ? (
        <ul className="space-y-1">
          {detail.payments.map((p) => (
            <li
              key={p.paymentCode}
              className="flex justify-between gap-2 text-[11px]"
            >
              <span className="text-muted-foreground">
                {date(p.payDate)} • {p.method || "-"}
              </span>
              <span className="font-medium text-foreground">
                {rupiah(p.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Muted>Belum ada pembayaran.</Muted>
      )}
    </Section>
  );

  const serviceSection = (
    <Section
      icon={<Receipt className="w-3.5 h-3.5 text-primary" />}
      title="Layanan & Alamat"
    >
      <Row label="Paket layanan">
        {customer.packagePlan || detail?.billing?.serviceProfile || "-"}
      </Row>
      <Row label="Tarif bulanan">
        {customer.monthlyFee != null
          ? rupiah(customer.monthlyFee)
          : detail?.invoices[0]
            ? `${rupiah(detail.invoices[0].amount)} (invoice terakhir)`
            : "-"}
      </Row>
      <Row label="Username PPPoE" mono>
        {customer.customerNumber}
      </Row>
      <Row label="Wilayah">{customer.region || "-"}</Row>
      <div className="py-1">
        <span className="text-muted-foreground block mb-0.5">Alamat</span>
        <span className="text-foreground leading-relaxed">
          {customer.address || "-"}
        </span>
      </div>
    </Section>
  );

  const cableSection = (
    <Section
      icon={<Cable className="w-3.5 h-3.5 text-orange-500" />}
      title="Jarak Kabel"
    >
      {cable ? (
        <>
          <Row label={`Kabel drop (${drop?.odp.type.toUpperCase()} ke rumah)`}>
            {cable.dropEstimated
              ? `± ${meters(cable.dropM)} (garis lurus)`
              : meters(cable.dropM)}
          </Row>
          {cable.hops.length > 1 && (
            <Row label={`Total dari ${cable.hops[0]}`}>
              {cable.totalEstimated
                ? `± ${meters(cable.totalM)}`
                : meters(cable.totalM)}
            </Row>
          )}
          <Muted>{[...cable.hops, customer.name].join(" → ")}</Muted>
          {cable.totalEstimated && (
            <Muted>
              Sebagian kabel belum digambar; jarak asli biasanya lebih panjang.
            </Muted>
          )}
        </>
      ) : (
        <Muted>Belum ada jalur kabel yang tersambung ke pelanggan ini.</Muted>
      )}
    </Section>
  );

  const lossSection = (
    <Section
      icon={<Zap className="w-3.5 h-3.5 text-amber-500" />}
      title="Hitungan Redaman"
    >
      {budget ? (
        <LossBudgetView
          budget={budget}
          resultLabel="Perkiraan Rx ONU"
          measuredRx={rx}
        />
      ) : (
        <Muted>Hubungkan pelanggan ke ODP dulu untuk menghitung redaman.</Muted>
      )}
    </Section>
  );

  return (
    <aside
      aria-label="Panel Detail Pelanggan"
      className="fixed inset-x-0 bottom-0 md:bottom-auto md:top-[calc(var(--map-toolbar-bottom,4rem)_+_0.5rem)] md:right-4 md:left-auto z-[1050] md:max-w-[min(28rem,50vw)] w-full bg-card/95 backdrop-blur-md text-card-foreground border border-border shadow-2xl rounded-t-2xl md:rounded-2xl max-h-[60dvh] md:max-h-[calc(100dvh_-_var(--map-toolbar-bottom,4rem)_-_1.5rem)] flex flex-col overflow-hidden animate-in fade-in slide-in-from-right-4 duration-200"
    >
      {/* Header Panel */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2">
          {subPanel && subPanel !== "detail" ? (
            <button
              onClick={() => onSubPanelChange("detail")}
              className="p-1 -ml-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Kembali ke detail"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
              PEL
            </div>
          )}
          <div>
            <h3 className="font-semibold text-sm text-foreground line-clamp-1">
              {customer.name}
            </h3>
            <p className="text-[11px] font-mono text-muted-foreground">
              {customer.customerNumber}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {renderStatusBadge(customer.status)}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Konten Lapis 1: Detail Pelanggan Utama */}
      {(!subPanel || subPanel === "detail") && (
        <div className="p-4 overflow-y-auto space-y-4 text-xs">
          {/* Tab Pintasan Bertumpuk (Level 2) */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => onSubPanelChange("cpe")}
              className="flex flex-col items-center justify-center p-2 rounded-xl border border-border bg-muted/30 hover:bg-muted text-foreground transition-colors gap-1 text-center"
            >
              <Wifi className="w-4 h-4 text-blue-500" />
              <span className="font-medium text-[11px] line-clamp-1">
                {ssid || "CPE Wi-Fi"}
              </span>
              <span className="text-[9px] text-muted-foreground">
                {clientCount != null ? `${clientCount} Terhubung` : "-"}
              </span>
            </button>

            <button
              onClick={() => onSubPanelChange("onu")}
              className="flex flex-col items-center justify-center p-2 rounded-xl border border-border bg-muted/30 hover:bg-muted text-foreground transition-colors gap-1 text-center"
            >
              <Radio className="w-4 h-4 text-purple-500" />
              <span className="font-medium text-[11px]">Optik ONU</span>
              <span className="text-[9px] text-muted-foreground">
                {dbm(rx)}
              </span>
            </button>

            <button
              onClick={() => onSubPanelChange("billing")}
              className="flex flex-col items-center justify-center p-2 rounded-xl border border-border bg-muted/30 hover:bg-muted text-foreground transition-colors gap-1 text-center"
            >
              <Receipt className="w-4 h-4 text-emerald-500" />
              <span className="font-medium text-[11px]">Tagihan</span>
              <span
                className={`text-[9px] capitalize ${debt > 0 ? "text-rose-500" : "text-muted-foreground"}`}
              >
                {debt > 0
                  ? `Tunggak ${rupiah(debt)}`
                  : customer.billingStatus || "-"}
              </span>
            </button>
          </div>

          {loadingNote}
          {activeAlerts.length > 0 && alertSection}
          {connectionSection}
          {trafficSection}
          {wifiSection}
          {modemSection}
          {onuSection}
          {billingSection}
          {serviceSection}
          {cableSection}
          {lossSection}
          {activeAlerts.length === 0 && alertSection}

          {/* Koreksi Posisi & Koordinat */}
          <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-primary" />
                Titik & ODP/ODC
              </span>
              {!isEditingCoord && (
                <button
                  onClick={() => {
                    setOdpId(customer.odpId ?? "");
                    setIsEditingCoord(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground font-medium text-[11px] hover:opacity-90"
                >
                  Pilih titik & ODP/ODC
                </button>
              )}
            </div>

            {isEditingCoord ? (
              <form onSubmit={handleSaveCoords} className="space-y-2 pt-1">
                <p className="text-[11px] text-primary font-medium">
                  Klik peta di lokasi pelanggan untuk menaruh titik.
                </p>
                <label className="block">
                  <span className="text-[10px] text-muted-foreground block mb-0.5">
                    Terhubung ke ODP, atau langsung ke ODC
                  </span>
                  <select
                    value={odpId}
                    onChange={(e) => setOdpId(e.target.value)}
                    className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
                  >
                    <option value="">-- Pilih ODP / ODC --</option>
                    {(["odp", "odc"] as const).map((t) => (
                      <optgroup key={t} label={t.toUpperCase()}>
                        {servers
                          .filter((d) => d.type === t)
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                {coordError && (
                  <p className="text-[11px] text-destructive">{coordError}</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-0.5">
                      Lat
                    </label>
                    <input
                      type="text"
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-0.5">
                      Lng
                    </label>
                    <input
                      type="text"
                      value={lng}
                      onChange={(e) => setLng(e.target.value)}
                      className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsEditingCoord(false)}
                    className="px-2.5 py-1 rounded text-muted-foreground hover:bg-muted"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={savingCoord}
                    className="px-3 py-1 rounded bg-primary text-primary-foreground font-medium flex items-center gap-1"
                  >
                    {savingCoord && (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    )}
                    Simpan
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-0.5 text-[11px]">
                <p className="font-mono text-muted-foreground">
                  {customer.latitude != null && customer.longitude != null
                    ? `${customer.latitude.toFixed(6)}, ${customer.longitude.toFixed(6)}`
                    : "Belum ada titik."}
                </p>
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  {server ? (
                    <>
                      <DeviceBadge type={server.type} />
                      {server.type.toUpperCase()}:
                      <span className="text-foreground font-medium">
                        {server.name}
                      </span>
                      {customer.odpPort != null && (
                        <span className="font-mono">
                          • Port {customer.odpPort}
                        </span>
                      )}
                    </>
                  ) : (
                    "ODP/ODC: belum terhubung"
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Konten Lapis 2: bagian yang sama, dibuka sendiri dari tombol pintasan */}
      {subPanel && subPanel !== "detail" && (
        <div className="p-4 overflow-y-auto space-y-4 text-xs animate-in fade-in duration-150">
          {loadingNote}
          {subPanel === "cpe" && (
            <>
              {wifiSection}
              {modemSection}
            </>
          )}
          {subPanel === "onu" && (
            <>
              {onuSection}
              {lossSection}
            </>
          )}
          {subPanel === "billing" && billingSection}
        </div>
      )}
    </aside>
  );
}
