import { readJson, withApiSession } from "@/lib/api";
import { snapToRoads } from "@/services/road-snap.service";
import { snapRequestSchema } from "@/validators/snap";

export const runtime = "nodejs";

// Tempelkan jalur kabel ke jalan nyata (OSRM self-host) untuk aplikasi peta.
// POST /api/snap { points: [[lat, lng], ...], toleranceM }
//   -> { snapped, geometry: [[lat, lng], ...], provider }
// Hanya menghitung, tidak menyimpan apa pun, jadi key hanya-baca boleh memanggilnya.
export function POST(request: Request) {
  return withApiSession(
    request,
    async () => {
      const { points, toleranceM } = snapRequestSchema.parse(await readJson(request));
      return Response.json(await snapToRoads(points, toleranceM));
    },
    { readsOnly: true },
  );
}
