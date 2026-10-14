const integer = new Intl.NumberFormat("id-ID");
const oneDecimal = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export const formatInteger = (value: number) => integer.format(value);
export const formatMbps = (value: number) => `${oneDecimal.format(value)} Mbps`;
export const formatDbm = (value: number) => `${oneDecimal.format(value)} dBm`;

// "3 menit", "1 jam 5 menit"; paling sedikit satu menit.
export function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} jam` : `${hours} jam ${rest} menit`;
}

// Lama berjalan sampai detik: "45 detik", "12 menit 30 detik". Mulai satu jam
// detiknya dibuang ("1 jam 5 menit") karena angkanya hanya mengganggu.
export function formatElapsed(seconds: number) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  if (total < 60) return `${total} detik`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) {
    return rest === 0 ? `${minutes} menit` : `${minutes} menit ${rest} detik`;
  }
  const hours = Math.floor(minutes / 60);
  const minutesLeft = minutes % 60;
  return minutesLeft === 0
    ? `${hours} jam`
    : `${hours} jam ${minutesLeft} menit`;
}

// Lama dalam format ISO 8601 ("PT12M30S") untuk atribut dateTime pada <time>.
export function isoDuration(seconds: number) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const parts = `${hours ? `${hours}H` : ""}${minutes ? `${minutes}M` : ""}${rest || total === 0 ? `${rest}S` : ""}`;
  return `PT${parts}`;
}
