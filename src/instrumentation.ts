export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runStartupValidation, formatStartupBanner } =
      await import("@/lib/startup-validator");
    const report = runStartupValidation(process.env);
    console.log(formatStartupBanner(report));

    if (!report.canBoot && process.env.NODE_ENV === "production") {
      console.error(
        "[FATAL] Aplikasi menolak start karena konfigurasi belum lengkap:",
      );
      for (const err of report.fatalErrors) {
        console.error(` - ${err}`);
      }
      process.exit(1);
    }

    // `npm run all:server`: DB server hanya-baca. Semua di bawah menulis ke DB (migrasi, seed, versi, pekerja
    // latar) dan sudah dijalankan oleh instance server sendiri.
    if (process.env.NOC_READONLY_DB === "1") {
      console.log(
        "DB server hanya-baca: migrasi, seed, dan pekerja latar dilewati.",
      );
      return;
    }

    // Jalankan migrasi skema dan seed awal sebelum aplikasi melayani permintaan
    if (report.canBoot) {
      const { runStartupMigrations } =
        await import("@/services/startup-migration.service");
      const migResult = await runStartupMigrations();

      if (migResult.success) {
        const { runStartupSeed } =
          await import("@/services/startup-seed.service");
        await runStartupSeed();

        try {
          const { ensureBuildVersion } =
            await import("@/services/build-version.service");
          const versi = await ensureBuildVersion();
          if (versi) console.log(`Versi aplikasi: ${versi}`);
        } catch (err) {
          console.error("Gagal mencatat versi build:", err);
        }
      }

      try {
        const { startVlanBackgroundCollector } =
          await import("@/services/vlan-traffic.service");
        startVlanBackgroundCollector();
      } catch (err) {
        console.error("Gagal memulai background collector VLAN:", err);
      }

      // Diagnosa pelanggan (trigger otomatis + analisis) berjalan di backend
      // Go: internal/diagnostics. Next hanya menampilkan hasilnya.
    }

    // Di luar gerbang canBoot: pencocokan ONU hanya butuh database, sedangkan canBoot menuntut variabel MikroTik REST
    // lama yang tidak dipakai lagi (router kini disimpan di database). Tanpa ini pemetaan ONU->pelanggan tidak jalan.
    try {
      // Impor dinamis: hanya runtime Node; impor statis menarik db/pg ke bundel edge.
      const { startOnuAutoMatch } = await import("@/services/devices.service");
      startOnuAutoMatch();
    } catch (err) {
      console.error("Gagal memulai pencocokan ONU otomatis:", err);
    }
  }
}
