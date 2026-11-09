import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type DrawingShapeType =
  "rectangle" | "circle" | "arrow" | "line" | "text" | "polygon";

export interface DrawingShape {
  id: string;
  type: DrawingShapeType;
  coordinates: [number, number] | [number, number][];
  properties: {
    width?: number;
    height?: number;
    radius?: number;
    color?: string;
    fillColor?: string;
    strokeWidth?: number;
    text?: string;
    fontSize?: number;
    rotation?: number;
    geoCoordinates?: [number, number] | [number, number][];
    geoRadius?: number;
  };
}

/**
 * Tabel Master Lapisan Gambar dan Anotasi Lapangan (Fase 5 - Lapisan Gambar LeaferJS)
 * Menyimpan gambar bentuk, panah, label catatan lapangan, urutan (z-index), dan transparansi.
 */
export const mapDrawingLayers = pgTable(
  "map_drawing_layers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    description: text("description"),
    opacity: numeric("opacity", { precision: 3, scale: 2, mode: "number" })
      .default(1.0)
      .notNull(),
    zIndex: integer("z_index").default(1).notNull(),
    isVisible: boolean("is_visible").default(true).notNull(),
    shapes: jsonb("shapes")
      .$type<DrawingShape[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("map_drawing_layers_visible_idx").on(table.isVisible),
    index("map_drawing_layers_z_index_idx").on(table.zIndex),
  ],
);

export type MapDrawingLayer = typeof mapDrawingLayers.$inferSelect;
export type NewMapDrawingLayer = typeof mapDrawingLayers.$inferInsert;
