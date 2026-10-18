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

async function testMonitor() {
  const host = "103.167.70.136";
  const auth = Buffer.from(`Monitor:${password}`).toString("base64");
  const headers = { 
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json"
  };

  console.log("Testing POST /rest/interface/monitor for vlan1101...");
  try {
    const res = await fetch(`http://${host}/rest/interface/monitor`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        numbers: "vlan1101",
        once: ""
      })
    });
    console.log(`Status: ${res.status}`);
    const data = await res.json();
    console.log("Monitor response:", data);
  } catch (e) {
    console.log("Monitor error:", e.message);
  }

  console.log("\nTesting reading /rest/interface with 1 second delta...");
  const t1 = Date.now();
  const res1 = await fetch(`http://${host}/rest/interface?name=vlan1101,vlan1102,vlan1103,vlan1104,vlan1105,vlan1106`, { headers });
  const data1 = await res1.json();
  
  await new Promise(r => setTimeout(r, 1000));
  
  const t2 = Date.now();
  const res2 = await fetch(`http://${host}/rest/interface?name=vlan1101,vlan1102,vlan1103,vlan1104,vlan1105,vlan1106`, { headers });
  const data2 = await res2.json();
  
  const dtSec = (t2 - t1) / 1000;
  console.log(`Delta time: ${dtSec.toFixed(2)}s`);
  for (let i = 0; i < data1.length; i++) {
    const if1 = data1[i];
    const if2 = data2.find(x => x.name === if1.name);
    if (!if2) continue;
    const rx1 = Number(if1["rx-byte"] || 0);
    const rx2 = Number(if2["rx-byte"] || 0);
    const tx1 = Number(if1["tx-byte"] || 0);
    const tx2 = Number(if2["tx-byte"] || 0);
    const rxMbps = ((rx2 - rx1) * 8) / (dtSec * 1_000_000);
    const txMbps = ((tx2 - tx1) * 8) / (dtSec * 1_000_000);
    console.log(`${if1.name}: Rx=${rxMbps.toFixed(2)} Mbps, Tx=${txMbps.toFixed(2)} Mbps (Client DL=${txMbps.toFixed(2)} Mbps, UL=${rxMbps.toFixed(2)} Mbps)`);
  }
}

testMonitor().catch(err => {
  console.error("Error:", err);
});

