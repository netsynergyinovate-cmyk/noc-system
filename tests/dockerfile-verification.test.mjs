import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("Dockerfile is multi-stage with deps, builder, runner", () => {
  const d = read("Dockerfile");
  for (const s of ["deps", "builder", "runner"]) {
    assert.match(d, new RegExp(`^FROM .+ AS ${s}$`, "m"));
  }
  assert.match(d, /^CMD \["node", "server\.js"\]$/m);
  assert.match(d, /\.next\/standalone/);
  assert.match(d, /\.next\/static/);
});

test("Dockerfile runs as non-root user", () => {
  const d = read("Dockerfile");
  const users = [...d.matchAll(/^USER (\S+)$/gm)].map((m) => m[1]);
  assert.ok(users.length > 0);
  for (const u of users)
    assert.ok(!["root", "0"].includes(u), `root user: ${u}`);
  assert.ok(users.includes("nextjs"));
});

test(".dockerignore blocks secrets and local state", () => {
  const lines = read(".dockerignore")
    .split(/\r?\n/)
    .map((l) => l.trim());
  for (const e of [
    ".env",
    ".env.*",
    ".git",
    "node_modules",
    ".next",
    "backend/bin",
  ]) {
    assert.ok(lines.includes(e), `missing ${e}`);
  }
});

test("next.config.ts uses standalone output", () => {
  assert.match(read("next.config.ts"), /output:\s*["']standalone["']/);
});
