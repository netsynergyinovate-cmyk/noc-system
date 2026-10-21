import {
  doublePrecision,
  index,
  integer,
  pgTable,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { cableSegments } from "./cable-segments";

export const cableSegmentSamples = pgTable(
  "cable_segment_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    segmentId: uuid("segment_id")
      .notNull()
      .references(() => cableSegments.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    cumulativeM: doublePrecision("cumulative_m").notNull(),
  },
  (table) => [
    uniqueIndex("cable_samples_seg_seq_idx").on(
      table.segmentId,
      table.sequence,
    ),
    index("cable_samples_segment_idx").on(table.segmentId),
  ],
);
