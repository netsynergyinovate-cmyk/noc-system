// Memasang konfigurasi GenieACS dari repo (docker/genieacs/config):
//   provisions/<nama>.js         -> NBI  PUT /provisions/<nama>
//   presets/<nama>.json          -> NBI  PUT /presets/<nama>
//   virtual_parameters/<nama>.js -> NBI  PUT /virtual_parameters/<nama>
//   ui.json                      -> koleksi "config" di MongoDB (kolom halaman
//                                   Devices, filter, halaman detail perangkat)
// Idempoten. Setiap hasil dibaca ulang dan dibandingkan; berbeda = keluar kode 1.
//
//   npm run genieacs:config
//   GENIEACS_NBI_URL=http://host:7557 npm run genieacs:config
//   GENIEACS_MONGO_CONTAINER=nama-kontainer-mongo  (bawaan noc-genieacs-genieacs-mongo-1)
//
// Hanya menyentuh yang ada di repo. "default", "bootstrap" dan "inform" bawaan
// GenieACS tidak diubah. ui.json MENGGANTI seluruh kunci ui.index, ui.filters dan
// ui.device; isi lamanya dicadangkan dulu ke docker/genieacs/config/.backup/.
import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flattenUi } from "./genieacs-config-lib.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docker", "genieacs", "config");
const nbi = (process.env.GENIEACS_NBI_URL || "http://127.0.0.1:7557").replace(/\/$/, "");
const mongo = process.env.GENIEACS_MONGO_CONTAINER || "noc-genieacs-genieacs-mongo-1";
const NAME = /^[A-Za-z0-9._-]{1,64}$/;

async function listFiles(dir, ext) {
  try {
    return (await readdir(path.join(root, dir))).filter((f) => f.endsWith(ext)).sort();
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function call(method, url, body, contentType) {
  const res = await fetch(nbi + url, {
    method,
    body,
    headers: contentType ? { "Content-Type": contentType } : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> HTTP ${res.status} ${text.slice(0, 200)}`);
  return text;
}

const q = (id) => `?query=${encodeURIComponent(JSON.stringify({ _id: id }))}`;
let failed = 0;
const report = (ok, label) => {
  console.log(`${ok ? "OK    " : "BEDA  "} ${label}`);
  if (!ok) failed++;
};

for (const file of await listFiles("provisions", ".js")) {
  const name = file.slice(0, -3);
  if (!NAME.test(name)) throw new Error(`nama provision tidak sah: ${file}`);
  const script = await readFile(path.join(root, "provisions", file), "utf8");
  await call("PUT", `/provisions/${encodeURIComponent(name)}`, script, "text/plain");
  const back = JSON.parse(await call("GET", `/provisions/${q(name)}`));
  report(back.length === 1 && back[0].script.trim() === script.trim(), `provision ${name}`);
}

for (const file of await listFiles("virtual_parameters", ".js")) {
  const name = file.slice(0, -3);
  if (!NAME.test(name)) throw new Error(`nama virtual parameter tidak sah: ${file}`);
  const script = await readFile(path.join(root, "virtual_parameters", file), "utf8");
  await call("PUT", `/virtual_parameters/${encodeURIComponent(name)}`, script, "text/plain");
  const back = JSON.parse(await call("GET", `/virtual_parameters/${q(name)}`));
  report(back.length === 1 && back[0].script.trim() === script.trim(), `virtual parameter ${name}`);
}

for (const file of await listFiles("presets", ".json")) {
  const name = file.slice(0, -5);
  if (!NAME.test(name)) throw new Error(`nama preset tidak sah: ${file}`);
  const preset = JSON.parse(await readFile(path.join(root, "presets", file), "utf8"));
  await call("PUT", `/presets/${encodeURIComponent(name)}`, JSON.stringify(preset), "application/json");
  const got = JSON.parse(await call("GET", `/presets/${q(name)}`))[0] ?? {};
  report(
    got.channel === preset.channel &&
      got.weight === preset.weight &&
      got.configurations?.[0]?.name === preset.configurations[0].name,
    `preset ${name}`,
  );
}

// --- ui.json -> MongoDB (koleksi config) ---
let uiJson = null;
try {
  uiJson = JSON.parse(await readFile(path.join(root, "ui.json"), "utf8"));
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}
if (uiJson) {
  const { docs, prefixes } = flattenUi(uiJson);
  const patterns = prefixes.map((p) => "^" + p.replace(/\./g, "\\.") + "\\.");
  // Skrip mongosh lewat stdin; data disisipkan sebagai literal JSON (tanpa interpolasi).
  const script = `
    const docs = ${JSON.stringify(docs)};
    const patterns = ${JSON.stringify(patterns)};
    const re = new RegExp(patterns.join("|"));
    const old = db.config.find({ _id: re }).toArray();
    print("BACKUP:" + JSON.stringify(old));
    db.config.deleteMany({ _id: re });
    if (docs.length) db.config.insertMany(docs);
    const now = db.config.find({ _id: re }).toArray();
    print("COUNT:" + now.length);
  `;
  const run = spawnSync("docker", ["exec", "-i", mongo, "mongosh", "--quiet", "genieacs"], {
    input: script,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error || run.status !== 0) {
    console.error(`Gagal menjalankan mongosh di kontainer ${mongo}: ${run.error?.message ?? run.stderr}`);
    process.exit(1);
  }
  // mongosh lewat stdin mencetak prompt ("genieacs> ") di depan keluaran; ambil
  // mulai dari penanda masing-masing.
  const pick = (marker) => {
    const line = run.stdout.split("\n").find((l) => l.includes(marker));
    return line ? line.slice(line.indexOf(marker)) : null;
  };
  const backupLine = pick("BACKUP:");
  const countLine = pick("COUNT:");
  if (!backupLine || !countLine) {
    console.error("Jawaban mongosh tidak dikenali:\n" + run.stdout.slice(0, 500));
    process.exit(1);
  }
  const dir = path.join(root, ".backup");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const file = path.join(dir, `ui-${stamp}.json`);
  await writeFile(file, backupLine.slice("BACKUP:".length) + "\n");
  report(Number(countLine.slice("COUNT:".length)) === docs.length, `ui.json -> ${docs.length} kunci config (cadangan lama: ${path.relative(process.cwd(), file)})`);
}

if (failed) {
  console.error(`${failed} item tidak sama sesudah dibaca ulang.`);
  process.exit(1);
}
