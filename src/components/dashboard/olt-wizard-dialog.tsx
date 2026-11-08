"use client";

import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  OLT_BRANDS,
  OLT_PON_OPTIONS,
  validateOltInput,
  type OltInput,
} from "@/lib/dashboard/olts";
import { selectClassName } from "./select-class";

const STEPS = ["Identitas & Model", "Kredensial", "Konfirmasi & Uji"] as const;

const EMPTY: OltInput = {
  name: "",
  brand: "HSGQ",
  driver: "hsgq-telnet",
  host: "",
  port: 23,
  username: "",
  password: "",
  totalPonPorts: 8,
};

const STEP_FIELDS: (keyof OltInput)[][] = [
  ["name", "brand", "driver", "host", "totalPonPorts"],
  ["port", "username", "password"],
  [],
];

export function OltWizardDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<OltInput>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof OltInput, string>>>(
    {},
  );
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<
    | { telnet: { port: number; banner: string }[]; otherOpen: number[] }
    | { error: string }
    | null
  >(null);

  async function findPorts() {
    if (!form.host.trim()) {
      setScan({ error: "Isi Host IP di langkah 1 dulu." });
      return;
    }
    setScanning(true);
    setScan(null);
    try {
      const res = await fetch("/api/olts/discover-port", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: form.host.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(
          json?.error?.message ?? `Server menjawab HTTP ${res.status}.`,
        );
      setScan(json.data);
      // Satu-satunya kandidat dipakai langsung supaya operator tidak perlu mengetik port.
      if (json.data.telnet.length === 1) set("port", json.data.telnet[0].port);
    } catch (e) {
      setScan({
        error: e instanceof Error ? e.message : "Pencarian port gagal.",
      });
    } finally {
      setScanning(false);
    }
  }

  function reset() {
    setStep(0);
    setForm(EMPTY);
    setErrors({});
    setResult(null);
    setScan(null);
  }

  function set<K extends keyof OltInput>(key: K, value: OltInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setResult(null);
  }

  function next() {
    const all = validateOltInput(form);
    const own = Object.fromEntries(
      STEP_FIELDS[step].filter((k) => all[k]).map((k) => [k, all[k]]),
    );
    setErrors(own);
    if (Object.keys(own).length === 0) setStep(step + 1);
  }

  async function submit() {
    if (saving) return;
    const all = validateOltInput(form);
    if (Object.keys(all).length > 0) {
      setErrors(all);
      setStep(STEP_FIELDS[0].some((k) => all[k]) ? 0 : 1);
      return;
    }
    setSaving(true);
    try {
      // Server menguji koneksi lalu menyimpan; `port` & `totalPonPorts` belum dikenal skema server.
      const res = await fetch("/api/olts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          // Port disimpan bersama host ("10.0.0.9:2323"); port bawaan driver tidak perlu ditulis.
          host:
            form.port === (form.driver === "hsgq-telnet" ? 23 : 80)
              ? form.host.trim()
              : `${form.host.trim()}:${form.port}`,
          brand: form.brand,
          driver: form.driver.trim(),
          username: form.username.trim(),
          password: form.password,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const reason =
          res.status === 401
            ? "Sesi berakhir, silakan masuk lagi."
            : res.status === 403
              ? "Akun ini tidak berhak menambah OLT (butuh izin router:manage)."
              : (json?.error?.message ?? `Server menjawab HTTP ${res.status}.`);
        setResult({ ok: false, text: reason });
        return;
      }
      setResult({ ok: true, text: "Terhubung. OLT disimpan." });
      onSaved();
    } catch {
      setResult({
        ok: false,
        text: "Tidak dapat menghubungi server NOC. Periksa koneksi lalu coba lagi.",
      });
    } finally {
      setSaving(false);
    }
  }
  function field(key: keyof OltInput, label: string, input: React.ReactNode) {
    const err = errors[key];
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`olt-${key}`}>{label}</Label>
        {input}
        {err ? (
          <p
            id={`olt-${key}-error`}
            role="alert"
            className="text-xs text-destructive"
          >
            {err}
          </p>
        ) : null}
      </div>
    );
  }

  const a11y = (key: keyof OltInput) => ({
    id: `olt-${key}`,
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `olt-${key}-error` : undefined,
  });

  const summary: [string, string][] = [
    ["Nama", form.name.trim()],
    ["Brand", form.brand],
    ["Driver", form.driver.trim()],
    ["Host", `${form.host.trim()}:${form.port}`],
    ["Port PON", String(form.totalPonPorts)],
    ["Username", form.username.trim()],
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" data-testid="olt-wizard-trigger">
          <Plus className="size-4" aria-hidden /> Tambah OLT
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah OLT</DialogTitle>
          <DialogDescription>
            Langkah {step + 1} dari {STEPS.length}: {STEPS[step]}
          </DialogDescription>
        </DialogHeader>

        <ol className="flex gap-2 text-xs" aria-label="Langkah">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === step ? "step" : undefined}
              className={`flex-1 rounded border px-2 py-1 text-center ${
                i === step
                  ? "border-primary font-medium text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {i + 1}. {s}
            </li>
          ))}
        </ol>

        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (step < 2) next();
            else void submit();
          }}
        >
          {step === 0 && (
            <>
              {field(
                "name",
                "Nama",
                <Input
                  {...a11y("name")}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                />,
              )}
              {field(
                "brand",
                "Brand",
                <select
                  {...a11y("brand")}
                  className={selectClassName}
                  value={form.brand}
                  onChange={(e) => set("brand", e.target.value)}
                >
                  {OLT_BRANDS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>,
              )}
              {field(
                "driver",
                "Driver",
                <select
                  {...a11y("driver")}
                  className={selectClassName}
                  value={form.driver}
                  onChange={(e) => {
                    const next = e.target.value;
                    set("driver", next);
                    // Ganti port bawaan hanya bila masih memakai bawaan driver sebelumnya.
                    if (form.port === 23 || form.port === 80)
                      set("port", next === "hsgq-telnet" ? 23 : 80);
                  }}
                >
                  <option value="hsgq-telnet">
                    hsgq-telnet (CLI telnet, seri XE EPON - Teruji)
                  </option>
                  <option value="hsgq">
                    hsgq (Web API HTTP/JSON, jika firmware mendukung)
                  </option>
                </select>,
              )}
              {field(
                "host",
                "Host IP",
                <Input
                  {...a11y("host")}
                  inputMode="decimal"
                  placeholder="10.10.0.10"
                  value={form.host}
                  onChange={(e) => set("host", e.target.value)}
                />,
              )}
              {field(
                "totalPonPorts",
                "Total Port PON",
                <select
                  {...a11y("totalPonPorts")}
                  className={selectClassName}
                  value={form.totalPonPorts}
                  onChange={(e) => set("totalPonPorts", Number(e.target.value))}
                >
                  {OLT_PON_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>,
              )}
            </>
          )}

          {step === 1 && (
            <>
              {field(
                "port",
                form.driver === "hsgq"
                  ? "Port HTTP Web API (bawaan 80 / 8080)"
                  : "Port Telnet (bawaan 23)",
                <Input
                  {...a11y("port")}
                  inputMode="numeric"
                  placeholder={form.driver === "hsgq" ? "80" : "23"}
                  value={Number.isNaN(form.port) ? "" : form.port}
                  onChange={(e) =>
                    set(
                      "port",
                      e.target.value === "" ? NaN : Number(e.target.value),
                    )
                  }
                />,
              )}
              {form.driver === "hsgq-telnet" && (
                <div
                  className="flex flex-col gap-2 rounded-md border border-dashed p-3 text-sm"
                  data-testid="port-finder"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={scanning}
                      onClick={() => void findPorts()}
                      data-testid="btn-find-port"
                    >
                      <Search className="size-4" aria-hidden />{" "}
                      {scanning ? "Mencari…" : "Cari port telnet otomatis"}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Tidak tahu port telnet OLT? Sistem mencoba port yang lazim
                      di {form.host.trim() || "host"}.
                    </span>
                  </div>
                  {scan && "error" in scan && (
                    <p role="alert" className="text-destructive">
                      {scan.error}
                    </p>
                  )}
                  {scan && "telnet" in scan && (
                    <div role="status" className="flex flex-col gap-1.5">
                      {scan.telnet.length === 0 ? (
                        <p className="text-muted-foreground">
                          Tidak ada port telnet yang menjawab.
                          {scan.otherOpen.length > 0 &&
                            ` Port ${scan.otherOpen.join(", ")} terbuka tapi bukan telnet (kemungkinan web OLT).`}{" "}
                          Tanyakan teknisi/ISP port forward telnet (port 23)
                          OLT, atau pastikan OLT dan firewall mengizinkan
                          koneksi dari server NOC.
                        </p>
                      ) : (
                        scan.telnet.map((t) => (
                          <div
                            key={t.port}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <span className="font-mono text-xs">
                              Port {t.port}
                            </span>
                            {t.banner && (
                              <span className="text-xs text-muted-foreground">
                                {t.banner}
                              </span>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant={
                                form.port === t.port ? "secondary" : "default"
                              }
                              onClick={() => set("port", t.port)}
                            >
                              {form.port === t.port
                                ? "Dipakai"
                                : "Pakai port ini"}
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
              {field(
                "username",
                "Username",
                <Input
                  {...a11y("username")}
                  autoComplete="off"
                  value={form.username}
                  onChange={(e) => set("username", e.target.value)}
                />,
              )}
              {field(
                "password",
                "Password",
                <Input
                  {...a11y("password")}
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                />,
              )}
            </>
          )}

          {step === 2 && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {summary.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-mono text-xs break-all">{v}</dd>
                  </div>
                ))}
              </dl>
              <div
                data-testid="olt-test-result"
                role="status"
                aria-live="polite"
                className={`min-h-5 text-sm ${result?.ok ? "text-success" : "text-destructive"}`}
              >
                {result ? result.text : ""}
              </div>
            </>
          )}

          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={step === 0}
              onClick={() => {
                setErrors({});
                setResult(null);
                setStep(step - 1);
              }}
            >
              Kembali
            </Button>
            {step < 2 ? (
              <Button type="submit">Lanjut</Button>
            ) : result?.ok ? (
              <Button
                type="button"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Selesai
              </Button>
            ) : (
              <Button type="submit" aria-disabled={saving}>
                {saving ? "Menyimpan�" : "Uji Koneksi &amp; Simpan"}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
