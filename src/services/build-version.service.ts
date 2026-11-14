import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deployRuns } from "@/db/schema/deploy-runs";
import { nextDeployVersion } from "@/lib/app-version";

// Deploy lewat Docker/Coolify tidak memakai CLI native yang menaikkan versi. Penanda deploy = BUILD_ID +
// hostname (di Docker = ID container): Coolify memakai cache build, jadi redeploy commit yang sama punya
// BUILD_ID sama, tetapi container-nya baru. Penanda yang belum tercatat di deploy_runs mendapat versi
// berikutnya; restart container yang sama memakai versi yang sudah tercatat. Hasilnya dipasang ke APP_VERSION (dibaca getAppDisplayVersion).
// shortcut: dua instance yang start bersamaan bisa mencatat build yang sama dua kali; satu instance saja saat ini.
export async function ensureBuildVersion(): Promise<string | null> {
  if (process.env.APP_VERSION?.trim()) return null; // diisi operator: dihormati
  if (fs.existsSync("/srv/noc/current")) return null; // server native: versi dari CLI deploy

  let buildId: string;
  try {
    buildId = fs
      .readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8")
      .trim();
  } catch {
    return null; // npm run dev: tidak ada BUILD_ID
  }
  if (!buildId || buildId === "development") return null;

  const marker = `build ${buildId} ${os.hostname()}`;
  const [same] = await db
    .select({ versi: deployRuns.versi })
    .from(deployRuns)
    .where(eq(deployRuns.dijalankanOleh, marker))
    .limit(1);

  let versi = same?.versi;
  if (!versi) {
    const [last] = await db
      .select({ versi: deployRuns.versi })
      .from(deployRuns)
      .where(eq(deployRuns.status, "berhasil"))
      .orderBy(desc(deployRuns.mulai))
      .limit(1);
    versi = nextDeployVersion(last?.versi, packageVersion());
    await db.insert(deployRuns).values({
      versi,
      jenis: "deploy",
      status: "berhasil",
      titikBalikVersi: last?.versi ?? null,
      otomatis: true,
      dijalankanOleh: marker,
      selesai: new Date(),
    });
  }
  process.env.APP_VERSION = versi;
  return versi;
}

function packageVersion(): string | null {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}
