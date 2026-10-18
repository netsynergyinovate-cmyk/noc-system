import "server-only";
import { and, asc, eq, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, customers, oltOnus, olts, routers } from "@/db/schema";
import type {
  UpdateCustomerLocationInput,
  GeocodedCustomersQueryInput,
  ViewportCustomersQueryInput,
} from "@/validators/customer-location";
import { getLocalMockMapData } from "./network-map-mock";

export interface ResolvedViewportBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  bufferedMinLat: number;
  bufferedMaxLat: number;
  bufferedMinLng: number;
  bufferedMaxLng: number;
  buffer: number;
}

export function resolveViewportBounds(
  params?: {
    minLat?: number;
    maxLat?: number;
    minLng?: number;
    maxLng?: number;
    south?: number;
    north?: number;
    west?: number;
    east?: number;
    bbox?: string;
    buffer?: number;
  },
): ResolvedViewportBounds | null {
  if (!params) return null;

  let minLat = params.minLat ?? params.south;
  let maxLat = params.maxLat ?? params.north;
  let minLng = params.minLng ?? params.west;
  let maxLng = params.maxLng ?? params.east;

  if (params.bbox) {
    const parts = params.bbox.split(",").map((s) => Number(s.trim()));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      minLng = parts[0];
      minLat = parts[1];
      maxLng = parts[2];
      maxLat = parts[3];
    }
  }

  if (
    minLat === undefined ||
    maxLat === undefined ||
    minLng === undefined ||
    maxLng === undefined ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLat) ||
    !Number.isFinite(minLng) ||
    !Number.isFinite(maxLng)
  ) {
    return null;
  }

  const realMinLat = Math.min(minLat, maxLat);
  const realMaxLat = Math.max(minLat, maxLat);
  const realMinLng = Math.min(minLng, maxLng);
  const realMaxLng = Math.max(minLng, maxLng);

  const buffer = params.buffer ?? 0.15;
  const latSpan = Math.max(realMaxLat - realMinLat, 0.0001);
  const lngSpan = Math.max(realMaxLng - realMinLng, 0.0001);

  return {
    minLat: realMinLat,
    maxLat: realMaxLat,
    minLng: realMinLng,
    maxLng: realMaxLng,
    bufferedMinLat: realMinLat - latSpan * buffer,
    bufferedMaxLat: realMaxLat + latSpan * buffer,
    bufferedMinLng: realMinLng - lngSpan * buffer,
    bufferedMaxLng: realMaxLng + lngSpan * buffer,
    buffer,
  };
}

export interface UpdatedCustomerLocationResult {
  id: string;
  name: string;
  pppoeUsername: string;
  latitude: number;
  longitude: number;
  lastUpdatedAt: Date;
}

export interface GeocodedCustomerItem {
  id: string;
  name: string;
  pppoeUsername: string;
  routerId: string;
  routerName: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  odpName: string | null;
  billingStatus: "lunas" | "isolir";
  opticalPower: number | null;
  isOnline: boolean;
  lastUpdatedAt: Date;
  onuDetails: {
    serialNumber: string | null;
    ponIndex: number | null;
    onuIndex: number | null;
    opticalLevel: number | null;
  } | null;
}

export interface GeocodedCustomersResult {
  customers: GeocodedCustomerItem[];
  summary: {
    totalGeocoded: number;
    onlineCount: number;
    offlineCount: number;
    weakOpticalCount: number;
    isolirCount: number;
    filteredCount?: number;
    limit?: number;
    offset?: number;
  };
  dataSource: {
    provider: string;
    isRealData: boolean;
    lastSynchronizedAt: string;
  };
}

export async function updateCustomerLocation(
  customerId: string,
  input: UpdateCustomerLocationInput,
  actorUserId?: string,
): Promise<UpdatedCustomerLocationResult> {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      customerId,
    );

  try {
    const condition = isUuid
      ? or(eq(customers.id, customerId), eq(customers.pppoeUsername, customerId))
      : eq(customers.pppoeUsername, customerId);

    const existing = await db
      .select({
        id: customers.id,
        name: customers.name,
        pppoeUsername: customers.pppoeUsername,
        prevLat: customers.latitude,
        prevLng: customers.longitude,
      })
      .from(customers)
      .where(condition)
      .limit(1);

    if (existing.length === 0) {
      if (process.env.NODE_ENV !== "production") {
        const mock = getLocalMockMapData();
        const mockFound = mock.customers.find(
          (c) => c.id === customerId || c.pppoeUsername === customerId,
        );
        if (mockFound) {
          mockFound.latitude = input.latitude;
          mockFound.longitude = input.longitude;
          mockFound.lastUpdatedAt = new Date();
          return {
            id: mockFound.id,
            name: mockFound.name,
            pppoeUsername: mockFound.pppoeUsername,
            latitude: input.latitude,
            longitude: input.longitude,
            lastUpdatedAt: mockFound.lastUpdatedAt,
          };
        }
      }
      throw new Error(`Pelanggan dengan ID '${customerId}' tidak ditemukan di database.`);
    }

    const prev = existing[0];

    const updatedRows = await db
      .update(customers)
      .set({
        latitude: input.latitude,
        longitude: input.longitude,
        lastUpdatedAt: new Date(),
      })
      .where(eq(customers.id, prev.id))
      .returning({
        id: customers.id,
        name: customers.name,
        pppoeUsername: customers.pppoeUsername,
        latitude: customers.latitude,
        longitude: customers.longitude,
        lastUpdatedAt: customers.lastUpdatedAt,
      });

    if (updatedRows.length === 0) {
      throw new Error(`Gagal memperbarui posisi koordinat pelanggan '${customerId}'.`);
    }

    const updated = updatedRows[0];

    // Catat jejak audit perpindahan koordinat pelanggan bila user terautentikasi
    if (actorUserId) {
      try {
        await db.insert(auditLog).values({
          userId: actorUserId,
          action: "update_customer_location",
          target: `customer:${customerId}`,
          detail: {
            customerName: prev.name,
            pppoeUsername: prev.pppoeUsername,
            prevCoordinates: [prev.prevLat, prev.prevLng],
            newCoordinates: [input.latitude, input.longitude],
          },
        });
      } catch {
        // Abaikan kegagalan audit log agar tidak menghambat pembaruan posisi utama
      }
    }

    return {
      id: updated.id,
      name: updated.name,
      pppoeUsername: updated.pppoeUsername,
      latitude: Number(updated.latitude),
      longitude: Number(updated.longitude),
      lastUpdatedAt: updated.lastUpdatedAt,
    };
  } catch (err) {
    if (
      process.env.NODE_ENV !== "production" &&
      err instanceof Error &&
      !err.message.includes("tidak ditemukan")
    ) {
      const mock = getLocalMockMapData();
      const mockFound = mock.customers.find(
        (c) => c.id === customerId || c.pppoeUsername === customerId,
      );
      if (mockFound) {
        mockFound.latitude = input.latitude;
        mockFound.longitude = input.longitude;
        mockFound.lastUpdatedAt = new Date();
        return {
          id: mockFound.id,
          name: mockFound.name,
          pppoeUsername: mockFound.pppoeUsername,
          latitude: input.latitude,
          longitude: input.longitude,
          lastUpdatedAt: mockFound.lastUpdatedAt,
        };
      }
    }
    throw err;
  }
}

export async function getCustomerCoordinates(customerId: string) {
  const existing = await db
    .select({
      id: customers.id,
      name: customers.name,
      pppoeUsername: customers.pppoeUsername,
      latitude: customers.latitude,
      longitude: customers.longitude,
      odpName: customers.odpName,
      address: customers.address,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (existing.length === 0) {
    return null;
  }

  const row = existing[0];
  return {
    id: row.id,
    name: row.name,
    pppoeUsername: row.pppoeUsername,
    latitude: row.latitude !== null ? Number(row.latitude) : null,
    longitude: row.longitude !== null ? Number(row.longitude) : null,
    odpName: row.odpName,
    address: row.address,
  };
}

export async function clearCustomerLocation(
  customerId: string,
  actorUserId?: string,
): Promise<{ id: string; name: string }> {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId);
  const condition = isUuid
    ? or(eq(customers.id, customerId), eq(customers.pppoeUsername, customerId))
    : eq(customers.pppoeUsername, customerId);

  const existing = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(condition)
    .limit(1);

  if (existing.length === 0) {
    throw new Error(`Pelanggan dengan ID '${customerId}' tidak ditemukan.`);
  }

  await db
    .update(customers)
    .set({ latitude: null, longitude: null, lastUpdatedAt: new Date() })
    .where(eq(customers.id, existing[0].id));

  if (actorUserId) {
    try {
      await db.insert(auditLog).values({
        userId: actorUserId,
        action: "clear_customer_location",
        target: `customer:${customerId}`,
        detail: { customerName: existing[0].name },
      });
    } catch {
      // Abaikan kegagalan audit log
    }
  }

  return existing[0];
}

export function applyCustomerQueryFilters(
  items: GeocodedCustomerItem[],
  query?: GeocodedCustomersQueryInput,
): {
  filtered: GeocodedCustomerItem[];
  summary: {
    totalGeocoded: number;
    onlineCount: number;
    offlineCount: number;
    weakOpticalCount: number;
    isolirCount: number;
    filteredCount: number;
    limit: number;
    offset: number;
  };
} {
  const totalGeocoded = items.length;
  const onlineCount = items.filter((c) => c.isOnline).length;
  const offlineCount = totalGeocoded - onlineCount;
  const weakOpticalCount = items.filter(
    (c) => c.opticalPower !== null && c.opticalPower <= -24.5,
  ).length;
  const isolirCount = items.filter((c) => c.billingStatus === "isolir").length;

  let filtered = items;

  if (query?.status && query.status !== "all") {
    if (query.status === "online") filtered = filtered.filter((c) => c.isOnline);
    if (query.status === "offline") filtered = filtered.filter((c) => !c.isOnline);
    if (query.status === "weak") {
      filtered = filtered.filter(
        (c) => c.opticalPower !== null && c.opticalPower <= -24.5,
      );
    }
    if (query.status === "warning") {
      filtered = filtered.filter(
        (c) =>
          c.opticalPower !== null &&
          c.opticalPower > -24.5 &&
          c.opticalPower <= -23.0,
      );
    }
    if (query.status === "normal") {
      filtered = filtered.filter(
        (c) => c.opticalPower !== null && c.opticalPower > -23.0,
      );
    }
    if (query.status === "isolir") {
      filtered = filtered.filter((c) => c.billingStatus === "isolir");
    }
    if (query.status === "geocoded") {
      filtered = filtered.filter(
        (c) =>
          c.latitude !== null &&
          c.longitude !== null &&
          Number.isFinite(c.latitude) &&
          Number.isFinite(c.longitude),
      );
    }
  }

  if (query?.billingStatus && query.billingStatus !== "all") {
    filtered = filtered.filter((c) => c.billingStatus === query.billingStatus);
  }

  if (query?.opticalStatus && query.opticalStatus !== "all") {
    if (query.opticalStatus === "critical") {
      filtered = filtered.filter(
        (c) => c.opticalPower !== null && c.opticalPower <= -24.5,
      );
    } else if (query.opticalStatus === "warning") {
      filtered = filtered.filter(
        (c) =>
          c.opticalPower !== null &&
          c.opticalPower > -24.5 &&
          c.opticalPower <= -23.0,
      );
    } else if (query.opticalStatus === "normal") {
      filtered = filtered.filter(
        (c) => c.opticalPower !== null && c.opticalPower > -23.0,
      );
    }
  }

  const effectiveOdp = (query?.odp || query?.region || "").trim().toLowerCase();
  if (effectiveOdp) {
    filtered = filtered.filter(
      (c) => c.odpName && c.odpName.toLowerCase().includes(effectiveOdp),
    );
  }

  const effectiveSearch = (query?.search || query?.q || "").trim().toLowerCase();
  if (effectiveSearch) {
    filtered = filtered.filter(
      (c) =>
        c.name.toLowerCase().includes(effectiveSearch) ||
        c.pppoeUsername.toLowerCase().includes(effectiveSearch) ||
        (c.address && c.address.toLowerCase().includes(effectiveSearch)),
    );
  }

  if (query?.routerId) {
    filtered = filtered.filter((c) => c.routerId === query.routerId);
  }

  const bounds = resolveViewportBounds(query);
  if (bounds) {
    filtered = filtered.filter(
      (c) =>
        c.latitude >= bounds.bufferedMinLat &&
        c.latitude <= bounds.bufferedMaxLat &&
        c.longitude >= bounds.bufferedMinLng &&
        c.longitude <= bounds.bufferedMaxLng,
    );
  }

  const filteredCount = filtered.length;
  const limit = query?.limit ?? 500;
  const offset = query?.offset ?? 0;
  const paginated = filtered.slice(offset, offset + limit);

  return {
    filtered: paginated,
    summary: {
      totalGeocoded,
      onlineCount,
      offlineCount,
      weakOpticalCount,
      isolirCount,
      filteredCount,
      limit,
      offset,
    },
  };
}

export async function getGeocodedCustomers(
  query?: GeocodedCustomersQueryInput,
): Promise<GeocodedCustomersResult> {
  const isExplicitMock = query?.forceMock === true;

  if (isExplicitMock) {
    const mock = getLocalMockMapData();
    const rawItems: GeocodedCustomerItem[] = mock.customers
      .filter((c): c is typeof c & { latitude: number; longitude: number } =>
        c.latitude !== null && c.longitude !== null &&
        Number.isFinite(c.latitude) && Number.isFinite(c.longitude),
      )
      .map((c) => ({
        id: c.id,
        name: c.name,
        pppoeUsername: c.pppoeUsername,
        routerId: c.routerId,
        routerName: c.routerName ?? null,
        address: c.address,
        latitude: c.latitude,
        longitude: c.longitude,
        odpName: c.odpName,
        billingStatus: c.billingStatus,
        opticalPower: c.opticalPower,
        isOnline: c.isOnline,
        lastUpdatedAt: c.lastUpdatedAt,
        onuDetails: c.onuDetails ?? null,
      }));

    const { filtered, summary } = applyCustomerQueryFilters(rawItems, query);

    return {
      customers: filtered,
      summary,
      dataSource: {
        provider: "Mock Simulation Demo",
        isRealData: false,
        lastSynchronizedAt: new Date().toISOString(),
      },
    };
  }

  try {
    const rawRows = await db
      .select({
        id: customers.id,
        name: customers.name,
        pppoeUsername: customers.pppoeUsername,
        routerId: customers.routerId,
        routerName: routers.name,
        address: customers.address,
        latitude: customers.latitude,
        longitude: customers.longitude,
        odpName: customers.odpName,
        billingStatus: customers.billingStatus,
        opticalPower: customers.opticalPower,
        isOnline: customers.isOnline,
        lastUpdatedAt: customers.lastUpdatedAt,
        onuSerial: oltOnus.serialNumber,
        onuPonIndex: oltOnus.ponIndex,
        onuIndex: oltOnus.onuIndex,
        onuRxPower: oltOnus.rxPower,
      })
      .from(customers)
      .leftJoin(routers, eq(customers.routerId, routers.id))
      .leftJoin(oltOnus, eq(oltOnus.customerId, customers.id))
      .where(
        and(
          isNotNull(customers.latitude),
          isNotNull(customers.longitude),
        ),
      )
      .orderBy(asc(customers.name));

    const rawItems: GeocodedCustomerItem[] = rawRows
      .filter((r) => r.latitude !== null && r.longitude !== null && Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)))
      .map((r) => ({
        id: r.id,
        name: r.name,
        pppoeUsername: r.pppoeUsername,
        routerId: r.routerId,
        routerName: r.routerName ?? null,
        address: r.address,
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        odpName: r.odpName,
        billingStatus: (r.billingStatus as "lunas" | "isolir") || "lunas",
        opticalPower: r.opticalPower !== null ? Number(r.opticalPower) : null,
        isOnline: Boolean(r.isOnline),
        lastUpdatedAt: r.lastUpdatedAt ?? new Date(),
        onuDetails: r.onuSerial
          ? {
              serialNumber: r.onuSerial,
              ponIndex: r.onuPonIndex,
              onuIndex: r.onuIndex,
              opticalLevel: r.onuRxPower !== null ? Number(r.onuRxPower) : null,
            }
          : null,
      }));

    const { filtered, summary } = applyCustomerQueryFilters(rawItems, query);

    return {
      customers: filtered,
      summary,
      dataSource: {
        provider: "PostgreSQL Live",
        isRealData: true,
        lastSynchronizedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.error("[GET GEOCODED CUSTOMERS DB ERROR]", err);
    throw err;
  }
}

export interface CustomerMapDetail {
  id: string;
  name: string;
  pppoeUsername: string;
  routerId: string;
  routerName: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  odpName: string | null;
  billingStatus: "lunas" | "isolir";
  opticalPower: number | null;
  isOnline: boolean;
  lastUpdatedAt: Date | string;
  onuDetails: {
    id?: string | null;
    serialNumber: string | null;
    ponIndex: number | null;
    onuIndex: number | null;
    opticalLevel: number | null;
    txPower?: number | null;
    attenuation?: number | null;
    status?: string | null;
    model?: string | null;
    oltId?: string | null;
    oltName?: string | null;
  } | null;
  dataSource: {
    provider: string;
    isRealData: boolean;
    lastSynchronizedAt: string;
  };
}

export async function getCustomerMapDetail(
  customerId: string,
  options?: { forceMock?: boolean },
): Promise<CustomerMapDetail | null> {
  const isExplicitMock = options?.forceMock === true;

  if (isExplicitMock) {
    const mock = getLocalMockMapData();
    const found = mock.customers.find(
      (c) => c.id === customerId || c.pppoeUsername === customerId,
    );

    if (!found) {
      return null;
    }

    return {
      id: found.id,
      name: found.name,
      pppoeUsername: found.pppoeUsername,
      routerId: found.routerId,
      routerName: found.routerName ?? null,
      address: found.address ?? null,
      latitude:
        found.latitude !== null && Number.isFinite(found.latitude)
          ? found.latitude
          : null,
      longitude:
        found.longitude !== null && Number.isFinite(found.longitude)
          ? found.longitude
          : null,
      odpName: found.odpName ?? null,
      billingStatus: (found.billingStatus as "lunas" | "isolir") || "lunas",
      opticalPower:
        found.opticalPower !== null && Number.isFinite(found.opticalPower)
          ? found.opticalPower
          : null,
      isOnline: Boolean(found.isOnline),
      lastUpdatedAt: found.lastUpdatedAt ?? new Date(),
      onuDetails: found.onuDetails
        ? {
            serialNumber: found.onuDetails.serialNumber,
            ponIndex: found.onuDetails.ponIndex,
            onuIndex: found.onuDetails.onuIndex,
            opticalLevel: found.onuDetails.opticalLevel,
            txPower: null,
            attenuation: null,
            status: found.isOnline ? "online" : "offline",
            model: "ZTE F609",
            oltId: null,
            oltName: "OLT-ZTE-CORE",
          }
        : null,
      dataSource: {
        provider: "Mock Simulation Demo",
        isRealData: false,
        lastSynchronizedAt: new Date().toISOString(),
      },
    };
  }

  try {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        customerId,
      );

    const condition = isUuid
      ? or(eq(customers.id, customerId), eq(customers.pppoeUsername, customerId))
      : eq(customers.pppoeUsername, customerId);

    const rows = await db
      .select({
        id: customers.id,
        name: customers.name,
        pppoeUsername: customers.pppoeUsername,
        routerId: customers.routerId,
        routerName: routers.name,
        address: customers.address,
        latitude: customers.latitude,
        longitude: customers.longitude,
        odpName: customers.odpName,
        billingStatus: customers.billingStatus,
        opticalPower: customers.opticalPower,
        isOnline: customers.isOnline,
        lastUpdatedAt: customers.lastUpdatedAt,
        onuId: oltOnus.id,
        onuSerial: oltOnus.serialNumber,
        onuPonIndex: oltOnus.ponIndex,
        onuIndex: oltOnus.onuIndex,
        onuRxPower: oltOnus.rxPower,
        onuTxPower: oltOnus.txPower,
        onuAttenuation: oltOnus.attenuation,
        onuStatus: oltOnus.status,
        onuModel: oltOnus.model,
        oltId: oltOnus.oltId,
        oltName: olts.name,
      })
      .from(customers)
      .leftJoin(routers, eq(customers.routerId, routers.id))
      .leftJoin(oltOnus, eq(oltOnus.customerId, customers.id))
      .leftJoin(olts, eq(oltOnus.oltId, olts.id))
      .where(condition)
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      pppoeUsername: r.pppoeUsername,
      routerId: r.routerId,
      routerName: r.routerName ?? null,
      address: r.address,
      latitude: r.latitude !== null ? Number(r.latitude) : null,
      longitude: r.longitude !== null ? Number(r.longitude) : null,
      odpName: r.odpName,
      billingStatus: (r.billingStatus as "lunas" | "isolir") || "lunas",
      opticalPower: r.opticalPower !== null ? Number(r.opticalPower) : null,
      isOnline: Boolean(r.isOnline),
      lastUpdatedAt: r.lastUpdatedAt ?? new Date(),
      onuDetails: r.onuSerial
        ? {
            id: r.onuId,
            serialNumber: r.onuSerial,
            ponIndex: r.onuPonIndex,
            onuIndex: r.onuIndex,
            opticalLevel: r.onuRxPower !== null ? Number(r.onuRxPower) : null,
            txPower: r.onuTxPower !== null ? Number(r.onuTxPower) : null,
            attenuation: r.onuAttenuation !== null ? Number(r.onuAttenuation) : null,
            status: r.onuStatus,
            model: r.onuModel,
            oltId: r.oltId,
            oltName: r.oltName,
          }
        : null,
      dataSource: {
        provider: "PostgreSQL Live",
        isRealData: true,
        lastSynchronizedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.error("[GET CUSTOMER MAP DETAIL DB ERROR]", err);
    throw err;
  }
}

export interface CustomersByViewportResult {
  customers: GeocodedCustomerItem[];
  summary: {
    totalInViewport: number;
    totalGeocoded: number;
    onlineCount: number;
    offlineCount: number;
    weakOpticalCount: number;
    isolirCount: number;
    bounds: ResolvedViewportBounds | null;
  };
  dataSource: {
    provider: string;
    isRealData: boolean;
    lastSynchronizedAt: string;
  };
}

/**
 * Mengambil daftar titik pelanggan ter-geocoded yang berada di dalam area pandang (viewport bounding box) peta.
 */
export async function getCustomersByViewport(
  query: ViewportCustomersQueryInput,
): Promise<CustomersByViewportResult> {
  const result = await getGeocodedCustomers(query);
  const bounds = resolveViewportBounds(query);

  return {
    customers: result.customers,
    summary: {
      totalInViewport: result.customers.length,
      totalGeocoded: result.summary.totalGeocoded,
      onlineCount: result.summary.onlineCount,
      offlineCount: result.summary.offlineCount,
      weakOpticalCount: result.summary.weakOpticalCount,
      isolirCount: result.summary.isolirCount,
      bounds,
    },
    dataSource: result.dataSource,
  };
}

