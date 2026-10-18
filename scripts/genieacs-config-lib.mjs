// Murni (tanpa I/O) supaya bisa diuji: meratakan ui.json menjadi dokumen koleksi
// "config" GenieACS: { _id: "ui.index.0.label", value: "'PON'" }.
//
// Aturan nilai (sama dengan yang ditulis halaman Admin > Config GenieACS):
//   - string di bawah kunci "parameter", atau item array di bawah "parameters":
//     ekspresi GenieACS, ditulis apa adanya (VirtualParameters.rxPower)
//   - string lain: literal, dikutip ('PON'); tanda kutip di dalamnya di-escape
//   - boolean/angka: teks apa adanya (true, 3)
// Kunci berawalan "_" (mis. "_catatan") diabaikan.

const RAW_KEYS = new Set(["parameter"]);
const RAW_ARRAY_KEYS = new Set(["parameters"]);

export function quoteLiteral(s) {
  return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

function walk(value, id, key, rawArray, out) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${id}.${i}`, key, RAW_ARRAY_KEYS.has(key), out));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith("_")) continue;
      walk(v, `${id}.${k}`, k, false, out);
    }
    return;
  }
  if (typeof value === "string") {
    out.push({ _id: id, value: RAW_KEYS.has(key) || rawArray ? value : quoteLiteral(value) });
  } else if (typeof value === "boolean" || typeof value === "number") {
    out.push({ _id: id, value: String(value) });
  } else {
    throw new Error(`nilai tidak didukung di ${id}: ${JSON.stringify(value)}`);
  }
}

// Mengembalikan { docs, prefixes }. prefixes = kunci tingkat atas (ui.index, ...)
// yang SELURUH isinya diganti: kunci lama dengan awalan itu dihapus lebih dulu.
export function flattenUi(json) {
  const docs = [];
  const prefixes = [];
  for (const [top, v] of Object.entries(json)) {
    if (top.startsWith("_")) continue;
    if (!/^ui\.[a-z]+$/.test(top)) throw new Error(`kunci tingkat atas tidak sah: ${top}`);
    prefixes.push(top);
    walk(v, top, top, false, docs);
  }
  const seen = new Set();
  for (const d of docs) {
    if (seen.has(d._id)) throw new Error(`kunci ganda: ${d._id}`);
    seen.add(d._id);
  }
  return { docs, prefixes };
}
