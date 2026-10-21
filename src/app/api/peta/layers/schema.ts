import { z } from "zod";

const coord = z.tuple([
  z.number().min(-90).max(90),
  z.number().min(-180).max(180),
]);

export const shapeSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(["rect", "circle", "arrow", "label"]),
  coordinates: z.array(coord).min(1).max(1000),
  properties: z
    .object({
      text: z.string().max(500).optional(),
      color: z.string().max(50).optional(),
      radiusM: z.number().nonnegative().optional(),
      strokeWidth: z.number().nonnegative().max(100).optional(),
    })
    .optional(),
});

export const layerFields = {
  name: z.string().trim().min(1, "Nama layer wajib diisi").max(160),
  layerOrder: z.number().int(),
  opacity: z.number().min(0).max(1),
  visible: z.boolean(),
  shapes: z.array(shapeSchema).max(2000),
};

export const idSchema = z.string().uuid("ID layer tidak valid");
