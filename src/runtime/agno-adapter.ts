import { getBridgeBus } from "./bridge-bus";
import { AgnoEventProcessor } from "./agno-event-processor";

type UUID = string;

type AgentLike = { id?: string; name?: string };

function getBaseUrl() {
  return (process.env.AGNO_OS_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
}

function getBridgeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const auth = (process.env.AUTHORIZATION || "").trim();
  if (auth) {
    headers.Authorization = auth.startsWith("Bearer ") ? auth : `Bearer ${auth}`;
  }

  const userId = (process.env.USER_ID || "").trim();
  if (userId) headers["X-User-Id"] = userId;

  const recordId = (process.env.RECORD_ID || "").trim();
  if (recordId) headers["X-Record-Id"] = recordId;

  const workspace = (process.env.WORKSPACE || "").trim();
  if (workspace) headers["X-Workspace"] = workspace;

  const runspace = (process.env.RUNSPACE || "").trim();
  if (runspace) headers["X-Runspace"] = runspace;

  return headers;
}

export function isAgnoBridgeEnabled() {
  const v = (process.env.AGNO_OS_BRIDGE_ENABLED || "true").toLowerCase();
  return v !== "false";
}

async function resolveRemoteAgentId(preferred?: string): Promise<string> {
  const fixed = (process.env.AGNO_AGENT_ID || process.env.AGNO_OS_AGENT_ID || "").trim();
  if (fixed) return fixed;

  const endpoints = ["/agents", "/api/agents"];
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${getBaseUrl()}${endpoint}`, {
        method: "GET",
        headers: { accept: "application/json", ...getBridgeHeaders() },
      });
      if (!res.ok) continue;
      const body = (await res.json().catch(() => null)) as AgentLike[] | { agents?: AgentLike[] } | null;
      const agents = Array.isArray(body) ? body : (body?.agents ?? []);
      if (preferred && !preferred.startsWith("human-") && agents.some((a) => a.id === preferred)) {
        return preferred;
      }
      const first = agents[0]?.id;
      if (first) return first;
    } catch {
      continue;
    }
  }

  if (preferred && !preferred.startsWith("human-")) return preferred;
  return "assistant-remote";
}

function mapKind(input: { eventName: string; contentType?: string; hasReasoning?: boolean; type?: string }) {
  const e = input.eventName;
  const t = input.contentType || "";
  const type = input.type || "";
  if (e === "ExternalAgentRunResponseContentEvent") {
    if (input.hasReasoning) return "reasoning" as const;
    if (t === "document" || type === "document") return "document" as const;
    return "content" as const;
  }
  if (e.endsWith("RunResponseContentEvent")) {
    if (input.hasReasoning) return "reasoning" as const;
    if (t === "document" || type === "document") return "document" as const;
    return "content" as const;
  }
  if (e === "RunStarted" || e === "ModelRequestStarted" || e === "ModelRequestCompleted" || e === "RunContentCompleted") {
    return "agent_status" as const;
  }
  if (e === "ToolCallStarted") return "tool_calls" as const;
  if (e === "ToolCallCompleted") return "tool_result" as const;
  if (e === "ToolCallError") return "tool_result" as const;
  if (input.hasReasoning) return "reasoning" as const;
  if (t === "citation" || type === "citation") return "citation" as const;
  if (t === "document" || type === "document") return "document" as const;
  if (t === "audio_transcript") return "audio_transcript" as const;
  if (t === "agent_status") return "agent_status" as const;
  if (t === "custom_event_metadata") return "custom_event_metadata" as const;
  return "content" as const;
}

function parseSseBlocks(chunk: string): Array<{ event?: string; data?: string }> {
  const blocks = chunk.split(/\n\n+/g).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n");
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5));
    }
    return { event, data: dataLines.join("\n") };
  });
}

/** Extract CustomEvent metadata including raw_event, source, subagent_name, tool_call_id, parent_run_id */
function extractCustomEventMetadata(payload: Record<string, unknown>): {
  source?: string;
  subagent_name?: string;
  agent_id?: string;
  agent_name?: string;
  parent_agent_id?: string;
  run_id?: string;
  parent_run_id?: string;
  tool_call_id?: string;
  tool_call_name?: string;
  raw_event?: Record<string, unknown>;
  event?: string;
  content_type?: string;
} {
  const metadata = (payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}) as Record<string, unknown>;
  const tool = (payload.tool && typeof payload.tool === "object" ? payload.tool : {}) as Record<string, unknown>;
  const rawEvent = (metadata.raw_event && typeof metadata.raw_event === "object" ? metadata.raw_event : {}) as Record<string, unknown>;
  const rawData = (metadata.rawdata && typeof metadata.rawdata === "object" ? metadata.rawdata : {}) as Record<string, unknown>;
  const rawDataEvent =
    (rawData.raw_event && typeof rawData.raw_event === "object" ? rawData.raw_event : rawData) as Record<string, unknown>;

  // Extract tool info from metadata.tool or payload.tool
  const toolCallId =
    (typeof payload.tool_call_id === "string" ? payload.tool_call_id : undefined) ||
    (typeof tool.tool_call_id === "string" ? tool.tool_call_id : undefined) ||
    (typeof metadata.tool_call_id === "string" ? metadata.tool_call_id : undefined) ||
    (typeof rawEvent.tool_call_id === "string" ? rawEvent.tool_call_id : undefined) ||
    (typeof rawDataEvent.tool_call_id === "string" ? rawDataEvent.tool_call_id : undefined);
  const toolCallName =
    (typeof tool.tool_name === "string" ? tool.tool_name : undefined) ||
    (typeof tool.name === "string" ? tool.name : undefined) ||
    (typeof metadata.tool_name === "string" ? metadata.tool_name : undefined) ||
    (typeof rawEvent.tool_name === "string" ? rawEvent.tool_name : undefined) ||
    (typeof rawDataEvent.tool_name === "string" ? rawDataEvent.tool_name : undefined);

  // Extract parent_run_id from metadata or raw_event
  let parentRunId =
    (typeof metadata.parent_run_id === "string" ? metadata.parent_run_id : undefined) ||
    (typeof rawEvent.parent_run_id === "string" ? rawEvent.parent_run_id : undefined) ||
    (typeof rawDataEvent.parent_run_id === "string" ? rawDataEvent.parent_run_id : undefined);

  // If parent_run_id exists but no parent_agent_id, infer from parent_run_id format (parent_agent_id:groupId)
  let parentAgentId: string | undefined;
  if (parentRunId && !metadata.parent_agent_id) {
    const colonIdx = parentRunId.indexOf(":");
    if (colonIdx > 0) {
      parentAgentId = parentRunId.slice(0, colonIdx);
    }
  } else if (typeof metadata.parent_agent_id === "string") {
    parentAgentId = metadata.parent_agent_id;
  }

  return {
    source:
      (typeof metadata.source === "string" ? metadata.source : undefined) ||
      (typeof rawEvent.source === "string" ? rawEvent.source : undefined) ||
      (typeof rawDataEvent.source === "string" ? rawDataEvent.source : undefined),
    subagent_name:
      (typeof metadata.subagent_name === "string" ? metadata.subagent_name : undefined) ||
      (typeof rawEvent.subagent_name === "string" ? rawEvent.subagent_name : undefined) ||
      (typeof rawDataEvent.subagent_name === "string" ? rawDataEvent.subagent_name : undefined),
    agent_id:
      (typeof metadata.agent_id === "string" ? metadata.agent_id : undefined) ||
      (typeof rawEvent.agent_id === "string" ? rawEvent.agent_id : undefined) ||
      (typeof rawDataEvent.agent_id === "string" ? rawDataEvent.agent_id : undefined) ||
      (typeof payload.agent_id === "string" ? payload.agent_id : undefined),
    agent_name:
      (typeof metadata.agent_name === "string" ? metadata.agent_name : undefined) ||
      (typeof rawEvent.agent_name === "string" ? rawEvent.agent_name : undefined) ||
      (typeof rawDataEvent.agent_name === "string" ? rawDataEvent.agent_name : undefined) ||
      (typeof payload.agent_name === "string" ? payload.agent_name : undefined),
    parent_agent_id: parentAgentId,
    run_id:
      (typeof metadata.run_id === "string" ? metadata.run_id : undefined) ||
      (typeof rawEvent.run_id === "string" ? rawEvent.run_id : undefined) ||
      (typeof rawDataEvent.run_id === "string" ? rawDataEvent.run_id : undefined) ||
      (typeof payload.run_id === "string" ? payload.run_id : undefined),
    parent_run_id: parentRunId,
    tool_call_id: toolCallId,
    tool_call_name: toolCallName,
    raw_event: Object.keys(rawEvent).length > 0 ? rawEvent : rawDataEvent,
    event:
      (typeof metadata.event === "string" ? metadata.event : undefined) ||
      (typeof rawEvent.event === "string" ? rawEvent.event : undefined) ||
      (typeof rawDataEvent.event === "string" ? rawDataEvent.event : undefined),
    content_type:
      (typeof metadata.content_type === "string" ? metadata.content_type : undefined) ||
      (typeof payload.content_type === "string" ? payload.content_type : undefined) ||
      (typeof rawEvent.content_type === "string" ? rawEvent.content_type : undefined) ||
      (typeof rawDataEvent.content_type === "string" ? rawDataEvent.content_type : undefined),
  };
}

export async function runAgentOsStream(input: {
  localAgentId: UUID;
  message: string;
  senderId: UUID;
  groupId: UUID;
}) {
  if (!isAgnoBridgeEnabled()) return;

  const bus = getBridgeBus();
  const localAgentId = input.localAgentId;

  bus.emit(localAgentId, { event: "agent.wakeup", data: { agentId: localAgentId, reason: "group_message" } });

  const baseUrl = getBaseUrl();
  const sharedHeaders = getBridgeHeaders();
  const orchestratorResponse = await fetch(`${baseUrl}/api/orchestrator/run`, {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "Content-Type": "application/json",
      ...sharedHeaders,
    },
    body: JSON.stringify({
      message: input.message,
      stream: true,
      session_id: `swarm-${input.groupId}`,
      user_id: input.senderId,
    }),
  }).catch(() => null);

  let res = orchestratorResponse;
  if (!res || !res.ok) {
    const remoteAgentId = await resolveRemoteAgentId(localAgentId);
    const form = new FormData();
    form.set("message", input.message);
    form.set("stream", "true");
    form.set("session_id", `swarm-${input.groupId}`);
    form.set("user_id", input.senderId);
    res = await fetch(`${baseUrl}/agents/${encodeURIComponent(remoteAgentId)}/runs`, {
      method: "POST",
      headers: { accept: "text/event-stream", ...sharedHeaders },
      body: form,
    }).catch(() => null);
  }

  if (!res || !res.ok || !res.body) {
    const msg = res ? await res.text().catch(() => `AgentOS stream failed: ${res.status}`) : "AgentOS stream request failed";
    bus.emit(localAgentId, { event: "agent.error", data: { message: msg } });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  // Tool lifecycle tracking by tool_call_id for deterministic ordering
  const toolCallStates = new Map<string, { started: boolean; completed: boolean; error?: string }>();
  const processor = new AgnoEventProcessor();

  const handleEvent = (eventName: string, payload: Record<string, unknown>) => {
    // Handle terminal events
    if (eventName === "RunCompleted") {
      bus.emit(localAgentId, {
        event: "agent.done",
        data: { finishReason: typeof payload?.content_type === "string" ? payload.content_type : undefined },
      });
      return;
    }

    if (eventName === "RunError" || eventName === "Error") {
      bus.emit(localAgentId, {
        event: "agent.error",
        data: { message: typeof payload?.message === "string" ? payload.message : JSON.stringify(payload) },
      });
      return;
    }

    // Extract CustomEvent metadata for subagent routing and tool correlation
    const meta = extractCustomEventMetadata(payload);
    const isCustomEvent = eventName === "CustomEvent";
    const isExternalEnvelope = eventName.endsWith("RunResponseContentEvent") || eventName === "ExternalAgentRunResponseContentEvent";
    const actualEvent = (isCustomEvent || isExternalEnvelope) && meta.event ? meta.event : eventName;

    // Determine source: subagent if metadata.source=subagent or parent_run_id exists
    const source = meta.source || (meta.parent_run_id || meta.tool_call_id ? "subagent" : "agent");

    // Extract content and reasoning
    const reasoning =
      (typeof payload.reasoning_content === "string" ? payload.reasoning_content : "") ||
      (typeof meta.raw_event?.reasoning_content === "string" ? (meta.raw_event.reasoning_content as string) : "");
    let content = typeof payload.content === "string" ? payload.content : "";

    // For CustomEvent with raw_event, also check raw_event.content
    if (!content && isCustomEvent && meta.raw_event && typeof (meta.raw_event as Record<string, unknown>).content === "string") {
      content = (meta.raw_event as Record<string, unknown>).content as string;
    }

    if (!content && meta.raw_event) {
      const rawRecord = meta.raw_event as Record<string, unknown>;
      content =
        (typeof rawRecord.content === "string" ? rawRecord.content : "") ||
        (typeof rawRecord.delta === "string" ? rawRecord.delta : "") ||
        (typeof rawRecord.text === "string" ? rawRecord.text : "") ||
        (typeof rawRecord.message === "string" ? rawRecord.message : "");
    }

    const kind = mapKind({
      eventName: actualEvent,
      contentType: meta.content_type,
      hasReasoning: !!reasoning,
      type: isCustomEvent ? (payload.type as string) : undefined,
    });

    // Tool lifecycle correlation by tool_call_id
    let delta = "";
    if (kind === "tool_calls" || kind === "tool_result") {
      const toolId = meta.tool_call_id;
      if (toolId) {
        if (actualEvent === "ToolCallStarted" || (isCustomEvent && meta.event === "ToolCallStarted")) {
          toolCallStates.set(toolId, { started: true, completed: false });
          delta = JSON.stringify({ state: "started", tool_call_id: toolId, tool_name: meta.tool_call_name });
        } else if (actualEvent === "ToolCallCompleted" || (isCustomEvent && meta.event === "ToolCallCompleted")) {
          toolCallStates.set(toolId, { started: true, completed: true });
          delta = JSON.stringify({ state: "completed", tool_call_id: toolId, tool_name: meta.tool_call_name, content, raw_event: meta.raw_event });
        } else if (actualEvent === "ToolCallError" || (isCustomEvent && meta.event === "ToolCallError")) {
          const message = typeof payload.message === "string" ? payload.message : "tool call error";
          toolCallStates.set(toolId, { started: true, completed: true, error: message });
          delta = JSON.stringify({ state: "error", tool_call_id: toolId, tool_name: meta.tool_call_name, error: message, raw_event: meta.raw_event });
        }
      } else {
        delta = content ? JSON.stringify({ content, raw_event: meta.raw_event }) : "";
      }
    } else {
      delta = reasoning || content || (eventName === "ToolCallCompleted" ? JSON.stringify({ raw_event: meta.raw_event }) : "");
    }

    if (!delta && kind === "agent_status") {
      delta = actualEvent;
    }

    if (!delta && eventName !== "ToolCallStarted" && actualEvent !== "ToolCallStarted") return;

    // Emit unified stream event with full CustomEvent metadata
    bus.emit(localAgentId, {
      event: "agent.stream",
      data: {
        kind,
        delta,
        metadata: payload,
        event: actualEvent,
        content,
        reasoning_content: reasoning,
        content_type: meta.content_type,
        type: isCustomEvent ? (payload.type as string) : undefined,
        run_id: meta.run_id,
        source: source as "agent" | "subagent",
        subagent_name: meta.subagent_name,
        agent_id: meta.agent_id,
        agent_name: meta.agent_name,
        parent_agent_id: meta.parent_agent_id,
        parent_run_id: meta.parent_run_id,
        tool_call_id: meta.tool_call_id,
        tool_call_name: meta.tool_call_name,
        raw_event: meta.raw_event,
      },
    });
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });

    const parts = pending.split(/\n\n/g);
    pending = parts.pop() ?? "";

    for (const part of parts) {
      const blocks = parseSseBlocks(part + "\n\n");
      for (const b of blocks) {
        const payload = (() => {
          try {
            return b.data ? JSON.parse(b.data) : {};
          } catch {
            return { raw: b.data };
          }
        })() as Record<string, unknown>;
        const eventName = b.event || (typeof payload.event === "string" ? payload.event : "");

        const processed = processor.ingest(eventName, payload);
        for (const item of processed) {
          handleEvent(item.eventName, item.payload);
        }
      }
    }
  }

  for (const item of processor.flush()) {
    handleEvent(item.eventName, item.payload);
  }
}
