import { z } from "zod";

export const createRouteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Nama jalur wajib diisi.")
    .max(100, "Nama jalur maksimal 100 karakter."),
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
