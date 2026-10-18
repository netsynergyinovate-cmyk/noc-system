import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

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

console.log("Password decrypted successfully.");

async function inspectMikrotik() {
  const host = "103.167.70.136";
  const auth = Buffer.from(`Monitor:${password}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}` };

  console.log("Fetching /rest/interface from MikroTik Core CIARA...");
  const res = await fetch(`http://${host}/rest/interface`, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  const ifaces = await res.json();
  console.log(`Total interfaces found: ${ifaces.length}`);
  
  const vlanIfaces = ifaces.filter(i => i.type === "vlan" || i.name.toLowerCase().includes("vlan") || i.name.toLowerCase().includes("pon"));
  console.log("\n=== VLAN / PON Interfaces ===");
  console.log(vlanIfaces.map(i => ({
    name: i.name,
    type: i.type,
    running: i.running,
    disabled: i.disabled,
    "rx-byte": i["rx-byte"],
    "tx-byte": i["tx-byte"],
    comment: i.comment
  })));

  console.log("\n=== All Non-PPPoE Interfaces ===");
  const nonPppoe = ifaces.filter(i => !i.name.startsWith("<pppoe-"));
  console.log(nonPppoe.map(i => ({
    name: i.name,
    type: i.type,
    running: i.running,
    disabled: i.disabled,
    "rx-byte": i["rx-byte"],
    "tx-byte": i["tx-byte"],
    comment: i.comment
  })));

  // Also check /rest/interface/vlan
  try {
    const resVlan = await fetch(`http://${host}/rest/interface/vlan`, { headers });
    if (resVlan.ok) {
      const vlans = await resVlan.json();
      console.log("\n=== /rest/interface/vlan ===");
      console.log(vlans.map(v => ({
        name: v.name,
        "vlan-id": v["vlan-id"],
        interface: v.interface,
        disabled: v.disabled,
        comment: v.comment
      })));
    }
  } catch (e) {
    console.log("Could not fetch /rest/interface/vlan:", e.message);
  }
}

inspectMikrotik().catch(err => {
  console.error("Error inspecting MikroTik:", err);
});

