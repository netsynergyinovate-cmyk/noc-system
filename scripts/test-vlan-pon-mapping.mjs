import crypto from "node:crypto";
import pg from "pg";

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

async function testVlanPonMapping() {
  const pool = new pg.Pool({
    connectionString: "postgresql://starter:starter_password@127.0.0.1:5432/starter"
  });

  const ponRes = await pool.query(`
    SELECT pon_index, rx_power, tx_power, attenuation, onu_online_count 
    FROM olt_pon_ports 
    ORDER BY pon_index ASC;
  `);

  console.log("OLT PON Ports:", ponRes.rows);

  const host = "103.167.70.136";
  const auth = Buffer.from(`Monitor:${password}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}` };

  const res = await fetch(`http://${host}/rest/interface`, { headers });
  const ifaces = await res.json();

  const vlanMap = new Map();
  for (const i of ifaces) {
    if (i.type === "vlan" && i.name.startsWith("vlan110")) {
      vlanMap.set(i.name, i);
    }
  }

  console.log("\nMapped VLAN per PON:");
  for (let pon = 1; pon <= 8; pon++) {
    const vlanName = `vlan110${pon}`;
    const iface = vlanMap.get(vlanName);
    const ponData = ponRes.rows.find(p => p.pon_index === pon);
    console.log(`PON ${pon}:`, {
      vlanName,
      vlanId: 1100 + pon,
      interfaceFound: Boolean(iface),
      running: iface?.running === "true",
      rxByte: iface ? Number(iface["rx-byte"]) : 0,
      txByte: iface ? Number(iface["tx-byte"]) : 0,
      onuCount: ponData?.onu_online_count ?? 0,
      rxPower: ponData?.rx_power ?? null,
    });
  }

  await pool.end();
}

testVlanPonMapping().catch(console.error);

