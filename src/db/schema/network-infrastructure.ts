import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";

export const infrastructureTypes = [
  "router",
  "olt",
  "odp",
  "odc",
  "pole",
  "server",
] as const;
export type InfrastructureDeviceType = (typeof infrastructureTypes)[number];

export const infrastructureStatuses = [
  "active",
  "inactive",
  "maintenance",
] as const;
export type InfrastructureStatus = (typeof infrastructureStatuses)[number];

// Tabel master perangkat infrastruktur fisik jaringan peta
export const networkInfrastructure = pgTable(
  "network_infrastructure",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    type: text("type").$type<InfrastructureDeviceType>().notNull(),
    host: text("host"),
    status: text("status")
      .$type<InfrastructureStatus>()
      .default("active")
      .notNull(),
    latitude: numeric("latitude", {
      precision: 9,
      scale: 6,
      mode: "number",
    }).notNull(),
    longitude: numeric("longitude", {
      precision: 9,
      scale: 6,
      mode: "number",
    }).notNull(),
    parentId: text("parent_id"),
    routeId: text("route_id"),
    capacity: integer("capacity"),
    usedCapacity: integer("used_capacity").default(0),
    description: text("description"),
    address: text("address"),
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("network_infra_type_idx").on(table.type),
    index("network_infra_status_idx").on(table.status),
    index("network_infra_parent_idx").on(table.parentId),
    index("network_infra_route_idx").on(table.routeId),
    check(
      "network_infra_type_check",
      sql`${table.type} in ('router', 'olt', 'odp', 'odc', 'pole', 'server')`,
    ),
    check(
      "network_infra_status_check",
      sql`${table.status} in ('active', 'inactive', 'maintenance')`,
    ),
    check(
      "network_infra_latitude_check",
      sql`${table.latitude} between -90 and 90`,
    ),
    check(
      "network_infra_longitude_check",
      sql`${table.longitude} between -180 and 180`,
    ),
  ],
);

// Tabel jalur kabel fisik antar perangkat & pelanggan (Fase 2-3)
export const networkCables = pgTable(
  "network_cables",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    sourceId: text("source_id").notNull(),
    targetId: text("target_id"),
    targetType: text("target_type").default("infrastructure").notNull(),
    cableType: text("cable_type").default("distribution").notNull(),
    coreCapacity: integer("core_capacity").default(12).notNull(),
    color: text("color").default("#3b82f6").notNull(),
    lengthMeters: numeric("length_meters", {
      precision: 8,
      scale: 2,
      mode: "number",
    }),
    polyline: jsonb("polyline").$type<Array<[number, number]>>().notNull(),
    status: text("status").default("active").notNull(),
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("network_cables_source_idx").on(table.sourceId),
    index("network_cables_target_idx").on(table.targetId),
    index("network_cables_type_idx").on(table.cableType),
  ],
);

export const deviceRelationTypes = [
  "hierarchy",
  "feeder",
  "backup",
  "distribution",
] as const;
export type DeviceRelationType = (typeof deviceRelationTypes)[number];

// Tabel relasi induk-anak dan interkoneksi perangkat fisik jaringan
export const networkDeviceRelations = pgTable(
  "network_device_relations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    parentId: text("parent_id")
      .notNull()
      .references(() => networkInfrastructure.id, { onDelete: "cascade" }),
    childId: text("child_id")
      .notNull()
      .references(() => networkInfrastructure.id, { onDelete: "cascade" }),
    relationType: text("relation_type")
      .$type<DeviceRelationType>()
      .default("hierarchy")
      .notNull(),
    parentPort: text("parent_port"),
    childPort: text("child_port"),
    status: text("status").default("active").notNull(),
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("network_device_rel_parent_idx").on(table.parentId),
    index("network_device_rel_child_idx").on(table.childId),
    index("network_device_rel_type_idx").on(table.relationType),
    check(
      "network_device_rel_not_self",
      sql`${table.parentId} != ${table.childId}`,
    ),
    check(
      "network_device_rel_type_check",
      sql`${table.relationType} in ('hierarchy', 'feeder', 'backup', 'distribution')`,
    ),
  ],
);

// Relasi ORM Drizzle untuk navigasi hierarki induk-anak perangkat
export const networkInfrastructureRelations = relations(
  networkInfrastructure,
  ({ one, many }) => ({
    parent: one(networkInfrastructure, {
      fields: [networkInfrastructure.parentId],
      references: [networkInfrastructure.id],
      relationName: "infrastructure_parent_child",
    }),
    children: many(networkInfrastructure, {
      relationName: "infrastructure_parent_child",
    }),
    parentRelations: many(networkDeviceRelations, {
      relationName: "device_parent_relations",
    }),
    childRelations: many(networkDeviceRelations, {
      relationName: "device_child_relations",
    }),
  }),
);

export const networkDeviceRelationsRelations = relations(
  networkDeviceRelations,
  ({ one }) => ({
    parent: one(networkInfrastructure, {
      fields: [networkDeviceRelations.parentId],
      references: [networkInfrastructure.id],
      relationName: "device_parent_relations",
    }),
    child: one(networkInfrastructure, {
      fields: [networkDeviceRelations.childId],
      references: [networkInfrastructure.id],
      relationName: "device_child_relations",
    }),
  }),
);

export type NetworkInfrastructure = typeof networkInfrastructure.$inferSelect;
export type NewNetworkInfrastructure =
  typeof networkInfrastructure.$inferInsert;
export type NetworkDeviceRelation = typeof networkDeviceRelations.$inferSelect;
export type NewNetworkDeviceRelation =
  typeof networkDeviceRelations.$inferInsert;
export type NetworkCable = typeof networkCables.$inferSelect;
export type NewNetworkCable = typeof networkCables.$inferInsert;
