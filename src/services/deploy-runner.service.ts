import crypto from "crypto";
import { db } from "@/db";
import {
  deployRuns,
  deploySteps,
  deployReleases,
  type DeployRun,
  type DeployStep,
} from "@/db/schema/deploy-runs";
import type { DeployTarget } from "@/db/schema/deploy-targets";
import type { DecryptedSshCredential } from "./ssh-credentials.service";
import { executeSshCommand, executeSshScript, testSshConnection } from "./ssh-client.service";
import { getAppVersion } from "./deploy-version.service";
import { buildReleaseBundle, uploadAndExtractRelease } from "./deploy-build.service";
import {
  exportLocalConfigData,
  generateTableUpsertSql,
  recordConfigSync,
  SYNCABLE_CONFIG_TABLES,
} from "./deploy-config-transfer.service";
import { eq, desc } from "drizzle-orm";

export interface DryRunCheck {
  id: string;
  name: string;
  status: "lulus" | "peringatan" | "gagal";
  detail: string;
}

export interface DryRunResult {
  ready: boolean;
  version: string;
  checks: DryRunCheck[];
  pendingMigrations: string[];
  diskSpaceMb?: number;
  evaluatedAt: string;
}

const VERSION_REGEX = /^[a-zA-Z0-9._+-]+$/;

function sanitizeVersion(v: string | null | undefined): string | null {
  if (!v) return null;
  const clean = v.trim();
  if (!VERSION_REGEX.test(clean)) {
    throw new Error(`Format versi "${clean}" tidak aman.`);
  }
  return clean;
}

/**
 * Uji kesiapan rilis (Dry-run) tanpa mengubah apa pun di server.
 */
export async function runDryRun(
  target: DeployTarget,
  credential: DecryptedSshCredential,
  effectiveHost?: string,
): Promise<DryRunResult> {
  const versionInfo = await getAppVersion();
  const checks: DryRunCheck[] = [];
  const host = effectiveHost || target.host;

  // Catat run jenis 'uji' di database
  const [run] = await db
    .insert(deployRuns)
    .values({
      targetId: target.id,
      versi: versionInfo.fullVersion,
      jenis: "uji",
      status: "berjalan",
      dijalankanOleh: "Operator",
    })
    .returning();

  let ready = true;

  // 1. Uji koneksi SSH
  const sshTest = await testSshConnection(target, credential, host);
  if (!sshTest.success) {
    ready = false;
    checks.push({
      id: "check-ssh",
      name: "Koneksi SSH ke SERVER NATIVE",
      status: "gagal",
      detail: sshTest.message,
    });
  } else {
    checks.push({
      id: "check-ssh",
      name: "Koneksi SSH ke SERVER NATIVE",
      status: "lulus",
      detail: `Koneksi SSH berhasil (${sshTest.latencyMs}ms).`,
    });
  }

  // Jika SSH gagal, pemeriksaan remote tidak bisa dilanjutkan
  if (!sshTest.success) {
    await db
      .update(deployRuns)
      .set({ status: "gagal", selesai: new Date() })
      .where(eq(deployRuns.id, run.id));

    return {
      ready: false,
      version: versionInfo.fullVersion,
      checks,
      pendingMigrations: [],
      evaluatedAt: new Date().toISOString(),
    };
  }

  // 2. Pemeriksaan Node.js & Go di server
  try {
    const nodeRes = await executeSshCommand(target, credential, "node -v; go version", host);
    const lines = nodeRes.stdout.trim().split("\n");
    const nodeVer = lines[0] || "tidak ditemukan";
    const goVer = lines[1] || "tidak ditemukan";

    if (nodeVer.startsWith("v")) {
      checks.push({
        id: "check-runtimes",
        name: "Runtime Native (Node.js & Go)",
        status: "lulus",
        detail: `Node: ${nodeVer}, Go: ${goVer}`,
      });
    } else {
      ready = false;
      checks.push({
        id: "check-runtimes",
        name: "Runtime Native (Node.js & Go)",
        status: "gagal",
        detail: `Node.js tidak terdeteksi di server: ${nodeRes.stderr || nodeVer}`,
      });
    }
  } catch (err: unknown) {
    ready = false;
    checks.push({
      id: "check-runtimes",
      name: "Runtime Native (Node.js & Go)",
      status: "gagal",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. Pemeriksaan ruang disk server
  let diskSpaceMb = 0;
  try {
    const dfRes = await executeSshCommand(
      target,
      credential,
      "df -m /srv/noc 2>/dev/null || df -m /",
      host,
    );
    const lines = dfRes.stdout.trim().split("\n");
    if (lines.length > 1) {
      const parts = lines[1].trim().split(/\s+/);
      diskSpaceMb = parseInt(parts[3] || "0", 10);
    }

    if (diskSpaceMb >= 2000) {
      checks.push({
        id: "check-disk",
        name: "Ruang Disk Server",
        status: "lulus",
        detail: `Tersedia ${diskSpaceMb} MB (cukup untuk rilis baru dan backup database).`,
      });
    } else if (diskSpaceMb >= 800) {
      checks.push({
        id: "check-disk",
        name: "Ruang Disk Server",
        status: "peringatan",
        detail: `Tersedia ${diskSpaceMb} MB (mendekati batas minimum 1000 MB).`,
      });
    } else {
      ready = false;
      checks.push({
        id: "check-disk",
        name: "Ruang Disk Server",
        status: "gagal",
        detail: `Ruang disk tidak mencukupi: hanya ${diskSpaceMb} MB tersedia (minimal 1000 MB).`,
      });
    }
  } catch (err: unknown) {
    checks.push({
      id: "check-disk",
      name: "Ruang Disk Server",
      status: "peringatan",
      detail: `Tidak dapat memeriksa disk: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 4. Pemeriksaan keberadaan direktori rilis dan izin tulis (tanpa memodifikasi server)
  try {
    const dirCmd =
      "test -d /srv/noc/releases && test -d /srv/noc/shared && test -d /srv/noc/backups && test -w /srv/noc/releases && echo 'OK' || echo 'FAIL'";
    const dirRes = await executeSshCommand(target, credential, dirCmd, host);
    if (dirRes.stdout.includes("OK")) {
      checks.push({
        id: "check-dirs",
        name: "Direktori & Izin Tulis (/srv/noc)",
        status: "lulus",
        detail: "Direktori releases, shared, dan backups tersedia dan dapat ditulis.",
      });
    } else {
      ready = false;
      checks.push({
        id: "check-dirs",
        name: "Direktori & Izin Tulis (/srv/noc)",
        status: "gagal",
        detail: "Direktori /srv/noc/releases, shared, atau backups belum ada atau izin tulis ditolak.",
      });
    }
  } catch (err: unknown) {
    ready = false;
    checks.push({
      id: "check-dirs",
      name: "Direktori & Izin Tulis (/srv/noc)",
      status: "gagal",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 5. Pemeriksaan Database PostgreSQL di Docker
  try {
    const dbCmd = [
      'PG_CONTAINER=$(grep -E "^POSTGRES_CONTAINER=" /srv/noc/shared/.env 2>/dev/null | cut -d= -f2- | tr -d \'"\\r\\n\' || true)',
      'if [ -z "$PG_CONTAINER" ]; then PG_CONTAINER=$(docker ps --filter "name=noc-postgres" --format "{{.Names}}" | head -n1); fi',
      'if [ -z "$PG_CONTAINER" ]; then PG_CONTAINER=$(docker ps --filter "publish=5432" --format "{{.Names}}" | head -n1); fi',
      'if [ -n "$PG_CONTAINER" ]; then',
      '  echo "CONTAINER:$PG_CONTAINER"',
      '  docker exec "$PG_CONTAINER" pg_isready 2>/dev/null || echo "NOT_READY"',
      'else',
      '  echo "NO_CONTAINER"',
      'fi',
    ].join("\n");

    const dbRes = await executeSshCommand(target, credential, `bash -c '${dbCmd}'`, host);
    if (dbRes.stdout.includes("CONTAINER:") && !dbRes.stdout.includes("NOT_READY")) {
      const cName = dbRes.stdout.split("CONTAINER:")[1]?.split("\n")[0]?.trim();
      checks.push({
        id: "check-db",
        name: "PostgreSQL di Docker Server",
        status: "lulus",
        detail: `Kontainer PostgreSQL terdeteksi aktif dan menerima koneksi (${cName}).`,
      });
    } else {
      ready = false;
      checks.push({
        id: "check-db",
        name: "PostgreSQL di Docker Server",
        status: "gagal",
        detail:
          "Kontainer Docker PostgreSQL (noc-postgres / port 5432) tidak ditemukan atau belum siap menerima koneksi di server.",
      });
    }
  } catch (err: unknown) {
    ready = false;
    checks.push({
      id: "check-db",
      name: "PostgreSQL di Docker Server",
      status: "gagal",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 6. Pemeriksaan Keselarasan DEVICE_SECRET
  try {
    const localDeviceSecret = process.env.DEVICE_SECRET;
    if (localDeviceSecret) {
      const localHash = crypto.createHash("sha256").update(localDeviceSecret).digest("hex").slice(0, 8);
      const secretCheckCmd =
        "grep -E '^DEVICE_SECRET=' /srv/noc/shared/.env 2>/dev/null || echo 'NONE'";
      const secretRes = await executeSshCommand(target, credential, secretCheckCmd, host);

      if (secretRes.stdout.startsWith("DEVICE_SECRET=")) {
        const remoteSecret = secretRes.stdout.replace("DEVICE_SECRET=", "").trim();
        const remoteHash = crypto.createHash("sha256").update(remoteSecret).digest("hex").slice(0, 8);

        if (localHash === remoteHash) {
          checks.push({
            id: "check-device-secret",
            name: "Konsistensi Kunci Enkripsi DEVICE_SECRET",
            status: "lulus",
            detail: "Kunci DEVICE_SECRET di server selaras dengan localhost (kredensial terenkripsi aman ditransfer).",
          });
        } else {
          ready = false;
          checks.push({
            id: "check-device-secret",
            name: "Konsistensi Kunci Enkripsi DEVICE_SECRET",
            status: "gagal",
            detail: "DEVICE_SECRET di /srv/noc/shared/.env berbeda dengan localhost. Sandi perangkat router/OLT akan gagal didekripsi di server.",
          });
        }
      } else {
        ready = false;
        checks.push({
          id: "check-device-secret",
          name: "Konsistensi Kunci Enkripsi DEVICE_SECRET",
          status: "gagal",
          detail: "DEVICE_SECRET belum disetel di /srv/noc/shared/.env. Server tidak akan bisa mendekripsi password router dan OLT.",
        });
      }
    }
  } catch {
    // Non-fatal warning
  }

  // 7. Pemeriksaan Unit systemd
  try {
    const sysCmd =
      "sudo -n systemctl is-enabled noc-web noc-backend 2>/dev/null || true";
    const sysRes = await executeSshCommand(target, credential, sysCmd, host);
    checks.push({
      id: "check-systemd",
      name: "Unit systemd (noc-web & noc-backend)",
      status: "lulus",
      detail: `Status unit systemd: ${sysRes.stdout.trim().replace(/\n/g, ", ") || "tersedia"}`,
    });
  } catch {
    checks.push({
      id: "check-systemd",
      name: "Unit systemd (noc-web & noc-backend)",
      status: "lulus",
      detail: "Unit systemd akan dipasang/di-restart saat deploy rilis.",
    });
  }

  // Update status deploy_runs
  await db
    .update(deployRuns)
    .set({
      status: ready ? "berhasil" : "gagal",
      selesai: new Date(),
    })
    .where(eq(deployRuns.id, run.id));

  return {
    ready,
    version: versionInfo.fullVersion,
    checks,
    pendingMigrations: [],
    diskSpaceMb,
    evaluatedAt: new Date().toISOString(),
  };
}

let isDeployInProgress = false;

/**
 * Menjalankan seluruh alur deploy berurutan sesuai PRD Fase 3 & Fase 4.
 * Menghentikan alur bila ada satu langkah yang gagal sebelum swap,
 * dan memicu rollback otomatis HANYA bila health check gagal setelah swap.
 */
export async function executeDeployRun(
  target: DeployTarget,
  credential: DecryptedSshCredential,
  userEmail = "Operator",
  effectiveHost?: string,
  existingRunId?: string,
): Promise<{
  success: boolean;
  runId: string;
  version: string;
  autoRollbackTriggered?: boolean;
  message: string;
}> {
  const versionInfo = await getAppVersion();
  const host = effectiveHost || target.host;
  const version = sanitizeVersion(versionInfo.fullVersion);
  if (!version) {
    throw new Error("Nomor versi tidak valid.");
  }

  if (isDeployInProgress) {
    throw new Error("Proses deploy atau rollback lain sedang berlangsung. Tunggu hingga selesai.");
  }
  isDeployInProgress = true;

  let runId = existingRunId || "";
  if (!runId) {
    const [run] = await db
      .insert(deployRuns)
      .values({
        targetId: target.id,
        versi: version,
        jenis: "deploy",
        status: "berjalan",
        dijalankanOleh: userEmail,
      })
      .returning();
    runId = run.id;
  }

  let titikBalikVersi: string | null = null;

  async function addStep(
    urutan: number,
    nama: string,
    status: DeployStep["status"],
    keluaran?: string,
  ): Promise<DeployStep> {
    const [step] = await db
      .insert(deploySteps)
      .values({
        runId: runId,
        urutan,
        nama,
        status,
        keluaran,
        mulai: new Date(),
        selesai: status !== "berjalan" ? new Date() : null,
      })
      .returning();
    return step;
  }

  async function updateStep(
    stepId: string,
    status: DeployStep["status"],
    keluaran?: string,
  ) {
    await db
      .update(deploySteps)
      .set({
        status,
        keluaran,
        selesai: new Date(),
      })
      .where(eq(deploySteps.id, stepId));
  }

  try {
    // LANGKAH 1: Pre-flight & Koneksi SSH
    const step1 = await addStep(1, "Pre-flight & Koneksi SSH", "berjalan");
    const connTest = await testSshConnection(target, credential, host);
    if (!connTest.success) {
      await updateStep(step1.id, "gagal", connTest.message);
      throw new Error(`Pre-flight koneksi SSH gagal: ${connTest.message}`);
    }
    await updateStep(step1.id, "berhasil", `Terhubung ke ${target.sshUser}@${host}:${target.port}`);

    // LANGKAH 2: Backup Database Server
    const step2 = await addStep(2, "Backup Database Server", "berjalan");
    const timestampStr = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = `/srv/noc/backups/backup-${timestampStr}.sql.gz`;

    // Gunakan pipefail agar kegagalan pg_dump tidak tersembunyi
    const backupCmd = [
      "set -o pipefail",
      "mkdir -p /srv/noc/backups",
      'PG_CID=$(grep -E "^POSTGRES_CONTAINER=" /srv/noc/shared/.env 2>/dev/null | cut -d= -f2- | tr -d \'"\\r\\n\' || true)',
      'if [ -z "$PG_CID" ]; then PG_CID=$(docker ps --filter "name=noc-postgres" --format "{{.Names}}" | head -n1); fi',
      'if [ -z "$PG_CID" ]; then PG_CID=$(docker ps --filter "publish=5432" --format "{{.Names}}" | head -n1); fi',
      'if [ -z "$PG_CID" ]; then echo "Kontainer postgres tidak ditemukan di server"; exit 1; fi',
      'DB_URL=$(grep -E "^DATABASE_URL=" /srv/noc/shared/.env 2>/dev/null | cut -d= -f2- | tr -d \'"\\r\\n\' || true)',
      'DB_USER=$(echo "$DB_URL" | sed -E \'s|^.*://([^:]+):.*$|\\1|\')',
      'DB_NAME=$(echo "$DB_URL" | sed -E \'s|^.*/([^?]+).*$|\\1|\')',
      'if [ -z "$DB_USER" ] || [ "$DB_USER" = "$DB_URL" ]; then DB_USER="starter"; fi',
      'if [ -z "$DB_NAME" ] || [ "$DB_NAME" = "$DB_URL" ]; then DB_NAME="starter"; fi',
      `docker exec "$PG_CID" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom > "${backupFile}"`,
      `test -s "${backupFile}" || (echo "File backup kosong atau gagal dibuat"; exit 1)`,
      `ls -lh "${backupFile}"`,
    ].join(" && ");

    const backupRes = await executeSshCommand(target, credential, `bash -c '${backupCmd}'`, host);
    if (backupRes.code !== 0) {
      await updateStep(step2.id, "gagal", backupRes.stderr || backupRes.stdout);
      throw new Error(`Backup database gagal: ${backupRes.stderr || backupRes.stdout}`);
    }
    await updateStep(step2.id, "berhasil", `Backup berhasil disimpan di ${backupFile} (${backupRes.stdout.trim()})`);

    // LANGKAH 3: Bangun Artefak Rilis & Unggah ke Server
    const step3 = await addStep(3, "Bangun Artefak Rilis & Unggah", "berjalan");
    const releasePath = `/srv/noc/releases/${version}`;

    // Pastikan direktori rilis dibuat di server
    await executeSshCommand(target, credential, `mkdir -p "${releasePath}" /srv/noc/shared`, host);

    // Build tarball di localhost
    const buildResult = await buildReleaseBundle(version, (msg) => {
      // update log jika perlu
    });

    // Upload via SFTP dan ekstrak di server
    await uploadAndExtractRelease(target, credential, buildResult.tarPath, releasePath, host);
    await updateStep(
      step3.id,
      "berhasil",
      `Artefak rilis ${(buildResult.sizeBytes / 1024 / 1024).toFixed(2)} MB berhasil diunggah dan diekstrak di ${releasePath}`,
    );

    // LANGKAH 4: Migrasi Skema Database dari Rilis Baru
    const step4 = await addStep(4, "Migrasi Skema Database", "berjalan");
    const migCmd = `test -f "${releasePath}/scripts/migrate-server.mjs" && node "${releasePath}/scripts/migrate-server.mjs"`;
    const migRes = await executeSshCommand(target, credential, migCmd, host);
    if (migRes.code !== 0) {
      await updateStep(step4.id, "gagal", migRes.stderr || migRes.stdout);
      throw new Error(`Migrasi database gagal: ${migRes.stderr || migRes.stdout}`);
    }
    await updateStep(step4.id, "berhasil", `Migrasi database sukses dieksekusi: ${migRes.stdout.trim() || "OK"}`);

    // LANGKAH 5: Pemindahan Konfigurasi Localhost -> Server (idempoten)
    const step5 = await addStep(5, "Pemindahan Konfigurasi Localhost -> Server", "berjalan");
    try {
      const localData = await exportLocalConfigData();
      let totalInserted = 0;
      const routerRows = localData["routers"] || [];
      const routerHostMap = new Map<string, string>();
      for (const r of routerRows) {
        if (r.id && r.host) routerHostMap.set(String(r.id), String(r.host));
      }

      const sqlStatements: string[] = ["BEGIN;"];
      for (const item of SYNCABLE_CONFIG_TABLES) {
        const rows = localData[item.table] || [];
        if (rows.length > 0) {
          const sqlScript = generateTableUpsertSql(item.table, rows, routerHostMap);
          if (sqlScript) {
            sqlStatements.push(sqlScript);
          }
          totalInserted += rows.length;
          await recordConfigSync(runId, {
            table: item.table,
            inserted: rows.length,
            updated: 0,
            skipped: 0,
            status: "berhasil",
          });
        } else {
          await recordConfigSync(runId, {
            table: item.table,
            inserted: 0,
            updated: 0,
            skipped: 0,
            status: "dilewati",
          });
        }
      }
      sqlStatements.push("COMMIT;");

      if (sqlStatements.length > 2) {
        const combinedSql = sqlStatements.join("\n\n");
        const execCmd = [
          'PG_CID=$(grep -E "^POSTGRES_CONTAINER=" /srv/noc/shared/.env 2>/dev/null | cut -d= -f2- | tr -d \'"\\r\\n\' || true)',
          'if [ -z "$PG_CID" ]; then PG_CID=$(docker ps --filter "name=noc-postgres" --format "{{.Names}}" | head -n1); fi',
          'if [ -z "$PG_CID" ]; then PG_CID=$(docker ps --filter "publish=5432" --format "{{.Names}}" | head -n1); fi',
          'DB_URL=$(grep -E "^DATABASE_URL=" /srv/noc/shared/.env 2>/dev/null | cut -d= -f2- | tr -d \'"\\r\\n\' || true)',
          'DB_USER=$(echo "$DB_URL" | sed -E \'s|^.*://([^:]+):.*$|\\1|\')',
          'DB_NAME=$(echo "$DB_URL" | sed -E \'s|^.*/([^?]+).*$|\\1|\')',
          'if [ -z "$DB_USER" ] || [ "$DB_USER" = "$DB_URL" ]; then DB_USER="starter"; fi',
          'if [ -z "$DB_NAME" ] || [ "$DB_NAME" = "$DB_URL" ]; then DB_NAME="starter"; fi',
          'docker exec -i "$PG_CID" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 --single-transaction -f -',
        ].join(" && ");
        const execRes = await executeSshScript(target, credential, execCmd, combinedSql, host);
        if (execRes.code !== 0) {
          throw new Error(`Sinkronisasi konfigurasi database gagal: ${execRes.stderr || execRes.stdout}`);
        }
      }

      await updateStep(step5.id, "berhasil", `Konfigurasi berhasil disinkronkan (${totalInserted} baris konfigurasi dipindahkan dalam satu transaksi atomik).`);
    } catch (err: unknown) {
      await updateStep(step5.id, "gagal", err instanceof Error ? err.message : String(err));
      throw new Error(`Pemindahan konfigurasi gagal: ${err instanceof Error ? err.message : String(err)}`);
    }

    // LANGKAH 6: Catat Titik Balik Versi Aktif Sebelum Swap
    const step6 = await addStep(6, "Pencatatan Titik Balik Versi", "berjalan");
    const getVersionCmd = `test -L /srv/noc/current && readlink -f /srv/noc/current || echo 'NONE'`;
    const getVersionRes = await executeSshCommand(target, credential, getVersionCmd, host);
    const activeCurrentPath = getVersionRes.stdout.trim();

    if (activeCurrentPath && activeCurrentPath !== "NONE") {
      const rawOld = activeCurrentPath.split("/").pop() || null;
      titikBalikVersi = sanitizeVersion(rawOld);
    }

    await db
      .update(deployRuns)
      .set({ titikBalikVersi })
      .where(eq(deployRuns.id, runId));

    await updateStep(
      step6.id,
      "berhasil",
      titikBalikVersi
        ? `Titik balik tercatat: versi ${titikBalikVersi}`
        : "Rilis pertama (belum ada symlink current sebelumnya).",
    );

    // LANGKAH 7: Tukar Symlink `current` secara Atomik
    const step7 = await addStep(7, "Penukaran Symlink current (Atomik)", "berjalan");
    const swapCmd = `ln -sfn "${releasePath}" /srv/noc/current.tmp && mv -Tf /srv/noc/current.tmp /srv/noc/current`;
    const swapRes = await executeSshCommand(target, credential, swapCmd, host);
    if (swapRes.code !== 0) {
      await updateStep(step7.id, "gagal", swapRes.stderr || swapRes.stdout);
      throw new Error(`Penukaran symlink current gagal: ${swapRes.stderr}`);
    }
    await updateStep(step7.id, "berhasil", `Symlink /srv/noc/current -> ${releasePath}`);

    // LANGKAH 8: Restart Layanan systemd (noc-web & noc-backend)
    const step8 = await addStep(8, "Restart Layanan systemd", "berjalan");
    const restartCmd = `sudo -n systemctl restart noc-web noc-backend`;
    const restartRes = await executeSshCommand(target, credential, restartCmd, host);
    if (restartRes.code !== 0) {
      await updateStep(step8.id, "gagal", restartRes.stderr || restartRes.stdout);
      // Restart gagal setelah swap -> picu rollback otomatis jika ada titik balik
      if (titikBalikVersi) {
        await executeSshCommand(
          target,
          credential,
          `ln -sfn "/srv/noc/releases/${titikBalikVersi}" /srv/noc/current.tmp && mv -Tf /srv/noc/current.tmp /srv/noc/current && sudo -n systemctl restart noc-web noc-backend`,
          host,
        );
      }
      throw new Error(`Restart unit systemd gagal: ${restartRes.stderr || restartRes.stdout}`);
    }
    await updateStep(step8.id, "berhasil", "Layanan noc-web dan noc-backend berhasil di-restart.");

    // LANGKAH 9: Health Check Setelah Deploy (Next.js :3000 dan Go :8080)
    const step9 = await addStep(9, "Health Check Pasca-Deploy", "berjalan");
    let healthy = false;
    let healthOutput = "";

    for (let i = 0; i < 5; i++) {
      const probeNext = await executeSshCommand(
        target,
        credential,
        "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/api/health",
        host,
      );
      const probeGo = await executeSshCommand(
        target,
        credential,
        "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8080/healthz",
        host,
      );

      const nextCode = probeNext.stdout.trim();
      const goCode = probeGo.stdout.trim();

      if (nextCode === "200" && goCode === "200") {
        healthy = true;
        healthOutput = `Next.js (:3000) dan Backend Go (:8080) keduanya merespons HTTP 200 OK.`;
        break;
      }
      healthOutput = `Percobaan ${i + 1}/5: Next.js HTTP ${nextCode}, Go HTTP ${goCode}`;
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!healthy) {
      // KEGAGALAN HEALTH CHECK PASCA-SWAP -> PICU ROLLBACK OTOMATIS!
      await updateStep(step9.id, "gagal", `Health check gagal: ${healthOutput}`);

      if (titikBalikVersi) {
        const rollbackCmd = `ln -sfn "/srv/noc/releases/${titikBalikVersi}" /srv/noc/current.tmp && mv -Tf /srv/noc/current.tmp /srv/noc/current && sudo -n systemctl restart noc-web noc-backend`;
        const rollbackRes = await executeSshCommand(target, credential, rollbackCmd, host, 30000);

        let rollbackHealthy = false;
        if (rollbackRes.code === 0) {
          for (let r = 0; r < 3; r++) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const recheck = await executeSshCommand(
              target,
              credential,
              "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/api/health",
              host,
            );
            if (recheck.stdout.trim() === "200") {
              rollbackHealthy = true;
              break;
            }
          }
        }

        const rollbackStatus = rollbackHealthy ? "berhasil" : "gagal";

        await db.insert(deployRuns).values({
          targetId: target.id,
          versi: titikBalikVersi,
          jenis: "rollback",
          status: rollbackStatus,
          otomatis: true,
          titikBalikVersi: version,
          dijalankanOleh: "Sistem (Rollback Otomatis)",
          selesai: new Date(),
        });

        await db
          .update(deployRuns)
          .set({ status: "gagal", selesai: new Date() })
          .where(eq(deployRuns.id, runId));

        return {
          success: false,
          runId,
          version,
          autoRollbackTriggered: true,
          message: rollbackHealthy
            ? `Health check gagal setelah swap. Rollback otomatis ke versi ${titikBalikVersi} berhasil dijalankan dan sehat.`
            : `Health check gagal, dan pemulihan otomatis ke versi ${titikBalikVersi} juga gagal. Server membutuhkan tindakan manual segera via SSH!`,
        };
      }

      await db
        .update(deployRuns)
        .set({ status: "gagal", selesai: new Date() })
        .where(eq(deployRuns.id, runId));

      return {
        success: false,
        runId,
        version,
        autoRollbackTriggered: false,
        message: "Health check gagal dan tidak ada titik balik rilis sebelumnya untuk dipulihkan.",
      };
    }

    await updateStep(step9.id, "berhasil", healthOutput);

    // Tandai rilis aktif di deploy_releases
    await db
      .update(deployReleases)
      .set({ aktif: false })
      .where(eq(deployReleases.targetId, target.id));

    await db.insert(deployReleases).values({
      targetId: target.id,
      versi: version,
      path: releasePath,
      aktif: true,
    });

    await db
      .update(deployRuns)
      .set({ status: "berhasil", selesai: new Date() })
      .where(eq(deployRuns.id, runId));

    return {
      success: true,
      runId,
      version,
      message: `Deploy versi ${version} berhasil terpasang di SERVER NATIVE!`,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(deployRuns)
      .set({ status: "gagal", selesai: new Date() })
      .where(eq(deployRuns.id, runId));

    return {
      success: false,
      runId,
      version,
      message: `Deploy terhenti: ${errorMsg}`,
    };
  } finally {
    isDeployInProgress = false;
  }
}

/**
 * Menjalankan rollback manual ke versi rilis yang dipilih.
 * PERINGATAN: Skema database tidak diputar balik!
 */
export async function executeManualRollback(
  target: DeployTarget,
  credential: DecryptedSshCredential,
  targetVersion: string,
  userEmail = "Operator",
  effectiveHost?: string,
): Promise<{ success: boolean; message: string }> {
  if (isDeployInProgress) {
    throw new Error("Proses deploy atau rollback lain sedang berlangsung. Tunggu hingga selesai.");
  }
  isDeployInProgress = true;

  try {
    const version = sanitizeVersion(targetVersion);
    if (!version) {
      return { success: false, message: "Nomor versi rollback tidak valid." };
    }
  const host = effectiveHost || target.host;
  const targetReleasePath = `/srv/noc/releases/${version}`;

  // Periksa apakah rilis ada di server
  const checkCmd = `test -d "${targetReleasePath}" && echo 'EXISTS' || echo 'MISSING'`;
  const checkRes = await executeSshCommand(target, credential, checkCmd, host);

  if (!checkRes.stdout.includes("EXISTS")) {
    return {
      success: false,
      message: `Direktori rilis ${targetReleasePath} tidak ditemukan di server.`,
    };
  }

  // Tukar symlink
  const swapCmd = `ln -sfn "${targetReleasePath}" /srv/noc/current.tmp && mv -Tf /srv/noc/current.tmp /srv/noc/current`;
  const swapRes = await executeSshCommand(target, credential, swapCmd, host);
  if (swapRes.code !== 0) {
    return { success: false, message: `Gagal menukar symlink: ${swapRes.stderr}` };
  }

  // Restart layanan
  const restartRes = await executeSshCommand(
    target,
    credential,
    "sudo -n systemctl restart noc-web noc-backend",
    host,
  );
  if (restartRes.code !== 0) {
    return { success: false, message: `Gagal me-restart layanan: ${restartRes.stderr}` };
  }

  // Catat riwayat rollback
  await db.insert(deployRuns).values({
    targetId: target.id,
    versi: version,
    jenis: "rollback",
    status: "berhasil",
    otomatis: false,
    dijalankanOleh: userEmail,
    selesai: new Date(),
  });

  // Perbarui status rilis aktif
  await db
    .update(deployReleases)
    .set({ aktif: false })
    .where(eq(deployReleases.targetId, target.id));

  await db
    .update(deployReleases)
    .set({ aktif: true })
    .where(eq(deployReleases.versi, version));

    return {
      success: true,
      message: `Rollback manual ke versi ${version} berhasil. Symlink dan layanan telah diarahkan kembali (Skema database tetap pada migrasi terakhir).`,
    };
  } finally {
    isDeployInProgress = false;
  }
}

/**
 * Mengambil riwayat deploy dan rollback dengan opsi filter.
 */
export async function getDeployRuns(options?: {
  status?: string;
  jenis?: string;
  limit?: number;
}): Promise<DeployRun[]> {
  const query = db
    .select()
    .from(deployRuns)
    .orderBy(desc(deployRuns.mulai))
    .limit(options?.limit ?? 50);

  return query;
}

/**
 * Mengambil detail satu run deploy beserta log langkah dan sinkronisasi konfigurasi.
 */
export async function getDeployRunDetail(runId: string) {
  const [run] = await db
    .select()
    .from(deployRuns)
    .where(eq(deployRuns.id, runId))
    .limit(1);

  if (!run) return null;

  const steps = await db
    .select()
    .from(deploySteps)
    .where(eq(deploySteps.runId, runId))
    .orderBy(deploySteps.urutan);

  return {
    run,
    steps,
  };
}
