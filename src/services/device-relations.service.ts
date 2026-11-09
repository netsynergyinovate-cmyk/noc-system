import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  networkInfrastructure,
  networkDeviceRelations,
  infrastructureTypes,
  type NetworkDeviceRelation,
  type DeviceRelationType,
} from "@/db/schema/network-infrastructure";

export type InfrastructureDeviceType = (typeof infrastructureTypes)[number];
import type {
  CreateDeviceRelationInput,
  QueryDeviceRelationsInput,
  UpdateDeviceRelationInput,
} from "@/validators/device-relations";

export interface DeviceRelationDetailItem {
  id: string;
  parentId: string;
  parentName: string;
  parentType: InfrastructureDeviceType;
  childId: string;
  childName: string;
  childType: InfrastructureDeviceType;
  relationType: DeviceRelationType;
  parentPort: string | null;
  childPort: string | null;
  status: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface HierarchyTreeNode {
  id: string;
  name: string;
  type: InfrastructureDeviceType;
  status: string;
  latitude: number;
  longitude: number;
  capacity?: number | null;
  usedCapacity?: number | null;
  parentPort?: string | null;
  childPort?: string | null;
  relationType?: DeviceRelationType;
  children: HierarchyTreeNode[];
}

import {
  validateHierarchyTypes,
  ROOT_DEVICE_TYPES,
  HIERARCHY_TIER_ORDER,
} from "@/lib/hierarchy-rules";

export { validateHierarchyTypes, ROOT_DEVICE_TYPES, HIERARCHY_TIER_ORDER };

// 2. Deteksi Siklus Relasi Hierarki (Cycle / Loop Prevention)
export async function detectHierarchyCycle(
  childId: string,
  targetParentId: string,
): Promise<{ hasCycle: boolean; path: string[] }> {
  if (childId === targetParentId) {
    return { hasCycle: true, path: [childId, targetParentId] };
  }

  const visited = new Set<string>();
  const path: string[] = [childId];
  let currentId: string | null = targetParentId;

  while (currentId) {
    path.push(currentId);

    if (currentId === childId) {
      return { hasCycle: true, path };
    }

    if (visited.has(currentId)) {
      // Loop terdeteksi di rantai di atasnya
      break;
    }
    visited.add(currentId);

    // Ambil data parent dari currentId
    const rows = await db
      .select({
        id: networkInfrastructure.id,
        parentId: networkInfrastructure.parentId,
      })
      .from(networkInfrastructure)
      .where(eq(networkInfrastructure.id, currentId))
      .limit(1);

    if (rows.length === 0 || !rows[0].parentId) {
      break;
    }

    currentId = rows[0].parentId;
  }

  return { hasCycle: false, path: [] };
}

// 3. Tambah Relasi Induk-Anak Baru
export async function createDeviceRelation(
  input: CreateDeviceRelationInput,
): Promise<{
  success: boolean;
  data?: NetworkDeviceRelation;
  message: string;
}> {
  // Ambil perangkat parent dan child dari database
  const [parentDevice] = await db
    .select()
    .from(networkInfrastructure)
    .where(eq(networkInfrastructure.id, input.parentId))
    .limit(1);

  if (!parentDevice) {
    return {
      success: false,
      message: `Perangkat induk dengan ID '${input.parentId}' tidak ditemukan.`,
    };
  }

  const [childDevice] = await db
    .select()
    .from(networkInfrastructure)
    .where(eq(networkInfrastructure.id, input.childId))
    .limit(1);

  if (!childDevice) {
    return {
      success: false,
      message: `Perangkat anak dengan ID '${input.childId}' tidak ditemukan.`,
    };
  }

  // Validasi aturan hierarki tipe perangkat
  const typeValidation = validateHierarchyTypes(
    parentDevice.type,
    childDevice.type,
    input.relationType,
  );
  if (!typeValidation.valid) {
    return {
      success: false,
      message:
        typeValidation.message || "Relasi hierarki tipe perangkat tidak valid.",
    };
  }

  // Deteksi siklus jika relasi bertipe hierarchy
  if (input.relationType === "hierarchy") {
    const cycleCheck = await detectHierarchyCycle(
      input.childId,
      input.parentId,
    );
    if (cycleCheck.hasCycle) {
      return {
        success: false,
        message: `Terdeteksi siklus relasi bertingkat (circular dependency): ${cycleCheck.path.join(" -> ")}. Relasi ditolak.`,
      };
    }
  }

  // Cek apakah relasi sudah ada
  const [existingRelation] = await db
    .select()
    .from(networkDeviceRelations)
    .where(
      and(
        eq(networkDeviceRelations.parentId, input.parentId),
        eq(networkDeviceRelations.childId, input.childId),
        eq(networkDeviceRelations.relationType, input.relationType),
      ),
    )
    .limit(1);

  let resultRelation: NetworkDeviceRelation;

  if (existingRelation) {
    const [updated] = await db
      .update(networkDeviceRelations)
      .set({
        parentPort: input.parentPort ?? existingRelation.parentPort,
        childPort: input.childPort ?? existingRelation.childPort,
        status: input.status ?? existingRelation.status,
        details: input.details ?? existingRelation.details,
        updatedAt: new Date(),
      })
      .where(eq(networkDeviceRelations.id, existingRelation.id))
      .returning();
    resultRelation = updated;
  } else {
    const [inserted] = await db
      .insert(networkDeviceRelations)
      .values({
        parentId: input.parentId,
        childId: input.childId,
        relationType: input.relationType,
        parentPort: input.parentPort,
        childPort: input.childPort,
        status: input.status,
        details: input.details,
      })
      .returning();
    resultRelation = inserted;
  }

  // Jika relasi hierarki, sinkronkan kolom parentId pada network_infrastructure
  if (input.relationType === "hierarchy") {
    await db
      .update(networkInfrastructure)
      .set({
        parentId: input.parentId,
        updatedAt: new Date(),
      })
      .where(eq(networkInfrastructure.id, input.childId));
  }

  return {
    success: true,
    data: resultRelation,
    message: `Relasi ${input.relationType} antara '${parentDevice.name}' dan '${childDevice.name}' berhasil disimpan.`,
  };
}

// 4. Daftar Relasi Induk-Anak dengan Detail Perangkat
export async function getDeviceRelations(
  filter?: QueryDeviceRelationsInput,
): Promise<DeviceRelationDetailItem[]> {
  const infraRows = await db.select().from(networkInfrastructure);
  const infraMap = new Map(infraRows.map((r) => [r.id, r]));

  let relations = await db.select().from(networkDeviceRelations);

  if (filter?.deviceId) {
    const dId = filter.deviceId;
    relations = relations.filter(
      (r) => r.parentId === dId || r.childId === dId,
    );
  }
  if (filter?.parentId) {
    relations = relations.filter((r) => r.parentId === filter.parentId);
  }
  if (filter?.childId) {
    relations = relations.filter((r) => r.childId === filter.childId);
  }
  if (filter?.relationType) {
    relations = relations.filter((r) => r.relationType === filter.relationType);
  }
  if (filter?.status) {
    relations = relations.filter((r) => r.status === filter.status);
  }

  return relations.map((rel) => {
    const parent = infraMap.get(rel.parentId);
    const child = infraMap.get(rel.childId);

    return {
      id: rel.id,
      parentId: rel.parentId,
      parentName: parent?.name || "Perangkat Induk Tidak Diketahui",
      parentType: parent?.type || "router",
      childId: rel.childId,
      childName: child?.name || "Perangkat Anak Tidak Diketahui",
      childType: child?.type || "odp",
      relationType: rel.relationType,
      parentPort: rel.parentPort,
      childPort: rel.childPort,
      status: rel.status,
      details: rel.details as Record<string, unknown> | null,
      createdAt: rel.createdAt.toISOString(),
      updatedAt: rel.updatedAt.toISOString(),
    };
  });
}

// 5. Perbarui Relasi
export async function updateDeviceRelation(
  id: string,
  input: UpdateDeviceRelationInput,
): Promise<{
  success: boolean;
  data?: NetworkDeviceRelation;
  message: string;
}> {
  const [existing] = await db
    .select()
    .from(networkDeviceRelations)
    .where(eq(networkDeviceRelations.id, id))
    .limit(1);

  if (!existing) {
    return {
      success: false,
      message: `Relasi dengan ID '${id}' tidak ditemukan.`,
    };
  }

  const [updated] = await db
    .update(networkDeviceRelations)
    .set({
      relationType: input.relationType ?? existing.relationType,
      parentPort:
        input.parentPort !== undefined ? input.parentPort : existing.parentPort,
      childPort:
        input.childPort !== undefined ? input.childPort : existing.childPort,
      status: input.status ?? existing.status,
      details: input.details ?? existing.details,
      updatedAt: new Date(),
    })
    .where(eq(networkDeviceRelations.id, id))
    .returning();

  return {
    success: true,
    data: updated,
    message: `Relasi '${id}' berhasil diperbarui.`,
  };
}

// 6. Hapus Relasi Induk-Anak
export async function deleteDeviceRelation(
  id: string,
): Promise<{ success: boolean; message: string }> {
  const [existing] = await db
    .select()
    .from(networkDeviceRelations)
    .where(eq(networkDeviceRelations.id, id))
    .limit(1);

  if (!existing) {
    return {
      success: false,
      message: `Relasi dengan ID '${id}' tidak ditemukan.`,
    };
  }

  await db
    .delete(networkDeviceRelations)
    .where(eq(networkDeviceRelations.id, id));

  // Jika relasi yang dihapus adalah hierarchy, bersihkan parentId di network_infrastructure jika cocok
  if (existing.relationType === "hierarchy") {
    const [child] = await db
      .select({
        id: networkInfrastructure.id,
        parentId: networkInfrastructure.parentId,
      })
      .from(networkInfrastructure)
      .where(eq(networkInfrastructure.id, existing.childId))
      .limit(1);

    if (child && child.parentId === existing.parentId) {
      await db
        .update(networkInfrastructure)
        .set({
          parentId: null,
          updatedAt: new Date(),
        })
        .where(eq(networkInfrastructure.id, child.id));
    }
  }

  return {
    success: true,
    message: `Relasi '${id}' berhasil dihapus.`,
  };
}

// 7. Ambil Rantai Leluhur Perangkat (Ancestors Lineage Chain)
export async function getDeviceAncestors(deviceId: string): Promise<
  Array<{
    id: string;
    name: string;
    type: InfrastructureDeviceType;
    level: number;
  }>
> {
  const ancestors: Array<{
    id: string;
    name: string;
    type: InfrastructureDeviceType;
    level: number;
  }> = [];

  const visited = new Set<string>();
  let currentId: string | null = deviceId;
  let level = 1;

  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const [device] = await db
      .select()
      .from(networkInfrastructure)
      .where(eq(networkInfrastructure.id, currentId))
      .limit(1);

    if (!device || !device.parentId) break;

    const [parent] = await db
      .select()
      .from(networkInfrastructure)
      .where(eq(networkInfrastructure.id, device.parentId))
      .limit(1);

    if (!parent) break;

    ancestors.push({
      id: parent.id,
      name: parent.name,
      type: parent.type,
      level,
    });

    currentId = parent.id;
    level++;
  }

  return ancestors;
}

// 8. Ambil Pohon Relasi Hierarkis Utuh (Hierarchy Tree)
export async function getDeviceHierarchyTree(
  rootId?: string,
): Promise<HierarchyTreeNode[]> {
  const allDevices = await db.select().from(networkInfrastructure);
  const allRelations = await db
    .select()
    .from(networkDeviceRelations)
    .where(eq(networkDeviceRelations.relationType, "hierarchy"));

  const relationByChild = new Map(allRelations.map((r) => [r.childId, r]));

  // Buat lookup map device
  const deviceMap = new Map(
    allDevices.map((d) => [
      d.id,
      {
        id: d.id,
        name: d.name,
        type: d.type,
        status: d.status,
        latitude: Number(d.latitude),
        longitude: Number(d.longitude),
        capacity: d.capacity,
        usedCapacity: d.usedCapacity,
        parentId: d.parentId,
        parentPort: relationByChild.get(d.id)?.parentPort ?? null,
        childPort: relationByChild.get(d.id)?.childPort ?? null,
        relationType: relationByChild.get(d.id)?.relationType ?? "hierarchy",
        children: [] as HierarchyTreeNode[],
      },
    ]),
  );

  // Pasang relasi anak ke induk
  const roots: HierarchyTreeNode[] = [];

  for (const item of deviceMap.values()) {
    const parentId = item.parentId;
    if (parentId && deviceMap.has(parentId)) {
      deviceMap.get(parentId)!.children.push(item);
    } else {
      // Tidak punya induk atau induk tidak ditemukan di dataset -> root simpul
      roots.push(item);
    }
  }

  if (rootId) {
    const filteredRoot = deviceMap.get(rootId);
    return filteredRoot ? [filteredRoot] : [];
  }

  return roots;
}
