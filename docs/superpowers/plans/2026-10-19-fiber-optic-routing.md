# Fiber Optic Route Mapping & Connection Logic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah entitas `network_routes`, ODP chain auto-connect via `networkDeviceRelations`, form manual koneksi, dan refactor topologi kabel dari `networkDeviceRelations`.

**Architecture:** Tabel `network_routes` sebagai entitas jalur (OLT + ODC + PON port). `networkInfrastructure.routeId` FK ke route. `networkDeviceRelations` menjadi satu-satunya sumber kebenaran topologi — `cable-map.service.ts` JOIN ke tabel ini, bukan baca `parentId` kolom. Frontend tetap terima `CableRouteSegment[]` siap render.

**Tech Stack:** Next.js App Router, Drizzle ORM + PostgreSQL, Zod, Leaflet, React

## Global Constraints

- Semua Drizzle schema di `src/db/schema/<table>.ts`, export via `src/db/schema/index.ts`
- API routes pakai `withApiSession` dari `@/lib/api` — return JSON 401 bukan redirect
- Validators Zod di `src/validators/` — import type dari sana, bukan dari service
- Service files WAJIB `import "server-only"` di baris pertama
- Setelah schema change: `npm run db:generate` → inspect SQL → `npm run db:migrate`
- Verifikasi setiap task: `npm run typecheck` (0 error) + `npm run build`
- Semua pesan error dalam Bahasa Indonesia

---

## File Map

| File | Status | Tanggung Jawab |
|---|---|---|
| `src/db/schema/network-routes.ts` | **CREATE** | Drizzle schema tabel `network_routes` |
| `src/db/schema/network-infrastructure.ts` | **MODIFY** | Tambah kolom `route_id` |
| `src/db/schema/index.ts` | **MODIFY** | Export `network-routes` |
| `src/validators/route.ts` | **CREATE** | Zod: createRouteSchema, connectOdpSchema |
| `src/validators/infrastructure-placement.ts` | **MODIFY** | Tambah `routeId` opsional ke createSchema |
| `src/services/route.service.ts` | **CREATE** | createRoute, getRoute, listRoutes, getLastOdpInRoute, checkNoCycle, connectOdp |
| `src/app/api/map/routes/route.ts` | **CREATE** | GET list + POST create route |
| `src/app/api/map/routes/[id]/tail/route.ts` | **CREATE** | GET tail ODP |
| `src/app/api/map/routes/connect/route.ts` | **CREATE** | POST connect ODP manual |
| `src/services/map-infrastructure.service.ts` | **MODIFY** | Auto-connect saat createInfrastructurePoint dengan routeId |
| `src/services/cable-map.service.ts` | **MODIFY** | Topologi dari networkDeviceRelations, bukan parentId |
| `src/components/map/device-type-picker.tsx` | **MODIFY** | Tambah field "Jalur" + routeId ke form |
| `src/components/map/network-map.tsx` | **MODIFY** | Fetch routes, activeRouteId state, pass ke DeviceTypePicker |

---

### Task 1: DB Schema — `network_routes` tabel + `route_id` kolom

**Files:**
- Create: `src/db/schema/network-routes.ts`
- Modify: `src/db/schema/network-infrastructure.ts`
- Modify: `src/db/schema/index.ts`
- Generated: `drizzle/<timestamp>_*.sql`

**Interfaces:**
- Produces: `NetworkRoute`, `NewNetworkRoute` types — dipakai Task 3
- Produces: `networkRoutes` table — dipakai Task 3, 4
- Produces: `networkInfrastructure.routeId` kolom — dipakai Task 3, 5, 6

- [ ] **Step 1: Buat `src/db/schema/network-routes.ts`**

```ts
import {
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const networkRouteStatuses = ["active", "inactive"] as const;
export type NetworkRouteStatus = (typeof networkRouteStatuses)[number];

export const networkRoutes = pgTable(
  "network_routes",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    oltId: text("olt_id"),
    odcId: text("odc_id"),
    ponPort: text("pon_port"),
    status: text("status").$type<NetworkRouteStatus>().default("active").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("network_routes_olt_idx").on(table.oltId),
    index("network_routes_odc_idx").on(table.odcId),
  ],
);

export type NetworkRoute = typeof networkRoutes.$inferSelect;
export type NewNetworkRoute = typeof networkRoutes.$inferInsert;
```

> Tidak ada FK `references()` ke `network-infrastructure` — menghindari circular import. FK constraint ditambah via SQL migration.

- [ ] **Step 2: Tambah `routeId` kolom di `src/db/schema/network-infrastructure.ts`**

Tambahkan di dalam object kolom `networkInfrastructure`, setelah kolom `parentId` (baris ~41):

```ts
routeId: text("route_id"),
```

Tambahkan index baru di array constraints (baris ~57, setelah `index("network_infra_parent_idx")`):

```ts
index("network_infra_route_idx").on(table.routeId),
```

- [ ] **Step 3: Export di `src/db/schema/index.ts`**

Tambahkan baris baru di akhir file:

```ts
export * from "./network-routes";
```

- [ ] **Step 4: Generate migrasi**

```bash
npm run db:generate
```

- [ ] **Step 5: Inspect SQL yang di-generate**

Buka file `drizzle/<timestamp>_*.sql` terbaru. Pastikan berisi:
- `CREATE TABLE network_routes (...)`
- `ALTER TABLE network_infrastructure ADD COLUMN route_id text`
- Index-index yang sesuai

Tambahkan FK constraint ini secara MANUAL di akhir file SQL (sebelum closing statement jika ada):

```sql
ALTER TABLE network_infrastructure
  ADD CONSTRAINT network_infra_route_id_fk
  FOREIGN KEY (route_id) REFERENCES network_routes(id) ON DELETE SET NULL;
```

- [ ] **Step 6: Jalankan migrasi**

```bash
npm run db:migrate
```

Expected: migrasi berjalan tanpa error.

- [ ] **Step 7: Verifikasi typecheck**

```bash
npm run typecheck
```

Expected: 0 error.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/network-routes.ts src/db/schema/network-infrastructure.ts src/db/schema/index.ts drizzle/
git commit -m "feat(db): tambah tabel network_routes dan kolom route_id"
```

---

### Task 2: Validators

**Files:**
- Create: `src/validators/route.ts`
- Modify: `src/validators/infrastructure-placement.ts`

**Interfaces:**
- Produces: `CreateRouteInput`, `ConnectOdpInput` — dipakai Task 3, 4
- Modifies: `CreateInfrastructurePointInput` — tambah `routeId?`

- [ ] **Step 1: Buat `src/validators/route.ts`**

```ts
import { z } from "zod";

export const createRouteSchema = z.object({
  name: z.string().trim().min(1, "Nama jalur wajib diisi.").max(100, "Nama jalur maksimal 100 karakter."),
  oltId: z.string().trim().min(1).optional(),
  odcId: z.string().trim().min(1).optional(),
  ponPort: z.string().trim().optional(),
  description: z.string().trim().optional(),
});

export type CreateRouteInput = z.infer<typeof createRouteSchema>;

export const connectOdpSchema = z.object({
  childId: z.string().trim().min(1, "childId wajib diisi."),
  parentId: z.string().trim().min(1, "parentId wajib diisi."),
  routeId: z.string().trim().min(1, "routeId wajib diisi."),
});

export type ConnectOdpInput = z.infer<typeof connectOdpSchema>;
```

- [ ] **Step 2: Tambah `routeId` di `src/validators/infrastructure-placement.ts`**

Di dalam `createInfrastructurePointSchema` (baris ~13), tambahkan field setelah `host`:

```ts
routeId: z.string().trim().min(1).optional(),
```

- [ ] **Step 3: Verifikasi typecheck**

```bash
npm run typecheck
```

Expected: 0 error.

- [ ] **Step 4: Commit**

```bash
git add src/validators/route.ts src/validators/infrastructure-placement.ts
git commit -m "feat(validators): tambah schema route dan routeId di infra placement"
```

---

### Task 3: `route.service.ts`

**Files:**
- Create: `src/services/route.service.ts`

**Interfaces:**
- Consumes: `networkRoutes`, `networkInfrastructure`, `networkDeviceRelations` dari `@/db/schema`
- Consumes: `CreateRouteInput`, `ConnectOdpInput` dari `@/validators/route`
- Produces:
  - `createRoute(input: CreateRouteInput): Promise<NetworkRoute>`
  - `getRoute(routeId: string): Promise<NetworkRoute | null>`
  - `listRoutes(): Promise<RouteWithNames[]>`
  - `getLastOdpInRoute(routeId: string): Promise<NetworkInfrastructure | null>`
  - `checkNoCycle(childId: string, parentId: string): Promise<boolean>`
  - `connectOdp(childId: string, parentId: string, routeId: string): Promise<void>`
  - `RouteWithNames` type (export)

- [ ] **Step 1: Buat `src/services/route.service.ts`**

```ts
import "server-only";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  networkRoutes,
  networkInfrastructure,
  networkDeviceRelations,
} from "@/db/schema";
import type { NetworkRoute, NetworkInfrastructure } from "@/db/schema";
import type { CreateRouteInput } from "@/validators/route";

export type RouteWithNames = NetworkRoute & {
  oltName: string | null;
  odcName: string | null;
};

export async function createRoute(input: CreateRouteInput): Promise<NetworkRoute> {
  const [route] = await db
    .insert(networkRoutes)
    .values({
      name: input.name,
      oltId: input.oltId ?? null,
      odcId: input.odcId ?? null,
      ponPort: input.ponPort ?? null,
      description: input.description ?? null,
    })
    .returning();
  return route;
}

export async function getRoute(routeId: string): Promise<NetworkRoute | null> {
  const rows = await db
    .select()
    .from(networkRoutes)
    .where(eq(networkRoutes.id, routeId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listRoutes(): Promise<RouteWithNames[]> {
  const routes = await db.select().from(networkRoutes);

  const infraIds = [
    ...new Set(
      routes
        .flatMap((r) => [r.oltId, r.odcId])
        .filter((id): id is string => id !== null),
    ),
  ];

  if (infraIds.length === 0) {
    return routes.map((r) => ({ ...r, oltName: null, odcName: null }));
  }

  const infraList = await db
    .select({ id: networkInfrastructure.id, name: networkInfrastructure.name })
    .from(networkInfrastructure)
    .where(inArray(networkInfrastructure.id, infraIds));

  const infraMap = new Map(infraList.map((i) => [i.id, i.name]));

  return routes.map((r) => ({
    ...r,
    oltName: r.oltId ? (infraMap.get(r.oltId) ?? null) : null,
    odcName: r.odcId ? (infraMap.get(r.odcId) ?? null) : null,
  }));
}

export async function getLastOdpInRoute(
  routeId: string,
): Promise<NetworkInfrastructure | null> {
  const odps = await db
    .select()
    .from(networkInfrastructure)
    .where(
      and(
        eq(networkInfrastructure.routeId, routeId),
        eq(networkInfrastructure.type, "odp"),
      ),
    );

  if (odps.length === 0) return null;
  if (odps.length === 1) return odps[0];

  const odpIds = odps.map((o) => o.id);

  // Cari ODP yang menjadi parent dari ODP lain dalam route yang sama
  const parentRelations = await db
    .select({ parentId: networkDeviceRelations.parentId })
    .from(networkDeviceRelations)
    .where(
      and(
        inArray(networkDeviceRelations.parentId, odpIds),
        inArray(networkDeviceRelations.childId, odpIds),
      ),
    );

  const hasChildrenSet = new Set(parentRelations.map((r) => r.parentId));

  // Tail node = ODP yang tidak menjadi parent ODP lain
  return odps.find((o) => !hasChildrenSet.has(o.id)) ?? odps[0];
}

export async function checkNoCycle(
  childId: string,
  parentId: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    WITH RECURSIVE ancestors(node_id) AS (
      SELECT parent_id
      FROM network_device_relations
      WHERE child_id = ${parentId} AND parent_id IS NOT NULL
      UNION ALL
      SELECT ndr.parent_id
      FROM network_device_relations ndr
      INNER JOIN ancestors a ON ndr.child_id = a.node_id
      WHERE ndr.parent_id IS NOT NULL
    )
    SELECT 1 AS found FROM ancestors WHERE node_id = ${childId} LIMIT 1
  `);
  return result.rows.length > 0;
}

export async function connectOdp(
  childId: string,
  parentId: string,
  routeId: string,
): Promise<void> {
  if (childId === parentId) {
    throw new Error("Perangkat tidak dapat terhubung ke dirinya sendiri.");
  }

  const hasCycle = await checkNoCycle(childId, parentId);
  if (hasCycle) {
    throw new Error("Koneksi membentuk loop — tidak diizinkan.");
  }

  await db.insert(networkDeviceRelations).values({
    parentId,
    childId,
    relationType: "hierarchy",
    status: "active",
  });

  await db
    .update(networkInfrastructure)
    .set({ routeId, updatedAt: new Date() })
    .where(eq(networkInfrastructure.id, childId));
}
```

- [ ] **Step 2: Verifikasi typecheck**

```bash
npm run typecheck
```

Expected: 0 error. Jika ada error pada `networkInfrastructure.routeId` pastikan Task 1 sudah selesai.

- [ ] **Step 3: Lint**

```bash
npx eslint src/services/route.service.ts
```

Expected: 0 error baru.

- [ ] **Step 4: Commit**

```bash
git add src/services/route.service.ts
git commit -m "feat(service): route.service — CRUD jalur, getLastOdpInRoute, connectOdp"
```

---

### Task 4: API Endpoints

**Files:**
- Create: `src/app/api/map/routes/route.ts`
- Create: `src/app/api/map/routes/[id]/tail/route.ts`
- Create: `src/app/api/map/routes/connect/route.ts`

**Interfaces:**
- Consumes: `createRoute`, `listRoutes`, `getLastOdpInRoute`, `connectOdp` dari `route.service`
- Consumes: `createRouteSchema`, `connectOdpSchema` dari `@/validators/route`
- Produces:
  - `GET /api/map/routes` → `{ ok: true, data: RouteWithNames[] }`
  - `POST /api/map/routes` → `{ ok: true, data: NetworkRoute }`
  - `GET /api/map/routes/[id]/tail` → `{ ok: true, data: NetworkInfrastructure | null }`
  - `POST /api/map/routes/connect` → `{ ok: true }` atau 422 jika cycle

- [ ] **Step 1: Buat `src/app/api/map/routes/route.ts`**

```ts
import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { createRouteSchema } from "@/validators/route";
import { createRoute, listRoutes } from "@/services/route.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const routes = await listRoutes();
      return NextResponse.json({ ok: true, data: routes });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withApiSession(request, async () => {
    try {
      const body = await request.json().catch(() => null);
      const parsed = createRouteSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { ok: false, error: "Data jalur tidak valid.", details: parsed.error.format() },
          { status: 400 },
        );
      }
      const route = await createRoute(parsed.data);
      return NextResponse.json({ ok: true, data: route });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
```

- [ ] **Step 2: Buat direktori dan file `src/app/api/map/routes/[id]/tail/route.ts`**

```ts
import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { getLastOdpInRoute } from "@/services/route.service";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    try {
      const { id } = await params;
      if (!id) {
        return NextResponse.json(
          { ok: false, error: "Route ID wajib ditentukan." },
          { status: 400 },
        );
      }
      const tail = await getLastOdpInRoute(id);
      return NextResponse.json({ ok: true, data: tail });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
```

- [ ] **Step 3: Buat `src/app/api/map/routes/connect/route.ts`**

```ts
import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { connectOdpSchema } from "@/validators/route";
import { connectOdp } from "@/services/route.service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withApiSession(request, async () => {
    try {
      const body = await request.json().catch(() => null);
      const parsed = connectOdpSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { ok: false, error: "Data koneksi tidak valid.", details: parsed.error.format() },
          { status: 400 },
        );
      }
      await connectOdp(parsed.data.childId, parsed.data.parentId, parsed.data.routeId);
      return NextResponse.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isLoop = msg.includes("loop");
      return NextResponse.json({ ok: false, error: msg }, { status: isLoop ? 422 : 500 });
    }
  });
}
```

- [ ] **Step 4: Verifikasi typecheck + build**

```bash
npm run typecheck && npm run build
```

Expected: 0 error TypeScript, build berhasil.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/map/routes/
git commit -m "feat(api): endpoint GET/POST routes, GET tail, POST connect"
```

---

### Task 5: Auto-Connect di `createInfrastructurePoint`

**Files:**
- Modify: `src/services/map-infrastructure.service.ts`

**Interfaces:**
- Consumes: `getRoute`, `getLastOdpInRoute`, `connectOdp` dari `./route.service`
- Modifies: `createInfrastructurePoint(input, actorUserId?)` — terima `routeId` via `input.routeId`

- [ ] **Step 1: Tambah import di `src/services/map-infrastructure.service.ts`**

Di baris import yang ada (setelah baris import terakhir yang ada), tambahkan:

```ts
import { getRoute, getLastOdpInRoute, connectOdp } from "./route.service";
```

- [ ] **Step 2: Tambah `routeId` ke db.insert di `createInfrastructurePoint`**

Di dalam `db.insert(networkInfrastructure).values({...})` (sekitar baris 42–54), tambahkan field:

```ts
routeId: input.routeId ?? null,
```

- [ ] **Step 3: Tambah logika auto-connect setelah db.insert berhasil**

Setelah blok `} catch (err) { console.error("[INSERT INFRASTRUCTURE DB ERROR]", err); }` (setelah baris ~58), tambahkan:

```ts
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
```

- [ ] **Step 4: Verifikasi typecheck**

```bash
npm run typecheck
```

Expected: 0 error.

- [ ] **Step 5: Commit**

```bash
git add src/services/map-infrastructure.service.ts
git commit -m "feat(service): auto-connect ODP ke tail node saat routeId diberikan"
```

---

### Task 6: Refactor `cable-map.service.ts` — Topologi dari `networkDeviceRelations`

**Files:**
- Modify: `src/services/cable-map.service.ts`

**Interfaces:**
- Modifies: `getCableMapData()` — JOIN `networkDeviceRelations` untuk build `childToParentMap`
- Fallback: jika node tidak punya entri di `networkDeviceRelations`, pakai `infra.parentId`

- [ ] **Step 1: Tambah `networkDeviceRelations` ke import di `cable-map.service.ts`**

Baris 4 saat ini:
```ts
import { networkInfrastructure, networkCables } from "@/db/schema";
```

Ubah menjadi:
```ts
import { networkInfrastructure, networkCables, networkDeviceRelations } from "@/db/schema";
```

Tambahkan juga `eq` ke import dari drizzle-orm (sudah ada `eq` di baris 2):
```ts
import { eq } from "drizzle-orm";
```
(sudah ada — tidak perlu diubah)

- [ ] **Step 2: Fetch hierarchy relations di awal `getCableMapData`**

Di dalam `getCableMapData` (baris ~86), setelah baris:
```ts
const custList = baseMapData.customers;
```

Tambahkan:
```ts
// Ambil semua relasi hierarki dari DB sebagai sumber topologi utama
const hierarchyRelations = await db
  .select({
    parentId: networkDeviceRelations.parentId,
    childId: networkDeviceRelations.childId,
  })
  .from(networkDeviceRelations)
  .where(eq(networkDeviceRelations.relationType, "hierarchy"));

const childToParentMap = new Map(
  hierarchyRelations.map((r) => [r.childId, r.parentId]),
);
```

- [ ] **Step 3: Gunakan `childToParentMap` di bagian "Ekstrak jalur kabel"**

Di dalam loop `for (const infra of infraList)` (sekitar baris 97–103), ubah resolusi `parentId`:

```ts
// SEBELUM:
const parentId =
  infra.parentId ||
  (infra.details?.parentId as string | undefined) ||
  (infra.details?.parentOdc as string | undefined) ||
  (infra.details?.parentRoot as string | undefined);

// SETELAH:
const parentId =
  childToParentMap.get(infra.id) ||       // networkDeviceRelations (sumber utama)
  infra.parentId ||                         // kolom parentId lama (fallback)
  (infra.details?.parentId as string | undefined) ||
  (infra.details?.parentOdc as string | undefined) ||
  (infra.details?.parentRoot as string | undefined);
```

- [ ] **Step 4: Verifikasi typecheck + build**

```bash
npm run typecheck && npm run build
```

Expected: 0 error, build berhasil.

- [ ] **Step 5: Commit**

```bash
git add src/services/cable-map.service.ts
git commit -m "refactor(service): topologi kabel dari networkDeviceRelations, parentId sebagai fallback"
```

---

### Task 7: Frontend Form ODP — Field "Jalur" + Auto-Fill Koneksi

**Files:**
- Modify: `src/components/map/device-type-picker.tsx`
- Modify: `src/components/map/network-map.tsx`

**Interfaces:**
- Modifies: `DeviceTypePickerProps.onConfirmPlacement` — tambah `routeId?: string`
- Modifies: `DeviceTypePickerProps` — tambah `routes` dan `activeRouteId`
- Modifies: `handleConfirmDevicePlacement` di `network-map.tsx` — kirim `routeId`

- [ ] **Step 1: Update `DeviceTypePickerProps` di `device-type-picker.tsx`**

Tambah field ke interface `DeviceTypePickerProps` (baris 75):

```ts
export interface RouteOption {
  id: string;
  name: string;
  oltName: string | null;
  odcName: string | null;
}

export interface DeviceTypePickerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedType: InfrastructureDeviceType | null;
  onSelectType: (type: InfrastructureDeviceType) => void;
  draftCoordinates: { lat: number; lng: number } | null;
  onConfirmPlacement: (point: {
    name: string;
    type: InfrastructureDeviceType;
    latitude: number;
    longitude: number;
    host?: string;
    routeId?: string;    // ← baru
  }) => Promise<void> | void;
  onCancelPlacement: () => void;
  isSaving?: boolean;
  successMessage?: string | null;
  errorMessage?: string | null;
  suggestedName?: string;
  routes?: RouteOption[];           // ← baru
  activeRouteId?: string | null;    // ← baru
}
```

- [ ] **Step 2: Tambah state `selectedRouteId` dan field "Jalur" ke form di `DeviceTypePicker`**

Di `export function DeviceTypePicker({...})` (baris 95), tambah destructuring:

```ts
routes = [],
activeRouteId = null,
```

Di dalam fungsi, setelah `const [formError, setFormError] = useState<string | null>(null);` (baris 111):

```ts
const [selectedRouteId, setSelectedRouteId] = useState<string>(activeRouteId ?? "");
useEffect(() => { setSelectedRouteId(activeRouteId ?? ""); }, [activeRouteId]);
```

Di `handleSubmit`, ubah call ke `onConfirmPlacement`:

```ts
await onConfirmPlacement({
  name: deviceName.trim(),
  type: selectedType ?? "odp",
  latitude: draftCoordinates.lat,
  longitude: draftCoordinates.lng,
  host: deviceHost.trim() || undefined,
  routeId: selectedRouteId || undefined,   // ← baru
});
```

Di dalam form JSX, tambahkan field "Jalur" untuk tipe ODP — letakkan setelah field "Nama" dan sebelum field "Host". Cari bagian form konfirmasi penempatan (ada blok `draftCoordinates &&` di JSX), tambahkan:

```tsx
{/* Field Jalur — hanya untuk ODP */}
{(selectedType === "odp" || selectedType === null) && routes.length > 0 && (
  <div className="space-y-1">
    <label className="text-xs font-medium text-foreground">
      Jalur <span className="text-muted-foreground">(opsional)</span>
    </label>
    <select
      value={selectedRouteId}
      onChange={(e) => setSelectedRouteId(e.target.value)}
      disabled={!!activeRouteId}
      className="w-full text-xs rounded-md border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
    >
      <option value="">— Tanpa jalur —</option>
      {routes.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}{r.odcName ? ` (${r.odcName})` : ""}
        </option>
      ))}
    </select>
    {activeRouteId && (
      <p className="text-[10px] text-muted-foreground">Jalur terkunci ke mode aktif.</p>
    )}
  </div>
)}
```

- [ ] **Step 3: Tambah state dan fetch routes di `network-map.tsx`**

Di bagian state declarations (sekitar baris 286, area `useState`), tambahkan:

```ts
const [availableRoutes, setAvailableRoutes] = useState<Array<{
  id: string;
  name: string;
  oltName: string | null;
  odcName: string | null;
}>>([]);
const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
```

Tambahkan `useEffect` untuk fetch routes (letakkan setelah useEffect yang sudah ada):

```ts
useEffect(() => {
  fetch("/api/map/routes")
    .then((r) => r.json())
    .then((json) => {
      if (json.ok && Array.isArray(json.data)) {
        setAvailableRoutes(json.data);
      }
    })
    .catch(() => {});
}, []);
```

- [ ] **Step 4: Update `handleConfirmDevicePlacement` di `network-map.tsx`**

Temukan `handleConfirmDevicePlacement` (baris ~1092). Ubah tipe parameter `point`:

```ts
const handleConfirmDevicePlacement = useCallback(
  async (point: {
    name: string;
    type: InfrastructureDeviceType;
    latitude: number;
    longitude: number;
    host?: string;
    routeId?: string;    // ← baru
  }) => {
```

Di dalam `JSON.stringify(point)` (baris ~1110) — sudah otomatis include `routeId` karena spread dari `point`.

Setelah placement berhasil (setelah `setSelectedInfra(newPoint)`, baris ~1136), tambahkan refresh routes jika ODP baru memiliki routeId:

```ts
if (point.routeId && newPoint.type === "odp") {
  fetch("/api/map/routes")
    .then((r) => r.json())
    .then((json) => {
      if (json.ok && Array.isArray(json.data)) setAvailableRoutes(json.data);
    })
    .catch(() => {});
}
```

- [ ] **Step 5: Pass `routes` dan `activeRouteId` ke `DeviceTypePicker` di JSX**

Temukan `<DeviceTypePicker` (baris ~4014). Tambahkan props:

```tsx
<DeviceTypePicker
  isOpen={isPlacementPickerOpen}
  suggestedName={...}          // sudah ada
  onClose={...}                // sudah ada
  selectedType={placementType} // sudah ada
  onSelectType={...}           // sudah ada
  draftCoordinates={placementDraftCoords}  // sudah ada
  onConfirmPlacement={handleConfirmDevicePlacement}  // sudah ada
  onCancelPlacement={...}      // sudah ada
  isSaving={isSavingPlacement} // sudah ada
  successMessage={placementSuccessMessage}  // sudah ada
  errorMessage={placementErrorMessage}      // sudah ada
  routes={availableRoutes}     // ← baru
  activeRouteId={activeRouteId}  // ← baru
/>
```

- [ ] **Step 6: Verifikasi typecheck + build**

```bash
npm run typecheck && npm run build
```

Expected: 0 TypeScript error, build berhasil.

- [ ] **Step 7: Commit**

```bash
git add src/components/map/device-type-picker.tsx src/components/map/network-map.tsx
git commit -m "feat(map): form ODP tambah field Jalur + auto-connect via activeRouteId"
```
