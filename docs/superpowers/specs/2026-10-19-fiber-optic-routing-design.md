# Fiber Optic Route Mapping & Connection Logic

**Tanggal:** 2026-10-19
**Branch:** feat/satellite-map-and-odp-routing

---

## Konteks

Sistem peta GIS infrastruktur jaringan ISP (Fiber Optic) menggunakan Leaflet. Marker ODP sudah tampil akurat. Masalah: koneksi polyline antar OLT→ODC→ODP chain gagal render dengan benar karena relasi parent-child tidak terstruktur.

---

## Keputusan Desain

| Pertanyaan | Jawaban |
|---|---|
| "Jalur" (route) sudah ada? | Ya, sebagai label di `details` JSON — dipromote ke kolom proper |
| Mode "Buat Jalur" sudah ada? | Ya — tinggal tambah logika auto-connect |
| Rendering polyline | Tetap di backend, frontend terima `CableRouteSegment[]` |
| Sumber kebenaran topologi | `networkDeviceRelations` (bukan `parentId` kolom langsung) |

---

## Seksi 1: Database Schema

### Tabel Baru: `network_routes`

```sql
CREATE TABLE network_routes (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  olt_id      TEXT REFERENCES network_infrastructure(id) ON DELETE SET NULL,
  odc_id      TEXT REFERENCES network_infrastructure(id) ON DELETE SET NULL,
  pon_port    TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX network_routes_olt_idx ON network_routes(olt_id);
CREATE INDEX network_routes_odc_idx ON network_routes(odc_id);
```

### Migrasi `network_infrastructure`

```sql
ALTER TABLE network_infrastructure
  ADD COLUMN route_id TEXT REFERENCES network_routes(id) ON DELETE SET NULL;

CREATE INDEX network_infra_route_idx ON network_infrastructure(route_id);

-- One-time backfill dari details JSON (jika ada)
-- CATATAN: hanya berjalan jika details->>'routeId' sudah berformat UUID dan ada di network_routes.
-- Jika sebelumnya disimpan sebagai nama string bebas, backfill ini skip — assign manual via UI.
UPDATE network_infrastructure
SET route_id = details->>'routeId'
WHERE details->>'routeId' IS NOT NULL
  AND details->>'routeId' IN (SELECT id FROM network_routes);
```

### `networkDeviceRelations` — Tidak Ada Perubahan Skema

Digunakan sebagai sumber kebenaran topologi dengan konvensi:
- `relation_type = 'hierarchy'` → ODP chain (OLT→ODC→ODP1→ODP2→...)
- `relation_type = 'feeder'` → backbone (Router→OLT)
- `relation_type = 'backup'` → path redundan

### Query "ODP Terakhir di Jalur X" (Tail Node)

```sql
SELECT ni.*
FROM network_infrastructure ni
JOIN network_device_relations ndr ON ndr.child_id = ni.id
WHERE ni.route_id = $1
  AND ni.type = 'odp'
  AND NOT EXISTS (
    SELECT 1
    FROM network_device_relations ndr2
    JOIN network_infrastructure ni2 ON ni2.id = ndr2.parent_id
    WHERE ndr2.parent_id = ni.id
      AND ni2.route_id = $1
  )
LIMIT 1;
```

---

## Seksi 2: API & Service Layer

### File Baru: `src/services/route.service.ts`

```ts
createRoute(input: { name, olt_id?, odc_id?, pon_port?, description? })
  → INSERT network_routes → return route

getRoute(routeId: string)
  → SELECT network_routes WHERE id = routeId → return route | null

listRoutes()
  → SELECT network_routes JOIN network_infrastructure (nama OLT, ODC) → return list

getLastOdpInRoute(routeId: string)
  → tail-node query → return NetworkInfrastructure | null

connectOdp(childId: string, parentId: string, routeId: string)
  → checkNoCycle(childId, parentId)          // cycle detection
  → INSERT network_device_relations (parent_id, child_id, 'hierarchy')
  → UPDATE network_infrastructure SET route_id = routeId WHERE id = childId
  → return relation
```

### Auto-Connect Logic (saat buat ODP baru)

```ts
// Di service create infrastructure, jika input.routeId ada:
const route = await getRoute(input.routeId)
const tail = await getLastOdpInRoute(input.routeId)
const parentId = tail?.id ?? route.odc_id  // fallback ke ODC jika chain kosong
await connectOdp(newOdp.id, parentId, input.routeId)
```

### Refactor `cable-map.service.ts`

Bagian "Ekstrak jalur kabel antar perangkat infrastruktur":
- **Sebelum:** baca `infra.parentId` atau `infra.details.parentId/parentOdc/parentRoot`
- **Setelah:** JOIN `network_device_relations WHERE relation_type = 'hierarchy'`, build map `childId → parentId`
- **Fallback:** jika node tidak punya entri di `networkDeviceRelations`, fallback ke `infra.parentId` (backward compatible)

### Cycle Detection

Saat insert relasi baru (childId, parentId), cek dengan CTE rekursif:

```sql
WITH RECURSIVE ancestors AS (
  SELECT parent_id FROM network_device_relations WHERE child_id = $parentId
  UNION ALL
  SELECT ndr.parent_id FROM network_device_relations ndr
  JOIN ancestors a ON ndr.child_id = a.parent_id
)
SELECT 1 FROM ancestors WHERE parent_id = $childId LIMIT 1;
```

Jika ada hasil → tolak insert dengan error `"Koneksi membentuk loop — tidak diizinkan"`.

### Endpoints Baru

```
POST /api/map/routes              → createRoute
GET  /api/map/routes              → listRoutes
GET  /api/map/routes/[id]/tail    → getLastOdpInRoute
POST /api/map/routes/connect      → connectOdp manual
```

### Endpoint Diperluas

```
POST /api/map/infrastructure      → terima routeId opsional → trigger auto-connect
```

---

## Seksi 3: Frontend Form & Leaflet Rendering

### Form ODP — Perubahan

Field baru: **"Jalur"** (dropdown mengambil dari `GET /api/map/routes`)

```
┌─ Form ODP ──────────────────────────────┐
│ Nama ODP       [________________]        │
│ Jalur          [dropdown: listRoutes()]  │  ← baru
│ Koneksi ke     [auto-fill atau dropdown] │  ← sudah ada, diperbaiki
│ Latitude/Long  [...]                     │
└─────────────────────────────────────────┘
```

**Mode "Buat Jalur X" aktif** (`activeRouteId` ter-set di state peta):
- Field "Jalur" ter-lock ke `activeRouteId`
- Field "Koneksi ke" auto-fill dari `GET /api/map/routes/:id/tail`
- User bisa override manual jika mau

**Mode normal** (tidak ada `activeRouteId`):
- Field "Jalur" dropdown bebas
- Field "Koneksi ke" dropdown search semua ODP

### State Komponen Peta

```ts
activeRouteId: string | null  // null = mode normal, string = mode buat jalur aktif
```

Saat `activeRouteId` set dan user klik "Tambah ODP" → form kirim `routeId` → backend auto-connect ke tail node.

### Leaflet Rendering — Tidak Ada Perubahan Komponen

Backend membangun segmen dari `networkDeviceRelations` (bukan `parentId`):
```
Router → OLT    (backbone)
OLT → ODC       (backbone)
ODC → ODP-1     (feeder)
ODP-1 → ODP-2   (feeder)
ODP-2 → ODP-3   (feeder)
ODP-N → Customer (drop)
```

Frontend tetap terima `CableRouteSegment[]` → render `L.polyline` per segmen. Tidak ada perubahan di komponen Leaflet.

---

## Error Handling & Edge Cases

| Kasus | Penanganan |
|---|---|
| ODP dibuat tanpa `routeId` | Tidak ada auto-connect. `parentId` kolom lama masih dipakai sebagai fallback |
| `routeId` ada tapi chain kosong | Fallback parent ke `route.odc_id` |
| `odc_id` juga null | Fallback parent ke `route.olt_id` |
| Koneksi membentuk cycle | Tolak insert, return 422 dengan pesan jelas |
| Node tidak punya entri di `networkDeviceRelations` | Fallback ke `parentId` kolom (backward compatible) |

---

## Urutan Implementasi

1. **Migrasi DB** — buat `network_routes`, tambah `route_id` ke `network_infrastructure`
2. **`route.service.ts`** — `createRoute`, `listRoutes`, `getLastOdpInRoute`, `connectOdp`, cycle detection
3. **API routes** — `/api/map/routes` (CRUD + tail + connect)
4. **Perluas endpoint create infrastructure** — terima `routeId`, trigger auto-connect
5. **Refactor `cable-map.service.ts`** — baca `networkDeviceRelations` sebagai sumber topologi
6. **Frontend form ODP** — tambah field "Jalur", logic auto-fill "Koneksi ke"
