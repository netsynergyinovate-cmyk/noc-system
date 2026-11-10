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
  JWT_SECRET: z.string().min(32, "Set JWT_SECRET to at least 32 characters.").optional(),
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
  // Pendaftaran akun mandiri lewat /sign-up. Bawaan tertutup: akun dibuat
  // lewat `npm run seed:accounts` dan peran lewat `npm run role:set`. Hanya
  // "true" yang membuka (dipakai tes E2E).
  ALLOW_SIGN_UP: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Kunci 32 byte untuk mengenkripsi kredensial perangkat (AES-256-GCM).
  DEVICE_SECRET: z
    .string()
    .length(32, "DEVICE_SECRET harus persis 32 karakter.")
    .optional(),
  // Logto OIDC / OAuth Configuration
  LOGTO_ENDPOINT: z.string().default("http://localhost:3301"),
  LOGTO_INTERNAL_ENDPOINT: z.string().default("http://nocsystem-logto:3001"),
  LOGTO_CLIENT_ID: z.string().optional(),
  LOGTO_CLIENT_SECRET: z.string().optional(),
  // Alamat backend Go YANG DIBUKA BROWSER (WebSocket dan panggilan REST langsung
  // dari klien). Di Docker ini port yang di-map ke host (mis. localhost:8080),
  // BUKAN alamat antar-kontainer: browser tidak tahu nama layanan Docker.
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
  // Alamat backend Go dipanggil dari SERVER Next.js sendiri (route handler ke
  // route handler, bukan browser): sinkron billing manual, histori billing,
  // ikat TR-069. Di Docker ini nama layanan Compose (mis. http://backend:8080),
  // beda dari BACKEND_URL karena app dan backend ada di jaringan kontainer yang
  // sama tapi BUKAN localhost satu sama lain. Kosong berarti dianggap sama
  // dengan BACKEND_URL (benar untuk `npm run dev` di luar Docker, di mana
  // keduanya memang satu host); isi eksplisit hanya di Docker.
  BACKEND_INTERNAL_URL: z
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
    }, "Use an origin, e.g. http://backend:8080.")
    .optional(),
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
  GENIEACS_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(60000)
    .default(5000),
  BILLING_URL: z.url().optional(),
  BILLING_PORTAL_URL: z.url().optional(),
  BILLING_USERNAME: z.string().optional(),
  BILLING_PASSWORD: z.string().optional(),
  TARGET_DATABASE_URL: z.string().optional(),
  // OSRM self-host untuk POST /api/snap (lihat docs/noc/road-snap.md). Di Docker
  // isi http://osrm:5000 (nama layanan di compose.osrm.yaml).
  OSRM_BASE_URL: z.url().default("http://127.0.0.1:5000"),
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
  BACKEND_INTERNAL_URL: blankToUndefined(process.env.BACKEND_INTERNAL_URL),
  DASHBOARD_DATA: blankToUndefined(process.env.DASHBOARD_DATA),
  ALLOW_SIGN_UP: blankToUndefined(process.env.ALLOW_SIGN_UP),
  TRUSTED_PROXIES: blankToUndefined(process.env.TRUSTED_PROXIES),
  LOGTO_ENDPOINT: blankToUndefined(process.env.LOGTO_ENDPOINT),
  LOGTO_INTERNAL_ENDPOINT: blankToUndefined(
    process.env.LOGTO_INTERNAL_ENDPOINT,
  ),
  LOGTO_CLIENT_ID: blankToUndefined(process.env.LOGTO_CLIENT_ID),
  LOGTO_CLIENT_SECRET: blankToUndefined(process.env.LOGTO_CLIENT_SECRET),
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
  OSRM_BASE_URL: blankToUndefined(process.env.OSRM_BASE_URL),
});

// BACKEND_INTERNAL_URL selalu terisi lewat Proxy di bawah (jatuh ke BACKEND_URL
// bila kosong), jadi tipenya di sini bukan opsional seperti hasil parse zod.
export const env: Omit<typeof parsedEnv, "BACKEND_INTERNAL_URL"> & {
  BACKEND_INTERNAL_URL: string;
} = new Proxy(parsedEnv, {
  get(target, prop, receiver) {
    if (prop === "DASHBOARD_DATA") {
      const mode = process.env.DASHBOARD_DATA || process.env.DATA_MODE;
      if (mode === "live" || mode === "nyata") return "live";
      if (mode === "demo" || mode === "dummy") return "demo";
      return target.DASHBOARD_DATA;
    }
    // Tanpa BACKEND_INTERNAL_URL eksplisit, server memakai BACKEND_URL (benar
    // di luar Docker); kode server-ke-server HARUS memakai properti ini, tidak
    // pernah BACKEND_URL langsung (itu alamat untuk BROWSER).
    if (prop === "BACKEND_INTERNAL_URL") {
      return target.BACKEND_INTERNAL_URL ?? target.BACKEND_URL;
    }
    return Reflect.get(target, prop, receiver);
  },
}) as typeof parsedEnv & { BACKEND_INTERNAL_URL: string };
