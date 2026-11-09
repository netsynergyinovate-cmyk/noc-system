import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const validatorPath = path.resolve(
  __dirname,
  "../src/validators/hierarchy-reassign.ts",
);
const servicePath = path.resolve(
  __dirname,
  "../src/services/network-hierarchy.service.ts",
);
const routePath = path.resolve(
  __dirname,
  "../src/app/api/map/hierarchy/reassign/route.ts",
);
const boardPath = path.resolve(
  __dirname,
  "../src/components/map/hierarchy-map-board.tsx",
);

test("Task: Buat Kontrol Pindah Anak ke Induk Lain (Reassign Parent Hierarchy)", async (t) => {
  const validatorContent = fs.readFileSync(validatorPath, "utf8");
  const serviceContent = fs.readFileSync(servicePath, "utf8");
  const routeContent = fs.readFileSync(routePath, "utf8");
  const boardContent = fs.readFileSync(boardPath, "utf8");

  await t.test(
    "1. Skema Validasi Zod reassignHierarchyParentSchema",
    async () => {
      const { reassignHierarchyParentSchema } =
        await import("../src/validators/hierarchy-reassign.ts");

      // Kasus valid: Pindah pelanggan ke ODP lain
      const validCust = reassignHierarchyParentSchema.safeParse({
        nodeId: "cust-01",
        nodeType: "customer",
        tier: 4,
        newParentId: "odp-02",
        newParentName: "ODP-KOTA-02",
      });
      assert.equal(
        validCust.success,
        true,
        "Payload valid pelanggan harus lolos validasi",
      );

      // Kasus valid: Pindah ODP ke ODC lain
      const validOdp = reassignHierarchyParentSchema.safeParse({
        nodeId: "odp-01",
        nodeType: "odp",
        tier: 3,
        newParentId: "odc-02",
        newParentName: "ODC-FEEDER-02",
      });
      assert.equal(
        validOdp.success,
        true,
        "Payload valid ODP harus lolos validasi",
      );

      // Kasus invalid: Tier 1 (Core Root tidak punya induk)
      const invalidTier = reassignHierarchyParentSchema.safeParse({
        nodeId: "core-01",
        nodeType: "odc",
        tier: 1,
        newParentId: "core-02",
        newParentName: "Core-02",
      });
      assert.equal(
        invalidTier.success,
        false,
        "Tier 1 tidak boleh memiliki induk",
      );

      // Kasus invalid: Kosong
      const emptyPayload = reassignHierarchyParentSchema.safeParse({});
      assert.equal(emptyPayload.success, false, "Payload kosong harus ditolak");
    },
  );

  await t.test(
    "2. Service reassignHierarchyParent: Update Database PostgreSQL",
    () => {
      assert.match(
        serviceContent,
        /export async function reassignHierarchyParent/,
        "Wajib mengekspor fungsi reassignHierarchyParent",
      );
      assert.match(
        serviceContent,
        /db[\s\S]*?\.update\(customers\)[\s\S]*?odpName:\s*input\.newParentName/,
        "Wajib memperbarui kolom odpName pada tabel customers saat pelanggan dipindahkan",
      );
      assert.match(
        serviceContent,
        /db[\s\S]*?\.update\(networkInfrastructure\)[\s\S]*?parentId:\s*input\.newParentId/,
        "Wajib memperbarui kolom parentId pada tabel networkInfrastructure saat ODP/ODC dipindahkan",
      );
    },
  );

  await t.test("3. Endpoint API POST /api/map/hierarchy/reassign", () => {
    assert.match(
      routeContent,
      /export async function POST\(request:\s*Request\)/,
      "Endpoint wajib menyediakan HTTP handler POST",
    );
    assert.match(
      routeContent,
      /withApiSession/,
      "Endpoint wajib diproteksi dengan withApiSession",
    );
    assert.match(
      routeContent,
      /reassignHierarchyParentSchema\.safeParse\(body\)/,
      "Endpoint wajib memvalidasi input menggunakan reassignHierarchyParentSchema",
    );
  });

  await t.test("4. Kontrol UI Tombol 'Pindah Induk' di Detail Simpul", () => {
    assert.match(
      boardContent,
      /data-testid="reassign-parent-button"/,
      "Panel detail simpul wajib memiliki tombol reassign-parent-button",
    );
    assert.match(
      boardContent,
      /selectedNode\.tier >= 2/,
      "Tombol pindah induk hanya muncul untuk simpul bertingkat >= 2 (yang memiliki induk)",
    );
  });

  await t.test("5. Kontrol UI Dialog Interaktif & Seleksi Induk Baru", () => {
    assert.match(
      boardContent,
      /data-testid="reassign-parent-dialog"/,
      "Wajib memiliki kontainer dialog reassign-parent-dialog",
    );
    assert.match(
      boardContent,
      /data-testid="new-parent-select"/,
      "Wajib memiliki dropdown pemilihan induk baru new-parent-select",
    );
    assert.match(
      boardContent,
      /data-testid="confirm-reassign-button"/,
      "Wajib memiliki tombol konfirmasi confirm-reassign-button",
    );
    assert.match(
      boardContent,
      /data-testid="cancel-reassign-button"/,
      "Wajib memiliki tombol pembatalan cancel-reassign-button",
    );
    assert.match(
      boardContent,
      /fetch\("\/api\/map\/hierarchy\/reassign"/,
      "Konfirmasi pemindahan induk wajib mengirimkan permintaan ke endpoint /api/map/hierarchy/reassign",
    );
  });
});
