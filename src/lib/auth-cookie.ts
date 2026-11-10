// Ada tidaknya cookie sesi auth (noc_token atau cookie legacy), TANPA memeriksa isinya atau database.
// Cookie yang ada bisa basi (sesi dihapus atau kedaluwarsa); itu hanya cukup
// untuk pemeriksaan optimis di proxy. Yang menentukan akses tetap
// requireSession().
export function hasSessionCookie(headers: Headers, prefix?: string): boolean {
  const cookieHeader = headers.get("cookie") || "";
  if (/(?:^|;\s*)noc_token=([^;]+)/.test(cookieHeader)) {
    return true;
  }
  if (prefix) {
    const legacyName = `${prefix}.session_token`;
    if (cookieHeader.includes(legacyName)) {
      return true;
    }
  }
  return false;
}
