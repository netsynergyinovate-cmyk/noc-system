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
    }
  }
}
