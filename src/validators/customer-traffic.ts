import { z } from "zod";

// "live" = laju saat ini dari simple queue router; sisanya histori rata-rata
// dari customer_traffic_samples.
export const customerTrafficRangeSchema = z.enum(["live", "24h", "7d", "30d"]);
export type CustomerTrafficRange = z.infer<typeof customerTrafficRangeSchema>;

export const customerTrafficQuerySchema = z.object({
  id: z.string().uuid(),
  range: customerTrafficRangeSchema.default("24h"),
});
