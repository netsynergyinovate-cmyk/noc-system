"use client";

import { useEffect, useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  access: "read" | "read-write";
  ownerEmail: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

const accessLabel = { read: "Hanya baca", "read-write": "Baca + tulis" } as const;

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("id-ID") : "—";
}

async function errorMessage(res: Response, fallback: string) {
  const json = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return json?.error?.message ?? `${fallback} (HTTP ${res.status}).`;
}

async function fetchKeys() {
  const res = await fetch("/api/api-keys", { cache: "no-store" });
  if (!res.ok) throw new Error(await errorMessage(res, "Gagal memuat API key"));
  return ((await res.json()) as { data: ApiKeyRow[] }).data;
}

export function ApiKeyBoard() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [access, setAccess] = useState<ApiKeyRow["access"]>("read");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchKeys()
      .then((rows) => active && setKeys(rows))
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "Gagal memuat API key.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function load() {
    setKeys(await fetchKeys());
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (creating || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), access }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Gagal membuat API key"));
      const { data } = (await res.json()) as { data: { key: string } };
      setNewKey(data.key);
      setCopied(false);
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat API key.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(row: ApiKeyRow) {
    if (revokingId) return;
    if (!window.confirm(`Cabut API key "${row.name}"? Aplikasi yang memakainya langsung ditolak.`))
      return;
    setRevokingId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/api-keys/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Gagal mencabut API key"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mencabut API key.");
    } finally {
      setRevokingId(null);
    }
  }

  async function handleCopy() {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
    } catch {
      setError("Browser menolak menyalin. Salin manual dari kotak di atas.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Buat API key</CardTitle>
          <CardDescription>
            Key bertindak atas nama akun Anda. &quot;Hanya baca&quot; cuma boleh GET;
            &quot;Baca + tulis&quot; boleh mengubah data sebatas peran akun Anda.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={handleCreate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="api-key-name">Nama aplikasi</Label>
              <Input
                id="api-key-name"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder="mis. Aplikasi Billing Pusat"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="api-key-access">Akses</Label>
              <select
                id="api-key-access"
                value={access}
                onChange={(e) => setAccess(e.target.value as ApiKeyRow["access"])}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="read">{accessLabel.read}</option>
                <option value="read-write">{accessLabel["read-write"]}</option>
              </select>
            </div>
            <Button type="submit" disabled={creating || !name.trim()}>
              <KeyRound className="size-4" aria-hidden="true" />
              {creating ? "Membuat..." : "Buat key"}
            </Button>
          </form>

          {newKey && (
            <div role="status" className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-sm font-medium">
                Simpan key ini sekarang. Key tidak bisa ditampilkan lagi.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <code className="flex-1 break-all rounded bg-background px-2 py-1.5 text-xs">
                  {newKey}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                  <Copy className="size-4" aria-hidden="true" />
                  {copied ? "Tersalin" : "Salin"}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar API key</CardTitle>
          <CardDescription>
            Kirim sebagai header <code>Authorization: Bearer &lt;key&gt;</code>. Daftar
            dataset: <code>GET /api/v1/data</code>; isi tabel:{" "}
            <code>GET /api/v1/data?dataset=customers&amp;limit=500&amp;offset=0</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {keys === null ? (
            <p className="text-sm text-muted-foreground">Memuat...</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada API key.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Akses</TableHead>
                  <TableHead>Pemilik</TableHead>
                  <TableHead>Terakhir dipakai</TableHead>
                  <TableHead>Dibuat</TableHead>
                  <TableHead className="sr-only">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      <code className="text-xs">{row.prefix}…</code>
                    </TableCell>
                    <TableCell>
                      {row.revokedAt ? (
                        <Badge variant="outline">Dicabut</Badge>
                      ) : (
                        <Badge variant={row.access === "read" ? "secondary" : "default"}>
                          {accessLabel[row.access]}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{row.ownerEmail}</TableCell>
                    <TableCell>{formatTime(row.lastUsedAt)}</TableCell>
                    <TableCell>{formatTime(row.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {!row.revokedAt && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={revokingId === row.id}
                          onClick={() => void handleRevoke(row)}
                        >
                          {revokingId === row.id ? "Mencabut..." : "Cabut"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
