import fs from "node:fs";
import { decryptAES256GCM } from "../src/lib/encryption.ts";
import pg from "pg";
import { MikrotikRestClient } from "../src/lib/mikrotik/client.ts";

const env = fs.readFileSync(".env.local", "utf8");
const dbUrl = env.split("\n").find(l => l.startsWith("DATABASE_URL="))?.split("=").slice(1).join("=").replace(/["']/g, "").trim();

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
const res = await client.query("SELECT * FROM routers WHERE id = '78e7f2cf-f489-416d-b46a-059709b7365b'");
const r = res.rows[0];
console.log("Router:", r.name, r.host);
const password = decryptAES256GCM(r.password_enc);
const mClient = new MikrotikRestClient({
  host: r.host,
  username: r.username,
  password,
  mode: "real",
});
const queues = await mClient.getQueues();
console.log("MikroTik returned queues:", queues.length);
if (queues.length > 0) {
  console.log("First queue:", queues[0]);
}
await client.end();

