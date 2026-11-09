import fs from "node:fs";
import path from "node:path";

export type FourPartVersion = [number, number, number, number];

export const DEFAULT_APP_VERSION = "1.0.0.0";

/**
 * Memecah string versi menjadi 4 angka [major, minor, patch, build].
 * Menerima format "x.y.z.w" atau dengan prefix "v" dan suffix metadata "+...".
 * Fallback aman ke [1, 0, 0, 0] jika string tidak valid.
 */
export function parseFourPartVersion(v?: string | null): FourPartVersion {
  if (!v || typeof v !== "string") {
    return [1, 0, 0, 0];
  }

  // Bersihkan karakter awalan 'v' atau metadata build '+...'
  const clean = v.trim().replace(/^v/i, "").split("+")[0].trim();
  const segments = clean.split(".");

  if (segments.length === 0 || clean === "") {
    return [1, 0, 0, 0];
  }

  const parsed = segments.map((s) => {
    const num = Number.parseInt(s, 10);
    return Number.isFinite(num) && num >= 0 ? num : 0;
  });

  return [parsed[0] ?? 1, parsed[1] ?? 0, parsed[2] ?? 0, parsed[3] ?? 0];
}

/**
 * Menggabungkan 4 komponen versi menjadi string "major.minor.patch.build".
 */
export function formatFourPartVersion(parts: FourPartVersion): string {
  return `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]}`;
}

/**
 * Menaikkan digit minor (+1) dan mereset patch=0 serta build=0.
 * Contoh: "1.0.0.0" -> "1.1.0.0", "1.0.0.8" -> "1.1.0.0"
 */
export function bumpMinorVersion(v?: string | null): string {
  const [major, minor] = parseFourPartVersion(v);
  return formatFourPartVersion([major, minor + 1, 0, 0]);
}

/**
 * Menaikkan digit build (+1).
 * Contoh: "1.0.0.0" -> "1.0.0.1", "1.0.0.1" -> "1.0.0.2"
 */
export function bumpBuildVersion(v?: string | null): string {
  const [major, minor, patch, build] = parseFourPartVersion(v);
  return formatFourPartVersion([major, minor, patch, build + 1]);
}

/**
 * Mendapatkan versi aplikasi aktif untuk ditampilkan di UI.
 * Memeriksa target rilis native server Ubuntu (/srv/noc/current), snapshot status server,
 * variabel environment, dan berkas package.json.
 */
export function getAppDisplayVersion(): string {
  // 1. Periksa symlink aktif di server native Ubuntu (/srv/noc/current)
  try {
    const currentLink = "/srv/noc/current";
    if (fs.existsSync(currentLink)) {
      const real = fs.realpathSync(currentLink);
      const base = path.basename(real);
      if (base && /^\d+\.\d+\.\d+\.\d+/.test(base)) {
        return formatFourPartVersion(parseFourPartVersion(base));
      }
    }
  } catch {
    // Abaikan jika bukan di server native atau symlink tidak terbaca
  }

  // 2. Periksa snapshot status server (/srv/noc/shared/server-status.json)
  try {
    const statusFile = "/srv/noc/shared/server-status.json";
    if (fs.existsSync(statusFile)) {
      const content = fs.readFileSync(statusFile, "utf-8");
      const parsed = JSON.parse(content);
      if (typeof parsed?.version === "string" && parsed.version.trim()) {
        return formatFourPartVersion(parseFourPartVersion(parsed.version));
      }
    }
  } catch {
    // Abaikan kegagalan baca snapshot
  }

  // 3. Periksa variabel environment
  if (process.env.APP_VERSION?.trim()) {
    return formatFourPartVersion(parseFourPartVersion(process.env.APP_VERSION));
  }
  if (process.env.NEXT_PUBLIC_APP_VERSION?.trim()) {
    return formatFourPartVersion(
      parseFourPartVersion(process.env.NEXT_PUBLIC_APP_VERSION),
    );
  }

  // 4. Periksa package.json di root proyek
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    if (fs.existsSync(pkgPath)) {
      const raw = fs.readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(raw);
      if (typeof pkg.version === "string" && pkg.version.trim()) {
        return formatFourPartVersion(parseFourPartVersion(pkg.version));
      }
    }
  } catch {
    // Abaikan
  }

  return DEFAULT_APP_VERSION;
}
