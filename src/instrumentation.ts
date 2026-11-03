export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runStartupValidation, formatStartupBanner } = await import(
      "@/lib/startup-validator"
    );
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

    // Jalankan migrasi skema dan seed awal sebelum aplikasi melayani permintaan
    if (report.canBoot) {
      const { runStartupMigrations } = await import(
        "@/services/startup-migration.service"
      );
      const migResult = await runStartupMigrations();

      if (migResult.success) {
        const { runStartupSeed } = await import(
          "@/services/startup-seed.service"
        );
        await runStartupSeed();
      }

      try {
        const { startVlanBackgroundCollector } = await import(
          "@/services/vlan-traffic.service"
        );
        startVlanBackgroundCollector();
      } catch (err) {
        console.error("Gagal memulai background collector VLAN:", err);
      }

      try {
        const { startDiagnosticAutoTrigger } = await import(
          "@/services/diagnostics.service"
        );
        await startDiagnosticAutoTrigger();
      } catch (err) {
        console.error("Gagal memulai pemicu diagnosa otomatis:", err);
      }
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
