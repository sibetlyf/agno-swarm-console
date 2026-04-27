export const runtime = "nodejs";

import { memStore as store } from "@/lib/swarm-memory-store";
import { getWorkspaceUIBus } from "@/runtime/ui-bus";
import { isAgnoBridgeEnabled, runAgentOsStream } from "@/runtime/agno-adapter";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const url = new URL(req.url);
  const markRead = url.searchParams.get("markRead") === "true";
  const readerId = url.searchParams.get("readerId") ?? undefined;

  const messages = await store.listMessages({
    groupId,
  });

  if (markRead && readerId) {
    await store.markGroupRead({ groupId, readerId });
  }

  return Response.json({ messages });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const body = (await req.json()) as {
    senderId: string;
    content: string;
    contentType?: string;
    reasoningContent?: string;
  };

  const result = await store.sendMessage({
    groupId,
    senderId: body.senderId,
    content: body.content,
    contentType: body.contentType ?? "text",
  });

  const memberIds = await store.listGroupMemberIds({ groupId });
  const workspaceId = await store.getGroupWorkspaceId({ groupId });
  getWorkspaceUIBus().emit(workspaceId, {
    event: "ui.message.created",
    data: {
      workspaceId,
      groupId,
      memberIds,
      message: { id: result.id, senderId: body.senderId, sendTime: result.sendTime },
    },
  });

  if (isAgnoBridgeEnabled()) {
    const senderRole = await store.getAgentRole({ agentId: body.senderId }).catch(() => null);
    if (senderRole !== "human") {
      return Response.json(result, { status: 201 });
    }

    const localAgentId = await (async () => {
      for (const id of memberIds) {
        if (id === body.senderId) continue;
        const role = await store.getAgentRole({ agentId: id }).catch(() => null);
        if (role && role !== "human") return id;
      }
      return null;
    })();

    if (localAgentId) {
      void runAgentOsStream({
        localAgentId,
        message: body.content,
        senderId: body.senderId,
        groupId,
      });
    }
  }

  return Response.json(result, { status: 201 });
}
