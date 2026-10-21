import "server-only";
import { and, asc, desc, eq, max, or } from "drizzle-orm";
import { db } from "@/db";
import {
  cableRoutes,
  cableSegmentSamples,
  cableSegments,
  mapCustomers as customers,
  mapLayers,
  mapOverrides,
  mapDevices as networkDevices,
} from "@/db/schema";
import { fetchCpe, fetchDataset, fetchRouterQueues, fetchSnap, fetchVlanTraffic } from "./client";
import { generateSegmentSamples } from "./geo";
import { customerPortCount, portCount, SPLITTER_RATIOS, TAP_RATIOS } from "./loss-budget";

// shortcut: ambang Rx ONU lemah tetap -27 dBm (sensitivitas EPON PX20); jadikan per model ONU bila perlu
const ONU_RX_WEAK_DBM = -27;
import { chainEndDeviceId, createsCycle, oltPonCount, renameForType, routePon } from "./topology";
import { created as createdRow, saveUndo, snapshot } from "./undo";
import {
  CentralBillingCustomer,
  CentralCable,
  CentralCustomer,
  CentralInfrastructure,
  CentralOlt,
  CentralOnu,
  CentralPonPort,
  mapCentralData,
  mergeMapData,
} from "./central-mapper";
import {
  AnnotationShape,
  LayerNotFoundError,
  MapLayerItem,
  CableRoute,
  CableSegment,
  CableSegmentSample,
  ClassifiedCentralApiError,
  CustomerDetail,
  CustomerTraffic,
  MapCustomer,
  OltDetail,
  OltRange,
  MapDataResponse,
  MapDevice,
} from "./types";

// Jarak antar titik sampel jalur dan radius tempel ke jalan (dulu env aplikasi peta)
export const ROUTE_SAMPLE_INTERVAL_M = 50;
export const SNAP_TOLERANCE_M = 30;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const routeNotFound = () =>
  new ClassifiedCentralApiError(
    "NOT_FOUND",
    "Jalur kabel tidak ditemukan di data lokal. Jalur lama dari data NOC hanya-baca; buat jalur baru di peta.",
    404,
  );
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const customerNotFound = () =>
  new ClassifiedCentralApiError("NOT_FOUND", "Pelanggan tidak ditemukan.", 404);
const deviceNotFound = () =>
  new ClassifiedCentralApiError("NOT_FOUND", "Perangkat tidak ditemukan.", 404);

async function insertSamples(
  tx: Tx,
  segmentId: string,
  samples: Omit<CableSegmentSample, "id" | "segmentId">[],
) {
  if (samples.length === 0) return [];
  return await tx
    .insert(cableSegmentSamples)
    .values(
      samples.map((s) => ({
        segmentId,
        sequence: s.sequence,
        latitude: s.latitude,
        longitude: s.longitude,
        cumulativeM: s.cumulativeM,
      })),
    )
    .returning();
}

// total_length_m = jumlah length_m seluruh segmen (nilai turunan, bukan masukan)
async function recomputeRouteTotal(tx: Tx, routeId: string): Promise<number> {
  const rows = await tx
    .select({ lengthM: cableSegments.lengthM })
    .from(cableSegments)
    .where(eq(cableSegments.routeId, routeId));
  const total = Math.round(rows.reduce((sum, s) => sum + s.lengthM, 0) * 10) / 10;
  await tx
    .update(cableRoutes)
    .set({ totalLengthM: total, updatedAt: new Date() })
    .where(eq(cableRoutes.id, routeId));
  return total;
}

export class MapDataAdapter {
  // Di NOC data pusat selalu tersedia; "local-db" tersisa dari aplikasi peta mandiri.
  static getDataSource(): "central-api" | "local-db" {
    return "central-api";
  }

  // Ambil semua data peta untuk dirender di kanvas Leaflet
  static async getMapData(): Promise<MapDataResponse> {
    const source = this.getDataSource();
    const local = await this.getLocalData();
    const lastUpdated = new Date().toISOString();
    if (source !== "central-api") {
      return { ...local, source: "local-db", lastUpdated };
    }

    // API key hanya menarik data; semua yang dibuat/diubah di peta tinggal di DB lokal
    const overrides = await db.select().from(mapOverrides);
    const oltLinks = new Map(
      overrides
        .filter((o) => o.entityType === "device" && o.centralOltId)
        .map((o) => [o.entityId, o.centralOltId!]),
    );

    let central: ReturnType<typeof mapCentralData>;
    try {
      const [
        customers,
        infrastructure,
        cables,
        onus,
        olts,
        ponPorts,
        billingCustomers,
      ] = await Promise.all([
        fetchDataset<CentralCustomer>("customers"),
        fetchDataset<CentralInfrastructure>("network-infrastructure"),
        fetchDataset<CentralCable>("network-cables"),
        fetchDataset<CentralOnu>("olt-onus"),
        fetchDataset<CentralOlt>("olts"),
        fetchDataset<CentralPonPort>("olt-pon-ports"),
        fetchDataset<CentralBillingCustomer>("runsnet-customers"),
      ]);
      central = mapCentralData(
        {
          customers,
          infrastructure,
          cables,
          onus,
          olts,
          ponPorts,
          billingCustomers,
        },
        ROUTE_SAMPLE_INTERVAL_M,
        oltLinks,
      );
    } catch (err) {
      if (err instanceof ClassifiedCentralApiError) {
        throw err;
      }
      throw new ClassifiedCentralApiError(
        "UPSTREAM_ERROR",
        "Gagal memuat data peta dari database NOC.",
        502,
      );
    }

    return {
      ...mergeMapData(central, local, overrides),
      source: "central-api",
      lastUpdated,
    };
  }

  // Data yang dibuat di aplikasi ini (PostgreSQL lokal via Drizzle)
  private static async getLocalData() {
    const rawCustomers = await db
      .select()
      .from(customers)
      .orderBy(asc(customers.name));

    const rawDevices = await db
      .select()
      .from(networkDevices)
      .orderBy(asc(networkDevices.name));

    const rawRoutes = await db
      .select()
      .from(cableRoutes)
      .orderBy(desc(cableRoutes.createdAt));

    const rawSegments = await db
      .select()
      .from(cableSegments)
      .orderBy(asc(cableSegments.sequence));

    const rawSamples = await db
      .select()
      .from(cableSegmentSamples)
      .orderBy(asc(cableSegmentSamples.sequence));
    const samplesBySegment = new Map<string, CableSegmentSample[]>();
    for (const sm of rawSamples) {
      const list = samplesBySegment.get(sm.segmentId);
      if (list) list.push(sm);
      else samplesBySegment.set(sm.segmentId, [sm]);
    }

    // Petakan status pelanggan ke sambungan
    const customerStatusMap = new Map<string, string>();
    const mappedCustomers: MapCustomer[] = rawCustomers.map((c) => {
      customerStatusMap.set(c.id, c.status);
      return {
        id: c.id,
        name: c.name,
        customerNumber: c.customerNumber,
        address: c.address,
        region: c.region,
        status: (c.status as MapCustomer["status"]) || "unknown",
        billingStatus:
          (c.billingStatus as MapCustomer["billingStatus"]) || "unknown",
        latitude: c.latitude,
        longitude: c.longitude,
        packagePlan: c.packagePlan ?? null,
        monthlyFee: c.monthlyFee ?? null,
        opticalPower: c.opticalPower ?? undefined,
        onuSerial: c.onuSerial ?? undefined,
        cpeSsid: c.cpeSsid ?? undefined,
        cpeIp: c.cpeIp ?? undefined,
        cpeHosts: c.cpeHosts ?? 0,
        odpId: c.odpId,
        odpPort: c.odpPort,
      };
    });

    const mappedDevices: MapDevice[] = rawDevices.map((d) => ({
      id: d.id,
      name: d.name,
      type: (d.type as MapDevice["type"]) || "odp",
      latitude: d.latitude,
      longitude: d.longitude,
      capacity: d.capacity,
      status: (d.status as MapDevice["status"]) || "normal",
      parentDeviceId: d.parentDeviceId,
      notes: d.notes,
      splitterRatio: d.splitterRatio,
      splitterTap: d.splitterTap,
      // Nama OLT operasional diambil dari pusat saat rincian OLT dimuat
      centralOlt: d.centralOltId ? { id: d.centralOltId, name: "" } : undefined,
      odcPort: d.odcPort,
      connectedCustomersCount: mappedCustomers.filter((c) => c.odpId === d.id)
        .length,
    }));

    const mappedRoutes: CableRoute[] = rawRoutes.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      cableType: r.cableType,
      fiberCapacity: r.fiberCapacity,
      fromDeviceId: r.fromDeviceId,
      toDeviceId: r.toDeviceId,
      samplingIntervalM: r.samplingIntervalM,
      totalLengthM: r.totalLengthM,
      createdAt: r.createdAt.toISOString(),
      color: r.color,
    }));

    const mappedSegments: CableSegment[] = rawSegments.map((s) => {
      let connStatus: CableSegment["connectionStatus"] = "unknown";
      if (s.customerId) {
        const cStat = customerStatusMap.get(s.customerId);
        if (cStat === "isolir") connStatus = "isolir";
        else if (cStat === "loss") connStatus = "loss";
        else if (cStat === "terhubung") connStatus = "terhubung";
      }

      return {
        id: s.id,
        routeId: s.routeId,
        fromDeviceId: s.fromDeviceId,
        toDeviceId: s.toDeviceId,
        customerId: s.customerId,
        sequence: s.sequence,
        geometry: s.geometry || [],
        lengthM: s.lengthM,
        snapped: s.snapped,
        snapProvider: s.snapProvider,
        snapToleranceM: s.snapToleranceM,
        snappedAt: s.snapped && s.snappedAt ? s.snappedAt.toISOString() : null,
        connectionStatus: connStatus,
        samples: samplesBySegment.get(s.id) ?? [],
      };
    });

    return {
      customers: mappedCustomers,
      devices: mappedDevices,
      routes: mappedRoutes,
      segments: mappedSegments,
    };
  }

  // Rincian lengkap satu pelanggan pusat: modem/WiFi, ONU, billing, invoice, pembayaran, alert.
  // Dataset pusat belum bisa difilter, jadi ditarik utuh lalu disaring di sini (ukurannya ribuan baris).
  static async getCustomerDetail(id: string): Promise<CustomerDetail | null> {
    if (this.getDataSource() !== "central-api" || (await this.isLocal("customer", id))) {
      return null; // pelanggan lokal: panel memakai kolom tabel lokal
    }
    const customer = (
      await fetchDataset<CentralCustomer & { lastUpdatedAt?: string | null }>("customers")
    ).find((c) => c.id === id);
    if (!customer) throw customerNotFound();
    const username = customer.pppoeUsername;
    const custId = username.split("@")[0];

    const parts = {
      cpe: fetchCpe<{ data?: (NonNullable<CustomerDetail["cpe"]> & {
        pppoeUsername: string;
        optical?: { rxDbm: number | null; txDbm: number | null; temperatureC: number | null };
      })[] }>(username),
      onu: fetchDataset<CentralOnu & Record<string, unknown>>("olt-onus"),
      billing: fetchDataset<Record<string, unknown>>("runsnet-customers"),
      invoices: fetchDataset<Record<string, unknown>>("runsnet-invoices"),
      payments: fetchDataset<Record<string, unknown>>("runsnet-payments"),
      alerts: fetchDataset<Record<string, unknown>>("alerts"),
    };
    const names = Object.keys(parts) as (keyof typeof parts)[];
    const settled = await Promise.allSettled(Object.values(parts));
    const ok = <K extends keyof typeof parts>(k: K) => {
      const r = settled[names.indexOf(k)];
      return r.status === "fulfilled" ? (r.value as Awaited<(typeof parts)[K]>) : null;
    };
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    const num = (v: unknown) => (typeof v === "number" ? v : 0);

    const cpe = ok("cpe")?.data?.find((d) => d.pppoeUsername === username);
    const onu = ok("onu")?.find((o) => o.customerId === id);
    const billing = ok("billing")?.find((b) => String(b.custId) === custId);
    const desc = (k: string) => (a: Record<string, unknown>, b: Record<string, unknown>) =>
      String(b[k] ?? "").localeCompare(String(a[k] ?? ""));

    return {
      lastUpdatedAt: customer.lastUpdatedAt ?? null,
      cpe: cpe
        ? {
            model: cpe.model,
            manufacturer: cpe.manufacturer,
            serialNumber: cpe.serialNumber,
            softwareVersion: cpe.softwareVersion,
            isOnline: cpe.isOnline,
            uptimeText: cpe.uptimeText,
            wanIp: cpe.wanIp,
            lanIp: cpe.lanIp,
            macAddress: cpe.macAddress,
            lastInformAt: cpe.lastInformAt ?? null,
            rxDbm: cpe.optical?.rxDbm ?? null,
            txDbm: cpe.optical?.txDbm ?? null,
            temperatureC: cpe.optical?.temperatureC ?? null,
            wifi: cpe.wifi ?? null,
            hosts: cpe.hosts ?? [],
          }
        : null,
      onu: onu
        ? {
            model: str(onu.model),
            serialNumber: onu.serialNumber,
            description: str(onu.description),
            rxPower: onu.rxPower,
            txPower: typeof onu.txPower === "number" ? onu.txPower : null,
            attenuation: typeof onu.attenuation === "number" ? onu.attenuation : null,
            status: onu.status,
            capturedAt: str(onu.capturedAt),
          }
        : null,
      billing: billing
        ? {
            serviceProfile: str(billing.serviceProfile),
            type: str(billing.type),
            activeDate: str(billing.activeDate),
            expiredDate: str(billing.expiredDate),
            connectivity: str(billing.connectivity),
            status: str(billing.status),
          }
        : null,
      invoices: (ok("invoices") ?? [])
        .filter((i) => String(i.custId) === custId)
        .sort(desc("periode"))
        .slice(0, 6)
        .map((i) => ({
          invoiceCode: String(i.invoiceCode),
          periode: String(i.periode),
          dueDate: str(i.dueDate),
          amount: num(i.amount),
          remainingAmount: num(i.remainingAmount),
          status: String(i.status),
        })),
      payments: (ok("payments") ?? [])
        .filter((p) => String(p.custId) === custId)
        .sort(desc("payDate"))
        .slice(0, 6)
        .map((p) => ({
          paymentCode: String(p.paymentCode),
          payDate: String(p.payDate),
          amount: num(p.amount),
          method: str(p.method),
        })),
      // Alert aktif dulu, lalu yang terbaru
      alerts: (ok("alerts") ?? [])
        .filter((a) => a.customerId === id)
        .sort((a, b) =>
          Number(b.status !== "resolved") - Number(a.status !== "resolved") ||
          desc("startedAt")(a, b),
        )
        .slice(0, 10)
        .map((a) => ({
          id: String(a.id),
          type: String(a.type),
          severity: String(a.severity),
          status: String(a.status),
          title: String(a.title),
          message: str(a.message),
          startedAt: String(a.startedAt),
          endedAt: str(a.endedAt),
        })),
      unavailable: names.filter((_, i) => settled[i].status === "rejected"),
    };
  }

  // Rincian OLT operasional untuk panel OLT. null = titik ini tidak cocok dengan OLT di pusat.
  static async getOltDetail(
    id: string,
    range: OltRange,
  ): Promise<{ detail: OltDetail | null; choices: { id: string; name: string }[] }> {
    const device = (await this.getMapData()).devices.find((d) => d.id === id);
    if (!device) throw deviceNotFound();
    if (device.type !== "server") {
      throw new ClassifiedCentralApiError("CONFLICT", "Rincian OLT hanya untuk perangkat Server/OLT.", 422);
    }
    if (!device.centralOlt) {
      const olts = this.getDataSource() === "central-api" ? await fetchDataset<CentralOlt>("olts") : [];
      return { detail: null, choices: olts.map((o) => ({ id: o.id, name: o.name })) };
    }
    return { detail: await this.oltDetail(device.centralOlt.id, range), choices: [] };
  }

  private static async oltDetail(oltId: string, range: OltRange): Promise<OltDetail> {

    const parts = {
      olts: fetchDataset<CentralOlt & Record<string, unknown>>("olts"),
      ports: fetchDataset<CentralPonPort & Record<string, unknown>>("olt-pon-ports"),
      onus: fetchDataset<CentralOnu>("olt-onus"),
      traffic: fetchVlanTraffic<{ data?: { polledAt?: string; items?: Record<string, unknown>[] } }>(range),
    };
    const names = Object.keys(parts) as (keyof typeof parts)[];
    const settled = await Promise.allSettled(Object.values(parts));
    const ok = <K extends keyof typeof parts>(k: K) => {
      const r = settled[names.indexOf(k)];
      return r.status === "fulfilled" ? (r.value as Awaited<(typeof parts)[K]>) : null;
    };
    const unavailable: string[] = names.filter((_, i) => settled[i].status === "rejected");

    const olt = ok("olts")?.find((o) => o.id === oltId);
    const ref = { id: oltId, name: olt?.name ?? "OLT" };
    const ports = (ok("ports") ?? []).filter((p) => p.oltId === oltId);
    const onus = (ok("onus") ?? []).filter((o) => o.oltId === oltId);
    // Trafik VLAN pusat hanya untuk OLT aktifnya; dipakai bila namanya sama dengan OLT titik ini
    const trafficData = ok("traffic")?.data;
    const items = (trafficData?.items ?? []).filter((i) => i.oltName === ref.name);
    if (trafficData && items.length === 0) unavailable.push("trafik (OLT di data trafik pusat berbeda)");

    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const ponIndexes = [
      ...new Set([...ports.map((p) => p.ponIndex), ...onus.map((o) => o.ponIndex), ...items.map((i) => num(i.ponIndex))]),
    ].sort((a, b) => a - b);

    return {
      olt: {
        name: ref.name,
        brand: typeof olt?.brand === "string" ? olt.brand : null,
        status: typeof olt?.status === "string" ? olt.status : null,
        lastSeenAt: typeof olt?.lastSeenAt === "string" ? olt.lastSeenAt : null,
      },
      range,
      polledAt: trafficData?.polledAt ?? null,
      unavailable,
      pons: ponIndexes.map((ponIndex) => {
        const port = ports.find((p) => p.ponIndex === ponIndex);
        const ponOnus = onus.filter((o) => o.ponIndex === ponIndex);
        const rxs = ponOnus.map((o) => o.rxPower).filter((v): v is number => typeof v === "number");
        const item = items.find((i) => num(i.ponIndex) === ponIndex);
        const series = Array.isArray(item?.series) ? (item.series as Record<string, unknown>[]) : [];
        return {
          ponIndex,
          rxPower: port?.rxPower ?? null,
          txPower: typeof port?.txPower === "number" ? port.txPower : null,
          onuOnline: ponOnus.filter((o) => o.status === "online").length || (port?.onuOnlineCount ?? 0),
          onuTotal: ponOnus.length,
          onuOffline: ponOnus.filter((o) => o.status !== "online").length,
          weakSignal: rxs.filter((v) => v < ONU_RX_WEAK_DBM).length,
          avgOnuRx: rxs.length ? Math.round((rxs.reduce((a, b) => a + b, 0) / rxs.length) * 100) / 100 : null,
          capturedAt: typeof port?.capturedAt === "string" ? port.capturedAt : null,
          traffic: item
            ? {
                currentDown: num(item.currentDownloadMbps),
                currentUp: num(item.currentUploadMbps),
                peakDown: num(item.peakDownloadMbps),
                peakUp: num(item.peakUploadMbps),
                avgDown: num(item.avgDownloadMbps),
                avgUp: num(item.avgUploadMbps),
                downTotalBytes: num(item.txTotalBytes),
                upTotalBytes: num(item.rxTotalBytes),
                series: series.map((p) => ({
                  t: num(p.timestamp) * 1000,
                  down: num(p.downloadMbps),
                  up: num(p.uploadMbps),
                })),
              }
            : null,
        };
      }),
    };
  }

  // Trafik live: simple queue dinamis "<pppoe-username>" di router pelanggan. null = sesi tidak aktif.
  static async getCustomerTraffic(id: string): Promise<CustomerTraffic | null> {
    if (this.getDataSource() !== "central-api" || (await this.isLocal("customer", id))) {
      return null;
    }
    const customer = (
      await fetchDataset<CentralCustomer & { routerId?: string | null }>("customers")
    ).find((c) => c.id === id);
    if (!customer) throw customerNotFound();
    if (!customer.routerId) return null;

    type Pair = { upload: number; download: number };
    const res = await fetchRouterQueues<{
      data?: { name: string; maxLimit: Pair; rate: Pair; bytes: Pair }[];
    }>(customer.routerId, customer.pppoeUsername);
    const q = res?.data?.find((r) => r.name === `<pppoe-${customer.pppoeUsername}>`);
    return q
      ? {
          downloadBps: q.rate.download,
          uploadBps: q.rate.upload,
          maxDownloadBps: q.maxLimit.download,
          maxUploadBps: q.maxLimit.upload,
          downloadBytes: q.bytes.download,
          uploadBytes: q.bytes.upload,
          sampledAt: Date.now(),
        }
      : null;
  }

  // Entitas buatan lokal (UUID di tabel lokal)? Selain itu dianggap milik pusat.
  private static async isLocal(kind: "customer" | "device", id: string) {
    if (!UUID_RE.test(id)) return false;
    const [row] =
      kind === "customer"
        ? await db.select({ id: customers.id }).from(customers).where(eq(customers.id, id)).limit(1)
        : await db.select({ id: networkDevices.id }).from(networkDevices).where(eq(networkDevices.id, id)).limit(1);
    return Boolean(row);
  }

  // Pastikan entitas pusat ada sebelum menyimpan koreksinya (hanya GET ke pusat)
  private static async assertCentral(kind: "customer" | "device", id: string) {
    const exists =
      this.getDataSource() === "central-api" &&
      (
        await fetchDataset<{ id: string }>(
          kind === "customer" ? "customers" : "network-infrastructure",
        )
      ).some((r) => r.id === id);
    if (!exists) {
      throw kind === "customer" ? customerNotFound() : deviceNotFound();
    }
  }

  // Koreksi lokal atas entitas pusat + catatan undo-nya, dalam satu transaksi
  private static async saveOverride(
    kind: "customer" | "device",
    id: string,
    values: Partial<typeof mapOverrides.$inferInsert>,
    label: string,
  ): Promise<string> {
    return await db.transaction(async (tx) => {
      const changes = await snapshot(tx, "override", [`${kind}:${id}`]);
      await tx
        .insert(mapOverrides)
        .values({ entityType: kind, entityId: id, ...values })
        .onConflictDoUpdate({
          target: [mapOverrides.entityType, mapOverrides.entityId],
          set: { ...values, updatedAt: new Date() },
        });
      return await saveUndo(tx, label, changes);
    });
  }

  // Ubah satu baris entitas lokal + catatan undo-nya, dalam satu transaksi
  private static async updateLocal(
    kind: "customer" | "device",
    id: string,
    values: Record<string, unknown>,
    label: string,
  ): Promise<string> {
    const table = kind === "customer" ? customers : networkDevices;
    return await db.transaction(async (tx) => {
      const changes = await snapshot(tx, kind, [id]);
      await tx
        .update(table)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(table.id, id));
      return await saveUndo(tx, label, changes);
    });
  }

  // Update koordinat pelanggan; odpId (opsional) menghubungkan pelanggan ke ODP. Hasil: id undo
  static async updateCustomerLocation(
    id: string,
    latitude: number,
    longitude: number,
    odpId?: string,
  ): Promise<string> {
    const data = odpId ? await this.getMapData() : null;
    // Pelanggan dilayani ODP, atau langsung dari port ODC
    const target = data?.devices.find((d) => d.id === odpId);
    if (data && !target) throw deviceNotFound();
    if (target && target.type !== "odp" && target.type !== "odc") {
      throw new ClassifiedCentralApiError("CONFLICT", "Pelanggan hanya bisa disambung ke ODP atau ODC.", 422);
    }
    // Pindah ODP: port lama tidak berlaku lagi di ODP baru
    const movedOdp =
      data && data.customers.find((c) => c.id === id)?.odpId !== odpId ? { odpPort: null } : {};
    const label = odpId ? "Hubungkan pelanggan ke ODP" : "Geser titik pelanggan";
    if (await this.isLocal("customer", id)) {
      return this.updateLocal(
        "customer",
        id,
        { latitude, longitude, ...(odpId && { odpId, ...movedOdp }) },
        label,
      );
    }
    await this.assertCentral("customer", id);
    // Kolom parentDeviceId pada koreksi pelanggan = ODP yang melayaninya
    return this.saveOverride(
      "customer",
      id,
      { latitude, longitude, ...(odpId && { parentDeviceId: odpId, ...movedOdp }) },
      label,
    );
  }

  // Catat (atau lepas, port = null) port di perangkat induk: pelanggan di port ODP/ODC, ODP di port ODC.
  // odcId (khusus ODP): pasang ODP di port ODC itu sekaligus menjadikan ODC induknya,
  // sehingga jalur ODP dihitung lewat ODC, bukan lagi langsung dari jalur kabel.
  static async setParentPort(
    kind: "customer" | "device",
    id: string,
    port: number | null,
    odcId?: string,
  ): Promise<string> {
    const data = await this.getMapData();
    const child =
      kind === "customer"
        ? data.customers.find((c) => c.id === id)
        : data.devices.find((d) => d.id === id && d.type === "odp");
    if (!child) throw kind === "customer" ? customerNotFound() : deviceNotFound();
    const seatInOdc = kind === "device" && port !== null && odcId !== undefined;
    const parentId = seatInOdc
      ? odcId
      : "odpId" in child
        ? child.odpId
        : (child as MapDevice).parentDeviceId;
    const parent = data.devices.find(
      (d) => d.id === parentId && (d.type === "odc" || (kind === "customer" && d.type === "odp")),
    );
    const portOf = (x: MapCustomer | MapDevice) =>
      "customerNumber" in x ? x.odpPort : x.odcPort;
    if (port !== null) {
      if (!parent) {
        throw new ClassifiedCentralApiError(
          "CONFLICT",
          kind === "customer"
            ? "Hubungkan pelanggan ke ODP/ODC dulu sebelum memilih port."
            : "Jadikan ODC sebagai induk ODP ini dulu sebelum memilih port ODC.",
          422,
        );
      }
      if (seatInOdc && createsCycle(data.devices, id, parent.id)) {
        throw new ClassifiedCentralApiError(
          "CONFLICT",
          `${child.name} tidak bisa dipasang di ${parent.name}: ODC itu berada di bawah ODP ini.`,
          409,
        );
      }
      // Nomor port terpisah: ODP di port splitter ODC, pelanggan di port pelanggan kotak
      const ports = kind === "customer" ? customerPortCount(parent) : portCount(parent);
      if (port > ports) {
        throw new ClassifiedCentralApiError(
          "CONFLICT",
          `Port ${port} melebihi jumlah port ${parent.name} (${ports} port).`,
          422,
        );
      }
      const siblings: (MapCustomer | MapDevice)[] =
        kind === "customer"
          ? data.customers.filter((c) => c.odpId === parent.id)
          : data.devices.filter((d) => d.parentDeviceId === parent.id);
      const holder = siblings.find((x) => x.id !== id && portOf(x) === port);
      if (holder) {
        throw new ClassifiedCentralApiError(
          "CONFLICT",
          `Port ${port} sudah dipakai ${holder.name}. Lepas dulu port itu.`,
          409,
        );
      }
    }
    const label =
      port === null
        ? `Lepas port ${child.name}`
        : `Pasang ${child.name} di port ${port} ${parent!.name}`;
    const values =
      kind === "customer"
        ? { odpPort: port }
        : seatInOdc
          ? { odcPort: port, parentDeviceId: parent!.id }
          : { odcPort: port };
    // shortcut: cek bentrok port lalu tulis tidak atomik; dua operator di port yang sama bersamaan bisa lolos, tambah unique index bila sering terjadi
    return (await this.isLocal(kind, id))
      ? this.updateLocal(kind, id, values, label)
      : this.saveOverride(kind, id, seatInOdc ? { ...values, parentCleared: false } : values, label);
  }

  // Ubah jenis ODP <-> ODC. Rasio yang tidak sah untuk jenis baru dikosongkan;
  // ODC yang masih punya ODP terpasang di port-nya ditolak agar port ODC tidak menggantung.
  static async setDeviceType(id: string, type: "odp" | "odc"): Promise<string> {
    const data = await this.getMapData();
    const device = data.devices.find((d) => d.id === id);
    if (!device) throw deviceNotFound();
    if (device.type !== "odp" && device.type !== "odc") {
      throw new ClassifiedCentralApiError("CONFLICT", "Hanya ODP dan ODC yang bisa diubah jenisnya.", 422);
    }
    if (device.type === type) {
      throw new ClassifiedCentralApiError("CONFLICT", `${device.name} sudah berjenis ${type.toUpperCase()}.`, 422);
    }
    // ODP berantai (induk biasa) boleh; yang dicegah hanya ODP yang terpasang di port ODC ini
    const seated = data.devices.filter((d) => d.parentDeviceId === id && d.odcPort != null);
    if (type === "odp" && seated.length > 0) {
      throw new ClassifiedCentralApiError(
        "CONFLICT",
        `${seated.map((d) => d.name).join(", ")} masih terpasang di port ${device.name}. Lepas dulu port-nya sebelum mengubahnya menjadi ODP.`,
        409,
      );
    }
    const allowed: readonly number[] = SPLITTER_RATIOS[type];
    const values = {
      // ODP yang menjadi ODC tidak lagi duduk di port ODC lain
      ...(type === "odc" && { odcPort: null }),
      ...(device.splitterRatio != null && !allowed.includes(device.splitterRatio) && { splitterRatio: null }),
    };
    const name = renameForType(device.name, type);
    const label = `Ubah jenis ${device.name}: ${device.type.toUpperCase()} → ${type.toUpperCase()}`;
    return (await this.isLocal("device", id))
      ? this.updateLocal("device", id, { type, name, ...values }, label)
      : this.saveOverride("device", id, { deviceType: type, name, ...values }, label);
  }

  // Splitter rasio (coupler tak seimbang) di ODC/ODP: persen port tap; null = tidak ada
  static async setSplitterTap(id: string, tapPct: number | null): Promise<string> {
    const device = (await this.getMapData()).devices.find((d) => d.id === id);
    if (!device) throw deviceNotFound();
    if (device.type !== "odc" && device.type !== "odp") {
      throw new ClassifiedCentralApiError("CONFLICT", "Splitter rasio hanya untuk ODC dan ODP.", 422);
    }
    const allowed: readonly number[] = TAP_RATIOS;
    if (tapPct !== null && !allowed.includes(tapPct)) {
      throw new ClassifiedCentralApiError("CONFLICT", "Splitter rasio tidak dikenal.", 422);
    }
    const label = tapPct
      ? `Splitter rasio ${device.name} ${tapPct}:${100 - tapPct}`
      : `Hapus splitter rasio ${device.name}`;
    return (await this.isLocal("device", id))
      ? this.updateLocal("device", id, { splitterTap: tapPct }, label)
      : this.saveOverride("device", id, { splitterTap: tapPct }, label);
  }

  // Tautkan titik OLT di peta ke OLT operasional pusat (null = lepas tautan)
  static async setCentralOlt(id: string, oltId: string | null): Promise<string> {
    const device = (await this.getMapData()).devices.find((d) => d.id === id);
    if (!device) throw deviceNotFound();
    if (device.type !== "server") {
      throw new ClassifiedCentralApiError("CONFLICT", "Hanya titik Server/OLT yang bisa ditautkan ke OLT.", 422);
    }
    const olt = oltId ? (await fetchDataset<CentralOlt>("olts")).find((o) => o.id === oltId) : null;
    if (oltId && !olt) {
      throw new ClassifiedCentralApiError("NOT_FOUND", "OLT operasional tidak ditemukan di NOC.", 404);
    }
    const label = olt ? `Tautkan ${device.name} ke ${olt.name}` : `Lepas tautan OLT ${device.name}`;
    return (await this.isLocal("device", id))
      ? this.updateLocal("device", id, { centralOltId: oltId }, label)
      : this.saveOverride("device", id, { centralOltId: oltId }, label);
  }

  // Rasio splitter ODC/ODP (null = kosongkan). Rasio = jumlah port output.
  static async setSplitterRatio(id: string, ratio: number | null): Promise<string> {
    const device = (await this.getMapData()).devices.find((d) => d.id === id);
    if (!device) throw deviceNotFound();
    if (device.type !== "odc" && device.type !== "odp") {
      throw new ClassifiedCentralApiError("CONFLICT", "Rasio splitter hanya untuk ODC dan ODP.", 422);
    }
    const allowed: readonly number[] = SPLITTER_RATIOS[device.type];
    if (ratio !== null && !allowed.includes(ratio)) {
      throw new ClassifiedCentralApiError(
        "CONFLICT",
        `Rasio ${device.type.toUpperCase()} harus salah satu dari ${allowed.map((r) => `1:${r}`).join(", ")}.`,
        422,
      );
    }
    const label = ratio ? `Rasio splitter ${device.name} 1:${ratio}` : `Kosongkan rasio splitter ${device.name}`;
    return (await this.isLocal("device", id))
      ? this.updateLocal("device", id, { splitterRatio: ratio }, label)
      : this.saveOverride("device", id, { splitterRatio: ratio }, label);
  }

  // Tambah perangkat baru; ODC/ODP/tiang wajib masuk rantai sebuah jalur lokal
  static async createDevice(data: {
    name: string;
    type: "server" | "odc" | "odp" | "pole";
    latitude: number;
    longitude: number;
    capacity: number;
    parentDeviceId?: string | null;
    routeId?: string;
    /** Asal segmen pilihan pengguna; bawaan = ujung rantai terakhir jalur */
    fromDeviceId?: string;
    /** Belokan yang digambar pengguna; bawaan = garis asal → perangkat baru */
    geometry?: [number, number][];
  }): Promise<{ device: MapDevice; segment: CableSegment | null; undoId: string }> {
    if (
      data.latitude < -90 ||
      data.latitude > 90 ||
      data.longitude < -180 ||
      data.longitude > 180
    ) {
      throw new Error("Koordinat perangkat tidak valid.");
    }
    if (data.type !== "server" && !data.routeId) {
      throw new ClassifiedCentralApiError(
        "CONFLICT",
        "Pilih identitas jalur kabel lebih dulu. ODC/ODP/tiang harus tercatat pada rantai sebuah jalur.",
        422,
      );
    }

    // Asal segmen = ujung rantai terakhir jalur itu, bukan OLT
    let chainEnd: MapDevice | undefined;
    if (data.routeId) {
      if (!UUID_RE.test(data.routeId)) throw routeNotFound();
      const [route] = await db
        .select({ fromDeviceId: cableRoutes.fromDeviceId })
        .from(cableRoutes)
        .where(eq(cableRoutes.id, data.routeId))
        .limit(1);
      if (!route) throw routeNotFound();
      const segs = await db
        .select({ sequence: cableSegments.sequence, toDeviceId: cableSegments.toDeviceId })
        .from(cableSegments)
        .where(eq(cableSegments.routeId, data.routeId));
      const endId = data.fromDeviceId || chainEndDeviceId(route.fromDeviceId, segs);
      chainEnd = (await this.getMapData()).devices.find((d) => d.id === endId);
      if (!chainEnd) throw deviceNotFound();
    }

    // Segmen awal ujung rantai → perangkat baru; snapping dilakukan sebelum transaksi
    const prepared =
      data.routeId && chainEnd
        ? await this.prepareSegment({
            fromDeviceId: chainEnd.id,
            geometry: data.geometry ?? [
              [chainEnd.latitude, chainEnd.longitude],
              [data.latitude, data.longitude],
            ],
          })
        : null;

    // Perangkat + segmennya satu transaksi: gagal salah satu, tidak ada titik lepas
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(networkDevices)
        .values({
          name: data.name,
          type: data.type,
          latitude: data.latitude,
          longitude: data.longitude,
          capacity: data.capacity,
          parentDeviceId: chainEnd?.id ?? (data.parentDeviceId || null),
          status: "normal",
        })
        .returning();

      const device: MapDevice = {
        id: created.id,
        name: created.name,
        type: created.type as MapDevice["type"],
        latitude: created.latitude,
        longitude: created.longitude,
        capacity: created.capacity,
        status: (created.status as MapDevice["status"]) || "normal",
        parentDeviceId: created.parentDeviceId,
      };
      const changes = [createdRow("device", created.id)];
      let segment: CableSegment | null = null;
      if (prepared && data.routeId && chainEnd) {
        const inserted = await this.insertSegment(
          tx,
          { routeId: data.routeId, fromDeviceId: chainEnd.id, toDeviceId: created.id },
          prepared,
        );
        segment = inserted.segment;
        changes.push(...inserted.changes);
      }
      const undoId = await saveUndo(tx, `Tambah ${created.name}`, changes);
      return { device, segment, undoId };
    });
  }

  // Update posisi perangkat
  static async updateDeviceLocation(
    id: string,
    latitude: number,
    longitude: number,
  ): Promise<string> {
    const label = "Geser titik perangkat";
    if (await this.isLocal("device", id)) {
      return this.updateLocal("device", id, { latitude, longitude }, label);
    }
    await this.assertCentral("device", id);
    return this.saveOverride("device", id, { latitude, longitude }, label);
  }

  // Update induk perangkat (reparenting); siklus ditolak di kedua sumber data
  static async updateDeviceParent(
    id: string,
    parentDeviceId: string | null,
  ): Promise<string> {
    // Cek keberadaan & siklus pada gabungan perangkat pusat (sudah dikoreksi) + lokal
    const links = (await this.getMapData()).devices;
    if (!links.some((d) => d.id === id)) throw deviceNotFound();
    if (parentDeviceId && !links.some((d) => d.id === parentDeviceId)) {
      throw deviceNotFound();
    }
    if (createsCycle(links, id, parentDeviceId)) {
      throw new ClassifiedCentralApiError(
        "CONFLICT",
        "Induk tidak sah: perangkat tidak boleh menjadi induk dirinya sendiri atau keturunannya.",
        409,
      );
    }

    // Pindah induk: port ODC lama tidak berlaku lagi
    const moved =
      links.find((d) => d.id === id)?.parentDeviceId !== parentDeviceId ? { odcPort: null } : {};
    const label = "Pindah induk perangkat";
    if (await this.isLocal("device", id)) {
      return this.updateLocal("device", id, { parentDeviceId, ...moved }, label);
    }
    return this.saveOverride(
      "device",
      id,
      { parentDeviceId, parentCleared: parentDeviceId === null, ...moved },
      label,
    );
  }

  // Ubah keterangan perangkat
  static async updateDeviceNotes(id: string, notes: string): Promise<string> {
    const label = "Ubah keterangan perangkat";
    if (await this.isLocal("device", id)) {
      return this.updateLocal("device", id, { notes: notes || null }, label);
    }
    await this.assertCentral("device", id);
    return this.saveOverride("device", id, { notes }, label);
  }

  // Hapus perangkat (bisa di-undo: baris dan rujukannya dicatat sebelum dihapus)
  // Perangkat lokal dihapus; perangkat pusat hanya disembunyikan dari peta ini
  static async deleteDevice(id: string): Promise<string> {
    if (!(await this.isLocal("device", id))) {
      await this.assertCentral("device", id);
      return this.saveOverride("device", id, { hidden: true }, "Hapus perangkat");
    }
    // Tanpa FK (ID bisa milik pusat), jadi rujukan jalur diperiksa manual agar data tidak menggantung
    const [usedByRoute] = await db
      .select({ id: cableRoutes.id })
      .from(cableRoutes)
      .where(or(eq(cableRoutes.fromDeviceId, id), eq(cableRoutes.toDeviceId, id)))
      .limit(1);
    if (usedByRoute) {
      throw new ClassifiedCentralApiError(
        "CONFLICT",
        "Perangkat menjadi asal/tujuan identitas jalur kabel. Hapus atau ubah jalurnya dulu.",
        409,
      );
    }
    // Hanya ujung rantai yang boleh dihapus, agar rantai di belakangnya tidak terputus
    const [feedsNext] = await db
      .select({ id: cableSegments.id })
      .from(cableSegments)
      .where(eq(cableSegments.fromDeviceId, id))
      .limit(1);
    if (feedsNext) {
      throw new ClassifiedCentralApiError(
        "CONFLICT",
        "Perangkat masih menjadi asal segmen berikutnya (ODP/pelanggan di belakangnya). Hapus dari ujung rantai terakhir dulu.",
        409,
      );
    }
    return await db.transaction(async (tx) => {
      // Catat semua baris yang akan berubah: perangkat, segmen masuk (+sampel), jalurnya, anak, pelanggan
      const [device] = await tx
        .select({ name: networkDevices.name })
        .from(networkDevices)
        .where(eq(networkDevices.id, id));
      const incoming = await tx
        .select({ id: cableSegments.id, routeId: cableSegments.routeId })
        .from(cableSegments)
        .where(eq(cableSegments.toDeviceId, id));
      const children = await tx
        .select({ id: networkDevices.id })
        .from(networkDevices)
        .where(eq(networkDevices.parentDeviceId, id));
      const served = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.odpId, id));
      const changes = [
        ...(await snapshot(tx, "route", incoming.map((s) => s.routeId))),
        ...(await snapshot(tx, "segment", incoming.map((s) => s.id))),
        ...(await snapshot(tx, "device", [id, ...children.map((c) => c.id)])),
        ...(await snapshot(tx, "customer", served.map((c) => c.id))),
      ];

      // Segmen masuk ke perangkat ini ikut dihapus (sampel ikut via cascade), panjang jalur dihitung ulang
      await tx.delete(cableSegments).where(eq(cableSegments.toDeviceId, id));
      for (const routeId of new Set(incoming.map((s) => s.routeId))) {
        await recomputeRouteTotal(tx, routeId);
      }
      await tx.update(customers).set({ odpId: null }).where(eq(customers.odpId, id));
      await tx
        .update(networkDevices)
        .set({ parentDeviceId: null })
        .where(eq(networkDevices.parentDeviceId, id));
      await tx.delete(networkDevices).where(eq(networkDevices.id, id));
      return await saveUndo(tx, `Hapus ${device?.name ?? "perangkat"}`, changes);
    });
  }

  // Buat identitas jalur kabel baru
  static async createCableRoute(data: {
    code: string;
    name: string;
    cableType: string;
    fiberCapacity: number;
    fromDeviceId: string;
    toDeviceId?: string;
    color?: string;
  }): Promise<CableRoute & { undoId: string }> {
    if (!data.code.trim()) {
      throw new Error("Kode jalur kabel wajib diisi.");
    }

    // Tanpa FK: pastikan perangkat asal/tujuan ada (lokal atau pusat)
    const deviceIds = new Set((await this.getMapData()).devices.map((d) => d.id));
    if (
      !deviceIds.has(data.fromDeviceId) ||
      (data.toDeviceId && !deviceIds.has(data.toDeviceId))
    ) {
      throw deviceNotFound();
    }

    // Periksa keunikan kode jalur
    const existing = await db
      .select({ id: cableRoutes.id })
      .from(cableRoutes)
      .where(eq(cableRoutes.code, data.code.trim()))
      .limit(1);

    if (existing.length > 0) {
      throw new ClassifiedCentralApiError(
        "CONFLICT",
        `Kode jalur "${data.code}" sudah digunakan. Gunakan kode unik lain.`,
        409,
      );
    }

    const interval = ROUTE_SAMPLE_INTERVAL_M;

    const { created, undoId } = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(cableRoutes)
        .values({
          code: data.code.trim(),
          name: data.name.trim(),
          cableType: data.cableType,
          fiberCapacity: data.fiberCapacity,
          fromDeviceId: data.fromDeviceId,
          toDeviceId: data.toDeviceId || null,
          color: data.color ?? null,
          samplingIntervalM: interval,
          totalLengthM: 0,
        })
        .returning();
      // Undo jalur = hapus jalur (segmennya ikut via cascade)
      const id = await saveUndo(tx, `Buat jalur ${row.code}`, [createdRow("route", row.id)]);
      return { created: row, undoId: id };
    });

    return {
      undoId,
      id: created.id,
      code: created.code,
      name: created.name,
      cableType: created.cableType,
      fiberCapacity: created.fiberCapacity,
      fromDeviceId: created.fromDeviceId,
      toDeviceId: created.toDeviceId,
      samplingIntervalM: created.samplingIntervalM,
      totalLengthM: created.totalLengthM,
      createdAt: created.createdAt.toISOString(),
      color: created.color,
    };
  }

  // Ubah identitas jalur: nama, warna, kabel, PON (salah port / port OLT diganti).
  // PON tersimpan di kode jalur; nama ODP/ODC/tiang otomatis di rantai jalur
  // ("ODP n <nama> PON <p>") ikut diganti. Hasil: id undo
  static async updateRoute(
    id: string,
    data: {
      name?: string;
      color?: string | null;
      cableType?: string;
      fiberCapacity?: number;
      pon?: number;
    },
  ): Promise<string> {
    if (!UUID_RE.test(id)) throw routeNotFound();
    const [route] = await db.select().from(cableRoutes).where(eq(cableRoutes.id, id)).limit(1);
    if (!route) throw routeNotFound();

    const merged = await this.getMapData();
    const oldPon = routePon(route.code);
    let code = route.code;
    if (data.pon !== undefined && data.pon !== oldPon) {
      const olt = merged.devices.find((d) => d.id === route.fromDeviceId);
      if (!olt) throw deviceNotFound();
      if (data.pon < 1 || data.pon > oltPonCount(olt)) {
        throw new ClassifiedCentralApiError(
          "CONFLICT",
          `PON ${data.pon} tidak ada di ${olt.name} (${oltPonCount(olt)} port).`,
          422,
        );
      }
      const usedBy = merged.routes.find(
        (r) => r.id !== id && r.fromDeviceId === olt.id && routePon(r.code) === data.pon,
      );
      if (usedBy) {
        throw new ClassifiedCentralApiError(
          "CONFLICT",
          `PON ${data.pon} sudah dipakai jalur ${usedBy.name}.`,
          409,
        );
      }
      code = oldPon
        ? route.code.replace(/-PON\d+(?=(-\d+)?$)/i, `-PON${data.pon}`)
        : `${route.code}-PON${data.pon}`;
    }

    const name = data.name?.trim() || route.name;
    const newPon = data.pon ?? oldPon;
    const suffix = (n: string, p: number | null) => ` ${n}${p ? ` PON ${p}` : ""}`;
    const oldSuffix = suffix(route.name, oldPon);
    const newSuffix = suffix(name, newPon);
    const chainIds = new Set(
      merged.segments.filter((s) => s.routeId === id).map((s) => s.toDeviceId),
    );
    // Hanya nama buatan otomatis ("ODP 3 …"); nama yang diketik sendiri tidak disentuh
    const renamed =
      oldSuffix === newSuffix
        ? []
        : merged.devices.filter(
            (d) =>
              chainIds.has(d.id) &&
              UUID_RE.test(d.id) &&
              /^(ODP|ODC|TIANG) \d+ /.test(d.name) &&
              d.name.endsWith(oldSuffix),
          );

    return await db.transaction(async (tx) => {
      const changes = [
        ...(await snapshot(tx, "route", [id])),
        ...(await snapshot(tx, "device", renamed.map((d) => d.id))),
      ];
      await tx
        .update(cableRoutes)
        .set({
          code,
          name,
          ...(data.color !== undefined && { color: data.color }),
          ...(data.cableType && { cableType: data.cableType }),
          ...(data.fiberCapacity && { fiberCapacity: data.fiberCapacity }),
          updatedAt: new Date(),
        })
        .where(eq(cableRoutes.id, id));
      for (const d of renamed) {
        await tx
          .update(networkDevices)
          .set({ name: d.name.slice(0, -oldSuffix.length) + newSuffix, updatedAt: new Date() })
          .where(eq(networkDevices.id, d.id));
      }
      return await saveUndo(tx, `Ubah jalur ${name}`, changes);
    });
  }

  // Validasi + snapping di luar transaksi (memanggil pusat); hasilnya dipakai insertSegment
  private static async prepareSegment(data: {
    fromDeviceId: string;
    toDeviceId?: string;
    customerId?: string;
    geometry: [number, number][]; // Usulan geometri dari user
  }) {
    // Tanpa FK: perangkat/pelanggan bisa milik pusat, jadi diperiksa pada data gabungan
    const merged = await this.getMapData();
    const fromDev = merged.devices.find((d) => d.id === data.fromDeviceId);
    if (
      !fromDev ||
      (data.toDeviceId && !merged.devices.some((d) => d.id === data.toDeviceId))
    ) {
      throw deviceNotFound();
    }
    if (data.customerId && !merged.customers.some((c) => c.id === data.customerId)) {
      throw customerNotFound();
    }
    return { fromDev, preview: await this.previewSegment(data.geometry) };
  }

  // Sisipkan segmen + sampel + total jalur dalam transaksi pemanggil; changes = catatan undo
  private static async insertSegment(
    tx: Tx,
    data: { routeId: string; fromDeviceId: string; toDeviceId?: string; customerId?: string },
    { fromDev, preview }: Awaited<ReturnType<typeof MapDataAdapter.prepareSegment>>,
  ) {
    // Kunci baris jalur agar penentuan sequence tidak balapan antar request
    const [route] = await tx
      .select({ id: cableRoutes.id })
      .from(cableRoutes)
      .where(eq(cableRoutes.id, data.routeId))
      .for("update")
      .limit(1);
    if (!route) throw routeNotFound();
    // total_length_m jalur ikut berubah, jadi dicatat untuk dipulihkan saat undo
    const changes = await snapshot(tx, "route", [data.routeId]);

    const [{ maxSeq }] = await tx
      .select({ maxSeq: max(cableSegments.sequence) })
      .from(cableSegments)
      .where(eq(cableSegments.routeId, data.routeId));
    const sequence = (maxSeq ?? 0) + 1;

    // Validasi rantai OLT: OLT hanya sah sebagai asal segmen pertama
    if (fromDev.type === "server" && (maxSeq ?? 0) > 0) {
      throw new ClassifiedCentralApiError(
        "CONFLICT",
        "OLT/Server hanya sah sebagai asal segmen pertama. Tarik segmen baru dari ujung rantai terakhir (mis. ODP terakhir), atau buat jalur baru dengan kode berbeda.",
        409,
      );
    }

    const [savedSegment] = await tx
      .insert(cableSegments)
      .values({
        routeId: data.routeId,
        fromDeviceId: data.fromDeviceId,
        toDeviceId: data.toDeviceId || null,
        customerId: data.customerId || null,
        sequence,
        geometry: preview.geometry,
        lengthM: preview.lengthM,
        snapped: preview.snapped,
        snapProvider: preview.snapProvider,
        snapToleranceM: SNAP_TOLERANCE_M,
        snappedAt: preview.snapped ? new Date() : null,
      })
      .returning();
    changes.push(createdRow("segment", savedSegment.id));

    const savedSamples = await insertSamples(tx, savedSegment.id, preview.samples);
    const totalRouteLength = await recomputeRouteTotal(tx, data.routeId);

    const segment: CableSegment = {
      id: savedSegment.id,
      routeId: savedSegment.routeId,
      fromDeviceId: savedSegment.fromDeviceId,
      toDeviceId: savedSegment.toDeviceId,
      customerId: savedSegment.customerId,
      sequence: savedSegment.sequence,
      geometry: savedSegment.geometry || [],
      lengthM: savedSegment.lengthM,
      snapped: savedSegment.snapped,
      snapProvider: savedSegment.snapProvider,
      snapToleranceM: savedSegment.snapToleranceM,
      snappedAt:
        savedSegment.snapped && savedSegment.snappedAt
          ? savedSegment.snappedAt.toISOString()
          : null,
      samples: savedSamples.sort((a, b) => a.sequence - b.sequence),
    };
    return { segment, totalLengthM: totalRouteLength, changes };
  }

  // Simpan segmen jalur kabel (Road snapping & pengukuran panjang)
  static async saveCableSegment(data: {
    routeId: string;
    fromDeviceId: string;
    toDeviceId?: string;
    customerId?: string;
    geometry: [number, number][]; // Usulan geometri dari user
  }): Promise<{ segment: CableSegment; totalLengthM: number; undoId: string }> {
    const prepared = await this.prepareSegment(data);
    // Simpan ke local-db secara atomik: segmen + sampel + total_length_m + catatan undo
    return await db.transaction(async (tx) => {
      const { changes, ...result } = await this.insertSegment(tx, data, prepared);
      return { ...result, undoId: await saveUndo(tx, "Tambah segmen kabel", changes) };
    });
  }

  // Tarik geometri ke jalan lewat OSRM self-host NOC (tidak pernah layanan luar)
  static async snapGeometry(points: [number, number][]): Promise<{
    geometry: [number, number][];
    snapped: boolean;
    snapProvider: string;
    reason: string | null;
  }> {
    const manual = (reason: string) => ({
      geometry: points,
      snapped: false,
      snapProvider: "manual",
      reason,
    });
    try {
      const result = await fetchSnap(points, SNAP_TOLERANCE_M);
      if (result.snapped && result.geometry?.length >= 2) {
        return {
          geometry: result.geometry,
          snapped: true,
          snapProvider: result.provider || "osrm",
          reason: null,
        };
      }
      return manual(`Tidak ada jalan dalam radius ${SNAP_TOLERANCE_M} m dari titik jalur.`);
    } catch (err) {
      return manual(
        err instanceof Error
          ? `Layanan snapping gagal: ${err.message}`
          : "Layanan snapping gagal.",
      );
    }
  }

  // Pratinjau segmen: snapping + sampling ±interval + panjang dihitung server (tidak disimpan)
  static async previewSegment(points: [number, number][]) {
    if (points.length < 2) {
      throw new ClassifiedCentralApiError(
        "CONFLICT",
        "Geometri jalur memerlukan minimal 2 titik koordinat.",
        422,
      );
    }
    const snap = await this.snapGeometry(points);
    const { samples, totalLengthM } = generateSegmentSamples(
      snap.geometry,
      ROUTE_SAMPLE_INTERVAL_M,
    );
    return { ...snap, samples, lengthM: totalLengthM };
  }

  // Rapikan titik belokan segmen: snap ulang, sampling ulang, panjang & total dihitung ulang
  static async updateCableSegment(
    routeId: string,
    segmentId: string,
    geometry: [number, number][],
  ): Promise<{ totalLengthM: number; undoId: string }> {
    const preview = await this.previewSegment(geometry);

    return await db.transaction(async (tx) => {
      const changes = [
        ...(await snapshot(tx, "route", [routeId])),
        ...(await snapshot(tx, "segment", [segmentId])),
      ];
      const [updated] = await tx
        .update(cableSegments)
        .set({
          geometry: preview.geometry,
          lengthM: preview.lengthM,
          snapped: preview.snapped,
          snapProvider: preview.snapProvider,
          snapToleranceM: SNAP_TOLERANCE_M,
          snappedAt: preview.snapped ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(cableSegments.id, segmentId), eq(cableSegments.routeId, routeId)),
        )
        .returning({ id: cableSegments.id });
      if (!updated) {
        throw new ClassifiedCentralApiError(
          "NOT_FOUND",
          "Segmen jalur tidak ditemukan.",
          404,
        );
      }

      await tx
        .delete(cableSegmentSamples)
        .where(eq(cableSegmentSamples.segmentId, segmentId));
      await insertSamples(tx, segmentId, preview.samples);
      const totalLengthM = await recomputeRouteTotal(tx, routeId);
      return { totalLengthM, undoId: await saveUndo(tx, "Rapikan segmen kabel", changes) };
    });
  }

  // Lapisan gambar/anotasi: selalu disimpan di local-db (tidak ada kontrak central API).
  private static toLayerItem(r: typeof mapLayers.$inferSelect): MapLayerItem {
    return {
      id: r.id,
      name: r.name,
      layerOrder: r.layerOrder,
      opacity: r.opacity,
      visible: r.visible,
      shapes: r.shapes as AnnotationShape[],
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  static async getLayers(): Promise<MapLayerItem[]> {
    const rows = await db
      .select()
      .from(mapLayers)
      .orderBy(asc(mapLayers.layerOrder), asc(mapLayers.createdAt));
    return rows.map((r) => this.toLayerItem(r));
  }

  static async createLayer(data: {
    name: string;
    layerOrder?: number;
    opacity?: number;
    visible?: boolean;
    shapes: AnnotationShape[];
  }): Promise<MapLayerItem & { undoId: string }> {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(mapLayers)
        .values({
          name: data.name.trim(),
          layerOrder: data.layerOrder,
          opacity: data.opacity,
          visible: data.visible,
          shapes: data.shapes,
        })
        .returning();
      const undoId = await saveUndo(tx, `Buat lapisan ${created.name}`, [
        createdRow("layer", created.id),
      ]);
      return { ...this.toLayerItem(created), undoId };
    });
  }

  static async updateLayer(
    id: string,
    data: Partial<{
      name: string;
      layerOrder: number;
      opacity: number;
      visible: boolean;
      shapes: AnnotationShape[];
    }>,
  ): Promise<MapLayerItem & { undoId: string }> {
    return await db.transaction(async (tx) => {
      const changes = await snapshot(tx, "layer", [id]);
      const [updated] = await tx
        .update(mapLayers)
        .set({
          ...data,
          name: data.name?.trim(),
          updatedAt: new Date(),
        })
        .where(eq(mapLayers.id, id))
        .returning();
      if (!updated) throw new LayerNotFoundError();
      const undoId = await saveUndo(tx, `Ubah lapisan ${updated.name}`, changes);
      return { ...this.toLayerItem(updated), undoId };
    });
  }

  static async deleteLayer(id: string): Promise<string> {
    return await db.transaction(async (tx) => {
      const changes = await snapshot(tx, "layer", [id]);
      const deleted = await tx
        .delete(mapLayers)
        .where(eq(mapLayers.id, id))
        .returning({ name: mapLayers.name });
      if (deleted.length === 0) throw new LayerNotFoundError();
      return await saveUndo(tx, `Hapus lapisan ${deleted[0].name}`, changes);
    });
  }
}
