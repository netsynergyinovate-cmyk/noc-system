// Build and verify the production Docker images (noc-web, noc-backend).
//
//   npm run image:build                       build both, tag latest
//   node scripts/build-images.mjs --tag 1.2.0 --target web
//   npm run image:verify                      inspect existing images only
//   node scripts/build-images.mjs --dry-run   print commands, run nothing
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TARGETS = ["web", "backend", "all"];
const TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

export function parseArgs(argv = []) {
  const options = { tag: "latest", target: "all", dryRun: false, verify: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--verify") options.verify = true;
    else if (arg === "--tag" || arg === "--target") {
      const value = argv[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`${arg} needs a value.`);
      if (arg === "--tag") {
        if (!TAG_PATTERN.test(value))
          throw new Error(`Invalid tag "${value}".`);
        options.tag = value;
      } else {
        if (!TARGETS.includes(value))
          throw new Error(
            `Invalid target "${value}". Use ${TARGETS.join(", ")}.`,
          );
        options.target = value;
      }
    } else throw new Error(`Unknown argument "${arg}".`);
  }
  return options;
}

export function getBuildSpecs({ tag = "latest", target = "all" } = {}) {
  const specs = [
    {
      name: "web",
      image: `noc-web:${tag}`,
      dockerfile: "Dockerfile",
      context: ".",
      // Root Dockerfile also has a migrator stage; the app is the runner.
      stage: "runner",
      expectUser: "nextjs",
      expectPorts: ["3000/tcp"],
    },
    {
      name: "backend",
      image: `noc-backend:${tag}`,
      dockerfile: "backend/Dockerfile",
      context: "backend",
      stage: null,
      expectUser: null, // backend Dockerfile has no USER yet
      expectPorts: ["8080/tcp", "2055/udp", "514/udp"],
    },
  ];
  return target === "all" ? specs : specs.filter((s) => s.name === target);
}

export function getBuildCommands(options) {
  return getBuildSpecs(options).map((s) => ({
    spec: s,
    command: "docker",
    args: [
      "build",
      "-f",
      s.dockerfile,
      ...(s.stage ? ["--target", s.stage] : []),
      "-t",
      s.image,
      s.context,
    ],
  }));
}

// spawnFn(command, args) -> Promise<{ code, stdout, stderr }>
export function defaultSpawn(command, args, { inherit = false } = {}) {
  return new Promise((accept) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: root,
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (c) => (stdout += c));
    child.stderr?.on("data", (c) => (stderr += c));
    child.once("error", (e) => accept({ code: null, stdout, stderr: e.message }));
    child.once("close", (code) => accept({ code, stdout, stderr }));
  });
}

export async function checkDockerDaemon(spawnFn = defaultSpawn) {
  const r = await spawnFn("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (r.code === 0) return { ok: true };
  const detail = (r.stderr || r.stdout || "").trim();
  return {
    ok: false,
    error:
      "Docker daemon tidak tersedia. Pastikan Docker terpasang dan berjalan." +
      (detail ? ` (${detail})` : ""),
  };
}

export async function verifyImage(imageName, spawnFn = defaultSpawn) {
  const spec = getBuildSpecs({ tag: "x" }).find(
    (s) => s.image.split(":")[0] === imageName.split(":")[0],
  );
  const problems = [];
  const r = await spawnFn("docker", ["image", "inspect", imageName]);
  if (r.code !== 0)
    return {
      ok: false,
      problems: [
        `Image ${imageName} tidak ditemukan: ${(r.stderr || "").trim()}`.trim(),
      ],
    };
  let config;
  try {
    config = JSON.parse(r.stdout)[0].Config ?? {};
  } catch {
    return { ok: false, problems: [`Output inspect ${imageName} tidak valid.`] };
  }
  if (!spec) return { ok: true, problems };
  if (spec.expectUser) {
    const user = String(config.User ?? "");
    if (user !== spec.expectUser)
      problems.push(
        `User harus "${spec.expectUser}" (non-root), ditemukan "${user || "root"}".`,
      );
  }
  const ports = Object.keys(config.ExposedPorts ?? {});
  for (const p of spec.expectPorts)
    if (!ports.includes(p)) problems.push(`Port ${p} tidak di-EXPOSE.`);
  return { ok: problems.length === 0, problems };
}

export async function runBuild(
  options,
  { spawnFn = defaultSpawn, logFn = console.log } = {},
) {
  const commands = getBuildCommands(options);
  const show = (c) => `${c.command} ${c.args.join(" ")}`;
  const doBuild = !options.verify;

  if (options.dryRun) {
    logFn("[dry-run] tidak ada perintah yang dijalankan.");
    if (doBuild) for (const c of commands) logFn(`[dry-run] ${show(c)}`);
    else
      for (const c of commands)
        logFn(`[dry-run] docker image inspect ${c.spec.image}`);
    return { ok: true, dryRun: true };
  }

  const daemon = await checkDockerDaemon(spawnFn);
  if (!daemon.ok) {
    logFn(daemon.error);
    return { ok: false, error: daemon.error };
  }

  if (doBuild)
    for (const c of commands) {
      logFn(`Build ${c.spec.image}`);
      const r = await spawnFn(c.command, c.args, { inherit: true });
      if (r.code !== 0) {
        const error = `Build ${c.spec.image} gagal (kode ${r.code}).`;
        logFn(error);
        return { ok: false, error };
      }
    }

  // Always verify what we just built; --verify alone verifies existing images.
  const failures = [];
  for (const c of commands) {
    const v = await verifyImage(c.spec.image, spawnFn);
    if (v.ok) logFn(`OK ${c.spec.image}`);
    else {
      logFn(`GAGAL ${c.spec.image}`);
      for (const p of v.problems) logFn(`  - ${p}`);
      failures.push(c.spec.image);
    }
  }
  return failures.length
    ? { ok: false, error: `Verifikasi gagal: ${failures.join(", ")}` }
    : { ok: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runBuild(parseArgs(process.argv.slice(2)));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
