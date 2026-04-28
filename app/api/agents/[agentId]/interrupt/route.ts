export const runtime = "nodejs";

import { getAgentRuntime } from "@/runtime/agent-runtime";
import { getWorkspaceUIBus } from "@/runtime/ui-bus";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const trimmedAgentId = agentId?.trim();
  if (!trimmedAgentId) {
    return Response.json({ error: "Missing agentId" }, { status: 400 });
  }

  const runtime = getAgentRuntime();
  const result = await runtime.interruptAgent({ agentId: trimmedAgentId });

  return Response.json({ ok: true, ...result });
}
