import type { InfrastructureDeviceType } from "@/db/schema/network-infrastructure";
import type { DeviceRelationType } from "@/validators/device-relations";

export const ROOT_DEVICE_TYPES: readonly InfrastructureDeviceType[] = [
  "server",
  "router",
  "olt",
] as const;

export const HIERARCHY_TIER_ORDER: Record<InfrastructureDeviceType, number> = {
  server: 1,
  router: 1,
  olt: 1,
  odc: 2,
  odp: 3,
  pole: 4,
};

/**
 * Validasi Aturan Tipe Tingkatan Relasi Induk-Anak (Hierarchy Tier Compatibility)
 * Memastikan alur kepemilikan terstruktur: Core (Server/Router/OLT) -> ODC -> ODP -> Pole.
 */
export function validateHierarchyTypes(
  parentType: InfrastructureDeviceType,
  childType: InfrastructureDeviceType,
  relationType: DeviceRelationType = "hierarchy",
): { valid: boolean; message?: string } {
  // Untuk jalur backup/distribution non-hierarki murni, perbolehkan koneksi interkoneksi
  if (relationType !== "hierarchy") {
    return { valid: true };
  }

  // Root node tidak boleh dijadikan anak (tidak boleh menginduk ke perangkat manapun)
  if (ROOT_DEVICE_TYPES.includes(childType)) {
    return {
      valid: false,
      message: `Perangkat tingkat inti/root ('${childType}') tidak boleh menjadi anak dari perangkat lain.`,
    };
  }

  // Aturan per tipe anak
  if (childType === "odc") {
    if (!ROOT_DEVICE_TYPES.includes(parentType)) {
      return {
        valid: false,
        message: `ODC hanya dapat menginduk ke perangkat inti (server, router, atau olt). Tipe '${parentType}' tidak valid.`,
      };
    }
  } else if (childType === "odp") {
    const allowedForOdp: InfrastructureDeviceType[] = ["odc", ...ROOT_DEVICE_TYPES];
    if (!allowedForOdp.includes(parentType)) {
      return {
        valid: false,
        message: `ODP hanya dapat menginduk ke ODC atau perangkat inti. Tipe '${parentType}' tidak valid.`,
      };
    }
  } else if (childType === "pole") {
    const allowedForPole: InfrastructureDeviceType[] = ["odp", "odc", "pole"];
    if (!allowedForPole.includes(parentType)) {
      return {
        valid: false,
        message: `Tiang (pole) hanya dapat menginduk ke ODP, ODC, atau tiang lain. Tipe '${parentType}' tidak valid.`,
      };
    }
  }

  return { valid: true };
}
