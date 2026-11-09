import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  parseFourPartVersion,
  formatFourPartVersion,
  bumpMinorVersion,
  bumpBuildVersion,
  getAppDisplayVersion,
  DEFAULT_APP_VERSION,
} from "../src/lib/app-version.ts";

test("parseFourPartVersion: mem-parsing format 4-digit", () => {
  assert.deepEqual(parseFourPartVersion("1.0.0.0"), [1, 0, 0, 0]);
  assert.deepEqual(parseFourPartVersion("v1.2.3.4"), [1, 2, 3, 4]);
  assert.deepEqual(parseFourPartVersion("1.2.3.4+abcdef"), [1, 2, 3, 4]);
  assert.deepEqual(parseFourPartVersion("2.5"), [2, 5, 0, 0]);
  assert.deepEqual(parseFourPartVersion(""), [1, 0, 0, 0]);
  assert.deepEqual(parseFourPartVersion(null), [1, 0, 0, 0]);
  assert.deepEqual(parseFourPartVersion("invalid"), [0, 0, 0, 0]);
});

test("formatFourPartVersion: menggabungkan 4 part menjadi string", () => {
  assert.equal(formatFourPartVersion([1, 0, 0, 0]), "1.0.0.0");
  assert.equal(formatFourPartVersion([1, 2, 3, 4]), "1.2.3.4");
});

test("bumpMinorVersion: menaikkan minor dan me-reset patch & build ke 0", () => {
  assert.equal(bumpMinorVersion("1.0.0.0"), "1.1.0.0");
  assert.equal(bumpMinorVersion("1.0.0.8"), "1.1.0.0");
  assert.equal(bumpMinorVersion("1.2.3.4"), "1.3.0.0");
  assert.equal(bumpMinorVersion("1.9.0.0"), "1.10.0.0");
});

test("bumpBuildVersion: menaikkan build +1", () => {
  assert.equal(bumpBuildVersion("1.0.0.0"), "1.0.0.1");
  assert.equal(bumpBuildVersion("1.0.0.1"), "1.0.0.2");
  assert.equal(bumpBuildVersion("1.1.0.0"), "1.1.0.1");
  assert.equal(bumpBuildVersion("1.2.3.9"), "1.2.3.10");
});

test("getAppDisplayVersion: membaca versi package.json atau environment", () => {
  const originalEnv = process.env.APP_VERSION;
  try {
    process.env.APP_VERSION = "1.5.2.3";
    assert.equal(getAppDisplayVersion(), "1.5.2.3");
  } finally {
    if (originalEnv !== undefined) {
      process.env.APP_VERSION = originalEnv;
    } else {
      delete process.env.APP_VERSION;
    }
  }

  // Tanpa env APP_VERSION, membaca package.json ("1.0.0.0")
  const v = getAppDisplayVersion();
  assert.equal(v, "1.0.0.0");
});

test("CLI noc-system: perintah version menghasilkan output versi 1.0.0.0", async () => {
  const { execSync } = await import("node:child_process");
  const output = execSync("node bin/noc-system.mjs version", {
    encoding: "utf-8",
  });
  assert.ok(output.includes("Versi lokal (package.json):"));
  assert.ok(output.includes("1.0.0.0"));
});

test("deploy-version.service: getAppVersion mengembalikan 4-digit semver dan fullVersion", async () => {
  const { getAppVersion } =
    await import("../src/services/deploy-version.service.ts");
  const versionInfo = await getAppVersion();
  assert.equal(versionInfo.semver, "1.0.0.0");
  assert.equal(versionInfo.fullVersion, "1.0.0.0");
  assert.ok(typeof versionInfo.commitHash === "string");
});

test("Simulasi auto-bump build: menaikkan build berdasarkan rilis sebelumnya", () => {
  // Algoritma bump build rilis
  function computeNextRelease(baseVersion, existingReleases = []) {
    const [major, minor, patch, baseBuild] = parseFourPartVersion(baseVersion);
    const prefix = `${major}.${minor}.${patch}.`;
    let maxBuild = -1;
    for (const rel of existingReleases) {
      if (rel.startsWith(prefix)) {
        const parts = parseFourPartVersion(rel);
        if (parts[0] === major && parts[1] === minor && parts[2] === patch) {
          if (parts[3] > maxBuild) maxBuild = parts[3];
        }
      }
    }
    if (maxBuild >= 0) {
      return formatFourPartVersion([major, minor, patch, maxBuild + 1]);
    }
    return formatFourPartVersion([major, minor, patch, baseBuild]);
  }

  // Belum ada rilis
  assert.equal(computeNextRelease("1.0.0.0", []), "1.0.0.0");

  // Ada rilis 1.0.0.0 -> naik ke 1.0.0.1
  assert.equal(computeNextRelease("1.0.0.0", ["1.0.0.0"]), "1.0.0.1");

  // Ada rilis 1.0.0.0 dan 1.0.0.1 -> naik ke 1.0.0.2
  assert.equal(
    computeNextRelease("1.0.0.0", ["1.0.0.0", "1.0.0.1"]),
    "1.0.0.2",
  );

  // Setelah upgrade minor ke 1.1.0.0 (rilis lama masih 1.0.0.x) -> rilis baru mulai di 1.1.0.0
  assert.equal(
    computeNextRelease("1.1.0.0", ["1.0.0.0", "1.0.0.1", "1.0.0.2"]),
    "1.1.0.0",
  );

  // Rilis kedua pada 1.1.0.0 -> naik ke 1.1.0.1
  assert.equal(
    computeNextRelease("1.1.0.0", ["1.0.0.0", "1.0.0.1", "1.1.0.0"]),
    "1.1.0.1",
  );
});
