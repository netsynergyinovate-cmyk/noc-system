import { z } from "zod";

export const infrastructureDeviceTypes = [
  "router",
  "olt",
  "odp",
  "odc",
  "pole",
] as const;

export type InfrastructureDeviceType = (typeof infrastructureDeviceTypes)[number];

export const createInfrastructurePointSchema = z.object({
  name: z
    .string({
      error: "Nama perangkat wajib diisi.",
    })
    .trim()
    .min(1, "Nama perangkat tidak boleh kosong.")
    .max(100, "Nama perangkat maksimal 100 karakter."),
  type: z.enum(infrastructureDeviceTypes, {
    error: "Jenis perangkat harus salah satu dari: router, olt, odp, odc, pole.",
  }),
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
  host: z.string().trim().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type CreateInfrastructurePointInput = z.infer<
  typeof createInfrastructurePointSchema
>;

export const updateInfrastructureLocationSchema = z.preprocess(
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
    id: z.string().trim().optional(),
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
    address: z.string().trim().optional(),
    notes: z.string().trim().optional(),
  }),
);

export type UpdateInfrastructureLocationInput = z.infer<
  typeof updateInfrastructureLocationSchema
>;

export const updateInfrastructurePointSchema = z.object({
  id: z.string().trim().min(1, "ID perangkat wajib diisi.").optional(),
  name: z.string().trim().min(1).max(100).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  host: z.string().trim().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateInfrastructurePointInput = z.infer<
  typeof updateInfrastructurePointSchema
>;

export const deleteInfrastructurePointSchema = z.object({
  id: z.string().trim().min(1, "ID perangkat wajib diisi."),
});

export type DeleteInfrastructurePointInput = z.infer<
  typeof deleteInfrastructurePointSchema
>;

export const infrastructureQuerySchema = z.object({
  type: z
    .enum(["all", ...infrastructureDeviceTypes])
    .optional()
    .default("all"),
  status: z
    .enum(["all", "active", "inactive", "maintenance"])
    .optional()
    .default("all"),
  search: z.string().trim().optional(),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional().default(500),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
  forceMock: z
    .preprocess((val) => {
      if (typeof val === "string") {
        const lower = val.trim().toLowerCase();
        if (lower === "true" || lower === "1") return true;
        if (lower === "false" || lower === "0") return false;
      }
      if (typeof val === "boolean") return val;
      return false;
    }, z.boolean())
    .optional()
    .default(false),
});

export type InfrastructureQueryInput = z.infer<
  typeof infrastructureQuerySchema
>;

