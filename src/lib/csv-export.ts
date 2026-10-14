export type CsvCell = string | number | boolean | null | undefined;

// Sel teks yang diawali karakter ini dieksekusi sebagai formula oleh Excel/Sheets.
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "string" ? value : String(value);
  // Angka bertipe number (mis. -5) aman; hanya string yang dinetralkan.
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// RFC 4180: baris dipisah CRLF, kutip digandakan.
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(cell).join(","))
    .join("\r\n")
    .concat("\r\n");
}
