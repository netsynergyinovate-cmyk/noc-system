// Simulator perangkat untuk lab lokal: MikroTik REST, OLT HSGQ, GenieACS NBI,
// portal billing dan health. Hanya node:http. Data tetap, tanpa acak, supaya
// uji banding stack dapat diulang.
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export const DEFAULT_PORTS = Object.freeze({
  health: 8080,
  mikrotik: 8081,
  olt: 8082,
  billing: 8083,
  genieacs: 7557,
});

const USER = "admin";
const PASS = "admin";
const CSRF = "csrf-lab-token-123";
const SESSION = "sess_lab_ok";

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function html(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function basicOk(req) {
  const h = req.headers.authorization ?? "";
  if (!h.startsWith("Basic ")) return false;
  return (
    Buffer.from(h.slice(6), "base64").toString("utf8") === `${USER}:${PASS}`
  );
}

function unauthorized(res) {
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="lab"',
    "content-type": "application/json",
  });
  res.end(JSON.stringify({ error: "unauthorized" }));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((accept, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => accept(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const notFound = (res) => json(res, 404, { error: "not found" });

// --- MikroTik ---------------------------------------------------------------
const queues = [
  {
    ".id": "*1",
    name: "budi",
    target: "10.10.0.2/32",
    "max-limit": "10M/10M",
    rate: "1200000/8400000",
  },
  {
    ".id": "*2",
    name: "dewi",
    target: "10.10.0.3/32",
    "max-limit": "20M/20M",
    rate: "300000/2100000",
  },
];
const pppActive = [
  {
    ".id": "*A1",
    name: "budi",
    service: "pppoe",
    address: "10.10.0.2",
    uptime: "1d3h",
    "caller-id": "AA:BB:CC:00:00:01",
  },
  {
    ".id": "*A2",
    name: "dewi",
    service: "pppoe",
    address: "10.10.0.3",
    uptime: "4h12m",
    "caller-id": "AA:BB:CC:00:00:02",
  },
];

function mikrotik(req, res) {
  if (!basicOk(req)) return unauthorized(res);
  const path = new URL(req.url, "http://x").pathname;
  if (req.method !== "GET") return json(res, 405, { error: "method" });
  if (path === "/rest/system/resource")
    return json(res, 200, {
      "cpu-load": 15,
      "free-memory": 512000000,
      "total-memory": 1024000000,
      uptime: "5d2h",
      version: "7.15",
      "board-name": "CCR2004-1G-12S+2XS",
    });
  if (path === "/rest/queue/simple") return json(res, 200, queues);
  if (path === "/rest/ppp/active") return json(res, 200, pppActive);
  notFound(res);
}

// --- OLT HSGQ ---------------------------------------------------------------
const ponPorts = Array.from({ length: 8 }, (_, i) => ({
  port: i + 1,
  status: "up",
  onu_count: i < 2 ? 2 : 0,
  tx_power: 3.5,
}));
const onus = [
  { id: "ONU-1-1", pon: 1, sn: "HWTC00000001", status: "online", rx_power: -21.4 },
  { id: "ONU-1-2", pon: 1, sn: "HWTC00000002", status: "online", rx_power: -23.9 },
  { id: "ONU-2-1", pon: 2, sn: "HWTC00000003", status: "online", rx_power: -19.8 },
  { id: "ONU-2-2", pon: 2, sn: "HWTC00000004", status: "offline", rx_power: null },
];

function olt(req, res) {
  if (!basicOk(req)) return unauthorized(res);
  const path = new URL(req.url, "http://x").pathname;
  if (req.method !== "GET") return json(res, 405, { error: "method" });
  if (path === "/api/v1/system")
    return json(res, 200, {
      model: "HSGQ-G08",
      pon_ports: 8,
      firmware: "V2.5.4",
    });
  if (path === "/api/v1/pon") return json(res, 200, ponPorts);
  if (path === "/api/v1/onu") return json(res, 200, onus);
  notFound(res);
}

// --- GenieACS NBI -----------------------------------------------------------
const devices = [
  {
    _id: "202BC1-BM632w-000001",
    _lastInform: "2026-10-12T00:00:00.000Z",
    InternetGatewayDevice: {
      DeviceInfo: {
        ModelName: { _value: "BM632w" },
        SoftwareVersion: { _value: "V1.0.3" },
      },
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              WANPPPConnection: {
                1: {
                  Username: { _value: "budi" },
                  ExternalIPAddress: { _value: "10.10.0.2" },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    _id: "A0B1C2-F670L-000002",
    _lastInform: "2026-10-12T00:00:00.000Z",
    Device: {
      DeviceInfo: {
        ModelName: { _value: "F670L" },
        SoftwareVersion: { _value: "V9.0.1" },
      },
      PPP: {
        Interface: {
          1: {
            Username: { _value: "dewi" },
            IPCP: { LocalIPAddress: { _value: "10.10.0.3" } },
          },
        },
      },
    },
  },
];

function genieacs(req, res) {
  const url = new URL(req.url, "http://x");
  const parts = url.pathname.split("/").filter(Boolean);
  if (req.method === "GET" && parts.length === 1 && parts[0] === "devices")
    return json(res, 200, devices);
  if (
    req.method === "POST" &&
    parts.length === 3 &&
    parts[0] === "devices" &&
    parts[2] === "tasks" &&
    url.searchParams.has("connection_request")
  ) {
    req.resume();
    return json(res, 200, { ok: true, taskId: "task-mock-123" });
  }
  notFound(res);
}

// --- Billing ----------------------------------------------------------------
const INVOICES_HTML =
  '<table class="invoices"><tbody><tr><td class="ref">INV-01</td><td class="pppoe">budi</td><td class="status">lunas</td></tr></tbody></table>';

async function billing(req, res) {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/login" && req.method === "GET")
    return html(
      res,
      200,
      `<!doctype html><form method="post" action="/login"><input type="hidden" name="_token" value="${CSRF}"><input name="username"><input name="password" type="password"><button>Masuk</button></form>`,
    );
  if (path === "/login" && req.method === "POST") {
    let form;
    try {
      form = new URLSearchParams(await readBody(req));
    } catch {
      return html(res, 400, "bad request");
    }
    if (
      form.get("_token") !== CSRF ||
      form.get("username") !== USER ||
      form.get("password") !== PASS
    )
      return html(res, 401, "login gagal");
    res.writeHead(302, {
      location: "/invoices?page=1",
      "set-cookie": `session=${SESSION}; Path=/; HttpOnly`,
    });
    return res.end();
  }
  if (path === "/invoices" && req.method === "GET") {
    if (!(req.headers.cookie ?? "").split(/;\s*/).includes(`session=${SESSION}`))
      return html(res, 401, "belum login");
    return html(res, 200, INVOICES_HTML);
  }
  html(res, 404, "not found");
}

function listen(handler, port, host) {
  return new Promise((accept, reject) => {
    const server = createServer((req, res) => {
      Promise.resolve(handler(req, res)).catch(() => {
        if (!res.headersSent) json(res, 500, { error: "internal" });
        else res.end();
      });
    });
    server.once("error", reject);
    server.listen(port, host, () => accept(server));
  });
}

/**
 * Menyalakan semua simulator. `ports` boleh sebagian; port 0 = acak (untuk
 * tes). Mengembalikan port sebenarnya dan `close()`.
 */
export async function startSimulatorLab(ports = {}, host = "127.0.0.1") {
  const want = { ...DEFAULT_PORTS, ...ports };
  const servers = [];
  const actual = {};
  const close = () =>
    Promise.all(
      servers.map(
        (s) =>
          new Promise((done) => {
            s.closeAllConnections?.();
            s.close(() => done());
          }),
      ),
    ).then(() => undefined);
  try {
    for (const [name, handler] of [
      ["mikrotik", mikrotik],
      ["olt", olt],
      ["genieacs", genieacs],
      ["billing", billing],
    ]) {
      const s = await listen(handler, want[name], host);
      servers.push(s);
      actual[name] = s.address().port;
    }
    const simulators = { ...actual };
    const health = await listen(
      (req, res) => {
        if (
          req.method === "GET" &&
          new URL(req.url, "http://x").pathname === "/healthz"
        )
          return json(res, 200, { status: "ok", simulators });
        notFound(res);
      },
      want.health,
      host,
    );
    servers.push(health);
    actual.health = health.address().port;
  } catch (error) {
    await close();
    throw error;
  }
  return { ports: actual, close };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const host = process.env.SIMULATOR_HOST || "127.0.0.1";
  const lab = await startSimulatorLab({}, host);
  console.log(`Simulator lab aktif di ${host}:`, lab.ports);
  const stop = () => lab.close().then(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
