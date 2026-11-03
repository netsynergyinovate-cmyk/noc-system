"use client";

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { LatLngBoundsExpression, Map as LeafletMap } from "leaflet";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Layers, Navigation } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { BillingStatusBadge } from "./billing-status-badge";
import { getCustomerHealth, healthLabels } from "@/lib/dashboard/health";
import { getOdpList, type OdpPoint } from "@/lib/dashboard/odp";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { fetchRoadRoute, type RoadRoute } from "@/lib/dashboard/routing";
import { useDashboardStore } from "@/lib/dashboard/store";
import {
  getResolvedTheme,
  subscribeTheme,
  type ResolvedTheme,
} from "@/lib/theme";
import type { CustomerHealth, DashboardCustomer } from "@/lib/dashboard/types";

// Zoom jalan kaki: cukup dekat untuk membedakan rumah, cukup jauh untuk melihat
// sekitarnya.
const FOCUS_ZOOM = 16;
const FLY_SECONDS = 0.8;
const FOCUS_RING_RADIUS = 16;
const BOUNDS_PADDING: [number, number] = [24, 24];

interface MarkerStyle {
  radius: number;
  pathOptions: { color: string; fillColor: string; fillOpacity: number };
}

interface MapStyles {
  markers: Record<CustomerHealth, MarkerStyle>;
  // Warna cincin sorotan: kontras dengan ketiga warna status.
  focus: string;
}

// Isi tooltip titik: nama dan status, lalu ODP/lokasi bila diketahui, lalu
// penanda tagihan (Lunas atau Isolir). Kotak tooltip Leaflet selalu putih (tidak
// ikut tema), jadi warna teks tetap dan penandanya memakai warna untuk
// permukaan terang.
function CustomerLabel({ customer }: { customer: DashboardCustomer }) {
  return (
    <span className="block">
      {customer.name} · {healthLabels[getCustomerHealth(customer)]}
      {customer.odpName && (
        <span
          className="block text-xs text-neutral-600"
          data-testid="customer-odp"
        >
          {customer.odpName}
        </span>
      )}
      <span className="mt-1 block">
        <BillingStatusBadge status={customer.billingStatus} surface="light" />
      </span>
    </span>
  );
}

// Marker ODP dengan warna cyan pembeda dan tooltip info pelanggan terhubung.
const OdpMarker = memo(function OdpMarker({ odp }: { odp: OdpPoint }) {
  const center = useMemo<[number, number]>(
    () => [odp.latitude, odp.longitude],
    [odp.latitude, odp.longitude],
  );
  return (
    <CircleMarker
      center={center}
      radius={8}
      pathOptions={{
        color: "#0891b2",
        fillColor: "#06b6d4",
        fillOpacity: 0.85,
        weight: 2,
      }}
    >
      <Tooltip>
        <span className="block font-medium" data-testid="odp-tooltip">
          {odp.name} · {odp.customerCount} pelanggan
        </span>
      </Tooltip>
    </CircleMarker>
  );
});

// Titik digambar di satu canvas Leaflet (preferCanvas), bukan 100 elemen DOM.
// Objek pelanggan hanya berganti saat statusnya berubah, jadi marker lain
// tidak digambar ulang.
const CustomerMarker = memo(function CustomerMarker({
  customer,
  styles,
}: {
  customer: DashboardCustomer;
  styles: Record<CustomerHealth, MarkerStyle>;
}) {
  const health = getCustomerHealth(customer);
  const { radius, pathOptions } = styles[health];
  const center = useMemo<[number, number]>(
    () => [customer.latitude, customer.longitude],
    [customer.latitude, customer.longitude],
  );
  const eventHandlers = useMemo(
    () => ({
      click: () => {
        useDashboardStore.getState().focusMap(customer.id);
      },
    }),
    [customer.id],
  );
  return (
    <CircleMarker
      center={center}
      radius={radius}
      pathOptions={pathOptions}
      eventHandlers={eventHandlers}
    >
      <Tooltip>
        <CustomerLabel customer={customer} />
      </Tooltip>
    </CircleMarker>
  );
});

// Cincin dan nama di sekitar pelanggan yang disorot. Digambar di atas marker
// lain karena ditambahkan setelahnya.
function FocusRing({
  customer,
  color,
}: {
  customer: DashboardCustomer;
  color: string;
}) {
  const center = useMemo<[number, number]>(
    () => [customer.latitude, customer.longitude],
    [customer.latitude, customer.longitude],
  );
  const pathOptions = useMemo(
    () => ({ color, weight: 3, fill: false }),
    [color],
  );
  return (
    <CircleMarker
      center={center}
      radius={FOCUS_RING_RADIUS}
      pathOptions={pathOptions}
      interactive={false}
    >
      <Tooltip permanent direction="top" offset={[0, -FOCUS_RING_RADIUS]}>
        <CustomerLabel customer={customer} />
      </Tooltip>
    </CircleMarker>
  );
}

function readStyles(): MapStyles {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  const make = (color: string, radius: number): MarkerStyle => ({
    radius,
    pathOptions: { color, fillColor: color, fillOpacity: 0.65 },
  });
  return {
    markers: {
      ok: make(token("--success"), 6),
      warning: make(token("--warning"), 7),
      critical: make(token("--destructive"), 8),
    },
    focus: token("--foreground"),
  };
}

// Pelanggan hasil impor dari router belum punya koordinat (backend mengirim
// null). Tanpa titik yang sah, Leaflet melempar "Invalid LatLng" dan halaman
// jatuh, jadi hanya pelanggan bertitik yang digambar; sisanya tetap ada di tabel.
const hasPoint = (customer: DashboardCustomer) =>
  Number.isFinite(customer.latitude) && Number.isFinite(customer.longitude);

// Tampilan awal bila belum ada satu pun titik: seluruh Indonesia.
const DEFAULT_BOUNDS: LatLngBoundsExpression = [
  [-11, 95],
  [6, 141],
];

function getBounds(customers: DashboardCustomer[]): LatLngBoundsExpression {
  if (customers.length === 0) return DEFAULT_BOUNDS;
  const lats = customers.map((customer) => customer.latitude);
  const lngs = customers.map((customer) => customer.longitude);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

// Warna dibaca dari token CSS sekali per tema; objek yang sama dipakai ulang
// supaya marker yang tidak berubah tidak digambar ulang.
const stylesByTheme = new Map<ResolvedTheme, MapStyles>();

function getStyles(theme: ResolvedTheme) {
  let styles = stylesByTheme.get(theme);
  if (!styles) {
    styles = readStyles();
    stylesByTheme.set(theme, styles);
  }
  return styles;
}

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Menggeser peta ke pelanggan yang diminta, sekali per permintaan. Permintaan
// yang pelanggannya belum ada (mis. snapshot belum datang) ditunda sampai ada.
function useFlyToFocus(
  map: LeafletMap | null,
  seq: number | undefined,
  customer: DashboardCustomer | null,
) {
  const handledSeq = useRef(0);
  useEffect(() => {
    if (!map || seq === undefined || !customer || handledSeq.current === seq) {
      return;
    }
    handledSeq.current = seq;
    const center: [number, number] = [customer.latitude, customer.longitude];
    if (prefersReducedMotion()) {
      map.setView(center, FOCUS_ZOOM, { animate: false });
    } else {
      map.flyTo(center, FOCUS_ZOOM, { duration: FLY_SECONDS });
    }
  }, [map, seq, customer]);
}

// ODP yang sama dengan halaman Peta: perangkat tipe `odp` dan tautan pelanggan -> ODP dari
// /api/peta/data, dibaca sekali (bukan polling). Pelanggan dan koordinatnya sudah sama
// (satu tabel `customers`); odpName di tabel itu kosong, penautan ODP hanya ada di Peta.
// Mode demo tetap memakai ODP contoh karena pelanggan contohnya juga tiruan.
interface PetaOdps {
  odps: (Omit<OdpPoint, "customerCount"> & { connected?: number })[];
  odpOfCustomer: Map<string, string>;
}

function useOdpList(located: DashboardCustomer[]) {
  const isDemo = useSession(selectPreviewEnabled);
  const [peta, setPeta] = useState<PetaOdps>({
    odps: [],
    odpOfCustomer: new Map(),
  });

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    fetch("/api/peta/data", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          body: {
            data?: {
              devices?: {
                id: string;
                name: string;
                type: string;
                latitude: number;
                longitude: number;
                connectedCustomersCount?: number;
              }[];
              customers?: { id: string; odpId?: string | null }[];
            };
          } | null,
        ) => {
          const data = body?.data;
          if (cancelled || !data?.devices || !data.customers) return;
          setPeta({
            odps: data.devices
              .filter(
                (d) =>
                  d.type === "odp" &&
                  Number.isFinite(d.latitude) &&
                  Number.isFinite(d.longitude),
              )
              .map((d) => ({
                id: d.id,
                name: d.name,
                latitude: d.latitude,
                longitude: d.longitude,
                connected: d.connectedCustomersCount,
              })),
            odpOfCustomer: new Map(
              data.customers.flatMap((c) =>
                c.odpId ? [[c.id, c.odpId] as const] : [],
              ),
            ),
          });
        },
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isDemo]);

  const odpList = useMemo(() => {
    if (isDemo) return getOdpList(located);
    const counts = new Map<string, number>();
    for (const c of located) {
      const odpId = peta.odpOfCustomer.get(c.id);
      if (odpId) counts.set(odpId, (counts.get(odpId) ?? 0) + 1);
    }
    return peta.odps.map(({ connected, ...o }) => ({
      ...o,
      customerCount: connected ?? counts.get(o.id) ?? 0,
    }));
  }, [isDemo, peta, located]);

  // ODP yang melayani satu pelanggan (untuk rute kabel); undefined bila belum tercatat.
  const odpOf = (customer: DashboardCustomer) =>
    isDemo
      ? odpList.find((o) => o.name === customer.odpName)
      : odpList.find((o) => o.id === peta.odpOfCustomer.get(customer.id));

  // Pelanggan dengan nama ODP dari Peta (odp_name di tabel pelanggan kosong), untuk label.
  const labeled = useMemo(
    () =>
      isDemo
        ? located
        : located.map((c) => {
            const name = odpList.find(
              (o) => o.id === peta.odpOfCustomer.get(c.id),
            )?.name;
            return name ? { ...c, odpName: name } : c;
          }),
    [isDemo, located, odpList, peta],
  );

  return { odpList, odpOf, labeled };
}

// Dimuat hanya di browser (dynamic ssr:false), karena Leaflet butuh `window`.
export function CustomerMap() {
  const customers = useDashboardStore((state) => state.customers);
  const mapFocus = useDashboardStore((state) => state.mapFocus);
  const clearMapFocus = useDashboardStore((state) => state.clearMapFocus);
  const theme = useSyncExternalStore(
    subscribeTheme,
    getResolvedTheme,
    (): ResolvedTheme => "light",
  );
  const styles = getStyles(theme);
  // Hanya pelanggan bertitik yang masuk peta; `customers` utuh tetap dipakai tabel.
  const located = useMemo(() => customers.filter(hasPoint), [customers]);
  const unlocatedCount = customers.length - located.length;
  const bounds = useMemo(() => getBounds(located), [located]);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);

  // Layer mode: "satellite" (default) atau "streets" (OSM)
  const [layerMode, setLayerMode] = useState<"satellite" | "streets">(
    "satellite",
  );

  // GPS Lokasi Pengguna
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
  } | null>(null);
  const [geoStatus, setGeoStatus] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  // Titik ODP (sama dengan halaman Peta)
  const { odpList, odpOf, labeled } = useOdpList(located);

  const focused = useMemo(
    () =>
      mapFocus
        ? (located.find((customer) => customer.id === mapFocus.customerId) ??
          null)
        : null,
    [mapFocus, located],
  );

  // Snapshot sering datang setelah peta terpasang: begitu titik pertama ada,
  // arahkan peta ke sana (sekali), bukan tetap di tampilan awal.
  const fitted = useRef(located.length > 0);
  useEffect(() => {
    if (!map || fitted.current || located.length === 0) return;
    fitted.current = true;
    map.fitBounds(getBounds(located), {
      padding: BOUNDS_PADDING,
      animate: false,
    });
  }, [map, located]);
  useFlyToFocus(map, mapFocus?.seq, focused);

  // Rute kabel mengikuti jalan (OSRM) dari ODP ke pelanggan yang disorot
  const [activeRoute, setActiveRoute] = useState<RoadRoute | null>(null);
  const focusedOdp = focused ? odpOf(focused) : undefined;
  const odpLat = focusedOdp?.latitude;
  const odpLng = focusedOdp?.longitude;

  useEffect(() => {
    if (!focused || odpLat === undefined || odpLng === undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveRoute(null);
      return;
    }

    let isMounted = true;
    setActiveRoute(null);
    fetchRoadRoute([odpLat, odpLng], [focused.latitude, focused.longitude])
      .then((route) => {
        if (isMounted) {
          setActiveRoute(route);
        }
      })
      .catch(() => {
        if (isMounted) {
          setActiveRoute(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [focused, odpLat, odpLng]);

  useEffect(() => {
    if (!map) return;
    const container = map.getContainer() as HTMLElement & {
      _leaflet_map?: LeafletMap;
    };
    container._leaflet_map = map;
    const update = () => setZoom(map.getZoom());
    map.on("zoomend", update);
    // Dibaca sesudah pemasangan supaya tidak mengubah state saat render.
    const frame = requestAnimationFrame(update);
    return () => {
      map.off("zoomend", update);
      cancelAnimationFrame(frame);
    };
  }, [map]);

  const handleLocateMe = () => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setGeoStatus("Geolocation tidak didukung oleh peramban ini.");
      return;
    }
    setIsLocating(true);
    setGeoStatus(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsLocating(false);
        const { latitude, longitude, accuracy } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude, accuracy });
        setGeoStatus(null);
        if (map) {
          if (prefersReducedMotion()) {
            map.setView([latitude, longitude], 17, { animate: false });
          } else {
            map.flyTo([latitude, longitude], 17, { duration: FLY_SECONDS });
          }
        }
      },
      (error) => {
        setIsLocating(false);
        if (error.code === error.PERMISSION_DENIED) {
          setGeoStatus("Izin akses lokasi ditolak.");
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setGeoStatus("Lokasi tidak dapat ditentukan.");
        } else if (error.code === error.TIMEOUT) {
          setGeoStatus("Waktu pencarian lokasi habis.");
        } else {
          setGeoStatus("Gagal mengambil lokasi perangkat.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const toggleLayerMode = () => {
    setLayerMode((prev) => (prev === "satellite" ? "streets" : "satellite"));
  };

  // Menutup sorotan. Tombolnya ikut hilang, jadi fokus papan ketik dikembalikan
  // ke peta supaya pengguna tidak terlempar ke awal halaman.
  function closeFocus(showEveryone: boolean) {
    clearMapFocus();
    if (showEveryone) {
      map?.fitBounds(bounds, {
        padding: BOUNDS_PADDING,
        animate: !prefersReducedMotion(),
      });
    }
    map?.getContainer().focus();
  }

  return (
    <div
      className="relative"
      data-testid="customer-map"
      data-layer={layerMode}
      data-zoom={zoom ?? undefined}
      data-odp-count={odpList.length}
      data-has-route={activeRoute ? "true" : undefined}
      data-cable-distance={activeRoute?.distanceMeters ?? undefined}
    >
      <MapContainer
        ref={setMap}
        bounds={bounds}
        boundsOptions={{ padding: BOUNDS_PADDING }}
        preferCanvas
        maxZoom={20}
        scrollWheelZoom={false}
        className={cn(
          "h-72 w-full rounded-lg",
          layerMode === "satellite"
            ? "leaflet-layer-satellite"
            : "leaflet-layer-streets",
        )}
      >
        {layerMode === "satellite" ? (
          <TileLayer
            key="satellite-google"
            attribution='&copy; <a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer">Google Maps</a>'
            url="https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=id"
            subdomains={["mt0", "mt1", "mt2", "mt3"]}
            maxNativeZoom={19}
            maxZoom={20}
          />
        ) : (
          <TileLayer
            key="streets"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            subdomains={["a", "b", "c"]}
            maxNativeZoom={19}
            maxZoom={20}
          />
        )}

        {/* Jalur kabel drop optic menyusuri jalan dari ODP ke pelanggan */}
        {activeRoute && (
          <Polyline
            positions={activeRoute.coordinates}
            pathOptions={{ color: "#22d3ee", weight: 4, opacity: 0.95 }}
          />
        )}

        {/* Titik persebaran ODP */}
        {odpList.map((odp) => (
          <OdpMarker key={odp.id} odp={odp} />
        ))}

        {/* Titik pelanggan */}
        {labeled.map((customer) => (
          <CustomerMarker
            key={customer.id}
            customer={customer}
            styles={styles.markers}
          />
        ))}

        {/* Titik GPS Teknisi */}
        {userLocation && (
          <>
            <Circle
              center={[userLocation.lat, userLocation.lng]}
              radius={userLocation.accuracy}
              pathOptions={{
                color: "#3b82f6",
                fillColor: "#3b82f6",
                fillOpacity: 0.15,
                weight: 1,
              }}
            />
            <CircleMarker
              center={[userLocation.lat, userLocation.lng]}
              radius={7}
              pathOptions={{
                color: "#ffffff",
                fillColor: "#2563eb",
                fillOpacity: 1,
                weight: 2,
              }}
            >
              <Tooltip>
                <span>
                  Lokasi Saya (±{Math.round(userLocation.accuracy)} m)
                </span>
              </Tooltip>
            </CircleMarker>
          </>
        )}

        {/* Cincin penyorot pelanggan aktif */}
        {focused && mapFocus && (
          <FocusRing
            key={mapFocus.seq}
            customer={focused}
            color={styles.focus}
          />
        )}
      </MapContainer>

      {unlocatedCount > 0 && (
        <p
          className="mt-2 text-xs text-muted-foreground"
          data-testid="map-unlocated-notice"
        >
          {located.length === 0
            ? `${unlocatedCount} pelanggan belum punya koordinat, jadi belum tampil di peta.`
            : `${unlocatedCount} dari ${customers.length} pelanggan belum punya koordinat dan tidak tampil di peta.`}{" "}
          Lengkapi latitude dan longitude pelanggan agar muncul.
        </p>
      )}

      {mapFocus && (
        <div className="absolute top-2 right-2 z-[1000] flex max-w-[calc(100%-4rem)] items-center gap-2 rounded-md border bg-card/95 py-1 pr-1 pl-2.5 text-xs shadow-sm">
          <span
            className="line-clamp-2 min-w-0 leading-tight"
            data-testid="map-focus-banner"
          >
            {focused ? (
              <>
                Menyorot{" "}
                <strong className="font-semibold">{focused.name}</strong>
                {activeRoute && focused.odpName && (
                  <span className="text-muted-foreground">
                    {" "}
                    · Kabel: {activeRoute.distanceMeters} m ({focused.odpName})
                  </span>
                )}
              </>
            ) : (
              "Pelanggan tidak (atau belum) ada di peta"
            )}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => closeFocus(Boolean(focused))}
          >
            {focused ? "Tampilkan semua" : "Tutup"}
          </Button>
        </div>
      )}

      {/* Kontrol Layer Switcher & GPS Teknisi (Minimalis) */}
      <div className="absolute bottom-2 left-2 z-[1000] flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs gap-1.5 bg-card/95 shadow-sm font-medium"
          data-testid="layer-switcher"
          data-layer={layerMode}
          title={
            layerMode === "satellite"
              ? "Beralih ke Peta Jalan"
              : "Beralih ke Satelit"
          }
          onClick={toggleLayerMode}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>{layerMode === "satellite" ? "Satelit" : "Peta Jalan"}</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs gap-1.5 bg-card/95 shadow-sm font-medium"
          data-testid="gps-button"
          data-located={userLocation ? "true" : undefined}
          aria-label="Lokasi Saya"
          title="Lokasi Saya"
          onClick={handleLocateMe}
          disabled={isLocating}
        >
          <Navigation className="h-3.5 w-3.5" />
          <span>Lokasi Saya</span>
        </Button>
        {geoStatus && (
          <span
            className="rounded bg-card/95 px-2 py-1 text-[11px] text-muted-foreground shadow-sm border"
            data-testid="geo-status"
          >
            {geoStatus}
          </span>
        )}
      </div>

      <p role="status" className="sr-only">
        {geoStatus
          ? geoStatus
          : focused
            ? `Peta digeser ke ${focused.name}`
            : mapFocus
              ? "Pelanggan tidak ditemukan di peta"
              : ""}
      </p>

      {/* Daftar titik distribusi ODP untuk aksesibilitas & pengujian */}
      <div className="sr-only" data-testid="odp-markers-container">
        {odpList.map((odp) => (
          <span
            key={odp.id}
            data-testid="odp-marker"
            data-odp-name={odp.name}
            data-customer-count={odp.customerCount}
          >
            {odp.name} · {odp.customerCount} pelanggan
          </span>
        ))}
      </div>
    </div>
  );
}
