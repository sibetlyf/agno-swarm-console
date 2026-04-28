import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type ReplayEvent = Record<string, unknown>;

async function readTestJson(): Promise<ReplayEvent[]> {
  const candidates = [
    path.join(process.cwd(), "test.json"),
    path.join(process.cwd(), "..", "test.json"),
    path.join(process.cwd(), "..", "..", "test.json"),
  ];

  let lastError: unknown = null;
  for (const filePath of candidates) {
    try {
      const text = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is ReplayEvent => !!item && typeof item === "object");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("test.json not found");
}

export async function GET() {
  try {
    const events = await readTestJson();
    return NextResponse.json({ ok: true, count: events.length, events });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
