import { z } from "zod";
import { normalizeRecipientPhone } from "@/lib/dashboard/whatsapp";

const base = z.object({
  name: z.string().trim().min(1).max(100),
  target: z.string().trim().min(1),
  type: z.enum(["individual", "group"]),
  isActive: z.boolean().optional(),
});

// Target dinormalkan menurut tipe; null bila tidak valid.
export function normalizeTarget(target: string, type: "individual" | "group") {
  return (
    normalizeRecipientPhone(target, type === "group" ? "group" : "personal") ||
    null
  );
}

export const createRecipientSchema = base.strict().superRefine((v, ctx) => {
  if (!normalizeTarget(v.target, v.type))
    ctx.addIssue({
      code: "custom",
      path: ["target"],
      message:
        v.type === "group"
          ? "ID grup tidak valid."
          : "Nomor telepon tidak valid.",
    });
});

// Kecocokan target dengan tipe dicek di service (butuh tipe yang tersimpan).
export const updateRecipientSchema = base.partial().strict();

export const recipientIdSchema = z.string().uuid();

export const listWhatsappLogsSchema = z.object({
  status: z.enum(["pending", "sent", "failed"]).optional(),
  alertKind: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const sendWhatsappSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1, "Pesan wajib diisi.")
      .max(2000, "Pesan maksimal 2000 karakter."),
    target: z.string().trim().min(1, "Target tidak boleh kosong.").optional(),
    recipientId: z.string().uuid("recipientId harus UUID.").optional(),
    alertKind: z.string().trim().min(1).max(50).optional(),
    broadcast: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (!v.broadcast && !v.target && !v.recipientId)
      ctx.addIssue({
        code: "custom",
        path: ["target"],
        message: "Isi target atau recipientId, atau set broadcast = true.",
      });
  });

export type SendWhatsappInput = z.infer<typeof sendWhatsappSchema>;

// failureRate = gagal / (terkirim + gagal), persen 1 desimal; pending belum final jadi tak dihitung.
export function summarizeLogCounts(c: {
  sent: number;
  failed: number;
  pending: number;
}) {
  const final = c.sent + c.failed;
  return {
    totalSent: c.sent,
    totalFailed: c.failed,
    totalPending: c.pending,
    failureRate: final ? Math.round((c.failed / final) * 1000) / 10 : 0,
  };
}

export type CreateRecipientInput = z.infer<typeof createRecipientSchema>;
export type UpdateRecipientInput = z.infer<typeof updateRecipientSchema>;
