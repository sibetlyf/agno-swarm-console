import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type Body = {
  sessionId?: unknown;
  events?: unknown;
};

type PersistedEnvelope = {
  at: number;
  sessionId: string;
  streamAgentId: string | null;
  rawEvent: unknown;
  normalizedEvent: unknown;
};

type PersistedFile = {
  sessionId: string;
  updatedAt: string;
  events: PersistedEnvelope[];
};

function sanitizeSessionId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function toEnvelopeArray(input: unknown, sessionId: string): PersistedEnvelope[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((e) => {
      if (!e || typeof e !== "object") return null;
      const obj = e as Record<string, unknown>;
      return {
        at: typeof obj.at === "number" ? obj.at : Date.now(),
        sessionId,
        streamAgentId: typeof obj.streamAgentId === "string" ? obj.streamAgentId : null,
        rawEvent: obj.rawEvent,
        normalizedEvent: obj.normalizedEvent,
      } as PersistedEnvelope;
    })
    .filter((v): v is PersistedEnvelope => !!v);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const sessionRaw = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!sessionRaw) {
      return NextResponse.json({ ok: false, error: "missing sessionId" }, { status: 400 });
    }
    const sessionId = sanitizeSessionId(sessionRaw);
    const events = toEnvelopeArray(body.events, sessionId);
    if (events.length === 0) {
      return NextResponse.json({ ok: true, written: 0, sessionId });
    }

    const dir = path.join(process.cwd(), ".debug-stream");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${sessionId}.json`);

    let current: PersistedFile = {
      sessionId,
      updatedAt: new Date().toISOString(),
      events: [],
    };

    try {
      const existingText = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(existingText) as PersistedFile;
      if (parsed && parsed.sessionId === sessionId && Array.isArray(parsed.events)) {
        current = parsed;
      }
    } catch {
      // initialize empty
    }

    current.events.push(...events);
    if (current.events.length > 50000) {
      current.events = current.events.slice(current.events.length - 50000);
    }
    current.updatedAt = new Date().toISOString();

    await writeFile(filePath, JSON.stringify(current, null, 2), "utf-8");
    return NextResponse.json({ ok: true, written: events.length, sessionId, filePath: `.debug-stream/${sessionId}.json` });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
