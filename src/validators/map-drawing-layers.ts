import { z } from "zod";

export const drawingShapeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["rectangle", "circle", "arrow", "line", "text", "polygon"]),
  coordinates: z.union([
    z.tuple([z.number(), z.number()]),
    z.array(z.tuple([z.number(), z.number()])),
  ]),
  properties: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
    radius: z.number().optional(),
    color: z.string().optional(),
    fillColor: z.string().optional(),
    strokeWidth: z.number().optional(),
    text: z.string().optional(),
    fontSize: z.number().optional(),
    rotation: z.number().optional(),
    geoCoordinates: z
      .union([
        z.tuple([z.number(), z.number()]),
        z.array(z.tuple([z.number(), z.number()])),
      ])
      .optional(),
    geoRadius: z.number().optional(),
  }),
});

export const createDrawingLayerSchema = z.object({
  name: z.string().min(1, "Nama lapisan gambar wajib diisi").max(100),
  description: z.string().max(500).optional(),
  opacity: z.number().min(0).max(1).optional().default(1.0),
  zIndex: z.number().int().optional().default(1),
  isVisible: z.boolean().optional().default(true),
  shapes: z.array(drawingShapeSchema).optional().default([]),
});

export const updateDrawingLayerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  opacity: z.number().min(0).max(1).optional(),
  zIndex: z.number().int().optional(),
  isVisible: z.boolean().optional(),
  shapes: z.array(drawingShapeSchema).optional(),
});

export const batchSaveDrawingLayersSchema = z.object({
  layers: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional().nullable(),
      opacity: z.number().min(0).max(1).optional(),
      zIndex: z.number().int().optional(),
      isVisible: z.boolean().optional(),
      shapes: z.array(drawingShapeSchema).optional(),
    }),
  ),
});

export const reorderDrawingLayersSchema = z.object({
  layers: z
    .array(
      z.object({
        id: z.string().min(1, "ID lapisan wajib diisi"),
        zIndex: z.number().int(),
      }),
    )
    .min(1, "Minimal satu lapisan untuk diurutkan"),
});

export const updateLayerOpacitySchema = z.object({
  opacity: z
    .number()
    .min(0, "Transparansi minimal 0.0")
    .max(1.0, "Transparansi maksimal 1.0"),
});

