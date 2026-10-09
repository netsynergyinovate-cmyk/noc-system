import "server-only";
import { z } from "zod";

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
});

// Kosong dianggap tidak diisi, supaya baris kosong di .env.example tidak gagal.
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const env = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  REALTIME_TOKEN_SECRET: blankToUndefined(process.env.REALTIME_TOKEN_SECRET),
  DEVICE_SECRET: blankToUndefined(process.env.DEVICE_SECRET),
  BACKEND_URL: blankToUndefined(process.env.BACKEND_URL),
  DASHBOARD_DATA: blankToUndefined(process.env.DASHBOARD_DATA),
});
