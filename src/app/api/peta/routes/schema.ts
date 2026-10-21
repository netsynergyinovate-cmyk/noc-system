import { z } from "zod";

// Titik belokan usulan pengguna; panjang & sampling selalu dihitung server
export const geometrySchema = z
  .array(
    z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]),
  )
  .min(2, "Minimal 2 titik koordinat untuk membentuk jalur")
  .max(2000, "Maksimal 2000 titik per segmen");

export const geometryBodySchema = z
  .object({ geometry: geometrySchema })
  .strict();
