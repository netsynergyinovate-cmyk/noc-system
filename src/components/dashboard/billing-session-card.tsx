"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCanDo } from "@/components/access";
import {
  describeBillingSession,
  type BillingScraperSession,
} from "@/lib/dashboard/billing-session";

const toneClass = {
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
} as const;

const csrfLabel = {
  acquired: "Diperoleh",
  missing: "Belum diperoleh",
  not_required: "N/A",
} as const;

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
    </div>
  );
}

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function isHttpUrl(url: string) {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

// Form kredensial. Tiruan: belum ada endpoint penyimpanan, jadi tidak ada yang
// dikirim ke server dan kata sandi tidak disimpan di mana pun.
export function BillingCredentialsDialog({
  session,
}: {
  session: BillingScraperSession;
}) {
  const canManage = useCanDo("manageBilling");
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const hintId = `${id}-hint`;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const url = String(data.get("portalUrl") ?? "").trim();
    const username = String(data.get("username") ?? "").trim();
    if (!isHttpUrl(url)) {
      setError("URL portal harus diawali http:// atau https://.");
      return;
    }
    if (!username) {
      setError("Username wajib diisi.");
      return;
    }
    setError(null);
    setSaved(true);
    setOpen(false);
  }

  if (!canManage) {
    return (
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled="true"
          aria-describedby={hintId}
          className="w-fit cursor-not-allowed opacity-60"
          onClick={(event) => event.preventDefault()}
        >
          Atur Kredensial
        </Button>
        <p id={hintId} className="text-xs text-muted-foreground">
          Hanya admin yang boleh mengatur kredensial billing.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setError(null);
            setSaved(false);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="w-fit">
            Atur Kredensial
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Atur kredensial scraper</DialogTitle>
              <DialogDescription>
                Akun yang dipakai scraper untuk masuk ke portal billing. Kosongkan
                kata sandi untuk mempertahankan yang lama.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-url`}>URL portal</Label>
              <Input
                id={`${id}-url`}
                name="portalUrl"
                type="url"
                defaultValue={session.portalUrl}
                autoComplete="off"
                aria-invalid={error?.startsWith("URL") || undefined}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-user`}>Username</Label>
              <Input
                id={`${id}-user`}
                name="username"
                defaultValue={session.username}
                autoComplete="off"
                aria-invalid={error?.startsWith("Username") || undefined}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-pass`}>Kata sandi baru</Label>
              <Input
                id={`${id}-pass`}
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Simulasi: belum tersambung ke backend, jadi tidak ada yang
              disimpan.
            </p>
            <DialogFooter>
              <Button type="submit">Simpan</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {saved && (
        <p role="status" className="text-xs text-muted-foreground">
          Form diterima (simulasi, belum disimpan ke server).
        </p>
      )}
    </div>
  );
}

// Keadaan sesi login scraper ke portal billing: cookiejar, token CSRF dan akun.
export function BillingSessionCard({
  session,
}: {
  session: BillingScraperSession;
}) {
  const status = describeBillingSession(session);

  return (
    <Card data-testid="billing-session" data-tone={status.tone}>
      <CardHeader>
        <CardTitle>Sesi &amp; Kredensial Scraper</CardTitle>
        <CardDescription>
          Status cookiejar, token CSRF, dan akun portal billing.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div
          role="status"
          data-testid="billing-session-status"
          data-tone={status.tone}
          className={cn("rounded-lg border px-4 py-3", toneClass[status.tone])}
        >
          <p className="font-semibold">{status.text}</p>
          <p className="mt-1 text-sm">{status.hint}</p>
        </div>
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Item label="Portal URL">
            {session.portalUrl && isHttpUrl(session.portalUrl) ? (
              <a
                href={session.portalUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2"
              >
                {hostnameOf(session.portalUrl)}
              </a>
            ) : (
              <span>Belum diatur</span>
            )}
          </Item>
          <Item label="Akun">
            <span>{session.username || "Belum diatur"}</span>
            <span className="block text-xs text-muted-foreground">
              Kata sandi: ••••••••
            </span>
          </Item>
          <Item label="Cookiejar">
            <span data-testid="billing-cookiejar">
              {session.cookiejarCount} cookie aktif
            </span>
          </Item>
          <Item label="Token CSRF">
            <span data-testid="billing-csrf">{csrfLabel[session.csrfStatus]}</span>
          </Item>
        </dl>
        <BillingCredentialsDialog session={session} />
      </CardContent>
    </Card>
  );
}
