import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
function normalizeKey(secret) {
  const raw = Buffer.from(secret, "utf-8");
  return raw.length === 32 ? raw : crypto.createHash("sha256").update(raw).digest();
}

function decryptWithKey(data, key) {
  const parts = data.split(":");
  const [iv, tag, enc] = parts.map((p) => Buffer.from(p, "base64"));
  const decipher = crypto.createDecipheriv(ALGORITHM, normalizeKey(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

const secretKey = "noc-device-secret-key-32chars-ok";
const enc = "bil4agKk06H2g5Kl:MxqX1kn4AzboDHrt99uuzA==:jhOfZLHPjILO";
const password = decryptWithKey(enc, secretKey);
const host = "103.167.70.136";
const auth = Buffer.from(`Monitor:${password}`).toString("base64");
const headers = { Authorization: `Basic ${auth}` };

async function sampleRates() {
  console.log("Sample 1...");
  const res1 = await fetch(`http://${host}/rest/interface`, { headers });
  const ifaces1 = await res1.json();
  const t1 = Date.now();

  await new Promise(r => setTimeout(r, 2000));

  console.log("Sample 2 (after 2s)...");
  const res2 = await fetch(`http://${host}/rest/interface`, { headers });
  const ifaces2 = await res2.json();
  const t2 = Date.now();
  const dt = (t2 - t1) / 1000;

  const m1 = new Map(ifaces1.map(i => [i.name, i]));
  for (const i2 of ifaces2) {
    if (i2.name.startsWith("<pppoe-") || i2.name === "lo") continue;
    const i1 = m1.get(i2.name);
    if (!i1) continue;
    const dRx = Number(i2["rx-byte"]) - Number(i1["rx-byte"]);
    const dTx = Number(i2["tx-byte"]) - Number(i1["tx-byte"]);
    const rxMbps = Math.max(0, Math.round(((dRx * 8) / (dt * 1_000_000)) * 10) / 10);
    const txMbps = Math.max(0, Math.round(((dTx * 8) / (dt * 1_000_000)) * 10) / 10);
    if (rxMbps > 0 || txMbps > 0 || i2.running === "true") {
      console.log(`Interface ${i2.name} (running: ${i2.running}): ↓ ${rxMbps} Mbps, ↑ ${txMbps} Mbps (comment: ${i2.comment ?? "-"})`);
    }
  }
}

sampleRates();

