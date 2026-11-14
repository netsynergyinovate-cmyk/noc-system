"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Inspection = {
  ok: true;
  version: string;
  boardName: string;
  isV7: boolean;
  services: Array<{
    name: string;
    port: string;
    address: string;
    disabled: boolean;
  }>;
  certificates: Array<{ name: string; trusted: boolean; invalid: boolean }>;
  serverIp: string | null;
  serverIpSource: "router" | "server" | null;
};
type Failure = {
  ok: false;
  code: string;
  message: string;
  sourceIp?: string | null;
};
type ApplyResult = {
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
  groupCheck?: GroupCheck;
};

export type GroupCheck = {
  group: string;
  missing: string[];
  fix: string | null;
};
export type ProvisionedConnection = {
  host: string;
  port: number | undefined;
  useSsl: boolean;
  username: string;
  password: string;
  groupCheck?: GroupCheck;
};

type Detect = {
  host: string;
  ports: Array<{ port: number; open: boolean; localIp: string | null }>;
  publicIp: string | null;
  inContainer?: boolean;
};

// Izin grup akun REST dibaca dari router setelah apply; write wajib agar aplikasi bisa menjalankan perintah ke router.
export function GroupCheckNotice({
  check,
  onlyProblem = false,
}: {
  check?: GroupCheck;
  onlyProblem?: boolean;
}) {
  if (!check) return null;
  if (check.missing.length === 0) {
    return onlyProblem ? null : (
      <p className="text-xs text-muted-foreground">
        Izin grup {check.group} cukup.
      </p>
    );
  }
  return (
    <div className="space-y-1 text-xs">
      <p className="text-amber-600">
        Grup <code>{check.group}</code> belum memuat izin:{" "}
        {check.missing.join(", ")}. <code>write</code> dibutuhkan agar aplikasi
        bisa menjalankan perintah ke router. Jalankan di terminal MikroTik:
      </p>
      <pre className="overflow-x-auto rounded bg-muted p-2">{check.fix}</pre>
    </div>
  );
}

function randomPassword(len = 20) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function post<T>(url: string, body: unknown): Promise<T | Failure> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok)
    return {
      ok: false,
      code: json?.error?.code ?? "ERROR",
      message: json?.error?.message ?? `Gagal (${res.status}).`,
    };
  return json.data as T;
}

const selectClass =
  "h-9 w-full rounded-md border bg-transparent px-3 text-sm disabled:opacity-50";

export function RouterBootstrapPanel({
  onProvisioned,
}: {
  onProvisioned: (c: ProvisionedConnection) => void;
}) {
  const [host, setHost] = useState("");
  const [apiPort, setApiPort] = useState("");
  const [apiTls, setApiTls] = useState(false);
  const [adminUser, setAdminUser] = useState("");
  const [adminPass, setAdminPass] = useState("");

  const [info, setInfo] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceIp, setSourceIp] = useState<string | null>(null);
  const [cand, setCand] = useState<Detect | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [serverIp, setServerIp] = useState("");
  const [manualPort, setManualPort] = useState("");

  const [enableWww, setEnableWww] = useState(true);
  const [enableWwwSsl, setEnableWwwSsl] = useState(false);
  const [cert, setCert] = useState("");
  const [allowed, setAllowed] = useState("");
  const [group, setGroup] = useState("noc-rest");
  const [restUser, setRestUser] = useState("noc-api");
  const [restPass, setRestPass] = useState("");

  const [plan, setPlan] = useState<{
    plan: Array<{ label: string; display: string; terminal: string }>;
    warnings: string[];
  } | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const connection = () => ({
    host: host.trim(),
    port: Number(apiPort) || undefined,
    tls: apiTls || undefined,
    username: adminUser.trim(),
    password: adminPass,
  });
  const options = () => ({
    enableWww,
    enableWwwSsl,
    ...(enableWwwSsl && cert && { wwwSslCertificate: cert }),
    allowedAddress: allowed.trim(),
    restUser: restUser.trim(),
    restPassword: restPass,
    restGroup: group.trim(),
  });

  // Deteksi otomatis begitu host terisi: uji port API (8728/8729) dan kumpulkan kandidat alamat server. Tanpa nilai bawaan.
  useEffect(() => {
    const h = host.trim();
    if (h.length < 3) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setDetecting(true);
      const r = await post<Omit<Detect, "host">>(
        "/api/routers/bootstrap/prepare",
        { host: h, port: Number(manualPort) || undefined },
      );
      if (cancelled) return;
      setDetecting(false);
      if ("ok" in r && r.ok === false) return setCand(null);
      const c = { ...(r as Omit<Detect, "host">), host: h };
      setCand(c);
      const open = c.ports.find((p) => p.open);
      if (!manualPort && open) {
        setApiPort(String(open.port));
        setApiTls(open.port === 8729);
      }
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [host, manualPort]);

  async function inspect() {
    setBusy(true);
    setError(null);
    setPlan(null);
    setResult(null);
    const r = await post<Inspection>(
      "/api/routers/bootstrap/inspect",
      connection(),
    );
    setBusy(false);
    if (!r.ok) {
      setInfo(null);
      setSourceIp(r.sourceIp ?? null);
      return setError(r.message);
    }
    setInfo(r);
    // Hanya alamat yang dibaca dari router yang dianggap terverifikasi; tebakan sisi server tidak mengisi allow-list.
    setAllowed(
      r.serverIpSource === "router" && r.serverIp ? `${r.serverIp}/32` : "",
    );
    const firstCert = r.certificates.find((c) => c.trusted && !c.invalid);
    setCert(firstCert?.name ?? "");
  }

  async function preview() {
    setBusy(true);
    setError(null);
    setPlan(null);
    const r = await post<{
      plan: Array<{ label: string; display: string; terminal: string }>;
      warnings: string[];
    }>("/api/routers/bootstrap/apply", {
      connection: connection(),
      options: options(),
      dryRun: true,
    });
    setBusy(false);
    if ("ok" in r && r.ok === false) return setError(r.message);
    setPlan(
      r as {
        plan: Array<{ label: string; display: string; terminal: string }>;
        warnings: string[];
      },
    );
  }

  async function apply() {
    const changed = [enableWww && "www", enableWwwSsl && "www-ssl"]
      .filter(Boolean)
      .join(" dan ");
    if (
      !window.confirm(
        `Router akan diubah: layanan ${changed || "(tidak ada)"}, grup ${group}, akun ${restUser}. Lanjutkan?`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    const r = await post<ApplyResult>("/api/routers/bootstrap/apply", {
      connection: connection(),
      options: options(),
    });
    setBusy(false);
    if ("ok" in r && r.ok === false) return setError(r.message);
    const res = r as ApplyResult;
    setResult(res);
    if (res.verify?.ok && res.rest) {
      // Port yang benar-benar diuji (dibaca dari router); bawaan 80/443 dibiarkan kosong di form.
      const isDefault = res.rest.port === (res.rest.useSsl ? 443 : 80);
      onProvisioned({
        host: res.rest.host,
        port: isDefault ? undefined : res.rest.port,
        useSsl: res.rest.useSsl,
        username: restUser.trim(),
        password: restPass,
        groupCheck: res.groupCheck,
      });
      setAdminPass(""); // kredensial admin tidak dipertahankan
    }
  }

  const trustedCerts =
    info?.certificates.filter((c) => c.trusted && !c.invalid) ?? [];
  const canApply =
    !!info?.isV7 &&
    (enableWww || enableWwwSsl) &&
    !!allowed &&
    restPass.length >= 8 &&
    (!enableWwwSsl || !!cert);

  const field = (label: string, hint: string, node: React.ReactNode) => (
    <div className="space-y-1">
      <label className="text-xs font-semibold">{label}</label>
      {node}
      <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
  const detected = cand && cand.host === host.trim() ? cand : null;
  const portOk =
    !!detected &&
    detected.ports.some((p) => p.open && String(p.port) === apiPort.trim());

  // Satu langkah = kartu isian di kiri, penjelasan di kanan (di luar kartu).
  const step = (
    n: number,
    title: string,
    body: React.ReactNode,
    desc: React.ReactNode,
  ) => (
    <section className="grid gap-3 lg:grid-cols-2 lg:gap-8">
      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">
          Langkah {n}: {title}
        </h3>
        {body}
      </div>
      <div className="space-y-2 text-sm text-muted-foreground lg:pt-4">
        {desc}
      </div>
    </section>
  );

  // Perintah terminal memakai password REST yang tampil di isian (placeholder diganti di sisi klien saja).
  const sub = (t: string) =>
    t.split("<KATA-SANDI>").join(restPass || "<PASSWORD-REST>");
  const explainFailure = (msg?: string) => {
    if (!msg) return "";
    if (/not enough permissions/i.test(msg))
      return "akun login tidak punya izin untuk langkah ini (membuat grup/akun butuh izin policy). Pakai akun dari grup full, atau jalankan perintah di bawah dengan akun admin.";
    if (/already (have|exists)|exists/i.test(msg))
      return "nama itu sudah dipakai di router; ganti nama grup/akun atau pakai yang sudah ada.";
    if (/invalid|failure|bad/i.test(msg))
      return "router menolak nilai yang dikirim; periksa nama, alamat, dan password.";
    return "router menolak perintah; lihat pesan di atas.";
  };

  return (
    <div className="mb-6 space-y-5">
      <h2 className="text-base font-semibold">
        Masuk ke MikroTik untuk menyiapkan REST otomatis
      </h2>

      {step(
        1,
        "Hubungkan ke router",
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {field(
              "Alamat router",
              "IP/host MikroTik yang dijangkau aplikasi.",
              <Input
                placeholder="IP atau host router"
                value={host}
                onChange={(e) => {
                  // Port dan hasil deteksi milik host sebelumnya tidak berlaku untuk host baru.
                  setHost(e.target.value);
                  setApiPort("");
                  setApiTls(false);
                  setManualPort("");
                  setCand(null);
                  setInfo(null);
                }}
              />,
            )}
            {field(
              "Port API",
              "8728/8729, bukan port Winbox. Terisi otomatis.",
              <Input
                placeholder="otomatis"
                inputMode="numeric"
                value={apiPort}
                onChange={(e) => {
                  setApiPort(e.target.value);
                  setManualPort(e.target.value);
                }}
              />,
            )}
            {field(
              "Username login",
              "Akun MikroTik untuk masuk sekali ini.",
              <Input
                placeholder="username"
                value={adminUser}
                onChange={(e) => setAdminUser(e.target.value)}
              />,
            )}
            {field(
              "Password login",
              "Dipakai selama proses ini, lalu dibuang.",
              <Input
                type="password"
                placeholder="password"
                autoComplete="off"
                value={adminPass}
                onChange={(e) => setAdminPass(e.target.value)}
              />,
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={apiTls}
              onChange={(e) => {
                setApiTls(e.target.checked);
                const match = cand?.ports.find(
                  (p) => p.open && (p.port === 8729) === e.target.checked,
                );
                setApiPort(match ? String(match.port) : "");
              }}
            />
            Pakai API-SSL (terenkripsi)
          </label>
          {detecting && (
            <p className="text-xs text-muted-foreground">
              Menguji port API dan mendeteksi alamat…
            </p>
          )}
          {detected && (
            <p className="text-xs text-muted-foreground">
              Port:{" "}
              {detected.ports
                .map((p) => `${p.port} ${p.open ? "terbuka" : "tertutup"}`)
                .join(", ")}
              .
            </p>
          )}
        </>,
        <>
          <p>
            Isi alamat router, lalu aplikasi menguji port API-nya sendiri dan
            mengisi port yang terbuka.
          </p>
          <p>
            <b>Akun login</b> harus berizin <code>read</code>,{" "}
            <code>write</code>, <code>api</code>, <code>rest-api</code>; tambah{" "}
            <code>policy</code> (atau grup <code>full</code>) agar akun REST
            bisa dibuat otomatis. Password tidak boleh kosong.
          </p>
          <p>
            Akun ini hanya dipakai sekali dan tidak disimpan. Port Winbox (mis.
            2024) tidak bisa dipakai di sini.
          </p>
        </>,
      )}

      {step(
        2,
        "Izinkan server aplikasi di router",
        detected ? (
          <>
            <p className="text-xs text-muted-foreground">
              Kandidat IP server aplikasi (belum terverifikasi): lokal{" "}
              <code>
                {detected.inContainer
                  ? "tidak diketahui (aplikasi di container Docker)"
                  : (detected.ports.find((p) => p.open)?.localIp ?? "-")}
              </code>
              , publik <code>{detected.publicIp ?? "-"}</code>.
            </p>
            {field(
              "IP server aplikasi (sisi router)",
              "Isi bila sudah tahu; kosongkan untuk memakai perintah A.",
              <Input
                placeholder="IP server aplikasi"
                value={serverIp}
                onChange={(e) => setServerIp(e.target.value)}
              />,
            )}
            <p className="text-xs font-medium">
              A. Aplikasi di komputer yang sama dengan Winbox Anda:
            </p>
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
              {[
                `:local s [/user active find where via=winbox]`,
                `:local ip [/user active get [:pick $s ([:len $s]-1)] address]`,
                `:put $ip`,
                `/ip service set [find name=api dynamic=no] disabled=no address=([/ip service get [find name=api dynamic=no] address],"$ip/32")`,
              ].join("\n")}
            </pre>
            {/^\d{1,3}(\.\d{1,3}){3}$/.test(serverIp.trim()) && (
              <>
                <p className="text-xs font-medium">B. Server di tempat lain:</p>
                <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                  {[
                    `/ip service set [find name=api dynamic=no] disabled=no address=([/ip service get [find name=api dynamic=no] address],${serverIp.trim()}/32)`,
                    `# bila masih ditolak: jalankan tepat setelah klik "Masuk & periksa"; src-address = IP yang benar`,
                    `/ip firewall connection print where protocol=tcp dst-port=${Number(apiPort) || 8728}`,
                  ].join("\n")}
                </pre>
              </>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Muncul setelah alamat router diisi dan port diuji.
          </p>
        ),
        <>
          <p>
            Router hanya menerima API dari alamat yang tercantum di{" "}
            <code>/ip service</code> layanan <code>api</code>. Jalankan perintah
            di terminal MikroTik (Winbox) agar <b>IP server aplikasi</b>, yaitu
            komputer tempat aplikasi ini berjalan dilihat dari router,
            diizinkan. Alamat lama tetap dipertahankan.
          </p>
          <p>
            Alamat pasti baru diketahui setelah login berhasil. Di belakang
            NAT/PPPoE, router bisa melihat alamat lain dari kandidat di kiri.
            Sintaks array belum diuji di semua versi; periksa dengan{" "}
            <code>/ip service print where name=api</code>.
          </p>
          {error && sourceIp && (
            <div>
              <p>
                Perkiraan alamat server aplikasi yang dilihat router:{" "}
                <code>{sourceIp}</code> (belum terverifikasi):
              </p>
              <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">{`/ip service set [find name=api dynamic=no] disabled=no address=([/ip service get [find name=api dynamic=no] address],${sourceIp}/32)`}</pre>
            </div>
          )}
          {error && (
            <div>
              <p>
                Alamat pasti: catat koneksi masuk, klik &quot;Masuk &amp;
                periksa&quot;, lalu baca <code>src-address</code> di log (rule
                hanya mencatat; hapus setelahnya):
              </p>
              <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
                {[
                  `/ip firewall filter add chain=input protocol=tcp dst-port=${Number(apiPort) || 8728} action=log log-prefix=APP-API place-before=0 comment=tmp-api-log`,
                  `/log print where message~"APP-API"`,
                  `/ip firewall filter remove [find comment=tmp-api-log]`,
                ].join("\n")}
              </pre>
            </div>
          )}
          <details open={!!error}>
            <summary className="cursor-pointer font-medium text-foreground">
              Tidak bisa masuk?
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Port ini API biner RouterOS, bukan Winbox, SSH, atau REST. Hanya
                RouterOS v7.
              </li>
              <li>
                <b>Login ditolak</b>: username/password salah, atau akun tidak
                berhak (coba grup <code>full</code>).
              </li>
              <li>
                <b>Koneksi ditutup</b>: IP server aplikasi belum ada di{" "}
                <code>address</code> layanan <code>api</code>, atau firewall
                memblokir.
              </li>
              <li>
                <b>Timeout</b>: port tidak diteruskan ke API router.
              </li>
            </ul>
          </details>
        </>,
      )}

      {step(
        3,
        "Masuk & periksa router",
        <>
          <Button
            type="button"
            onClick={inspect}
            disabled={busy || !adminUser.trim() || !adminPass || !portOk}
          >
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}Masuk
            &amp; periksa
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && (
            <div className="space-y-2 text-sm">
              <p>
                RouterOS {info.version} · {info.boardName}
              </p>
              <p>
                IP server aplikasi:{" "}
                <code>{info.serverIp ?? "tidak terdeteksi"}</code>
                {info.serverIp &&
                  (info.serverIpSource === "router"
                    ? " (terverifikasi dari router)"
                    : " (kandidat sisi server, belum terverifikasi)")}
              </p>
              <ul className="list-disc pl-5">
                {info.services.map((s) => (
                  <li key={s.name}>
                    {s.name}: {s.disabled ? "nonaktif" : "aktif"}, port {s.port}
                    , address {s.address || "(semua)"}
                  </li>
                ))}
              </ul>
              {!info.isV7 && (
                <p className="text-destructive">
                  RouterOS di bawah v7: REST tidak tersedia.
                </p>
              )}
            </div>
          )}
        </>,
        <>
          <p>
            Aplikasi masuk lewat API, membaca versi, status layanan{" "}
            <code>www</code>/<code>www-ssl</code>, dan sertifikat. Belum ada
            yang diubah di router.
          </p>
          <p>
            Alamat server yang <b>terverifikasi</b> dibaca langsung dari sesi
            API kita di router, dan dipakai untuk membatasi akses REST di
            langkah berikutnya.
          </p>
        </>,
      )}

      {info?.isV7 &&
        step(
          4,
          "Atur REST di router",
          <div className="space-y-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={enableWww}
                onChange={(e) => setEnableWww(e.target.checked)}
              />{" "}
              Aktifkan www (HTTP)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={enableWwwSsl}
                onChange={(e) => setEnableWwwSsl(e.target.checked)}
                disabled={trustedCerts.length === 0}
              />
              Aktifkan www-ssl (HTTPS)
            </label>
            <select
              className={selectClass}
              value={cert}
              onChange={(e) => setCert(e.target.value)}
              disabled={!enableWwwSsl || trustedCerts.length === 0}
            >
              {trustedCerts.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-2">
              {field(
                "Alamat server yang diizinkan",
                "IP/CIDR server aplikasi seperti dilihat router.",
                <Input
                  placeholder="IP/CIDR"
                  value={allowed}
                  onChange={(e) => setAllowed(e.target.value)}
                />,
              )}
              {field(
                "Grup REST",
                "Grup baru dengan izin API/REST.",
                <Input
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                />,
              )}
              {field(
                "Username REST",
                "Akun yang disimpan aplikasi.",
                <Input
                  value={restUser}
                  onChange={(e) => setRestUser(e.target.value)}
                />,
              )}
              {field(
                "Password REST",
                "Min. 8 karakter. Salin sebelum menerapkan.",
                <div className="flex gap-2">
                  <Input
                    type="text"
                    autoComplete="off"
                    value={restPass}
                    onChange={(e) => setRestPass(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setRestPass(randomPassword())}
                  >
                    Buat acak
                  </Button>
                </div>,
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={preview}
                disabled={busy || !canApply}
              >
                Pratinjau perintah
              </Button>
              <Button
                type="button"
                onClick={apply}
                disabled={busy || !canApply}
              >
                Terapkan ke router
              </Button>
            </div>
            {plan && (
              <div className="space-y-1">
                {plan.warnings.map((w) => (
                  <p key={w} className="text-amber-600">
                    {w}
                  </p>
                ))}
                <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                  {plan.plan.map((p) => sub(p.terminal)).join("\n")}
                </pre>
              </div>
            )}
          </div>,
          <>
            <p>
              Aplikasi membuat grup dan akun REST, lalu mengaktifkan{" "}
              <code>www</code> (HTTP) atau <code>www-ssl</code> (HTTPS, butuh
              sertifikat tepercaya; self-signed ditolak).
            </p>
            <p>
              <b>Alamat server yang diizinkan</b> membatasi REST ke satu alamat.{" "}
              <b>Username/Password REST</b> adalah akun yang disimpan aplikasi,
              berbeda dari akun login di langkah 1. Salin passwordnya sebelum
              menerapkan; tidak ditampilkan lagi. Bila akun REST sudah Anda buat
              sendiri di Winbox, isi &quot;Password REST&quot; dengan password
              yang Anda pasang di sana (jangan &quot;Buat acak&quot;).
            </p>
            <p>
              <b>Grup REST</b> dibuat berizin <code>read</code>,{" "}
              <code>write</code>, <code>api</code>, <code>rest-api</code>,{" "}
              <code>test</code>. <code>write</code> wajib agar setelah
              terhubung, aplikasi bisa menjalankan perintah ke router langsung
              dari aplikasi, bukan hanya memantau. Grup yang sudah ada tidak
              diubah; kekurangan izinnya ditampilkan di pratinjau.
            </p>
            <p>
              &quot;Pratinjau perintah&quot; hanya menampilkan perintah tanpa
              mengubah router.
            </p>
          </>,
        )}

      {result &&
        step(
          5,
          "Hasil",
          <div className="space-y-3 text-sm">
            <ul>
              {result.steps.map((s) => (
                <li
                  key={s.label}
                  className={
                    s.ok
                      ? ""
                      : s.skipped
                        ? "text-muted-foreground"
                        : "text-destructive"
                  }
                >
                  {s.ok ? "✓" : s.skipped ? "–" : "✗"} {s.label}
                  {s.error
                    ? `: ${s.error}`
                    : s.skipped
                      ? " (dilewati)"
                      : s.note
                        ? ` (${s.note})`
                        : ""}
                </li>
              ))}
            </ul>
            {result.steps.some((s) => !s.ok) && (
              <div className="space-y-2">
                <p className="font-medium text-destructive">
                  Penyebab:{" "}
                  {explainFailure(result.steps.find((s) => s.error)?.error)}
                </p>
                <p>
                  Jalankan di terminal MikroTik (Winbox) dengan akun berizin
                  penuh, berurutan:
                </p>
                <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                  {result.steps
                    .filter((s) => !s.ok && s.terminal)
                    .map((s) => sub(s.terminal!))
                    .join("\n")}
                </pre>
              </div>
            )}
            {result.verify && (
              <div className="space-y-1">
                <p
                  className={
                    result.verify.ok ? "text-green-600" : "text-destructive"
                  }
                >
                  Verifikasi REST:{" "}
                  {result.verify.ok ? "berhasil." : result.verify.message}
                </p>
                <GroupCheckNotice check={result.groupCheck} />
                {result.steps.some((s) => s.note) && (
                  <p
                    className={
                      result.verify.ok
                        ? "text-muted-foreground"
                        : "text-amber-600"
                    }
                  >
                    Akun REST tidak diubah (izin tidak ada), jadi password yang
                    berlaku adalah yang sudah terpasang di router. Pastikan
                    &quot;Password REST&quot; sama dengan itu
                    {!result.verify.ok &&
                    /auth|401|unauthor|password|login/i.test(
                      `${result.verify.code ?? ""} ${result.verify.message}`,
                    )
                      ? "; verifikasi gagal login, kemungkinan besar karena password tidak sama."
                      : "."}
                  </p>
                )}
                {!result.verify.ok && (
                  <>
                    <p>
                      Periksa di terminal MikroTik bahwa www aktif dan alamat
                      server diizinkan:
                    </p>
                    <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{`/ip service print where name~"www"`}</pre>
                  </>
                )}
              </div>
            )}
          </div>,
          <>
            <p>
              <span aria-hidden>✓</span> berhasil, <span aria-hidden>✗</span>{" "}
              gagal, <span aria-hidden>–</span> dilewati karena langkah
              sebelumnya gagal. Tidak ada rollback otomatis.
            </p>
            <p>
              Penyebab gagal paling umum: akun login tidak punya izin{" "}
              <code>policy</code> (pakai grup <code>full</code>), atau nama
              grup/akun sudah dipakai. Perintah di kiri adalah padanan langkah
              yang gagal untuk dijalankan sendiri di terminal MikroTik.
            </p>
            <p>
              Bila verifikasi berhasil, form &quot;Detail Router MikroTik&quot;
              di bawah terisi otomatis. Tekan Uji Koneksi, lalu Simpan.
            </p>
          </>,
        )}
    </div>
  );
}
