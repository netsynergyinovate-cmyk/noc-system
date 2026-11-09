import { z } from "zod";

export const FEATURE_MARKER_CATEGORIES = [
  "used_frequently",
  "rarely_used",
  "bug_issue",
  "improvement",
] as const;

export const FEATURE_MARKER_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "occasional",
] as const;

export const FEATURE_MARKER_STATUSES = [
  "baru",
  "ditinjau",
  "dikerjakan",
  "selesai",
] as const;

export type FeatureMarkerCategory = (typeof FEATURE_MARKER_CATEGORIES)[number];
export type FeatureMarkerFrequency =
  (typeof FEATURE_MARKER_FREQUENCIES)[number];
export type FeatureMarkerStatus = (typeof FEATURE_MARKER_STATUSES)[number];

export const createFeatureMarkerSchema = z
  .object({
    pagePath: z.string().trim().min(1, "Lokasi halaman wajib diisi").max(255),
    pageTitle: z.string().max(255).default(""),
    elementSelector: z.string().max(500).default(""),
    elementText: z.string().max(10_000).default(""),
    featureName: z.string().trim().min(1, "Nama fitur wajib diisi").max(255),
    category: z.enum(FEATURE_MARKER_CATEGORIES).default("used_frequently"),
    frequency: z.enum(FEATURE_MARKER_FREQUENCIES).default("daily"),
    notes: z.string().max(10_000).default(""),
  })
  .strict();

export const updateFeatureMarkerSchema = z
  .object({
    status: z.enum(FEATURE_MARKER_STATUSES).optional(),
    developerNotes: z.string().max(10_000).optional(),
  })
  .strict()
  .refine(
    (val) => val.status !== undefined || val.developerNotes !== undefined,
    "Sertakan status atau catatan developer untuk memperbarui tanda.",
  );

export const featureMarkerIdSchema = z
  .string()
  .uuid("ID tanda fitur tidak valid");

export const listFeatureMarkersSchema = z
  .object({
    pagePath: z.string().trim().optional(),
    category: z.enum(FEATURE_MARKER_CATEGORIES).optional(),
    userRole: z.string().trim().optional(),
    status: z.enum(FEATURE_MARKER_STATUSES).optional(),
    search: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();

export type CreateFeatureMarkerInput = z.infer<
  typeof createFeatureMarkerSchema
>;
export type UpdateFeatureMarkerInput = z.infer<
  typeof updateFeatureMarkerSchema
>;
export type ListFeatureMarkersInput = z.infer<typeof listFeatureMarkersSchema>;
