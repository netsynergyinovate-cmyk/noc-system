import "server-only";
import { z } from "zod";
import { trustedProxiesField } from "@/lib/auth-security";

const schema = z.object({
  DATABASE_URL: z.url().refine((value) => {
    const url = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      Boolean(url.hostname) &&
      url.pathname.length > 1 &&
      !url.hash
    );
  }, "Set DATABASE_URL to a PostgreSQL connection string or run npm run setup."),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "Run npm run setup to generate a secret."),
  BETTER_AUTH_URL: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password
      );
    }, "Use an origin, e.g. http://localhost:3000.")
    .default("http://localhost:3000"),
  // Rahasia bersama dengan backend Go untuk tiket login realtime. Tanpa ini
  // /api/realtime/ticket menjawab 503 dan backend mematikan /ws.
  REALTIME_TOKEN_SECRET: z
    .string()
    .min(32, "Use 32+ characters. npm run setup generates one.")
    .optional(),
  // "demo": dashboard memakai data tiruan dan gerbang Setup Perangkat tidak
  // diberlakukan. "live": dashboard hanya terbuka bila minimal satu perangkat
  // (router atau OLT) sudah terpasang dan berhasil dihubungi; selain itu
  // pengguna dialihkan ke /setup. Ganti ke "live" setelah data nyata tersedia.
  DASHBOARD_DATA: z.enum(["demo", "live"]).default("demo"),
  // Kunci 32 byte untuk mengenkripsi kredensial perangkat (AES-256-GCM).
  DEVICE_SECRET: z
    .string()
    .length(32, "DEVICE_SECRET harus persis 32 karakter.")
    .optional(),
  // Alamat backend Go (origin saja).
  BACKEND_URL: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password
      );
    }, "Use an origin, e.g. http://localhost:8080.")
    .default("http://localhost:8080"),
  // Proxy di depan aplikasi yang dipercaya meneruskan alamat klien lewat
  // X-Forwarded-For (daftar alamat IP atau rentang CIDR dipisah koma). Alamat
  // klien menjadi kunci batas laju login; tanpa daftar ini semua header
  // terusan diabaikan (lihat ipAddressOptions di lib/auth-security.ts). Entri
  // yang tidak sah menggagalkan start, bukan dibuang diam-diam.
  TRUSTED_PROXIES: trustedProxiesField,
  // Alamat & kredensial integrasi perangkat nyata / simulator (Fase 1 Uji Integrasi)
  MIKROTIK_REST_HOST: z.string().optional(),
  MIKROTIK_REST_PORT: z.coerce.number().int().min(1).max(65535).default(443),
  MIKROTIK_REST_USER: z.string().optional(),
  MIKROTIK_REST_PASSWORD: z.string().optional(),
  OLT_HSGQ_HOST: z.string().optional(),
  OLT_HSGQ_PORT: z.coerce.number().int().min(1).max(65535).default(80),
  OLT_HSGQ_USER: z.string().optional(),
  OLT_HSGQ_PASSWORD: z.string().optional(),
  GENIEACS_NBI_URL: z.url().optional(),
  GENIEACS_NBI_USER: z.string().optional(),
  GENIEACS_NBI_PASSWORD: z.string().optional(),
  GENIEACS_TIMEOUT_MS: z.coerce.number().int().min(500).max(60000).default(5000),
  BILLING_URL: z.url().optional(),
  BILLING_PORTAL_URL: z.url().optional(),
  BILLING_USERNAME: z.string().optional(),
  BILLING_PASSWORD: z.string().optional(),
  TARGET_DATABASE_URL: z.string().optional(),
});

// Kosong dianggap tidak diisi, supaya baris kosong di .env.example tidak gagal.
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const parsedEnv = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  REALTIME_TOKEN_SECRET: blankToUndefined(process.env.REALTIME_TOKEN_SECRET),
  DEVICE_SECRET: blankToUndefined(process.env.DEVICE_SECRET),
  BACKEND_URL: blankToUndefined(process.env.BACKEND_URL),
  DASHBOARD_DATA: blankToUndefined(process.env.DASHBOARD_DATA),
  TRUSTED_PROXIES: blankToUndefined(process.env.TRUSTED_PROXIES),
  MIKROTIK_REST_HOST: blankToUndefined(process.env.MIKROTIK_REST_HOST),
  MIKROTIK_REST_PORT: blankToUndefined(process.env.MIKROTIK_REST_PORT),
  MIKROTIK_REST_USER: blankToUndefined(process.env.MIKROTIK_REST_USER),
  MIKROTIK_REST_PASSWORD: blankToUndefined(process.env.MIKROTIK_REST_PASSWORD),
  OLT_HSGQ_HOST: blankToUndefined(process.env.OLT_HSGQ_HOST),
  OLT_HSGQ_PORT: blankToUndefined(process.env.OLT_HSGQ_PORT),
  OLT_HSGQ_USER: blankToUndefined(process.env.OLT_HSGQ_USER),
  OLT_HSGQ_PASSWORD: blankToUndefined(process.env.OLT_HSGQ_PASSWORD),
  GENIEACS_NBI_URL: blankToUndefined(process.env.GENIEACS_NBI_URL),
  GENIEACS_NBI_USER: blankToUndefined(process.env.GENIEACS_NBI_USER),
  GENIEACS_NBI_PASSWORD: blankToUndefined(process.env.GENIEACS_NBI_PASSWORD),
  GENIEACS_TIMEOUT_MS: blankToUndefined(process.env.GENIEACS_TIMEOUT_MS),
  BILLING_URL: blankToUndefined(process.env.BILLING_URL),
  BILLING_PORTAL_URL: blankToUndefined(process.env.BILLING_PORTAL_URL),
  BILLING_USERNAME: blankToUndefined(process.env.BILLING_USERNAME),
  BILLING_PASSWORD: blankToUndefined(process.env.BILLING_PASSWORD),
  TARGET_DATABASE_URL: blankToUndefined(process.env.TARGET_DATABASE_URL),
});

export const env: typeof parsedEnv = new Proxy(parsedEnv, {
  get(target, prop, receiver) {
    if (prop === "DASHBOARD_DATA") {
      const mode = process.env.DASHBOARD_DATA || process.env.DATA_MODE;
      if (mode === "live" || mode === "nyata") return "live";
      if (mode === "demo" || mode === "dummy") return "demo";
      return target.DASHBOARD_DATA;
    }
    return Reflect.get(target, prop, receiver);
  },
});
