export const runtime = "nodejs";

import { memStore as store } from "@/lib/swarm-memory-store";

export async function GET() {
  try {
    let workspaces = await store.listWorkspaces();
    if (workspaces.length === 0) {
      await store.createWorkspaceWithDefaults({ name: "Default Workspace" });
      workspaces = await store.listWorkspaces();
    }
    return Response.json({ workspaces });
  } catch (e) {
    return Response.json(
      {
        error: "Workspace store not ready",
        message: e instanceof Error ? e.message : String(e),
        hint: "This frontend-only mode uses in-memory store. Check server logs.",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { name?: string } | null;
    const result = await store.createWorkspaceWithDefaults({
      name: body?.name ?? "Default Workspace",
    });
    return Response.json(result, { status: 201 });
  } catch (e) {
    return Response.json(
      {
        error: "Failed to create workspace",
        message: e instanceof Error ? e.message : String(e),
        hint: "In-memory mode: retry and check route logs",
      },
      { status: 500 }
    );
  }
}
