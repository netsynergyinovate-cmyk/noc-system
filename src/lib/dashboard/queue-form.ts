import type { MockSimpleQueue } from "./routers.ts";

export interface SimpleQueueFormInput {
  id?: string;
  routerId: string;
  name: string;
  target: string;
  maxLimitUploadMbps: number;
  maxLimitDownloadMbps: number;
  comment?: string;
  disabled: boolean;
}

export const QUEUE_SPEED_PRESETS = [
  { label: "5M / 10M", up: 5, down: 10 },
  { label: "10M / 20M", up: 10, down: 20 },
  { label: "20M / 50M", up: 20, down: 50 },
  { label: "50M / 100M", up: 50, down: 100 },
];

export interface QueueValidation {
  ok: boolean;
  errors: Partial<Record<keyof SimpleQueueFormInput, string>>;
  clean: SimpleQueueFormInput;
}

const MAX_MBPS = 100000;

function validTarget(raw: string): string | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(raw);
  if (!m) return null;
  if ([m[1], m[2], m[3], m[4]].some((o) => Number(o) > 255)) return null;
  if (m[5] !== undefined && Number(m[5]) > 32) return null;
  return m[5] === undefined ? `${raw}/32` : raw;
}

function validMbps(n: number): boolean {
  return Number.isFinite(n) && n > 0 && n <= MAX_MBPS;
}

export function validateQueueInput(input: SimpleQueueFormInput): QueueValidation {
  const errors: QueueValidation["errors"] = {};
  const name = input.name.trim();
  const targetRaw = input.target.trim();
  const comment = input.comment?.trim() || undefined;

  if (!input.routerId) errors.routerId = "Router tujuan wajib dipilih.";
  if (name.length < 2) errors.name = "Nama queue minimal 2 karakter.";
  else if (name.length > 64) errors.name = "Nama queue maksimal 64 karakter.";

  const target = validTarget(targetRaw);
  if (!target) errors.target = "Target harus IPv4 valid, mis. 10.20.1.5 atau 10.20.1.0/24.";

  if (!validMbps(input.maxLimitUploadMbps)) errors.maxLimitUploadMbps = "Upload harus lebih dari 0 dan maksimal 100000 Mbps.";
  if (!validMbps(input.maxLimitDownloadMbps)) errors.maxLimitDownloadMbps = "Download harus lebih dari 0 dan maksimal 100000 Mbps.";

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    clean: { ...input, name, target: target ?? targetRaw, comment },
  };
}

export function createMockQueueFromInput(input: SimpleQueueFormInput): MockSimpleQueue {
  return {
    id: `q-custom-${Date.now()}`,
    routerId: input.routerId,
    name: input.name,
    target: input.target,
    maxLimit: { upload: input.maxLimitUploadMbps * 1e6, download: input.maxLimitDownloadMbps * 1e6 },
    rate: { upload: 0, download: 0 },
    bytes: { upload: 0, download: 0 },
    dropped: 0,
    disabled: input.disabled,
    comment: input.comment,
  };
}

export function applyQueueEdit(existing: MockSimpleQueue, input: SimpleQueueFormInput): MockSimpleQueue {
  return {
    ...existing,
    name: input.name,
    target: input.target,
    maxLimit: { upload: input.maxLimitUploadMbps * 1e6, download: input.maxLimitDownloadMbps * 1e6 },
    comment: input.comment,
    disabled: input.disabled,
  };
}

export function queueToFormInput(q: MockSimpleQueue): SimpleQueueFormInput {
  return {
    id: q.id,
    routerId: q.routerId,
    name: q.name,
    target: q.target,
    maxLimitUploadMbps: q.maxLimit.upload / 1e6,
    maxLimitDownloadMbps: q.maxLimit.download / 1e6,
    comment: q.comment,
    disabled: q.disabled,
  };
}

export function filterDeletedQueues(
  queues: readonly MockSimpleQueue[],
  deletedIds: ReadonlySet<string>,
): MockSimpleQueue[] {
  return queues.filter((q) => !deletedIds.has(q.id));
}

export type DeleteQueueResult = { ok: true } | { ok: false; reason: string };

// ponytail: simulasi lokal; id memuat "fail-delete" selalu gagal. Ganti dengan DELETE /rest/queue/simple/{id} saat backend ada.
export function simulateDeleteQueue(q: Pick<MockSimpleQueue, "id">): DeleteQueueResult {
  if (q.id.includes("fail-delete")) {
    return { ok: false, reason: "Router menolak permintaan (queue sedang dipakai atau tidak dapat dijangkau)." };
  }
  return { ok: true };
}
