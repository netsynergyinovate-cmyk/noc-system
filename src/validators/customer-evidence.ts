import { z } from "zod";
import {
  evidenceRanges,
  type EvidenceRangeId,
} from "@/lib/customer-evidence-types";

const rangeIds = evidenceRanges.map((r) => r.id) as [
  EvidenceRangeId,
  ...EvidenceRangeId[],
];

export const evidenceRangeSchema = z.enum(rangeIds);
export type CustomerEvidenceRange = z.infer<typeof evidenceRangeSchema>;

export const customerEvidenceQuerySchema = z.object({
  id: z.string().uuid(),
  range: evidenceRangeSchema.default("24h"),
});
export type CustomerEvidenceQuery = z.infer<typeof customerEvidenceQuerySchema>;
