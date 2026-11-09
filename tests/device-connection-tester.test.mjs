import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { testDeviceConnection, parseTarget } =
  await import("../src/services/device-connection-tester.ts");
const { formatDeviceError, applyTestOutcome } =
  await import("../src/lib/dashboard/device-config.ts");

const TYPES = ["mikrotik", "olt", "genieacs", "billing"];
const req = (o = {}) => ({
  type: "mikrotik",
  host: "10.0.0.5",
  port: 80,
  username: "admin",
  password: "pw",
  mode: "simulator",
  ...o,
});
const res =
  (status, body = "{}") =>
  async () =>
    new Response(body, { status });

test("simulator: 4 tipe sukses dengan struktur lengkap", async () => {
  const endpoints = {
    mikrotik: "/rest/system/resource",
    olt: "/api/v1/system",
    genieacs: "/devices",
    billing: "/login",
  };
  for (const type of TYPES) {
    const r = await testDeviceConnection(req({ type }));
    assert.equal(r.ok, true, type);
    assert.equal(r.status, "connected");
    assert.equal(r.code, "OK");
    assert.ok(r.latencyMs > 0);
    assert.ok(r.endpointTested.endsWith(endpoints[type]), r.endpointTested);
    assert.ok(Number.isInteger(r.timestamp) && r.timestamp > 1_700_000_000);
    assert.ok(r.message && r.data);
  }
});

test("simulator: OLT port 23 = TELNET handshake", async () => {
  const r = await testDeviceConnection(req({ type: "olt", port: 23 }));
  assert.equal(r.ok, true);
  assert.match(r.endpointTested, /^TELNET handshake/);
});

test("simulator: timeout, auth gagal, ditolak", async () => {
  const to = await testDeviceConnection(req({ host: "10.0.0.0" }));
  assert.deepEqual(
    [to.ok, to.status, to.code, to.latencyMs],
    [false, "timeout", "TIMEOUT", 8000],
  );

  const a1 = await testDeviceConnection(req({ host: "10.0.0.255" }));
  assert.deepEqual(
    [a1.ok, a1.code, a1.statusCode],
    [false, "AUTH_FAILED", 401],
  );
  const a2 = await testDeviceConnection(req({ username: "bad-user" }));
  assert.deepEqual(
    [a2.ok, a2.code, a2.statusCode],
    [false, "AUTH_FAILED", 401],
  );

  for (const port of [9999, 0]) {
    const c = await testDeviceConnection(req({ port }));
    assert.deepEqual(
      [c.ok, c.code],
      [false, "CONNECTION_REFUSED"],
      String(port),
    );
  }
});

test("port tidak valid ditolak (simulator dan real)", async () => {
  for (const port of [65536, -1, 1.5, NaN, 70000]) {
    for (const mode of ["simulator", "real"]) {
      let called = false;
      const r = await testDeviceConnection(req({ port, mode }), {
        fetchImpl: async () => ((called = true), new Response("{}")),
      });
      assert.equal(r.code, "INVALID_PORT", `${port}/${mode}`);
      assert.equal(r.ok, false);
      assert.equal(called, false);
    }
  }
  const zeroReal = await testDeviceConnection(req({ port: 0, mode: "real" }));
  assert.equal(zeroReal.code, "INVALID_PORT");
});

test("host SSRF/injeksi ditolak tanpa panggilan jaringan", async () => {
  const bad = [
    "",
    "10.0.0.1/admin",
    "http://u:p@10.0.0.1",
    "10.0.0.1?x=1",
    "10.0.0.1#a",
    "ftp://10.0.0.1",
    "file:///etc/passwd",
    "10.0.0.1; rm -rf /",
    "10.0.0.1 evil.com",
    "evil.com@10.0.0.1",
    "169.254.169.254",
    "999.1.1.1",
    "1.2.3",
    "[::1]",
    "a\r\nHost: x",
    "-bad.example.com",
    "metadata.google.internal",
  ];
  for (const host of bad) {
    for (const mode of ["simulator", "real"]) {
      let called = false;
      const r = await testDeviceConnection(req({ host, mode }), {
        fetchImpl: async () => ((called = true), new Response("{}")),
      });
      assert.equal(r.code, "INVALID_HOST", JSON.stringify(host));
      assert.equal(r.ok, false);
      assert.equal(called, false);
    }
  }
  assert.deepEqual(parseTarget("https://Router.Local:8443/"), {
    host: "router.local",
    port: 8443,
    useTls: true,
  });
  assert.deepEqual(parseTarget("10.0.0.1"), {
    host: "10.0.0.1",
    port: undefined,
    useTls: undefined,
  });
});

test("kompatibel dengan formatDeviceError dan applyTestOutcome", async () => {
  const device = {
    host: "10.0.0.5",
    port: 80,
    username: "admin",
    type: "mikrotik",
    envPassKey: "X_PASS",
  };
  const cases = [
    [req({ host: "10.0.0.0" }), "Batas Waktu"],
    [req({ username: "bad-user" }), "Autentikasi Gagal"],
    [req({ port: 9999 }), "Koneksi Ditolak"],
    [req({ port: 70000 }), "Port Tidak Valid"],
    [req({ host: "a/b" }), "Koneksi Gagal"],
  ];
  for (const [input, title] of cases) {
    const r = await testDeviceConnection(input);
    const f = formatDeviceError(r, device);
    assert.match(f.title, new RegExp(title), r.code);
    assert.ok(f.detail && f.suggestion);
  }
  const ok = await testDeviceConnection(req());
  const next = applyTestOutcome(
    { id: "1", status: "untested", latencyMs: null },
    ok,
    123,
  );
  assert.equal(next.status, "connected");
  assert.equal(next.latencyMs, ok.latencyMs);
});

test("real: sukses 200 untuk 4 tipe, basic auth dan redirect manual", async () => {
  const bodies = {
    mikrotik: JSON.stringify({
      version: "7.14",
      "cpu-load": "5",
      uptime: "1d",
      "board-name": "RB",
    }),
    olt: "{}",
    genieacs: JSON.stringify([{ _id: "a" }, { _id: "b" }]),
    billing: '<form><input name="_token" value="x"></form>',
  };
  for (const type of TYPES) {
    let seen;
    const r = await testDeviceConnection(req({ type, mode: "real" }), {
      fetchImpl: async (url, init) => (
        (seen = { url, init }),
        new Response(bodies[type], { status: 200 })
      ),
    });
    assert.equal(r.ok, true, type);
    assert.equal(r.code, "OK");
    assert.equal(r.statusCode, 200);
    assert.ok(r.latencyMs >= 1);
    assert.equal(seen.init.redirect, "manual");
    assert.ok(seen.init.signal instanceof AbortSignal);
    assert.equal(
      seen.init.headers.Authorization,
      `Basic ${Buffer.from("admin:pw").toString("base64")}`,
    );
  }
  const m = await testDeviceConnection(req({ mode: "real" }), {
    fetchImpl: res(200, bodies.mikrotik),
  });
  assert.equal(m.data.version, "7.14");
  assert.equal(m.data.cpuLoad, 5);
  const g = await testDeviceConnection(
    req({ type: "genieacs", port: 7557, mode: "real" }),
    { fetchImpl: res(200, bodies.genieacs) },
  );
  assert.equal(g.data.deviceCount, 2);
  assert.match(g.endpointTested, /:7557\/devices$/);
  const b = await testDeviceConnection(req({ type: "billing", mode: "real" }), {
    fetchImpl: res(200, bodies.billing),
  });
  assert.equal(b.data.csrf, true);
});

test("real: 401/403, 500, 404 mikrotik", async () => {
  for (const s of [401, 403]) {
    const r = await testDeviceConnection(req({ mode: "real" }), {
      fetchImpl: res(s),
    });
    assert.deepEqual([r.ok, r.code, r.statusCode], [false, "AUTH_FAILED", s]);
  }
  const e = await testDeviceConnection(req({ mode: "real" }), {
    fetchImpl: res(500),
  });
  assert.deepEqual(
    [e.ok, e.status, e.code, e.statusCode],
    [false, "error", "HTTP_ERROR", 500],
  );
  const n = await testDeviceConnection(req({ mode: "real" }), {
    fetchImpl: res(404),
  });
  assert.equal(n.code, "HTTP_ERROR");
  const o = await testDeviceConnection(req({ type: "olt", mode: "real" }), {
    fetchImpl: res(503),
  });
  assert.equal(o.code, "HTTP_ERROR");
  const f = formatDeviceError(e, {
    host: "h",
    port: 80,
    username: "u",
    type: "mikrotik",
    envPassKey: "K",
  });
  assert.equal(f.title, "Galat HTTP 500");
});

test("real: abort/timeout, ECONNREFUSED, ENOTFOUND, password tidak bocor", async () => {
  const abort = async () => {
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  };
  const t = await testDeviceConnection(req({ mode: "real" }), {
    fetchImpl: abort,
    timeoutMs: 50,
  });
  assert.deepEqual(
    [t.ok, t.status, t.code, t.latencyMs],
    [false, "timeout", "TIMEOUT", 50],
  );

  // timeout nyata: fetch yang menunggu signal
  const hang = (_u, init) =>
    new Promise((_, reject) =>
      init.signal.addEventListener("abort", () => reject(init.signal.reason)),
    );
  const real = await testDeviceConnection(req({ mode: "real" }), {
    fetchImpl: hang,
    timeoutMs: 30,
  });
  assert.equal(real.code, "TIMEOUT");

  const refused = await testDeviceConnection(req({ mode: "real" }), {
    fetchImpl: async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNREFUSED" },
      });
    },
  });
  assert.equal(refused.code, "CONNECTION_REFUSED");

  const dns = await testDeviceConnection(
    req({ host: "nope.invalid", mode: "real" }),
    {
      fetchImpl: async () => {
        throw Object.assign(new TypeError("fetch failed"), {
          cause: { code: "ENOTFOUND" },
        });
      },
    },
  );
  assert.equal(dns.code, "DNS_ERROR");

  const leak = await testDeviceConnection(
    req({ password: "s3cret-pw", mode: "real" }),
    {
      fetchImpl: async () => {
        throw new Error("boom s3cret-pw");
      },
    },
  );
  assert.equal(leak.code, "HTTP_ERROR");
  assert.ok(!JSON.stringify(leak).includes("s3cret-pw"));
});
