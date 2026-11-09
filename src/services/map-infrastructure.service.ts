import "server-only";
import { eq, or, ilike } from "drizzle-orm";
import { db } from "@/db";
import { effectiveBillingStatusSql } from "./customer-isolir";
import {
  auditLog,
  networkInfrastructure,
  networkCables,
  customers,
  routers,
  olts,
} from "@/db/schema";
import type { NetworkInfrastructurePoint } from "./network-map.service";
import type {
  CreateInfrastructurePointInput,
  UpdateInfrastructureLocationInput,
  InfrastructureQueryInput,
} from "@/validators/infrastructure-placement";
import { getLocalMockMapData } from "./network-map-mock";
import { getRoute, getLastOdpInRoute, connectOdp } from "./route.service";

export async function createInfrastructurePoint(
  input: CreateInfrastructurePointInput,
  actorUserId?: string,
): Promise<NetworkInfrastructurePoint> {
  const generatedId = `${input.type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const newPoint: NetworkInfrastructurePoint = {
    id: generatedId,
    name: input.name,
    type: input.type,
    host: input.host || undefined,
    status: "active",
    latitude: input.latitude,
    longitude: input.longitude,
    details: {
      ...input.details,
      placementSource: "NOC Infrastructure Map Tool",
      createdAt: new Date().toISOString(),
    },
  };

  try {
    await db.insert(networkInfrastructure).values({
      id: generatedId,
      name: input.name,
      type: input.type,
      host: input.host || null,
      status: "active",
      latitude: input.latitude,
      longitude: input.longitude,
      routeId: input.routeId ?? null,
      details: {
        ...input.details,
        placementSource: "NOC Infrastructure Map Tool",
      },
    });
  } catch (err) {
    console.error("[INSERT INFRASTRUCTURE DB ERROR]", err);
    // Tetap kembalikan newPoint bila koneksi offline saat simulasi
  }

  // Auto-connect ODP ke tail node jika routeId diberikan
  if (input.routeId && input.type === "odp") {
    try {
      const route = await getRoute(input.routeId);
      if (route) {
        const tail = await getLastOdpInRoute(input.routeId);
        const parentId = tail?.id ?? route.odcId ?? route.oltId;
        if (parentId) {
          await connectOdp(generatedId, parentId, input.routeId);
        }
      }
    } catch (err) {
      console.error("[AUTO_CONNECT_ODP_ERROR]", err);
    }
  }

  // Jejak audit aksi teknisi
  if (actorUserId) {
    try {
      await db.insert(auditLog).values({
        userId: actorUserId,
        action: "create_infrastructure_point",
        target: `infrastructure:${input.type}:${generatedId}`,
        detail: {
          name: input.name,
          type: input.type,
          coordinates: [input.latitude, input.longitude],
          host: input.host,
        },
      });
    } catch {
      // Abaikan kegagalan audit jika database log sedang sibuk
    }
  }

  return newPoint;
}

export async function updateInfrastructureLocation(
  id: string,
  input: UpdateInfrastructureLocationInput,
  actorUserId?: string,
): Promise<{
  id: string;
  latitude: number;
  longitude: number;
  updatedAt: string;
}> {
  if (!id || typeof id !== "string") {
    throw new Error("ID perangkat infrastruktur tidak valid.");
  }

  if (
    typeof input.latitude !== "number" ||
    !Number.isFinite(input.latitude) ||
    typeof input.longitude !== "number" ||
    !Number.isFinite(input.longitude)
  ) {
    throw new Error(
      "Koordinat latitude dan longitude harus berupa angka valid.",
    );
  }

  const updatedAt = new Date().toISOString();

  // Router/OLT dari tabel operasional — simpan koordinat ke tabel asalnya
  if (id.startsWith("router-")) {
    const routerId = id.slice("router-".length);
    await db
      .update(routers)
      .set({ latitude: input.latitude, longitude: input.longitude })
      .where(eq(routers.id, routerId));
    return {
      id,
      latitude: input.latitude,
      longitude: input.longitude,
      updatedAt,
    };
  }

  if (id.startsWith("olt-")) {
    const oltId = id.slice("olt-".length);
    await db
      .update(olts)
      .set({ latitude: input.latitude, longitude: input.longitude })
      .where(eq(olts.id, oltId));
    return {
      id,
      latitude: input.latitude,
      longitude: input.longitude,
      updatedAt,
    };
  }

  try {
    await db
      .update(networkInfrastructure)
      .set({
        latitude: input.latitude,
        longitude: input.longitude,
        ...(input.address ? { address: input.address } : {}),
        updatedAt: new Date(),
      })
      .where(
        or(
          eq(networkInfrastructure.id, id),
          ilike(networkInfrastructure.name, id),
        ),
      );
  } catch (err) {
    console.error("[UPDATE INFRASTRUCTURE DB ERROR]", err);
  }

  // Catat riwayat perpindahan perangkat ke audit log
  if (actorUserId) {
    try {
      await db.insert(auditLog).values({
        userId: actorUserId,
        action: "move_infrastructure_point",
        target: `infrastructure:${id}`,
        detail: {
          id,
          newCoordinates: [input.latitude, input.longitude],
          movedAt: updatedAt,
        },
      });
    } catch {
      // Log audit opsional
    }
  }

  return {
    id,
    latitude: input.latitude,
    longitude: input.longitude,
    updatedAt,
  };
}

export async function deleteInfrastructurePoint(
  id: string,
  actorUserId?: string,
): Promise<{
  id: string;
  name?: string;
  type?: string;
  deleted: boolean;
  deletedAt: string;
}> {
  if (!id || typeof id !== "string") {
    throw new Error("ID perangkat infrastruktur tidak valid.");
  }

  const deletedAt = new Date().toISOString();
  let deviceName: string | undefined;
  let deviceType: string | undefined;

  try {
    const existing = await db
      .select({
        id: networkInfrastructure.id,
        name: networkInfrastructure.name,
        type: networkInfrastructure.type,
      })
      .from(networkInfrastructure)
      .where(
        or(
          eq(networkInfrastructure.id, id),
          ilike(networkInfrastructure.name, id),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      deviceName = existing[0].name;
      deviceType = existing[0].type;
    }
  } catch {
    // Abaikan jika database query gagal
  }

  // Bersihkan kabel optik terkait perangkat ini
  try {
    await db
      .delete(networkCables)
      .where(
        or(eq(networkCables.sourceId, id), eq(networkCables.targetId, id)),
      );
  } catch {
    // Abaikan jika tabel kabel belum siap
  }

  // Lepaskan relasi parent_id pada perangkat turunan
  try {
    await db
      .update(networkInfrastructure)
      .set({ parentId: null })
      .where(eq(networkInfrastructure.parentId, id));
  } catch {
    // Abaikan
  }

  // Untuk router/OLT: hapus koordinat saja (device tetap ada di DB)
  if (id.startsWith("router-")) {
    const routerId = id.slice("router-".length);
    try {
      const rows = await db
        .update(routers)
        .set({ latitude: null, longitude: null })
        .where(eq(routers.id, routerId))
        .returning({ name: routers.name });
      if (rows.length > 0) deviceName = rows[0].name;
      deviceType = "router";
    } catch (err) {
      console.error("[DELETE ROUTER COORDS ERROR]", err);
    }
  } else if (id.startsWith("olt-")) {
    const oltId = id.slice("olt-".length);
    try {
      const rows = await db
        .update(olts)
        .set({ latitude: null, longitude: null })
        .where(eq(olts.id, oltId))
        .returning({ name: olts.name });
      if (rows.length > 0) deviceName = rows[0].name;
      deviceType = "olt";
    } catch (err) {
      console.error("[DELETE OLT COORDS ERROR]", err);
    }
  } else {
    // Hapus titik perangkat dari network_infrastructure
    try {
      await db
        .delete(networkInfrastructure)
        .where(
          or(
            eq(networkInfrastructure.id, id),
            ilike(networkInfrastructure.name, id),
          ),
        );
    } catch (err) {
      console.error("[DELETE INFRASTRUCTURE DB ERROR]", err);
    }
  }

  // Catat riwayat penghapusan perangkat ke audit log
  if (actorUserId) {
    try {
      await db.insert(auditLog).values({
        userId: actorUserId,
        action: "delete_infrastructure_point",
        target: `infrastructure:${id}`,
        detail: {
          id,
          name: deviceName,
          type: deviceType,
          deletedAt,
        },
      });
    } catch {
      // Log audit opsional
    }
  }

  return {
    id,
    name: deviceName,
    type: deviceType,
    deleted: true,
    deletedAt,
  };
}

export async function updateInfrastructureParent(
  id: string,
  parentId: string | null,
): Promise<{ id: string; parentId: string | null }> {
  if (!id) throw new Error("ID perangkat tidak valid.");
  await db
    .update(networkInfrastructure)
    .set({ parentId })
    .where(eq(networkInfrastructure.id, id));
  return { id, parentId };
}

export async function getNetworkInfrastructureList(): Promise<
  NetworkInfrastructurePoint[]
> {
  try {
    const rows = await db
      .select({
        id: networkInfrastructure.id,
        name: networkInfrastructure.name,
        type: networkInfrastructure.type,
        host: networkInfrastructure.host,
        status: networkInfrastructure.status,
        latitude: networkInfrastructure.latitude,
        longitude: networkInfrastructure.longitude,
        details: networkInfrastructure.details,
      })
      .from(networkInfrastructure);

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      host: r.host ?? undefined,
      status: r.status,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      details: (r.details as Record<string, unknown>) ?? undefined,
    }));
  } catch {
    return [];
  }
}

export interface InfrastructureSummary {
  total: number;
  totalRouters: number;
  totalOlts: number;
  totalOdps: number;
  totalOdcs: number;
  totalPoles: number;
  activeCount: number;
  inactiveCount: number;
  filteredCount?: number;
  limit?: number;
  offset?: number;
}

export interface InfrastructureListResult {
  infrastructure: NetworkInfrastructurePoint[];
  summary: InfrastructureSummary;
  dataSource: {
    provider: string;
    isRealData: boolean;
    lastSynchronizedAt: string;
  };
}

export async function getInfrastructureList(
  query?: InfrastructureQueryInput,
): Promise<InfrastructureListResult> {
  const isExplicitMock = query?.forceMock === true;

  let allItems: NetworkInfrastructurePoint[] = [];

  if (isExplicitMock) {
    const mock = getLocalMockMapData();
    allItems = [...mock.infrastructure];
  } else {
    // Ambil data murni dari database PostgreSQL operasional tanpa fallback ke mock
    const dbRows = await getNetworkInfrastructureList();
    allItems = dbRows;
  }

  const total = allItems.length;
  const totalRouters = allItems.filter((i) => i.type === "router").length;
  const totalOlts = allItems.filter((i) => i.type === "olt").length;
  const totalOdps = allItems.filter((i) => i.type === "odp").length;
  const totalOdcs = allItems.filter((i) => i.type === "odc").length;
  const totalPoles = allItems.filter((i) => i.type === "pole").length;
  const activeCount = allItems.filter((i) => i.status === "active").length;
  const inactiveCount = total - activeCount;

  let filtered = allItems;

  if (query?.type && query.type !== "all") {
    filtered = filtered.filter((i) => i.type === query.type);
  }

  if (query?.status && query.status !== "all") {
    filtered = filtered.filter((i) => i.status === query.status);
  }

  const searchKeyword = (query?.search || query?.q || "").trim().toLowerCase();
  if (searchKeyword) {
    filtered = filtered.filter(
      (i) =>
        i.name.toLowerCase().includes(searchKeyword) ||
        (i.host && i.host.toLowerCase().includes(searchKeyword)) ||
        (i.details &&
          typeof i.details === "object" &&
          JSON.stringify(i.details).toLowerCase().includes(searchKeyword)),
    );
  }

  const filteredCount = filtered.length;
  const limit = query?.limit ?? 500;
  const offset = query?.offset ?? 0;
  const paginated = filtered.slice(offset, offset + limit);

  return {
    infrastructure: paginated,
    summary: {
      total,
      totalRouters,
      totalOlts,
      totalOdps,
      totalOdcs,
      totalPoles,
      activeCount,
      inactiveCount,
      filteredCount,
      limit,
      offset,
    },
    dataSource: {
      provider: isExplicitMock ? "Mock Simulation Demo" : "PostgreSQL Live",
      isRealData: !isExplicitMock,
      lastSynchronizedAt: new Date().toISOString(),
    },
  };
}

export interface ConnectedCustomerSummary {
  id: string;
  name: string;
  pppoeUsername: string;
  isOnline: boolean;
  opticalPower: number | null;
  billingStatus: string;
  address: string | null;
  coordinates: {
    latitude: number | null;
    longitude: number | null;
  };
}

export interface InfrastructureHierarchyNode {
  id: string;
  name: string;
  type: string;
  status: string;
  latitude: number;
  longitude: number;
}

export interface ConnectedCableSummary {
  id: string;
  name: string;
  cableType: string;
  coreCapacity: number;
  color: string;
  lengthMeters: number | null;
  polyline: Array<[number, number]>;
  status: string;
  direction: "outgoing" | "incoming";
  connectedNodeId: string;
}

export interface InfrastructureDetailResult {
  device: {
    id: string;
    name: string;
    type: string;
    host?: string;
    status: string;
    latitude: number;
    longitude: number;
    parentId?: string | null;
    capacity?: number | null;
    usedCapacity: number;
    availableCapacity?: number | null;
    utilizationPercent?: number | null;
    description?: string | null;
    address?: string | null;
    details?: Record<string, unknown>;
    createdAt?: string;
    updatedAt?: string;
  };
  parent?: InfrastructureHierarchyNode | null;
  children: InfrastructureHierarchyNode[];
  cables: ConnectedCableSummary[];
  customers: ConnectedCustomerSummary[];
  customerStats: {
    total: number;
    online: number;
    offline: number;
    activeBilling: number;
    isolatedBilling: number;
  };
  hardwareStats?: {
    linkedDeviceId?: string;
    model?: string;
    osVersion?: string;
    brand?: string;
    cpuLoad?: number;
    memoryFree?: number;
    memoryTotal?: number;
    uptime?: string;
    lastSeenAt?: string;
    status?: string;
  } | null;
  dataSource: {
    provider: string;
    isRealData: boolean;
    lastSynchronizedAt: string;
  };
}

export async function getInfrastructureDetail(
  idOrName: string,
  options?: { forceMock?: boolean },
): Promise<InfrastructureDetailResult | null> {
  const queryTarget = (idOrName || "").trim();
  if (!queryTarget) return null;

  const isDemo = options?.forceMock || process.env.DASHBOARD_DATA === "demo";

  let foundDevice: {
    id: string;
    name: string;
    type: string;
    host?: string | null;
    status: string;
    latitude: number;
    longitude: number;
    parentId?: string | null;
    capacity?: number | null;
    usedCapacity?: number | null;
    description?: string | null;
    address?: string | null;
    details?: Record<string, unknown> | null;
    createdAt?: string;
    updatedAt?: string;
  } | null = null;

  let isRealData = false;

  if (!isDemo) {
    try {
      const rows = await db
        .select()
        .from(networkInfrastructure)
        .where(
          or(
            eq(networkInfrastructure.id, queryTarget),
            ilike(networkInfrastructure.name, queryTarget),
          ),
        )
        .limit(1);

      if (rows.length > 0) {
        const r = rows[0];
        foundDevice = {
          id: r.id,
          name: r.name,
          type: r.type,
          host: r.host,
          status: r.status,
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
          parentId: r.parentId,
          capacity: r.capacity,
          usedCapacity: r.usedCapacity,
          description: r.description,
          address: r.address,
          details: (r.details as Record<string, unknown>) ?? null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        };
        isRealData = true;
      }
    } catch (err) {
      console.error("[GET INFRASTRUCTURE DETAIL DB ERROR]", err);
    }
  }

  // Hanya cari di mock infrastructure jika opsi forceMock aktif secara eksplisit (misal untuk testing unit)
  if (!foundDevice && options?.forceMock) {
    const mock = getLocalMockMapData();
    const mockItem = mock.infrastructure.find(
      (i) =>
        i.id === queryTarget ||
        i.name.toLowerCase() === queryTarget.toLowerCase(),
    );

    if (mockItem) {
      foundDevice = {
        id: mockItem.id,
        name: mockItem.name,
        type: mockItem.type,
        host: mockItem.host,
        status: mockItem.status,
        latitude: mockItem.latitude,
        longitude: mockItem.longitude,
        parentId: null,
        capacity:
          typeof mockItem.details?.capacity === "string" &&
          mockItem.details.capacity.includes("16")
            ? 16
            : 8,
        usedCapacity:
          typeof mockItem.details?.connectedCustomers === "number"
            ? mockItem.details.connectedCustomers
            : 0,
        description: null,
        address: null,
        details: mockItem.details ?? null,
      };
      isRealData = false;
    }
  }

  if (!foundDevice) {
    return null;
  }

  // 1. Parent Node
  let parentNode: InfrastructureHierarchyNode | null = null;
  if (foundDevice.parentId) {
    try {
      const pRows = await db
        .select({
          id: networkInfrastructure.id,
          name: networkInfrastructure.name,
          type: networkInfrastructure.type,
          status: networkInfrastructure.status,
          latitude: networkInfrastructure.latitude,
          longitude: networkInfrastructure.longitude,
        })
        .from(networkInfrastructure)
        .where(eq(networkInfrastructure.id, foundDevice.parentId))
        .limit(1);

      if (pRows.length > 0) {
        const p = pRows[0];
        parentNode = {
          id: p.id,
          name: p.name,
          type: p.type,
          status: p.status,
          latitude: Number(p.latitude),
          longitude: Number(p.longitude),
        };
      }
    } catch {
      // Abaikan bila tabel parent tidak dapat diakses
    }
  }

  // 2. Children Nodes (Downstream)
  const childrenNodes: InfrastructureHierarchyNode[] = [];
  try {
    const cRows = await db
      .select({
        id: networkInfrastructure.id,
        name: networkInfrastructure.name,
        type: networkInfrastructure.type,
        status: networkInfrastructure.status,
        latitude: networkInfrastructure.latitude,
        longitude: networkInfrastructure.longitude,
      })
      .from(networkInfrastructure)
      .where(eq(networkInfrastructure.parentId, foundDevice.id));

    for (const c of cRows) {
      childrenNodes.push({
        id: c.id,
        name: c.name,
        type: c.type,
        status: c.status,
        latitude: Number(c.latitude),
        longitude: Number(c.longitude),
      });
    }
  } catch {
    // Abaikan
  }

  // 3. Cables Connected
  const cablesList: ConnectedCableSummary[] = [];
  try {
    const cableRows = await db
      .select()
      .from(networkCables)
      .where(
        or(
          eq(networkCables.sourceId, foundDevice.id),
          eq(networkCables.targetId, foundDevice.id),
        ),
      );

    for (const c of cableRows) {
      const isOutgoing = c.sourceId === foundDevice.id;
      cablesList.push({
        id: c.id,
        name: c.name,
        cableType: c.cableType,
        coreCapacity: c.coreCapacity,
        color: c.color,
        lengthMeters: c.lengthMeters ? Number(c.lengthMeters) : null,
        polyline: (c.polyline as Array<[number, number]>) || [],
        status: c.status,
        direction: isOutgoing ? "outgoing" : "incoming",
        connectedNodeId: isOutgoing ? c.targetId || "" : c.sourceId,
      });
    }
  } catch {
    // Abaikan
  }

  // 4. Connected Customers
  const customerList: ConnectedCustomerSummary[] = [];
  if (foundDevice.type === "odp" || foundDevice.type === "odc") {
    try {
      const custRows = await db
        .select({
          id: customers.id,
          name: customers.name,
          pppoeUsername: customers.pppoeUsername,
          isOnline: customers.isOnline,
          opticalPower: customers.opticalPower,
          billingStatus: effectiveBillingStatusSql,
          address: customers.address,
          latitude: customers.latitude,
          longitude: customers.longitude,
        })
        .from(customers)
        .where(
          or(
            ilike(customers.odpName, foundDevice.name),
            eq(customers.odpName, foundDevice.name),
          ),
        );

      for (const cust of custRows) {
        customerList.push({
          id: cust.id,
          name: cust.name,
          pppoeUsername: cust.pppoeUsername,
          isOnline: cust.isOnline,
          opticalPower: cust.opticalPower ? Number(cust.opticalPower) : null,
          billingStatus: cust.billingStatus,
          address: cust.address,
          coordinates: {
            latitude: cust.latitude ? Number(cust.latitude) : null,
            longitude: cust.longitude ? Number(cust.longitude) : null,
          },
        });
      }
    } catch {
      // Abaikan
    }

    // Hanya gunakan fallback mock jika opsi forceMock aktif secara eksplisit
    if (customerList.length === 0 && options?.forceMock) {
      const mock = getLocalMockMapData();
      const matched = mock.customers.filter(
        (c) =>
          c.odpName &&
          c.odpName.toLowerCase() === foundDevice!.name.toLowerCase(),
      );

      for (const c of matched) {
        customerList.push({
          id: c.id,
          name: c.name,
          pppoeUsername: c.pppoeUsername,
          isOnline: c.isOnline,
          opticalPower: c.opticalPower,
          billingStatus: c.billingStatus,
          address: c.address,
          coordinates: {
            latitude: c.latitude,
            longitude: c.longitude,
          },
        });
      }
    }
  }

  // Hitung customer stats
  const onlineCount = customerList.filter((c) => c.isOnline).length;
  const offlineCount = customerList.length - onlineCount;
  const activeBillingCount = customerList.filter(
    (c) => c.billingStatus === "lunas",
  ).length;
  const isolatedBillingCount = customerList.filter(
    (c) => c.billingStatus === "isolir",
  ).length;

  const customerStats = {
    total: customerList.length,
    online: onlineCount,
    offline: offlineCount,
    activeBilling: activeBillingCount,
    isolatedBilling: isolatedBillingCount,
  };

  // Kalkulasi kapasitas port perangkat
  let capacity = foundDevice.capacity ?? null;
  if (!capacity && foundDevice.type === "odp") {
    capacity = 16;
  }
  const usedCapacity = Math.max(
    foundDevice.usedCapacity ?? 0,
    customerList.length,
  );
  const availableCapacity = capacity
    ? Math.max(0, capacity - usedCapacity)
    : null;
  const utilizationPercent = capacity
    ? Math.min(100, Math.round((usedCapacity / capacity) * 100))
    : null;

  // 5. Hardware Stats (Router / OLT)
  let hardwareStats: InfrastructureDetailResult["hardwareStats"] = null;
  if (foundDevice.type === "router") {
    try {
      const rRows = await db
        .select({
          id: routers.id,
          name: routers.name,
          host: routers.host,
          status: routers.status,
          lastSeenAt: routers.lastSeenAt,
        })
        .from(routers)
        .where(
          or(
            foundDevice.host ? eq(routers.host, foundDevice.host) : undefined,
            ilike(routers.name, foundDevice.name),
          ),
        )
        .limit(1);

      if (rRows.length > 0) {
        const r = rRows[0];
        hardwareStats = {
          linkedDeviceId: r.id,
          status: r.status,
          model:
            (foundDevice.details?.model as string) || "MikroTik CCR Series",
          lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : undefined,
        };
      }
    } catch {
      // Abaikan
    }
  } else if (foundDevice.type === "olt") {
    try {
      const oRows = await db
        .select({
          id: olts.id,
          name: olts.name,
          host: olts.host,
          brand: olts.brand,
          status: olts.status,
          lastSeenAt: olts.lastSeenAt,
        })
        .from(olts)
        .where(
          or(
            foundDevice.host ? eq(olts.host, foundDevice.host) : undefined,
            ilike(olts.name, foundDevice.name),
          ),
        )
        .limit(1);

      if (oRows.length > 0) {
        const o = oRows[0];
        hardwareStats = {
          linkedDeviceId: o.id,
          brand: o.brand,
          status: o.status,
          lastSeenAt: o.lastSeenAt ? o.lastSeenAt.toISOString() : undefined,
        };
      }
    } catch {
      // Abaikan
    }
  }

  return {
    device: {
      id: foundDevice.id,
      name: foundDevice.name,
      type: foundDevice.type,
      host: foundDevice.host || undefined,
      status: foundDevice.status,
      latitude: foundDevice.latitude,
      longitude: foundDevice.longitude,
      parentId: foundDevice.parentId,
      capacity,
      usedCapacity,
      availableCapacity,
      utilizationPercent,
      description: foundDevice.description,
      address: foundDevice.address,
      details: foundDevice.details || undefined,
      createdAt: foundDevice.createdAt,
      updatedAt: foundDevice.updatedAt,
    },
    parent: parentNode,
    children: childrenNodes,
    cables: cablesList,
    customers: customerList,
    customerStats,
    hardwareStats,
    dataSource: {
      provider: isRealData ? "PostgreSQL Live" : "Mock Simulation Demo",
      isRealData,
      lastSynchronizedAt: new Date().toISOString(),
    },
  };
}
