import type { Locator } from "@playwright/test";

// Pengukur kontras bersama untuk spesifikasi halaman. Bukan spesifikasi (tanpa
// .spec), jadi aman diimpor.

// Kontras tulisan terhadap latarnya (WCAG: 4,5 : 1 untuk teks biasa). Latar
// dihitung dengan menumpuk warna latar semua leluhur dari akar sampai elemen,
// termasuk yang bening (mis. bg-destructive/5); warna dihitung lewat canvas.
export async function contrastOf(locator: Locator) {
  return locator.evaluate((el) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const paint = (layers: string[]) => {
      ctx.clearRect(0, 0, 1, 1);
      for (const color of layers) {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
      }
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    };
    const luminance = ([r, g, b]: number[]) => {
      const channel = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const layers: string[] = ["#ffffff"];
    for (let node: Element | null = el; node; node = node.parentElement) {
      layers.splice(1, 0, getComputedStyle(node).backgroundColor);
    }
    const background = paint(layers);
    const ink = paint([...layers, getComputedStyle(el).color]);
    const [hi, lo] = [luminance(ink), luminance(background)].sort(
      (a, b) => b - a,
    );
    return {
      text: (el.textContent ?? "").trim().slice(0, 40),
      ratio: (hi + 0.05) / (lo + 0.05),
    };
  });
}
