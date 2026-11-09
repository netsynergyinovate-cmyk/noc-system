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

export async function createRoute(
  input: CreateRouteInput,
): Promise<NetworkRoute> {
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
