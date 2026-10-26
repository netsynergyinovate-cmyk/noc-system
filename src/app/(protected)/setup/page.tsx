import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FlaskConical, Network, Plus, Router } from "lucide-react";
import { ConfigValidationPanel } from "@/components/dashboard/config-validation-panel";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { MockRegistryCard } from "@/components/dashboard/mock-registry-card";
import { OnboardingMikrotikForm } from "@/components/dashboard/onboarding-mikrotik-form";
import { SetupDevices } from "@/components/dashboard/setup-devices";
import { SetupTipsPanel } from "@/components/dashboard/setup-tips-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/session";
import { countConnectedDevices } from "@/services/devices.service";

export const metadata: Metadata = { title: "Setup Perangkat" };

export default async function SetupPage() {
  await requireSession();
  const connected = await countConnectedDevices();
  const isDemo = env.DASHBOARD_DATA === "demo";
  // Sudah ada perangkat yang terhubung: tidak ada lagi yang perlu disiapkan.
  if (!isDemo && connected.routers + connected.olts > 0) redirect("/app");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Setup Perangkat
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Dashboard NOC baru bisa dibuka setelah minimal satu perangkat, yaitu
          router MikroTik atau OLT, terpasang dan berhasil dihubungi. Dengan
          begitu angka yang tampil berasal dari jaringan yang sebenarnya.
        </p>
      </div>

      <section
        aria-label="Status perangkat"
        className="grid gap-4 sm:grid-cols-2"
      >
        <Card className="gap-2 py-5">
          <CardContent className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
              <Router className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm text-muted-foreground">Router terhubung</p>
              <p
                className="text-2xl font-semibold tabular-nums"
                data-testid="connected-routers"
              >
                {connected.routers}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="gap-2 py-5">
          <CardContent className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
              <Network className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm text-muted-foreground">OLT terhubung</p>
              <p
                className="text-2xl font-semibold tabular-nums"
                data-testid="connected-olts"
              >
                {connected.olts}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section
        aria-labelledby="next-steps"
        className="rounded-xl border border-dashed p-6"
      >
        <h2 id="next-steps" className="text-lg font-semibold">
          Langkah berikutnya
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
          <li>
            Tambahkan perangkat: jenis, alamat host, username, dan password.
          </li>
          <li>
            Jalankan tes koneksi. MikroTik dites lewat REST API, OLT lewat login
            username dan password.
          </li>
          <li>Setelah tes berhasil, dashboard terbuka otomatis.</li>
        </ol>

        <div className="mt-5 flex flex-wrap items-center gap-3 pt-2 border-t border-border/50">
          <Button asChild className="gap-2">
            <Link href="/app/router/new">
              <Plus className="size-4" />
              <span>Tambah Router MikroTik</span>
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>

      <section aria-label="Uji dan Konfigurasi MikroTik" className="flex flex-col gap-3">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Router className="size-5 text-primary" />
              <span>Formulir Konfigurasi &amp; Uji Router MikroTik</span>
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Isi host, port REST API (80 / 443), dan akun MikroTik Anda di bawah ini untuk menguji koneksi langsung dan mengaktifkan dasbor.
            </p>
          </div>
          <OnboardingMikrotikForm />
        </div>
      </section>

      <ConfigValidationPanel />

      <SetupTipsPanel />

      {isDemo && (
        <section aria-label="Perangkat" className="flex flex-col gap-3">
          <MockDataNotice source="router dan OLT" />
          <SetupDevices />
        </section>
      )}

      {isDemo && <MockRegistryCard />}

      {isDemo && (
        <section
          aria-label="Mode demo"
          className="flex flex-col items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-5"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-warning">
            <FlaskConical className="size-4" aria-hidden="true" />
            Mode demo aktif
          </p>
          <p className="text-sm leading-6">
            Dashboard memakai data tiruan, jadi gerbang ini tidak diberlakukan
            dan kamu tetap bisa membukanya. Untuk memberlakukan gerbang, setel{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              DASHBOARD_DATA=live
            </code>{" "}
            lalu mulai ulang aplikasi.
          </p>
          <Button asChild>
            <Link href="/app">
              Buka dashboard demo
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </section>
      )}
    </div>
  );
}
