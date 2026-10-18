import { z } from "zod";

export const deviceRelationTypes = [
  "hierarchy",
  "feeder",
  "backup",
  "distribution",
] as const;
export type DeviceRelationType = (typeof deviceRelationTypes)[number];

export const createDeviceRelationSchema = z
  .object({
    parentId: z
      .string({
        error: "ID perangkat induk (parent) wajib diisi.",
      })
      .trim()
      .min(1, "ID perangkat induk tidak boleh kosong."),
    childId: z
      .string({
        error: "ID perangkat anak (child) wajib diisi.",
      })
      .trim()
      .min(1, "ID perangkat anak tidak boleh kosong."),
    relationType: z
      .enum(deviceRelationTypes, {
        error: "Tipe relasi harus salah satu dari: hierarchy, feeder, backup, distribution.",
      })
      .default("hierarchy"),
    parentPort: z.string().trim().max(100).optional(),
    childPort: z.string().trim().max(100).optional(),
    status: z
      .enum(["active", "standby", "maintenance"], {
        error: "Status relasi harus salah satu dari: active, standby, maintenance.",
      })
      .default("active"),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((data) => data.parentId !== data.childId, {
    message: "Perangkat tidak boleh menjadi induk dari dirinya sendiri (self-reference dilarang).",
    path: ["childId"],
  });

export type CreateDeviceRelationInput = z.infer<
  typeof createDeviceRelationSchema
>;

export const updateDeviceRelationSchema = z.object({
  relationType: z.enum(deviceRelationTypes).optional(),
  parentPort: z.string().trim().max(100).optional().nullable(),
  childPort: z.string().trim().max(100).optional().nullable(),
  status: z.enum(["active", "standby", "maintenance"]).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateDeviceRelationInput = z.infer<
  typeof updateDeviceRelationSchema
>;

export const queryDeviceRelationsSchema = z.object({
  deviceId: z.string().trim().optional(),
  parentId: z.string().trim().optional(),
  childId: z.string().trim().optional(),
  relationType: z.enum(deviceRelationTypes).optional(),
  status: z.enum(["active", "standby", "maintenance"]).optional(),
});

export type QueryDeviceRelationsInput = z.infer<
  typeof queryDeviceRelationsSchema
>;
