import { z } from "zod";
import { evidenceRangeSchema } from "./customer-evidence";

export { evidenceRangeSchema } from "./customer-evidence";

export const customerIncidentsQuerySchema = z.object({
  range: evidenceRangeSchema.default("24h"),
});
export type CustomerIncidentsQuery = z.infer<
  typeof customerIncidentsQuerySchema
>;

export const incidentSeriesQuerySchema = z
  .object({
    id: z.string().uuid(),
    from: z.coerce.number().int().nonnegative(),
    to: z.union([z.literal("open"), z.coerce.number().int().nonnegative()]),
  })
  .refine(
    (data) => {
      if (data.to === "open") return true;
      return data.to >= data.from;
    },
    { message: "'to' harus lebih besar atau sama dengan 'from'." },
  )
  .refine(
    (data) => {
      const nowSec = Math.floor(Date.now() / 1000);
      const toSec = data.to === "open" ? nowSec : data.to;
      return toSec - data.from <= 90 * 86400;
    },
    { message: "Rentang waktu maksimal 90 hari." },
  );
export type IncidentSeriesQuery = z.infer<typeof incidentSeriesQuerySchema>;
