"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { ChevronLeft, Save, Loader2 } from "lucide-react";

import { RouterTestPanel } from "@/components/dashboard/router-test-panel";
import { RouterSetupGuide } from "@/components/dashboard/router-setup-guide";
import { GroupCheckNotice, RouterBootstrapPanel, type GroupCheck } from "@/components/dashboard/router-bootstrap-panel";
import { ROUTERS_CHANGED_EVENT } from "@/lib/dashboard/routers";
import type { DeviceConnectionTestResult } from "@/lib/device-connection";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const formSchema = z.object({
  name: z.string().min(2, {
    message: "Nama router minimal 2 karakter.",
  }),
  host: z.string().min(1, {
    message: "IP atau Host wajib diisi.",
  }),
  // Kosong = bawaan (80, atau 443 bila HTTPS). Boleh juga ditulis di host: "10.0.0.1:8080".
  port: z.string().trim().refine(
    (v) => v === "" || (/^\d{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65535),
    { message: "Port harus angka 1-65535." },
  ),
  useSsl: z.boolean(),
  username: z.string().min(1, {
    message: "Username wajib diisi.",
  }),
  password: z.string().min(1, {
    message: "Password wajib diisi.",
  }),
});

export default function NewRouterPage() {
  const router = useRouter();
  // Hasil uji terakhir beserta kredensial yang diuji; basi bila form berubah.
  const [tested, setTested] = useState<{ key: string; result: DeviceConnectionTestResult } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Terisi otomatis oleh panel bootstrap (REST sudah diverifikasi): isian teknis disembunyikan.
  const [provisioned, setProvisioned] = useState(false);
  const [groupCheck, setGroupCheck] = useState<GroupCheck | undefined>();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      host: "",
      port: "",
      useSsl: false,
      username: "",
      password: "",
    },
  });

  const [host, port, useSsl, username, password] = form.watch([
    "host",
    "port",
    "useSsl",
    "username",
    "password",
  ]);
  const portNumber = /^\d{1,5}$/.test(port.trim()) ? Number(port.trim()) : undefined;
  // Tidak dicentang = biarkan server menyimpulkan dari skema host / port 443, 8443.
  const sslOption = useSsl ? true : undefined;
  const formKey = `${host}|${port}|${useSsl}|${username}|${password}`;
  const verified = tested?.key === formKey && tested.result.ok;

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/routers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          host: values.host.trim(),
          ...(portNumber !== undefined && { port: portNumber }),
          ...(sslOption && { useSsl: true }),
          username: values.username.trim(),
          password: values.password,
          // Sudah lulus uji di form: server menguji ulang dan mengisi last_seen_at
          // (syarat gerbang onboarding). Belum diuji: simpan tanpa verifikasi.
          // Dari panel otomatis, server tetap menguji ulang sebelum menyimpan.
          validateConnection: verified || provisioned,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const errMsg =
          json?.error?.message ||
          (res.status === 403
            ? "Akun Anda saat ini tidak memiliki izin untuk menambah router. Silakan pastikan akun Anda memiliki peran 'admin'."
            : "Gagal menyimpan router ke database PostgreSQL.");
        throw new Error(errMsg);
      }

      window.dispatchEvent(new Event(ROUTERS_CHANGED_EVENT));
      router.push("/app/router");
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : "Terjadi kesalahan sistem saat menyimpan router ke database.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/app/router">
            <ChevronLeft className="size-5" />
            <span className="sr-only">Kembali</span>
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Tambah Router
          </h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detail Router MikroTik</CardTitle>
          <CardDescription>
            Kredensial disimpan dengan enkripsi AES-256-GCM. Aplikasi memakai REST API RouterOS v7
            lewat layanan <code>www</code> (80) atau <code>www-ssl</code> (443), bukan port API 8728 atau Winbox 8291.
            Atau biarkan aplikasi menyiapkan REST otomatis lewat panel di atas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RouterBootstrapPanel
            onProvisioned={(c) => {
              form.setValue("host", c.host, { shouldValidate: true });
              form.setValue("port", c.port ? String(c.port) : "", { shouldValidate: true });
              form.setValue("useSsl", c.useSsl, { shouldValidate: true });
              form.setValue("username", c.username, { shouldValidate: true });
              form.setValue("password", c.password, { shouldValidate: true });
              setProvisioned(true);
              setGroupCheck(c.groupCheck);
            }}
          />
          {/* Panduan manual hanya muncul bila uji koneksi atau simpan gagal. */}
          {((tested && !tested.result.ok) || saveError) && (
            <RouterSetupGuide
              host={host}
              port={port}
              onUseRouter={(address, restPort, tls) => {
                form.setValue("host", address, { shouldValidate: true });
                form.setValue("port", restPort ? String(restPort) : "", { shouldValidate: true });
                form.setValue("useSsl", tls === true, { shouldValidate: true });
              }}
            />
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nama Router</FormLabel>
                    <FormControl>
                      <Input placeholder="RTR-Pusat-01" {...field} />
                    </FormControl>
                    <FormDescription>
                      Nama tampilan untuk mengenali router ini di dashboard.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {provisioned ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">Terhubung otomatis</span>
                    <span className="text-muted-foreground">
                      {" "}· {host}
                      {portNumber ? `:${portNumber}` : ""} · {sslOption ? "HTTPS" : "HTTP"} · akun REST {username}
                    </span>
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setProvisioned(false)}>
                    Ubah manual
                  </Button>
                  <div className="w-full">
                    <GroupCheckNotice check={groupCheck} onlyProblem />
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="host"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Host / IP Address</FormLabel>
                          <FormControl>
                            <Input placeholder="contoh: 192.168.88.1" {...field} />
                          </FormControl>
                          <FormDescription>
                            Alamat router yang bisa dijangkau dari server NOC, diambil dari router Anda sendiri (alamat yang
                            dipakai di Winbox/SSH, atau <code>/ip address print</code>). Lihat langkah 2 pada panduan di atas.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="port"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Port REST (opsional)</FormLabel>
                          <FormControl>
                            <Input inputMode="numeric" placeholder="80 atau 443" {...field} />
                          </FormControl>
                          <FormDescription>
                            Port layanan www / www-ssl di router. Kosong = 80 (HTTP) atau 443 (HTTPS). Wajib diisi bila router
                            memakai port lain (mis. 8081): lihat <code>/ip service print where name~&quot;www&quot;</code>.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="useSsl"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start gap-3">
                        <FormControl>
                          <input
                            type="checkbox"
                            checked={field.value}
                            onChange={(e) => field.onChange(e.target.checked)}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            className="mt-1 size-4"
                          />
                        </FormControl>
                        <div className="space-y-1">
                          <FormLabel>Gunakan HTTPS (www-ssl)</FormLabel>
                          <FormDescription>
                            Port 443 dan 8443 otomatis HTTPS. Sertifikat self-signed bawaan RouterOS
                            akan ditolak; pasang sertifikat valid atau pakai www (HTTP) lewat jaringan privat.
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />
                  <div className="grid gap-6 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username REST</FormLabel>
                          <FormControl>
                            <Input placeholder="mis. noc-api" {...field} />
                          </FormControl>
                          <FormDescription>
                            Akun MikroTik yang disimpan aplikasi untuk memantau router lewat REST. Terisi otomatis setelah panel di atas
                            berhasil; berbeda dari akun login di panel itu.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password REST</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="••••••••" {...field} />
                        </FormControl>
                        <FormDescription>Password akun REST di atas (disimpan terenkripsi).</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {/* key: hasil uji lama dibuang bila host/kredensial berubah. Disembunyikan saat sudah terhubung otomatis. */}
              {!provisioned && (
                <RouterTestPanel
                  key={formKey}
                  host={host}
                  port={portNumber}
                  useSsl={sslOption}
                  username={username}
                  password={password}
                  onTestComplete={(result) => setTested({ key: formKey, result })}
                />
              )}

              {saveError && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2"
                >
                  <span>{saveError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4">
                {!verified && !provisioned && (
                  <span className="text-sm text-muted-foreground">
                    Belum diuji (opsional).
                  </span>
                )}
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 size-4" />
                  )}
                  Simpan Router
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
