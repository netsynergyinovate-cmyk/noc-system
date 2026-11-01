import os from "os";
import { exec } from "child_process";
import { mkdir, rm, stat, copyFile, cp } from "fs/promises";
import { resolve, join } from "path";
import { existsSync, createReadStream } from "fs";
import { Client, type ConnectConfig } from "ssh2";
import type { DeployTarget } from "@/db/schema/deploy-targets";
import type { DecryptedSshCredential } from "./ssh-credentials.service";

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
    existsSync(resolve(rootDir, "server.js")) && !existsSync(resolve(rootDir, "src"));
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

  // 3. Salin skrip migrasi dan folder drizzle
  onLog?.("Menyalin skrip migrasi dan folder drizzle...");
  const destScripts = resolve(distDir, "scripts");
  await mkdir(destScripts, { recursive: true });
  await copyFile(
    resolve(rootDir, "scripts", "migrate-server.mjs"),
    resolve(destScripts, "migrate-server.mjs"),
  );
  if (existsSync(resolve(rootDir, "scripts", "setup-timescale.mjs"))) {
    await copyFile(
      resolve(rootDir, "scripts", "setup-timescale.mjs"),
      resolve(destScripts, "setup-timescale.mjs"),
    );
  }

  const destDrizzle = resolve(distDir, "drizzle");
  await cp(resolve(rootDir, "drizzle"), destDrizzle, { recursive: true });

  // 4. Kompresi ke dalam release.tar.gz
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
  const { promise, resolve: resolveAll, reject: rejectAll } = Promise.withResolvers<void>();

  const conn = new Client();
  const remoteTarPath = `${remoteReleasePath}/release.tar.gz`;

  conn.on("ready", () => {
    onLog?.(`Membuka sesi SFTP ke ${target.sshUser}@${host}...`);
    conn.sftp((err, sftp) => {
      if (err) {
        conn.end();
        return rejectAll(new Error(`Gagal membuka SFTP: ${err.message}`));
      }

      onLog?.(`Mengunggah paket rilis ke ${remoteTarPath}...`);
      const readStream = createReadStream(localTarPath);
      const writeStream = sftp.createWriteStream(remoteTarPath);

      writeStream.on("close", () => {
        onLog?.("Unggahan paket rilis selesai. Mengekstrak paket di server...");

        // Jalankan ekstraksi dan permission via SSH exec
        const extractCmd = [
          `tar -xzf "${remoteTarPath}" -C "${remoteReleasePath}"`,
          `rm -f "${remoteTarPath}"`,
          `chmod +x "${remoteReleasePath}/noc-backend"`,
          `test -f /srv/noc/shared/.env && ln -sfn /srv/noc/shared/.env "${remoteReleasePath}/.env" || true`,
        ].join(" && ");

        conn.exec(extractCmd, (execErr, stream) => {
          if (execErr) {
            conn.end();
            return rejectAll(new Error(`Gagal mengekstrak rilis: ${execErr.message}`));
          }

          let stderr = "";
          stream.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
          });

          stream.on("close", (code: number) => {
            conn.end();
            if (code !== 0) {
              rejectAll(new Error(`Ekstraksi rilis gagal (exit code ${code}): ${stderr}`));
            } else {
              onLog?.(`Rilis berhasil diekstrak dan disiapkan di ${remoteReleasePath}.`);
              resolveAll();
            }
          });
        });
      });

      writeStream.on("error", (e: Error) => {
        conn.end();
        rejectAll(new Error(`Gagal mengunggah file SFTP: ${e.message}`));
      });

      readStream.pipe(writeStream);
    });
  });

  conn.on("error", (err) => {
    rejectAll(new Error(`Koneksi SSH untuk SFTP gagal: ${err.message}`));
  });

  const connectConfig: ConnectConfig = {
    host,
    port: target.port,
    username: target.sshUser,
    privateKey: credential.privateKey,
    passphrase: credential.passphrase,
    password: credential.password,
    readyTimeout: 15000,
  };

  conn.connect(connectConfig);

  return promise;
}
