"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { cn } from "cn";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  KeyRound,
  Loader2,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
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
import { isSuperAdmin, isAdmin, isUser, roleLabel, roleNames } from "@/lib/roles";
import { authClient } from "@/lib/auth-client";
import { selectClassName } from "./select-class";

interface AdminListedUser {
  id: string;
  name?: string | null;
  email: string;
  role?: string | null;
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
      const res = await authClient.admin.listUsers({
        query: { limit: 100 },
      });
      if (res.error) {
        setError(res.error.message || "Gagal memuat daftar pengguna.");
      } else if (res.data?.users) {
        const userList = res.data.users as AdminListedUser[];
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
    if (currentUserRole?.isSuperAdmin) {
      void fetchUsers();
    } else {
      setLoading(false);
    }
  }, [currentUserRole?.isSuperAdmin, fetchUsers]);

  async function handleSetRole(userId: string) {
    const targetRole = selectedRoles[userId] ?? "user";
    setSavingUserId(userId);
    setFeedback(null);
    try {
      const res = await authClient.admin.setRole({
        userId,
        role: targetRole as "user" | "admin" | "superadmin",
      });
      if (res.error) {
        setFeedback({
          type: "error",
          message: res.error.message || "Gagal mengubah peran akun.",
          userId,
        });
      } else {
        setFeedback({
          type: "success",
          message: `Peran berhasil diubah menjadi ${roleLabel(targetRole)}.`,
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

      {/* Jika Bukan Super Admin: Tampilkan Pesan Informasi */}
      {!currentUserRole?.isSuperAdmin && !loading && (
        <Card className="border border-border bg-card shadow-sm">
          <CardContent className="py-8 text-center space-y-2">
            <Shield className="size-8 mx-auto text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Akses Khusus Super Admin</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Halaman manajemen dan pengangkatan peran akun ini hanya dapat diakses oleh akun Super Admin. Akun Anda saat ini tidak memiliki wewenang untuk mengubah peran atau mengelola pengguna lain.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Bagian Manajemen Akun Khusus Super Admin */}
      {currentUserRole?.isSuperAdmin && (
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
                <span>Daftar Seluruh Pengguna di Database</span>
              </CardTitle>
              <CardDescription>
                Setiap akun yang terdaftar dapat Anda atur perannya langsung ke PostgreSQL.
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
                        <TableHead className="text-xs font-semibold">Tanggal Terdaftar</TableHead>
                        <TableHead className="text-xs font-semibold">Role Saat Ini</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Aksi Ubah Peran</TableHead>
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
                            <TableCell className="text-xs text-muted-foreground py-3 whitespace-nowrap">
                              {formatRegistrationDate(u.createdAt)}
                            </TableCell>
                            <TableCell className="py-3">
                              <Badge
                                variant={isSuperAdmin(currentRole) ? "default" : isAdmin(currentRole) ? "default" : "secondary"}
                                className={
                                  isSuperAdmin(currentRole)
                                    ? "bg-amber-500 hover:bg-amber-600 text-white dark:bg-amber-600 dark:hover:bg-amber-700 text-[11px]"
                                    : "text-[11px]"
                                }
                              >
                                {roleLabel(currentRole)}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-3 text-right">
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
                                    <option value="superadmin">Super Admin</option>
                                    <option value="admin">Admin</option>
                                    <option value="user">Petugas / User</option>
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
      )}
    </div>
  );
}
