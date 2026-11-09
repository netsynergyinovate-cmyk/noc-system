// Rencana provisioning REST murni (tanpa jaringan): dipakai untuk pratinjau dan eksekusi.

export type ProvisionOptions = {
  enableWww: boolean;
  enableWwwSsl: boolean;
  wwwSslCertificate?: string;
  allowedAddress: string;
  restUser: string;
  restPassword: string;
  restGroup: string;
};

export type RouterInspection = {
  version: string;
  boardName: string;
  isV7: boolean;
  services: Array<{
    id: string;
    name: string;
    port: string;
    address: string;
    disabled: boolean;
    certificate?: string;
  }>;
  groups: Array<{ id: string; name: string; policy: string }>;
  users: Array<{ id: string; name: string }>;
  certificates: Array<{ name: string; trusted: boolean; invalid: boolean }>;
  serverIp: string | null;
  serverIpSource: "router" | "server" | null;
};

export type ProvisionStep = {
  label: string;
  words: string[];
  display: string;
  terminal: string;
  tolerateDenied?: boolean;
};

// write dibutuhkan agar aplikasi bisa mengubah konfigurasi router (bukan hanya memantau).
export const REST_GROUP_POLICY = "read,write,api,rest-api,test";
const REST_GROUP_REQUIRED = ["read", "write", "api", "rest-api"];

const PASSWORD_PLACEHOLDER = "<KATA-SANDI>";

// Kata API ("/user/group/add", "=name=x") -> perintah terminal MikroTik ("/user group add name=x"); =.id=*N jadi argumen posisi.
export function toTerminal(words: string[]): string {
  const [cmd, ...args] = words;
  const out = ["/" + cmd.slice(1).replace(/\//g, " ")];
  for (const w of args) {
    const m = /^=([^=]*)=([\s\S]*)$/.exec(w);
    if (!m) continue;
    if (m[1] === ".id") out.push(m[2]);
    else
      out.push(/[\s"<>]/.test(m[2]) ? `${m[1]}="${m[2]}"` : `${m[1]}=${m[2]}`);
  }
  return out.join(" ");
}

function mergeAddress(
  service: { address: string; disabled: boolean },
  add: string,
): string {
  const list = service.address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Kosong + sudah aktif = sudah terbuka untuk semua; jangan disempitkan. Kosong + nonaktif: jangan membukanya ke semua.
  if (list.length === 0) return service.disabled ? add : "";
  return list.includes(add) ? list.join(",") : [...list, add].join(",");
}

export function buildProvisionPlan(
  opts: ProvisionOptions,
  current: Pick<
    RouterInspection,
    "services" | "groups" | "users" | "certificates"
  >,
  bootstrapUser?: string,
): ProvisionStep[] {
  // Mengubah akun bootstrap ke grup REST akan mencabut hak admin dan mengunci operator.
  if (bootstrapUser !== undefined && opts.restUser === bootstrapUser) {
    throw new Error(
      "Akun REST tidak boleh sama dengan akun admin yang dipakai masuk",
    );
  }
  const steps: ProvisionStep[] = [];
  const push = (
    label: string,
    words: string[],
    secretWord?: string,
    terminal?: string,
    tolerateDenied?: boolean,
  ) => {
    const shown = words.map((w) =>
      secretWord && w === secretWord ? `=password=${PASSWORD_PLACEHOLDER}` : w,
    );
    steps.push({
      label,
      words,
      display: shown.join(" "),
      terminal: terminal ?? toTerminal(shown),
      ...(tolerateDenied && { tolerateDenied }),
    });
  };

  if (!current.groups.some((g) => g.name === opts.restGroup)) {
    push(`Buat grup ${opts.restGroup}`, [
      "/user/group/add",
      `=name=${opts.restGroup}`,
      `=policy=${REST_GROUP_POLICY}`,
    ]);
  }

  const pw = `=password=${opts.restPassword}`;
  const user = current.users.find((u) => u.name === opts.restUser);
  if (user) {
    // Akun sudah ada: pembaruan butuh izin policy; bila ditolak, akun dipakai apa adanya dan diuji lewat verifikasi REST.
    push(
      `Perbarui akun ${opts.restUser}`,
      ["/user/set", `=.id=${user.id}`, `=group=${opts.restGroup}`, pw],
      pw,
      `/user set [find name=${opts.restUser}] group=${opts.restGroup} password="${PASSWORD_PLACEHOLDER}"`,
      true,
    );
  } else {
    push(
      `Buat akun ${opts.restUser}`,
      ["/user/add", `=name=${opts.restUser}`, `=group=${opts.restGroup}`, pw],
      pw,
    );
  }

  const service = (name: string) => {
    const s = current.services.find((x) => x.name === name);
    if (!s) throw new Error(`Layanan ${name} tidak ditemukan di router`);
    return s;
  };

  if (opts.enableWww) {
    const s = service("www");
    const address = mergeAddress(s, opts.allowedAddress);
    push(
      "Aktifkan www",
      [
        "/ip/service/set",
        `=.id=${s.id}`,
        "=disabled=no",
        `=address=${address}`,
      ],
      undefined,
      `/ip service set [find name=www dynamic=no] disabled=no address=${address}`,
    );
  }
  if (opts.enableWwwSsl) {
    if (
      !opts.wwwSslCertificate ||
      !current.certificates.some((c) => c.name === opts.wwwSslCertificate)
    ) {
      throw new Error("Sertifikat www-ssl wajib dipilih");
    }
    const s = service("www-ssl");
    const address = mergeAddress(s, opts.allowedAddress);
    push(
      "Aktifkan www-ssl",
      [
        "/ip/service/set",
        `=.id=${s.id}`,
        "=disabled=no",
        `=certificate=${opts.wwwSslCertificate}`,
        `=address=${address}`,
      ],
      undefined,
      `/ip service set [find name=www-ssl dynamic=no] disabled=no certificate=${opts.wwwSslCertificate} address=${address}`,
    );
  }
  return steps;
}

// Peringatan non-fatal untuk pratinjau.
export function provisionWarnings(
  opts: ProvisionOptions,
  current: Pick<RouterInspection, "groups">,
): string[] {
  const g = current.groups.find((x) => x.name === opts.restGroup);
  if (!g) return [];
  const have = new Set(g.policy.split(",").map((p) => p.trim()));
  const missing = REST_GROUP_REQUIRED.filter((p) => !have.has(p));
  return [
    missing.length
      ? `Grup ${g.name} sudah ada dan tidak diubah, tetapi belum memuat izin: ${missing.join(", ")}. Tambahkan di router (mis. /user group set ${g.name} policy=${REST_GROUP_POLICY}).`
      : `Grup ${g.name} sudah ada dengan izin yang cukup; tidak diubah.`,
  ];
}

const isTrue = (v: string | undefined) => v === "true" || v === "yes";

// RouterOS 7 mencantumkan baris dinamis per koneksi (flag D/c) dengan nama layanan sama; .id-nya tidak bisa di-set
// dan tidak punya address/port. Hanya baris statis yang dipakai.
export function parseServices(
  rows: Array<Record<string, string>>,
): RouterInspection["services"] {
  return rows
    .filter(
      (s) =>
        !isTrue(s.dynamic) &&
        !isTrue(s.connection) &&
        (s.name === "www" || s.name === "www-ssl"),
    )
    .map((s) => ({
      id: s[".id"],
      name: s.name,
      port: s.port ?? "",
      address: s.address ?? "",
      disabled: isTrue(s.disabled),
      certificate: s.certificate || undefined,
    }));
}

// Alamat sumber sesi API kita sendiri seperti yang dilihat router (sudah memperhitungkan NAT); entri terakhir = terbaru.
export function pickSourceIp(
  active: Array<Record<string, string>>,
  username: string,
): string | null {
  const mine = active.filter(
    (r) =>
      r.name === username &&
      (r.via === "api" || r.via === "api-ssl") &&
      r.address,
  );
  return mine.length ? mine[mine.length - 1].address : null;
}

// Izin wajib grup akun REST yang kurang (izin berawalan "!" = dimatikan, dianggap tidak ada).
export function missingGroupPolicies(policy: string): string[] {
  const have = new Set(
    policy
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p && !p.startsWith("!")),
  );
  return REST_GROUP_REQUIRED.filter((p) => !have.has(p));
}

// Perintah terminal yang menambah izin yang kurang tanpa mencabut izin yang sudah aktif.
export function groupPolicyFix(group: string, policy: string): string {
  const have = policy
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("!"));
  return `/user group set [find name=${group}] policy=${[...new Set([...have, ...missingGroupPolicies(policy)])].join(",")}`;
}
