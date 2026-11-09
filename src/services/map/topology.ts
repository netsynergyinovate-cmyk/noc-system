// Logika relasi murni (tanpa DB) agar dipakai server dan klien serta mudah diuji.

type DeviceLink = { id: string; parentDeviceId: string | null };
type SegmentLink = { sequence: number; toDeviceId: string | null };

// true bila parentId = id atau keturunan id, sehingga pohon induk–anak jadi siklus
export function createsCycle(
  devices: DeviceLink[],
  id: string,
  parentId: string | null,
): boolean {
  const parentOf = new Map(devices.map((d) => [d.id, d.parentDeviceId]));
  const seen = new Set<string>();
  for (let cur = parentId; cur; cur = parentOf.get(cur) ?? null) {
    if (cur === id) return true;
    if (seen.has(cur)) return false; // siklus lama di data, bukan akibat perubahan ini
    seen.add(cur);
  }
  return false;
}

// Perangkat terakhir pada rantai jalur; drop pelanggan tidak memindahkan ujung rantai
export function chainEndDeviceId(
  routeFromDeviceId: string,
  segments: SegmentLink[],
): string {
  const last = [...segments]
    .sort((a, b) => b.sequence - a.sequence)
    .find((s) => s.toDeviceId);
  return last?.toDeviceId ?? routeFromDeviceId;
}

// Urutan perangkat rantai jalur (asal → ODC → ODP …) menurut sequence segmen; drop pelanggan dilewati
export function routeChainDeviceIds(
  routeFromDeviceId: string,
  segments: SegmentLink[],
): string[] {
  const ids = [routeFromDeviceId];
  for (const s of [...segments].sort((a, b) => a.sequence - b.sequence)) {
    if (s.toDeviceId && !ids.includes(s.toDeviceId)) ids.push(s.toDeviceId);
  }
  return ids;
}

// shortcut: PON jalur hanya tersimpan di kode (…-PON<n> atau …-PON<n>-<urut>); tambah kolom bila perlu disaring per PON
/** Nama ikut jenis baru: awalan "ODP"/"ODC" ditukar (ODP 1 Mekar Jaya -> ODC 1 Mekar Jaya); nama lain tetap */
export function renameForType(name: string, type: "odp" | "odc"): string {
  return name.replace(/^od[pc](?![a-z])/i, (m) =>
    m === m.toLowerCase() ? type : type.toUpperCase(),
  );
}

export function routePon(code: string): number | null {
  const m = /-PON(\d+)(?:-\d+)?$/i.exec(code);
  return m ? Number(m[1]) : null;
}

// Jumlah port PON OLT: data port dari pusat, lalu "8 PON" di nama, lalu kapasitas; terakhir 16
export function oltPonCount(olt: {
  name: string;
  capacity: number;
  ponPorts?: unknown[];
}): number {
  if (olt.ponPorts?.length) return olt.ponPorts.length;
  const fromName = /(\d+)\s*PON/i.exec(olt.name);
  if (fromName) return Number(fromName[1]);
  return olt.capacity > 0 ? olt.capacity : 16;
}

type TreeDevice = DeviceLink & {
  name: string;
  type: "server" | "odc" | "odp" | "pole";
  latitude: number;
  longitude: number;
  status: string;
};
type TreeCustomer = {
  id: string;
  name: string;
  customerNumber: string;
  latitude: number | null;
  longitude: number | null;
  status: string | null;
  odpId?: string | null;
};
export type TreeNode = {
  id: string;
  name: string;
  type: TreeDevice["type"] | "customer";
  latitude?: number;
  longitude?: number;
  status: string;
  children: TreeNode[];
};

// Pohon server → ODC → ODP → pelanggan dari data yang sudah dimuat (tanpa panggilan API kedua)
export function buildHierarchyTree(
  devices: TreeDevice[],
  customers: TreeCustomer[],
): TreeNode[] {
  const nodes = new Map<string, TreeNode>(
    devices.map((d) => [
      d.id,
      {
        id: d.id,
        name: d.name,
        type: d.type,
        latitude: d.latitude,
        longitude: d.longitude,
        status: d.status,
        children: [],
      },
    ]),
  );
  for (const c of customers) {
    const odp = c.odpId ? nodes.get(c.odpId) : undefined;
    odp?.children.push({
      id: c.id,
      name: `${c.name} (${c.customerNumber})`,
      type: "customer",
      latitude: c.latitude ?? undefined,
      longitude: c.longitude ?? undefined,
      status: c.status || "unknown",
      children: [],
    });
  }
  const roots: TreeNode[] = [];
  for (const d of devices) {
    const parent = d.parentDeviceId ? nodes.get(d.parentDeviceId) : undefined;
    // Induk yang membentuk siklus di data lama dijadikan akar agar node tidak hilang
    if (parent && !createsCycle(devices, d.id, d.parentDeviceId)) {
      parent.children.push(nodes.get(d.id)!);
    } else {
      roots.push(nodes.get(d.id)!);
    }
  }
  return roots;
}
