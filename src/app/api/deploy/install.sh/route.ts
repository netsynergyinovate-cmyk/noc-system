import { readFile } from "fs/promises";
import { resolve } from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const installScriptPath = resolve(process.cwd(), "scripts", "install.sh");
    const scriptContent = await readFile(installScriptPath, "utf-8");

    return new Response(scriptContent, {
      status: 200,
      headers: {
        "Content-Type": "text/x-shellscript; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Content-Disposition": 'inline; filename="install.sh"',
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Skrip install.sh tidak ditemukan";
    return new Response(
      `#!/usr/bin/env bash\necho "Error: ${message}" >&2\nexit 1\n`,
      {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  }
}
