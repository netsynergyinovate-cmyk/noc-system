# Laporan Investigasi Akar Masalah & Perbaikan Crash Leaflet TileLayer Subdomains

- **Tanggal & Waktu**: 2026-10-16 23:13 WIB
- **Cabang Git**: `feat/satellite-map-and-odp-routing`
- **Terkait Isu**: Browser Console Crash `TypeError: Cannot read properties of undefined (reading 'length')` pada pustaka Leaflet `TileLayer._getSubdomain`.

---

## 1. Analisis Akar Masalah (Deep Root-Cause Analysis)

### Bukti Galat Konsol Peramban
```
0yslia1k6p-7o.js:1 TypeError: Cannot read properties of undefined (reading 'length')
    at i._getSubdomain (0tk3t-f1r97km.js:1:118221)
    at i.getTileUrl (0tk3t-f1r97km.js:1:117555)
    at i.createTile (0tk3t-f1r97km.js:1:117480)
    at i._addTile (0tk3t-f1r97km.js:1:115094)
    at i._update (0tk3t-f1r97km.js:1:113783)
    at i._setView (0tk3t-f1r97km.js:1:111526)
    at i._resetView (0tk3t-f1r97km.js:1:110861)
    at i.onAdd (0tk3t-f1r97km.js:1:106445)
    at i._layerAdd (0tk3t-f1r97km.js:1:66860)
    at i.whenReady (0tk3t-f1r97km.js:1:42646)
```

### Mekanisme Internal Leaflet
1. Di dalam implementasi inti Leaflet (`leaflet-src.js:12199-12255`):
   ```javascript
   getTileUrl: function (coords) {
       var data = {
           r: Browser.retina ? '@2x' : '',
           s: this._getSubdomain(coords),
           x: coords.x,
           y: coords.y,
           z: this._getZoomForUrl()
       };
       ...
   },
   _getSubdomain: function (tilePoint) {
       var index = Math.abs(tilePoint.x + tilePoint.y) % this.options.subdomains.length;
       return this.options.subdomains[index];
   }
   ```
2. `getTileUrl` memanggil `_getSubdomain` tanpa syarat, bahkan jika template URL tidak memuat placeholder `{s}` (misalnya Esri World Imagery: `https://server.arcgisonline.com/.../tile/{z}/{y}/{x}`).
3. Di konstruktor `L.TileLayer`, Leaflet menjalankan `setOptions(this, options)`. Ketika komponen React-Leaflet me-render `<TileLayer ... subdomains={E[K].subdomains} />` dan properti `subdomains` bernilai `undefined`, React meneruskan `{ subdomains: undefined }` ke dalam objek opsi.
4. `setOptions` melakukan `for (var i in options) target.options[i] = options[i]`, sehingga meng-assign `this.options.subdomains = undefined` sebagai properti langsung (*own property*), menimpa nilai default bawaan Leaflet prototype (`'abc'`).
5. Saat petak (*tile*) pertama dirender, eksekusi `this.options.subdomains.length` langsung melempar `TypeError: Cannot read properties of undefined (reading 'length')` dan meruntuhkan halaman ke `error.tsx`.

---

## 2. Solusi Rekayasa Pertahanan Ganda (*Double-Defense Strategy*)

### Pertahanan 1: Guarding Prototype Leaflet Global
Di bagian atas modul klien `src/components/map/network-map.tsx`:
```typescript
interface LeafletTileLayerInternal {
  options: {
    subdomains?: string[] | string;
    [key: string]: unknown;
  };
  _getSubdomain: (coords: { x: number; y: number }) => string;
}

// Pertahanan runtime global: Cegah crash TileLayer._getSubdomain jika subdomains undefined/kosong
if (typeof window !== "undefined") {
  const tileLayerProto = (
    L.TileLayer as unknown as { prototype: LeafletTileLayerInternal }
  )?.prototype;
  if (tileLayerProto?._getSubdomain) {
    const originalGetSubdomain = tileLayerProto._getSubdomain;
    tileLayerProto._getSubdomain = function (
      this: LeafletTileLayerInternal,
      coords: { x: number; y: number },
    ) {
      if (
        !this.options ||
        !Array.isArray(this.options.subdomains) ||
        this.options.subdomains.length === 0
      ) {
        this.options = this.options || {};
        this.options.subdomains = ["a", "b", "c"];
      }
      return originalGetSubdomain.call(this, coords);
    };
  }
}
```

### Pertahanan 2: Resolusi Provider & Jaminan Subdomain Valid di JSX
Pada komponen `NetworkMap` saat me-render `TileLayer`:
```tsx
{(() => {
  const provider = TILE_PROVIDERS[layerMode] || TILE_PROVIDERS.satellite;
  const subdomains =
    provider.subdomains && provider.subdomains.length > 0
      ? provider.subdomains
      : ["a", "b", "c"];
  return (
    <TileLayer
      key={layerMode}
      attribution={provider.attribution}
      url={provider.url}
      maxNativeZoom={provider.maxNativeZoom}
      maxZoom={provider.maxZoom}
      subdomains={subdomains}
      eventHandlers={{
        tileerror: () => {
          setTileErrorCount((prev) => prev + 1);
        },
      }}
    />
  );
})()}
```

### Konfigurasi Standar Peta (`src/config/map.ts`)
Semua layer (`satellite`, `streets`, `topo`) dijamin mengekspor array subdomain valid `subdomains: ["a", "b", "c"]`.

---

## 3. Gerbang Verifikasi Mandiri (Evidence Before Assertions)

### 1. TypeScript Check
```bash
npm run typecheck
```
- **Hasil**: 0 error (`Generating route types... ✓ Types generated successfully`).

### 2. ESLint
```bash
npx eslint src/components/map/network-map.tsx src/config/map.ts
```
- **Hasil**: 0 error (memenuhi standar `@typescript-eslint/no-explicit-any` dengan interface khusus).

### 3. Pengujian Unit
```bash
node --test tests/map*.test.mjs
```
- **Hasil**: 71 tests passed, 0 failed.
```bash
node --test tests/infrastructure*.test.mjs tests/customer*.test.mjs
```
- **Hasil**: 102 tests passed, 0 failed.

### 4. Build Next.js & Sinkronisasi Runtime Docker
```bash
npm run build
docker compose build app; docker compose up -d --no-deps app
```
- **Hasil**:
  - Image `nocsystem-app` ter-compile penuh (132 route static/dynamic berhasil di-generate).
  - Kontainer `nocsystem-app-1` berstatus `Up (healthy)`.

### 5. Verifikasi Real Browser (Playwright)
Menjalankan `scripts/verify-map-clean.mjs` di peramban Chromium:
- Navigasi `/app/peta` -> 0 console error.
- Navigasi `/app/pelanggan/peta` -> 0 console error.
- Screenshot bukti visual tersimpan:
  - `screenshots/verified-peta.png`
  - `screenshots/verified-pelanggan-peta.png`
- Seluruh petak satelit Esri dan OpenStreetMap termuat sempurna dengan respon log peramban:
  `this.options.subdomains value: [a, b, c]`.

