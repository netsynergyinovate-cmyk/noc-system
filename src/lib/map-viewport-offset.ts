import type { Map as LeafletMap, ZoomPanOptions } from "leaflet";

export interface ViewportClearanceOffset {
  offsetX: number;
  offsetY: number;
}

/**
 * Menghitung offset piksel kamera agar titik marker tidak tertutup oleh panel detail
 * di pojok kanan bawah atau legenda bawah pada berbagai ukuran layar.
 */
export function getPanelClearanceOffset(
  viewportWidth: number,
): ViewportClearanceOffset {
  // Layar sempit/mobile: panel detail menutupi area bawah layar penuh
  if (viewportWidth < 768) {
    return { offsetX: 0, offsetY: -130 };
  }
  // Layar medium/tablet: panel detail selebar 352px di pojok kanan bawah
  if (viewportWidth < 1024) {
    return { offsetX: -110, offsetY: -70 };
  }
  // Layar desktop lebar: geser marker ke area tengah-kiri bebas rintangan
  return { offsetX: -150, offsetY: -50 };
}

/**
 * Menghitung koordinat tengah kamera baru (latitude & longitude) dengan kompensasi
 * offset piksel panel detail, sehingga titik target berada di area pandang terbuka.
 */
export function calculatePanelClearanceLatLng(
  map: LeafletMap,
  lat: number,
  lng: number,
  targetZoom?: number,
  customViewportWidth?: number,
): [number, number] {
  if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return [lat, lng];
  }

  const zoom = targetZoom ?? map.getZoom();
  const width =
    customViewportWidth ??
    (typeof window !== "undefined" ? window.innerWidth : 1200);

  const { offsetX, offsetY } = getPanelClearanceOffset(width);

  // Proyeksikan koordinat spasial ke sistem koordinat piksel Leaflet
  const targetPoint = map.project([lat, lng], zoom);

  // Sesuaikan titik tengah kamera: kurangkan offset piksel
  const adjustedPoint: [number, number] = [
    targetPoint.x - offsetX,
    targetPoint.y - offsetY,
  ];

  // Kembalikan ke koordinat geografis LatLng
  const adjustedLatLng = map.unproject(adjustedPoint, zoom);

  return [adjustedLatLng.lat, adjustedLatLng.lng];
}

/**
 * Mencegah panel detail menutupi titik terpilih dengan menggerakkan kamera Leaflet
 * ke koordinat geografis yang telah disesuaikan dengan offset panel.
 */
export function flyToWithoutOcclusion(
  map: LeafletMap | null,
  lat: number,
  lng: number,
  targetZoom = 17,
  options: ZoomPanOptions = { duration: 0.8 },
): boolean {
  if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }

  const [adjustedLat, adjustedLng] = calculatePanelClearanceLatLng(
    map,
    lat,
    lng,
    targetZoom,
  );

  map.flyTo([adjustedLat, adjustedLng], targetZoom, options);
  return true;
}
