import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { effectiveBillingStatusSql } from "./customer-isolir";
import { networkInfrastructure, customers } from "@/db/schema";
import { getLocalMockMapData } from "./network-map-mock";
import type { ReassignHierarchyParentInput } from "@/validators/hierarchy-reassign";

export interface HierarchyCustomerLeaf {
  id: string;
  name: string;
  pppoeUsername: string;
  isOnline: boolean;
  opticalPower: number | null;
  billingStatus: string;
  latitude: number | null;
  longitude: number | null;
  odpName: string;
}

export interface HierarchyOdpNode {
  id: string;
  name: string;
  type: "odp";
  status: string;
  latitude: number;
  longitude: number;
  capacity: number;
  usedCapacity: number;
  parentId?: string | null;
  customers: HierarchyCustomerLeaf[];
}

export interface HierarchyOdcNode {
  id: string;
  name: string;
  type: "odc";
  status: string;
  latitude: number;
  longitude: number;
  capacity: number;
  usedCapacity: number;
  parentId?: string | null;
  odps: HierarchyOdpNode[];
}

export interface HierarchyRootNode {
  id: string;
  name: string;
  type: "server" | "router" | "olt";
  host?: string;
  status: string;
  latitude: number;
  longitude: number;
  odcs: HierarchyOdcNode[];
  directOdps: HierarchyOdpNode[];
}

export interface HierarchyConnectionLink {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  targetId: string;
  targetName: string;
  targetType: string;
  sourceCoords: [number, number];
  targetCoords: [number, number];
  tier: 1 | 2 | 3;
  color: string;
  status: "active" | "inactive" | "online" | "offline";
}

export interface NetworkHierarchyData {
  roots: HierarchyRootNode[];
  allNodesCount: number;
  links: HierarchyConnectionLink[];
  summary: {
    totalRoots: number;
    totalOdcs: number;
    totalOdps: number;
    totalCustomers: number;
    onlineCustomers: number;
    offlineCustomers: number;
  };
  dataSource: {
    provider: string;
    isRealData: boolean;
    lastSynchronizedAt: string;
  };
}

export async function getNetworkHierarchyData(options?: {
  forceMock?: boolean;
}): Promise<NetworkHierarchyData> {
  const isExplicitMock = options?.forceMock === true;

  let rawInfra: Array<{
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
    details?: Record<string, unknown> | null;
  }> = [];

  let rawCustomers: Array<{
    id: string;
    name: string;
    pppoeUsername: string;
    isOnline: boolean;
    opticalPower: number | null;
    billingStatus: string;
    latitude: number | null;
    longitude: number | null;
    odpName: string | null;
  }> = [];

  let isRealData = !isExplicitMock;

  if (!isExplicitMock) {
    try {
      const infraRows = await db
        .select()
        .from(networkInfrastructure)
        .orderBy(asc(networkInfrastructure.name));

      const customerRows = await db
        .select({
          id: customers.id,
          name: customers.name,
          pppoeUsername: customers.pppoeUsername,
          isOnline: customers.isOnline,
          opticalPower: customers.opticalPower,
          billingStatus: effectiveBillingStatusSql,
          latitude: customers.latitude,
          longitude: customers.longitude,
          odpName: customers.odpName,
        })
        .from(customers)
        .orderBy(asc(customers.name));

      if (infraRows.length > 0 || customerRows.length > 0) {
        rawInfra = infraRows.map((r) => ({
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
          details: r.details as Record<string, unknown>,
        }));

        rawCustomers = customerRows.map((c) => ({
          id: c.id,
          name: c.name,
          pppoeUsername: c.pppoeUsername,
          isOnline: c.isOnline,
          opticalPower: c.opticalPower ? Number(c.opticalPower) : null,
          billingStatus: c.billingStatus,
          latitude: c.latitude ? Number(c.latitude) : null,
          longitude: c.longitude ? Number(c.longitude) : null,
          odpName: c.odpName,
        }));

        isRealData = true;
      }
    } catch (err) {
      console.error("[GET NETWORK HIERARCHY DB ERROR]", err);
    }
  }

  // Hanya muat data mock lokal jika mode mock eksplisit diminta (misal untuk testing unit)
  if (isExplicitMock) {
    const mock = getLocalMockMapData();
    rawInfra = mock.infrastructure.map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      host: i.host,
      status: i.status,
      latitude: i.latitude,
      longitude: i.longitude,
      parentId: null,
      capacity:
        typeof i.details?.capacity === "string" &&
        i.details.capacity.includes("16")
          ? 16
          : 8,
      usedCapacity:
        typeof i.details?.connectedCustomers === "number"
          ? i.details.connectedCustomers
          : 0,
      details: i.details,
    }));

    rawCustomers = mock.customers.map((c) => ({
      id: c.id,
      name: c.name,
      pppoeUsername: c.pppoeUsername,
      isOnline: c.isOnline,
      opticalPower: c.opticalPower,
      billingStatus: c.billingStatus,
      latitude: c.latitude,
      longitude: c.longitude,
      odpName: c.odpName,
    }));

    isRealData = false;
  }

  // 1. Petakan Pelanggan per ODP
  const customersByOdp = new Map<string, HierarchyCustomerLeaf[]>();
  for (const c of rawCustomers) {
    if (!c.odpName) continue;
    const odpKey = c.odpName.trim().toLowerCase();
    const existing = customersByOdp.get(odpKey) || [];
    existing.push({
      id: c.id,
      name: c.name,
      pppoeUsername: c.pppoeUsername,
      isOnline: c.isOnline,
      opticalPower: c.opticalPower,
      billingStatus: c.billingStatus,
      latitude: c.latitude,
      longitude: c.longitude,
      odpName: c.odpName,
    });
    customersByOdp.set(odpKey, existing);
  }

  // 2. Petakan ODP Nodes
  const odpItems = rawInfra.filter((i) => i.type === "odp");
  const odpNodes: HierarchyOdpNode[] = odpItems.map((odp) => {
    const odpKey = odp.name.trim().toLowerCase();
    const connectedCusts = customersByOdp.get(odpKey) || [];
    const capacity = odp.capacity || 16;
    const usedCapacity = Math.max(odp.usedCapacity || 0, connectedCusts.length);

    return {
      id: odp.id,
      name: odp.name,
      type: "odp",
      status: odp.status,
      latitude: odp.latitude,
      longitude: odp.longitude,
      capacity,
      usedCapacity,
      parentId: odp.parentId,
      customers: connectedCusts,
    };
  });

  // 3. Petakan ODC Nodes
  let odcItems = rawInfra.filter((i) => i.type === "odc");
  // Jika belum ada ODC eksplisit di data, bentuk simpul ODC virtual terdistribusi agar rantai Server -> ODC -> ODP -> Pelanggan tetap utuh
  if (odcItems.length === 0 && odpNodes.length > 0) {
    const centerLat =
      odpNodes.reduce((acc, o) => acc + o.latitude, 0) / odpNodes.length;
    const centerLng =
      odpNodes.reduce((acc, o) => acc + o.longitude, 0) / odpNodes.length;

    odcItems = [
      {
        id: "odc-hub-ttj-01",
        name: "ODC-TTJ-CAB-01",
        type: "odc",
        status: "active",
        latitude: centerLat + 0.0008,
        longitude: centerLng + 0.0008,
        capacity: 72,
        usedCapacity: odpNodes.length * 8,
      },
    ];
  }

  const odcNodes: HierarchyOdcNode[] = odcItems.map((odc) => {
    // Cari ODP yang menginduk ke ODC ini, atau hubungkan jika belum ada parentId
    const childOdps = odpNodes.filter(
      (odp) =>
        odp.parentId === odc.id ||
        (!odp.parentId && odcItems.length === 1) ||
        (!odp.parentId &&
          odp.name
            .toLowerCase()
            .includes(odc.name.split("-")[1]?.toLowerCase() || "")),
    );

    return {
      id: odc.id,
      name: odc.name,
      type: "odc",
      status: odc.status,
      latitude: odc.latitude,
      longitude: odc.longitude,
      capacity: odc.capacity || 72,
      usedCapacity: odc.usedCapacity || childOdps.length * 4,
      parentId: odc.parentId,
      odps: childOdps,
    };
  });

  // 4. Petakan Root Nodes (Core Server / Router / OLT)
  let rootItems = rawInfra.filter(
    (i) => i.type === "server" || i.type === "router" || i.type === "olt",
  );

  if (rootItems.length === 0) {
    rootItems = [
      {
        id: "core-server-01",
        name: "Core Gateway & BGP Server",
        type: "server",
        host: "10.10.0.1",
        status: "active",
        latitude: -2.5786,
        longitude: 101.2185,
        capacity: 1000,
        usedCapacity: rawCustomers.length,
      },
    ];
  }

  const roots: HierarchyRootNode[] = rootItems.map((root) => {
    // Hubungkan ODC yang berinduk ke root ini
    const childOdcs = odcNodes.filter(
      (odc) => odc.parentId === root.id || !odc.parentId, // Jika belum ada parentId, indukkan ke root utama
    );

    // ODP yang langsung terhubung ke root tanpa melalui ODC
    const directOdps = odpNodes.filter(
      (odp) =>
        odp.parentId === root.id &&
        !childOdcs.some((odc) => odc.odps.some((o) => o.id === odp.id)),
    );

    return {
      id: root.id,
      name: root.name,
      type: (root.type as "server" | "router" | "olt") || "server",
      host: root.host || undefined,
      status: root.status,
      latitude: root.latitude,
      longitude: root.longitude,
      odcs: childOdcs,
      directOdps,
    };
  });

  // 5. Bangun Garis Koneksi Topologi Bertingkat (Hierarchy Connection Links)
  const links: HierarchyConnectionLink[] = [];

  for (const root of roots) {
    // Tingkat 1: Root -> ODC
    for (const odc of root.odcs) {
      links.push({
        id: `link-${root.id}-${odc.id}`,
        sourceId: root.id,
        sourceName: root.name,
        sourceType: root.type,
        targetId: odc.id,
        targetName: odc.name,
        targetType: "odc",
        sourceCoords: [root.latitude, root.longitude],
        targetCoords: [odc.latitude, odc.longitude],
        tier: 1,
        color: "#8b5cf6", // Ungu Core Backbone
        status: odc.status === "active" ? "active" : "inactive",
      });

      // Tingkat 2: ODC -> ODP
      for (const odp of odc.odps) {
        links.push({
          id: `link-${odc.id}-${odp.id}`,
          sourceId: odc.id,
          sourceName: odc.name,
          sourceType: "odc",
          targetId: odp.id,
          targetName: odp.name,
          targetType: "odp",
          sourceCoords: [odc.latitude, odc.longitude],
          targetCoords: [odp.latitude, odp.longitude],
          tier: 2,
          color: "#06b6d4", // Cyan Distribusi Feeder
          status: odp.status === "active" ? "active" : "inactive",
        });

        // Tingkat 3: ODP -> Pelanggan Bertitik
        for (const cust of odp.customers) {
          if (cust.latitude !== null && cust.longitude !== null) {
            links.push({
              id: `link-${odp.id}-${cust.id}`,
              sourceId: odp.id,
              sourceName: odp.name,
              sourceType: "odp",
              targetId: cust.id,
              targetName: cust.name,
              targetType: "customer",
              sourceCoords: [odp.latitude, odp.longitude],
              targetCoords: [cust.latitude, cust.longitude],
              tier: 3,
              color: cust.isOnline ? "#10b981" : "#ef4444", // Hijau Online / Merah Offline
              status: cust.isOnline ? "online" : "offline",
            });
          }
        }
      }
    }

    // Direct ODPs to root
    for (const odp of root.directOdps) {
      links.push({
        id: `link-${root.id}-${odp.id}`,
        sourceId: root.id,
        sourceName: root.name,
        sourceType: root.type,
        targetId: odp.id,
        targetName: odp.name,
        targetType: "odp",
        sourceCoords: [root.latitude, root.longitude],
        targetCoords: [odp.latitude, odp.longitude],
        tier: 2,
        color: "#3b82f6",
        status: odp.status === "active" ? "active" : "inactive",
      });

      for (const cust of odp.customers) {
        if (cust.latitude !== null && cust.longitude !== null) {
          links.push({
            id: `link-${odp.id}-${cust.id}`,
            sourceId: odp.id,
            sourceName: odp.name,
            sourceType: "odp",
            targetId: cust.id,
            targetName: cust.name,
            targetType: "customer",
            sourceCoords: [odp.latitude, odp.longitude],
            targetCoords: [cust.latitude, cust.longitude],
            tier: 3,
            color: cust.isOnline ? "#10b981" : "#ef4444",
            status: cust.isOnline ? "online" : "offline",
          });
        }
      }
    }
  }

  const totalRoots = roots.length;
  const totalOdcs = odcNodes.length;
  const totalOdps = odpNodes.length;
  const totalCustomers = rawCustomers.length;
  const onlineCustomers = rawCustomers.filter((c) => c.isOnline).length;
  const offlineCustomers = totalCustomers - onlineCustomers;

  return {
    roots,
    allNodesCount: totalRoots + totalOdcs + totalOdps + totalCustomers,
    links,
    summary: {
      totalRoots,
      totalOdcs,
      totalOdps,
      totalCustomers,
      onlineCustomers,
      offlineCustomers,
    },
    dataSource: {
      provider: isRealData ? "PostgreSQL Live" : "Mock Simulation Demo",
      isRealData,
      lastSynchronizedAt: new Date().toISOString(),
    },
  };
}

export async function reassignHierarchyParent(
  input: ReassignHierarchyParentInput,
): Promise<{ success: boolean; message: string }> {
  const isDemo = process.env.DASHBOARD_DATA === "demo";

  if (!isDemo) {
    if (input.tier === 4 || input.nodeType === "customer") {
      // Pelanggan -> perbarui kolom odpName di tabel customers
      await db
        .update(customers)
        .set({
          odpName: input.newParentName,
          lastUpdatedAt: new Date(),
        })
        .where(eq(customers.id, input.nodeId));
    } else {
      // ODP atau ODC -> perbarui kolom parentId di tabel networkInfrastructure
      await db
        .update(networkInfrastructure)
        .set({
          parentId: input.newParentId,
          updatedAt: new Date(),
        })
        .where(eq(networkInfrastructure.id, input.nodeId));
    }
  }

  return {
    success: true,
    message: `Simpul ${input.nodeId} berhasil dipindahkan ke induk '${input.newParentName}'.`,
  };
}
