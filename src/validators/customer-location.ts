import { z } from "zod";

export const updateCustomerLocationSchema = z.preprocess(
  (val: unknown) => {
    if (typeof val === "object" && val !== null) {
      const v = val as Record<string, unknown>;
      const rawLat = v.latitude !== undefined ? v.latitude : v.lat;
      const rawLng = v.longitude !== undefined ? v.longitude : v.lng;
      return {
        ...v,
        latitude:
          typeof rawLat === "string" && rawLat.trim() !== ""
            ? Number(rawLat)
            : rawLat,
        longitude:
          typeof rawLng === "string" && rawLng.trim() !== ""
            ? Number(rawLng)
            : rawLng,
      };
    }
    return val;
  },
  z.object({
    latitude: z
      .number({
        error: "Latitude harus berupa angka numerik valid.",
      })
      .min(-90, "Latitude tidak boleh kurang dari -90 derajat.")
      .max(90, "Latitude tidak boleh lebih dari 90 derajat."),
    longitude: z
      .number({
        error: "Longitude harus berupa angka numerik valid.",
      })
      .min(-180, "Longitude tidak boleh kurang dari -180 derajat.")
      .max(180, "Longitude tidak boleh lebih dari 180 derajat."),
  }),
);

export type UpdateCustomerLocationInput = z.infer<
  typeof updateCustomerLocationSchema
>;

export const geocodedCustomersQuerySchema = z.object({
  status: z
    .enum([
      "all",
      "online",
      "offline",
      "weak",
      "isolir",
      "geocoded",
      "warning",
      "normal",
    ])
    .optional()
    .default("all"),
  odp: z.string().trim().optional(),
  region: z.string().trim().optional(),
  search: z.string().trim().optional(),
  q: z.string().trim().optional(),
  routerId: z.string().trim().optional(),
  billingStatus: z.enum(["all", "lunas", "isolir"]).optional().default("all"),
  opticalStatus: z
    .enum(["all", "normal", "warning", "critical"])
    .optional()
    .default("all"),
  minLat: z.coerce.number().min(-90).max(90).optional(),
  maxLat: z.coerce.number().min(-90).max(90).optional(),
  minLng: z.coerce.number().min(-180).max(180).optional(),
  maxLng: z.coerce.number().min(-180).max(180).optional(),
  south: z.coerce.number().min(-90).max(90).optional(),
  north: z.coerce.number().min(-90).max(90).optional(),
  west: z.coerce.number().min(-180).max(180).optional(),
  east: z.coerce.number().min(-180).max(180).optional(),
  bbox: z.string().optional(),
  buffer: z.coerce.number().min(0).max(1).optional().default(0.15),
  zoom: z.coerce.number().int().min(1).max(22).optional(),
  limit: z.coerce.number().int().positive().max(2000).optional().default(500),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
  forceMock: z.coerce.boolean().optional().default(false),
});

export type GeocodedCustomersQueryInput = z.infer<
  typeof geocodedCustomersQuerySchema
>;

export const viewportCustomersQuerySchema = z.object({
  minLat: z.coerce.number().min(-90).max(90).optional(),
  maxLat: z.coerce.number().min(-90).max(90).optional(),
  minLng: z.coerce.number().min(-180).max(180).optional(),
  maxLng: z.coerce.number().min(-180).max(180).optional(),
  south: z.coerce.number().min(-90).max(90).optional(),
  north: z.coerce.number().min(-90).max(90).optional(),
  west: z.coerce.number().min(-180).max(180).optional(),
  east: z.coerce.number().min(-180).max(180).optional(),
  bbox: z.string().optional(),
  buffer: z.coerce.number().min(0).max(1).optional().default(0.15),
  zoom: z.coerce.number().int().min(1).max(22).optional(),
  status: z
    .enum([
      "all",
      "online",
      "offline",
      "weak",
      "isolir",
      "geocoded",
      "warning",
      "normal",
    ])
    .optional()
    .default("all"),
  odp: z.string().trim().optional(),
  region: z.string().trim().optional(),
  search: z.string().trim().optional(),
  q: z.string().trim().optional(),
  routerId: z.string().trim().optional(),
  billingStatus: z.enum(["all", "lunas", "isolir"]).optional().default("all"),
  opticalStatus: z
    .enum(["all", "normal", "warning", "critical"])
    .optional()
    .default("all"),
  limit: z.coerce.number().int().positive().max(2000).optional().default(1000),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
  forceMock: z.coerce.boolean().optional().default(false),
});

export type ViewportCustomersQueryInput = z.infer<
  typeof viewportCustomersQuerySchema
>;

export const customerDetailQuerySchema = z.object({
  forceMock: z.coerce.boolean().optional().default(false),
});

export type CustomerDetailQueryInput = z.infer<
  typeof customerDetailQuerySchema
>;
