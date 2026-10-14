import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkDockerDaemon,
  getBuildCommands,
  getBuildSpecs,
  parseArgs,
  runBuild,
  verifyImage,
} from "../scripts/build-images.mjs";

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const inspect = (config) => ok(JSON.stringify([{ Config: config }]));
const webConfig = { User: "nextjs", ExposedPorts: { "3000/tcp": {} } };
const backendConfig = {
  ExposedPorts: { "8080/tcp": {}, "2055/udp": {}, "514/udp": {} },
};

test("parseArgs defaults and custom flags", () => {
  assert.deepEqual(parseArgs([]), {
    tag: "latest",
    target: "all",
    dryRun: false,
    verify: false,
  });
  assert.deepEqual(
    parseArgs(["--tag", "1.2.0", "--target", "web", "--dry-run", "--verify"]),
    { tag: "1.2.0", target: "web", dryRun: true, verify: true },
  );
});

test("parseArgs rejects bad input", () => {
  assert.throws(() => parseArgs(["--tag"]), /needs a value/);
  assert.throws(() => parseArgs(["--tag", "--dry-run"]), /needs a value/);
  assert.throws(() => parseArgs(["--tag", "bad tag;rm"]), /Invalid tag/);
  assert.throws(() => parseArgs(["--target", "db"]), /Invalid target/);
  assert.throws(() => parseArgs(["--nope"]), /Unknown argument/);
});

test("getBuildSpecs and getBuildCommands", () => {
  const specs = getBuildSpecs({ tag: "t1", target: "all" });
  assert.deepEqual(
    specs.map((s) => [s.image, s.dockerfile, s.context]),
    [
      ["noc-web:t1", "Dockerfile", "."],
      ["noc-backend:t1", "backend/Dockerfile", "backend"],
    ],
  );
  assert.equal(getBuildSpecs({ tag: "x", target: "backend" }).length, 1);

  const cmds = getBuildCommands({ tag: "t1", target: "all" });
  assert.deepEqual(cmds[0].args, [
    "build", "-f", "Dockerfile", "--target", "runner", "-t", "noc-web:t1", ".",
  ]);
  assert.deepEqual(cmds[1].args, [
    "build", "-f", "backend/Dockerfile", "-t", "noc-backend:t1", "backend",
  ]);
});

test("dry-run never calls spawn", async () => {
  const logs = [];
  const spawnFn = () => assert.fail("spawn must not be called");
  const r = await runBuild(parseArgs(["--dry-run"]), {
    spawnFn,
    logFn: (l) => logs.push(l),
  });
  assert.equal(r.ok, true);
  assert.ok(logs.some((l) => l.includes("docker build -f Dockerfile")));
  assert.ok(logs.some((l) => l.includes("noc-backend:latest")));
});

test("missing Docker daemon gives a clear error and builds nothing", async () => {
  const calls = [];
  const spawnFn = async (cmd, args) => {
    calls.push(args[0]);
    return { code: 1, stdout: "", stderr: "cannot connect to daemon" };
  };
  const check = await checkDockerDaemon(spawnFn);
  assert.equal(check.ok, false);
  assert.match(check.error, /Docker daemon tidak tersedia/);
  assert.match(check.error, /cannot connect/);

  calls.length = 0;
  const logs = [];
  const r = await runBuild(parseArgs([]), { spawnFn, logFn: (l) => logs.push(l) });
  assert.equal(r.ok, false);
  assert.deepEqual(calls, ["info"]);
  assert.match(logs[0], /Docker daemon tidak tersedia/);
});

test("verifyImage checks user and ports", async () => {
  assert.deepEqual(
    await verifyImage("noc-web:latest", async () => inspect(webConfig)),
    { ok: true, problems: [] },
  );
  const root = await verifyImage("noc-web:latest", async () =>
    inspect({ User: "", ExposedPorts: { "3000/tcp": {} } }),
  );
  assert.equal(root.ok, false);
  assert.match(root.problems[0], /non-root/);

  const noPort = await verifyImage("noc-backend:latest", async () =>
    inspect({ ExposedPorts: { "8080/tcp": {} } }),
  );
  assert.equal(noPort.ok, false);
  assert.equal(noPort.problems.length, 2);

  assert.equal(
    (await verifyImage("noc-backend:latest", async () => inspect(backendConfig))).ok,
    true,
  );
  const missing = await verifyImage("noc-web:latest", async () => ({
    code: 1, stdout: "", stderr: "No such image",
  }));
  assert.equal(missing.ok, false);
  const garbage = await verifyImage("noc-web:latest", async () => ok("nope"));
  assert.equal(garbage.ok, false);
});

test("runBuild builds then verifies; --verify skips build", async () => {
  const calls = [];
  const spawnFn = async (cmd, args) => {
    calls.push(args.join(" "));
    if (args[0] === "image")
      return inspect(args[2].startsWith("noc-web") ? webConfig : backendConfig);
    return ok();
  };
  const logFn = () => {};
  const built = await runBuild(parseArgs([]), { spawnFn, logFn });
  assert.equal(built.ok, true);
  assert.deepEqual(
    calls.map((c) => c.split(" ")[0]),
    ["info", "build", "build", "image", "image"],
  );

  calls.length = 0;
  const verified = await runBuild(parseArgs(["--verify"]), { spawnFn, logFn });
  assert.equal(verified.ok, true);
  assert.ok(!calls.some((c) => c.startsWith("build")));
});

test("runBuild stops on build failure", async () => {
  const spawnFn = async (cmd, args) =>
    args[0] === "build" ? { code: 2, stdout: "", stderr: "" } : ok();
  const r = await runBuild(parseArgs(["--target", "web"]), {
    spawnFn,
    logFn: () => {},
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /noc-web:latest gagal/);
});
