export const runtime = "nodejs";

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const BACKEND_ORIGIN =
  (process.env.NEXT_PUBLIC_BACKEND_ORIGIN || process.env.BACKEND_ORIGIN || "").trim().replace(/\/$/, "") ||
  null;

type WorkspacePayload = {
  workspace: string;
  runspace: string | null;
};

function normalizeWorkspacePayload(value: unknown): WorkspacePayload | null {
  if (typeof value === "string") {
    const workspace = value.trim();
    if (!workspace) return null;
    return { workspace, runspace: null };
  }

  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const workspace = [rec.workspace, rec.WORKSPACE, rec.path, rec.workdir].find((entry) => typeof entry === "string" && entry.trim()) as string | undefined;
    if (!workspace) return null;
    const runspace = [rec.runspace, rec.RUNSPACE, rec.runs, rec.runs_path].find((entry) => typeof entry === "string" && entry.trim()) as string | undefined;
    return { workspace: workspace.trim(), runspace: runspace?.trim() || null };
  }

  return null;
}

async function resolveWorkspaceFromBackend(): Promise<WorkspacePayload | null> {
  if (!BACKEND_ORIGIN) return null;
  const candidates = ["/workspace", "/api/workspace", "/api/debug/workspace"];
  for (const endpoint of candidates) {
    try {
      const res = await fetch(`${BACKEND_ORIGIN}${endpoint}`, { cache: "no-store" });
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const parsed = (await res.json()) as unknown;
        const normalized = normalizeWorkspacePayload(parsed);
        if (normalized) return normalized;
      } else {
        const text = (await res.text()).trim();
        const normalized = normalizeWorkspacePayload(text);
        if (normalized) return normalized;
      }
    } catch {
      // try next endpoint
    }
  }
  return null;
}

async function isReadableDir(dir: string | null): Promise<boolean> {
  if (!dir) return false;
  try {
    await readdir(dir, { withFileTypes: true });
    return true;
  } catch {
    return false;
  }
}

async function resolveAllowedRoots(): Promise<string[]> {
  const envWorkspace = process.env.WORKSPACE?.trim() || null;
  const envRunspace = process.env.RUNSPACE?.trim() || null;
  const backendWorkspace = await resolveWorkspaceFromBackend();

  const candidates = [
    backendWorkspace?.workspace || null,
    backendWorkspace?.runspace || null,
    envWorkspace,
    envRunspace,
    envWorkspace ? path.join(envWorkspace, "runs") : null,
  ].filter((value): value is string => !!value);

  const roots: string[] = [];
  for (const candidate of candidates) {
    if (!(await isReadableDir(candidate))) continue;
    const resolved = path.resolve(candidate);
    if (!roots.includes(resolved)) roots.push(resolved);
  }
  return roots;
}

function resolveContentType(filePath: string): string {
  if (/\.html?$/i.test(filePath)) return "text/html; charset=utf-8";
  if (/\.(md|markdown)$/i.test(filePath)) return "text/markdown; charset=utf-8";
  if (/\.json$/i.test(filePath)) return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path")?.trim();
  if (!rawPath) {
    return Response.json({ ok: false, error: "Missing path" }, { status: 400 });
  }

  const roots = await resolveAllowedRoots();
  if (roots.length === 0) {
    return Response.json({ ok: false, error: "No readable workspace roots available" }, { status: 400 });
  }

  const resolvedPath = path.resolve(rawPath);
  const allowed = roots.some((root) => resolvedPath === root || resolvedPath.startsWith(`${root}${path.sep}`));
  if (!allowed) {
    return Response.json({ ok: false, error: "Path is outside allowed workspace roots" }, { status: 403 });
  }

  try {
    const content = await readFile(resolvedPath, "utf-8");
    return Response.json({
      ok: true,
      path: resolvedPath,
      content,
      contentType: resolveContentType(resolvedPath),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 404 }
    );
  }
}
