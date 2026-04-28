export const runtime = "nodejs";

import { getWorkspaceUIBus } from "@/runtime/ui-bus";

function sse(data: unknown) {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

function sseWithId(id: string | number | null | undefined, data: unknown) {
  const prefix =
    typeof id === "string"
      ? `id: ${id}\n`
      : typeof id === "number"
        ? `id: ${id}\n`
        : "";
  return new TextEncoder().encode(`${prefix}data: ${JSON.stringify(data)}\n\n`);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!workspaceId) {
    return Response.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendKeepalive = () => controller.enqueue(new TextEncoder().encode(`: ping\n\n`));

      const bus = getWorkspaceUIBus();
      const unsubscribeLocal = bus.subscribe(workspaceId, (evt) => {
        controller.enqueue(sseWithId(evt.id, { event: evt.event, data: evt.data }));
      });

      for (const evt of bus.getSince(workspaceId, 0)) {
        controller.enqueue(sseWithId(evt.id, { event: evt.event, data: evt.data }));
      }

      const keepalive = setInterval(sendKeepalive, 15_000);

      let closed = false;
      const abortHandler = async () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        unsubscribeLocal();
        try {
          controller.close();
        } catch {
          // ignore double-close
        }
      };

      if (req.signal.aborted) void abortHandler();
      req.signal.addEventListener("abort", () => void abortHandler(), { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Encoding": "none",
    },
  });
}
