import { z } from "zod";

export const mismatchResolutionActions = [
  "investigate",
  "ignore",
  "followup_customer",
  "manual_pair",
] as const;

export type MismatchResolutionAction =
  (typeof mismatchResolutionActions)[number];

export const updateMismatchSchema = z.object({
  mismatchKey: z.string().min(1, "Kunci mismatch tidak boleh kosong"),
  action: z.enum(mismatchResolutionActions, {
    message: "Tindakan penandaan tidak valid",
  }),
  notes: z.string().max(500, "Catatan maksimal 500 karakter").optional(),
});

export type UpdateMismatchInput = z.infer<typeof updateMismatchSchema>;
