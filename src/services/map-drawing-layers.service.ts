import "server-only";
import { and, asc, desc, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import {
  mapDrawingLayers,
  type MapDrawingLayer,
  type DrawingShape,
} from "@/db/schema/map-drawing-layers";

export interface CreateDrawingLayerInput {
  name: string;
  description?: string;
  opacity?: number;
  zIndex?: number;
  isVisible?: boolean;
  shapes?: DrawingShape[];
  createdBy?: string;
}

export interface UpdateDrawingLayerInput {
  name?: string;
  description?: string;
  opacity?: number;
  zIndex?: number;
  isVisible?: boolean;
  shapes?: DrawingShape[];
}

export interface GetMapDrawingLayersOptions {
  visibleOnly?: boolean;
  search?: string;
}

export interface DrawingLayersResponse {
  layers: MapDrawingLayer[];
  summary: {
    totalLayers: number;
    visibleLayers: number;
    totalShapes: number;
  };
  dataSource: {
    provider: string;
    isRealData: boolean;
    lastSynchronizedAt: string;
  };
}

/**
 * Mengambil daftar seluruh lapisan gambar anotasi dari database PostgreSQL operasional.
 */
export async function getMapDrawingLayers(
  options?: GetMapDrawingLayersOptions,
): Promise<DrawingLayersResponse> {
  const conditions = [];
  if (options?.visibleOnly) {
    conditions.push(eq(mapDrawingLayers.isVisible, true));
  }
  if (options?.search) {
    conditions.push(ilike(mapDrawingLayers.name, `%${options.search}%`));
  }

  const query = db.select().from(mapDrawingLayers);

  const rows =
    conditions.length > 0
      ? await query
          .where(and(...conditions))
          .orderBy(
            asc(mapDrawingLayers.zIndex),
            desc(mapDrawingLayers.createdAt),
          )
      : await query.orderBy(
          asc(mapDrawingLayers.zIndex),
          desc(mapDrawingLayers.createdAt),
        );

  const totalLayers = rows.length;
  const visibleLayers = rows.filter((l) => l.isVisible).length;
  const totalShapes = rows.reduce((acc, curr) => {
    return acc + (Array.isArray(curr.shapes) ? curr.shapes.length : 0);
  }, 0);

  return {
    layers: rows,
    summary: {
      totalLayers,
      visibleLayers,
      totalShapes,
    },
    dataSource: {
      provider: "PostgreSQL Live",
      isRealData: true,
      lastSynchronizedAt: new Date().toISOString(),
    },
  };
}

/**
 * Mengambil satu lapisan gambar berdasarkan ID.
 */
export async function getMapDrawingLayerById(
  id: string,
): Promise<MapDrawingLayer | null> {
  const rows = await db
    .select()
    .from(mapDrawingLayers)
    .where(eq(mapDrawingLayers.id, id))
    .limit(1);

  return rows.length > 0 ? rows[0] : null;
}

/**
 * Membuat lapisan gambar baru dan menyimpannya ke database PostgreSQL nyata.
 */
export async function createMapDrawingLayer(
  input: CreateDrawingLayerInput,
): Promise<MapDrawingLayer> {
  const [created] = await db
    .insert(mapDrawingLayers)
    .values({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      opacity:
        input.opacity !== undefined
          ? Math.min(Math.max(input.opacity, 0), 1)
          : 1.0,
      zIndex: input.zIndex !== undefined ? input.zIndex : 1,
      isVisible: input.isVisible !== undefined ? input.isVisible : true,
      shapes: input.shapes || [],
      createdBy: input.createdBy || null,
      updatedAt: new Date(),
    })
    .returning();

  return created;
}

/**
 * Memperbarui lapisan gambar di database PostgreSQL nyata.
 */
export async function updateMapDrawingLayer(
  id: string,
  input: UpdateDrawingLayerInput,
): Promise<MapDrawingLayer | null> {
  const updateData: Partial<MapDrawingLayer> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) updateData.name = input.name.trim();
  if (input.description !== undefined)
    updateData.description = input.description.trim() || null;
  if (input.opacity !== undefined)
    updateData.opacity = Math.min(Math.max(input.opacity, 0), 1);
  if (input.zIndex !== undefined) updateData.zIndex = input.zIndex;
  if (input.isVisible !== undefined) updateData.isVisible = input.isVisible;
  if (input.shapes !== undefined) updateData.shapes = input.shapes;

  const [updated] = await db
    .update(mapDrawingLayers)
    .set(updateData)
    .where(eq(mapDrawingLayers.id, id))
    .returning();

  return updated || null;
}

/**
 * Menghapus lapisan gambar dari database PostgreSQL.
 */
export async function deleteMapDrawingLayer(id: string): Promise<boolean> {
  const deleted = await db
    .delete(mapDrawingLayers)
    .where(eq(mapDrawingLayers.id, id))
    .returning({ id: mapDrawingLayers.id });

  return deleted.length > 0;
}

/**
 * Menyimpan seluruh lapisan gambar sekaligus (batch update) dalam satu eksekusi.
 */
export async function batchSaveMapDrawingLayers(
  layers: Array<{
    id: string;
    name?: string;
    description?: string | null;
    opacity?: number;
    zIndex?: number;
    isVisible?: boolean;
    shapes?: DrawingShape[];
  }>,
): Promise<MapDrawingLayer[]> {
  const updatedLayers: MapDrawingLayer[] = [];

  for (const layer of layers) {
    const updateData: Partial<MapDrawingLayer> = {
      updatedAt: new Date(),
    };
    if (layer.name !== undefined) updateData.name = layer.name.trim();
    if (layer.description !== undefined) {
      updateData.description = layer.description?.trim() || null;
    }
    if (layer.opacity !== undefined) {
      updateData.opacity = Math.min(Math.max(layer.opacity, 0), 1);
    }
    if (layer.zIndex !== undefined) updateData.zIndex = layer.zIndex;
    if (layer.isVisible !== undefined) updateData.isVisible = layer.isVisible;
    if (layer.shapes !== undefined) updateData.shapes = layer.shapes;

    const [updated] = await db
      .update(mapDrawingLayers)
      .set(updateData)
      .where(eq(mapDrawingLayers.id, layer.id))
      .returning();

    if (updated) {
      updatedLayers.push(updated);
    }
  }

  return updatedLayers;
}

/**
 * Memperbarui urutan tumpukan (z-index) banyak lapisan sekaligus.
 */
export async function reorderMapDrawingLayers(
  layers: Array<{ id: string; zIndex: number }>,
): Promise<MapDrawingLayer[]> {
  const updatedLayers: MapDrawingLayer[] = [];

  for (const item of layers) {
    const [updated] = await db
      .update(mapDrawingLayers)
      .set({
        zIndex: item.zIndex,
        updatedAt: new Date(),
      })
      .where(eq(mapDrawingLayers.id, item.id))
      .returning();

    if (updated) {
      updatedLayers.push(updated);
    }
  }

  return updatedLayers;
}

/**
 * Memperbarui tingkat transparansi (opacity) satu lapisan gambar secara cepat.
 */
export async function updateMapDrawingLayerOpacity(
  id: string,
  opacity: number,
): Promise<MapDrawingLayer | null> {
  const sanitized = Math.min(Math.max(opacity, 0), 1);
  const [updated] = await db
    .update(mapDrawingLayers)
    .set({
      opacity: sanitized,
      updatedAt: new Date(),
    })
    .where(eq(mapDrawingLayers.id, id))
    .returning();

  return updated || null;
}
