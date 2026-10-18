import { z } from "zod";

export const waypointCoordinateSchema = z.tuple([
  z.number().min(-90).max(90),
  z.number().min(-180).max(180),
]);

export const saveCableWaypointsSchema = z.object({
  cableId: z.string().min(1, "ID kabel wajib diisi"),
  sourceId: z.string().optional(),
  targetId: z.string().optional(),
  waypoints: z.array(waypointCoordinateSchema),
});

export type SaveCableWaypointsInput = z.infer<typeof saveCableWaypointsSchema>;
export type WaypointCoordinate = z.infer<typeof waypointCoordinateSchema>;
