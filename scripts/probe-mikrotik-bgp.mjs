import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
function normalizeKey(secret) {
  const raw = Buffer.from(secret, "utf-8");
  return raw.length === 32
    ? raw
    : crypto.createHash("sha256").update(raw).digest();
}

function decryptWithKey(data, key) {
  const parts = data.split(":");
  const [iv, tag, enc] = parts.map((p) => Buffer.from(p, "base64"));
  const decipher = crypto.createDecipheriv(ALGORITHM, normalizeKey(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
    "utf8",
  );
}

const secretKey = "noc-device-secret-key-32chars-ok";
const enc = "bil4agKk06H2g5Kl:MxqX1kn4AzboDHrt99uuzA==:jhOfZLHPjILO";
const password = decryptWithKey(enc, secretKey);
const host = "103.167.70.136";
const auth = Buffer.from(`Monitor:${password}`).toString("base64");
const headers = { Authorization: `Basic ${auth}` };

async function probe() {
  const endpoints = [
    "/rest/routing/bgp/session",
    "/rest/routing/bgp/connection",
    "/rest/ip/route",
    "/rest/system/routerboard",
    "/rest/system/identity",
  ];
  for (const ep of endpoints) {
    try {
      const res = await fetch(`http://${host}${ep}`, { headers });
      console.log(`Endpoint ${ep}: status = ${res.status}`);
      if (res.ok) {
        const text = await res.text();
        console.log(`Result: ${text.slice(0, 300)}`);
      }
    } catch (e) {
      console.log(`Endpoint ${ep} error:`, e.message);
    }
  }
}

probe();
