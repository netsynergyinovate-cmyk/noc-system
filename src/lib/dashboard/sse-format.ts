// Satu event Server-Sent Events. Dipisah dari route karena file route Next.js
// hanya boleh mengekspor handler HTTP.
export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
