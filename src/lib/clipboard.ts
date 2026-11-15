// Salin teks ke clipboard. navigator.clipboard hanya ada di secure context (https/localhost);
// dasbor yang dibuka lewat http://IP-server memakai fallback execCommand. `host` = elemen
// tempat textarea sementara dipasang: di dalam popover/dialog supaya fokus tidak keluar dan
// popover tidak tertutup.
export async function copyText(
  text: string,
  host?: HTMLElement | null,
): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Ditolak peramban: coba fallback di bawah.
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  (host ?? document.body).appendChild(area);
  const back = document.activeElement as HTMLElement | null;
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    back?.focus();
  }
}
