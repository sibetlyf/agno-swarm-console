export const runtime = "nodejs";

import { memStore as store } from "@/lib/swarm-memory-store";
import { getBridgeBus } from "@/runtime/bridge-bus";

function sseWithId(id: string | number | null | undefined, data: unknown) {
  const prefix =
    typeof id === "string"
      ? `id: ${id}\n`
      : typeof id === "number"
        ? `id: ${id}\n`
        : "";
  return new TextEncoder().encode(`${prefix}data: ${JSON.stringify(data)}\n\n`);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  new URL(req.url);
  await store.getAgent({ agentId });
  const bus = getBridgeBus();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendKeepalive = () => controller.enqueue(new TextEncoder().encode(`: ping\n\n`));

      const unsubscribeLocal = bus.subscribe(agentId, (evt) => {
        controller.enqueue(sseWithId(evt.id, { event: evt.event, data: evt.data }));
      });

      const keepalive = setInterval(sendKeepalive, 15_000);

      const abortHandler = async () => {
        clearInterval(keepalive);
        unsubscribeLocal();
        controller.close();
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
