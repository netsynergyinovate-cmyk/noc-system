import "server-only";
import { probeRouterApi } from "@/services/router-api-test.service";
import { withRouterOsApi, type RouterOsConn } from "@/lib/mikrotik/api-client";
import {
  buildProvisionPlan,
  groupPolicyFix,
  missingGroupPolicies,
  parseServices,
  pickSourceIp,
  provisionWarnings,
  type ProvisionOptions,
  type RouterInspection,
} from "@/lib/mikrotik/provision-plan";
import { redactSecrets } from "@/services/device-connection-tester";
import { outboundSourceIp } from "@/services/outbound-source-ip";

export { buildProvisionPlan } from "@/lib/mikrotik/provision-plan";
export type { ProvisionOptions, RouterInspection };

export type ProvisionResult = {
  steps: Array<{
    label: string;
    ok: boolean;
    error?: string;
    skipped?: boolean;
    terminal?: string;
    note?: string;
  }>;
  rest?: { host: string; port: number; useSsl: boolean };
  verify?: { ok: boolean; code?: string; message: string };
  // Izin grup akun REST setelah apply (dibaca dari router); missing kosong = cukup.
  groupCheck?: { group: string; missing: string[]; fix: string | null };
};

const isTrue = (v: string | undefined) => v === "true" || v === "yes";

// "router" = dibaca dari sesi API kita di router (terverifikasi, NAT diperhitungkan); "server" = tebakan sisi server.
async function resolveServerIp(
  active: Array<Record<string, string>>,
  conn: RouterOsConn,
): Promise<Pick<RouterInspection, "serverIp" | "serverIpSource">> {
  const fromRouter = pickSourceIp(active, conn.username);
  if (fromRouter) return { serverIp: fromRouter, serverIpSource: "router" };
  const guess = await outboundSourceIp(
    conn.host,
    conn.port ?? (conn.tls ? 8729 : 8728),
  );
  return { serverIp: guess, serverIpSource: guess ? "server" : null };
}

export async function inspectRouter(
  conn: RouterOsConn,
): Promise<RouterInspection> {
  const data = await withRouterOsApi(conn, async (api) => ({
    resource: await api.run(["/system/resource/print"]),
    services: await api.run(["/ip/service/print"]),
    // Alamat sumber menurut router; bila tidak bisa dibaca (izin), jatuh ke alamat sisi server.
    active: await api.run(["/user/active/print"]).catch(() => []),
    groups: await api.run(["/user/group/print"]),
    users: await api.run(["/user/print"]),
    certs: await api.run(["/certificate/print"]),
  }));
  const version = data.resource[0]?.version ?? "";
  return {
    version,
    boardName: data.resource[0]?.["board-name"] ?? "",
    isV7: version.startsWith("7"),
    services: parseServices(data.services),
    groups: data.groups.map((g) => ({
      id: g[".id"],
      name: g.name,
      policy: g.policy ?? "",
    })),
    users: data.users.map((u) => ({ id: u[".id"], name: u.name })),
    certificates: data.certs.map((c) => ({
      name: c.name,
      trusted: isTrue(c.trusted),
      invalid: isTrue(c.invalid),
    })),
    ...(await resolveServerIp(data.active, conn)),
  };
}

export async function applyProvision(
  conn: RouterOsConn,
  opts: ProvisionOptions,
): Promise<ProvisionResult> {
  const secrets = { username: conn.username, password: conn.password };
  const scrub = (m: string) =>
    redactSecrets(redactSecrets(m, secrets), {
      username: opts.restUser,
      password: opts.restPassword,
    });
  // Satu sesi: inspeksi segar + eksekusi, supaya id/alamat tidak basi.
  const steps: ProvisionResult["steps"] = [];
  let wwwPorts = { www: 80, "www-ssl": 443 };
  let groupCheck: ProvisionResult["groupCheck"];
  await withRouterOsApi(conn, async (api) => {
    const current = {
      services: parseServices(await api.run(["/ip/service/print"])),
      groups: (await api.run(["/user/group/print"])).map((g) => ({
        id: g[".id"],
        name: g.name,
        policy: g.policy ?? "",
      })),
      users: (await api.run(["/user/print"])).map((u) => ({
        id: u[".id"],
        name: u.name,
      })),
      certificates: (await api.run(["/certificate/print"])).map((c) => ({
        name: c.name,
        trusted: isTrue(c.trusted),
        invalid: isTrue(c.invalid),
      })),
    };
    wwwPorts = {
      www: Number(current.services.find((s) => s.name === "www")?.port) || 80,
      "www-ssl":
        Number(current.services.find((s) => s.name === "www-ssl")?.port) || 443,
    };
    const plan = buildProvisionPlan(opts, current, conn.username);
    for (const [i, step] of plan.entries()) {
      try {
        await api.run(step.words);
        steps.push({ label: step.label, ok: true, terminal: step.terminal });
      } catch (e) {
        const msg = scrub(e instanceof Error ? e.message : String(e));
        if (step.tolerateDenied && /not enough permissions/i.test(msg)) {
          // Akun login tidak berhak mengubah akun yang sudah ada; lanjut, password diuji lewat verifikasi REST.
          steps.push({
            label: step.label,
            ok: true,
            note: "dilewati: tidak ada izin; akun dipakai apa adanya (password diuji di verifikasi)",
            terminal: step.terminal,
          });
          continue;
        }
        steps.push({
          label: step.label,
          ok: false,
          error: scrub(e instanceof Error ? e.message : String(e)),
          terminal: step.terminal,
        });
        // Langkah sesudahnya tidak dijalankan; perintah terminalnya tetap dikirim agar bisa dijalankan manual.
        for (const rest of plan.slice(i + 1))
          steps.push({
            label: rest.label,
            ok: false,
            skipped: true,
            terminal: rest.terminal,
          });
        return;
      }
    }
    // Grup yang benar-benar dipakai akun REST (bisa berbeda dari restGroup bila akun lama tidak diperbarui).
    const rest = (await api.run(["/user/print"])).find(
      (u) => u.name === opts.restUser,
    );
    const groupName = rest?.group ?? opts.restGroup;
    const grp = (await api.run(["/user/group/print"])).find(
      (g) => g.name === groupName,
    );
    if (grp) {
      const policy = grp.policy ?? "";
      const missing = missingGroupPolicies(policy);
      groupCheck = {
        group: groupName,
        missing,
        fix: missing.length ? groupPolicyFix(groupName, policy) : null,
      };
    }
  });
  if (steps.some((s) => !s.ok)) return { steps };

  const useSsl = opts.enableWwwSsl && !opts.enableWww;
  const port = useSsl ? wwwPorts["www-ssl"] : wwwPorts.www;
  const client = await probeRouterApi({
    host: conn.host,
    port,
    protocol: "rest",
    useSsl,
    username: opts.restUser,
    password: opts.restPassword,
  });
  return {
    steps,
    rest: { host: conn.host, port, useSsl },
    verify: {
      ok: client.ok,
      code: client.code,
      message: scrub(client.message),
    },
    groupCheck,
  };
}

export async function previewProvision(
  conn: RouterOsConn,
  opts: ProvisionOptions,
) {
  const current = await inspectRouter(conn);
  return {
    plan: buildProvisionPlan(opts, current, conn.username).map((s) => ({
      label: s.label,
      display: s.display,
      terminal: s.terminal,
    })),
    warnings: provisionWarnings(opts, current),
  };
}
