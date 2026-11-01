import { z } from "zod";

const COMPLAINT_MAX_AGE_MS = 7 * 24 * 3600_000;

// complaintAt: waktu keluhan dilaporkan (opsional, bawaan = saat diminta).
// Tidak boleh di masa depan atau lebih tua dari 7 hari (di luar retensi log).
export const startDiagnosticSchema = z
  .object({
    customerId: z.string().uuid(),
    complaintAt: z
      .string()
      .datetime({ offset: true })
      .transform((v) => new Date(v))
      .refine(
        (d) =>
          d.getTime() <= Date.now() + 5 * 60_000 &&
          d.getTime() >= Date.now() - COMPLAINT_MAX_AGE_MS,
        "Waktu keluhan harus dalam 7 hari terakhir dan tidak di masa depan.",
      )
      .optional(),
  })
  .strict();

export const diagnosticListQuerySchema = z.object({
  customerId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const diagnosticRunIdSchema = z.string().uuid();

export const diagnosticPolicySchema = z
  .object({
    triggerAlert: z.boolean(),
    triggerTicket: z.boolean(),
    triggerBilling: z.boolean(),
    dedupeMinutes: z.number().int().min(1).max(1440),
    massThreshold: z.number().int().min(2).max(1000),
    massWindowMinutes: z.number().int().min(1).max(60),
  })
  .strict();

export type DiagnosticPolicyInput = z.infer<typeof diagnosticPolicySchema>;

export const compareDiagnosticQuerySchema = z
  .object({
    before: z.string().uuid(),
    after: z.string().uuid(),
  })
  .strict();

export const attachDiagnosticSchema = z
  .object({
    alertId: z.string().uuid(),
  })
  .strict();
