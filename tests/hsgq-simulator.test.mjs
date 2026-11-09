import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { createHsgqSimulator } =
  await import("../src/lib/olt/hsgq-simulator.ts");
const { HsgqClient } = await import("../src/lib/olt/hsgq-client.ts");

const auth = (u = "admin", p = "admin") => ({
  Authorization: `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`,
});

async function withSim(fn) {
  const sim = createHsgqSimulator({ port: 0 });
  await sim.ready;
  try {
    await fn(sim);
  } finally {
    await sim.close();
  }
}

test("lifecycle: start di port ephemeral, /api/v1/system, close", async () => {
  const sim = createHsgqSimulator({ port: 0 });
  await sim.ready;
  assert.ok(sim.port > 0);
  const res = await fetch(`${sim.url}/api/v1/system`, { headers: auth() });
  assert.equal(res.status, 200);
  await sim.close();
  await assert.rejects(fetch(`${sim.url}/api/v1/system`, { headers: auth() }));
});

test("auth: salah 401, benar 200 dengan info model", async () => {
  await withSim(async (sim) => {
    assert.equal((await fetch(`${sim.url}/api/v1/system`)).status, 401);
    assert.equal(
      (
        await fetch(`${sim.url}/api/v1/system`, {
          headers: auth("admin", "salah"),
        })
      ).status,
      401,
    );
    const res = await fetch(`${sim.url}/api/v1/system`, { headers: auth() });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      model: "HSGQ-XPON-8",
      firmware: "V2.1.5",
      uptime: "15d 4h",
      ponPortCount: 8,
    });
  });
});

test("/api/v1/pon: 8 port", async () => {
  await withSim(async (sim) => {
    const ports = await (
      await fetch(`${sim.url}/api/v1/pon`, { headers: auth() })
    ).json();
    assert.equal(ports.length, 8);
    assert.equal(ports[0].capacity, 128);
    assert.equal(ports[0].status, "up");
    assert.equal(ports[0].txPowerDbm, 2.5);
    assert.equal(ports[0].rxPowerDbm, -19);
  });
});

test("/api/v1/onu: 64 ONU, distribusi status, filter ?pon=1", async () => {
  await withSim(async (sim) => {
    const all = await (
      await fetch(`${sim.url}/api/v1/onu`, { headers: auth() })
    ).json();
    assert.equal(all.length, 64);
    const count = (s) => all.filter((o) => o.status === s).length;
    assert.deepEqual(
      [count("online"), count("offline"), count("los")],
      [52, 8, 4],
    );
    for (const o of all) {
      if (o.rxPowerDbm !== null)
        assert.ok(o.rxPowerDbm <= -18 && o.rxPowerDbm >= -31);
    }
    const one = await (
      await fetch(`${sim.url}/api/v1/onu?pon=1`, { headers: auth() })
    ).json();
    assert.equal(one.length, 8);
    assert.ok(
      one.every((o) => o.ponIndex === 1 && o.serialNumber.startsWith("HSGQ1")),
    );
  });
});

test("fault auth-fail -> 401, server-error -> 500, reset memulihkan", async () => {
  await withSim(async (sim) => {
    const post = (path, body) =>
      fetch(`${sim.url}${path}`, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
    await post("/_control/fault", { fault: "auth-fail" });
    assert.equal(
      (await fetch(`${sim.url}/api/v1/system`, { headers: auth() })).status,
      401,
    );
    await post("/_control/fault", { fault: "server-error" });
    assert.equal(
      (await fetch(`${sim.url}/api/v1/system`, { headers: auth() })).status,
      500,
    );
    await post("/_control/reset");
    assert.equal(
      (await fetch(`${sim.url}/api/v1/system`, { headers: auth() })).status,
      200,
    );
    assert.equal(
      (await post("/_control/fault", { fault: "bogus" })).status,
      400,
    );
  });
});

test("fault via header x-fault dan perubahan status ONU", async () => {
  await withSim(async (sim) => {
    const res = await fetch(`${sim.url}/api/v1/system`, {
      headers: { ...auth(), "x-fault": "server-error" },
    });
    assert.equal(res.status, 500);
    sim.injectFault({
      onuStatus: { serialNumber: "HSGQ11", status: "offline" },
    });
    const onus = await (
      await fetch(`${sim.url}/api/v1/onu?pon=1`, { headers: auth() })
    ).json();
    assert.equal(
      onus.find((o) => o.serialNumber === "HSGQ11").status,
      "offline",
    );
  });
});

test("fault timeout: klien dengan timeout pendek gagal", async () => {
  await withSim(async (sim) => {
    sim.injectFault({ fault: "timeout", delayMs: 5000 });
    const client = new HsgqClient({
      host: "127.0.0.1",
      port: sim.port,
      username: "admin",
      password: "admin",
      mode: "real",
      timeoutMs: 200,
    });
    const r = await client.testConnection();
    assert.equal(r.ok, false);
  });
});

test("HsgqClient mode real: testConnection, getPonPorts, getOnus", async () => {
  await withSim(async (sim) => {
    const client = new HsgqClient({
      host: "127.0.0.1",
      port: sim.port,
      username: "admin",
      password: "admin",
      mode: "real",
    });
    const r = await client.testConnection();
    assert.equal(r.ok, true);
    assert.equal(r.data?.model, "HSGQ-XPON-8");
    assert.equal((await client.getPonPorts()).length, 8);
    assert.equal((await client.getOnus(2)).length, 8);

    const bad = new HsgqClient({
      host: "127.0.0.1",
      port: sim.port,
      username: "x",
      password: "y",
      mode: "real",
    });
    const br = await bad.testConnection();
    assert.equal(br.ok, false);
    assert.equal(br.code, "AUTH_FAILED");
  });
});
