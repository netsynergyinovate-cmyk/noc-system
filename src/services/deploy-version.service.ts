import { readFile } from "fs/promises";
import { resolve } from "path";
import { exec } from "child_process";

export interface VersionInfo {
  semver: string;
  commitHash: string;
  fullVersion: string;
}

/**
 * Membaca versi aplikasi dari package.json dan hash commit git terakhir.
 */
export async function getAppVersion(): Promise<VersionInfo> {
  let semver = "1.0.0.0";
  try {
    const pkgRaw = await readFile(resolve(process.cwd(), "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw);
    if (pkg.version) {
      semver = pkg.version;
    }
  } catch {
    // fallback
  }

  const { promise, resolve: resolveCommit } = Promise.withResolvers<string>();
  exec("git rev-parse --short HEAD", (err, stdout) => {
    if (err || !stdout.trim()) {
      resolveCommit("local");
    } else {
      resolveCommit(stdout.trim());
    }
  });

  const commitHash = await promise;
  const fullVersion = semver;

  return {
    semver,
    commitHash,
    fullVersion,
  };
}
