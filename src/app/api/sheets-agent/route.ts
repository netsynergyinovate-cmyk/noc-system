import { runNocSheetsAgentWithThinking } from "@/services/google-sheets-live-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // 2 menit untuk multi-turn reasoning dan Google batchUpdate

interface RequestBody {
  prompt?: unknown;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const prompt = body?.prompt;

    if (!prompt || typeof prompt !== "string") {
      return new Response(
        JSON.stringify({ error: "Parameter 'prompt' wajib diisi (string)." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let isClosed = false;

        const sendEvent = (data: unknown) => {
          if (isClosed) return;
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
            );
          } catch {
            isClosed = true;
          }
        };

        // Ping keep-alive setiap 10 detik agar koneksi SSE tidak di-drop oleh proxy/browser
        const pingInterval = setInterval(() => {
          if (isClosed) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            isClosed = true;
          }
        }, 10000);

        try {
          const result = await runNocSheetsAgentWithThinking(
            prompt,
            (trace) => {
              sendEvent({ type: "trace", trace });
            },
          );
          sendEvent({ type: "done", answer: result.finalAnswer });
        } catch (e: unknown) {
          const err = e instanceof Error ? e : new Error(String(e));
          sendEvent({ type: "error", message: err.message });
        } finally {
          clearInterval(pingInterval);
          if (!isClosed) {
            isClosed = true;
            controller.close();
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Terjadi kesalahan internal server.";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
