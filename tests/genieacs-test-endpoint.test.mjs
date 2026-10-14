import assert from "node:assert/strict";
import test from "node:test";
import { testGenieacsSchema } from "../src/validators/cpe.ts";
import {
  buildGenieacsTestConfig,
  runGenieacsTest,
} from "../src/lib/genieacs/test-connection.ts";

test("mode simulator mengembalikan hasil tetap", async () => {
  const config = buildGenieacsTestConfig({ mode: "simulator" }, {});
  assert.deepEqual(await runGenieacsTest(config), {
    ok: true,
    latencyMs: 15,
    deviceCount: 4,
    mode: "simulator",
  });
});

test("tanpa input memakai config env (default simulator)", async () => {
  const r = await runGenieacsTest(buildGenieacsTestConfig({}, {}));
  assert.equal(r.mode, "simulator");
  assert.equal(r.ok, true);
});

test("input host membuat config real tanpa kredensial tertanam", () => {
  const c = buildGenieacsTestConfig(
    { host: "http://u:p@10.0.0.5", port: 7557, username: "admin", password: "rahasia" },
    {},
  );
  assert.equal(c.mode, "real");
  assert.equal(c.url, "http://10.0.0.5:7557");
  assert.ok(c.authHeader?.startsWith("Basic "));
});

test("host non-http ditolak; mode real tanpa host ditolak", () => {
  assert.throws(() => buildGenieacsTestConfig({ host: "ftp://h" }, {}));
  assert.throws(() => buildGenieacsTestConfig({ mode: "real" }, {}));
});

test("validasi: port di luar 1-65535 ditolak", () => {
  for (const port of [0, 65536, -1, 1.5]) {
    assert.equal(testGenieacsSchema.safeParse({ port }).success, false, String(port));
  }
  assert.equal(testGenieacsSchema.safeParse({ port: 1 }).success, true);
  assert.equal(testGenieacsSchema.safeParse({ port: 65535 }).success, true);
  assert.equal(testGenieacsSchema.safeParse({}).success, true);
  assert.equal(testGenieacsSchema.safeParse({ mode: "x" }).success, false);
  assert.equal(testGenieacsSchema.safeParse({ extra: 1 }).success, false);
});

test("error tidak membocorkan kata sandi", async () => {
  const password = "S3cr3tP@ss";
  const config = buildGenieacsTestConfig(
    { host: "10.0.0.5", port: 7557, username: "admin", password },
    {},
  );
  const basic = config.authHeader.replace("Basic ", "");
  const leaky = async () => {
    throw new Error(`connect failed ${password} ${config.authHeader} ${basic} http://admin:${password}@10.0.0.5`);
  };
  const r = await runGenieacsTest(config, leaky);
  assert.equal(r.ok, false);
  assert.equal(r.mode, "real");
  const dump = JSON.stringify(r);
  assert.ok(!dump.includes(password));
  assert.ok(!dump.includes(basic));
});
