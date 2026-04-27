export const runtime = "nodejs";

import { memStore as store } from "@/lib/swarm-memory-store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const result = await store.ensureWorkspaceDefaults({ workspaceId });
  return Response.json(result);
}

