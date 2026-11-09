import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ontWebSettings } from "@/db/schema";
import { encryptDeviceCredential } from "@/lib/encryption";
import type { OntWebSettingsInput } from "@/validators/devices";

// Pengaturan "Pasang GenieACS lewat web ONT". Satu baris (id = 'default').
// Kata sandi tidak pernah keluar dari sini: tampilan klien hanya tahu ADA atau
// tidak. Backend Go membaca baris yang sama langsung dari database.

export type OntWebSettingsView = {
  configured: boolean;
  acsUrl: string;
  acsUsername: string;
  hasAcsPassword: boolean;
  informInterval: number;
  webUsername: string;
  hasWebPassword: boolean;
  zimlinkUsername: string;
  hasZimlinkPassword: boolean;
  ggclinkUsername: string;
  hasGgclinkPassword: boolean;
  f609Username: string;
  hasF609Password: boolean;
};

const EMPTY: OntWebSettingsView = {
  configured: false,
  acsUrl: "",
  acsUsername: "",
  hasAcsPassword: false,
  informInterval: 300,
  webUsername: "",
  hasWebPassword: false,
  zimlinkUsername: "",
  hasZimlinkPassword: false,
  ggclinkUsername: "",
  hasGgclinkPassword: false,
  f609Username: "",
  hasF609Password: false,
};

export async function getOntWebSettings(): Promise<OntWebSettingsView> {
  const [row] = await db
    .select()
    .from(ontWebSettings)
    .where(eq(ontWebSettings.id, "default"))
    .limit(1);
  if (!row) return EMPTY;
  return {
    configured: true,
    acsUrl: row.acsUrl,
    acsUsername: row.acsUsername ?? "",
    hasAcsPassword: !!row.acsPasswordEnc,
    informInterval: row.informInterval,
    webUsername: row.webUsername ?? "",
    hasWebPassword: !!row.webPasswordEnc,
    zimlinkUsername: row.zimlinkUsername ?? "",
    hasZimlinkPassword: !!row.zimlinkPasswordEnc,
    ggclinkUsername: row.ggclinkUsername ?? "",
    hasGgclinkPassword: !!row.ggclinkPasswordEnc,
    f609Username: row.f609Username ?? "",
    hasF609Password: !!row.f609PasswordEnc,
  };
}

// undefined = biarkan nilai lama; "" = hapus; selain itu enkripsi dan simpan.
function secretColumn(value: string | undefined) {
  if (value === undefined) return undefined;
  return value === "" ? null : encryptDeviceCredential(value);
}

export async function saveOntWebSettings(
  input: OntWebSettingsInput,
  userId: string,
) {
  const common = {
    acsUrl: input.acsUrl,
    acsUsername: input.acsUsername || null,
    informInterval: input.informInterval,
    webUsername: input.webUsername || null,
    zimlinkUsername: input.zimlinkUsername || null,
    ggclinkUsername: input.ggclinkUsername || null,
    f609Username: input.f609Username || null,
    updatedBy: userId,
    updatedAt: new Date(),
  };
  const acsPasswordEnc = secretColumn(input.acsPassword);
  const webPasswordEnc = secretColumn(input.webPassword);
  const zimlinkPasswordEnc = secretColumn(input.zimlinkPassword);
  const ggclinkPasswordEnc = secretColumn(input.ggclinkPassword);
  const f609PasswordEnc = secretColumn(input.f609Password);
  await db
    .insert(ontWebSettings)
    .values({
      id: "default",
      ...common,
      acsPasswordEnc: acsPasswordEnc ?? null,
      webPasswordEnc: webPasswordEnc ?? null,
      zimlinkPasswordEnc: zimlinkPasswordEnc ?? null,
      ggclinkPasswordEnc: ggclinkPasswordEnc ?? null,
      f609PasswordEnc: f609PasswordEnc ?? null,
    })
    .onConflictDoUpdate({
      target: ontWebSettings.id,
      set: {
        ...common,
        ...(acsPasswordEnc !== undefined ? { acsPasswordEnc } : {}),
        ...(webPasswordEnc !== undefined ? { webPasswordEnc } : {}),
        ...(zimlinkPasswordEnc !== undefined ? { zimlinkPasswordEnc } : {}),
        ...(ggclinkPasswordEnc !== undefined ? { ggclinkPasswordEnc } : {}),
        ...(f609PasswordEnc !== undefined ? { f609PasswordEnc } : {}),
      },
    });
  return getOntWebSettings();
}
