import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startSimulatorLab } from "../scripts/simulator-lab.mjs";

const basic = "Basic " + Buffer.from("admin:admin").toString("base64");
let lab;
let url;

before(async () => {
  lab = await startSimulatorLab({
    health: 0,
    mikrotik: 0,
    olt: 0,
    billing: 0,
    genieacs: 0,
  });
  url = (name, path) => `http://127.0.0.1:${lab.ports[name]}${path}`;
});
after(() => lab.close());

describe("simulator lab", () => {
  it("MikroTik: auth dan data", async () => {
    assert.equal((await fetch(url("mikrotik", "/rest/system/resource"))).status, 401);
    const get = (p) => fetch(url("mikrotik", p), { headers: { authorization: basic } });
    const res = await (await get("/rest/system/resource")).json();
    assert.equal(res["cpu-load"], 15);
    assert.equal(res["board-name"], "CCR2004-1G-12S+2XS");
    assert.ok(Array.isArray(await (await get("/rest/queue/simple")).json()));
    assert.ok(Array.isArray(await (await get("/rest/ppp/active")).json()));
    assert.equal((await get("/rest/nope")).status, 404);
  });

  it("OLT: sistem, 8 PON, ONU", async () => {
    assert.equal((await fetch(url("olt", "/api/v1/system"))).status, 401);
    const get = (p) => fetch(url("olt", p), { headers: { authorization: basic } });
    assert.deepEqual(await (await get("/api/v1/system")).json(), {
      model: "HSGQ-G08",
      pon_ports: 8,
      firmware: "V2.5.4",
    });
    assert.equal((await (await get("/api/v1/pon")).json()).length, 8);
    const onu = await (await get("/api/v1/onu")).json();
    assert.ok(onu.every((o) => "rx_power" in o));
  });

  it("GenieACS: devices dan connection request", async () => {
    const list = await (await fetch(url("genieacs", "/devices/?query=%7B%7D"))).json();
    assert.ok(list.some((d) => d.InternetGatewayDevice));
    assert.ok(list.some((d) => d.Device));
    const res = await fetch(
      url("genieacs", "/devices/202BC1-BM632w-000001/tasks?connection_request"),
      { method: "POST", body: JSON.stringify({ name: "reboot" }) },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, taskId: "task-mock-123" });
  });

  it("Billing: login CSRF, cookie, invoices", async () => {
    const page = await (await fetch(url("billing", "/login"))).text();
    assert.match(page, /name="_token" value="csrf-lab-token-123"/);
    const post = (body) =>
      fetch(url("billing", "/login"), {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    assert.equal((await post("_token=salah&username=admin&password=admin")).status, 401);
    assert.equal(
      (await post("_token=csrf-lab-token-123&username=admin&password=x")).status,
      401,
    );
    const ok = await post("_token=csrf-lab-token-123&username=admin&password=admin");
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get("location"), "/invoices?page=1");
    assert.match(ok.headers.get("set-cookie"), /session=sess_lab_ok/);
    assert.equal((await fetch(url("billing", "/invoices"))).status, 401);
    const inv = await fetch(url("billing", "/invoices?page=1"), {
      headers: { cookie: "session=sess_lab_ok" },
    });
    assert.match(await inv.text(), /<td class="pppoe">budi<\/td>/);
  });

  it("healthz melaporkan port", async () => {
    const res = await fetch(url("health", "/healthz"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      status: "ok",
      simulators: {
        mikrotik: lab.ports.mikrotik,
        olt: lab.ports.olt,
        genieacs: lab.ports.genieacs,
        billing: lab.ports.billing,
      },
    });
  });
});
