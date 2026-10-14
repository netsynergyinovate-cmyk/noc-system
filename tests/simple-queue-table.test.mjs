import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  filterSimpleQueues,
  summarizeSimpleQueues,
} from "../src/lib/dashboard/routers.ts";

const page = "src/app/(protected)/app/router/queues/page.tsx";
const board = "src/components/dashboard/simple-queue-board.tsx";
const list = "src/app/(protected)/app/router/page.tsx";

test("halaman queues: metadata, default export, requireSession", () => {
  assert.ok(existsSync(page));
  const s = readFileSync(page, "utf8");
  assert.match(s, /export const metadata/);
  assert.match(s, /title: "Simple Queue Router"/);
  assert.match(s, /export default async function/);
  assert.match(s, /await requireSession\(\)/);
});

test("board mengekspor SimpleQueueBoard", () => {
  assert.ok(existsSync(board));
  assert.match(readFileSync(board, "utf8"), /export function SimpleQueueBoard/);
});

test("halaman router menaut ke /app/router/queues", () => {
  assert.match(readFileSync(list, "utf8"), /href="\/app\/router\/queues"/);
});

const q = (name, target, disabled, up, down, comment) => ({
  id: name,
  routerId: "r",
  name,
  target,
  maxLimit: { upload: 1e6, download: 2e6 },
  rate: { upload: up, download: down },
  bytes: { upload: 0, download: 0 },
  dropped: 0,
  disabled,
  comment,
});
const data = [
  q("budi", "10.0.0.1/32", false, 100, 200, "Budi S"),
  q("dewi", "10.0.0.2/32", false, 50, 60, "Dewi"),
  q("andi", "10.0.0.3/32", true, 0, 0, "Andi isolir"),
];

test("summarizeSimpleQueues: total, aktif, nonaktif, trafik", () => {
  assert.deepEqual(summarizeSimpleQueues(data), {
    total: 3,
    active: 2,
    disabled: 1,
    rateUpload: 150,
    rateDownload: 260,
  });
  assert.equal(summarizeSimpleQueues([]).total, 0);
});

test("filterSimpleQueues: kata, status", () => {
  assert.equal(filterSimpleQueues(data, "").length, 3);
  assert.deepEqual(filterSimpleQueues(data, "10.0.0.2").map((x) => x.name), ["dewi"]);
  assert.deepEqual(filterSimpleQueues(data, "isolir").map((x) => x.name), ["andi"]);
  assert.deepEqual(filterSimpleQueues(data, "", "disabled").map((x) => x.name), ["andi"]);
  assert.equal(filterSimpleQueues(data, "", "active").length, 2);
  assert.equal(filterSimpleQueues(data, "zzz").length, 0);
});
