"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  NetworkCustomerPoint,
  NetworkInfrastructurePoint,
  NetworkMapData,
} from "@/services/network-map.service";
import { LOCAL_MOCK_NETWORK_MAP_DATA } from "@/services/network-map-mock";

export interface UseNetworkMapMarkersOptions {
  initialData?: NetworkMapData | null;
  useMockFallback?: boolean;
  autoRefreshIntervalMs?: number;
}

export type PointStatusFilter =
  "all" | "online" | "offline" | "weak" | "isolir" | "geocoded";

export interface UseNetworkMapMarkersResult {
  data: NetworkMapData | null;
  customers: NetworkCustomerPoint[];
  infrastructure: NetworkInfrastructurePoint[];
  isLoading: boolean;
  error: string | null;
  isMockData: boolean;
  refetch: () => Promise<void>;
  filterMarkers: (
    searchQuery: string,
    statusFilter?: PointStatusFilter,
    regionFilter?: string,
  ) => {
    filteredCustomers: NetworkCustomerPoint[];
    geocodedCustomers: NetworkCustomerPoint[];
    filteredInfrastructure: NetworkInfrastructurePoint[];
  };
}

export function useNetworkMapMarkers(
  options: UseNetworkMapMarkersOptions = {},
): UseNetworkMapMarkersResult {
  const {
    initialData,
    useMockFallback = false,
    autoRefreshIntervalMs,
  } = options;

  const [data, setData] = useState<NetworkMapData | null>(
    initialData ?? (useMockFallback ? LOCAL_MOCK_NETWORK_MAP_DATA : null),
  );
  const [isLoading, setIsLoading] = useState<boolean>(
    !initialData && !useMockFallback,
  );
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const url = useMockFallback
        ? "/api/map/network?mode=mock"
        : "/api/map/network";
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Gagal memuat penanda peta`);
      }
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data);
        setError(null);
      } else {
        throw new Error(json.error || "Format data peta tidak valid");
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Gagal memuat penanda peta";
      setError(msg);

      // Jika mock fallback diaktifkan dan terjadi kegagalan muat, gunakan mock lokal transparan
      if (useMockFallback) {
        setData(LOCAL_MOCK_NETWORK_MAP_DATA);
      }
    } finally {
      setIsLoading(false);
    }
  }, [useMockFallback]);

  useEffect(() => {
    let active = true;
    if (!initialData) {
      const url = useMockFallback
        ? "/api/map/network?mode=mock"
        : "/api/map/network";
      fetch(url, { credentials: "same-origin" })
        .then((res) => {
          if (!res.ok)
            throw new Error(`HTTP ${res.status}: Gagal memuat penanda peta`);
          return res.json();
        })
        .then((json) => {
          if (active && json.success && json.data) {
            setData(json.data);
            setIsLoading(false);
          }
        })
        .catch((err) => {
          if (active) {
            setError(
              err instanceof Error ? err.message : "Gagal memuat penanda peta",
            );
            if (useMockFallback) {
              setData(LOCAL_MOCK_NETWORK_MAP_DATA);
            }
            setIsLoading(false);
          }
        });
    }
    return () => {
      active = false;
    };
  }, [initialData, useMockFallback]);

  // Opsional auto-refresh interval
  useEffect(() => {
    if (!autoRefreshIntervalMs || autoRefreshIntervalMs <= 0) return;
    const interval = setInterval(() => {
      fetchData();
    }, autoRefreshIntervalMs);
    return () => clearInterval(interval);
  }, [autoRefreshIntervalMs, fetchData]);

  const customers = useMemo(() => data?.customers ?? [], [data]);
  const infrastructure = useMemo(() => data?.infrastructure ?? [], [data]);
  const isMockData = useMemo(() => !data?.dataSource.isRealData, [data]);

  const filterMarkers = useCallback(
    (
      searchQuery: string,
      statusFilter: PointStatusFilter = "all",
      regionFilter: string = "all",
    ) => {
      const q = searchQuery.trim().toLowerCase();

      const filteredCustomers = customers.filter((c) => {
        if (statusFilter === "online" && !c.isOnline) return false;
        if (statusFilter === "offline" && c.isOnline) return false;
        if (statusFilter === "weak") {
          if (!c.opticalPower || c.opticalPower > -24.5) return false;
        }
        if (statusFilter === "isolir" && c.billingStatus !== "isolir")
          return false;
        if (statusFilter === "geocoded") {
          if (
            c.latitude === null ||
            c.longitude === null ||
            !Number.isFinite(c.latitude) ||
            !Number.isFinite(c.longitude)
          ) {
            return false;
          }
        }

        if (regionFilter && regionFilter !== "all") {
          if (c.odpName !== regionFilter) return false;
        }

        if (q) {
          const matchName = c.name.toLowerCase().includes(q);
          const matchUser = c.pppoeUsername.toLowerCase().includes(q);
          const matchId = c.id.toLowerCase().includes(q);
          const matchSerial =
            c.onuDetails?.serialNumber?.toLowerCase().includes(q) ?? false;
          const matchOdp = c.odpName?.toLowerCase().includes(q) ?? false;
          const matchAddress = c.address?.toLowerCase().includes(q) ?? false;
          if (
            !matchName &&
            !matchUser &&
            !matchId &&
            !matchSerial &&
            !matchOdp &&
            !matchAddress
          ) {
            return false;
          }
        }

        return true;
      });

      const geocodedCustomers = filteredCustomers.filter(
        (c) =>
          c.latitude !== null &&
          c.longitude !== null &&
          Number.isFinite(c.latitude) &&
          Number.isFinite(c.longitude),
      );

      const filteredInfrastructure = infrastructure.filter((i) => {
        if (regionFilter && regionFilter !== "all") {
          if (i.type === "odp" && i.name !== regionFilter) return false;
        }

        if (!q) return true;
        return (
          i.name.toLowerCase().includes(q) ||
          i.type.toLowerCase().includes(q) ||
          (i.host && i.host.toLowerCase().includes(q))
        );
      });

      return {
        filteredCustomers,
        geocodedCustomers,
        filteredInfrastructure,
      };
    },
    [customers, infrastructure],
  );

  return {
    data,
    customers,
    infrastructure,
    isLoading,
    error,
    isMockData,
    refetch: fetchData,
    filterMarkers,
  };
}
