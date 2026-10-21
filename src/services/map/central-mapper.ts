// Pemetaan murni dataset /api/v1/data aplikasi pusat (NOC SYSTEM) ke tipe domain peta.
// Bentuk kolom mengikuti skema pusat: customers, network_infrastructure, network_cables.
import { generateSegmentSamples } from "./geo.ts";
import type {
  CableRoute,
  CableSegment,
  MapCustomer,
  MapDevice,
} from "./types.ts";

export interface CentralCustomer {
  id: string;
  name: string;
  pppoeUsername: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  odpName: string | null;
  billingStatus: "lunas" | "isolir";
  opticalPower: number | null;
  isOnline: boolean;
}

export interface CentralInfrastructure {
  id: string;
  name: string;
  host?: string | null;
  type: "router" | "olt" | "odp" | "odc" | "pole" | "server";
  status: "active" | "inactive" | "maintenance";
  latitude: number;
  longitude: number;
  parentId: string | null;
  capacity: number | null;
  description: string | null;
}

export interface CentralCable {
  id: string;
  name: string;
  sourceId: string;
  targetId: string | null;
  targetType: string;
  cableType: string;
  coreCapacity: number;
  polyline: unknown;
}

export interface CentralOnu {
  oltId: string;
  ponIndex: number;
  onuIndex: number;
  serialNumber: string | null;
  customerId: string | null;
  rxPower: number | null;
  status: "online" | "offline";
}

export interface CentralOlt {
  id: string;
  name: string;
  host: string | null;
}

export interface CentralPonPort {
  oltId: string;
  ponIndex: number;
  rxPower: number | null;
  onuOnlineCount: number | null;
}

export interface CentralBillingCustomer {
  custId: string | number;
  serviceProfile: string | null;
}

export interface CentralDatasets {
  customers: CentralCustomer[];
  infrastructure: CentralInfrastructure[];
  cables: CentralCable[];
  onus?: CentralOnu[];
  olts?: CentralOlt[];
  ponPorts?: CentralPonPort[];
  billingCustomers?: CentralBillingCustomer[];
}

const DEVICE_TYPE: Record<string, MapDevice["type"]> = {
  router: "server",
  olt: "server",
  server: "server",
  odc: "odc",
  odp: "odp",
  pole: "pole",
};

const DEVICE_STATUS: Record<string, MapDevice["status"]> = {
  active: "normal",
  maintenance: "warning",
  inactive: "offline",
};

const isCoord = (p: unknown): p is [number, number] =>
  Array.isArray(p) &&
  p.length === 2 &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Math.abs(p[0] as number) <= 90 &&
  Math.abs(p[1] as number) <= 180;

const normalizeName = (s: string) => s.trim().toLowerCase();

export function mapCentralData(
  {
    customers: rawCustomers,
    infrastructure: rawDevices,
    cables: rawCables,
    onus = [],
    olts = [],
    ponPorts = [],
    billingCustomers = [],
  }: CentralDatasets,
  sampleIntervalM: number,
  /** Tautan manual titik OLT -> OLT operasional (id perangkat -> id OLT), untuk yang host-nya kosong */
  oltLinks: Map<string, string> = new Map(),
): {
  customers: MapCustomer[];
  devices: MapDevice[];
  routes: CableRoute[];
  segments: CableSegment[];
} {
  // Titik OLT di peta ditautkan ke OLT operasional hanya lewat host yang sama (tanpa menebak nama)
  const oltByHost = new Map(
    olts.filter((o) => o.host).map((o) => [o.host!.trim(), o]),
  );
  const portsOf = (oltId: string) =>
    ponPorts
      .filter((p) => p.oltId === oltId)
      .sort((a, b) => a.ponIndex - b.ponIndex)
      .map((p) => ({
        ponIndex: p.ponIndex,
        onuOnline: p.onuOnlineCount ?? 0,
        rxPower: p.rxPower,
      }));

  const devices: MapDevice[] = rawDevices
    .filter((d) => DEVICE_TYPE[d.type])
    .map((d) => ({
      id: d.id,
      name: d.name,
      type: DEVICE_TYPE[d.type],
      latitude: d.latitude,
      longitude: d.longitude,
      capacity: d.capacity ?? 0,
      status: DEVICE_STATUS[d.status] ?? "normal",
      parentDeviceId: d.parentId,
      notes: d.description,
      ...(() => {
        const olt =
          (d.host ? oltByHost.get(d.host.trim()) : undefined) ??
          olts.find((o) => o.id === oltLinks.get(d.id));
        return olt ? { ponPorts: portsOf(olt.id), centralOlt: { id: olt.id, name: olt.name } } : {};
      })(),
    }));

  // Pusat menautkan pelanggan ke ODP lewat nama bebas (odpName), bukan ID
  const odpIdByName = new Map(
    rawDevices
      .filter((d) => d.type === "odp")
      .map((d) => [normalizeName(d.name), d.id]),
  );

  const onuByCustomer = new Map(
    onus.filter((o) => o.customerId).map((o) => [o.customerId!, o]),
  );
  const oltName = new Map(olts.map((o) => [o.id, o.name]));
  // Paket dari billing: custId = awalan username PPPoE (sebelum "@")
  const packageByCustId = new Map(
    billingCustomers.map((b) => [String(b.custId), b.serviceProfile]),
  );

  const customers: MapCustomer[] = rawCustomers.map((c) => {
    const onu = onuByCustomer.get(c.id);
    return {
    id: c.id,
    name: c.name,
    customerNumber: c.pppoeUsername,
    address: c.address ?? "",
    region: "", // shortcut: pusat belum punya wilayah pelanggan; isi saat kolomnya ada
    // "loss" butuh status LOS ONU, belum tersedia di dataset customers
    status:
      c.billingStatus === "isolir"
        ? "isolir"
        : c.isOnline
          ? "terhubung"
          : "offline",
    billingStatus: c.billingStatus,
    latitude: c.latitude,
    longitude: c.longitude,
    packagePlan: packageByCustId.get(c.pppoeUsername.split("@")[0]) ?? null,
    monthlyFee: null,
    opticalPower: c.opticalPower ?? onu?.rxPower ?? undefined,
    odpId: c.odpName ? (odpIdByName.get(normalizeName(c.odpName)) ?? null) : null,
    onuSerial: onu?.serialNumber ?? undefined,
    onuStatus: onu?.status,
    onuLocation: onu
      ? `${oltName.get(onu.oltId) ?? "OLT"} • PON ${onu.ponIndex} / ONU ${onu.onuIndex}`
      : undefined,
    };
  });

  const statusByCustomer = new Map(customers.map((c) => [c.id, c.status]));
  for (const d of devices) {
    d.connectedCustomersCount = customers.filter((c) => c.odpId === d.id).length;
  }

  const routes: CableRoute[] = [];
  const segments: CableSegment[] = [];
  for (const cable of rawCables) {
    const geometry = Array.isArray(cable.polyline)
      ? cable.polyline.filter(isCoord)
      : [];
    if (geometry.length < 2) continue;
    const toCustomer = cable.targetType === "customer" ? cable.targetId : null;
    const toDevice = toCustomer ? null : cable.targetId;
    // Panjang dihitung dari geometri, bukan lengthMeters isian pusat
    const { samples, totalLengthM } = generateSegmentSamples(
      geometry,
      sampleIntervalM,
    );
    const status = toCustomer ? statusByCustomer.get(toCustomer) : undefined;

    routes.push({
      id: cable.id,
      code: cable.name,
      name: cable.name,
      cableType: cable.cableType,
      fiberCapacity: cable.coreCapacity,
      fromDeviceId: cable.sourceId,
      toDeviceId: toDevice,
      samplingIntervalM: sampleIntervalM,
      totalLengthM,
      readOnly: true,
    });
    segments.push({
      id: cable.id,
      routeId: cable.id,
      fromDeviceId: cable.sourceId,
      toDeviceId: toDevice,
      customerId: toCustomer,
      sequence: 1,
      geometry,
      lengthM: totalLengthM,
      // Pusat tidak mencatat snapping, jadi jangan diklaim menempel jalan
      snapped: false,
      snapProvider: "central-api",
      snapToleranceM: 0,
      snappedAt: null,
      connectionStatus:
        status === "terhubung" || status === "isolir" || status === "loss"
          ? status
          : toCustomer
            ? "unknown"
            : null,
      samples: samples.map((s) => ({ ...s, id: `${cable.id}:${s.sequence}`, segmentId: cable.id })),
    });
  }

  return { customers, devices, routes, segments };
}

export interface LocalOverride {
  entityType: string; // 'customer' | 'device'
  entityId: string;
  latitude: number | null;
  longitude: number | null;
  parentDeviceId: string | null;
  parentCleared: boolean;
  notes: string | null;
  odpPort?: number | null;
  splitterRatio?: number | null;
  splitterTap?: number | null;
  odcPort?: number | null;
  deviceType?: string | null;
  name?: string | null;
  hidden: boolean;
}

type MapParts = {
  customers: MapCustomer[];
  devices: MapDevice[];
  routes: CableRoute[];
  segments: CableSegment[];
};

const toConnection = (
  status: MapCustomer["status"] | undefined,
): CableSegment["connectionStatus"] =>
  status === "terhubung" || status === "isolir" || status === "loss"
    ? status
    : "unknown";

// Data pusat + koreksi lokal (geser/induk/keterangan/sembunyikan) + data buatan aplikasi ini.
// Data pusat sendiri tidak pernah diubah; kolom koreksi null = ikut nilai pusat.
export function mergeMapData(
  central: MapParts,
  local: MapParts,
  overrides: LocalOverride[],
): MapParts {
  const byKey = new Map(
    overrides.map((o) => [`${o.entityType}:${o.entityId}`, o]),
  );
  const coords = <T extends { latitude: number | null; longitude: number | null }>(
    entity: T,
    o: LocalOverride | undefined,
  ): T =>
    o && o.latitude !== null && o.longitude !== null
      ? { ...entity, latitude: o.latitude, longitude: o.longitude }
      : entity;

  const customers = [
    ...central.customers
      .filter((c) => !byKey.get(`customer:${c.id}`)?.hidden)
      .map((c) => {
        const o = byKey.get(`customer:${c.id}`);
        // parentDeviceId pada koreksi pelanggan = ODP pilihan peta, menimpa tautan nama dari pusat
        return { ...coords(c, o), odpId: o?.parentDeviceId ?? c.odpId, odpPort: o?.odpPort ?? null };
      }),
    ...local.customers,
  ];

  const servedBy = new Map<string, number>();
  for (const c of customers) {
    if (c.odpId) servedBy.set(c.odpId, (servedBy.get(c.odpId) ?? 0) + 1);
  }
  const devices = [
    ...central.devices
      .filter((d) => !byKey.get(`device:${d.id}`)?.hidden)
      .map((d) => {
        const o = byKey.get(`device:${d.id}`);
        if (!o) return d;
        return {
          ...coords(d, o),
          parentDeviceId: o.parentCleared
            ? null
            : (o.parentDeviceId ?? d.parentDeviceId),
          notes: o.notes ?? d.notes,
          name: o.name ?? d.name,
          splitterRatio: o.splitterRatio ?? null,
          splitterTap: o.splitterTap ?? null,
          odcPort: o.odcPort ?? null,
          // Koreksi jenis hanya ODP <-> ODC
          type: o.deviceType === "odp" || o.deviceType === "odc" ? o.deviceType : d.type,
        };
      }),
    ...local.devices,
  ].map((d) => ({ ...d, connectedCustomersCount: servedBy.get(d.id) ?? 0 }));

  const statusOf = new Map(customers.map((c) => [c.id, c.status]));
  const segments = [...central.segments, ...local.segments].map((s) =>
    s.customerId
      ? { ...s, connectionStatus: toConnection(statusOf.get(s.customerId) ?? undefined) }
      : s,
  );

  return {
    customers,
    devices,
    routes: [...central.routes, ...local.routes],
    segments,
  };
}
