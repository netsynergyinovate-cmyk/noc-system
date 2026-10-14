import { z } from "zod";

export const createOltSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    // Alamat IP atau hostname, tanpa skema.
    host: z.string().trim().min(1).max(255),
    brand: z.string().trim().min(1).max(50),
    driver: z.string().trim().min(1).max(50),
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(100),
  })
  .strict();

export type CreateOltInput = z.infer<typeof createOltSchema>;

export const oltIdSchema = z.string().uuid();

// Segmen URL berupa teks: hanya digit ASCII (tolak "-1", "1.5", "1e2", " 1").
export const ponIndexSchema = z
  .string()
  .regex(/^\d{1,6}$/)
  .transform(Number)
  .refine((n) => n >= 1);

export const liveOnuFilterSchema = z
  .object({
    ponIndex: z.coerce.number().int().min(1).max(128).optional(),
    status: z.enum(["online", "offline", "los"]).optional(),
    q: z.string().trim().max(100).optional(),
    isWeak: z.enum(["true", "false"]).optional(),
  })
  .strict();
export type LiveOnuFilterInput = z.infer<typeof liveOnuFilterSchema>;

export const opticalFilterSchema = z
  .object({
    ponIndex: z.coerce.number().int().min(1).max(128).optional(),
  })
  .strict();
export type OpticalFilterInput = z.infer<typeof opticalFilterSchema>;

export const mapOnuSchema = z.object({ customerId: z.string().uuid().nullable() }).strict();

export const ONU_MAX_LIMIT = 200;
export const ONU_DEFAULT_LIMIT = 50;

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : typeof v === "number" ? Math.trunc(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// Parameter daftar ONU dari query string; nilai buruk diabaikan/dijepit, bukan ditolak.
export function parseListOnusParams(sp: URLSearchParams | Record<string, unknown>) {
  const get = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) : sp[k]);
  const oltId = oltIdSchema.safeParse(get("oltId"));
  const customerId = oltIdSchema.safeParse(get("customerId"));
  const status = get("status");
  const isWeak = get("isWeak");
  const isTroubled = get("isTroubled") ?? get("troubled");
  const isMappedRaw = get("isMapped") ?? get("mapped");
  const isMapped =
    isMappedRaw === "true" || isMappedRaw === true
      ? true
      : isMappedRaw === "false" || isMappedRaw === false
      ? false
      : undefined;
  const q = typeof get("q") === "string" ? (get("q") as string).trim().slice(0, 100) : "";
  return {
    oltId: oltId.success ? oltId.data : undefined,
    customerId: customerId.success ? customerId.data : undefined,
    status: status === "online" || status === "offline" ? (status as "online" | "offline") : undefined,
    isWeak: isWeak === "true" || isWeak === true ? true : isWeak === "false" || isWeak === false ? false : undefined,
    isTroubled: isTroubled === "true" || isTroubled === true ? true : isTroubled === "false" || isTroubled === false ? false : undefined,
    isMapped,
    q: q || undefined,
    limit: clampInt(get("limit"), 1, ONU_MAX_LIMIT, ONU_DEFAULT_LIMIT),
    offset: clampInt(get("offset"), 0, 1_000_000, 0),
  };
}
export type ListOnusParams = ReturnType<typeof parseListOnusParams>;

// Semua field opsional, tetapi minimal satu harus diisi.
export const updateOltSchema = createOltSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Isi minimal satu field." });

export type UpdateOltInput = z.infer<typeof updateOltSchema>;

export const testOltSchema = z
  .object({
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65535).default(80),
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(100),
    community: z.string().trim().max(100).optional(),
    mode: z.enum(["simulator", "real"]).default("real"),
    brand: z.string().max(50).optional(),
    driver: z.string().max(50).optional(),
  })
  .strict();

export type TestOltInput = z.infer<typeof testOltSchema>;

export const testDeviceConnectionSchema = z
  .object({
    type: z.enum(["mikrotik", "olt", "genieacs", "billing"]),
    mode: z.enum(["simulator", "real"]).default("real"),
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65535).optional(),
    username: z.string().trim().max(100).optional(),
    password: z.string().max(100).optional(),
    useTls: z.boolean().optional(),
    brand: z.string().max(50).optional(),
    driver: z.string().max(50).optional(),
  })
  .strict();

export type TestDeviceConnectionInput = z.infer<typeof testDeviceConnectionSchema>;

// Uji portal billing: semua field opsional, yang kosong jatuh ke BILLING_* di env.
export const testBillingConnectionSchema = z
  .object({
    host: z.string().trim().min(1).max(255).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    username: z.string().trim().max(100).optional(),
    password: z.string().max(100).optional(),
    mode: z.enum(["simulator", "real"]).default("real"),
    useTls: z.boolean().optional(),
  })
  .strict();

export type TestBillingConnectionInput = z.infer<typeof testBillingConnectionSchema>;
