import { z } from "zod";

export const startDiagnosticSchema = z
  .object({ customerId: z.string().uuid() })
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
