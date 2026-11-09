import { z } from "zod";

const latLng = z.tuple([
  z.number().min(-90).max(90),
  z.number().min(-180).max(180),
]);

// Body POST /api/snap dari aplikasi peta. Urutan `points` = rute pilihan pengguna.
export const snapRequestSchema = z
  .object({
    points: z.array(latLng).min(2).max(2000),
    toleranceM: z.number().positive().max(500),
  })
  .strict();
