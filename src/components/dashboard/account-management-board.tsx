"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { cn } from "cn";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Crown,
  Globe,
  KeyRound,
  Loader2,
  Mail,
  Radio,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useSessionUser } from "@/components/session-provider";
import { isSuperAdmin, isAdmin, isStrictAdmin, isUser, roleLabel, roleNames } from "@/lib/roles";
import { authClient } from "@/lib/auth-client";
import { selectClassName } from "./select-class";

interface AdminListedUser {
  id: string;
  name?: string | null;
  email: string;
  role?: string | null;
  providers?: string;
  createdAt?: string | Date;
}

export function AccountManagementBoard() {
  const sessionUser = useSessionUser();
  const [currentUserRole, setCurrentUserRole] = useState<{
    role: string;
    isSuperAdmin: boolean;
    isAdmin: boolean;
    isUser: boolean;
  } | null>(() => {
    if (!sessionUser) return null;
    const r = sessionUser.role ?? "user";
    return {
      role: r,
      isSuperAdmin: isSuperAdmin(r),
      isAdmin: isAdmin(r),
      isUser: isUser(r),
    };
  });

  const [users, setUsers] = useState<AdminListedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
    userId: string;
  } | null>(null);

  // Form Buat Akun Baru oleh Super Admin
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState<"superadmin" | "admin" | "user">("user");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  // State untuk Reset Password Pengguna oleh Super Admin
  const [resetTargetUser, setResetTargetUser] = useState<AdminListedUser | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [passwordResetMsg, setPasswordResetMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTargetUser) return;
    setResettingPassword(true);
    setPasswordResetMsg(null);
    try {
      const res = await authClient.admin.setUserPassword({
        userId: resetTargetUser.id,
        newPassword: newPasswordInput,
      });
      if (res.error) {
        setPasswordResetMsg({ type: "error", text: res.error.message || "Gagal mereset kata sandi." });
      } else {
        setPasswordResetMsg({
          type: "success",
          text: `Kata sandi untuk ${resetTargetUser.email} berhasil diperbarui.`,
        });
        setNewPasswordInput("");
        setTimeout(() => {
          setResetTargetUser(null);
          setPasswordResetMsg(null);
        }, 2000);
      }
    } catch (err) {
      setPasswordResetMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Terjadi kesalahan saat mereset kata sandi.",
      });
    } finally {
      setResettingPassword(false);
    }
  }

  // Ambil data peran akun aktif dari API
  useEffect(() => {
    fetch("/api/settings/role")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data) {
          const r = json.data.role ?? "user";
          setCurrentUserRole({
            role: r,
            isSuperAdmin: Boolean(json.data.isSuperAdmin),
            isAdmin: Boolean(json.data.isAdmin),
            isUser: Boolean(json.data.isUser),
          });
        }
      })
      .catch(() => null);
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/users/overview");
      if (!res.ok) {
        throw new Error("Gagal memuat daftar pengguna.");
      }
      const json = await res.json();
      if (json?.data) {
        const userList = json.data as AdminListedUser[];
        setUsers(userList);
        setSelectedRoles((prev) => {
          const next = { ...prev };
          for (const u of userList) {
            next[u.id] = u.role ?? "user";
          }
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan saat memuat pengguna.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  async function handleSetRole(userId: string) {
    const targetRole = selectedRoles[userId] ?? "user";
    setSavingUserId(userId);
    setFeedback(null);
    try {
      const res = await fetch("/api/settings/users/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: targetRole }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFeedback({
          type: "error",
          message: json.message || "Gagal mengubah peran akun.",
          userId,
        });
      } else {
        setFeedback({
          type: "success",
          message: json.message || `Peran berhasil diubah menjadi ${roleLabel(targetRole)}.`,
          userId,
        });
        await fetchUsers();
      }
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Terjadi kesalahan saat memperbarui peran.",
        userId,
      });
    } finally {
      setSavingUserId(null);
    }
  }

  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  async function handleDeleteUser(userId: string, email: string) {
    if (!window.confirm(`Yakin ingin menghapus akun ${email} secara permanen dari sistem?`)) {
      return;
    }
    setDeletingUserId(userId);
    setFeedback(null);
    try {
      const res = await fetch("/api/settings/users/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFeedback({
          type: "error",
          message: json.message || "Gagal menghapus akun pengguna.",
          userId,
        });
      } else {
        setFeedback({
          type: "success",
          message: json.message || `Akun ${email} berhasil dihapus.`,
          userId,
        });
        await fetchUsers();
      }
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Terjadi kesalahan saat menghapus akun.",
        userId,
      });
    } finally {
      setDeletingUserId(null);
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);
    try {
      const res = await authClient.admin.createUser({
        name: createName.trim(),
        email: createEmail.trim(),
        password: createPassword,
        role: createRole,
      });
      if (res.error) {
        setCreateError(res.error.message || "Gagal membuat akun.");
      } else {
        setCreateSuccess(`Akun ${createEmail} berhasil dibuat dengan peran ${roleLabel(createRole)}.`);
        setCreateName("");
        setCreateEmail("");
        setCreatePassword("");
        setCreateRole("user");
        setShowCreateForm(false);
        await fetchUsers();
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Terjadi kesalahan saat membuat akun.");
    } finally {
      setCreating(false);
    }
  }

  function formatRegistrationDate(val?: string | Date | null) {
    if (!val) return "-";
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return "-";
      return d.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return "-";
    }
  }

  return (
    <div className="space-y-6">
      {/* Tombol Kembali & Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="h-8 -ml-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <Link href="/app/pengaturan">
                <ArrowLeft className="size-3.5" />
                <span>Kembali ke Pengaturan</span>
              </Link>
            </Button>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Users className="size-5 text-amber-500" />
            <span>Manajemen Akun &amp; Hak Akses Pengguna</span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Kelola akun petugas NOC, berikan akses baru, dan atur peran Super Admin, Admin, dan User secara terpusat di database.
          </p>
        </div>

        {currentUserRole?.isSuperAdmin && (
          <div className="flex items-center gap-2">
            <Button
              variant={showCreateForm ? "secondary" : "default"}
              size="sm"
              onClick={() => setShowCreateForm((prev) => !prev)}
              className="h-8 gap-1.5 text-xs"
            >
              <UserPlus className="size-3.5" />
              <span>{showCreateForm ? "Tutup Form" : "Beri Akun Baru"}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchUsers()}
              disabled={loading}
              className="h-8 gap-1.5 text-xs"
            >
              <RotateCcw className={cn("size-3.5", loading && "animate-spin")} />
              Segarkan
            </Button>
          </div>
        )}
      </div>
      {/* 3 KARTU RINGKASAN HIERARKI PERAN RESMI */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <Crown className="size-4" />
              <span>SUPER ADMIN (OWNER)</span>
            </span>
            <Badge className="bg-amber-500 text-white text-[10px] font-bold">
              {users.filter((u) => isSuperAdmin(u.role)).length} AKUN
            </Badge>
          </div>
          <div className="text-sm font-bold text-foreground truncate">
            {users.filter((u) => isSuperAdmin(u.role)).map((u) => u.email).join(", ") || "admin@noc.local"}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Dipegang penuh oleh Anda (Owner). Wewenang mutasi role, reset sandi, dan buat akun baru.
          </p>
        </div>

        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
              <ShieldCheck className="size-4" />
              <span>ADMIN UTAMA (AI)</span>
            </span>
            <Badge className="bg-blue-600 text-white text-[10px] font-bold">
              {users.filter((u) => isStrictAdmin(u.role)).length} AKUN
            </Badge>
          </div>
          <div className="text-sm font-bold text-foreground truncate">
            {users.filter((u) => isStrictAdmin(u.role)).map((u) => u.email).join(", ") || "admin-utama@noc.local"}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Peran utama asisten AI &amp; operasional NOC teknis (MikroTik, OLT, Alert, Billing, Map).
          </p>
        </div>

        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <User className="size-4" />
              <span>USER / PETUGAS</span>
            </span>
            <Badge variant="secondary" className="text-[10px] font-bold">
              {users.filter((u) => isUser(u.role)).length} AKUN
            </Badge>
          </div>
          <div className="text-sm font-bold text-foreground truncate">
            {users.filter((u) => isUser(u.role)).map((u) => u.email).join(", ") || "user@noc.local"}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Akses pemantauan &amp; pengawas lapangan (read-only telemetri, redaman, dan dashboard).
          </p>
        </div>
      </div>


      {/* Kartu Status Peran Akun Anda */}
      <Card className="border border-border bg-card shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" />
                <span>Status Akun Anda Saat Ini</span>
              </CardTitle>
              <CardDescription>
                Tingkat otorisasi akun Anda di sistem NOC.
              </CardDescription>
            </div>
            {currentUserRole && (
              <Badge
                variant={currentUserRole.isSuperAdmin ? "default" : currentUserRole.isAdmin ? "default" : "secondary"}
                className={
                  currentUserRole.isSuperAdmin
                    ? "px-3 py-1 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white dark:bg-amber-600 dark:hover:bg-amber-700"
                    : "px-3 py-1 text-xs font-semibold"
                }
              >
                {currentUserRole.isSuperAdmin
                  ? "SUPER ADMIN (KONTROL PENUH)"
                  : currentUserRole.isAdmin
                    ? "ADMINISTRATOR (OPERASIONAL UTAMA)"
                    : "PETUGAS (USER BIASA)"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-1">
          <div className="rounded-lg border bg-muted/30 p-3 text-xs flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <User className="size-4 text-muted-foreground" />
                <span className="font-semibold text-foreground">
                  Akun: {sessionUser?.email ?? "Sedang memuat..."}
                </span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                {currentUserRole?.isSuperAdmin ? (
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    ✓ Akun Super Admin memegang kontrol penuh seluruh sistem dan berwenang memberikan/mengubah peran pengguna (Admin dan User) di database.
                  </span>
                ) : currentUserRole?.isAdmin ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    ✓ Akun Admin operasional utama (router, cpe, threshold, billing, system). Manajemen akun dan pengangkatan peran dikontrol penuh oleh Super Admin.
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    ⚠ Akun Petugas biasa (User). Hak akses terbatas untuk melihat pemantauan operasional.
                  </span>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KARTU INTEGRASI LOGTO OAUTH / SSO (DOCKER) */}
      <Card className="border border-indigo-500/30 bg-card shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="size-4 text-indigo-500" />
                <span>Integrasi Logto OAuth / Single Sign-On (Docker)</span>
              </CardTitle>
              <CardDescription>
                Layanan identity provider &amp; SSO Logto terintegrasi via Docker Compose (compose.logto.yaml).
              </CardDescription>
            </div>
            <Badge variant="outline" className="border-indigo-500/50 text-indigo-600 dark:text-indigo-400 text-xs">
              PORT 3301 (OIDC) &bull; PORT 3002 (CONSOLE)
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-1 text-xs text-muted-foreground">
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Radio className="size-3.5 text-indigo-500" />
                Status Docker Service:
              </span>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                npm run logto:up
              </code>
            </div>
            <p className="leading-relaxed">
              Jalankan <code className="font-mono text-foreground font-semibold">npm run logto:up</code> untuk menyalakan kontainer Logto Core (<code className="font-mono text-foreground">http://localhost:3301</code>) dan Admin Console (<code className="font-mono text-foreground">http://localhost:3002</code>).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Keterangan bagi Non-Super Admin */}
      {!currentUserRole?.isSuperAdmin && !loading && (
        <div className="rounded-lg border border-border bg-muted/20 p-3.5 text-xs flex items-center gap-3 text-muted-foreground">
          <Shield className="size-5 text-primary shrink-0" />
          <span>
            Anda masuk sebagai <strong className="text-foreground">{currentUserRole?.isAdmin ? "Admin Utama (AI)" : "User / Petugas"}</strong>. Anda dapat melihat hierarki seluruh akun pengguna di bawah ini. Pengubahan peran dan penambahan akun baru sepenuhnya dikontrol oleh Super Admin.
          </span>
        </div>
      )}

      <div className="space-y-4">
        {createSuccess && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
            <Check className="size-4 shrink-0" />
            <span>{createSuccess}</span>
          </div>
        )}
          {createError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
              <ShieldAlert className="size-4 shrink-0" />
              <span>{createError}</span>
            </div>
          )}

          {/* Form Buat Akun Baru */}
          {showCreateForm && (
            <Card className="border border-amber-500/30 bg-card shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <UserPlus className="size-4 text-amber-500" />
                  <span>Form Tambah / Berikan Akun oleh Super Admin</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Buatkan akun baru secara langsung dan tentukan perannya (Super Admin, Admin, atau User). Akun akan langsung aktif di database.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreateUser} className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1">
                      <Label htmlFor="admin-create-name" className="text-xs">Nama Petugas</Label>
                      <Input
                        id="admin-create-name"
                        value={createName}
                        onChange={(e) => setCreateName(e.target.value)}
                        placeholder="Nama Lengkap"
                        required
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="admin-create-email" className="text-xs">Email</Label>
                      <Input
                        id="admin-create-email"
                        type="email"
                        value={createEmail}
                        onChange={(e) => setCreateEmail(e.target.value)}
                        placeholder="nama@noc.local"
                        required
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="admin-create-password" className="text-xs">Kata Sandi</Label>
                      <Input
                        id="admin-create-password"
                        type="password"
                        value={createPassword}
                        onChange={(e) => setCreatePassword(e.target.value)}
                        placeholder="Min. 8 karakter"
                        required
                        minLength={8}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="admin-create-role" className="text-xs">Peran Akun</Label>
                      <select
                        id="admin-create-role"
                        value={createRole}
                        onChange={(e) => setCreateRole(e.target.value as "superadmin" | "admin" | "user")}
                        className={cn(selectClassName, "h-8 w-full text-xs")}
                      >
                        <option value="user">Petugas / User Biasa</option>
                        <option value="admin">Admin (Operasional Utama)</option>
                        <option value="superadmin">Super Admin (Kontrol Penuh)</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowCreateForm(false)}
                      className="h-8 text-xs"
                    >
                      Batal
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={creating}
                      className="h-8 text-xs font-medium"
                    >
                      {creating ? (
                        <>
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                          Membuat Akun...
                        </>
                      ) : (
                        "Buat & Berikan Akun"
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Form Reset Password Pengguna */}
          {resetTargetUser && (
            <Card className="border border-blue-500/30 bg-card shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <KeyRound className="size-4 text-blue-500" />
                  <span>Reset Kata Sandi: {resetTargetUser.email}</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Atur kata sandi baru untuk akun {resetTargetUser.name ? `"${resetTargetUser.name}"` : ""} ({resetTargetUser.email}).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleResetPassword} className="space-y-3">
                  {passwordResetMsg && (
                    <div
                      className={cn(
                        "rounded-md p-2.5 text-xs flex items-center gap-2",
                        passwordResetMsg.type === "success"
                          ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "border border-destructive/30 bg-destructive/10 text-destructive",
                      )}
                    >
                      {passwordResetMsg.type === "success" ? <Check className="size-4 shrink-0" /> : <ShieldAlert className="size-4 shrink-0" />}
                      <span>{passwordResetMsg.text}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1 flex-1 min-w-[200px]">
                      <Label htmlFor="admin-new-password" className="text-xs">Kata Sandi Baru</Label>
                      <Input
                        id="admin-new-password"
                        type="password"
                        value={newPasswordInput}
                        onChange={(e) => setNewPasswordInput(e.target.value)}
                        placeholder="Minimal 8 karakter"
                        required
                        minLength={8}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setResetTargetUser(null);
                          setPasswordResetMsg(null);
                        }}
                        className="h-8 text-xs"
                      >
                        Batal
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={resettingPassword}
                        className="h-8 text-xs font-medium"
                      >
                        {resettingPassword ? (
                          <>
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            Menyimpan...
                          </>
                        ) : (
                          "Simpan Kata Sandi"
                        )}
                      </Button>
                    </div>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Tabel Pengguna */}
          <Card className="border border-border bg-card shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="size-4 text-primary" />
                <span>Daftar Seluruh Pengguna</span>
              </CardTitle>
              <CardDescription>
                Setiap akun yang terdaftar dapat Anda atur perannya langsung di sistem.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-1">
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
                  <ShieldAlert className="size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {loading && users.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  <span>Memuat data pengguna dari database...</span>
                </div>
              ) : users.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  Tidak ada pengguna terdaftar.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead className="text-xs font-semibold">Nama</TableHead>
                        <TableHead className="text-xs font-semibold">Email</TableHead>
                        <TableHead className="text-xs font-semibold">Metode Login</TableHead>
                        <TableHead className="text-xs font-semibold">Tanggal Terdaftar</TableHead>
                        <TableHead className="text-xs font-semibold">Role Saat Ini</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Aksi Manajemen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => {
                        const currentRole = u.role ?? "user";
                        const selectedRole = selectedRoles[u.id] ?? currentRole;
                        const isSaving = savingUserId === u.id;
                        const userFeedback = feedback?.userId === u.id ? feedback : null;

                        return (
                          <TableRow key={u.id}>
                            <TableCell className="text-xs font-medium text-foreground py-3">
                              <span className="flex items-center gap-1.5">
                                {u.name || "-"}
                                {sessionUser?.id === u.id && (
                                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                    Anda
                                  </span>
                                )}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground py-3">
                              {u.email}
                            </TableCell>
                            <TableCell className="py-3 whitespace-nowrap">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {(u.providers?.includes("logto") || u.providers?.includes("google")) && (
                                  <Badge variant="outline" className="text-[10px] font-medium gap-1.5 border-border bg-card">
                                    <svg className="size-3 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                                    </svg>
                                    <span>Google SSO</span>
                                  </Badge>
                                )}
                                {u.providers?.includes("credential") && (
                                  <Badge variant="outline" className="text-[10px] font-medium gap-1 text-muted-foreground border-border bg-card">
                                    <Mail className="size-3" />
                                    <span>Email &amp; Sandi</span>
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground py-3 whitespace-nowrap">
                              {formatRegistrationDate(u.createdAt)}
                            </TableCell>
                            <TableCell className="py-3">
                              {isSuperAdmin(currentRole) ? (
                                <Badge className="bg-amber-500 hover:bg-amber-600 text-white dark:bg-amber-600 dark:hover:bg-amber-700 text-[11px] font-semibold gap-1">
                                  <Crown className="size-3" />
                                  <span>SUPER ADMIN (OWNER)</span>
                                </Badge>
                              ) : isAdmin(currentRole) ? (
                                <Badge className="bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold gap-1">
                                  <ShieldCheck className="size-3" />
                                  <span>ADMIN UTAMA (AI)</span>
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[11px] font-medium gap-1">
                                  <User className="size-3" />
                                  <span>PETUGAS (USER)</span>
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="py-3 text-right">
                              {currentUserRole?.isSuperAdmin ? (
                                <div className="flex flex-col items-end gap-1.5">
                                  <div className="flex items-center justify-end gap-2">
                                    <select
                                      value={selectedRole}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setSelectedRoles((prev) => ({
                                          ...prev,
                                          [u.id]: val,
                                        }));
                                        if (feedback?.userId === u.id) {
                                          setFeedback(null);
                                        }
                                      }}
                                      disabled={isSaving}
                                      className={cn(selectClassName, "h-8 w-44 text-xs")}
                                    >
                                      <option value="superadmin">👑 Super Admin (Kontrol Penuh)</option>
                                      <option value="admin">🛡️ Admin Utama (Operasional NOC)</option>
                                      <option value="user">👤 Petugas / User Biasa</option>
                                    </select>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 text-xs font-medium"
                                      disabled={isSaving}
                                      onClick={() => void handleSetRole(u.id)}
                                    >
                                      {isSaving ? (
                                        <>
                                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                                          Menyimpan...
                                        </>
                                      ) : (
                                        "Terapkan Peran"
                                      )}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                                      title={`Reset kata sandi ${u.email}`}
                                      onClick={() => {
                                        setResetTargetUser(u);
                                        setNewPasswordInput("");
                                        setPasswordResetMsg(null);
                                      }}
                                    >
                                      <KeyRound className="size-3.5" />
                                      <span className="hidden sm:inline">Reset Sandi</span>
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={sessionUser?.id === u.id || deletingUserId === u.id}
                                      className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10 border-destructive/30"
                                      title={sessionUser?.id === u.id ? "Tidak dapat menghapus akun Anda sendiri" : `Hapus akun ${u.email}`}
                                      onClick={() => void handleDeleteUser(u.id, u.email)}
                                    >
                                      {deletingUserId === u.id ? (
                                        <Loader2 className="size-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="size-3.5" />
                                      )}
                                      <span className="hidden sm:inline">Hapus</span>
                                    </Button>
                                  </div>
                                  {userFeedback && (
                                    <p
                                      className={cn(
                                        "text-[11px] leading-tight",
                                        userFeedback.type === "success"
                                          ? "text-emerald-600 dark:text-emerald-400 font-medium"
                                          : "text-destructive font-medium",
                                      )}
                                    >
                                      {userFeedback.type === "success" ? "✓ " : "✕ "}
                                      {userFeedback.message}
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <Badge variant="outline" className="text-[11px] text-muted-foreground">
                                  Dikelola Super Admin
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
    </div>
  );
}
