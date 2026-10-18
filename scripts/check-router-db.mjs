import fs from "node:fs";
import pg from "pg";

const env = fs.readFileSync(".env.local", "utf8");
const dbUrl = env.split("\n").find(l => l.startsWith("DATABASE_URL="))?.split("=").slice(1).join("=").replace(/["']/g, "").trim();

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
const res = await client.query("SELECT id, name, host, status FROM routers");
console.log("Routers:", res.rows);
await client.end();

