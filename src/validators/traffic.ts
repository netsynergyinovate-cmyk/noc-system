import { z } from "zod";

export const trafficRangeSchema = z.enum(["1h", "6h", "24h", "7d"]);
export type TrafficRange = z.infer<typeof trafficRangeSchema>;

export const trafficTrendQuerySchema = z.object({
  range: trafficRangeSchema.default("24h"),
  routerId: z.string().uuid().optional(),
  now: z.coerce.number().int().positive().optional(),
});

export type TrafficTrendQuery = z.infer<typeof trafficTrendQuerySchema>;

export function parseTrafficTrendQuery(searchParams: URLSearchParams): TrafficTrendQuery {
  const rawRange = searchParams.get("range");
  const rawRouterId = searchParams.get("routerId") || searchParams.get("router_id");
  const rawNow = searchParams.get("now") || searchParams.get("t");

  return trafficTrendQuerySchema.parse({
    range: rawRange ?? undefined,
    routerId: rawRouterId ?? undefined,
    now: rawNow ?? undefined,
  });
}
