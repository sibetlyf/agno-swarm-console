export const runtime = "nodejs";

import { memStore as store } from "@/lib/swarm-memory-store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
  const agentId = url.searchParams.get("agentId") ?? undefined;

  const groups = await store.listGroups({ workspaceId, agentId });
  return Response.json({ groups });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    workspaceId: string;
    memberIds: string[];
    name?: string;
  };

  if (body.memberIds.length === 2) {
    const groupId =
      (await store.mergeDuplicateExactP2PGroups({
        workspaceId: body.workspaceId,
        memberA: body.memberIds[0]!,
        memberB: body.memberIds[1]!,
        preferredName: body.name ?? null,
      })) ??
      (
        await store.createGroup({
          workspaceId: body.workspaceId,
          memberIds: body.memberIds,
          name: body.name ?? undefined,
        })
      ).id;

    return Response.json({ id: groupId, name: body.name ?? null }, { status: 201 });
  }

  const group = await store.createGroup(body);
  return Response.json(group, { status: 201 });
}
