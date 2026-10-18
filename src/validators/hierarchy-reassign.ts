import { z } from "zod";

export const reassignHierarchyParentSchema = z.object({
  nodeId: z
    .string({
      error: "ID simpul anak wajib diisi.",
    })
    .trim()
    .min(1, "ID simpul anak tidak boleh kosong."),
  nodeType: z.enum(["customer", "odp", "odc"], {
    error: "Tipe simpul harus salah satu dari: customer, odp, odc.",
  }),
  tier: z.coerce
    .number()
    .int()
    .min(2, "Hanya simpul tingkat 2, 3, dan 4 yang memiliki induk.")
    .max(4),
  newParentId: z
    .string({
      error: "ID induk baru wajib diisi.",
    })
    .trim()
    .min(1, "ID induk baru tidak boleh kosong."),
  newParentName: z
    .string({
      error: "Nama induk baru wajib diisi.",
    })
    .trim()
    .min(1, "Nama induk baru tidak boleh kosong."),
});

export type ReassignHierarchyParentInput = z.infer<
  typeof reassignHierarchyParentSchema
>;
