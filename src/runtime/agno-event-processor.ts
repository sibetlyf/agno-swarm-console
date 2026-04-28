type RawRecord = Record<string, unknown>;

type ProcessorItem = {
  eventName: string;
  payload: RawRecord;
  createdAt: number;
  runId: string;
  toolCallId: string;
  sequence: number;
  dedupeKey: string;
};

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

const PRECEDENCE: Record<string, number> = {
  RunStarted: 10,
  ModelRequestStarted: 20,
  ReasoningStarted: 25,
  ReasoningStep: 26,
  ReasoningCompleted: 27,
  RunContent: 30,
  RunResponseContent: 31,
  ToolCallStarted: 40,
  ToolCallCompleted: 50,
  ToolCallError: 60,
  ModelRequestCompleted: 70,
  RunContentCompleted: 80,
  RunCompleted: 90,
  RunError: 95,
};

function asRecord(v: unknown): RawRecord {
  return v && typeof v === "object" ? (v as RawRecord) : {};
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function dedupePayloadSignature(payload: RawRecord): string {
  const metadata = asRecord(payload.metadata);
  const rawEvent = asRecord(metadata.raw_event);
  const tool = asRecord(payload.tool);

  const signature = {
    content: payload.content,
    reasoning_content: payload.reasoning_content,
    content_type: payload.content_type,
    type: payload.type,
    message: payload.message,
    metadata_event: metadata.event,
    metadata_content_type: metadata.content_type,
    raw_event_content: rawEvent.content,
    raw_event_reasoning: rawEvent.reasoning_content,
    raw_event_message: rawEvent.message,
    raw_event_event: rawEvent.event,
    raw_event_content_type: rawEvent.content_type,
    tool_call_id: payload.tool_call_id,
    tool_name: tool.tool_name ?? tool.name,
  };

  return stableStringify(signature);
}

export class AgnoEventProcessor {
  private seq = 0;
  private readonly queue: ProcessorItem[] = [];
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];

  constructor(
    private readonly options: {
      maxSeen?: number;
      flushThreshold?: number;
      reorderWindow?: number;
    } = {}
  ) {}

  ingest(eventName: string, payload: RawRecord): Array<{ eventName: string; payload: RawRecord }> {
    const metadata = asRecord(payload.metadata);
    const rawEvent = asRecord(metadata.raw_event);

    const resolvedRunId =
      asString(payload.run_id) || asString(metadata.run_id) || asString(rawEvent.run_id) || "[no-run]";
    const resolvedToolCallId =
      asString(payload.tool_call_id) ||
      asString(asRecord(payload.tool).tool_call_id) ||
      asString(metadata.tool_call_id) ||
      asString(rawEvent.tool_call_id) ||
      "[no-tool]";

    const createdAt =
      asNumber(payload.created_at) || asNumber(rawEvent.created_at) || Date.now();

    const actualEvent = eventName === "CustomEvent" ? asString(metadata.event) || eventName : eventName;
    const payloadSignature = dedupePayloadSignature(payload);
    const dedupeKey = `${resolvedRunId}:${actualEvent}:${resolvedToolCallId}:${createdAt}:${payloadSignature}`;

    if (this.seen.has(dedupeKey)) return [];
    this.remember(dedupeKey);

    this.queue.push({
      eventName,
      payload,
      createdAt,
      runId: resolvedRunId,
      toolCallId: resolvedToolCallId,
      sequence: this.seq++,
      dedupeKey,
    });

    const flushThreshold = this.options.flushThreshold ?? 12;
    const reorderWindow = this.options.reorderWindow ?? 5;
    if (this.queue.length >= flushThreshold || eventName === "RunCompleted" || eventName === "RunError") {
      return this.flush();
    }

    // small reorder window for near-simultaneous events
    if (this.queue.length >= reorderWindow) {
      return this.flush(this.queue.length - reorderWindow + 1);
    }

    return [];
  }

  flush(limit?: number): Array<{ eventName: string; payload: RawRecord }> {
    if (this.queue.length === 0) return [];
    const take = typeof limit === "number" ? Math.max(0, Math.min(limit, this.queue.length)) : this.queue.length;
    if (take === 0) return [];

    const sorted = [...this.queue].sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;

      const aMeta = asRecord(a.payload.metadata);
      const bMeta = asRecord(b.payload.metadata);
      const aEvent = a.eventName === "CustomEvent" ? asString(aMeta.event) || a.eventName : a.eventName;
      const bEvent = b.eventName === "CustomEvent" ? asString(bMeta.event) || b.eventName : b.eventName;
      const ap = PRECEDENCE[aEvent] ?? 999;
      const bp = PRECEDENCE[bEvent] ?? 999;
      if (ap !== bp) return ap - bp;

      if (a.toolCallId !== b.toolCallId) return a.toolCallId.localeCompare(b.toolCallId);
      return a.sequence - b.sequence;
    });

    const picked = sorted.slice(0, take);
    const pickedKeys = new Set(picked.map((i) => i.dedupeKey));
    const remaining = sorted.filter((i) => !pickedKeys.has(i.dedupeKey));
    this.queue.length = 0;
    this.queue.push(...remaining);

    return picked.map((item) => ({ eventName: item.eventName, payload: item.payload }));
  }

  private remember(key: string) {
    this.seen.add(key);
    this.seenOrder.push(key);
    const max = this.options.maxSeen ?? 5000;
    while (this.seenOrder.length > max) {
      const drop = this.seenOrder.shift();
      if (drop) this.seen.delete(drop);
    }
  }
}
