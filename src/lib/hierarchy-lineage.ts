import type {
  HierarchyConnectionLink,
  NetworkHierarchyData,
} from "@/services/network-hierarchy.service";

export interface HierarchyLineageStep {
  id: string;
  name: string;
  type: "server" | "router" | "olt" | "odc" | "odp" | "customer";
  tier: 1 | 2 | 3 | 4;
  latitude: number | null;
  longitude: number | null;
  status: string;
}

export interface HierarchyTierMeta {
  tier: 1 | 2 | 3 | 4;
  label: string;
  shortLabel: string;
  badgeClass: string;
  hexColor: string;
  description: string;
}

export const HIERARCHY_TIER_META: Record<1 | 2 | 3 | 4, HierarchyTierMeta> = {
  1: {
    tier: 1,
    label: "Tingkat 1 • Core Gateway & OLT",
    shortLabel: "T1: Core/OLT",
    badgeClass: "text-purple-600 border-purple-500/40 bg-purple-500/10 dark:text-purple-300",
    hexColor: "#8b5cf6",
    description: "Simpul pusat jaringan backbone, router gateway BGP, dan master OLT GPON/EPON.",
  },
  2: {
    tier: 2,
    label: "Tingkat 2 • Optical Distribution Cabinet (ODC)",
    shortLabel: "T2: ODC",
    badgeClass: "text-blue-600 border-blue-500/40 bg-blue-500/10 dark:text-blue-300",
    hexColor: "#3b82f6",
    description: "Kabin distribusi optik utama penghubung kabel feeder serat optik ke berbagai klaster.",
  },
  3: {
    tier: 3,
    label: "Tingkat 3 • Optical Distribution Point (ODP)",
    shortLabel: "T3: ODP",
    badgeClass: "text-amber-600 border-amber-500/40 bg-amber-500/10 dark:text-amber-300",
    hexColor: "#f59e0b",
    description: "Kotak terminasi optik splitter (1:8 / 1:16) tempat kabel drop pelanggan tersambung.",
  },
  4: {
    tier: 4,
    label: "Tingkat 4 • Pelanggan Akhir (CPE/ONT)",
    shortLabel: "T4: Pelanggan",
    badgeClass: "text-emerald-600 border-emerald-500/40 bg-emerald-500/10 dark:text-emerald-300",
    hexColor: "#10b981",
    description: "Titik akhir koneksi rumah pelanggan dengan akun PPPoE dan router modem ONT.",
  },
};

/**
 * Melacak jalur bertingkat (lineage trail) dari simpul akar hingga simpul yang dipilih.
 * Contoh hasil: [Core Gateway] -> [ODC-TTJ-CAB-01] -> [ODP-TTJ-01] -> [Pelanggan Budi]
 */
export function resolveHierarchyLineage(
  data: NetworkHierarchyData,
  targetId: string | null | undefined,
): HierarchyLineageStep[] {
  if (!targetId || !data || !Array.isArray(data.roots)) {
    return [];
  }

  for (const root of data.roots) {
    const rootStep: HierarchyLineageStep = {
      id: root.id,
      name: root.name,
      type: root.type,
      tier: 1,
      latitude: root.latitude,
      longitude: root.longitude,
      status: root.status,
    };

    if (root.id === targetId) {
      return [rootStep];
    }

    // Periksa jalur melalui ODC
    for (const odc of root.odcs) {
      const odcStep: HierarchyLineageStep = {
        id: odc.id,
        name: odc.name,
        type: "odc",
        tier: 2,
        latitude: odc.latitude,
        longitude: odc.longitude,
        status: odc.status,
      };

      if (odc.id === targetId) {
        return [rootStep, odcStep];
      }

      for (const odp of odc.odps) {
        const odpStep: HierarchyLineageStep = {
          id: odp.id,
          name: odp.name,
          type: "odp",
          tier: 3,
          latitude: odp.latitude,
          longitude: odp.longitude,
          status: odp.status,
        };

        if (odp.id === targetId) {
          return [rootStep, odcStep, odpStep];
        }

        for (const cust of odp.customers) {
          if (cust.id === targetId) {
            const custStep: HierarchyLineageStep = {
              id: cust.id,
              name: cust.name,
              type: "customer",
              tier: 4,
              latitude: cust.latitude,
              longitude: cust.longitude,
              status: cust.isOnline ? "online" : "offline",
            };
            return [rootStep, odcStep, odpStep, custStep];
          }
        }
      }
    }

    // Periksa jalur ODP langsung ke root (directOdps)
    for (const odp of root.directOdps) {
      const odpStep: HierarchyLineageStep = {
        id: odp.id,
        name: odp.name,
        type: "odp",
        tier: 3,
        latitude: odp.latitude,
        longitude: odp.longitude,
        status: odp.status,
      };

      if (odp.id === targetId) {
        return [rootStep, odpStep];
      }

      for (const cust of odp.customers) {
        if (cust.id === targetId) {
          const custStep: HierarchyLineageStep = {
            id: cust.id,
            name: cust.name,
            type: "customer",
            tier: 4,
            latitude: cust.latitude,
            longitude: cust.longitude,
            status: cust.isOnline ? "online" : "offline",
          };
          return [rootStep, odpStep, custStep];
        }
      }
    }
  }

  return [];
}

/**
 * Filter koneksi link peta yang hanya berada pada lineage simpul aktif
 */
export function filterLineageLinks(
  allLinks: HierarchyConnectionLink[],
  lineage: HierarchyLineageStep[],
): HierarchyConnectionLink[] {
  if (lineage.length < 2) return [];

  const lineageIds = new Set(lineage.map((step) => step.id));
  return allLinks.filter(
    (link) => lineageIds.has(link.sourceId) && lineageIds.has(link.targetId),
  );
}

/**
 * Menghitung ketebalan garis kabel (stroke weight) secara adaptif terhadap level zoom peta.
 * Menjaga ketajaman dan keterbacaan visual agar kabel tidak menggumpal saat zoom out,
 * dan tetap tajam/tegas saat zoom in tinggi (zoom 17-20).
 */
export function getZoomScaledLineWeight(baseWeight: number, zoom: number): number {
  if (zoom >= 18) return Math.round(baseWeight * 1.35 * 10) / 10;
  if (zoom >= 16) return Math.round(baseWeight * 1.15 * 10) / 10;
  if (zoom >= 14) return baseWeight;
  if (zoom >= 12) return Math.max(1.5, Math.round(baseWeight * 0.8 * 10) / 10);
  return Math.max(1, Math.round(baseWeight * 0.65 * 10) / 10);
}
