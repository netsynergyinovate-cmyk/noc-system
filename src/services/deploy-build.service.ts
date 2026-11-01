import os from "os";
import { exec } from "child_process";
import { mkdir, rm, stat, copyFile, cp, writeFile } from "fs/promises";
import { resolve, join } from "path";
import { existsSync, createReadStream } from "fs";
import { Client, type ConnectConfig } from "ssh2";
import type { DeployTarget } from "@/db/schema/deploy-targets";
import type { DecryptedSshCredential } from "./ssh-credentials.service";
import { executeSshCommand } from "./ssh-client.service";

export interface BuildResult {
  tarPath: string;
  sizeBytes: number;
  durationMs: number;
}

function runCommand(cmd: string, cwd: string, envOverrides: Record<string, string> = {}): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  exec(
    cmd,
    {
      cwd,
      env: { ...process.env, ...envOverrides },
      maxBuffer: 10 * 1024 * 1024,
    },
    (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Command failed: ${cmd}\n${stderr || stdout}`));
      } else {
        resolve(stdout);
      }
    },
  );
  return promise;
}

/**
 * Membangun artefak rilis native lengkap:
 * 1. Kompilasi binary backend Go untuk target linux/amd64 (SERVER NATIVE Ubuntu).
 * 2. Next.js standalone build (.next/standalone + static + public).
 * 3. Skrip migrasi skema (scripts/migrate-server.mjs + drizzle/).
 * 4. Pemaketan ke dalam tarball tar.gz.
 */
export async function buildReleaseBundle(
  version: string,
  onLog?: (msg: string) => void,
): Promise<BuildResult> {
  const startTime = Date.now();
  const rootDir = process.cwd();
  const cacheDir = resolve(os.tmpdir(), "noc-deploy-cache");
  const distDir = resolve(cacheDir, version);
  const tarPath = resolve(cacheDir, `release-${version.replace(/[^a-zA-Z0-9._-]/g, "_")}.tar.gz`);

  onLog?.(`Menyiapkan direktori build: ${distDir}`);
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  // 1. Dapatkan / build binary Go backend untuk linux/amd64
  const goOutput = resolve(distDir, "noc-backend");
  const prebuiltGo = resolve(rootDir, "noc-backend");
  if (existsSync(prebuiltGo)) {
    onLog?.("Menyalin biner Go noc-backend linux/amd64 yang sudah terkompilasi...");
    await copyFile(prebuiltGo, goOutput);
  } else {
    onLog?.("Mengompilasi backend Go untuk target linux/amd64...");
    const backendDir = resolve(rootDir, "backend");
    await runCommand(
      `go build -ldflags="-s -w" -o "${goOutput}" ./cmd/server`,
      backendDir,
      { GOOS: "linux", GOARCH: "amd64", CGO_ENABLED: "0" },
    );
    onLog?.("Binary Go noc-backend linux/amd64 berhasil dikompilasi.");
  }

  // 2. Next.js Standalone Build
  const isPrebuiltContainer =
    process.env.NOC_PREBUILT_RELEASE === "1" ||
    (existsSync(resolve(rootDir, "server.js")) && existsSync(resolve(rootDir, "noc-backend")));
  if (isPrebuiltContainer) {
    onLog?.("Menyalin artefak Next.js standalone dari kontainer lokal...");
    await cp(resolve(rootDir, "server.js"), resolve(distDir, "server.js"));
    if (existsSync(resolve(rootDir, "package.json"))) {
      await copyFile(resolve(rootDir, "package.json"), resolve(distDir, "package.json"));
    }
    if (existsSync(resolve(rootDir, "node_modules"))) {
      await cp(resolve(rootDir, "node_modules"), resolve(distDir, "node_modules"), {
        recursive: true,
      });
    }
    if (existsSync(resolve(rootDir, ".next"))) {
      await cp(resolve(rootDir, ".next"), resolve(distDir, ".next"), { recursive: true });
    }
  } else {
    onLog?.("Membangun frontend Next.js standalone...");
    // Selalu build ulang agar artefak rilis mencerminkan kode terbaru
    await runCommand("npm run build", rootDir, { NEXT_TELEMETRY_DISABLED: "1" });
    const standaloneDir = resolve(rootDir, ".next", "standalone");
    await cp(standaloneDir, distDir, { recursive: true });
  }
  // Salin .next/static ke .next/standalone/.next/static bila belum ada
  const srcStatic = resolve(rootDir, ".next", "static");
  const destStatic = resolve(distDir, ".next", "static");
  if (existsSync(srcStatic)) {
    await mkdir(resolve(distDir, ".next"), { recursive: true });
    await cp(srcStatic, destStatic, { recursive: true });
  }

  // Salin public folder
  const srcPublic = resolve(rootDir, "public");
  const destPublic = resolve(distDir, "public");
  if (existsSync(srcPublic)) {
    await cp(srcPublic, destPublic, { recursive: true });
  }

  // 3. Salin folder scripts dan folder drizzle
  onLog?.("Menyalin skrip migrasi dan folder drizzle...");
  const destScripts = resolve(distDir, "scripts");
  const srcScripts = resolve(rootDir, "scripts");
  if (existsSync(srcScripts)) {
    await cp(srcScripts, destScripts, { recursive: true });
  } else {
    await mkdir(destScripts, { recursive: true });
  }
  const destDrizzle = resolve(distDir, "drizzle");
  await cp(resolve(rootDir, "drizzle"), destDrizzle, { recursive: true });

  const srcSystemd = resolve(rootDir, "systemd");
  if (existsSync(srcSystemd)) {
    await cp(srcSystemd, resolve(distDir, "systemd"), { recursive: true });
  }

  // 4. Pasang package shim untuk chunk external Turbopack (mis. pg-<hash>, ssh2-<hash>)
  onLog?.("Menyiapkan shim paket eksternal Turbopack...");
  const shimPackages = [
    { name: "pg-587764f78a6c7a9c", target: "pg" },
    { name: "ssh2-f3b551c9be6f736f", target: "ssh2" },
  ];
  for (const shim of shimPackages) {
    const sDir = resolve(distDir, "node_modules", shim.name);
    await mkdir(sDir, { recursive: true });
    await writeFile(
      resolve(sDir, "package.json"),
      JSON.stringify({
        name: shim.name,
        main: "./index.js",
        module: "./index.mjs",
        exports: {
          ".": {
            import: "./index.mjs",
            require: "./index.js",
            default: "./index.js",
          },
        },
      }),
    );
    await writeFile(
      resolve(sDir, "index.js"),
      `module.exports = require("${shim.target}");\n`,
    );
    await writeFile(
      resolve(sDir, "index.mjs"),
      `export * from "${shim.target}";\nimport pkg from "${shim.target}";\nexport default pkg;\n`,
    );
  }

  // 5. Kompresi ke dalam release.tar.gz
  onLog?.("Mengompresi bundle rilis menjadi tar.gz...");
  await mkdir(cacheDir, { recursive: true });

  // Gunakan tar sistem (Windows 10/11 dan Linux sama-sama memiliki binary tar bawaan)
  await runCommand(
    `tar -czf "${tarPath}" -C "${distDir}" .`,
    cacheDir,
  );

  const fileStat = await stat(tarPath);
  const durationMs = Date.now() - startTime;
  onLog?.(`Paket rilis selesai (${(fileStat.size / 1024 / 1024).toFixed(2)} MB, ${durationMs}ms).`);

  return {
    tarPath,
    sizeBytes: fileStat.size,
    durationMs,
  };
}

/**
 * Mengunggah berkas rilis via SFTP ke SERVER NATIVE.
 */
export async function uploadReleaseFile(
  target: DeployTarget,
  credential: DecryptedSshCredential,
  localFilePath: string,
  remoteFilePath: string,
  effectiveHost?: string,
  onLog?: (msg: string) => void,
): Promise<void> {
  const host = effectiveHost || target.host;
  const { promise, resolve: resolveAll, reject: rejectAll } = Promise.withResolvers<void>();

  const conn = new Client();
  let settled = false;

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      try { conn.end(); } catch {}
      rejectAll(new Error("Unggahan SFTP melebihi batas waktu (timeout 5 menit)."));
    }
  }, 300000);

  const cleanupAndEnd = () => {
    clearTimeout(timer);
    if (!settled) {
      settled = true;
      try { conn.end(); } catch {}
    }
  };

  conn.on("ready", () => {
    onLog?.(`Membuka sesi SFTP ke ${target.sshUser}@${host}...`);
    conn.sftp((err, sftp) => {
      if (err) {
        cleanupAndEnd();
        return rejectAll(new Error(`Gagal membuka SFTP: ${err.message}`));
      }

      onLog?.(`Mengunggah paket rilis ke ${remoteFilePath}...`);
      const readStream = createReadStream(localFilePath);
      const writeStream = sftp.createWriteStream(remoteFilePath);

      writeStream.on("close", () => {
        cleanupAndEnd();
        resolveAll();
      });

      writeStream.on("error", (e: Error) => {
        cleanupAndEnd();
        rejectAll(new Error(`Gagal mengunggah file via SFTP: ${e.message}`));
      });

      readStream.on("error", (e: Error) => {
        cleanupAndEnd();
        rejectAll(new Error(`Gagal membaca berkas lokal: ${e.message}`));
      });

      readStream.pipe(writeStream);
    });
  });

  conn.on("error", (err) => {
    cleanupAndEnd();
    rejectAll(new Error(`Koneksi SSH untuk SFTP gagal: ${err.message}`));
  });

  if (credential.password) {
    conn.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => credential.password || ""));
    });
  }

  const connectConfig: ConnectConfig = {
    host,
    port: target.port,
    username: target.sshUser,
    privateKey: credential.privateKey,
    passphrase: credential.passphrase,
    password: credential.password,
    tryKeyboard: Boolean(credential.password),
    readyTimeout: 15000,
  };

  conn.connect(connectConfig);
  return promise;
}

/**
 * Mengunggah berkas rilis via SFTP ke SERVER NATIVE dan mengekstraknya di direktori rilis berversi.
 */
export async function uploadAndExtractRelease(
  target: DeployTarget,
  credential: DecryptedSshCredential,
  localTarPath: string,
  remoteReleasePath: string,
  effectiveHost?: string,
  onLog?: (msg: string) => void,
): Promise<void> {
  const host = effectiveHost || target.host;
  const remoteTarPath = `${remoteReleasePath}/release.tar.gz`;

  await uploadReleaseFile(target, credential, localTarPath, remoteTarPath, host, onLog);

  onLog?.("Unggahan paket rilis selesai. Mengekstrak paket di server...");
  const extractCmd = [
    `tar -xzf "${remoteTarPath}" -C "${remoteReleasePath}"`,
    `rm -f "${remoteTarPath}"`,
    `chmod +x "${remoteReleasePath}/noc-backend"`,
    `mkdir -p "${remoteReleasePath}/.next/cache"`,
    `chmod -R u+rwX,go+rX "${remoteReleasePath}"`,
    `chmod -R 777 "${remoteReleasePath}/.next/cache" 2>/dev/null || true`,
    `sudo -n chown -R ${target.sshUser}:noc "${remoteReleasePath}" 2>/dev/null || true`,
    `test -f /srv/noc/shared/.env && ln -sfn /srv/noc/shared/.env "${remoteReleasePath}/.env" || true`,
  ].join(" && ");

  const extractRes = await executeSshCommand(target, credential, extractCmd, host, 60000, (chunk) => {
    onLog?.(chunk);
  });

  if (extractRes.code !== 0) {
    throw new Error(`Ekstraksi rilis gagal (exit code ${extractRes.code}): ${extractRes.stderr || extractRes.stdout}`);
  }

  onLog?.(`Rilis berhasil diekstrak dan disiapkan di ${remoteReleasePath}.`);
}
