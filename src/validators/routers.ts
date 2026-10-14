import { z } from "zod";

export const createRouterSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65535).optional(),
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(100),
    useSsl: z.boolean().optional(),
    mode: z.enum(["real", "simulator"]).optional(),
    validateConnection: z.boolean().optional(),
  })
  .strict();

export const testRouterSchema = z.object({
  host: z.string().min(1, "Host wajib diisi").max(255).trim(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1, "Username wajib diisi").max(100).trim(),
  password: z.string().max(100),
  useSsl: z.boolean().optional(),
  mode: z.enum(["real", "simulator"]).optional(),
});

export type CreateRouterInput = z.infer<typeof createRouterSchema>;

