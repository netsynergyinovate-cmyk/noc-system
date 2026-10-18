"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Database,
  Filter,
  GitCommit,
  HardDrive,
  Layers,
  Loader2,
  Navigation,
  RefreshCw,
  Router,
  Search,
  Server,
  Share2,
  Users,
  X,
} from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NetworkMapLeafletLoader } from "./network-map-leaflet-loader";
import {
  HIERARCHY_TIER_META,
  resolveHierarchyLineage,
  type HierarchyLineageStep,
} from "@/lib/hierarchy-lineage";
import type {
  HierarchyOdcNode,
  HierarchyOdpNode,
  NetworkHierarchyData,
} from "@/services/network-hierarchy.service";
import type {
  NetworkCustomerPoint,
  NetworkInfrastructurePoint,
  NetworkMapData,
} from "@/services/network-map.service";

export interface HierarchyMapBoardProps {
  initialData: NetworkHierarchyData;
  initialFocusId?: string | null;
  className?: string;
}

type HierarchyTier = "all" | 1 | 2 | 3 | 4;

interface SelectedHierarchyNode {
  id: string;
  name: string;
  type: string;
  tier: 1 | 2 | 3 | 4;
  latitude: number;
  longitude: number;
  status: string;
  parentName?: string;
  capacity?: number;
  usedCapacity?: number;
  childrenCount?: number;
  opticalPower?: number | null;
  pppoeUsername?: string;
}

export function HierarchyMapBoard({
  initialData,
  initialFocusId,
  className,
}: HierarchyMapBoardProps) {
  const [data, setData] = useState<NetworkHierarchyData>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tierFilter, setTierFilter] = useState<HierarchyTier>("all");
  const [showLinks, setShowLinks] = useState(true);
  const [isTreeOpen, setIsTreeOpen] = useState(true);
  const [selectedNode, setSelectedNode] = useState<SelectedHierarchyNode | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  // State Kontrol Pindah Anak ke Induk Lain (Reassign Parent)
  const [isReassignOpen, setIsReassignOpen] = useState(false);
  const [targetParentId, setTargetParentId] = useState<string>("");
  const [isSavingReassign, setIsSavingReassign] = useState(false);
  const [reassignSuccessMsg, setReassignSuccessMsg] = useState<string | null>(null);
  const [reassignErrorMsg, setReassignErrorMsg] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    // Default expand semua root dan odc pertama
    const set = new Set<string>();
    initialData.roots.forEach((r) => {
      set.add(r.id);
      r.odcs.forEach((odc) => set.add(odc.id));
    });
    return set;
  });

  const toggleExpand = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const expandAllNodes = useCallback(() => {
    const set = new Set<string>();
    data.roots.forEach((r) => {
      set.add(r.id);
      r.odcs.forEach((odc) => {
        set.add(odc.id);
        odc.odps.forEach((odp) => set.add(odp.id));
      });
      r.directOdps.forEach((odp) => set.add(odp.id));
    });
    setExpandedNodes(set);
  }, [data]);

  const collapseAllNodes = useCallback(() => {
    setExpandedNodes(new Set());
  }, []);

  const refreshData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/map/hierarchy", { credentials: "same-origin" });
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data);
      }
    } catch (err) {
      console.error("[REFRESH HIERARCHY ERROR]", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Transform data hierarki ke format NetworkMapData untuk kompatibilitas peta Leaflet
  const mapCompatibleData = useMemo<NetworkMapData>(() => {
    const infraList: NetworkInfrastructurePoint[] = [];
    const custList: NetworkCustomerPoint[] = [];

    // Kumpulkan seluruh simpul
    for (const root of data.roots) {
      if (tierFilter === "all" || tierFilter === 1) {
        infraList.push({
          id: root.id,
          name: root.name,
          type: (root.type === "server" ? "router" : root.type) as "router" | "olt",
          host: root.host,
          status: root.status,
          latitude: root.latitude,
          longitude: root.longitude,
          details: {
            tier: "Tingkat 1 (Core / OLT)",
            connectedOdcs: root.odcs.length,
          },
        });
      }

      for (const odc of root.odcs) {
        if (tierFilter === "all" || tierFilter === 2) {
          infraList.push({
            id: odc.id,
            name: odc.name,
            type: "odc",
            status: odc.status,
            latitude: odc.latitude,
            longitude: odc.longitude,
            parentId: root.id,
            parentName: root.name,
            details: {
              tier: "Tingkat 2 (Kabin Distribusi ODC)",
              parentId: root.id,
              parentRoot: root.name,
              connectedOdps: odc.odps.length,
              capacity: `${odc.usedCapacity}/${odc.capacity} Core`,
            },
          });
        }

        for (const odp of odc.odps) {
          if (tierFilter === "all" || tierFilter === 3) {
            infraList.push({
              id: odp.id,
              name: odp.name,
              type: "odp",
              status: odp.status,
              latitude: odp.latitude,
              longitude: odp.longitude,
              parentId: odc.id,
              parentName: odc.name,
              details: {
                tier: "Tingkat 3 (Kotak Distribusi ODP)",
                parentId: odc.id,
                parentOdc: odc.name,
                capacity: `1:${odp.capacity} Splitter`,
                connectedCustomers: odp.customers.length,
              },
            });
          }

          if (tierFilter === "all" || tierFilter === 4) {
            for (const c of odp.customers) {
              if (c.latitude !== null && c.longitude !== null) {
                custList.push({
                  id: c.id,
                  name: c.name,
                  pppoeUsername: c.pppoeUsername,
                  routerId: root.id,
                  routerName: root.name,
                  address: null,
                  latitude: c.latitude,
                  longitude: c.longitude,
                  odpName: odp.name,
                  billingStatus: c.billingStatus as "lunas" | "isolir",
                  opticalPower: c.opticalPower,
                  isOnline: c.isOnline,
                  lastUpdatedAt: new Date(),
                });
              }
            }
          }
        }
      }

      // Direct ODPs
      for (const odp of root.directOdps) {
        if (tierFilter === "all" || tierFilter === 3) {
          infraList.push({
            id: odp.id,
            name: odp.name,
            type: "odp",
            status: odp.status,
            latitude: odp.latitude,
            longitude: odp.longitude,
            parentId: root.id,
            parentName: root.name,
            details: {
              tier: "Tingkat 3 (Direct ODP)",
              parentId: root.id,
              parentRoot: root.name,
              connectedCustomers: odp.customers.length,
            },
          });
        }

        if (tierFilter === "all" || tierFilter === 4) {
          for (const c of odp.customers) {
            if (c.latitude !== null && c.longitude !== null) {
              custList.push({
                id: c.id,
                name: c.name,
                pppoeUsername: c.pppoeUsername,
                routerId: root.id,
                routerName: root.name,
                address: null,
                latitude: c.latitude,
                longitude: c.longitude,
                odpName: odp.name,
                billingStatus: c.billingStatus as "lunas" | "isolir",
                opticalPower: c.opticalPower,
                isOnline: c.isOnline,
                lastUpdatedAt: new Date(),
              });
            }
          }
        }
      }
    }

    return {
      customers: custList,
      infrastructure: infraList,
      summary: {
        totalCustomers: data.summary.totalCustomers,
        geocodedCustomers: custList.length,
        onlineCustomers: data.summary.onlineCustomers,
        offlineCustomers: data.summary.offlineCustomers,
        criticalOpticsCount: custList.filter(
          (c) => c.opticalPower !== null && c.opticalPower < -24.5,
        ).length,
        totalOlts: data.roots.filter((r) => r.type === "olt").length,
        totalRouters: data.roots.filter((r) => r.type === "router" || r.type === "server").length,
        totalOdps: data.summary.totalOdps,
      },
      dataSource: data.dataSource,
    };
  }, [data, tierFilter]);

  // Handle seleksi simpul pohon
  const handleSelectCustomer = useCallback((customer: NetworkCustomerPoint | null) => {
    if (!customer || customer.latitude === null || customer.longitude === null) {
      setSelectedNode(null);
      return;
    }
    setSelectedNode({
      id: customer.id,
      name: customer.name,
      type: "customer",
      tier: 4,
      latitude: customer.latitude,
      longitude: customer.longitude,
      status: customer.isOnline ? "online" : "offline",
      parentName: customer.odpName || undefined,
      opticalPower: customer.opticalPower,
      pppoeUsername: customer.pppoeUsername,
    });
  }, []);

  const handleSelectInfra = useCallback((infra: NetworkInfrastructurePoint | null) => {
    if (!infra) {
      setSelectedNode(null);
      return;
    }

    let tier: 1 | 2 | 3 = 1;
    if (infra.type === "odc") tier = 2;
    else if (infra.type === "odp") tier = 3;

    setSelectedNode({
      id: infra.id,
      name: infra.name,
      type: infra.type,
      tier,
      latitude: infra.latitude,
      longitude: infra.longitude,
      status: infra.status,
      parentName: (infra.details?.parentRoot as string) || (infra.details?.parentOdc as string),
    });
  }, []);

  const handleCopyCoords = useCallback(() => {
    if (!selectedNode) return;
    const text = `${selectedNode.latitude.toFixed(6)}, ${selectedNode.longitude.toFixed(6)}`;
    navigator.clipboard.writeText(text).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  }, [selectedNode]);

  // Melacak silsilah vertikal (lineage) dari simpul yang dipilih: Server -> ODC -> ODP -> Pelanggan
  const activeLineage = useMemo(
    () => resolveHierarchyLineage(data, selectedNode?.id),
    [data, selectedNode?.id],
  );

  const handleSelectLineageStep = useCallback((step: HierarchyLineageStep) => {
    setSelectedNode({
      id: step.id,
      name: step.name,
      type: step.type,
      tier: step.tier,
      latitude: step.latitude ?? 0,
      longitude: step.longitude ?? 0,
      status: step.status,
    });
  }, []);

  // Daftar opsi induk baru yang valid berdasarkan tingkatan simpul aktif
  const parentOptions = useMemo(() => {
    if (!selectedNode || selectedNode.tier < 2) return [];

    if (selectedNode.tier === 4) {
      // Pelanggan -> Induk adalah ODP (Tingkat 3)
      const odps: Array<{ id: string; name: string; tier: string }> = [];
      for (const root of data.roots) {
        for (const odc of root.odcs) {
          for (const odp of odc.odps) {
            odps.push({ id: odp.id, name: odp.name, tier: `ODP via ${odc.name}` });
          }
        }
        for (const odp of root.directOdps) {
          odps.push({ id: odp.id, name: odp.name, tier: `Direct ODP via ${root.name}` });
        }
      }
      return odps;
    }

    if (selectedNode.tier === 3) {
      // ODP -> Induk adalah ODC (Tingkat 2) atau Core Root
      const parents: Array<{ id: string; name: string; tier: string }> = [];
      for (const root of data.roots) {
        parents.push({ id: root.id, name: root.name, tier: `Core Root (${root.type})` });
        for (const odc of root.odcs) {
          if (odc.id !== selectedNode.id) {
            parents.push({ id: odc.id, name: odc.name, tier: `ODC Hub via ${root.name}` });
          }
        }
      }
      return parents;
    }

    if (selectedNode.tier === 2) {
      // ODC -> Induk adalah Root Server / Router / OLT (Tingkat 1)
      return data.roots.map((r) => ({
        id: r.id,
        name: r.name,
        tier: `Core ${r.type.toUpperCase()}`,
      }));
    }

    return [];
  }, [selectedNode, data.roots]);

  const handleExecuteReassign = useCallback(async () => {
    if (!selectedNode || !targetParentId) return;
    const selectedOption = parentOptions.find((p) => p.id === targetParentId);
    if (!selectedOption) return;

    setIsSavingReassign(true);
    setReassignErrorMsg(null);
    setReassignSuccessMsg(null);

    try {
      const res = await fetch("/api/map/hierarchy/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: selectedNode.id,
          nodeType: selectedNode.type,
          tier: selectedNode.tier,
          newParentId: selectedOption.id,
          newParentName: selectedOption.name,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Gagal memindahkan relasi induk.");
      }

      // Optimistic update pada local data
      setData((prev) => {
        // 1. Pelanggan (Tier 4) dipindahkan ke ODP lain
        if (selectedNode.tier === 4) {
          const nextRoots = prev.roots.map((root) => {
            return {
              ...root,
              odcs: root.odcs.map((odc) => ({
                ...odc,
                odps: odc.odps.map((odp) => {
                  let nextCusts = odp.customers.filter((c) => c.id !== selectedNode.id);
                  if (odp.id === selectedOption.id) {
                    nextCusts = [
                      ...nextCusts,
                      {
                        id: selectedNode.id,
                        name: selectedNode.name,
                        pppoeUsername: selectedNode.pppoeUsername || "",
                        isOnline: selectedNode.status === "online",
                        opticalPower: selectedNode.opticalPower ?? null,
                        billingStatus: "lunas",
                        latitude: selectedNode.latitude,
                        longitude: selectedNode.longitude,
                        odpName: selectedOption.name,
                      },
                    ];
                  }
                  return { ...odp, customers: nextCusts };
                }),
              })),
              directOdps: root.directOdps.map((odp) => {
                let nextCusts = odp.customers.filter((c) => c.id !== selectedNode.id);
                if (odp.id === selectedOption.id) {
                  nextCusts = [
                    ...nextCusts,
                    {
                      id: selectedNode.id,
                      name: selectedNode.name,
                      pppoeUsername: selectedNode.pppoeUsername || "",
                      isOnline: selectedNode.status === "online",
                      opticalPower: selectedNode.opticalPower ?? null,
                      billingStatus: "lunas",
                      latitude: selectedNode.latitude,
                      longitude: selectedNode.longitude,
                      odpName: selectedOption.name,
                    },
                  ];
                }
                return { ...odp, customers: nextCusts };
              }),
            };
          });
          return { ...prev, roots: nextRoots };
        }

        // 2. ODP (Tier 3) dipindahkan ke ODC lain atau Core Direct
        if (selectedNode.tier === 3) {
          let movingOdp: HierarchyOdpNode | null = null;
          for (const r of prev.roots) {
            for (const o of r.odcs) {
              const found = o.odps.find((odp) => odp.id === selectedNode.id);
              if (found) {
                movingOdp = { ...found, parentId: selectedOption.id };
                break;
              }
            }
            if (!movingOdp) {
              const foundDirect = r.directOdps.find((odp) => odp.id === selectedNode.id);
              if (foundDirect) {
                movingOdp = { ...foundDirect, parentId: selectedOption.id };
                break;
              }
            }
          }

          if (movingOdp) {
            const nextRoots = prev.roots.map((root) => {
              const isDirectTarget = root.id === selectedOption.id;
              const nextDirect = root.directOdps.filter((o) => o.id !== selectedNode.id);
              if (isDirectTarget && movingOdp) {
                nextDirect.push(movingOdp);
              }

              const nextOdcs = root.odcs.map((odc) => {
                const isOdcTarget = odc.id === selectedOption.id;
                let nextOdps = odc.odps.filter((o) => o.id !== selectedNode.id);
                if (isOdcTarget && movingOdp) {
                  nextOdps = [...nextOdps, movingOdp];
                }
                return { ...odc, odps: nextOdps };
              });

              return { ...root, odcs: nextOdcs, directOdps: nextDirect };
            });
            return { ...prev, roots: nextRoots };
          }
        }

        // 3. ODC (Tier 2) dipindahkan ke Core Server/Router lain
        if (selectedNode.tier === 2) {
          let movingOdc: HierarchyOdcNode | null = null;
          for (const r of prev.roots) {
            const found = r.odcs.find((odc) => odc.id === selectedNode.id);
            if (found) {
              movingOdc = { ...found, parentId: selectedOption.id };
              break;
            }
          }

          if (movingOdc) {
            const nextRoots = prev.roots.map((root) => {
              let nextOdcs = root.odcs.filter((o) => o.id !== selectedNode.id);
              if (root.id === selectedOption.id && movingOdc) {
                nextOdcs = [...nextOdcs, movingOdc];
              }
              return { ...root, odcs: nextOdcs };
            });
            return { ...prev, roots: nextRoots };
          }
        }

        return prev;
      });

      // Update selectedNode parentName
      setSelectedNode((prev) =>
        prev ? { ...prev, parentName: selectedOption.name } : null,
      );

      // Otomatis buka (expand) cabang induk baru di pohon agar langsung terlihat
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        next.add(selectedOption.id);
        return next;
      });

      // Segarkan data dari database backend secara background tanpa reload halaman
      refreshData();

      setReassignSuccessMsg(`Peta dan pohon berhasil disinkronkan ke induk '${selectedOption.name}'`);
      setTimeout(() => {
        setIsReassignOpen(false);
        setReassignSuccessMsg(null);
      }, 1500);
    } catch (err) {
      setReassignErrorMsg(err instanceof Error ? err.message : "Terjadi kesalahan sistem.");
    } finally {
      setIsSavingReassign(false);
    }
  }, [selectedNode, targetParentId, parentOptions, refreshData]);

  // Saringan pencarian pohon
  const searchLower = searchQuery.trim().toLowerCase();

  return (
    <div
      className={cn("flex w-full flex-col gap-3.5", className)}
      data-testid="hierarchy-map-board"
    >
      {/* 1. Header Bar Informasi & Navigasi */}
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl text-foreground flex items-center gap-2">
              <Share2 className="size-5 text-primary rotate-90" />
              Peta Susunan Bertingkat Topologi
            </h1>
            {data.dataSource.isRealData ? (
              <Badge
                variant="outline"
                className="text-xs gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 font-medium"
                data-testid="hierarchy-data-source-badge"
              >
                <Database className="size-3" />
                PostgreSQL Live
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-xs gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 font-medium"
                data-testid="hierarchy-data-source-badge"
              >
                <Database className="size-3" />
                Data Mock Lokal
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Relasi hierarki struktural jaringan: <span className="font-semibold text-foreground">Server/Core &rarr; ODC &rarr; ODP &rarr; Pelanggan</span> terhubung dengan data nyata dari database.
          </p>
        </div>

        {/* Action Controls & Navigation Shortcuts */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            onClick={refreshData}
            disabled={isLoading}
            data-testid="refresh-hierarchy-button"
            title="Segarkan data hierarki dari backend"
          >
            <RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />
            <span>Segarkan</span>
          </Button>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            data-testid="shortcut-full-map-link"
          >
            <Link href="/app/peta" title="Buka peta infrastruktur penuh">
              <Layers className="size-3.5 text-primary" />
              <span>Peta Penuh</span>
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            data-testid="shortcut-customer-list-link"
          >
            <Link href="/app/pelanggan" title="Buka daftar tabel pelanggan">
              <Users className="size-3.5 text-emerald-500" />
              <span>Pelanggan</span>
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            data-testid="shortcut-router-mgmt-link"
          >
            <Link href="/app/router" title="Buka manajemen router MikroTik">
              <Router className="size-3.5 text-cyan-500" />
              <span>Router</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* 2. Kartu Metrik 4 Tingkat Susunan (Hierarchy Tier KPI Cards) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5" data-testid="hierarchy-kpi-cards">
        {/* Tingkat 1: Core Server & OLT */}
        <Card className="border border-border/80 shadow-xs bg-card/60 backdrop-blur-xs">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Tingkat 1 • Core &amp; OLT
              </span>
              <div className="size-6 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                <Server className="size-3.5" />
              </div>
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-foreground" data-testid="kpi-total-roots">
                {data.summary.totalRoots}
              </span>
              <span className="text-[11px] text-muted-foreground">Simpul Pusat</span>
            </div>
          </CardContent>
        </Card>

        {/* Tingkat 2: ODC (Kabin Distribusi) */}
        <Card className="border border-border/80 shadow-xs bg-card/60 backdrop-blur-xs">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Tingkat 2 • ODC Kabin
              </span>
              <div className="size-6 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <HardDrive className="size-3.5" />
              </div>
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-foreground" data-testid="kpi-total-odcs">
                {data.summary.totalOdcs}
              </span>
              <span className="text-[11px] text-muted-foreground">Kabin Hub</span>
            </div>
          </CardContent>
        </Card>

        {/* Tingkat 3: ODP (Kotak Distribusi) */}
        <Card className="border border-border/80 shadow-xs bg-card/60 backdrop-blur-xs">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Tingkat 3 • ODP Kotak
              </span>
              <div className="size-6 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <Boxes className="size-3.5" />
              </div>
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-foreground" data-testid="kpi-total-odps">
                {data.summary.totalOdps}
              </span>
              <span className="text-[11px] text-muted-foreground">Kotak Distribusi</span>
            </div>
          </CardContent>
        </Card>

        {/* Tingkat 4: Pelanggan Akhir */}
        <Card className="border border-border/80 shadow-xs bg-card/60 backdrop-blur-xs">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Tingkat 4 • Pelanggan
              </span>
              <div className="size-6 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Users className="size-3.5" />
              </div>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-xl font-bold text-foreground" data-testid="kpi-total-customers">
                {data.summary.totalCustomers}
              </span>
              <span className="text-[10px] font-medium text-muted-foreground">
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                  {data.summary.onlineCustomers}
                </span>{" "}
                Online •{" "}
                <span className="text-rose-600 dark:text-rose-400 font-bold">
                  {data.summary.offlineCustomers}
                </span>{" "}
                Offline
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3. Bar Kontrol Filter & Toggle Pohon */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-card p-2 rounded-xl border shadow-xs">
        {/* Saringan Tingkat Hierarki */}
        <div className="flex flex-wrap items-center gap-1.5" data-testid="hierarchy-tier-filters">
          <span className="text-[11px] font-semibold text-muted-foreground mr-1 flex items-center gap-1">
            <Filter className="size-3" />
            <span>Tingkat:</span>
          </span>

          <Button
            type="button"
            variant={tierFilter === "all" ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5 text-[11px]"
            onClick={() => setTierFilter("all")}
            data-testid="filter-tier-all"
          >
            Semua (1-4)
          </Button>

          <Button
            type="button"
            variant={tierFilter === 1 ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-[11px] gap-1"
            onClick={() => setTierFilter(1)}
            data-testid="filter-tier-1"
          >
            <span className="size-1.5 rounded-full bg-purple-500" />
            <span>T1: Core/OLT</span>
          </Button>

          <Button
            type="button"
            variant={tierFilter === 2 ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-[11px] gap-1"
            onClick={() => setTierFilter(2)}
            data-testid="filter-tier-2"
          >
            <span className="size-1.5 rounded-full bg-blue-500" />
            <span>T2: ODC</span>
          </Button>

          <Button
            type="button"
            variant={tierFilter === 3 ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-[11px] gap-1"
            onClick={() => setTierFilter(3)}
            data-testid="filter-tier-3"
          >
            <span className="size-1.5 rounded-full bg-amber-500" />
            <span>T3: ODP</span>
          </Button>

          <Button
            type="button"
            variant={tierFilter === 4 ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-[11px] gap-1"
            onClick={() => setTierFilter(4)}
            data-testid="filter-tier-4"
          >
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <span>T4: Pelanggan</span>
          </Button>
        </div>

        {/* Kontrol Toggle Pohon & Garis Relasi */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("h-7 px-2.5 text-xs font-medium gap-1.5", showLinks && "bg-primary/10 text-primary border-primary/30")}
            onClick={() => setShowLinks(!showLinks)}
            data-testid="toggle-hierarchy-links-button"
            title="Tampilkan atau sembunyikan garis hubungan induk-anak di peta"
          >
            <Share2 className="size-3.5" />
            <span className="hidden sm:inline">Garis Hubungan</span>
            <span className="text-[10px] font-bold">({showLinks ? "ON" : "OFF"})</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("h-7 px-2.5 text-xs font-medium gap-1.5", isTreeOpen && "bg-muted text-foreground")}
            onClick={() => setIsTreeOpen(!isTreeOpen)}
            data-testid="toggle-hierarchy-tree-button"
            title="Tampilkan atau sembunyikan panel pohon relasi"
          >
            <Layers className="size-3.5" />
            <span>{isTreeOpen ? "Tutup Pohon" : "Buka Pohon"}</span>
          </Button>
        </div>
      </div>

      {/* 3b. Bar Silsilah Tingkatan Relasi (Server > ODC > ODP > Pelanggan) */}
      {activeLineage.length > 0 && (
        <div
          className="flex items-center gap-1.5 p-2 px-3 bg-card rounded-xl border shadow-xs overflow-x-auto text-xs"
          data-testid="hierarchy-lineage-breadcrumb"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground mr-1 shrink-0">
            <GitCommit className="size-3.5 text-primary" />
            <span>Alur Tingkat Relasi:</span>
          </div>
          <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
            {activeLineage.map((step, idx) => {
              const meta = HIERARCHY_TIER_META[step.tier];
              const isSelected = step.id === selectedNode?.id;

              return (
                <div key={step.id} className="flex items-center gap-1.5 shrink-0">
                  {idx > 0 && (
                    <ChevronRight className="size-3 text-muted-foreground shrink-0" />
                  )}
                  <button
                    type="button"
                    onClick={() => handleSelectLineageStep(step)}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-all font-medium cursor-pointer",
                      isSelected
                        ? cn(meta.badgeClass, "ring-1 ring-primary/40 font-bold shadow-xs scale-102")
                        : "border-border/60 hover:bg-muted/70 text-foreground",
                    )}
                    data-testid={`lineage-step-${step.tier}`}
                    title={`${meta.label}: ${step.name}`}
                  >
                    <span
                      className="size-2 rounded-full shrink-0"
                      style={{ backgroundColor: meta.hexColor }}
                    />
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-mono">
                      T{step.tier}
                    </Badge>
                    <span className="truncate max-w-[140px] sm:max-w-[200px]">{step.name}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Konten Utama: Split Antara Panel Pohon Hierarki & Kanvas Peta Leaflet */}
      <div className="relative flex flex-col md:flex-row w-full gap-3 h-[calc(100vh-210px)] min-h-[580px]">
        {/* Panel Kiri: Pohon Susunan Bertingkat (Hierarchy Tree Explorer) */}
        {isTreeOpen && (
          <Card
            className="w-full md:w-84 lg:w-96 shrink-0 border border-border/80 shadow-md bg-card flex flex-col overflow-hidden animate-in fade-in slide-in-from-left-2 duration-150"
            data-testid="hierarchy-tree-panel"
          >
            {/* Header Panel Pohon & Search */}
            <div className="p-3 border-b space-y-2 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5 uppercase tracking-wide">
                  <Share2 className="size-3.5 text-primary rotate-90" />
                  <span>Pohon Relasi Jaringan</span>
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground font-mono mr-1">
                    {data.allNodesCount} Simpul
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsTreeOpen(false)}
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    data-testid="close-tree-panel-button"
                    title="Tutup panel pohon relasi"
                    aria-label="Tutup panel pohon relasi"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>

              {/* Action Controls: Buka Semua & Tutup Semua Cabang */}
              <div className="flex items-center gap-1.5 pt-0.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[10px] gap-1 flex-1 font-medium bg-background/80"
                  onClick={expandAllNodes}
                  data-testid="expand-all-tree-button"
                  title="Buka semua cabang simpul pohon"
                >
                  <ChevronsUpDown className="size-3 text-primary" />
                  <span>Buka Semua</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[10px] gap-1 flex-1 font-medium bg-background/80"
                  onClick={collapseAllNodes}
                  data-testid="collapse-all-tree-button"
                  title="Tutup semua cabang simpul pohon"
                >
                  <ChevronsDownUp className="size-3 text-muted-foreground" />
                  <span>Tutup Semua</span>
                </Button>
              </div>

              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Cari simpul (Core, ODC, ODP, Pelanggan)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-7.5 pl-8 pr-7 text-xs bg-background"
                  data-testid="hierarchy-search-input"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* List Tree Kolapsibel */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 text-xs">
              {data.roots.map((root) => {
                const isRootExpanded = expandedNodes.has(root.id) || !!searchLower;

                return (
                  <div key={root.id} className="space-y-1 select-none">
                    {/* Root Node: Tingkat 1 */}
                    <div
                      className={cn(
                        "flex items-center justify-between p-1.5 rounded-lg border transition-colors cursor-pointer",
                        selectedNode?.id === root.id
                          ? "bg-purple-500/15 border-purple-500/40 text-purple-900 dark:text-purple-200"
                          : "hover:bg-muted/60 border-transparent",
                      )}
                      onClick={() => {
                        handleSelectInfra({
                          id: root.id,
                          name: root.name,
                          type: (root.type === "server" ? "router" : root.type) as "router" | "olt",
                          host: root.host,
                          status: root.status,
                          latitude: root.latitude,
                          longitude: root.longitude,
                          details: {
                            tier: "Tingkat 1 (Core / OLT)",
                            connectedOdcs: root.odcs.length,
                          },
                        });
                        if (!expandedNodes.has(root.id)) {
                          toggleExpand(root.id);
                        }
                      }}
                      data-testid={`tree-node-${root.id}`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <button
                          type="button"
                          className="p-0.5 hover:bg-muted rounded text-muted-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(root.id);
                          }}
                          aria-label={isRootExpanded ? "Ciutkan cabang" : "Bentangkan cabang"}
                        >
                          {isRootExpanded ? (
                            <ChevronDown className="size-3.5 shrink-0" />
                          ) : (
                            <ChevronRight className="size-3.5 shrink-0" />
                          )}
                        </button>
                        <span className="size-2 rounded-full bg-purple-500 shrink-0" />
                        <span className="font-bold truncate text-foreground">{root.name}</span>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-[9px] px-1 py-0 h-4 uppercase shrink-0 font-mono text-purple-600 border-purple-500/40 bg-purple-500/10"
                        data-testid={`tier-badge-${root.id}`}
                      >
                        T1 • {root.type}
                      </Badge>
                    </div>

                    {/* Children ODCs: Tingkat 2 */}
                    {isRootExpanded && (
                      <div className="pl-4 space-y-1 border-l border-border/60 ml-2">
                        {root.odcs.map((odc) => {
                          const isOdcExpanded = expandedNodes.has(odc.id) || !!searchLower;

                          return (
                            <div key={odc.id} className="space-y-1">
                              {/* ODC Item */}
                              <div
                                className={cn(
                                  "flex items-center justify-between p-1.5 rounded-md border transition-colors cursor-pointer",
                                  selectedNode?.id === odc.id
                                    ? "bg-blue-500/15 border-blue-500/40 text-blue-900 dark:text-blue-200"
                                    : "hover:bg-muted/60 border-transparent",
                                )}
                                onClick={() => {
                                  handleSelectInfra({
                                    id: odc.id,
                                    name: odc.name,
                                    type: "odc",
                                    status: odc.status,
                                    latitude: odc.latitude,
                                    longitude: odc.longitude,
                                    parentId: root.id,
                                    parentName: root.name,
                                    details: {
                                      tier: "Tingkat 2 (Kabin Distribusi ODC)",
                                      parentId: root.id,
                                      parentRoot: root.name,
                                      connectedOdps: odc.odps.length,
                                      capacity: `${odc.usedCapacity}/${odc.capacity} Core`,
                                    },
                                  });
                                  if (!expandedNodes.has(odc.id)) {
                                    toggleExpand(odc.id);
                                  }
                                }}
                                data-testid={`tree-node-${odc.id}`}
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <button
                                    type="button"
                                    className="p-0.5 hover:bg-muted rounded text-muted-foreground"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleExpand(odc.id);
                                    }}
                                    aria-label={isOdcExpanded ? "Ciutkan cabang" : "Bentangkan cabang"}
                                  >
                                    {isOdcExpanded ? (
                                      <ChevronDown className="size-3 shrink-0" />
                                    ) : (
                                      <ChevronRight className="size-3 shrink-0" />
                                    )}
                                  </button>
                                  <span className="size-1.5 rounded-full bg-blue-500 shrink-0" />
                                  <span className="font-semibold truncate text-foreground">{odc.name}</span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] px-1 py-0 h-3.5 uppercase font-mono text-blue-600 border-blue-500/40 bg-blue-500/10"
                                    data-testid={`tier-badge-${odc.id}`}
                                  >
                                    T2
                                  </Badge>
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    {odc.odps.length} ODP
                                  </span>
                                </div>
                              </div>

                              {/* Children ODPs: Tingkat 3 */}
                              {isOdcExpanded && (
                                <div className="pl-4 space-y-1 border-l border-border/50 ml-2">
                                  {odc.odps.map((odp) => {
                                    const isOdpExpanded = expandedNodes.has(odp.id) || !!searchLower;

                                    return (
                                      <div key={odp.id} className="space-y-1">
                                        {/* ODP Item */}
                                        <div
                                          className={cn(
                                            "flex items-center justify-between p-1 rounded-md border transition-colors cursor-pointer text-[11px]",
                                            selectedNode?.id === odp.id
                                              ? "bg-amber-500/15 border-amber-500/40 text-amber-900 dark:text-amber-200"
                                              : "hover:bg-muted/60 border-transparent",
                                          )}
                                          onClick={() => {
                                            handleSelectInfra({
                                              id: odp.id,
                                              name: odp.name,
                                              type: "odp",
                                              status: odp.status,
                                              latitude: odp.latitude,
                                              longitude: odp.longitude,
                                              parentId: odc.id,
                                              parentName: odc.name,
                                              details: {
                                                tier: "Tingkat 3 (Kotak Distribusi ODP)",
                                                parentId: odc.id,
                                                parentOdc: odc.name,
                                                capacity: `1:${odp.capacity} Splitter`,
                                                connectedCustomers: odp.customers.length,
                                              },
                                            });
                                            if (!expandedNodes.has(odp.id)) {
                                              toggleExpand(odp.id);
                                            }
                                          }}
                                          data-testid={`tree-node-${odp.id}`}
                                        >
                                          <div className="flex items-center gap-1.5 min-w-0">
                                            <button
                                              type="button"
                                              className="p-0.5 hover:bg-muted rounded text-muted-foreground"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                toggleExpand(odp.id);
                                              }}
                                              aria-label={isOdpExpanded ? "Ciutkan cabang" : "Bentangkan cabang"}
                                            >
                                              {isOdpExpanded ? (
                                                <ChevronDown className="size-2.5 shrink-0" />
                                              ) : (
                                                <ChevronRight className="size-2.5 shrink-0" />
                                              )}
                                            </button>
                                            <span className="size-1.5 rounded-full bg-amber-500 shrink-0" />
                                            <span className="font-medium truncate text-foreground">{odp.name}</span>
                                          </div>
                                          <div className="flex items-center gap-1 shrink-0">
                                            <Badge
                                              variant="outline"
                                              className="text-[9px] px-1 py-0 h-3.5 uppercase font-mono text-amber-600 border-amber-500/40 bg-amber-500/10"
                                              data-testid={`tier-badge-${odp.id}`}
                                            >
                                              T3
                                            </Badge>
                                            <span className="text-[10px] text-muted-foreground font-mono">
                                              {odp.customers.length} Cust
                                            </span>
                                          </div>
                                        </div>

                                        {/* Children Customers: Tingkat 4 */}
                                        {isOdpExpanded && odp.customers.length > 0 && (
                                          <div className="pl-3 space-y-0.5 border-l border-border/40 ml-1.5">
                                            {odp.customers.map((c) => (
                                              <div
                                                key={c.id}
                                                className={cn(
                                                  "flex items-center justify-between p-1 rounded hover:bg-muted/50 cursor-pointer text-[10px] transition-colors",
                                                  selectedNode?.id === c.id && "bg-emerald-500/15 font-semibold text-emerald-900 dark:text-emerald-200",
                                                )}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleSelectCustomer({
                                                    id: c.id,
                                                    name: c.name,
                                                    pppoeUsername: c.pppoeUsername,
                                                    routerId: root.id,
                                                    address: null,
                                                    latitude: c.latitude,
                                                    longitude: c.longitude,
                                                    odpName: odp.name,
                                                    billingStatus: c.billingStatus as "lunas" | "isolir",
                                                    opticalPower: c.opticalPower,
                                                    isOnline: c.isOnline,
                                                    lastUpdatedAt: new Date(),
                                                  });
                                                }}
                                                data-testid={`tree-node-${c.id}`}
                                              >
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                  <span
                                                    className={cn("size-1.5 rounded-full shrink-0", c.isOnline ? "bg-emerald-500" : "bg-rose-500")}
                                                    title={c.isOnline ? "Online" : "Offline"}
                                                  />
                                                  <span className="truncate">{c.name}</span>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                  {c.opticalPower !== null && (
                                                    <span className="font-mono text-muted-foreground text-[9px]">
                                                      {c.opticalPower} dBm
                                                    </span>
                                                  )}
                                                  <Badge
                                                    variant="outline"
                                                    className="text-[8px] px-1 py-0 h-3 font-mono text-emerald-600 border-emerald-500/40 bg-emerald-500/10"
                                                    data-testid={`tier-badge-${c.id}`}
                                                  >
                                                    T4
                                                  </Badge>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Direct ODPs: Tingkat 3 Langsung ke Core */}
                        {root.directOdps.map((odp) => {
                          const isOdpExpanded = expandedNodes.has(odp.id) || !!searchLower;

                          return (
                            <div key={odp.id} className="space-y-1">
                              <div
                                className={cn(
                                  "flex items-center justify-between p-1 rounded-md border transition-colors cursor-pointer text-[11px]",
                                  selectedNode?.id === odp.id
                                    ? "bg-amber-500/15 border-amber-500/40 text-amber-900 dark:text-amber-200"
                                    : "hover:bg-muted/60 border-transparent",
                                )}
                                onClick={() => {
                                  handleSelectInfra({
                                    id: odp.id,
                                    name: odp.name,
                                    type: "odp",
                                    status: odp.status,
                                    latitude: odp.latitude,
                                    longitude: odp.longitude,
                                    parentId: root.id,
                                    parentName: root.name,
                                    details: {
                                      tier: "Tingkat 3 (Direct ODP)",
                                      parentId: root.id,
                                      parentRoot: root.name,
                                      connectedCustomers: odp.customers.length,
                                    },
                                  });
                                  if (!expandedNodes.has(odp.id)) {
                                    toggleExpand(odp.id);
                                  }
                                }}
                                data-testid={`tree-node-${odp.id}`}
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <button
                                    type="button"
                                    className="p-0.5 hover:bg-muted rounded text-muted-foreground"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleExpand(odp.id);
                                    }}
                                    aria-label={isOdpExpanded ? "Ciutkan cabang" : "Bentangkan cabang"}
                                  >
                                    {isOdpExpanded ? (
                                      <ChevronDown className="size-2.5 shrink-0" />
                                    ) : (
                                      <ChevronRight className="size-2.5 shrink-0" />
                                    )}
                                  </button>
                                  <span className="size-1.5 rounded-full bg-amber-500 shrink-0" />
                                  <span className="font-medium truncate text-foreground">{odp.name}</span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] px-1 py-0 h-3.5 uppercase font-mono text-amber-600 border-amber-500/40 bg-amber-500/10"
                                    data-testid={`tier-badge-${odp.id}`}
                                  >
                                    T3 (Direct)
                                  </Badge>
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    {odp.customers.length} Cust
                                  </span>
                                </div>
                              </div>

                              {isOdpExpanded && odp.customers.length > 0 && (
                                <div className="pl-3 space-y-0.5 border-l border-border/40 ml-1.5">
                                  {odp.customers.map((c) => (
                                    <div
                                      key={c.id}
                                      className={cn(
                                        "flex items-center justify-between p-1 rounded hover:bg-muted/50 cursor-pointer text-[10px] transition-colors",
                                        selectedNode?.id === c.id && "bg-emerald-500/15 font-semibold text-emerald-900 dark:text-emerald-200",
                                      )}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleSelectCustomer({
                                          id: c.id,
                                          name: c.name,
                                          pppoeUsername: c.pppoeUsername,
                                          routerId: root.id,
                                          address: null,
                                          latitude: c.latitude,
                                          longitude: c.longitude,
                                          odpName: odp.name,
                                          billingStatus: c.billingStatus as "lunas" | "isolir",
                                          opticalPower: c.opticalPower,
                                          isOnline: c.isOnline,
                                          lastUpdatedAt: new Date(),
                                        });
                                      }}
                                      data-testid={`tree-node-${c.id}`}
                                    >
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span
                                          className={cn("size-1.5 rounded-full shrink-0", c.isOnline ? "bg-emerald-500" : "bg-rose-500")}
                                          title={c.isOnline ? "Online" : "Offline"}
                                        />
                                        <span className="truncate">{c.name}</span>
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0">
                                        {c.opticalPower !== null && (
                                          <span className="font-mono text-muted-foreground text-[9px]">
                                            {c.opticalPower} dBm
                                          </span>
                                        )}
                                        <Badge
                                          variant="outline"
                                          className="text-[8px] px-1 py-0 h-3 font-mono text-emerald-600 border-emerald-500/40 bg-emerald-500/10"
                                          data-testid={`tier-badge-${c.id}`}
                                        >
                                          T4
                                        </Badge>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Panel Kanan: Kanvas Peta Bertingkat */}
        <div className="flex-1 relative w-full h-full rounded-xl overflow-hidden border shadow-sm">
          {/* Tombol Terapung Buka Panel Pohon saat panel ditutup */}
          {!isTreeOpen && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsTreeOpen(true)}
              className="absolute top-3 left-3 z-[1000] shadow-md border border-border/80 bg-card/95 backdrop-blur-xs text-xs font-medium gap-1.5 h-8 px-2.5 hover:bg-muted"
              data-testid="floating-open-tree-button"
              title="Buka panel pohon relasi jaringan"
            >
              <Share2 className="size-3.5 text-primary rotate-90" />
              <span>Buka Pohon Relasi</span>
            </Button>
          )}

          <NetworkMapLeafletLoader
            data={mapCompatibleData}
            initialFocusId={initialFocusId ?? undefined}
            focusedNodeId={selectedNode?.id}
            onSelectCustomer={handleSelectCustomer}
            onSelectInfrastructure={handleSelectInfra}
            className="h-full w-full"
          />

          {/* Floating Detail Panel Saat Simpul Hierarki Dipilih */}
          {selectedNode && (
            <Card
              className="absolute bottom-4 right-4 z-[1000] w-80 max-w-[calc(100vw-2rem)] border-border/80 bg-card/95 backdrop-blur-md rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150"
              data-testid="selected-hierarchy-node-panel"
            >
              <CardContent className="p-3.5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] px-1.5 py-0.2 font-semibold uppercase",
                          selectedNode.tier === 1 && "text-purple-600 border-purple-500/40 bg-purple-500/10",
                          selectedNode.tier === 2 && "text-blue-600 border-blue-500/40 bg-blue-500/10",
                          selectedNode.tier === 3 && "text-amber-600 border-amber-500/40 bg-amber-500/10",
                          selectedNode.tier === 4 && "text-emerald-600 border-emerald-500/40 bg-emerald-500/10",
                        )}
                        data-testid="selected-node-tier-badge"
                      >
                        Tingkat {selectedNode.tier} • {selectedNode.type}
                      </Badge>

                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] px-1.5 py-0.2 font-semibold uppercase",
                          selectedNode.status === "active" || selectedNode.status === "online"
                            ? "text-emerald-600 border-emerald-500/30 bg-emerald-500/10"
                            : "text-rose-600 border-rose-500/30 bg-rose-500/10",
                        )}
                      >
                        {selectedNode.status}
                      </Badge>
                    </div>

                    <h3 className="font-bold text-sm text-foreground truncate" title={selectedNode.name}>
                      {selectedNode.name}
                    </h3>

                    {selectedNode.parentName && (
                      <div className="flex items-center justify-between gap-1 pt-0.5">
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1 min-w-0">
                          <span>Induk:</span>
                          <strong className="text-foreground truncate">{selectedNode.parentName}</strong>
                        </p>
                        {selectedNode.tier >= 2 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-5 px-1.5 text-[9px] gap-1 font-semibold shrink-0 border-primary/40 text-primary hover:bg-primary/10"
                            onClick={() => {
                              setIsReassignOpen(true);
                              setTargetParentId("");
                              setReassignSuccessMsg(null);
                              setReassignErrorMsg(null);
                            }}
                            data-testid="reassign-parent-button"
                            title="Pindahkan simpul ini ke induk lain"
                          >
                            <ArrowRightLeft className="size-2.5" />
                            <span>Pindah Induk</span>
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedNode(null)}
                    className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
                    aria-label="Tutup panel detail"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                {/* Kontrol UI Dialog/Panel Pindah Induk ke Induk Lain */}
                {isReassignOpen && (
                  <div
                    className="p-2.5 rounded-lg border border-primary/30 bg-primary/5 space-y-2 text-xs animate-in fade-in zoom-in-95 duration-100"
                    data-testid="reassign-parent-dialog"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-foreground flex items-center gap-1 text-[11px]">
                        <ArrowRightLeft className="size-3 text-primary" />
                        <span>Pindah ke Induk Baru</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsReassignOpen(false)}
                        className="text-muted-foreground hover:text-foreground p-0.5"
                        data-testid="cancel-reassign-button"
                        title="Batal pindah induk"
                      >
                        <X className="size-3" />
                      </button>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground block font-medium">
                        Pilih Induk Baru (Tingkat {selectedNode.tier - 1}):
                      </label>
                      <select
                        value={targetParentId}
                        onChange={(e) => setTargetParentId(e.target.value)}
                        className="w-full h-7 rounded border border-input bg-background px-2 text-xs text-foreground focus:outline-none"
                        data-testid="new-parent-select"
                        aria-label="Pilih induk baru"
                      >
                        <option value="">-- Pilih Induk Baru --</option>
                        {parentOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.name} ({opt.tier})
                          </option>
                        ))}
                      </select>
                    </div>

                    {reassignSuccessMsg && (
                      <p
                        className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1"
                        data-testid="reassign-sync-indicator"
                      >
                        <Check className="size-3" />
                        <span>{reassignSuccessMsg}</span>
                      </p>
                    )}

                    {reassignErrorMsg && (
                      <p className="text-[10px] text-destructive font-semibold flex items-center gap-1">
                        <AlertTriangle className="size-3" />
                        <span>{reassignErrorMsg}</span>
                      </p>
                    )}

                    <div className="flex items-center justify-end gap-1.5 pt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setIsReassignOpen(false)}
                        disabled={isSavingReassign}
                      >
                        Batal
                      </Button>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-6 px-2.5 text-[10px] gap-1 font-semibold"
                        onClick={handleExecuteReassign}
                        disabled={!targetParentId || isSavingReassign}
                        data-testid="confirm-reassign-button"
                      >
                        {isSavingReassign ? (
                          <>
                            <Loader2 className="size-3 animate-spin" />
                            <span>Menyimpan...</span>
                          </>
                        ) : (
                          <>
                            <Check className="size-3" />
                            <span>Simpan Perubahan</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Silsilah Jalur Bertingkat di Panel Detail */}
                {activeLineage.length > 1 && (
                  <div
                    className="space-y-1.5 bg-muted/40 p-2 rounded-lg border border-border/50 text-[11px]"
                    data-testid="selected-node-lineage-trail"
                  >
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold block tracking-wider">
                      Silsilah Induk-Anak (T1 &rarr; T4)
                    </span>
                    <div className="flex flex-wrap items-center gap-1 text-[11px]">
                      {activeLineage.map((st, i) => (
                        <span key={st.id} className="flex items-center gap-1">
                          {i > 0 && <span className="text-muted-foreground">&rarr;</span>}
                          <button
                            type="button"
                            onClick={() => handleSelectLineageStep(st)}
                            className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer",
                              st.id === selectedNode.id
                                ? cn(HIERARCHY_TIER_META[st.tier].badgeClass, "font-bold ring-1 ring-primary/40")
                                : "text-foreground hover:bg-muted/70",
                            )}
                            title={`Tingkat ${st.tier}: ${st.name}`}
                          >
                            T{st.tier}: {st.name}
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Detail Tambahan Simpul */}
                <div className="grid grid-cols-2 gap-2 text-xs bg-muted/40 p-2 rounded-lg border border-border/50">
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase block font-semibold">
                      Koordinat GPS
                    </span>
                    <span className="font-mono text-[11px] block truncate">
                      {selectedNode.latitude.toFixed(4)}, {selectedNode.longitude.toFixed(4)}
                    </span>
                  </div>

                  {selectedNode.opticalPower !== undefined && selectedNode.opticalPower !== null ? (
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground uppercase block font-semibold">
                        Sinyal Optik
                      </span>
                      <span className="font-mono text-[11px] font-bold block text-foreground">
                        {selectedNode.opticalPower} dBm
                      </span>
                    </div>
                  ) : selectedNode.capacity ? (
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground uppercase block font-semibold">
                        Kapasitas Port
                      </span>
                      <span className="font-mono text-[11px] font-bold block text-foreground">
                        {selectedNode.usedCapacity || 0} / {selectedNode.capacity}
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Tombol Aksi Salin & Google Maps */}
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-1/2 text-xs h-7 gap-1 font-medium"
                    onClick={handleCopyCoords}
                    data-testid="copy-hierarchy-node-coords"
                  >
                    {isCopied ? (
                      <>
                        <Check className="size-3.5 text-emerald-500" />
                        <span className="text-emerald-600 dark:text-emerald-400">Tersalin</span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5 text-muted-foreground" />
                        <span>Salin GPS</span>
                      </>
                    )}
                  </Button>

                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="w-1/2 text-xs h-7 gap-1 font-medium border-primary/20 text-muted-foreground hover:text-foreground"
                    data-testid="open-gmaps-hierarchy-node"
                  >
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${selectedNode.latitude},${selectedNode.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Navigation className="size-3.5 text-blue-500" />
                      <span>Rute Maps</span>
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
