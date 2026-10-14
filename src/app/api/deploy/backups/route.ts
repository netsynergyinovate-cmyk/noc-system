import { withApiSession } from "@/lib/api";
import {
  listBackupSnapshots,
  createNewBackupSnapshot,
} from "@/services/backup-snapshots.service";
import type { BackupSnapshotItem } from "@/lib/dashboard/deploy-safety";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const snapshots = await listBackupSnapshots();
    const total = snapshots.length;
    const totalBytes = snapshots.reduce((sum, s) => sum + s.sizeBytes, 0);
    const latestSnapshotAt = snapshots[0]?.createdAt ?? null;

    return Response.json({
      data: {
        snapshots,
        total,
        totalBytes,
        latestSnapshotAt,
        retrievedAt: new Date().toISOString(),
      },
    });
  });
}

export function POST(request: Request) {
  return withApiSession(request, async () => {
    let body: { type?: BackupSnapshotItem["type"]; label?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      // Body kosong diperbolehkan, gunakan default
    }

    const type = body.type ?? "full_snapshot";
    const snapshot = await createNewBackupSnapshot(type, body.label);

    return Response.json(
      {
        data: snapshot,
        message: `Snapshot cadangan "${snapshot.label}" berhasil dibuat.`,
      },
      { status: 201 },
    );
  });
}
