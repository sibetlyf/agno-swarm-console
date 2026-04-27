export const runtime = "nodejs";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

type SubagentCard = {
  name: string;
  description: string;
  instructions: string;
  tools: string[];
  skills: string[];
  model?: string;
  sourceFile: string;
};

type TodoStep = {
  step_id?: number;
  title: string;
  content: string;
  status?: string;
};

type TodoPlan = {
  mission_id?: number;
  title: string;
  steps: TodoStep[];
};

type TodoDoc = {
  title: string;
  target?: string;
  plans: TodoPlan[];
  sourceFile: string;
};

const MAX_FILES = 200;

const BACKEND_ORIGIN =
  (process.env.NEXT_PUBLIC_BACKEND_ORIGIN || process.env.BACKEND_ORIGIN || "").trim().replace(/\/$/, "") ||
  null;

type WorkspacePayload = {
  workspace: string;
  runspace: string | null;
};

type BackendWorkspaceResolution = WorkspacePayload & {
  endpoint: string;
};

type ChosenWorkspace = WorkspacePayload & {
  workspaceSource: string;
};

function isRecord(v: unknown): v is JsonRecord {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function maybeSubagentCard(v: unknown, sourceFile: string): SubagentCard | null {
  if (!isRecord(v)) return null;
  const name = typeof v.name === "string" ? v.name : "";
  const description = typeof v.description === "string" ? v.description : "";
  const instructions = typeof v.instructions === "string" ? v.instructions : "";
  const tools = asStringArray(v.tools);
  const skills = asStringArray(v.skills);
  if (!name || !description || !instructions) return null;
  if (tools.length === 0 && skills.length === 0) return null;
  return {
    name,
    description,
    instructions,
    tools,
    skills,
    model: typeof v.model === "string" ? v.model : undefined,
    sourceFile,
  };
}

function maybeTodoDoc(v: unknown, sourceFile: string): TodoDoc | null {
  if (!isRecord(v)) return null;

  const plansRaw = Array.isArray(v.content)
    ? v.content
    : Array.isArray(v.plans)
      ? v.plans
      : Array.isArray(v.todo)
        ? v.todo
        : null;

  const flatTasksRaw = Array.isArray(v.todos)
    ? v.todos
    : Array.isArray(v.tasks)
      ? v.tasks
      : Array.isArray(v.items)
        ? v.items
        : null;

  if (!plansRaw && !flatTasksRaw) return null;
  const plans: TodoPlan[] = [];

  if (plansRaw) {
    for (const planRaw of plansRaw) {
      if (!isRecord(planRaw)) continue;
      const title = typeof planRaw.title === "string" ? planRaw.title : "";

      const stepsRaw = Array.isArray(planRaw.steps) ? planRaw.steps : [];
      const steps: TodoStep[] = stepsRaw
        .filter(isRecord)
        .map((step) => ({
          step_id: typeof step.step_id === "number" ? step.step_id : undefined,
          title: typeof step.title === "string" ? step.title : typeof step.content === "string" ? step.content.slice(0, 60) || "Untitled" : "Untitled",
          content: typeof step.content === "string" ? step.content : typeof step.description === "string" ? step.description : "",
          status: typeof step.status === "string" ? step.status : undefined,
        }));

      if (!title && steps.length === 0) continue;

      plans.push({
        mission_id: typeof planRaw.mission_id === "number" ? planRaw.mission_id : undefined,
        title: title || "Plan",
        steps,
      });
    }
  }

  if (flatTasksRaw) {
    const flatSteps: TodoStep[] = flatTasksRaw
      .filter(isRecord)
      .map((task, idx) => {
        const content =
          typeof task.content === "string"
            ? task.content
            : typeof task.description === "string"
              ? task.description
              : typeof task.text === "string"
                ? task.text
                : "";
        const title =
          typeof task.title === "string"
            ? task.title
            : typeof task.content === "string"
              ? task.content.slice(0, 60) || "Untitled"
              : `Task ${idx + 1}`;
        return {
          step_id: typeof task.step_id === "number" ? task.step_id : undefined,
          title,
          content,
          status: typeof task.status === "string" ? task.status : undefined,
        };
      });

    if (flatSteps.length > 0) {
      plans.push({
        mission_id: undefined,
        title: typeof v.title === "string" && v.title.trim() ? v.title : "Tasks",
        steps: flatSteps,
      });
    }
  }

  if (plans.length === 0) return null;

  return {
    title: typeof v.title === "string" ? v.title : "Todo",
    target: typeof v.target === "string" ? v.target : undefined,
    plans,
    sourceFile,
  };
}

async function walkJsonFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const queue: string[] = [root];

  while (queue.length > 0 && results.length < MAX_FILES) {
    const dir = queue.shift()!;
    let entries: Array<import("node:fs").Dirent> = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (results.length >= MAX_FILES) break;
      const name = String(entry.name);
      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (entry.isFile() && name.toLowerCase().endsWith(".json")) {
        results.push(full);
      }
    }
  }

  return results;
}

function normalizeWorkspacePayload(value: unknown): WorkspacePayload | null {
  if (typeof value === "string") {
    const workspace = value.trim();
    if (!workspace) return null;
    return { workspace, runspace: null };
  }

  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const candidates = [rec.workspace, rec.WORKSPACE, rec.path, rec.workdir];
    let workspace: string | null = null;
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) {
        workspace = c.trim();
        break;
      }
    }
    if (!workspace) return null;

    const runspaceCandidates = [rec.runspace, rec.RUNSPACE, rec.runs, rec.runs_path];
    let runspace: string | null = null;
    for (const c of runspaceCandidates) {
      if (typeof c === "string" && c.trim()) {
        runspace = c.trim();
        break;
      }
    }

    return { workspace, runspace };
  }

  return null;
}

async function resolveWorkspaceFromBackend(): Promise<BackendWorkspaceResolution | null> {
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
        if (normalized) return { ...normalized, endpoint };
      } else {
        const text = (await res.text()).trim();
        const normalized = normalizeWorkspacePayload(text);
        if (normalized) return { ...normalized, endpoint };
      }
    } catch {
      // try next candidate
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

export async function GET() {
  const envWorkspace = process.env.WORKSPACE?.trim() || null;
  const envRunspace = process.env.RUNSPACE?.trim() || null;

  const backendWorkspace = await resolveWorkspaceFromBackend();
  const backendPayload: WorkspacePayload | null = backendWorkspace
    ? {
        workspace: backendWorkspace.workspace,
        runspace: backendWorkspace.runspace || path.join(backendWorkspace.workspace, "runs"),
      }
    : null;
  const envPayload: WorkspacePayload | null = envWorkspace
    ? {
        workspace: envWorkspace,
        runspace: envRunspace || path.join(envWorkspace, "runs"),
      }
    : null;

  const warnings: string[] = [];

  const backendReadable = await isReadableDir(backendPayload?.workspace ?? null);
  if (backendPayload && !backendReadable) {
    warnings.push("backend workspace is not readable by frontend process");
  }

  const envReadable = await isReadableDir(envPayload?.workspace ?? null);
  if (envPayload && !envReadable) {
    warnings.push("env workspace is not readable by frontend process");
  }

  const chosen: ChosenWorkspace | null =
    backendPayload && backendReadable
      ? {
          ...backendPayload,
          workspaceSource: `backend:${backendWorkspace?.endpoint ?? "/workspace"}`,
        }
      : envPayload && envReadable
        ? {
            ...envPayload,
            workspaceSource: "env:WORKSPACE",
          }
        : backendPayload
          ? {
              ...backendPayload,
              workspaceSource: `backend:${backendWorkspace?.endpoint ?? "/workspace"}`,
            }
          : envPayload
            ? {
                ...envPayload,
                workspaceSource: "env:WORKSPACE",
              }
            : null;

  const workspace = chosen?.workspace ?? null;
  const runspace = chosen?.runspace ?? null;
  const workspaceSource = chosen?.workspaceSource ?? null;

  if (!workspace) {
    return Response.json(
      {
        ok: false,
        error: "Workspace path unresolved",
        hints: {
          envWorkspace: envWorkspace ?? null,
          envRunspace: envRunspace ?? null,
          backendOrigin: BACKEND_ORIGIN,
          expectedEndpoint: "/workspace",
        },
        warnings,
      },
      { status: 400 }
    );
  }

  const roots = [workspace, runspace].filter((v): v is string => !!v);
  const fileSet = new Set<string>();

  for (const root of roots) {
    const files = await walkJsonFiles(root);
    for (const f of files) fileSet.add(f);
  }

  const files = [...fileSet].slice(0, MAX_FILES);
  const subagents: SubagentCard[] = [];
  const todos: TodoDoc[] = [];

  for (const file of files) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(await readFile(file, "utf-8"));
    } catch {
      continue;
    }

    const values = Array.isArray(parsed) ? parsed : [parsed];
    for (const value of values) {
      const card = maybeSubagentCard(value, file);
      if (card) subagents.push(card);

      const todo = maybeTodoDoc(value, file);
      if (todo) todos.push(todo);
    }
  }

  return Response.json({
    ok: true,
    workspace,
    workspaceSource,
    runspace: runspace ?? null,
    scannedFiles: files.length,
    warnings,
    subagents,
    todos,
  });
}
