"use client";

import { useSearchParams } from "next/navigation";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from "react";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, ChevronDown, ChevronLeft, ChevronRight, Code2, Network, User } from "lucide-react";
import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { IMShell } from "./IMShell";
import { CapabilityRail, CapabilitySection } from "./components/CapabilityRail";
import { ToolUsingCard, ToolResultCard, ToolErrorCard } from "./components/ToolCards";
import { ComposerContextBar } from "./components/ComposerContextBar";

// Create code plugin with dark theme
const code = createCodePlugin({
  themes: ["github-dark", "github-dark"], // Use dark theme for both light/dark modes
});

const TIMELINE_DB_NAME = "agno-swarm-console-db";
const TIMELINE_STORE_NAME = "timeline-snapshots";
const TIMELINE_DB_VERSION = 1;
const LEFT_PANEL_MIN_WIDTH = 260;
const LEFT_PANEL_MAX_WIDTH = 520;
const RIGHT_PANEL_MIN_WIDTH = 460;
const RIGHT_PANEL_MAX_WIDTH = 980;
const CENTER_PANEL_MIN_WIDTH = 520;
const TASK_FLOW_TOP_MIN_HEIGHT = 120;
const TASK_FLOW_MIDDLE_MIN_HEIGHT = 220;
const TASK_FLOW_PREVIEW_MIN_HEIGHT = 180;

type UUID = string;

type WorkspaceDefaults = {
  workspaceId: UUID;
  humanAgentId: UUID;
  assistantAgentId: UUID;
  defaultGroupId: UUID;
};

type AgentMeta = {
  id: UUID;
  role: string;
  parentId: UUID | null;
  createdAt: string;
};

type AgentStatus = "IDLE" | "BUSY" | "WAKING";

type Group = {
  id: UUID;
  name: string | null;
  memberIds: UUID[];
  unreadCount: number;
  contextTokens: number;
  lastMessage?: {
    content: string;
    contentType: string;
    sendTime: string;
    senderId: UUID;
  };
  updatedAt: string;
  createdAt: string;
};

type Message = {
  id: UUID;
  senderId: UUID;
  content: string;
  contentType: string;
  sendTime: string;
};

type UiStreamEvent = {
  id?: number;
  at?: number;
  event: string;
  data: Record<string, any>;
};

type VizEvent = {
  id: string;
  kind: "agent" | "message" | "llm" | "tool" | "db";
  label: string;
  at: number;
};

type VizBeam = {
  id: string;
  fromId: UUID;
  toId: UUID;
  kind: "create" | "message";
  label?: string;
  createdAt: number;
};

type VizDebugEntry = {
  id: string;
  at: number;
  type: "message_event" | "beam_created" | "beam_skipped";
  data: Record<string, unknown>;
};

type RightPanelId = "history" | "content" | "reasoning" | "tools";
type RightPanelState = {
  id: RightPanelId;
  title: string;
  size: number;
  collapsed: boolean;
};

type ArtifactKind = "url" | "file" | "html" | "text";

type ArtifactReference = {
  id: string;
  kind: ArtifactKind;
  label: string;
  value: string;
  href: string;
};

type ArtifactPreviewState = {
  artifact: ArtifactReference | null;
  loading: boolean;
  error: string | null;
  content: string;
  contentType: string;
};

// Streamdown plugins for markdown rendering
const streamdownPlugins = { code, mermaid };

const WINDOWS_FILE_RE = /(?:^|[\s(])([A-Za-z]:\\[^\s<>"']+?\.(?:html?|md|markdown|txt|json|csv|ts|tsx|js|jsx|py|java|go|rs|css|scss))(?:$|[\s),.!?])/g;
const UNIX_FILE_RE = /(?:^|[\s(])((?:\.{1,2}\/|\/)[^\s<>"']+?\.(?:html?|md|markdown|txt|json|csv|ts|tsx|js|jsx|py|java|go|rs|css|scss))(?:$|[\s),.!?])/g;
const BARE_FILE_RE = /(?:^|[\s(])([\w.-]+\.(?:html?|md|markdown|txt|json|csv|ts|tsx|js|jsx|py|java|go|rs|css|scss))(?:$|[\s),.!?])/g;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

function artifactKindFromValue(value: string): ArtifactKind {
  if (/^https?:\/\//i.test(value)) return "url";
  if (/\.html?$/i.test(value)) return "html";
  if (/\.(md|markdown|txt|json|csv)$/i.test(value)) return "text";
  return "file";
}

function buildArtifactHref(kind: ArtifactKind, value: string): string {
  return `artifact://open?kind=${encodeURIComponent(kind)}&value=${encodeURIComponent(value)}`;
}

function makeArtifactReference(value: string): ArtifactReference {
  const trimmed = value.trim();
  const kind = artifactKindFromValue(trimmed);
  return {
    id: `${kind}:${trimmed}`,
    kind,
    label: trimmed,
    value: trimmed,
    href: buildArtifactHref(kind, trimmed),
  };
}

function detectArtifactReferences(content: string): ArtifactReference[] {
  if (!content) return [];
  const values = new Set<string>();
  for (const match of content.matchAll(URL_RE)) {
    if (match[0]) values.add(match[0]);
  }
  for (const match of content.matchAll(WINDOWS_FILE_RE)) {
    if (match[1]) values.add(match[1]);
  }
  for (const match of content.matchAll(UNIX_FILE_RE)) {
    if (match[1]) values.add(match[1]);
  }
  for (const match of content.matchAll(BARE_FILE_RE)) {
    if (match[1]) values.add(match[1]);
  }
  return [...values].map(makeArtifactReference);
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[\\\[\]()]/g, "\\$&");
}

function enrichMarkdownArtifacts(content: string): string {
  if (!content) return content;
  const replaceUrl = (urlValue: string) => `[${escapeMarkdownLabel(urlValue)}](${buildArtifactHref("url", urlValue)})`;
  const replaceFilePath = (raw: string, pathValue: string) => raw.replace(pathValue, `[${escapeMarkdownLabel(pathValue)}](${buildArtifactHref(artifactKindFromValue(pathValue), pathValue)})`);
  let next = content.replace(URL_RE, (urlValue: string) => replaceUrl(urlValue));
  next = next.replace(WINDOWS_FILE_RE, (full, pathValue: string) => replaceFilePath(full, pathValue));
  next = next.replace(UNIX_FILE_RE, (full, pathValue: string) => replaceFilePath(full, pathValue));
  next = next.replace(BARE_FILE_RE, (full, pathValue: string) => replaceFilePath(full, pathValue));
  return next;
}

function parseArtifactHref(href: string): ArtifactReference | null {
  if (!href) return null;
  if (href.startsWith("artifact://open?")) {
    const params = new URLSearchParams(href.slice("artifact://open?".length));
    const kind = params.get("kind");
    const value = params.get("value");
    if (!value) return null;
    return makeArtifactReference(value);
  }
  if (/^https?:\/\//i.test(href)) return makeArtifactReference(href);
  return null;
}

// Helper component for rendering markdown content
function MarkdownContent({ content, className = "", onArtifactClick }: { content: string; className?: string; onArtifactClick?: (artifact: ArtifactReference) => void }) {
  if (!content) return <span className="muted">—</span>;
  return (
    <div
      className={className}
      onClick={(event) => {
        const anchor = (event.target as HTMLElement | null)?.closest("a") as HTMLAnchorElement | null;
        if (!anchor) return;
        const artifact = parseArtifactHref(anchor.getAttribute("href") || anchor.href || "");
        if (!artifact) return;
        event.preventDefault();
        onArtifactClick?.(artifact);
      }}
    >
      <Streamdown plugins={streamdownPlugins}>{enrichMarkdownArtifacts(content)}</Streamdown>
    </div>
  );
}

function looksLikeHtml(content: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(content);
}

function sanitizeHtml(content: string): string {
  if (typeof window === "undefined") return content;
  const template = window.document.createElement("template");
  template.innerHTML = content;

  template.content.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach((node) => node.remove());

  template.content.querySelectorAll("*").forEach((element) => {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(attr.name);
        continue;
      }
      if ((name === "href" || name === "src") && value.startsWith("javascript:")) {
        element.removeAttribute(attr.name);
      }
    }
  });

  return template.innerHTML;
}

function RichContent({ content, className = "", onArtifactClick }: { content: string; className?: string; onArtifactClick?: (artifact: ArtifactReference) => void }) {
  if (!content) return <span className="muted">—</span>;
  const artifacts = detectArtifactReferences(content);
  if (looksLikeHtml(content)) {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <div
          className={className}
          onClick={(event) => {
            const anchor = (event.target as HTMLElement | null)?.closest("a") as HTMLAnchorElement | null;
            if (!anchor) return;
            const artifact = parseArtifactHref(anchor.getAttribute("href") || anchor.href || "");
            if (!artifact) return;
            event.preventDefault();
            onArtifactClick?.(artifact);
          }}
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
        />
        {artifacts.length > 0 ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {artifacts.map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                className="btn"
                style={{ padding: "3px 8px", fontSize: 12, textDecoration: "underline", textUnderlineOffset: 3 }}
                onClick={() => onArtifactClick?.(artifact)}
              >
                {artifact.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <MarkdownContent content={content} className={className} onArtifactClick={onArtifactClick} />
      {artifacts.length > 0 ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              className="btn"
              style={{ padding: "3px 8px", fontSize: 12, textDecoration: "underline", textUnderlineOffset: 3, color: "#1d4ed8" }}
              onClick={() => onArtifactClick?.(artifact)}
            >
              {artifact.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatDebugValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizePreview(content: string, max = 120): string {
  return content.replace(/\s+/g, " ").trim().slice(0, max);
}

function getTaskFlowStatus(state: SourceRenderState): "pending" | "running" | "completed" | "error" {
  const latest = state.timelineItems[state.timelineItems.length - 1];
  if (latest?.status === "error") return "error";
  if (state.content.trim()) return "completed";
  if (state.reasoning.trim() || state.toolItems.length > 0) return "running";
  return "pending";
}

function getTaskFlowStatusStyles(status: "pending" | "running" | "completed" | "error") {
  switch (status) {
    case "completed":
      return { label: "完成", color: "#166534", bg: "#dcfce7", border: "#86efac" };
    case "error":
      return { label: "失败", color: "#991b1b", bg: "#fee2e2", border: "#fca5a5" };
    case "running":
      return { label: "进行中", color: "#1d4ed8", bg: "#dbeafe", border: "#93c5fd" };
    default:
      return { label: "待开始", color: "#475569", bg: "#e2e8f0", border: "#cbd5e1" };
  }
}

function parseSubagentLabel(sourceTag: string): string | null {
  const match = sourceTag.match(/^\[subagent:(.+)\]$/);
  return match?.[1] ?? null;
}

function makeSourceBufferKey(sourceTag: string | undefined, outerToolCallId?: string): string {
  const base = sourceTag || "[agent]";
  return outerToolCallId ? `${base}::${outerToolCallId}` : base;
}

function makeBlockScopedBufferKey(
  sourceTag: string | undefined,
  outerToolCallId: string | undefined,
  kind: "content" | "reasoning",
  blockIndex: number
): string {
  return `${makeSourceBufferKey(sourceTag, outerToolCallId)}@@${kind}:${blockIndex}`;
}

function parseBlockScopedBufferKey(bufferKey: string): { sourceKey: string; kind?: "content" | "reasoning"; blockIndex?: number } {
  const [sourceKey, suffix] = bufferKey.split("@@");
  if (!suffix) return { sourceKey };
  const match = suffix.match(/^(content|reasoning):(\d+)$/);
  if (!match) return { sourceKey };
  return {
    sourceKey,
    kind: match[1] as "content" | "reasoning",
    blockIndex: Number(match[2]),
  };
}

function collectBlockScopedBuffer(map: Map<string, string>, sourceKey: string, kind: "content" | "reasoning"): string {
  const chunks = [...map.entries()]
    .map(([key, text]) => ({ parsed: parseBlockScopedBufferKey(key), text }))
    .filter(({ parsed, text }) => parsed.sourceKey === sourceKey && parsed.kind === kind && text.trim().length > 0)
    .sort((a, b) => (a.parsed.blockIndex ?? 0) - (b.parsed.blockIndex ?? 0))
    .map(({ text }) => text);
  return chunks.join("\n\n");
}

function parseSourceBufferKey(bufferKey: string): { sourceTag: string; outerToolCallId?: string } {
  const marker = "::";
  const index = bufferKey.indexOf(marker);
  if (index === -1) return { sourceTag: bufferKey };
  return {
    sourceTag: bufferKey.slice(0, index),
    outerToolCallId: bufferKey.slice(index + marker.length),
  };
}

function parseAgentDisplayLabel(sourceTag: string, fallback = "Assistant"): string {
  if (sourceTag === "[agent]" || !sourceTag) return fallback;
  const match = sourceTag.match(/^\[[^:]+:(.+)\]$/);
  return match?.[1] ?? fallback;
}

function isTaskScopedSourceTag(sourceTag: string): boolean {
  return /^\[task:[^\]]+\]$/.test(sourceTag);
}

function taskIdFromSourceTag(sourceTag: string): string | null {
  const match = sourceTag.match(/^\[task:([^\]]+)\]$/);
  return match?.[1] ?? null;
}

function extractAssignedSubagentName(args: unknown, rawEvent?: Record<string, unknown>): string | null {
  const argRecord = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : null;
  const rawRecord = rawEvent && typeof rawEvent === "object" ? rawEvent : null;
  
  const rawSubagent = rawRecord?.subagent_name;
  if (typeof rawSubagent === "string" && rawSubagent.trim()) return rawSubagent.trim();
  
  const argSubagent = argRecord?.subagent_name;
  if (typeof argSubagent === "string" && argSubagent.trim()) return argSubagent.trim();
  
  return null;
}

function extractSubagentNameFromEventData(
  data: Record<string, unknown>,
  metadata?: Record<string, unknown>,
  rawEvent?: Record<string, unknown>
): string | null {
  const fromData = typeof data.subagent_name === "string" ? data.subagent_name as string : null;
  if (fromData?.trim()) return fromData.trim();
  
  const fromMeta = metadata && typeof metadata.subagent_name === "string" ? metadata.subagent_name as string : null;
  if (fromMeta?.trim()) return fromMeta.trim();
  
  const fromRawEvent = rawEvent && typeof rawEvent.subagent_name === "string" ? rawEvent.subagent_name as string : null;
  if (fromRawEvent?.trim()) return fromRawEvent.trim();
  
  return null;
}

function TimelineItemView({
  item,
  collapseReasoning,
}: {
  item: StreamTimelineItem;
  collapseReasoning: boolean;
}) {
  if (item.lane === "tool_call") {
    return (
      <ToolUsingCard
        toolName={item.toolName || "tool"}
        summary={item.text}
        args={item.args as Record<string, unknown> | string}
      />
    );
  }

  if (item.lane === "tool_result") {
    if (item.status === "error") {
      return (
        <ToolErrorCard
          toolName={item.toolName || "tool"}
          summary={item.text}
          args={item.args as Record<string, unknown> | string}
          error={item.result as string | Record<string, unknown> | Error || item.text || "Unknown error"}
        />
      );
    }
    return (
      <ToolResultCard
        toolName={item.toolName || "tool"}
        summary={item.text}
        args={item.args as Record<string, unknown> | string}
        result={item.result as Record<string, unknown> | string}
      />
    );
  }

  const tone =
    item.lane === "message"
      ? { border: "#cbd5e1", bg: "#ffffff", fg: "#0f172a" }
      : item.lane === "reasoning"
        ? { border: "#a78bfa", bg: "rgba(124,58,237,0.08)", fg: "#5b21b6" }
        : item.lane === "metadata"
          ? { border: "#94a3b8", bg: "rgba(148,163,184,0.12)", fg: "#334155" }
          : { border: "#cbd5e1", bg: "#f8fafc", fg: "#334155" };

  const laneLabel: Record<StreamTimelineLane, string> = {
    message: "Message",
    content: "Content",
    reasoning: "Reasoning",
    tool_call: "Tool Call",
    tool_result: "Tool Result",
    status: "Status",
    metadata: "Metadata",
  };

  return (
    <article
      style={{
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        borderRadius: 12,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: 12, color: tone.fg, fontWeight: 700 }}>{laneLabel[item.lane]}</span>
          <span className="mono" style={{ fontSize: 12, color: "#64748b" }}>{item.sourceTag || "[agent]"}</span>
          {item.toolName ? <span style={{ fontSize: 13, color: "#1e293b" }}>{item.toolName}</span> : null}
        </div>
        <span className="mono" style={{ fontSize: 12, color: "#64748b" }}>{new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
      </div>

      {item.text ? (
        item.lane === "reasoning" ? (
          <details open={!collapseReasoning}>
            <summary style={{ cursor: "pointer", color: tone.fg }}>Reasoning details</summary>
            <RichContent content={item.text} className="timeline-rich timeline-reasoning" />
          </details>
        ) : (
          <RichContent content={item.text} className="timeline-rich" />
        )
      ) : null}

      {(item.args !== undefined || item.result !== undefined || item.rawEvent || item.metrics) ? (
        <details>
          <summary style={{ cursor: "pointer", color: tone.fg }}>查看详情</summary>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {item.args !== undefined ? (
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Args</div>
                <pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{formatDebugValue(item.args)}</pre>
              </div>
            ) : null}
            {item.result !== undefined ? (
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Result</div>
                <pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{formatDebugValue(item.result)}</pre>
              </div>
            ) : null}
            {item.metrics ? (
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Metrics</div>
                <pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{formatDebugValue(item.metrics)}</pre>
              </div>
            ) : null}
            {item.rawEvent ? (
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Raw Event</div>
                <pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{formatDebugValue(item.rawEvent)}</pre>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}

type AgentStreamEvent =
  | {
    id: number;
    at: number;
    event: "agent.stream";
    data: {
      kind:
      | "reasoning"
      | "thinking"
      | "content"
      | "citation"
      | "document"
      | "tool_calls"
      | "tool_result"
      | "agent_status"
      | "audio_transcript"
      | "custom_event_metadata";
      delta: string;
      tool_call_id?: string;
      tool_call_name?: string;
      metadata?: Record<string, unknown>;
      content?: unknown;
      reasoning_content?: string;
      content_type?: string;
      type?: string;
      event?: string;
      response_audio?: { transcript?: string };
      source?: "agent" | "subagent";
      subagent_name?: string;
      agent_id?: string;
      agent_name?: string;
      parent_agent_id?: string;
      run_id?: string;
      parent_run_id?: string;
    };
  }
  | {
    id: number;
    at: number;
    event: "agent.wakeup";
    data: { agentId: string; reason?: string | null };
  }
  | {
    id: number;
    at: number;
    event: "agent.unread";
    data: { agentId: string; batches: Array<{ groupId: string; messageIds: string[] }> };
  }
  | { id: number; at: number; event: "agent.done"; data: { finishReason?: string | null } }
  | { id: number; at: number; event: "agent.error"; data: { message: string } };

type RawAgnoEvent = {
  id?: number;
  at?: number;
  event?: string;
  content_type?: string;
  content?: unknown;
  reasoning_content?: string;
  response_audio?: { transcript?: string };
  type?: string;
  tool_call_id?: string;
  tool_call_name?: string;
  tool?: unknown;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

type WorkflowNodeType = "run" | "agent" | "tool";
type WorkflowNodeStatus = "running" | "completed" | "error" | "idle";

type TurnWorkflowNode = {
  id: string;
  type: WorkflowNodeType;
  label: string;
  status: WorkflowNodeStatus;
  runId: string;
  source?: "agent" | "subagent";
  agentId?: string;
  toolCallId?: string;
  toolName?: string;
  detail?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  rawPayload?: Record<string, unknown>;
};

type TurnWorkflowEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: "spawn" | "invoke";
};

type TurnWorkflowSnapshot = {
  runId: string | null;
  nodes: TurnWorkflowNode[];
  edges: TurnWorkflowEdge[];
  events: number;
};

type CanonicalWorkflowEvent = {
  eventName: string;
  runId?: string;
  parentRunId?: string;
  source?: "agent" | "subagent";
  agentId?: string;
  agentName?: string;
  subagentName?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  toolError?: string;
  content?: string;
  reasoning?: string;
  rawPayload?: Record<string, unknown>;
};

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function pickString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function pickText(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return value ? "true" : "false";
  }
  return undefined;
}

function summarizeUnknown(value: unknown, max = 120): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value.slice(0, max);
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

function pickSource(value: unknown): "agent" | "subagent" | undefined {
  return value === "agent" || value === "subagent" ? value : undefined;
}

function canonicalizeWorkflowEvent(input: {
  payloadData: Extract<AgentStreamEvent, { event: "agent.stream" }>['data'];
  rawPayload: RawAgnoEvent | AgentStreamEvent;
}): CanonicalWorkflowEvent {
  const data = input.payloadData as Record<string, unknown>;
  const metadata = asObject(data.metadata) ?? {};
  const rawFromMetadata = asObject(metadata.raw_event);
  const rawDataFromMetadata = asObject(metadata.rawdata);
  const rawFromPayload = asObject((input.rawPayload as Record<string, unknown>).raw_event);
  const rawDataFromPayload = asObject((input.rawPayload as Record<string, unknown>).rawdata);

  const rawDataEnvelope = rawDataFromMetadata ?? rawDataFromPayload;
  const rawDataNestedEvent =
    asObject(rawDataEnvelope?.raw_event) ??
    asObject(rawDataEnvelope?.data) ??
    rawDataEnvelope;

  // raw_event has highest priority, then rawdata fallback.
  const rawEvent = rawFromMetadata ?? rawFromPayload ?? rawDataNestedEvent ?? {};
  const rawTool = asObject(rawEvent.tool) ?? asObject(rawDataEnvelope?.tool);
  const metaTool = asObject(metadata.tool);
  const explicitSubagent = metadata.source === "subagent";

  const eventName = pickString(data.event, metadata.event, rawEvent.event, (input.rawPayload as Record<string, unknown>).event) ?? "CustomEvent";
  const source = explicitSubagent ? "subagent" : pickSource(data.source) ?? pickSource(metadata.source) ?? pickSource(rawEvent.source);
  const runId = pickString(data.run_id, metadata.run_id, rawEvent.run_id, (input.rawPayload as Record<string, unknown>).run_id);
  const parentRunId = pickString(data.parent_run_id, metadata.parent_run_id, rawEvent.parent_run_id);
  const agentId = pickString(data.agent_id, metadata.agent_id, rawEvent.agent_id, (input.rawPayload as Record<string, unknown>).agent_id);
  const agentName = pickString(data.agent_name, metadata.agent_name, rawEvent.agent_name, (input.rawPayload as Record<string, unknown>).agent_name);
  const subagentName = pickString(data.subagent_name, metadata.subagent_name, rawEvent.subagent_name);

  const toolCallId = pickString(
    data.tool_call_id,
    metadata.tool_call_id,
    rawEvent.tool_call_id,
    rawTool?.tool_call_id,
    metaTool?.tool_call_id
  );
  const toolName = pickString(
    data.tool_call_name,
    metadata.tool_name,
    rawEvent.tool_name,
    rawTool?.tool_name,
    metaTool?.tool_name,
    rawTool?.name,
    metaTool?.name
  );
  const content = explicitSubagent
    ? pickText(rawEvent.content, rawDataEnvelope?.content, data.content, data.delta)
    : pickText(data.content, data.delta, rawEvent.content, rawDataEnvelope?.content);
  const reasoning = explicitSubagent
    ? pickText(rawEvent.reasoning_content, rawDataEnvelope?.reasoning_content, data.reasoning_content)
    : pickText(data.reasoning_content, rawEvent.reasoning_content, rawDataEnvelope?.reasoning_content);
  const toolError = pickText(
    rawTool?.error,
    rawTool?.tool_call_error,
    rawEvent.error,
    rawDataEnvelope?.error,
    metadata.error,
    data.error,
    data.message
  );
  const toolArgs = rawTool?.tool_args ?? metaTool?.tool_args ?? rawEvent.tool_args ?? metadata.tool_args;
  const toolResult = rawTool?.result ?? metaTool?.result ?? rawEvent.result ?? metadata.result;

  return {
    eventName,
    runId,
    parentRunId,
    source,
    agentId,
    agentName,
    subagentName,
    toolCallId,
    toolName,
    toolArgs,
    toolResult,
    toolError,
    content,
    reasoning,
    rawPayload: Object.keys(rawEvent).length > 0 ? rawEvent : (asObject(input.rawPayload) ?? asObject(data)),
  };
}

type GraphNode = { id: UUID; role: string; parentId: UUID | null };
type GraphEdge = { from: UUID; to: UUID; count: number; lastSendTime: string };

type NormalizedAgentStreamChunk = {
  kind:
  | "reasoning"
  | "thinking"
  | "content"
  | "citation"
  | "document"
  | "tool_calls"
  | "tool_result"
  | "agent_status"
  | "audio_transcript"
  | "custom_event_metadata";
  chunk: string;
  key?: string;
  sourceTag?: string;
};

type CustomEventPayload = {
  eventName: string;
  content: string;
  reasoning: string;
  toolCallId?: string;
  toolName?: string;
  toolState?: "started" | "completed" | "error";
  toolError?: string;
  args?: unknown;
  result?: unknown;
  rawEvent?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
};

type ToolCardStatus = "started" | "completed" | "error";

type ToolCard = {
  key: string;
  sourceTag: string;
  toolName: string;
  status: ToolCardStatus;
  detail: string;
  updatedAt: number;
  toolCallId?: string;
  args?: unknown;
  result?: unknown;
  rawEvent?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  eventName?: string;
};

type StreamTimelineLane = "message" | "content" | "reasoning" | "tool_call" | "tool_result" | "status" | "metadata";

type StreamTimelineItem = {
  id: string;
  seq: number;
  mergeKey: string;
  at: number;
  lane: StreamTimelineLane;
  sourceTag: string;
  agentId: string | null;
  eventName?: string;
  title: string;
  text?: string;
  status?: ToolCardStatus;
  toolName?: string;
  toolCallId?: string;
  outerToolCallId?: string;
  args?: unknown;
  result?: unknown;
  rawEvent?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
};

type ChatFeedItem = {
  id: string;
  kind: "human" | "assistant" | "compact";
  title: string;
  content?: string;
  compactLabel?: string;
  preview?: string;
  at: number;
  status?: ToolCardStatus | "completed";
  sourceTag?: string;
  agentId?: string | null;
  toolCallId?: string;
  rawEvent?: Record<string, unknown>;
  linkedTimelineIds: string[];
};

type SourceRenderState = {
  sourceTag: string;
  sourceKey: string;
  agentId: string | null;
  title: string;
  isSubagent: boolean;
  outerToolCallId?: string;
  content: string;
  reasoning: string;
  toolItems: StreamTimelineItem[];
  timelineItems: StreamTimelineItem[];
  firstAt: number;
  lastAt: number;
};

type TaskScopedTitleMap = Map<string, string>;

type WorkspaceSubagentCard = {
  name: string;
  description: string;
  instructions: string;
  tools: string[];
  skills: string[];
  model?: string;
  sourceFile: string;
};

type WorkspaceTodoStep = {
  step_id?: number;
  title: string;
  content: string;
  status?: string;
};

type WorkspaceTodoPlan = {
  mission_id?: number;
  title: string;
  steps: WorkspaceTodoStep[];
};

type WorkspaceTodoDoc = {
  title: string;
  target?: string;
  plans: WorkspaceTodoPlan[];
  sourceFile: string;
};

type WorkspaceArtifactsResponse = {
  ok: boolean;
  workspace: string;
  runspace: string | null;
  workspaceSource?: string | null;
  scannedFiles: number;
  warnings?: string[];
  subagents: WorkspaceSubagentCard[];
  todos: WorkspaceTodoDoc[];
};

type DebugStreamEventEnvelope = {
  at: number;
  sessionId: string;
  streamAgentId: string | null;
  rawEvent: unknown;
  normalizedEvent: unknown;
};

type RawApiEventSnapshot = Record<string, unknown>;

function stringifyChunk(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sanitizeDisplayChunk(input: string): string {
  if (!input) return "";

  // Only strip obvious standalone tool metadata wrappers.
  // Keep regular text intact to avoid accidental character loss.
  if (/^\s*<tool_call>[\s\S]*<\/tool_call>\s*$/m.test(input)) {
    return "";
  }
  if (/^\s*<function=[^>]*>\s*$/m.test(input)) {
    return "";
  }
  if (/^\s*<parameter=[^>]*>\s*$/m.test(input)) {
    return "";
  }

  return input;
}

function normalizeAgentStreamChunk(raw: Record<string, any>): NormalizedAgentStreamChunk {
  const kind = typeof raw.kind === "string" ? raw.kind : "";
  const eventType = typeof raw.type === "string" ? raw.type : "";
  const metadata = raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {};
  const rawEvent =
    (metadata as Record<string, unknown>).raw_event &&
      typeof (metadata as Record<string, unknown>).raw_event === "object"
      ? ((metadata as Record<string, unknown>).raw_event as Record<string, unknown>)
      : {};
  const rawData =
    (metadata as Record<string, unknown>).rawdata &&
      typeof (metadata as Record<string, unknown>).rawdata === "object"
      ? ((metadata as Record<string, unknown>).rawdata as Record<string, unknown>)
      : {};
  const rawDataEvent =
    rawData.raw_event && typeof rawData.raw_event === "object"
      ? (rawData.raw_event as Record<string, unknown>)
      : rawData;
  const contentType =
    (typeof raw.content_type === "string" && raw.content_type) ||
    (typeof rawEvent.content_type === "string" ? (rawEvent.content_type as string) : "") ||
    (typeof rawDataEvent.content_type === "string" ? (rawDataEvent.content_type as string) : "");

  let normalizedKind: NormalizedAgentStreamChunk["kind"] = "document";
  if (
    kind === "reasoning" ||
    kind === "thinking" ||
    kind === "content" ||
    kind === "citation" ||
    kind === "document" ||
    kind === "tool_calls" ||
    kind === "tool_result" ||
    kind === "agent_status" ||
    kind === "audio_transcript" ||
    kind === "custom_event_metadata"
  ) {
    normalizedKind = kind;
  } else if (eventType === "content" || eventType === "citation" || eventType === "document") {
    normalizedKind = eventType;
  } else if (eventType === "thinking") {
    normalizedKind = "thinking";
  } else if (contentType === "audio_transcript") {
    normalizedKind = "audio_transcript";
  } else if (contentType === "agent_status") {
    normalizedKind = "agent_status";
  } else if (contentType === "custom_event_metadata") {
    normalizedKind = "custom_event_metadata";
  } else if (contentType === "reasoning") {
    normalizedKind = "reasoning";
  } else if (contentType === "citation") {
    normalizedKind = "citation";
  } else {
    normalizedKind = "content";
  }

  const transcript = raw.response_audio && typeof raw.response_audio.transcript === "string"
    ? raw.response_audio.transcript
    : "";

  const rawEventContent = typeof rawEvent.content === "string" ? (rawEvent.content as string) : "";
  const rawEventReasoning = typeof rawEvent.reasoning_content === "string" ? (rawEvent.reasoning_content as string) : "";
  const rawDataContent = typeof rawDataEvent.content === "string" ? (rawDataEvent.content as string) : "";
  const rawDataReasoning = typeof rawDataEvent.reasoning_content === "string" ? (rawDataEvent.reasoning_content as string) : "";

  const chunk =
    (typeof raw.delta === "string" && raw.delta) ||
    (typeof raw.content === "string" && raw.content) ||
    (typeof raw.reasoning_content === "string" && raw.reasoning_content) ||
    rawEventReasoning ||
    rawEventContent ||
    rawDataReasoning ||
    rawDataContent ||
    transcript ||
    stringifyChunk(raw.content ?? raw.metadata ?? rawEvent ?? rawDataEvent);

  const source =
    (typeof raw.source === "string" && raw.source) ||
    (typeof (metadata as Record<string, unknown>).source === "string"
      ? ((metadata as Record<string, unknown>).source as string)
      : "") ||
    (typeof rawEvent.source === "string" ? (rawEvent.source as string) : "") ||
    (typeof rawDataEvent.source === "string" ? (rawDataEvent.source as string) : "");
  const subagentName =
    (typeof raw.subagent_name === "string" && raw.subagent_name) ||
    (typeof (metadata as Record<string, unknown>).subagent_name === "string"
      ? ((metadata as Record<string, unknown>).subagent_name as string)
      : "") ||
    (typeof rawEvent.subagent_name === "string" ? (rawEvent.subagent_name as string) : "") ||
    (typeof rawDataEvent.subagent_name === "string" ? (rawDataEvent.subagent_name as string) : "");
  const agentName =
    (typeof raw.agent_name === "string" && raw.agent_name) ||
    (typeof (metadata as Record<string, unknown>).agent_name === "string"
      ? ((metadata as Record<string, unknown>).agent_name as string)
      : "") ||
    (typeof rawEvent.agent_name === "string" ? (rawEvent.agent_name as string) : "") ||
    (typeof rawDataEvent.agent_name === "string" ? (rawDataEvent.agent_name as string) : "");
  const keyBase =
    raw.tool_call_id ??
    raw.tool_call_name ??
    (rawEvent.tool_call_id as string | undefined) ??
    (rawDataEvent.tool_call_id as string | undefined) ??
    (rawEvent.tool && typeof rawEvent.tool === "object" ? ((rawEvent.tool as Record<string, unknown>).tool_call_id as string | undefined) : undefined) ??
    (rawDataEvent.tool && typeof rawDataEvent.tool === "object" ? ((rawDataEvent.tool as Record<string, unknown>).tool_call_id as string | undefined) : undefined);
  const resolvedSource = source || (subagentName ? "subagent" : agentName ? "agent" : "");
  const sourceTag =
    resolvedSource === "subagent"
      ? `[subagent:${subagentName || agentName || "unknown"}]`
      : resolvedSource
        ? `[${resolvedSource}:${agentName || "agent"}]`
        : "";

  const key = keyBase ? `${sourceTag || "[agent]"}:${String(keyBase)}` : undefined;
  return { kind: normalizedKind, chunk, key, sourceTag };
}

function normalizeIncomingAgentSseEvent(raw: RawAgnoEvent): AgentStreamEvent | null {
  const id = typeof raw.id === "number" ? raw.id : 0;
  const at = typeof raw.at === "number" ? raw.at : Date.now();
  const evt = typeof raw.event === "string" ? raw.event : "";

  if (evt === "agent.stream" || evt === "agent.wakeup" || evt === "agent.unread" || evt === "agent.done" || evt === "agent.error") {
    return raw as AgentStreamEvent;
  }

  const agnoStreamLike = new Set([
    "RunStarted",
    "ModelRequestStarted",
    "ModelRequestCompleted",
    "ReasoningStarted",
    "ReasoningStep",
    "ReasoningCompleted",
    "RunResponseContent",
    "RunContent",
    "ToolCallStarted",
    "ToolCallCompleted",
    "ToolCallError",
    "CustomEvent",
    "RunResponseAudio",
  ]);

  if (evt === "RunCompleted") {
    return {
      id,
      at,
      event: "agent.done",
      data: {
        finishReason:
          (typeof (raw as any).finish_reason === "string" && (raw as any).finish_reason) ||
          (typeof (raw as any).response?.finish_reason === "string" && (raw as any).response.finish_reason) ||
          null,
      },
    };
  }

  if (evt === "RunError") {
    return {
      id,
      at,
      event: "agent.error",
      data: { message: stringifyChunk((raw as any).error ?? raw) },
    };
  }

  if (agnoStreamLike.has(evt)) {
    const metadata =
      raw.metadata && typeof raw.metadata === "object"
        ? (raw.metadata as Record<string, unknown>)
        : {};
    const metadataRawEvent =
      metadata.raw_event && typeof metadata.raw_event === "object"
        ? (metadata.raw_event as Record<string, unknown>)
        : {};
    const metadataRawData =
      metadata.rawdata && typeof metadata.rawdata === "object"
        ? (metadata.rawdata as Record<string, unknown>)
        : {};
    const metadataRawDataEvent =
      metadataRawData.raw_event && typeof metadataRawData.raw_event === "object"
        ? (metadataRawData.raw_event as Record<string, unknown>)
        : metadataRawData;
    const metadataTool =
      metadata.tool && typeof metadata.tool === "object"
        ? (metadata.tool as Record<string, unknown>)
        : {};
    const rawEventTool =
      metadataRawEvent.tool && typeof metadataRawEvent.tool === "object"
        ? (metadataRawEvent.tool as Record<string, unknown>)
        : {};
    const explicitSubagent = metadata.source === "subagent";
    const actualEvent =
      evt === "CustomEvent"
        ? ((typeof metadata.event === "string" && metadata.event) ||
          (typeof metadataRawEvent.event === "string" && metadataRawEvent.event) ||
          (typeof metadataRawDataEvent.event === "string" && metadataRawDataEvent.event) ||
          evt)
        : evt;
    const actualContentType =
      (typeof metadata.content_type === "string" && metadata.content_type) ||
      (typeof metadataRawEvent.content_type === "string" && metadataRawEvent.content_type) ||
      (typeof metadataRawDataEvent.content_type === "string" && metadataRawDataEvent.content_type) ||
      (typeof raw.content_type === "string" && raw.content_type) ||
      "";
    const topLevelContent = typeof raw.content === "string" ? raw.content : undefined;
    const rawEventContent = typeof metadataRawEvent.content === "string" ? (metadataRawEvent.content as string) : undefined;
    const rawEventReasoning =
      typeof metadataRawEvent.reasoning_content === "string"
        ? (metadataRawEvent.reasoning_content as string)
        : undefined;
    const rawDataContent = typeof metadataRawDataEvent.content === "string" ? (metadataRawDataEvent.content as string) : undefined;
    const rawDataReasoning =
      typeof metadataRawDataEvent.reasoning_content === "string"
        ? (metadataRawDataEvent.reasoning_content as string)
        : undefined;
    const actualReasoning = explicitSubagent
      ? rawEventReasoning || rawDataReasoning || (typeof raw.reasoning_content === "string" ? raw.reasoning_content : undefined)
      : (typeof raw.reasoning_content === "string" && raw.reasoning_content) ||
        rawEventReasoning ||
        rawDataReasoning ||
        (actualEvent === "RunContent" && rawEventReasoning !== undefined ? topLevelContent : undefined);
    const actualContent = explicitSubagent
      ? rawEventContent || rawDataContent || topLevelContent
      : actualEvent === "RunContent" && rawEventReasoning !== undefined && !rawEventContent
        ? undefined
        : topLevelContent || rawEventContent || rawDataContent;
    const hasReasoning =
      (typeof actualReasoning === "string" && actualReasoning.trim().length > 0);
    const hasContent =
      (typeof actualContent === "string" && actualContent.trim().length > 0);

    let kind: AgentStreamEvent extends { data: infer D }
      ? D extends { kind: infer K }
      ? K
      : never
      : never = "content" as any;

    if (actualEvent.startsWith("Reasoning") || actualContentType === "reasoning" || raw.type === "thinking") {
      kind = "reasoning" as any;
    } else if (actualEvent === "ToolCallStarted") {
      kind = "tool_calls" as any;
    } else if (actualEvent === "ToolCallCompleted" || actualEvent === "ToolCallError") {
      kind = "tool_result" as any;
    } else if (actualContentType === "audio_transcript") {
      kind = "audio_transcript" as any;
    } else if (actualContentType === "agent_status") {
      kind = "agent_status" as any;
    } else if (actualContentType === "custom_event_metadata") {
      kind = "custom_event_metadata" as any;
    } else if (actualContentType === "citation") {
      kind = "citation" as any;
    } else if (actualContentType === "document" && actualEvent !== "ToolCallCompleted" && actualEvent !== "ToolCallError") {
      kind = "document" as any;
    } else if (explicitSubagent && typeof rawEventReasoning === "string" && rawEventReasoning.trim().length > 0 && !rawEventContent) {
      kind = "reasoning" as any;
    } else if (actualEvent === "RunContent" && hasReasoning) {
      kind = "reasoning" as any;
    }

    const toolCallId =
      (typeof rawEventTool.tool_call_id === "string" ? (rawEventTool.tool_call_id as string) : undefined) ??
      (typeof metadataTool.tool_call_id === "string" ? (metadataTool.tool_call_id as string) : undefined) ??
      (typeof (raw as any).tool_call_id === "string" ? (raw as any).tool_call_id : undefined) ??
      (typeof (raw as any).tool?.tool_call_id === "string" ? (raw as any).tool.tool_call_id : undefined);
    const toolCallName =
      (typeof rawEventTool.tool_name === "string" ? (rawEventTool.tool_name as string) : undefined) ??
      (typeof metadataTool.tool_name === "string" ? (metadataTool.tool_name as string) : undefined) ??
      (typeof (raw as any).tool_call_name === "string" ? (raw as any).tool_call_name : undefined) ??
      (typeof (raw as any).tool?.tool_name === "string" ? (raw as any).tool.tool_name : undefined) ??
      (typeof (raw as any).tool?.name === "string" ? (raw as any).tool.name : undefined);

    return {
      id,
      at,
      event: "agent.stream",
      data: {
        kind,
        delta: "",
        tool_call_id: typeof toolCallId === "string" ? toolCallId : undefined,
        tool_call_name: typeof toolCallName === "string" ? toolCallName : undefined,
        metadata: (raw.metadata ?? {}) as Record<string, unknown>,
        content: actualContent,
        reasoning_content: typeof actualReasoning === "string" ? actualReasoning : undefined,
        content_type: actualContentType || undefined,
        type: typeof raw.type === "string" ? raw.type : undefined,
        event: actualEvent,
        response_audio:
          raw.response_audio && typeof raw.response_audio === "object"
            ? (raw.response_audio as { transcript?: string })
            : undefined,
        source:
          explicitSubagent
            ? "subagent"
            : (typeof metadata.source === "string" ? (metadata.source as string) : undefined) ??
              (typeof (raw as any).source === "string" ? (raw as any).source : undefined),
        subagent_name:
          (typeof metadata.subagent_name === "string" ? (metadata.subagent_name as string) : undefined) ??
          (typeof (raw as any).subagent_name === "string" ? (raw as any).subagent_name : undefined),
        agent_id:
          (typeof metadata.agent_id === "string" ? (metadata.agent_id as string) : undefined) ??
          (typeof metadataRawEvent.agent_id === "string" ? (metadataRawEvent.agent_id as string) : undefined) ??
          (typeof metadataRawDataEvent.agent_id === "string" ? (metadataRawDataEvent.agent_id as string) : undefined) ??
          (typeof (raw as any).agent_id === "string" ? (raw as any).agent_id : undefined),
        agent_name:
          (typeof metadata.agent_name === "string" ? (metadata.agent_name as string) : undefined) ??
          (typeof metadataRawEvent.agent_name === "string" ? (metadataRawEvent.agent_name as string) : undefined) ??
          (typeof metadataRawDataEvent.agent_name === "string" ? (metadataRawDataEvent.agent_name as string) : undefined) ??
          (typeof (raw as any).agent_name === "string" ? (raw as any).agent_name : undefined),
        parent_agent_id: (raw as any).parent_agent_id,
        run_id:
          (typeof metadata.run_id === "string" ? (metadata.run_id as string) : undefined) ??
          (typeof metadataRawEvent.run_id === "string" ? (metadataRawEvent.run_id as string) : undefined) ??
          (typeof metadataRawDataEvent.run_id === "string" ? (metadataRawDataEvent.run_id as string) : undefined) ??
          (typeof (raw as any).run_id === "string" ? (raw as any).run_id : undefined),
        parent_run_id:
          (typeof metadata.parent_run_id === "string" ? (metadata.parent_run_id as string) : undefined) ??
          (typeof metadataRawEvent.parent_run_id === "string" ? (metadataRawEvent.parent_run_id as string) : undefined) ??
          (typeof metadataRawDataEvent.parent_run_id === "string" ? (metadataRawDataEvent.parent_run_id as string) : undefined) ??
          (typeof (raw as any).parent_run_id === "string" ? (raw as any).parent_run_id : undefined),
      },
    } as AgentStreamEvent;
  }

  return null;
}

function parseCustomEventPayload(
  data: Extract<AgentStreamEvent, { event: "agent.stream" }>['data']
): CustomEventPayload {
  const metadata = data.metadata && typeof data.metadata === "object" ? (data.metadata as Record<string, unknown>) : {};
  const rawEvent =
    metadata.raw_event && typeof metadata.raw_event === "object"
      ? (metadata.raw_event as Record<string, unknown>)
      : {};
  const rawData =
    metadata.rawdata && typeof metadata.rawdata === "object"
      ? (metadata.rawdata as Record<string, unknown>)
      : {};
  const rawDataEvent =
    rawData.raw_event && typeof rawData.raw_event === "object"
      ? (rawData.raw_event as Record<string, unknown>)
      : rawData;
  const explicitSubagent = metadata.source === "subagent";
  const metaTool = metadata.tool && typeof metadata.tool === "object" ? (metadata.tool as Record<string, unknown>) : {};
  const rawTool = rawEvent.tool && typeof rawEvent.tool === "object" ? (rawEvent.tool as Record<string, unknown>) : {};
  const rawDataTool = rawDataEvent.tool && typeof rawDataEvent.tool === "object" ? (rawDataEvent.tool as Record<string, unknown>) : {};

  const eventName =
    (typeof data.event === "string" && data.event) ||
    (typeof metadata.event === "string" ? (metadata.event as string) : "") ||
    (typeof rawDataEvent.event === "string" ? (rawDataEvent.event as string) : "CustomEvent");

  const reasoning =
    (explicitSubagent
      ? (typeof rawEvent.reasoning_content === "string" ? (rawEvent.reasoning_content as string) : "") ||
        (typeof rawDataEvent.reasoning_content === "string" ? (rawDataEvent.reasoning_content as string) : "") ||
        (typeof data.reasoning_content === "string" ? data.reasoning_content : "")
      : (typeof data.reasoning_content === "string" ? data.reasoning_content : "") ||
        (typeof rawEvent.reasoning_content === "string" ? (rawEvent.reasoning_content as string) : "") ||
        (typeof rawDataEvent.reasoning_content === "string" ? (rawDataEvent.reasoning_content as string) : ""));

  const rawEventContent = typeof rawEvent.content === "string" ? (rawEvent.content as string) : "";
  const rawDataContent = typeof rawDataEvent.content === "string" ? (rawDataEvent.content as string) : "";
  const rawEventReasoning =
    typeof rawEvent.reasoning_content === "string" ? (rawEvent.reasoning_content as string) : "";
  const isReasoningOnlyPayload = rawEventReasoning.trim().length > 0 && rawEventContent.trim().length === 0;

  const content = isReasoningOnlyPayload
    ? ""
    : (explicitSubagent
      ? rawEventContent || rawDataContent || (typeof data.content === "string" ? data.content : "") || (typeof data.delta === "string" ? data.delta : "")
      : (typeof data.content === "string" ? data.content : "") ||
        rawEventContent ||
        rawDataContent ||
        (typeof data.delta === "string" ? data.delta : ""));

  const toolCallId =
    (typeof rawDataTool.tool_call_id === "string" ? (rawDataTool.tool_call_id as string) : undefined) ||
    (typeof rawTool.tool_call_id === "string" ? (rawTool.tool_call_id as string) : undefined) ||
    (typeof metaTool.tool_call_id === "string" ? (metaTool.tool_call_id as string) : undefined) ||
    (typeof data.tool_call_id === "string" ? data.tool_call_id : undefined) ||
    (typeof metadata.tool_call_id === "string" ? (metadata.tool_call_id as string) : undefined) ||
    (typeof rawEvent.tool_call_id === "string" ? (rawEvent.tool_call_id as string) : undefined);

  const toolName =
    (typeof rawDataTool.tool_name === "string" ? (rawDataTool.tool_name as string) : undefined) ||
    (typeof rawTool.tool_name === "string" ? (rawTool.tool_name as string) : undefined) ||
    (typeof metaTool.tool_name === "string" ? (metaTool.tool_name as string) : undefined) ||
    (typeof data.tool_call_name === "string" ? data.tool_call_name : undefined) ||
    (typeof metadata.tool_name === "string" ? (metadata.tool_name as string) : undefined) ||
    (typeof rawEvent.tool_name === "string" ? (rawEvent.tool_name as string) : undefined) ||
    (typeof rawEvent.name === "string" ? (rawEvent.name as string) : undefined);

  let toolState: CustomEventPayload["toolState"];
  if (eventName === "ToolCallStarted") toolState = "started";
  if (eventName === "ToolCallCompleted") toolState = "completed";
  if (eventName === "ToolCallError") toolState = "error";

  const toolError =
    toolState === "error"
      ? (typeof data.delta === "string" && data.delta
        ? data.delta
        : typeof rawDataEvent.error === "string"
          ? (rawDataEvent.error as string)
          : typeof rawEvent.error === "string"
            ? (rawEvent.error as string)
            : typeof rawEvent.message === "string"
              ? (rawEvent.message as string)
              : "tool call error")
      : undefined;

  return {
    eventName,
    content,
    reasoning,
    toolCallId,
    toolName,
    toolState,
    toolError,
    args:
      rawDataTool.tool_args ||
      rawTool.tool_args ||
      metaTool.tool_args ||
      rawEvent.tool_args ||
      metadata.tool_args,
    result:
      rawDataTool.result ||
      rawTool.result ||
      metaTool.result ||
      rawEvent.result ||
      metadata.result ||
      data.content,
    rawEvent: Object.keys(rawEvent).length > 0 ? rawEvent : rawDataEvent,
    metrics: (() => {
      const candidate =
        rawDataTool.metrics ||
        rawTool.metrics ||
        metaTool.metrics ||
        rawEvent.metrics ||
        metadata.metrics;
      return candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>) : undefined;
    })(),
  };
}

function parseToolDeltaChunk(chunk: string): {
  state?: ToolCardStatus;
  tool_call_id?: string;
  tool_name?: string;
  content?: string;
  error?: string;
  args?: unknown;
  result?: unknown;
  metrics?: Record<string, unknown>;
  raw?: Record<string, unknown>;
} {
  const text = chunk.trim();
  if (!text.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const stateValue = typeof parsed.state === "string" ? parsed.state : undefined;
    const state: ToolCardStatus | undefined =
      stateValue === "started" || stateValue === "completed" || stateValue === "error"
        ? stateValue
        : undefined;
    return {
      state,
      tool_call_id: typeof parsed.tool_call_id === "string" ? parsed.tool_call_id : undefined,
      tool_name: typeof parsed.tool_name === "string" ? parsed.tool_name : undefined,
      content: typeof parsed.content === "string" ? parsed.content : undefined,
      error: typeof parsed.error === "string" ? parsed.error : undefined,
      args: parsed.tool_args,
      result: parsed.result,
      metrics: parsed.metrics && typeof parsed.metrics === "object" ? (parsed.metrics as Record<string, unknown>) : undefined,
      raw: parsed,
    };
  } catch {
    return {};
  }
}

const SESSION_KEY = "agent-wechat.session.v1";
const RIGHT_PANEL_MIN_HEIGHT = 120;
const RIGHT_PANEL_HEADER_HEIGHT = 32;
const MID_CHAT_MIN_HEIGHT = 0;
const MID_GRAPH_MIN_HEIGHT = 160;
const MID_SPLITTER_SIZE = 6;

const BACKEND_ORIGIN =
  (process.env.NEXT_PUBLIC_BACKEND_ORIGIN || "").trim().replace(/\/$/, "") || null;
const DIRECT_EXTERNAL_API = (process.env.NEXT_PUBLIC_DIRECT_BACKEND_MODE || "false").toLowerCase() === "true";

function withBackendOrigin(path: string) {
  if (!DIRECT_EXTERNAL_API && path.startsWith("/api/")) return path;
  if (!BACKEND_ORIGIN) return path;
  if (/^https?:\/\//.test(path)) return path;
  return `${BACKEND_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

function loadSession(): WorkspaceDefaults | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WorkspaceDefaults;
  } catch {
    return null;
  }
}

function saveSession(session: WorkspaceDefaults) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(withBackendOrigin(path), {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${text}`);
  }
  return (await res.json()) as T;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

function normalizeAgentLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function workspaceCardAgentId(card: WorkspaceSubagentCard): string {
  const seed = `${card.sourceFile}::${card.name}`.toLowerCase();
  return `ws-${stableHash(seed)}`;
}

function openTimelineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TIMELINE_DB_NAME, TIMELINE_DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TIMELINE_STORE_NAME)) {
        db.createObjectStore(TIMELINE_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function readTimelineSnapshot(key: string): Promise<StreamTimelineItem[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openTimelineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TIMELINE_STORE_NAME, "readonly");
    const store = tx.objectStore(TIMELINE_STORE_NAME);
    const request = store.get(key);
    request.onerror = () => reject(request.error ?? new Error("Failed to read timeline snapshot"));
    request.onsuccess = () => {
      const value = request.result as { key: string; items?: StreamTimelineItem[] } | undefined;
      resolve(Array.isArray(value?.items) ? value!.items : []);
    };
  });
}

async function readRawApiSnapshot(key: string): Promise<RawApiEventSnapshot[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openTimelineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TIMELINE_STORE_NAME, "readonly");
    const store = tx.objectStore(TIMELINE_STORE_NAME);
    const request = store.get(key);
    request.onerror = () => reject(request.error ?? new Error("Failed to read raw api snapshot"));
    request.onsuccess = () => {
      const value = request.result as { rawItems?: RawApiEventSnapshot[] } | undefined;
      resolve(Array.isArray(value?.rawItems) ? value!.rawItems : []);
    };
  });
}

async function readTimelineSnapshotMeta(key: string): Promise<{ count: number; updatedAt: number | null }> {
  if (typeof indexedDB === "undefined") return { count: 0, updatedAt: null };
  const db = await openTimelineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TIMELINE_STORE_NAME, "readonly");
    const store = tx.objectStore(TIMELINE_STORE_NAME);
    const request = store.get(key);
    request.onerror = () => reject(request.error ?? new Error("Failed to read timeline snapshot meta"));
    request.onsuccess = () => {
      const value = request.result as { items?: StreamTimelineItem[]; updatedAt?: number } | undefined;
      resolve({
        count: Array.isArray(value?.items) ? value!.items.length : 0,
        updatedAt: typeof value?.updatedAt === "number" ? value.updatedAt : null,
      });
    };
  });
}

async function writeTimelineSnapshot(key: string, items: StreamTimelineItem[], rawItems: RawApiEventSnapshot[]): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openTimelineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TIMELINE_STORE_NAME, "readwrite");
    const store = tx.objectStore(TIMELINE_STORE_NAME);
    store.put({ key, items, rawItems, updatedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to write timeline snapshot"));
  });
}

async function deleteTimelineSnapshot(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openTimelineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TIMELINE_STORE_NAME, "readwrite");
    tx.objectStore(TIMELINE_STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to delete timeline snapshot"));
  });
}

export default function IMPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}>
      <IMPageInner />
    </Suspense>
  );
}

function IMPageInner() {
  const searchParams = useSearchParams();
  const workspaceOverrideId = searchParams.get("workspaceId");
  const [session, setSession] = useState<WorkspaceDefaults | null>(() => null);
  const [tokenLimit, setTokenLimit] = useState<number>(100000);
  const [groups, setGroups] = useState<Group[]>([]);
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"boot" | "groups" | "messages" | "send" | "idle">("boot");
  const [error, setError] = useState<string | null>(null);
  const [stoppingAgents, setStoppingAgents] = useState(false);

  const [contentStream, setContentStream] = useState("");
  const [reasoningStream, setReasoningStream] = useState("");
  const [toolStream, setToolStream] = useState("");
  const [toolCards, setToolCards] = useState<ToolCard[]>([]);
  const [streamTimeline, setStreamTimeline] = useState<StreamTimelineItem[]>([]);
  const [llmHistory, setLlmHistory] = useState("");
  const [agentError, setAgentError] = useState<string | null>(null);
  const [vizEvents, setVizEvents] = useState<VizEvent[]>([]);
  const [vizBeams, setVizBeams] = useState<VizBeam[]>([]);
  const [vizSize, setVizSize] = useState({ width: 640, height: 260 });
  const [vizScale, setVizScale] = useState(0.9);
  const [vizOffset, setVizOffset] = useState({ x: 0, y: 0 });
  const [vizIsPanning, setVizIsPanning] = useState(false);
  const [agentStatusById, setAgentStatusById] = useState<Record<string, AgentStatus>>({});
  const [vizDebug, setVizDebug] = useState<VizDebugEntry[]>([]);
  const [vizEventsCollapsed, setVizEventsCollapsed] = useState(false);
  const [showExecutionDrawer, setShowExecutionDrawer] = useState(false);
  const [selectedFeedItemId, setSelectedFeedItemId] = useState<string | null>(null);
  const [selectedWorkflowNodeId, setSelectedWorkflowNodeId] = useState<string | null>(null);
  const [showTaskDetailCard, setShowTaskDetailCard] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(320);
  const [rightPanelWidth, setRightPanelWidth] = useState(640);
  const [taskFlowSectionHeights, setTaskFlowSectionHeights] = useState({ top: 180, preview: 260 });
  const [artifactPreview, setArtifactPreview] = useState<ArtifactPreviewState>({
    artifact: null,
    loading: false,
    error: null,
    content: "",
    contentType: "",
  });
  const [turnWorkflow, setTurnWorkflow] = useState<TurnWorkflowSnapshot>({
    runId: null,
    nodes: [],
    edges: [],
    events: 0,
  });
  const [rightPanels, setRightPanels] = useState<RightPanelState[]>([
    { id: "history", title: "LLM history", size: 320, collapsed: false },
    { id: "content", title: "Realtime content", size: 220, collapsed: false },
    { id: "reasoning", title: "Realtime reasoning", size: 220, collapsed: false },
    { id: "tools", title: "Realtime tools", size: 200, collapsed: false },
  ]);
  const [midSplitRatio, setMidSplitRatio] = useState(0.55);
  const [midStackHeight, setMidStackHeight] = useState(0);
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [collapsedAgents, setCollapsedAgents] = useState<Record<string, boolean>>({});
  const [derivedAgents, setDerivedAgents] = useState<AgentMeta[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [isReplayingTest, setIsReplayingTest] = useState(false);
  const [isReplayMode, setIsReplayMode] = useState(false);
  const [stoppingCurrentAgent, setStoppingCurrentAgent] = useState(false);
  const [timelineSnapshotMeta, setTimelineSnapshotMeta] = useState<{ count: number; updatedAt: number | null }>({
    count: 0,
    updatedAt: null,
  });
  const [workspaceArtifacts, setWorkspaceArtifacts] = useState<WorkspaceArtifactsResponse | null>(null);
  const [workspaceArtifactsLoading, setWorkspaceArtifactsLoading] = useState(false);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [activeGraphCardAgentId, setActiveGraphCardAgentId] = useState<string | null>(null);
  const [debugSessionId, setDebugSessionId] = useState("session-client");

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const activeGroupIdRef = useRef<string | null>(null);
  const streamAgentIdRef = useRef<string | null>(null);
  const streamAgentIdValueRef = useRef<string | null>(null);
  const agentRoleByIdRef = useRef<Map<string, string>>(new Map());
  const toolCallBuffersRef = useRef<Map<string, string>>(new Map());
  const toolResultBuffersRef = useRef<Map<string, string>>(new Map());
  const toolCardMapRef = useRef<Map<string, ToolCard>>(new Map());
  const contentBySourceRef = useRef<Map<string, string>>(new Map());
  const reasoningBySourceRef = useRef<Map<string, string>>(new Map());
  const taskAssignmentNameByOuterCallRef = useRef<Map<string, string>>(new Map());
  const debugSessionIdRef = useRef<string>("session-client");
  const debugEventBufferRef = useRef<DebugStreamEventEnvelope[]>([]);
  const debugFlushTimerRef = useRef<number | null>(null);
  const contentSegmentKeyRef = useRef<string | null>(null);
  const reasoningSegmentKeyRef = useRef<string | null>(null);
  const contentBlockIndexRef = useRef<Map<string, number>>(new Map());
  const reasoningBlockIndexRef = useRef<Map<string, number>>(new Map());
  const lastProcessedKindByScopeRef = useRef<Map<string, NormalizedAgentStreamChunk["kind"]>>(new Map());
  const modelRequestSeqByRunRef = useRef<Map<string, number>>(new Map());
  const uiEsRef = useRef<EventSource | null>(null);
  const llmHistoryReqIdRef = useRef(0);
  const vizRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const midStackRef = useRef<HTMLDivElement | null>(null);
  const taskFlowLayoutRef = useRef<HTMLDivElement | null>(null);
  const taskFlowCanvasScrollRef = useRef<HTMLDivElement | null>(null);
  const midChatHeightRef = useRef(0);
  const nodeOffsetsRef = useRef<Record<string, { x: number; y: number }>>({});
  const groupsRef = useRef<Group[]>([]);
  const beamTimeoutsRef = useRef<number[]>([]);
  const refreshQueueRef = useRef<{
    timer: number | null;
    pending: { groups: boolean; agents: boolean; messages: boolean; llmHistory: boolean };
  }>({ timer: null, pending: { groups: false, agents: false, messages: false, llmHistory: false } });
  const vizPanStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const subagentVizThrottleRef = useRef<Map<string, number>>(new Map());
  const derivedCreateEdgeRef = useRef<Set<string>>(new Set());
  const sourceTagAgentIdRef = useRef<Map<string, string>>(new Map());
  const replayAbortRef = useRef<{ cancelled: boolean } | null>(null);
  const timelineCounterRef = useRef(0);
  const timelinePersistTimerRef = useRef<number | null>(null);
  const hydratedTimelineKeyRef = useRef<string | null>(null);
  const isHydratingTimelineRef = useRef(false);
  const suspendTimelinePersistRef = useRef(false);
  const lastReasoningSeqRef = useRef<number | null>(null);
  const [collapsedReasoningUntilSeq, setCollapsedReasoningUntilSeq] = useState<number>(-1);
  const turnWorkflowRunIdRef = useRef<string | null>(null);
  const turnWorkflowNodeMapRef = useRef<Map<string, TurnWorkflowNode>>(new Map());
  const turnWorkflowEdgeMapRef = useRef<Map<string, TurnWorkflowEdge>>(new Map());
  const turnWorkflowEventsRef = useRef(0);
  const rawApiEventLogRef = useRef<RawApiEventSnapshot[]>([]);

  const pushRawApiEvent = useCallback((rawPayload: RawAgnoEvent | AgentStreamEvent) => {
    const normalized = (() => {
      try {
        return JSON.parse(JSON.stringify(rawPayload)) as RawApiEventSnapshot;
      } catch {
        return { raw: stringifyChunk(rawPayload) } as RawApiEventSnapshot;
      }
    })();
    rawApiEventLogRef.current = [...rawApiEventLogRef.current, normalized].slice(-5000);
  }, []);


  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId]
  );

  const agentRoleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.role);
    return map;
  }, [agents]);

  const agentById = useMemo(() => {
    const map = new Map<string, AgentMeta>();
    for (const a of agents) map.set(a.id, a);
    return map;
  }, [agents]);

  const runtimeAgents = useMemo(() => {
    if (derivedAgents.length === 0) return agents;
    const existing = new Set(agents.map((a) => a.id));
    const extras = derivedAgents.filter((a) => !existing.has(a.id));
    return extras.length > 0 ? [...agents, ...extras] : agents;
  }, [agents, derivedAgents]);

  const workspaceCardByAgentId = useMemo(() => {
    const map = new Map<string, WorkspaceSubagentCard>();
    const cards = workspaceArtifacts?.subagents ?? [];
    if (cards.length === 0) return map;

    const runtimeByRole = new Map<string, AgentMeta>();
    for (const agent of runtimeAgents) {
      const key = normalizeAgentLabel(agent.role);
      if (!key || runtimeByRole.has(key)) continue;
      runtimeByRole.set(key, agent);
    }

    for (const card of cards) {
      const roleKey = normalizeAgentLabel(card.name);
      if (!roleKey) continue;
      const matchedRuntime = runtimeByRole.get(roleKey);
      if (matchedRuntime && !map.has(matchedRuntime.id)) {
        map.set(matchedRuntime.id, card);
        continue;
      }
      const placeholderId = workspaceCardAgentId(card);
      if (!map.has(placeholderId)) map.set(placeholderId, card);
    }

    return map;
  }, [runtimeAgents, workspaceArtifacts?.subagents]);

  const workspacePlaceholderAgents = useMemo(() => {
    const cards = workspaceArtifacts?.subagents ?? [];
    if (cards.length === 0) return [] as AgentMeta[];

    const runtimeByRole = new Map<string, AgentMeta>();
    for (const agent of runtimeAgents) {
      const key = normalizeAgentLabel(agent.role);
      if (!key || runtimeByRole.has(key)) continue;
      runtimeByRole.set(key, agent);
    }

    const placeholders: AgentMeta[] = [];
    const assistantId = session?.assistantAgentId ?? null;

    cards.forEach((card, idx) => {
      const role = card.name.trim();
      if (!role) return;
      const roleKey = normalizeAgentLabel(role);
      if (!roleKey) return;
      if (runtimeByRole.has(roleKey)) return;
      placeholders.push({
        id: workspaceCardAgentId(card),
        role,
        parentId: assistantId,
        createdAt: new Date((idx + 1) * 1000).toISOString(),
      });
    });

    return placeholders;
  }, [runtimeAgents, session?.assistantAgentId, workspaceArtifacts?.subagents]);

  const vizAgents = useMemo(() => {
    if (workspacePlaceholderAgents.length === 0) return runtimeAgents;
    const existing = new Set(runtimeAgents.map((a) => a.id));
    const extras = workspacePlaceholderAgents.filter((a) => !existing.has(a.id));
    return extras.length > 0 ? [...runtimeAgents, ...extras] : runtimeAgents;
  }, [runtimeAgents, workspacePlaceholderAgents]);

  const registerDerivedAgent = useCallback((input: { id: string; role: string; parentId?: string | null }) => {
    const id = input.id.trim();
    if (!id) return;
    setDerivedAgents((prev) => {
      const idx = prev.findIndex((a) => a.id === id);
      if (idx >= 0) {
        const current = prev[idx]!;
        const nextRole = input.role?.trim() || current.role;
        const nextParentId = input.parentId ?? current.parentId;
        if (nextRole === current.role && nextParentId === current.parentId) return prev;
        const next = [...prev];
        next[idx] = { ...current, role: nextRole, parentId: nextParentId ?? null };
        return next;
      }
      return [
        ...prev,
        {
          id,
          role: input.role?.trim() || id.slice(0, 8),
          parentId: input.parentId ?? null,
          createdAt: new Date().toISOString(),
        },
      ];
    });
  }, []);

  const inferAgentIdFromSourceTag = useCallback(
    (sourceTag: string): string | null => {
      if (!sourceTag) return streamAgentIdRef.current;
      if (sourceTag === "[agent]") return streamAgentIdRef.current;

      const mapped = sourceTagAgentIdRef.current.get(sourceTag);
      if (mapped) return mapped;

      const subagentMatch = sourceTag.match(/^\[subagent:(.+)\]$/);
      if (subagentMatch?.[1]) {
        const name = subagentMatch[1];
        const norm = normalizeAgentLabel(name);
        const found = vizAgents.find((a) => a.id === name || normalizeAgentLabel(a.role) === norm);
        return found?.id ?? null;
      }

      const sourceMatch = sourceTag.match(/^\[[^:]+:(.+)\]$/);
      if (sourceMatch?.[1]) {
        const name = sourceMatch[1];
        const norm = normalizeAgentLabel(name);
        const found = vizAgents.find((a) => a.id === name || normalizeAgentLabel(a.role) === norm);
        return found?.id ?? null;
      }

      return null;
    },
    [vizAgents]
  );

  const selectedAgentName = useMemo(() => {
    if (!selectedAgentId) return null;
    return vizAgents.find((a) => a.id === selectedAgentId)?.role ?? selectedAgentId.slice(0, 8);
  }, [selectedAgentId, vizAgents]);

  const startColumnResize = useCallback((edge: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const onMove = (moveEvent: PointerEvent) => {
      const viewportWidth = window.innerWidth;
      if (edge === "left") {
        const max = Math.min(LEFT_PANEL_MAX_WIDTH, viewportWidth - (showExecutionDrawer ? rightPanelWidth : 0) - CENTER_PANEL_MIN_WIDTH);
        const next = Math.min(Math.max(moveEvent.clientX, LEFT_PANEL_MIN_WIDTH), Math.max(LEFT_PANEL_MIN_WIDTH, max));
        setLeftPanelWidth(next);
        return;
      }
      const max = Math.min(RIGHT_PANEL_MAX_WIDTH, viewportWidth - leftPanelWidth - CENTER_PANEL_MIN_WIDTH);
      const next = Math.min(Math.max(viewportWidth - moveEvent.clientX, RIGHT_PANEL_MIN_WIDTH), Math.max(RIGHT_PANEL_MIN_WIDTH, max));
      setRightPanelWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [leftPanelWidth, rightPanelWidth, showExecutionDrawer]);

  const startTaskFlowRowResize = useCallback((edge: "top" | "bottom", event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = taskFlowLayoutRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startTop = taskFlowSectionHeights.top;
    const startPreview = taskFlowSectionHeights.preview;

    const onMove = (moveEvent: PointerEvent) => {
      const y = moveEvent.clientY - rect.top;
      if (edge === "top") {
        const maxTop = rect.height - TASK_FLOW_MIDDLE_MIN_HEIGHT - taskFlowSectionHeights.preview - 16;
        const nextTop = Math.min(Math.max(y, TASK_FLOW_TOP_MIN_HEIGHT), Math.max(TASK_FLOW_TOP_MIN_HEIGHT, maxTop));
        setTaskFlowSectionHeights((prev) => ({ ...prev, top: nextTop }));
        return;
      }
      const previewHeight = Math.max(TASK_FLOW_PREVIEW_MIN_HEIGHT, rect.bottom - moveEvent.clientY);
      const maxPreview = rect.height - startTop - TASK_FLOW_MIDDLE_MIN_HEIGHT - 16;
      const nextPreview = Math.min(previewHeight, Math.max(TASK_FLOW_PREVIEW_MIN_HEIGHT, maxPreview));
      setTaskFlowSectionHeights((prev) => ({ ...prev, preview: nextPreview }));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [taskFlowSectionHeights.preview, taskFlowSectionHeights.top]);

  const startTaskFlowCanvasPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const container = taskFlowCanvasScrollRef.current;
    if (!container) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = container.scrollLeft;
    const startTop = container.scrollTop;

    const onMove = (moveEvent: PointerEvent) => {
      container.scrollLeft = startLeft - (moveEvent.clientX - startX);
      container.scrollTop = startTop - (moveEvent.clientY - startY);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
    };

    document.body.style.cursor = "grabbing";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  useEffect(() => {
    if (!activeGraphCardAgentId) return;
    const exists = vizAgents.some((agent) => agent.id === activeGraphCardAgentId);
    if (!exists) setActiveGraphCardAgentId(null);
  }, [activeGraphCardAgentId, vizAgents]);

  const appendTimelineItem = useCallback((input: Omit<StreamTimelineItem, "id" | "seq">): number => {
    const seq = timelineCounterRef.current++;
    const id = `${input.mergeKey}-${seq}`;
    setStreamTimeline((prev) => {
      const existingIndex = prev.findIndex(
        (entry) => entry.mergeKey === input.mergeKey && entry.lane === input.lane && entry.sourceTag === input.sourceTag
      );
      if (existingIndex >= 0) {
        const existing = prev[existingIndex]!;
        const merged: StreamTimelineItem = {
          ...existing,
          at: Math.min(existing.at, input.at),
          title: input.title || existing.title,
          text: `${existing.text ?? ""}${input.text ?? ""}`,
          status: input.status ?? existing.status,
          toolName: input.toolName ?? existing.toolName,
          toolCallId: input.toolCallId ?? existing.toolCallId,
          outerToolCallId: input.outerToolCallId ?? existing.outerToolCallId,
          args: input.args ?? existing.args,
          result: input.result ?? existing.result,
          rawEvent: input.rawEvent ?? existing.rawEvent,
          metrics: input.metrics ?? existing.metrics,
          eventName: input.eventName ?? existing.eventName,
        };
        const next = [...prev];
        next[existingIndex] = merged;
        return next.slice(-800);
      }
      return [...prev, { ...input, id, seq }].slice(-800);
    });
    return seq;
  }, []);

  const syncTurnWorkflowSnapshot = useCallback(() => {
    setTurnWorkflow({
      runId: turnWorkflowRunIdRef.current,
      nodes: Array.from(turnWorkflowNodeMapRef.current.values()),
      edges: Array.from(turnWorkflowEdgeMapRef.current.values()),
      events: turnWorkflowEventsRef.current,
    });
  }, []);

  const resetTurnWorkflow = useCallback((runId: string | null) => {
    turnWorkflowRunIdRef.current = runId;
    turnWorkflowNodeMapRef.current = new Map();
    turnWorkflowEdgeMapRef.current = new Map();
    turnWorkflowEventsRef.current = 0;
    setSelectedWorkflowNodeId(null);
    setTurnWorkflow({ runId, nodes: [], edges: [], events: 0 });
  }, []);

  const upsertTurnWorkflowNode = useCallback((node: TurnWorkflowNode) => {
    const prev = turnWorkflowNodeMapRef.current.get(node.id);
    if (!prev) {
      turnWorkflowNodeMapRef.current.set(node.id, node);
      return;
    }
    const nextStatus =
      prev.status === "error" || node.status === "error"
        ? "error"
        : prev.status === "completed" || node.status === "completed"
          ? "completed"
          : node.status;
    turnWorkflowNodeMapRef.current.set(node.id, {
      ...prev,
      ...node,
      status: nextStatus,
      detail: node.detail ?? prev.detail,
      args: node.args ?? prev.args,
      result: node.result ?? prev.result,
      error: node.error ?? prev.error,
      rawPayload: node.rawPayload ?? prev.rawPayload,
    });
  }, []);

  const upsertTurnWorkflowEdge = useCallback((edge: TurnWorkflowEdge) => {
    if (!turnWorkflowEdgeMapRef.current.has(edge.id)) {
      turnWorkflowEdgeMapRef.current.set(edge.id, edge);
    }
  }, []);

  const ingestTurnWorkflowEvent = useCallback(
    (canonical: CanonicalWorkflowEvent) => {
      const incomingRunId = canonical.runId ?? turnWorkflowRunIdRef.current;
      if (!incomingRunId) return;

      if (canonical.eventName === "RunStarted" && incomingRunId !== turnWorkflowRunIdRef.current) {
        turnWorkflowRunIdRef.current = incomingRunId;
        turnWorkflowNodeMapRef.current = new Map();
        turnWorkflowEdgeMapRef.current = new Map();
        turnWorkflowEventsRef.current = 0;
      } else if (!turnWorkflowRunIdRef.current) {
        turnWorkflowRunIdRef.current = incomingRunId;
      }

      const activeRunId = turnWorkflowRunIdRef.current;
      if (!activeRunId) return;

      const runNodeId = `run:${activeRunId}`;
      upsertTurnWorkflowNode({
        id: runNodeId,
        type: "run",
        label: "Current Turn",
        status: canonical.eventName === "RunCompleted" ? "completed" : canonical.eventName === "RunError" ? "error" : "running",
        runId: activeRunId,
        detail: activeRunId,
      });

      const actorName = canonical.subagentName ?? canonical.agentName ?? canonical.agentId ?? "agent";
      const actorId = canonical.agentId ?? actorName;
      const actorNodeId = `agent:${actorId}`;
      upsertTurnWorkflowNode({
        id: actorNodeId,
        type: "agent",
        label: actorName,
        status: canonical.eventName === "RunError" ? "error" : canonical.eventName === "RunCompleted" ? "completed" : "running",
        runId: activeRunId,
        source: canonical.source,
        agentId: canonical.agentId,
        detail: canonical.reasoning ? `reasoning: ${canonical.reasoning.slice(0, 120)}` : canonical.content?.slice(0, 120),
        rawPayload: canonical.rawPayload,
      });
      upsertTurnWorkflowEdge({
        id: `${runNodeId}->${actorNodeId}`,
        from: runNodeId,
        to: actorNodeId,
        kind: "spawn",
        label: canonical.source === "subagent" ? "subagent" : "agent",
      });

      if (
        canonical.eventName === "ToolCallStarted" ||
        canonical.eventName === "ToolCallCompleted" ||
        canonical.eventName === "ToolCallError"
      ) {
        const callKey = canonical.toolCallId ?? canonical.toolName ?? `${canonical.eventName}-${turnWorkflowEventsRef.current}`;
        const toolNodeId = `tool:${activeRunId}:${callKey}`;
        const toolStatus: WorkflowNodeStatus =
          canonical.eventName === "ToolCallError"
            ? "error"
            : canonical.eventName === "ToolCallCompleted"
              ? "completed"
              : "running";
        const detail =
          canonical.eventName === "ToolCallError"
            ? canonical.toolError ?? "tool call error"
            : pickString(canonical.content, typeof canonical.toolResult === "string" ? canonical.toolResult : undefined) ??
            summarizeUnknown(canonical.toolResult, 120) ??
            "running";

        upsertTurnWorkflowNode({
          id: toolNodeId,
          type: "tool",
          label: canonical.toolName ?? "tool_call",
          status: toolStatus,
          runId: activeRunId,
          toolCallId: canonical.toolCallId,
          toolName: canonical.toolName,
          detail,
          args: canonical.toolArgs,
          result: canonical.toolResult,
          error: canonical.eventName === "ToolCallError" ? canonical.toolError ?? "tool call error" : undefined,
          rawPayload: canonical.rawPayload,
        });
        upsertTurnWorkflowEdge({
          id: `${actorNodeId}->${toolNodeId}`,
          from: actorNodeId,
          to: toolNodeId,
          kind: "invoke",
          label: canonical.eventName,
        });
      }

      turnWorkflowEventsRef.current += 1;
      syncTurnWorkflowSnapshot();
    },
    [syncTurnWorkflowSnapshot, upsertTurnWorkflowEdge, upsertTurnWorkflowNode]
  );

  const vizLayout = useMemo(() => {
    const width = Math.max(1, vizSize.width);
    const height = Math.max(1, vizSize.height);
    const paddingX = 70;
    const paddingY = 60;
    const byId = new Map(vizAgents.map((a) => [a.id, a]));
    const parentById = new Map<string, string | null>();
    const childrenById = new Map<string, AgentMeta[]>();
    const roots: AgentMeta[] = [];

    for (const agent of vizAgents) {
      const parentId = agent.parentId;
      if (parentId && parentId !== agent.id && byId.has(parentId)) {
        const list = childrenById.get(parentId) ?? [];
        list.push(agent);
        childrenById.set(parentId, list);
        parentById.set(agent.id, parentId);
      } else {
        roots.push(agent);
        parentById.set(agent.id, null);
      }
    }

    const byCreatedAt = (a: AgentMeta, b: AgentMeta) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

    for (const list of childrenById.values()) list.sort(byCreatedAt);
    roots.sort(byCreatedAt);

    if (session) {
      const humanIndex = roots.findIndex((a) => a.id === session.humanAgentId);
      if (humanIndex > -1) {
        const [human] = roots.splice(humanIndex, 1);
        roots.unshift(human);
      }
    }

    const nodeMeta = new Map<string, { xIndex: number; depth: number }>();
    let leafIndex = 0;
    let maxDepth = 0;
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const walk = (agent: AgentMeta, depth: number): { min: number; max: number } => {
      if (visited.has(agent.id)) {
        const meta = nodeMeta.get(agent.id);
        if (meta) return { min: meta.xIndex, max: meta.xIndex };
      }
      if (visiting.has(agent.id)) {
        const xIndex = leafIndex++;
        nodeMeta.set(agent.id, { xIndex, depth });
        return { min: xIndex, max: xIndex };
      }

      visiting.add(agent.id);
      maxDepth = Math.max(maxDepth, depth);
      const children = (childrenById.get(agent.id) ?? []).filter((child) => child.id !== agent.id);
      let range: { min: number; max: number };
      if (children.length === 0) {
        const xIndex = leafIndex++;
        nodeMeta.set(agent.id, { xIndex, depth });
        range = { min: xIndex, max: xIndex };
      } else {
        const ranges = children.map((child) => walk(child, depth + 1));
        const min = ranges[0]?.min ?? leafIndex;
        const max = ranges[ranges.length - 1]?.max ?? min;
        const xIndex = (min + max) / 2;
        nodeMeta.set(agent.id, { xIndex, depth });
        range = { min, max };
      }
      visiting.delete(agent.id);
      visited.add(agent.id);
      return range;
    };

    roots.forEach((root) => {
      walk(root, 0);
    });

    for (const agent of vizAgents) {
      if (!nodeMeta.has(agent.id)) {
        walk(agent, 0);
      }
    }

    const leafCount = Math.max(1, leafIndex);
    const depthCount = Math.max(1, maxDepth + 1);
    const baseSpan = Math.max(1, width - paddingX * 2);
    const maxSpan =
      leafCount <= 2 ? Math.min(baseSpan, 360) : leafCount <= 4 ? Math.min(baseSpan, 520) : baseSpan;
    const xSpan = Math.max(1, maxSpan);
    const xStart = (width - xSpan) / 2;
    const ySpan = Math.max(1, height - paddingY * 2);
    const xStep = leafCount === 1 ? 0 : xSpan / (leafCount - 1);
    const yStep = depthCount === 1 ? 0 : ySpan / (depthCount - 1);

    const basePositions = new Map<string, { x: number; y: number }>();
    for (const agent of vizAgents) {
      const meta = nodeMeta.get(agent.id);
      if (!meta) continue;
      basePositions.set(agent.id, {
        x: xStart + meta.xIndex * xStep,
        y: paddingY + meta.depth * yStep,
      });
    }

    const offsetCache = new Map<string, { x: number; y: number }>();
    const positions = new Map<string, { x: number; y: number }>();
    const getAccumulatedOffset = (id: string) => {
      if (offsetCache.has(id)) return offsetCache.get(id)!;
      let x = 0;
      let y = 0;
      const seen = new Set<string>();
      let current: string | null | undefined = id;
      while (current) {
        if (seen.has(current)) break;
        seen.add(current);
        const offset = nodeOffsets[current];
        if (offset) {
          x += offset.x;
          y += offset.y;
        }
        current = parentById.get(current) ?? null;
      }
      const total = { x, y };
      offsetCache.set(id, total);
      return total;
    };

    for (const agent of vizAgents) {
      const base = basePositions.get(agent.id);
      if (!base) continue;
      const offset = getAccumulatedOffset(agent.id);
      positions.set(agent.id, { x: base.x + offset.x, y: base.y + offset.y });
    }

    const ordered = [...vizAgents].sort((a, b) => {
      const da = nodeMeta.get(a.id)?.depth ?? 0;
      const db = nodeMeta.get(b.id)?.depth ?? 0;
      if (da !== db) return da - db;
      return byCreatedAt(a, b);
    });

    const edges: Array<{ fromId: UUID; toId: UUID }> = [];
    for (const [parentId, children] of childrenById.entries()) {
      for (const child of children) {
        edges.push({ fromId: parentId, toId: child.id });
      }
    }

    return { positions, ordered, edges, parentById };
  }, [nodeOffsets, session, vizAgents, vizSize.height, vizSize.width]);

  const getGroupLabel = useCallback(
    (g: Group | null | undefined) => {
      if (!g) return "Group";
      if (g.name) return g.name;
      if (g.id === session?.defaultGroupId) return "P2P 人类↔助手";

      const memberRoles = g.memberIds
        .filter((id) => id !== session?.humanAgentId)
        .map((id) => agentRoleById.get(id) ?? id.slice(0, 8));

      if (memberRoles.length === 1) return `P2P 人类↔${memberRoles[0]}`;
      if (memberRoles.length === 2) return `${memberRoles[0]} ↔ ${memberRoles[1]}`;
      if (memberRoles.length > 2) return `Group (${memberRoles.length})`;
      return "Group";
    },
    [agentRoleById, session?.defaultGroupId, session?.humanAgentId]
  );

  const groupByAgentId = useMemo(() => {
    const map = new Map<string, Group>();
    if (!session) return map;
    for (const g of groups) {
      if (!g.memberIds.includes(session.humanAgentId)) continue;
      const others = g.memberIds.filter((id) => id !== session.humanAgentId);
      if (others.length === 1) {
        map.set(others[0], g);
      }
    }
    return map;
  }, [groups, session]);

  const agentTreeRows = useMemo(() => {
    const byId = new Map(vizAgents.map((a) => [a.id, a]));
    const childrenById = new Map<string, AgentMeta[]>();
    const roots: AgentMeta[] = [];
    const byCreatedAt = (a: AgentMeta, b: AgentMeta) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

    const humanAgentId = session?.humanAgentId ?? null;

    for (const agent of vizAgents) {
      if (humanAgentId && agent.id === humanAgentId) continue;
      if (agent.role === "human") continue;
      const parentId = agent.parentId;
      const parent = parentId && parentId !== agent.id ? byId.get(parentId) : null;
      if (
        parent &&
        parent.role !== "human" &&
        parent.id !== agent.id &&
        (!humanAgentId || parent.id !== humanAgentId)
      ) {
        const list = childrenById.get(parent.id) ?? [];
        list.push(agent);
        childrenById.set(parent.id, list);
      } else {
        roots.push(agent);
      }
    }

    for (const list of childrenById.values()) list.sort(byCreatedAt);
    roots.sort(byCreatedAt);

    const rows: Array<{
      agent: AgentMeta;
      group: Group | null;
      depth: number;
      hasChildren: boolean;
      collapsed: boolean;
      guides: boolean[];
      isLast: boolean;
    }> = [];
    const walk = (agent: AgentMeta, depth: number, guides: boolean[], isLast: boolean) => {
      const children = childrenById.get(agent.id) ?? [];
      const collapsed = !!collapsedAgents[agent.id];
      rows.push({
        agent,
        group: groupByAgentId.get(agent.id) ?? null,
        depth,
        hasChildren: children.length > 0,
        collapsed,
        guides,
        isLast,
      });
      if (collapsed) return;
      const nextGuides = [...guides, !isLast];
      children.forEach((child, index) => {
        walk(child, depth + 1, nextGuides, index === children.length - 1);
      });
    };
    roots.forEach((root, index) => walk(root, 0, [], index === roots.length - 1));
    return rows;
  }, [collapsedAgents, groupByAgentId, session?.humanAgentId, vizAgents]);

  const extraGroups = useMemo(() => {
    if (!session) return groups;
    const mappedIds = new Set(Array.from(groupByAgentId.values()).map((g) => g.id));
    return groups.filter((g) => !mappedIds.has(g.id));
  }, [groupByAgentId, groups, session]);

  const streamAgentId = useMemo(() => {
    if (!session) return null;
    if (!activeGroupId) return session.assistantAgentId;
    const group = groups.find((g) => g.id === activeGroupId);
    if (!group) return session.assistantAgentId;
    return group.memberIds.find((id) => id !== session.humanAgentId) ?? session.assistantAgentId;
  }, [activeGroupId, groups, session]);

  const timelineStorageKey = useMemo(() => {
    if (!session) return null;
    const scope = isReplayMode ? "replay" : "live";
    if (!activeGroupId) return `${session.workspaceId}:${scope}:stream:${streamAgentId ?? "default"}`;
    return `${session.workspaceId}:${scope}:group:${activeGroupId}`;
  }, [activeGroupId, isReplayMode, session, streamAgentId]);

  const refreshAgents = useCallback(async (s: WorkspaceDefaults) => {
    const { agents } = await api<{ agents: AgentMeta[] }>(
      `/api/agents?workspaceId=${encodeURIComponent(s.workspaceId)}&meta=true`
    );
    setAgents(agents);
  }, []);

  const formatLlmHistory = useCallback((raw: string) => {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }, []);

  const refreshLlmHistory = useCallback(
    async (agentId: string) => {
      const reqId = (llmHistoryReqIdRef.current += 1);
      try {
        const res = await api<{ llmHistory: string }>(`/api/agents/${agentId}`);
        if (reqId !== llmHistoryReqIdRef.current) return;
        setLlmHistory(res.llmHistory ?? "");
      } catch (e) {
        if (reqId !== llmHistoryReqIdRef.current) return;
        setLlmHistory(
          e instanceof Error ? `(failed to load llm_history: ${e.message})` : "(failed to load llm_history)"
        );
      }
    },
    []
  );

  const llmHistoryParsed = useMemo(() => {
    if (!llmHistory) return null;
    try {
      return JSON.parse(llmHistory);
    } catch {
      return null;
    }
  }, [llmHistory]);

  const llmHistoryFormatted = useMemo(() => {
    if (!llmHistory) return "";
    return formatLlmHistory(llmHistory);
  }, [formatLlmHistory, llmHistory]);

  const bootstrap = useCallback(async (overrideWorkspaceId: string | null) => {
    setError(null);
    setAgentError(null);
    setStatus("boot");

    setGroups([]);
    setMessages([]);
    setLlmHistory("");
    esRef.current?.close();

    if (overrideWorkspaceId) {
      const ensured = await api<WorkspaceDefaults>(
        `/api/workspaces/${overrideWorkspaceId}/defaults`
      );
      saveSession(ensured);
      setSession(ensured);
      setActiveGroupId(ensured.defaultGroupId);
      setStatus("idle");
      void refreshAgents(ensured);
      return;
    }

    const existing = loadSession();
    if (existing) {
      try {
        const ensured = await api<WorkspaceDefaults>(
          `/api/workspaces/${existing.workspaceId}/defaults`
        );
        saveSession(ensured);
        setSession(ensured);
        setActiveGroupId(ensured.defaultGroupId);
        setStatus("idle");
        void refreshAgents(ensured);
        return;
      } catch {
        // fall through
      }
    }

    try {
      const recent = await api<{
        workspaces: Array<{ id: string; name: string; createdAt: string }>;
      }>(`/api/workspaces`);
      if (recent.workspaces.length > 0) {
        const targetId = recent.workspaces[0]!.id;
        const ensured = await api<WorkspaceDefaults>(
          `/api/workspaces/${targetId}/defaults`
        );
        saveSession(ensured);
        setSession(ensured);
        setActiveGroupId(ensured.defaultGroupId);
        setStatus("idle");
        void refreshAgents(ensured);
        return;
      }
    } catch {
      // fall through
    }

    const created = await api<WorkspaceDefaults>(`/api/workspaces`, {
      method: "POST",
      body: JSON.stringify({ name: "Default Workspace" }),
    });
    saveSession(created);
    setSession(created);
    setActiveGroupId(created.defaultGroupId);
    setStatus("idle");
    void refreshAgents(created);
  }, [refreshAgents]);

  const createWorkspace = useCallback(async (name?: string) => {
    setError(null);
    setAgentError(null);
    setStatus("boot");
    const created = await api<WorkspaceDefaults>(`/api/workspaces`, {
      method: "POST",
      body: JSON.stringify({ name: name?.trim() || "New Workspace" }),
    });
    saveSession(created);
    setSession(created);
    setActiveGroupId(created.defaultGroupId);
    setStatus("idle");
    window.history.replaceState(null, "", "/im");
    void refreshAgents(created);
    return created;
  }, [refreshAgents]);

  // Load token limit config on mount
  useEffect(() => {
    api<{ tokenLimit: number }>("/api/config")
      .then((c) => setTokenLimit(c.tokenLimit))
      .catch(() => setTokenLimit(100000));
  }, []);

  const refreshGroups = useCallback(async (s: WorkspaceDefaults, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setStatus("groups");
    const q = new URLSearchParams({ workspaceId: s.workspaceId, agentId: s.humanAgentId });
    const { groups } = await api<{ groups: Group[] }>(`/api/groups?${q.toString()}`);
    setGroups(groups);
    if (!opts?.silent) setStatus("idle");
  }, []);

  const refreshMessages = useCallback(
    async (
      s: WorkspaceDefaults,
      groupId: string,
      opts?: { markRead?: boolean; silent?: boolean; skipGroupRefresh?: boolean }
    ) => {
      if (!opts?.silent) setStatus("messages");
      const q = new URLSearchParams();
      if (opts?.markRead ?? true) q.set("markRead", "true");
      q.set("readerId", s.humanAgentId);
      const suffix = q.size ? `?${q.toString()}` : "";
      const { messages } = await api<{ messages: Message[] }>(
        `/api/groups/${groupId}/messages${suffix}`
      );
      setMessages(messages);
      if (!opts?.silent) setStatus("idle");
      if (!opts?.skipGroupRefresh) {
        void refreshGroups(s, { silent: opts?.silent });
      }
      queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    },
    [refreshGroups]
  );

  const pushVizEvent = useCallback(
    (event: UiStreamEvent, label: string, kind: VizEvent["kind"]) => {
      const at = typeof event.at === "number" ? event.at : Date.now();
      const id = `${event.id ?? at}-${Math.random().toString(16).slice(2)}`;
      setVizEvents((prev) => [...prev, { id, kind, label, at }].slice(-20));
    },
    []
  );

  const pushBeam = useCallback((beam: Omit<VizBeam, "id" | "createdAt">) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const createdAt = Date.now();
    setVizBeams((prev) => [...prev, { ...beam, id, createdAt }].slice(-12));
    const timeoutId = window.setTimeout(() => {
      setVizBeams((prev) => prev.filter((b) => b.id !== id));
    }, 2400);
    beamTimeoutsRef.current.push(timeoutId);
  }, []);

  const logVizDebug = useCallback((entry: Omit<VizDebugEntry, "id" | "at">) => {
    const record: VizDebugEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: Date.now(),
    };
    setVizDebug((prev) => [...prev, record].slice(-200));
    if (typeof window !== "undefined") {
      (window as any).__imVizDebug = (window as any).__imVizDebug ?? [];
      (window as any).__imVizDebug.push(record);
      // eslint-disable-next-line no-console
      console.debug("[im-viz]", record);
    }
  }, []);

  const scheduleWorkspaceRefresh = useCallback(
    (opts?: { groups?: boolean; agents?: boolean; messages?: boolean; llmHistory?: boolean }) => {
      if (!session) return;
      const pending = refreshQueueRef.current.pending;
      pending.groups = opts?.groups ?? true;
      pending.agents = opts?.agents ?? true;
      pending.messages = opts?.messages ?? true;
      pending.llmHistory = opts?.llmHistory ?? true;

      if (refreshQueueRef.current.timer !== null) return;
      refreshQueueRef.current.timer = window.setTimeout(() => {
        const next = refreshQueueRef.current.pending;
        refreshQueueRef.current.pending = {
          groups: false,
          agents: false,
          messages: false,
          llmHistory: false,
        };
        refreshQueueRef.current.timer = null;

        if (next.groups) void refreshGroups(session, { silent: true });
        if (next.agents) void refreshAgents(session);
        if (next.llmHistory && streamAgentIdValueRef.current) {
          void refreshLlmHistory(streamAgentIdValueRef.current);
        }
        if (next.messages && activeGroupIdRef.current) {
          void refreshMessages(session, activeGroupIdRef.current, {
            markRead: false,
            silent: true,
            skipGroupRefresh: true,
          });
        }
      }, 200);
    },
    [refreshAgents, refreshGroups, refreshLlmHistory, refreshMessages, session]
  );

  const syncToolCards = useCallback(() => {
    const cards = [...toolCardMapRef.current.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    setToolCards(cards);
  }, []);

  const updateToolCard = useCallback(
    (input: {
      key: string;
      sourceTag: string;
      toolName: string;
      status: ToolCardStatus;
      detail: string;
      toolCallId?: string;
      args?: unknown;
      result?: unknown;
      rawEvent?: Record<string, unknown>;
      metrics?: Record<string, unknown>;
      eventName?: string;
    }) => {
      const current = toolCardMapRef.current.get(input.key);
      const next: ToolCard = {
        key: input.key,
        sourceTag: input.sourceTag,
        toolName: input.toolName,
        status: input.status,
        detail: input.detail,
        updatedAt: Date.now(),
        toolCallId: input.toolCallId,
        args: input.args,
        result: input.result,
        rawEvent: input.rawEvent,
        metrics: input.metrics,
        eventName: input.eventName,
      };
      toolCardMapRef.current.set(input.key, next);

      if (!current) {
        syncToolCards();
        return;
      }

      if (
        current.status !== next.status ||
        current.detail !== next.detail ||
        current.sourceTag !== next.sourceTag ||
        current.toolName !== next.toolName ||
        current.toolCallId !== next.toolCallId ||
        current.args !== next.args ||
        current.result !== next.result ||
        current.rawEvent !== next.rawEvent ||
        current.metrics !== next.metrics ||
        current.eventName !== next.eventName
      ) {
        syncToolCards();
      }
    },
    [syncToolCards]
  );

  const clearToolState = useCallback(() => {
    setToolStream("");
    toolCallBuffersRef.current = new Map();
    toolResultBuffersRef.current = new Map();
    toolCardMapRef.current = new Map();
    setToolCards([]);
  }, []);

  const rebuildMergedMarkdown = useCallback((map: Map<string, string>) => {
    const entries = [...map.entries()].filter(([, text]) => text.trim().length > 0);
    if (entries.length === 0) return "";
    return entries
      .map(([source, text]) => {
        const parsedKey = parseBlockScopedBufferKey(source);
        const parsed = parseSourceBufferKey(parsedKey.sourceKey);
        const heading = parsed.outerToolCallId
          ? `${parsed.sourceTag} (task: ${parsed.outerToolCallId.slice(0, 8)})`
          : parsed.sourceTag;
        return `### ${heading}\n\n${text}`;
      })
      .join("\n\n---\n\n");
  }, []);

  const filteredContentStream = useMemo(() => {
    if (!selectedAgentId) return contentStream;
    const filtered = new Map<string, string>();
    for (const [source, text] of contentBySourceRef.current.entries()) {
      const parsedKey = parseBlockScopedBufferKey(source);
      const parsed = parseSourceBufferKey(parsedKey.sourceKey);
      const agentId = inferAgentIdFromSourceTag(parsed.sourceTag);
      if (agentId === selectedAgentId) filtered.set(source, text);
    }
    return rebuildMergedMarkdown(filtered);
  }, [contentStream, inferAgentIdFromSourceTag, rebuildMergedMarkdown, selectedAgentId]);

  const filteredReasoningStream = useMemo(() => {
    if (!selectedAgentId) return reasoningStream;
    const filtered = new Map<string, string>();
    for (const [source, text] of reasoningBySourceRef.current.entries()) {
      const parsedKey = parseBlockScopedBufferKey(source);
      const parsed = parseSourceBufferKey(parsedKey.sourceKey);
      const agentId = inferAgentIdFromSourceTag(parsed.sourceTag);
      if (agentId === selectedAgentId) filtered.set(source, text);
    }
    return rebuildMergedMarkdown(filtered);
  }, [inferAgentIdFromSourceTag, reasoningStream, rebuildMergedMarkdown, selectedAgentId]);

  const filteredToolCards = useMemo(() => {
    if (!selectedAgentId) return toolCards;
    return toolCards.filter((card) => inferAgentIdFromSourceTag(card.sourceTag) === selectedAgentId);
  }, [inferAgentIdFromSourceTag, selectedAgentId, toolCards]);

  const filteredTimelineItems = useMemo(() => {
    const sortedMessages = [...messages].sort((a, b) => {
      const atA = Date.parse(a.sendTime);
      const atB = Date.parse(b.sendTime);
      if (Number.isFinite(atA) && Number.isFinite(atB) && atA !== atB) return atA - atB;
      return a.id.localeCompare(b.id);
    });

    const historyItems: StreamTimelineItem[] = sortedMessages.map((message, index) => ({
      id: `history-${message.id}`,
      seq: -1_000_000 + index,
      mergeKey: `history-${message.id}`,
      at: Number.isFinite(Date.parse(message.sendTime)) ? Date.parse(message.sendTime) : Date.now() + index,
      lane: "message",
      sourceTag: `[message:${agentRoleById.get(message.senderId) ?? message.senderId.slice(0, 8)}]`,
      agentId: message.senderId,
      title: agentRoleById.get(message.senderId) ?? message.senderId.slice(0, 8),
      text: message.content,
    }));

    const merged = [...historyItems, ...streamTimeline].sort((a, b) => {
      if (a.at !== b.at) return a.at - b.at;
      return a.seq - b.seq;
    });

    if (!selectedAgentId) return merged;

    const humanId = session?.humanAgentId ?? null;
    const selectedRole = vizAgents.find((agent) => agent.id === selectedAgentId)?.role ?? null;
    const selectedRoleKey = selectedRole ? normalizeAgentLabel(selectedRole) : null;
    return merged.filter((item) => {
      if (item.agentId === selectedAgentId) return true;
      if (!!humanId && item.agentId === humanId) return true;
      const taskId = item.outerToolCallId ?? taskIdFromSourceTag(item.sourceTag);
      if (!taskId || !selectedRoleKey) return false;
      const mappedName = taskAssignmentNameByOuterCallRef.current.get(taskId);
      return !!mappedName && normalizeAgentLabel(mappedName) === selectedRoleKey;
    });
  }, [agentRoleById, messages, selectedAgentId, session?.humanAgentId, streamTimeline, vizAgents]);

  const timelineItemById = useMemo(() => {
    const map = new Map<string, StreamTimelineItem>();
    filteredTimelineItems.forEach((item) => map.set(item.id, item));
    return map;
  }, [filteredTimelineItems]);

  const taskScopedTitles = useMemo<TaskScopedTitleMap>(() => {
    const map: TaskScopedTitleMap = new Map();
    for (const item of filteredTimelineItems) {
      if (!item.outerToolCallId) continue;
      const mappedName = taskAssignmentNameByOuterCallRef.current.get(item.outerToolCallId);
      if (mappedName) map.set(item.outerToolCallId, mappedName);
      if (item.toolName) map.set(item.outerToolCallId, item.toolName);
      else if (item.title && item.title !== "[agent]") map.set(item.outerToolCallId, item.title);
    }
    return map;
  }, [filteredTimelineItems]);

  const sourceRenderStates = useMemo<SourceRenderState[]>(() => {
    const grouped = new Map<string, StreamTimelineItem[]>();
    for (const item of filteredTimelineItems) {
      if (item.lane === "message") continue;
      const sourceBufferKey = makeSourceBufferKey(item.sourceTag, item.outerToolCallId);
      const groupKey = `${sourceBufferKey}::${item.agentId ?? "unknown"}`;
      const bucket = grouped.get(groupKey) ?? [];
      bucket.push(item);
      grouped.set(groupKey, bucket);
    }

    const states: SourceRenderState[] = [];
    for (const [, timelineItems] of grouped.entries()) {
      const latest = timelineItems[timelineItems.length - 1];
      const sourceTag = latest?.sourceTag || "[agent]";
      const subagentName = parseSubagentLabel(sourceTag);
      const taskScoped = isTaskScopedSourceTag(sourceTag);
      const sourceKey = makeSourceBufferKey(sourceTag, latest?.outerToolCallId);
      states.push({
        sourceTag,
        sourceKey,
        agentId: latest?.agentId ?? null,
        title:
          subagentName ??
          (taskScoped && latest?.outerToolCallId ? taskScopedTitles.get(latest.outerToolCallId) ?? `Task ${latest.outerToolCallId.slice(0, 8)}` : parseAgentDisplayLabel(sourceTag, "Assistant")),
        isSubagent: !!subagentName || taskScoped,
        outerToolCallId: latest?.outerToolCallId,
        content: collectBlockScopedBuffer(contentBySourceRef.current, sourceKey, "content"),
        reasoning: collectBlockScopedBuffer(reasoningBySourceRef.current, sourceKey, "reasoning"),
        toolItems: timelineItems.filter((entry) => entry.lane === "tool_call" || entry.lane === "tool_result"),
        timelineItems,
        firstAt: timelineItems[0]?.at ?? latest?.at ?? Date.now(),
        lastAt: latest?.at ?? Date.now(),
      });
    }

    return states.sort((a, b) => a.firstAt - b.firstAt);
  }, [filteredTimelineItems, taskScopedTitles]);

  const chatFeedItems = useMemo<ChatFeedItem[]>(() => {
    const items: ChatFeedItem[] = [];
    const humanId = session?.humanAgentId ?? null;

    for (const item of filteredTimelineItems) {
      if (item.lane === "message") {
        const isHuman = !!humanId && item.agentId === humanId;
        items.push({
          id: `feed-${item.id}`,
          kind: isHuman ? "human" : "assistant",
          title: isHuman ? "你" : item.title,
          content: item.text,
          at: item.at,
          sourceTag: item.sourceTag,
          agentId: item.agentId,
          rawEvent: item.rawEvent,
          linkedTimelineIds: [item.id],
        });
      }
    }

    for (const state of sourceRenderStates) {
      const linkedTimelineIds = state.timelineItems.map((entry) => entry.id);
      const lastToolItem = [...state.toolItems].reverse()[0];

      if (state.isSubagent) {
        const toolCount = state.toolItems.length;
        items.push({
          id: `feed-subagent-${state.sourceKey}`,
          kind: "compact",
          title: state.title,
          compactLabel: `子代理任务｜${state.title}`,
          preview:
            toolCount > 0
              ? `已记录 ${toolCount} 个工具调用，点击查看任务流`
              : state.content.trim()
                ? "已生成子代理结果，点击查看任务流"
                : state.reasoning.trim()
                  ? "子代理正在思考，点击查看任务流"
                  : "点击查看任务流",
          at: state.firstAt,
          sourceTag: state.sourceTag,
          agentId: state.agentId,
          rawEvent: state.timelineItems[state.timelineItems.length - 1]?.rawEvent,
          linkedTimelineIds,
        });
        continue;
      }

      if (!state.isSubagent && state.content.trim()) {
        items.push({
          id: `feed-assistant-${state.sourceKey}`,
          kind: "assistant",
          title: state.title,
          content: state.content,
          at: state.firstAt,
          sourceTag: state.sourceTag,
          agentId: state.agentId,
          rawEvent: state.timelineItems[state.timelineItems.length - 1]?.rawEvent,
          linkedTimelineIds,
        });
      }

      if (!state.isSubagent && state.reasoning.trim()) {
        items.push({
          id: `feed-reasoning-${state.sourceKey}`,
          kind: "compact",
          title: state.title,
          compactLabel: "深度思考",
          preview: "点击查看完整思考过程",
          at: state.firstAt,
          sourceTag: state.sourceTag,
          agentId: state.agentId,
          rawEvent: state.timelineItems.find((entry) => entry.lane === "reasoning")?.rawEvent,
          linkedTimelineIds,
        });
      }

      if (!state.isSubagent && lastToolItem) {
        items.push({
          id: `feed-tool-${state.sourceKey}-${lastToolItem.toolCallId ?? lastToolItem.id}`,
          kind: "compact",
          title: lastToolItem.title,
          compactLabel: `工具调用｜${lastToolItem.toolName || lastToolItem.title || "tool"}`,
          preview: lastToolItem.status === "error" ? (lastToolItem.text || "执行失败") : lastToolItem.status === "started" ? "执行中" : "已完成",
          at: lastToolItem.at,
          status: lastToolItem.status ?? "completed",
          sourceTag: state.sourceTag,
          agentId: state.agentId,
          toolCallId: lastToolItem.toolCallId,
          rawEvent: lastToolItem.rawEvent,
          linkedTimelineIds,
        });
      }
    }

    return items.sort((a, b) => a.at - b.at);
  }, [filteredTimelineItems, session?.humanAgentId, sourceRenderStates]);

  const selectedFeedItem = useMemo(
    () => (selectedFeedItemId ? chatFeedItems.find((item) => item.id === selectedFeedItemId) ?? null : null),
    [chatFeedItems, selectedFeedItemId]
  );

  const selectedExecutionItems = useMemo(() => {
    if (!selectedFeedItem) return filteredTimelineItems;
    const ids = new Set(selectedFeedItem.linkedTimelineIds);
    return filteredTimelineItems.filter((item) => {
      if (ids.has(item.id)) return true;
      if (selectedFeedItem.toolCallId && item.toolCallId === selectedFeedItem.toolCallId) return true;
      const selectedOuter = selectedFeedItem.rawEvent && typeof selectedFeedItem.rawEvent === "object" ? (selectedFeedItem.rawEvent as Record<string, unknown>).tool_call_id : undefined;
      if (typeof selectedOuter === "string" && item.outerToolCallId === selectedOuter) return true;
      if (selectedFeedItem.agentId && item.agentId === selectedFeedItem.agentId) return true;
      if (selectedFeedItem.sourceTag && item.sourceTag === selectedFeedItem.sourceTag) return true;
      return false;
    });
  }, [filteredTimelineItems, selectedFeedItem]);

  const taskFlowStates = useMemo(() => sourceRenderStates.filter((state) => state.isSubagent), [sourceRenderStates]);

  const selectedTaskFlowState = useMemo(() => {
    if (selectedFeedItemId) {
      const matched = taskFlowStates.find((state) => `feed-subagent-${state.sourceKey}` === selectedFeedItemId);
      if (matched) return matched;
    }
    return taskFlowStates[0] ?? null;
  }, [selectedFeedItemId, taskFlowStates]);

  const openArtifactPreview = useCallback(async (artifact: ArtifactReference) => {
    setShowExecutionDrawer(true);
    setArtifactPreview({ artifact, loading: artifact.kind !== "url", error: null, content: "", contentType: "" });

    if (artifact.kind === "url") {
      setArtifactPreview({ artifact, loading: false, error: null, content: artifact.value, contentType: "url" });
      return;
    }

    try {
      const res = await fetch(withBackendOrigin(`/api/file-preview?path=${encodeURIComponent(artifact.value)}`), { cache: "no-store" });
      const payload = (await res.json()) as { ok?: boolean; content?: string; contentType?: string; error?: string };
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to preview artifact");
      }
      setArtifactPreview({
        artifact,
        loading: false,
        error: null,
        content: payload.content || "",
        contentType: payload.contentType || "text/plain",
      });
    } catch (error) {
      setArtifactPreview({
        artifact,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        content: "",
        contentType: "",
      });
    }
  }, []);

  const appendContentFromSource = useCallback(
    (sourceTag: string | undefined, text: string, outerToolCallId?: string) => {
      if (!text) return;
      const baseSource = makeSourceBufferKey(sourceTag, outerToolCallId);
      const blockIndex = contentBlockIndexRef.current.get(baseSource) ?? 0;
      const source = makeBlockScopedBufferKey(sourceTag, outerToolCallId, "content", blockIndex);
      const prev = contentBySourceRef.current.get(source) ?? "";
      contentBySourceRef.current.set(source, `${prev}${text}`);
      setContentStream(rebuildMergedMarkdown(contentBySourceRef.current));
    },
    [rebuildMergedMarkdown]
  );

  const appendReasoningFromSource = useCallback(
    (sourceTag: string | undefined, text: string, outerToolCallId?: string) => {
      if (!text) return;
      const baseSource = makeSourceBufferKey(sourceTag, outerToolCallId);
      const blockIndex = reasoningBlockIndexRef.current.get(baseSource) ?? 0;
      const source = makeBlockScopedBufferKey(sourceTag, outerToolCallId, "reasoning", blockIndex);
      const prev = reasoningBySourceRef.current.get(source) ?? "";
      reasoningBySourceRef.current.set(source, `${prev}${text}`);
      setReasoningStream(rebuildMergedMarkdown(reasoningBySourceRef.current));
    },
    [rebuildMergedMarkdown]
  );

  const flushDebugEvents = useCallback(async () => {
    const batch = debugEventBufferRef.current;
    if (batch.length === 0) return;
    debugEventBufferRef.current = [];
    try {
      await fetch(withBackendOrigin("/api/debug/stream-log"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: debugSessionIdRef.current,
          events: batch,
        }),
      });
    } catch {
      // keep non-blocking for UI
    }
  }, []);

  const queueDebugEvent = useCallback(
    (rawEvent: unknown, normalizedEvent: unknown, streamAgentId: string | null) => {
      if (isReplayMode) return;
      debugEventBufferRef.current.push({
        at: Date.now(),
        sessionId: debugSessionIdRef.current,
        streamAgentId,
        rawEvent,
        normalizedEvent,
      });

      if (debugEventBufferRef.current.length >= 20) {
        void flushDebugEvents();
        return;
      }

      if (debugFlushTimerRef.current !== null) return;
      debugFlushTimerRef.current = window.setTimeout(() => {
        debugFlushTimerRef.current = null;
        void flushDebugEvents();
      }, 250);
    },
    [flushDebugEvents, isReplayMode]
  );

  useEffect(() => {
    return () => {
      if (debugFlushTimerRef.current !== null) {
        window.clearTimeout(debugFlushTimerRef.current);
        debugFlushTimerRef.current = null;
      }
      void flushDebugEvents();
    };
  }, [flushDebugEvents]);

  const resetStreamTextBuffers = useCallback(() => {
    contentBySourceRef.current = new Map();
    reasoningBySourceRef.current = new Map();
    contentBlockIndexRef.current = new Map();
    reasoningBlockIndexRef.current = new Map();
    setContentStream("");
    setReasoningStream("");
  }, []);

  const clearCurrentRunBuffers = useCallback((options?: { preserveTextBuffers?: boolean; preserveRawEvents?: boolean }) => {
    if (!options?.preserveTextBuffers) {
      resetStreamTextBuffers();
    }
    clearToolState();
    if (!options?.preserveRawEvents) {
      rawApiEventLogRef.current = [];
    }
    contentSegmentKeyRef.current = null;
    reasoningSegmentKeyRef.current = null;
    modelRequestSeqByRunRef.current = new Map();
    lastReasoningSeqRef.current = null;
  }, [clearToolState, resetStreamTextBuffers]);

  const clearRealtimeState = useCallback(() => {
    clearCurrentRunBuffers();
    resetTurnWorkflow(null);
    suspendTimelinePersistRef.current = true;
    setStreamTimeline([]);
    timelineCounterRef.current = 0;
    setCollapsedReasoningUntilSeq(-1);
  }, [clearCurrentRunBuffers, resetTurnWorkflow]);

  const resolveEventTimestamp = useCallback((rawPayload: RawAgnoEvent | AgentStreamEvent, payload: AgentStreamEvent) => {
    const rawCreatedAt = (rawPayload as Record<string, unknown>).created_at;
    if (typeof rawCreatedAt === "number" && Number.isFinite(rawCreatedAt)) return rawCreatedAt * 1000;
    return payload.at;
  }, []);

  const processIncomingRawStreamEvent = useCallback(
    (rawPayload: RawAgnoEvent | AgentStreamEvent) => {
      try {
        const payload = normalizeIncomingAgentSseEvent(rawPayload as RawAgnoEvent);
        if (!payload) return;
        pushRawApiEvent(rawPayload);
        queueDebugEvent(rawPayload, payload, streamAgentIdRef.current);
        if (payload.event === "agent.stream") {
          const normalized = normalizeAgentStreamChunk(payload.data as Record<string, any>);
          const chunk = normalized.chunk;
          const streamEvent = typeof payload.data.event === "string" ? payload.data.event : "";
          const runId =
            typeof payload.data.run_id === "string" && payload.data.run_id
              ? payload.data.run_id
              : "[no-run]";
          const currentSeq = modelRequestSeqByRunRef.current.get(runId) ?? 0;

          const streamData = payload.data as Record<string, unknown>;
          const streamMeta =
            streamData.metadata && typeof streamData.metadata === "object"
              ? (streamData.metadata as Record<string, unknown>)
              : {};
          const streamRawEvent =
            streamMeta.raw_event && typeof streamMeta.raw_event === "object"
              ? (streamMeta.raw_event as Record<string, unknown>)
              : {};
          const streamMetaTool =
            streamMeta.tool && typeof streamMeta.tool === "object"
              ? (streamMeta.tool as Record<string, unknown>)
              : {};
          const streamRawTool =
            streamRawEvent.tool && typeof streamRawEvent.tool === "object"
              ? (streamRawEvent.tool as Record<string, unknown>)
              : {};
          const eventAt = resolveEventTimestamp(rawPayload, payload);
          const source =
            (typeof streamData.source === "string" ? streamData.source : "") ||
            (typeof streamMeta.source === "string" ? (streamMeta.source as string) : "") ||
            (typeof streamRawEvent.source === "string" ? (streamRawEvent.source as string) : "");
          const subagentName =
            (typeof streamData.subagent_name === "string" ? streamData.subagent_name : "") ||
            (typeof streamMeta.subagent_name === "string" ? (streamMeta.subagent_name as string) : "") ||
            (typeof streamRawEvent.subagent_name === "string" ? (streamRawEvent.subagent_name as string) : "") ||
            (typeof streamData.agent_name === "string" ? streamData.agent_name : "") ||
            (typeof streamMeta.agent_name === "string" ? (streamMeta.agent_name as string) : "");
          const resolvedSource = source || (subagentName ? "subagent" : "");
          const subagentId =
            (typeof streamData.agent_id === "string" ? streamData.agent_id : "") ||
            (typeof streamMeta.agent_id === "string" ? (streamMeta.agent_id as string) : "") ||
            (typeof streamRawEvent.agent_id === "string" ? (streamRawEvent.agent_id as string) : "");
          const callId =
            (typeof streamRawTool.tool_call_id === "string" ? (streamRawTool.tool_call_id as string) : "") ||
            (typeof streamMetaTool.tool_call_id === "string" ? (streamMetaTool.tool_call_id as string) : "") ||
            (typeof streamData.tool_call_id === "string" ? streamData.tool_call_id : "") ||
            (typeof streamMeta.tool_call_id === "string" ? (streamMeta.tool_call_id as string) : "") ||
            (typeof streamRawEvent.tool_call_id === "string" ? (streamRawEvent.tool_call_id as string) : "") ||
            "[no-call]";
          const outerToolCallId =
            typeof streamData.tool_call_id === "string" && streamData.tool_call_id
              ? streamData.tool_call_id
              : undefined;
          const resolvedAgentId = subagentId || (typeof streamData.agent_id === "string" ? streamData.agent_id : "") || null;
          const effectiveSourceTag =
            resolvedSource === "subagent"
              ? (normalized.sourceTag || `[subagent:${subagentName || "unknown"}]`)
              : streamEvent === "CustomEvent" && outerToolCallId
                ? `[task:${outerToolCallId}]`
                : normalized.sourceTag;

          const canonicalWorkflow = canonicalizeWorkflowEvent({
            payloadData: payload.data,
            rawPayload,
          });
          ingestTurnWorkflowEvent(canonicalWorkflow);

          if (resolvedSource === "subagent" && subagentId) {
            if (normalized.sourceTag) {
              sourceTagAgentIdRef.current.set(normalized.sourceTag, subagentId);
            }
            const parentAgentId = streamAgentIdRef.current;
            registerDerivedAgent({
              id: subagentId,
              role: subagentName,
              parentId: parentAgentId || null,
            });

            if (parentAgentId && parentAgentId !== subagentId) {
              const createKey = `${parentAgentId}->${subagentId}`;
              if (!derivedCreateEdgeRef.current.has(createKey)) {
                derivedCreateEdgeRef.current.add(createKey);
                pushBeam({ fromId: parentAgentId, toId: subagentId, kind: "create", label: subagentName });
              }
            }

            const now = Date.now();
            const throttleKey = `${subagentId}:${callId}:${streamEvent || normalized.kind}`;
            const prevAt = subagentVizThrottleRef.current.get(throttleKey) ?? 0;
            if (now - prevAt > 800) {
              subagentVizThrottleRef.current.set(throttleKey, now);
              pushVizEvent(
                {
                  id: now,
                  at: now,
                  event: "ui.agent.subagent.stream",
                  data: {
                    agentId: subagentId,
                    subagentName,
                    kind: normalized.kind,
                    streamEvent,
                  },
                },
                `子代理流: ${subagentName}`,
                "message"
              );

              const currentAgentId = streamAgentIdRef.current;
              if (currentAgentId && currentAgentId !== subagentId) {
                pushBeam({ fromId: subagentId, toId: currentAgentId, kind: "message", label: `${subagentName}:${streamEvent || normalized.kind}` });
              }
            }
          } else {
            const mainAgentId =
              (typeof streamData.agent_id === "string" ? streamData.agent_id : "") ||
              (typeof streamMeta.agent_id === "string" ? (streamMeta.agent_id as string) : "") ||
              (typeof streamRawEvent.agent_id === "string" ? (streamRawEvent.agent_id as string) : "");
            const mainAgentName =
              (typeof streamData.agent_name === "string" ? streamData.agent_name : "") ||
              (typeof streamMeta.agent_name === "string" ? (streamMeta.agent_name as string) : "") ||
              (typeof streamRawEvent.agent_name === "string" ? (streamRawEvent.agent_name as string) : "");
            const parentAgentId =
              (typeof streamData.parent_agent_id === "string" ? streamData.parent_agent_id : "") ||
              (typeof streamMeta.parent_agent_id === "string" ? (streamMeta.parent_agent_id as string) : "") ||
              (typeof streamRawEvent.parent_agent_id === "string" ? (streamRawEvent.parent_agent_id as string) : "");
            if (mainAgentId) {
              sourceTagAgentIdRef.current.set("[agent]", mainAgentId);
              registerDerivedAgent({
                id: mainAgentId,
                role: mainAgentName || mainAgentId.slice(0, 8),
                parentId: parentAgentId || null,
              });
            }
          }

          const seq = modelRequestSeqByRunRef.current.get(runId) ?? 0;
          const sourceBufferKey = makeSourceBufferKey(effectiveSourceTag, outerToolCallId);
          const segmentKey = `${runId}:${seq}:${sourceBufferKey}`;
          const contentBlockIndex = contentBlockIndexRef.current.get(sourceBufferKey) ?? 0;
          const reasoningBlockIndex = reasoningBlockIndexRef.current.get(sourceBufferKey) ?? 0;

          if (streamEvent === "RunStarted") {
            resetStreamTextBuffers();
            clearToolState();
            modelRequestSeqByRunRef.current.set(runId, 0);
            contentSegmentKeyRef.current = null;
            reasoningSegmentKeyRef.current = null;
            appendTimelineItem({
              mergeKey: `${runId}:boundary:start`,
              at: eventAt,
              lane: "status",
              sourceTag: effectiveSourceTag || "[agent]",
              agentId: inferAgentIdFromSourceTag(effectiveSourceTag || "[agent]") ?? resolvedAgentId,
              eventName: streamEvent,
              title: "Run",
              text: "—— 对话开始 ——",
            });
            return;
          }

          if (streamEvent === "ModelRequestStarted") {
            modelRequestSeqByRunRef.current.set(runId, currentSeq + 1);
            contentSegmentKeyRef.current = null;
            reasoningSegmentKeyRef.current = null;
            return;
          }

          if (streamEvent === "ModelRequestCompleted") {
            return;
          }

          if (chunk) {
            const lastProcessedKind = lastProcessedKindByScopeRef.current.get(sourceBufferKey);
            const currentKind = normalized.kind;
            const isFromReasoning = lastProcessedKind === "reasoning" || lastProcessedKind === "thinking";
            const isFromContent = lastProcessedKind === "content" || lastProcessedKind === "citation" || lastProcessedKind === "document";
            const isToReasoning = currentKind === "reasoning" || currentKind === "thinking";
            const isToContent = currentKind === "content" || currentKind === "citation" || currentKind === "document";
            if ((isFromReasoning && isToContent) || (isFromContent && isToReasoning)) {
              const nextContentBlock = (contentBlockIndexRef.current.get(sourceBufferKey) ?? 0) + 1;
              const nextReasoningBlock = (reasoningBlockIndexRef.current.get(sourceBufferKey) ?? 0) + 1;
              contentBlockIndexRef.current.set(sourceBufferKey, nextContentBlock);
              reasoningBlockIndexRef.current.set(sourceBufferKey, nextReasoningBlock);
            }
            lastProcessedKindByScopeRef.current.set(sourceBufferKey, currentKind);
            const updatedContentBlockIndex = contentBlockIndexRef.current.get(sourceBufferKey) ?? 0;
            const updatedReasoningBlockIndex = reasoningBlockIndexRef.current.get(sourceBufferKey) ?? 0;

            if (
              currentKind === "content" ||
              currentKind === "citation" ||
              currentKind === "document"
            ) {
              const sanitized = sanitizeDisplayChunk(chunk);
              appendContentFromSource(effectiveSourceTag, sanitized, outerToolCallId);
              if (sanitized) {
                appendTimelineItem({
                  mergeKey: `${segmentKey}:content:${updatedContentBlockIndex}`,
                  at: eventAt,
                  lane: "content",
                  sourceTag: effectiveSourceTag || "[agent]",
                  agentId: inferAgentIdFromSourceTag(effectiveSourceTag || "[agent]") ?? resolvedAgentId,
                  outerToolCallId,
                  eventName: streamEvent,
                  title: effectiveSourceTag || "[agent]",
                  text: sanitized,
                });
                const lastReasonSeq = lastReasoningSeqRef.current;
                if (lastReasonSeq != null) {
                  setCollapsedReasoningUntilSeq((prev) => Math.max(prev, lastReasonSeq));
                  lastReasoningSeqRef.current = null;
                }
              }
              contentSegmentKeyRef.current = segmentKey;
            } else if (currentKind === "reasoning" || currentKind === "thinking") {
              appendReasoningFromSource(effectiveSourceTag, chunk, outerToolCallId);
              const reasonSeq = appendTimelineItem({
                mergeKey: `${segmentKey}:reasoning:${updatedReasoningBlockIndex}`,
                at: eventAt,
                lane: "reasoning",
                sourceTag: effectiveSourceTag || "[agent]",
                agentId: inferAgentIdFromSourceTag(effectiveSourceTag || "[agent]") ?? resolvedAgentId,
                outerToolCallId,
                eventName: streamEvent,
                title: effectiveSourceTag || "[agent]",
                text: chunk,
              });
              lastReasoningSeqRef.current = reasonSeq;
              reasoningSegmentKeyRef.current = segmentKey;
            } else if (currentKind === "tool_calls" || currentKind === "tool_result") {
              const name =
                (payload.data.tool_call_name ?? payload.data.tool_call_id ?? normalized.key ?? "tool_call") as string;
              const sourceTag = effectiveSourceTag || "[agent]";
              const sourceBufferKey = makeSourceBufferKey(sourceTag, outerToolCallId);
              const key = `${sourceBufferKey}:${String(payload.data.tool_call_id ?? normalized.key ?? name)}`;
              const buffers =
                normalized.kind === "tool_result"
                  ? toolResultBuffersRef.current
                  : toolCallBuffersRef.current;
              const sourcePrefix = normalized.sourceTag ? `${normalized.sourceTag} ` : "";
              const existing = buffers.get(key) ?? "";
              const next = existing.length > 0 ? `${existing}${chunk}` : `${sourcePrefix}${chunk}`;
              buffers.set(key, next);
              const callLines = Array.from(toolCallBuffersRef.current.entries()).map(
                ([id, value]) => `tool_calls[${id}]: ${value}`
              );
              const resultLines = Array.from(toolResultBuffersRef.current.entries()).map(
                ([id, value]) => `tool_result[${id}]: ${value}`
              );
              setToolStream([...callLines, ...resultLines].join("\n\n"));

              const parsedDelta = parseToolDeltaChunk(chunk);
              const parsedState = parsedDelta.state;
              const status: ToolCardStatus =
                parsedState ?? (currentKind === "tool_calls" ? "started" : "completed");
              const detail =
                parsedDelta.error ??
                parsedDelta.content ??
                (status === "started" ? "running" : chunk);
              const toolNameValue = parsedDelta.tool_name ?? name;
              if (toolNameValue === "assign_task" || toolNameValue === "create_subagent") {
                const assignedName = extractSubagentNameFromEventData(
                  streamData,
                  streamMeta,
                  streamRawEvent
                ) ?? extractAssignedSubagentName(
                  parsedDelta.args ?? streamRawTool.tool_args ?? streamMetaTool.tool_args ?? streamRawEvent.tool_args,
                  parsedDelta.raw ?? streamRawEvent
                );
                if (assignedName && outerToolCallId) {
                  taskAssignmentNameByOuterCallRef.current.set(outerToolCallId, assignedName);
                }
              }
              const toolContentBlock = contentBlockIndexRef.current.get(sourceBufferKey) ?? 0;
              const toolReasoningBlock = reasoningBlockIndexRef.current.get(sourceBufferKey) ?? 0;
              contentBlockIndexRef.current.set(sourceBufferKey, toolContentBlock + 1);
              reasoningBlockIndexRef.current.set(sourceBufferKey, toolReasoningBlock + 1);
              updateToolCard({
                key,
                sourceTag,
                toolName: parsedDelta.tool_name ?? name,
                status,
                detail,
                toolCallId: parsedDelta.tool_call_id ?? callId,
                args: parsedDelta.args ?? streamRawTool.tool_args ?? streamMetaTool.tool_args ?? streamRawEvent.tool_args,
                result: parsedDelta.result ?? streamRawTool.result ?? streamMetaTool.result ?? streamRawEvent.result,
                rawEvent: parsedDelta.raw ?? streamRawEvent,
                metrics:
                  parsedDelta.metrics ??
                  (streamRawTool.metrics && typeof streamRawTool.metrics === "object" ? (streamRawTool.metrics as Record<string, unknown>) : undefined) ??
                  (streamMetaTool.metrics && typeof streamMetaTool.metrics === "object" ? (streamMetaTool.metrics as Record<string, unknown>) : undefined) ??
                  (streamRawEvent.metrics && typeof streamRawEvent.metrics === "object" ? (streamRawEvent.metrics as Record<string, unknown>) : undefined),
                eventName: streamEvent,
              });
              appendTimelineItem({
                mergeKey: `${key}:${currentKind}`,
                at: eventAt,
                lane: currentKind === "tool_calls" ? "tool_call" : "tool_result",
                sourceTag,
                agentId: inferAgentIdFromSourceTag(sourceTag) ?? resolvedAgentId,
                outerToolCallId,
                eventName: streamEvent,
                title: parsedDelta.tool_name ?? name,
                text: detail,
                status,
                toolName: parsedDelta.tool_name ?? name,
                toolCallId: parsedDelta.tool_call_id ?? callId,
                args: parsedDelta.args ?? streamRawTool.tool_args ?? streamMetaTool.tool_args ?? streamRawEvent.tool_args,
                result: parsedDelta.result ?? streamRawTool.result ?? streamMetaTool.result ?? streamRawEvent.result,
                rawEvent: parsedDelta.raw ?? streamRawEvent,
                metrics:
                  parsedDelta.metrics ??
                  (streamRawTool.metrics && typeof streamRawTool.metrics === "object" ? (streamRawTool.metrics as Record<string, unknown>) : undefined) ??
                  (streamMetaTool.metrics && typeof streamMetaTool.metrics === "object" ? (streamMetaTool.metrics as Record<string, unknown>) : undefined) ??
                  (streamRawEvent.metrics && typeof streamRawEvent.metrics === "object" ? (streamRawEvent.metrics as Record<string, unknown>) : undefined),
              });
            } else if (currentKind === "custom_event_metadata") {
              const parsed = parseCustomEventPayload(payload.data);

              if (parsed.reasoning) {
                const reasonSegKey = `${runId}:${seq}:${sourceBufferKey}:custom_reasoning:${updatedReasoningBlockIndex}`;
                appendReasoningFromSource(effectiveSourceTag, parsed.reasoning, outerToolCallId);
                const reasonSeq = appendTimelineItem({
                  mergeKey: `${reasonSegKey}`,
                  at: eventAt,
                  lane: "reasoning",
                  sourceTag: effectiveSourceTag || "[agent]",
                  agentId: inferAgentIdFromSourceTag(effectiveSourceTag || "[agent]") ?? resolvedAgentId,
                  outerToolCallId,
                  eventName: parsed.eventName,
                  title: effectiveSourceTag || "[agent]",
                  text: parsed.reasoning,
                  rawEvent: parsed.rawEvent,
                });
                lastReasoningSeqRef.current = reasonSeq;
                reasoningSegmentKeyRef.current = reasonSegKey;
                lastProcessedKindByScopeRef.current.set(sourceBufferKey, "reasoning");
              }

              if (parsed.content) {
                const contentSegKey = `${runId}:${seq}:${sourceBufferKey}:custom_content:${updatedContentBlockIndex}`;
                appendContentFromSource(effectiveSourceTag, parsed.content, outerToolCallId);
                appendTimelineItem({
                  mergeKey: `${contentSegKey}`,
                  at: eventAt,
                  lane: "content",
                  sourceTag: effectiveSourceTag || "[agent]",
                  agentId: inferAgentIdFromSourceTag(effectiveSourceTag || "[agent]") ?? resolvedAgentId,
                  outerToolCallId,
                  eventName: parsed.eventName,
                  title: effectiveSourceTag || "[agent]",
                  text: parsed.content,
                  rawEvent: parsed.rawEvent,
                });
                const lastReasonSeq = lastReasoningSeqRef.current;
                if (lastReasonSeq != null) {
                  setCollapsedReasoningUntilSeq((prev) => Math.max(prev, lastReasonSeq));
                  lastReasoningSeqRef.current = null;
                }
                contentSegmentKeyRef.current = contentSegKey;
                lastProcessedKindByScopeRef.current.set(sourceBufferKey, "content");
              }

              if (parsed.toolState) {
                const toolName = parsed.toolName ?? parsed.toolCallId ?? "tool_call";
                if (toolName === "assign_task" || toolName === "create_subagent") {
                  const assignedName = extractSubagentNameFromEventData(
                    streamData,
                    streamMeta,
                    streamRawEvent
                  ) ?? extractAssignedSubagentName(parsed.args, parsed.rawEvent);
                  if (assignedName && outerToolCallId) {
                    taskAssignmentNameByOuterCallRef.current.set(outerToolCallId, assignedName);
                  }
                }
                const sourceTag = effectiveSourceTag || "[agent]";
                const sourceBufferKey = makeSourceBufferKey(sourceTag, outerToolCallId);
                const nextContentBlock = (contentBlockIndexRef.current.get(sourceBufferKey) ?? 0) + 1;
                const nextReasoningBlock = (reasoningBlockIndexRef.current.get(sourceBufferKey) ?? 0) + 1;
                contentBlockIndexRef.current.set(sourceBufferKey, nextContentBlock);
                reasoningBlockIndexRef.current.set(sourceBufferKey, nextReasoningBlock);
                const sourcePrefix = normalized.sourceTag ? `${normalized.sourceTag} ` : "";
                const key = `${sourceBufferKey}:${parsed.toolCallId ?? toolName}`;
                if (parsed.toolState === "started") {
                  const existing = toolCallBuffersRef.current.get(key) ?? "";
                  const line = `${sourcePrefix}${toolName} [started]`;
                  toolCallBuffersRef.current.set(key, existing ? `${existing}\n${line}` : line);
                } else if (parsed.toolState === "completed") {
                  const existing = toolResultBuffersRef.current.get(key) ?? "";
                  const result = parsed.content || "completed";
                  const line = `${sourcePrefix}${toolName} [completed] ${result}`;
                  toolResultBuffersRef.current.set(key, existing ? `${existing}\n${line}` : line);
                } else {
                  const existing = toolResultBuffersRef.current.get(key) ?? "";
                  const line = `${sourcePrefix}${toolName} [error] ${parsed.toolError ?? "tool call error"}`;
                  toolResultBuffersRef.current.set(key, existing ? `${existing}\n${line}` : line);
                }
                const callLines = Array.from(toolCallBuffersRef.current.entries()).map(
                  ([id, value]) => `tool_calls[${id}]: ${value}`
                );
                const resultLines = Array.from(toolResultBuffersRef.current.entries()).map(
                  ([id, value]) => `tool_result[${id}]: ${value}`
                );
                setToolStream([...callLines, ...resultLines].join("\n\n"));

                updateToolCard({
                  key,
                  sourceTag,
                  toolName,
                  status: parsed.toolState,
                  detail:
                    parsed.toolState === "error"
                      ? parsed.toolError ?? "tool call error"
                      : parsed.content || (parsed.toolState === "started" ? "running" : "completed"),
                  toolCallId: parsed.toolCallId,
                  args: parsed.args,
                  result: parsed.result,
                  rawEvent: parsed.rawEvent,
                  metrics: parsed.metrics,
                  eventName: parsed.eventName,
                });
                appendTimelineItem({
                  mergeKey: `${key}:${parsed.toolState}`,
                  at: eventAt,
                  lane: parsed.toolState === "started" ? "tool_call" : "tool_result",
                  sourceTag,
                  agentId: inferAgentIdFromSourceTag(sourceTag) ?? resolvedAgentId,
                  outerToolCallId,
                  eventName: parsed.eventName,
                  title: toolName,
                  text:
                    parsed.toolState === "error"
                      ? parsed.toolError ?? "tool call error"
                      : parsed.content || (parsed.toolState === "started" ? "running" : "completed"),
                  status: parsed.toolState,
                  toolName,
                  toolCallId: parsed.toolCallId,
                  args: parsed.args,
                  result: parsed.result,
                  rawEvent: parsed.rawEvent,
                  metrics: parsed.metrics,
                });
              }
            } else {
              const labelMap: Record<string, string> = {
                agent_status: "agent_status",
                audio_transcript: "audio_transcript",
                custom_event_metadata: "custom_event_metadata",
              };
              const label = labelMap[normalized.kind] ?? normalized.kind;
              const sourcePrefix = normalized.sourceTag ? `${normalized.sourceTag} ` : "";
              setToolStream((prev) => `${prev}${prev ? "\n\n" : ""}${label}: ${sourcePrefix}${chunk}`);
              appendTimelineItem({
                mergeKey: `${segmentKey}:${normalized.kind}`,
                at: eventAt,
                lane: "metadata",
                sourceTag: effectiveSourceTag || "[agent]",
                agentId: inferAgentIdFromSourceTag(effectiveSourceTag || "[agent]") ?? resolvedAgentId,
                outerToolCallId,
                eventName: streamEvent,
                title: label,
                text: chunk,
                rawEvent: streamRawEvent,
              });
            }
          }
          return;
        }
        if (payload.event === "agent.wakeup") {
          clearCurrentRunBuffers({ preserveTextBuffers: true, preserveRawEvents: true });
          return;
        }
        if (payload.event === "agent.unread") {
          clearCurrentRunBuffers({ preserveTextBuffers: true, preserveRawEvents: true });
          return;
        }
        if (payload.event === "agent.done") {
          ingestTurnWorkflowEvent({
            eventName: "RunCompleted",
            runId: turnWorkflowRunIdRef.current ?? undefined,
            source: "agent",
            agentId: streamAgentIdRef.current ?? undefined,
            agentName: streamAgentIdRef.current ?? "agent",
          });
          appendTimelineItem({
            mergeKey: `run:boundary:end:${Date.now()}`,
            at: payload.at,
            lane: "status",
            sourceTag: "[agent]",
            agentId: streamAgentIdRef.current,
            eventName: "RunCompleted",
            title: "Run",
            text: "—— 对话结束 ——",
          });
          clearCurrentRunBuffers({ preserveTextBuffers: true, preserveRawEvents: true });
          const groupId = activeGroupIdRef.current;
          const nextSession = loadSession();
          if (nextSession && groupId) void refreshMessages(nextSession, groupId, { markRead: false });
          if (nextSession) void refreshGroups(nextSession);
          const agentId = streamAgentIdRef.current;
          if (agentId) void refreshLlmHistory(agentId);
          return;
        }
        if (payload.event === "agent.error") {
          ingestTurnWorkflowEvent({
            eventName: "RunError",
            runId: turnWorkflowRunIdRef.current ?? undefined,
            source: "agent",
            agentId: streamAgentIdRef.current ?? undefined,
            agentName: streamAgentIdRef.current ?? "agent",
            toolError: payload.data.message,
          });
          setAgentError(payload.data.message);
        }
      } catch {
        // ignore
      }
    },
    [
      appendTimelineItem,
      appendContentFromSource,
      appendReasoningFromSource,
      clearToolState,
      clearCurrentRunBuffers,
      ingestTurnWorkflowEvent,
      inferAgentIdFromSourceTag,
      pushBeam,
      pushVizEvent,
      pushRawApiEvent,
      queueDebugEvent,
      refreshGroups,
      refreshLlmHistory,
      refreshMessages,
      registerDerivedAgent,
      resetStreamTextBuffers,
      resolveEventTimestamp,
      updateToolCard,
    ]
  );

  const connectAgentStream = useCallback(
    (agentId: string) => {
      if (streamAgentIdRef.current === agentId && esRef.current) return;
      streamAgentIdRef.current = agentId;
      replayAbortRef.current = null;
      setIsReplayingTest(false);
      setIsReplayMode(false);

      esRef.current?.close();
      setLlmHistory("");
      clearCurrentRunBuffers();
      resetTurnWorkflow(null);
      setAgentError(null);
      sourceTagAgentIdRef.current.set("[agent]", agentId);

      const groupId = activeGroupIdRef.current;
      const suffix = groupId ? `?groupId=${encodeURIComponent(groupId)}` : "";
      const es = new EventSource(withBackendOrigin(`/api/agents/${agentId}/context-stream${suffix}`));
      esRef.current = es;

      es.onmessage = (evt) => {
        try {
          const rawPayload = JSON.parse(evt.data) as RawAgnoEvent | AgentStreamEvent;
          processIncomingRawStreamEvent(rawPayload);
        } catch {
          // ignore
        }
      };

      es.onerror = () => setAgentError("SSE disconnected");
    },
    [
      clearCurrentRunBuffers,
      processIncomingRawStreamEvent,
      resetTurnWorkflow,
    ]
  );

  const hireSubAgent = useCallback(async () => {
    if (!session) return;
    const role = (window.prompt("Sub-agent role", "assistant") ?? "").trim();
    if (!role) return;

    setError(null);
    setAgentError(null);
    setStatus("boot");

    try {
      const created = await api<{ agentId: string; groupId: string }>(`/api/agents`, {
        method: "POST",
        body: JSON.stringify({
          workspaceId: session.workspaceId,
          creatorId: session.humanAgentId,
          role,
        }),
      });

      setStatus("idle");
      void refreshGroups(session);
      void refreshAgents(session);
      setActiveGroupId(created.groupId);
      connectAgentStream(created.agentId);
    } catch (e) {
      setStatus("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [connectAgentStream, refreshGroups, refreshAgents, session]);

  const onInterruptAllAgents = useCallback(async () => {
    if (!session || stoppingAgents) return;

    setStoppingAgents(true);
    setError(null);
    setAgentError(null);

    try {
      const res = await api<{ ok: boolean; interrupted: number; agentIds: string[] }>(
        `/api/agents/interrupt-all`,
        {
          method: "POST",
          body: JSON.stringify({ workspaceId: session.workspaceId }),
        }
      );

      setAgentStatusById((prev) => {
        const next = { ...prev };
        const ids = res.agentIds.length > 0 ? res.agentIds : agents.map((agent) => agent.id);
        for (const id of ids) {
          next[id] = "IDLE";
        }
        return next;
      });
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStoppingAgents(false);
    }
  }, [agents, session, stoppingAgents]);

  const onSwitchStreamAgent = useCallback(
    async (agentId: string) => {
      if (!session) return;
      const targetGroup = groupByAgentId.get(agentId);
      if (targetGroup) {
        setActiveGroupId(targetGroup.id);
      }
      connectAgentStream(agentId);
      await refreshLlmHistory(agentId);
    },
    [connectAgentStream, groupByAgentId, refreshLlmHistory, session]
  );

  const clearLocalTimeline = useCallback(async () => {
    if (!timelineStorageKey) return;
    suspendTimelinePersistRef.current = true;
    await deleteTimelineSnapshot(timelineStorageKey).catch(() => undefined);
    setStreamTimeline([]);
    timelineCounterRef.current = 0;
    setCollapsedReasoningUntilSeq(-1);
  }, [timelineStorageKey]);

  const restoreLocalTimeline = useCallback(async () => {
    if (!timelineStorageKey) return;
    try {
      const [items, rawItems, meta] = await Promise.all([
        readTimelineSnapshot(timelineStorageKey),
        readRawApiSnapshot(timelineStorageKey),
        readTimelineSnapshotMeta(timelineStorageKey),
      ]);
      isHydratingTimelineRef.current = true;
      setStreamTimeline(items);
      rawApiEventLogRef.current = rawItems;
      timelineCounterRef.current = items.reduce((max, item) => Math.max(max, item.seq + 1), 0);
      setTimelineSnapshotMeta(meta);
      setCollapsedReasoningUntilSeq(-1);
    } finally {
      isHydratingTimelineRef.current = false;
    }
  }, [timelineStorageKey]);

  const exportTimelineJson = useCallback(() => {
    const payload = rawApiEventLogRef.current;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `raw-events-${activeGroupId ?? selectedAgentId ?? "session"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [activeGroupId, selectedAgentId]);

  const timelineStatusText = useMemo(() => {
    if (!timelineStorageKey) return "Local Timeline: unavailable";
    const updated =
      timelineSnapshotMeta.updatedAt != null
        ? new Date(timelineSnapshotMeta.updatedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
        : "never";
    return `Local Timeline · ${timelineSnapshotMeta.count} items · updated ${updated}`;
  }, [timelineSnapshotMeta.count, timelineSnapshotMeta.updatedAt, timelineStorageKey]);

  const onInterruptCurrentAgent = useCallback(async () => {
    const agentId = selectedAgentId ?? streamAgentId;
    if (!agentId || stoppingCurrentAgent) return;

    setStoppingCurrentAgent(true);
    setError(null);
    setAgentError(null);
    try {
      const res = await api<{ ok: boolean; interrupted: number; agentIds: string[] }>(`/api/agents/${agentId}/interrupt`, {
        method: "POST",
      });
      if (res.agentIds.includes(agentId)) {
        setAgentStatusById((prev) => ({ ...prev, [agentId]: "IDLE" }));
      }
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStoppingCurrentAgent(false);
    }
  }, [selectedAgentId, stoppingCurrentAgent, streamAgentId]);

  const refreshWorkspaceArtifacts = useCallback(async () => {
    if (workspaceArtifactsLoading) return;
    setWorkspaceArtifactsLoading(true);
    try {
      const res = await api<WorkspaceArtifactsResponse>("/api/workspace-artifacts");
      setWorkspaceArtifacts(res);
    } catch {
      // non-blocking for UI
    } finally {
      setWorkspaceArtifactsLoading(false);
    }
  }, [workspaceArtifactsLoading]);

  const refreshGraphDesignData = useCallback(async () => {
    if (!session) return;
    try {
      const q = new URLSearchParams({ workspaceId: session.workspaceId, limitMessages: "2000" });
      const res = await api<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/agent-graph?${q.toString()}`);
      setGraphNodes(res.nodes);
      setGraphEdges(res.edges);
    } catch {
      // non-blocking for UI
    }
  }, [session]);

  const replayFromTestJson = useCallback(async () => {
    if (isReplayingTest) return;
    replayAbortRef.current = { cancelled: false };
    const abortToken = replayAbortRef.current;
    setIsReplayingTest(true);
    setIsReplayMode(true);
    setAgentError(null);

    try {
      esRef.current?.close();
      uiEsRef.current?.close();
      setLlmHistory("");
      clearRealtimeState();
      rawApiEventLogRef.current = [];
      contentSegmentKeyRef.current = null;
      reasoningSegmentKeyRef.current = null;
      modelRequestSeqByRunRef.current = new Map();
      sourceTagAgentIdRef.current = new Map();
      setDerivedAgents([]);
      setNodeOffsets({});
      derivedCreateEdgeRef.current = new Set();
      setVizBeams([]);
      setVizEvents([]);

      let events: RawAgnoEvent[] = [];
      try {
        const localRes = await fetch("/test.json", { cache: "no-store" });
        if (!localRes.ok) {
          throw new Error(`读取 /test.json 失败: ${localRes.status}`);
        }
        const raw = (await localRes.json()) as unknown;
        if (Array.isArray(raw)) {
          events = raw as RawAgnoEvent[];
        }
      } catch (error) {
        throw new Error(
          `回放模式仅读取前端静态文件 /test.json。请将测试文件放到 agno-swarm-console/public/test.json。${error instanceof Error ? ` (${error.message})` : ""
          }`
        );
      }

      if (events.length === 0) {
        setAgentError("test.json 没有可回放事件");
        return;
      }

      rawApiEventLogRef.current = events.map((evt) => {
        try {
          return JSON.parse(JSON.stringify(evt)) as RawApiEventSnapshot;
        } catch {
          return { raw: stringifyChunk(evt) } as RawApiEventSnapshot;
        }
      });

      let previousCreatedAt: number | null = null;
      for (const event of events) {
        if (abortToken.cancelled) break;

        const eventAgentId = typeof (event as Record<string, unknown>).agent_id === "string"
          ? ((event as Record<string, unknown>).agent_id as string)
          : null;
        if (eventAgentId) {
          streamAgentIdRef.current = eventAgentId;
          sourceTagAgentIdRef.current.set("[agent]", eventAgentId);
          setSelectedAgentId((prev) => prev ?? eventAgentId);
        }

        processIncomingRawStreamEvent(event);

        const createdAt = typeof (event as Record<string, unknown>).created_at === "number"
          ? ((event as Record<string, unknown>).created_at as number)
          : null;
        let delayMs = 12;
        if (createdAt != null && previousCreatedAt != null) {
          const deltaMs = Math.max(0, (createdAt - previousCreatedAt) * 1000);
          delayMs = Math.min(120, Math.max(8, deltaMs / 10));
        }
        previousCreatedAt = createdAt;

        if (delayMs > 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
        }
      }
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsReplayingTest(false);
      setIsReplayMode(false);
      replayAbortRef.current = null;
    }
  }, [clearRealtimeState, isReplayingTest, processIncomingRawStreamEvent]);

  const onSend = useCallback(async () => {
    if (!session || !activeGroupId) return;
    const text = draft.trim();
    if (!text) return;

    if (text.startsWith("/create") || text.startsWith("/hire")) {
      const role = text.replace(/^\/(create|hire)\s*/i, "").trim();
      if (!role) {
        setError("Usage: /create <role>");
        return;
      }

      setStatus("boot");
      setError(null);

      try {
        const created = await api<{ agentId: string; groupId: string }>(`/api/agents`, {
          method: "POST",
          body: JSON.stringify({
            workspaceId: session.workspaceId,
            creatorId: session.humanAgentId,
            role,
          }),
        });
        setDraft("");
        setStatus("idle");
        void refreshGroups(session);
        void refreshAgents(session);
        setActiveGroupId(created.groupId);
        connectAgentStream(created.agentId);
        return;
      } catch (e) {
        setStatus("idle");
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }

    setStatus("send");
    setError(null);

    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      senderId: session.humanAgentId,
      content: text,
      contentType: "text",
      sendTime: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setDraft("");
    queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));

    try {
      await api(`/api/groups/${activeGroupId}/messages`, {
        method: "POST",
        body: JSON.stringify({ senderId: session.humanAgentId, content: text, contentType: "text" }),
      });
    } finally {
      // keep going
    }

    setStatus("idle");
    void refreshMessages(session, activeGroupId, { markRead: false });
    void refreshGroups(session);
  }, [
    activeGroupId,
    connectAgentStream,
    draft,
    refreshAgents,
    refreshGroups,
    refreshMessages,
    session,
  ]);

  useEffect(() => {
    void bootstrap(workspaceOverrideId).catch((e) =>
      setError(e instanceof Error ? e.message : String(e))
    );
  }, [bootstrap, workspaceOverrideId]);

  useEffect(() => {
    activeGroupIdRef.current = activeGroupId;
  }, [activeGroupId]);

  useEffect(() => {
    streamAgentIdValueRef.current = streamAgentId;
  }, [streamAgentId]);

  useEffect(() => {
    if (!streamAgentId) return;
    setSelectedAgentId((prev) => prev ?? streamAgentId);
  }, [streamAgentId]);

  useEffect(() => {
    if (!timelineStorageKey) return;
    let cancelled = false;
    isHydratingTimelineRef.current = true;

    void Promise.all([readTimelineSnapshot(timelineStorageKey), readTimelineSnapshotMeta(timelineStorageKey)])
      .then(([items, meta]) => {
        if (cancelled) return;
        setStreamTimeline(items);
        timelineCounterRef.current = items.reduce((max, item) => Math.max(max, item.seq + 1), 0);
        hydratedTimelineKeyRef.current = timelineStorageKey;
        setTimelineSnapshotMeta(meta);
      })
      .catch(() => {
        if (cancelled) return;
        setStreamTimeline([]);
        timelineCounterRef.current = 0;
        hydratedTimelineKeyRef.current = timelineStorageKey;
        setTimelineSnapshotMeta({ count: 0, updatedAt: null });
      })
      .finally(() => {
        if (!cancelled) isHydratingTimelineRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [timelineStorageKey]);

  useEffect(() => {
    if (!timelineStorageKey) return;
    if (isHydratingTimelineRef.current) return;
    if (hydratedTimelineKeyRef.current !== timelineStorageKey) return;
    if (suspendTimelinePersistRef.current) {
      suspendTimelinePersistRef.current = false;
      return;
    }
    if (timelinePersistTimerRef.current !== null) {
      window.clearTimeout(timelinePersistTimerRef.current);
      timelinePersistTimerRef.current = null;
    }
    timelinePersistTimerRef.current = window.setTimeout(() => {
      timelinePersistTimerRef.current = null;
      void writeTimelineSnapshot(timelineStorageKey, streamTimeline, rawApiEventLogRef.current).then(() => {
        setTimelineSnapshotMeta({ count: streamTimeline.length, updatedAt: Date.now() });
      });
    }, 120);
  }, [streamTimeline, timelineStorageKey]);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    agentRoleByIdRef.current = agentRoleById;
  }, [agentRoleById]);

  useEffect(() => {
    nodeOffsetsRef.current = nodeOffsets;
  }, [nodeOffsets]);

  useEffect(() => {
    const el = vizRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.contentRect;
        if (!rect.width || !rect.height) continue;
        setVizSize({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = midStackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.contentRect;
        if (!rect.height) continue;
        setMidStackHeight(rect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = vizRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      setVizScale((s) => Math.min(Math.max(s + delta, 0.5), 2));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!session) return;
    if (isReplayMode) return;
    void refreshGroups(session).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void refreshAgents(session).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [isReplayMode, refreshGroups, refreshAgents, session]);

  useEffect(() => {
    if (!session) return;
    void refreshWorkspaceArtifacts();
    const timer = window.setInterval(() => {
      void refreshWorkspaceArtifacts();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [refreshWorkspaceArtifacts, session]);

  useEffect(() => {
    if (!session) return;
    void refreshGraphDesignData();
    const timer = window.setInterval(() => {
      void refreshGraphDesignData();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [refreshGraphDesignData, session]);

  useEffect(() => {
    if (!session) return;
    if (isReplayMode) return;
    uiEsRef.current?.close();
    const es = new EventSource(
      withBackendOrigin(`/api/ui-stream?workspaceId=${encodeURIComponent(session.workspaceId)}`)
    );
    uiEsRef.current = es;

    es.onmessage = (evt) => {
      let payload: UiStreamEvent | null = null;
      try {
        payload = JSON.parse(evt.data) as UiStreamEvent;
      } catch {
        payload = null;
      }
      if (payload) {
        if (payload.event === "ui.agent.created") {
          const role = payload.data?.agent?.role ?? "agent";
          const source = payload.data?.source ?? "agent";
          const subagentName = payload.data?.subagent_name ?? role;
          const agentId = payload.data?.agent?.id as UUID | undefined;
          const parentId = payload.data?.agent?.parentId as UUID | null | undefined;
          const label = source === "subagent" ? `创建子代理 ${subagentName}` : `创建 ${role}`;
          pushVizEvent(payload, label, "agent");
          if (agentId) {
            const fromId = parentId || session.humanAgentId;
            pushBeam({ fromId, toId: agentId, kind: "create", label: subagentName });
          }
          if (agentId) {
            setAgentStatusById((prev) => ({ ...prev, [agentId]: "IDLE" }));
          }
        } else if (payload.event === "ui.message.created") {
          const senderId = payload.data?.message?.senderId as UUID | undefined;
          const groupId = payload.data?.groupId as UUID | undefined;
          const senderRole = senderId
            ? agentRoleByIdRef.current.get(senderId) ?? senderId.slice(0, 6)
            : "unknown";
          pushVizEvent(payload, `消息: ${senderRole}`, "message");
          logVizDebug({
            type: "message_event",
            data: {
              messageId: payload.data?.message?.id,
              groupId,
              senderId,
              senderRole,
              hasGroup: !!groupsRef.current.find((g) => g.id === groupId),
            },
          });
          if (senderId && groupId) {
            const payloadMembers = Array.isArray(payload.data?.memberIds) ? payload.data.memberIds : null;
            const groupMembers =
              payloadMembers ??
              groupsRef.current.find((g) => g.id === groupId)?.memberIds ??
              [];
            const targetIds = groupMembers.filter((id: UUID) => id !== senderId);
            if (targetIds.length === 0) {
              logVizDebug({
                type: "beam_skipped",
                data: { reason: "no_targets", groupId, senderId },
              });
            } else {
              targetIds.forEach((targetId) => {
                pushBeam({ fromId: senderId, toId: targetId, kind: "message", label: `msg:${senderRole}` });
                logVizDebug({
                  type: "beam_created",
                  data: { groupId, senderId, targetId },
                });
              });
            }
          }
        } else if (payload.event === "ui.agent.llm.start" || payload.event === "ui.agent.llm.done") {
          const agentId = payload.data?.agentId as UUID | undefined;
          const role = agentId
            ? agentRoleByIdRef.current.get(agentId) ?? agentId.slice(0, 6)
            : "agent";
          const label = payload.event === "ui.agent.llm.start" ? `LLM 开始: ${role}` : `LLM 结束: ${role}`;
          pushVizEvent(payload, label, "llm");
          if (agentId) {
            setAgentStatusById((prev) => ({
              ...prev,
              [agentId]: payload.event === "ui.agent.llm.start" ? "BUSY" : "IDLE",
            }));
          }
        } else if (
          payload.event === "ui.agent.tool_call.start" ||
          payload.event === "ui.agent.tool_call.done"
        ) {
          const agentId = payload.data?.agentId as UUID | undefined;
          const toolName = payload.data?.toolName ?? "tool";
          const role = agentId
            ? agentRoleByIdRef.current.get(agentId) ?? agentId.slice(0, 6)
            : "agent";
          const label =
            payload.event === "ui.agent.tool_call.start"
              ? `工具开始: ${role} · ${toolName}`
              : `工具结束: ${role} · ${toolName}`;
          pushVizEvent(payload, label, "tool");
          if (agentId) {
            setAgentStatusById((prev) => ({
              ...prev,
              [agentId]: payload.event === "ui.agent.tool_call.start" ? "BUSY" : "IDLE",
            }));
          }
        } else if (payload.event === "ui.agent.interrupt_all") {
          pushVizEvent(payload, "停止全部 Agent", "agent");
          const ids = Array.isArray(payload.data?.agentIds)
            ? (payload.data.agentIds as UUID[])
            : [];
          setAgentStatusById((prev) => {
            const next = { ...prev };
            const targetIds = ids.length > 0 ? ids : Object.keys(next);
            for (const id of targetIds) {
              next[id] = "IDLE";
            }
            return next;
          });
        } else if (payload.event === "ui.db.write") {
          const table = payload.data?.table ?? "db";
          const action = payload.data?.action ?? "write";
          pushVizEvent(payload, `DB ${action}: ${table}`, "db");
        }
      }

      // any change in workspace => refresh lists (cheap enough for MVP)
      scheduleWorkspaceRefresh();
    };
    es.onerror = () => {
      // tolerate disconnects; user can refresh manually
    };

    return () => es.close();
  }, [
    logVizDebug,
    pushBeam,
    pushVizEvent,
    scheduleWorkspaceRefresh,
    session,
    isReplayMode,
  ]);

  useEffect(() => {
    if (!streamAgentId) return;
    if (isReplayMode) return;
    connectAgentStream(streamAgentId);
    setLlmHistory("");
    void refreshLlmHistory(streamAgentId);
  }, [connectAgentStream, isReplayMode, refreshLlmHistory, streamAgentId]);

  useEffect(() => {
    if (!activeGroupId || !session) return;
    if (isReplayMode) return;
    void refreshMessages(session, activeGroupId, { markRead: true }).catch((e) =>
      setError(e instanceof Error ? e.message : String(e))
    );
  }, [activeGroupId, isReplayMode, refreshMessages, session]);

  useEffect(() => {
    return () => esRef.current?.close();
  }, []);

  useEffect(() => {
    return () => {
      if (replayAbortRef.current) {
        replayAbortRef.current.cancelled = true;
      }
      if (timelinePersistTimerRef.current !== null) {
        window.clearTimeout(timelinePersistTimerRef.current);
        timelinePersistTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      beamTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      beamTimeoutsRef.current = [];
    };
  }, []);

  useEffect(() => {
    const id = `session-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    debugSessionIdRef.current = id;
    setDebugSessionId(id);
  }, []);

  const roleColor = (role?: string) => {
    if (!role) return "#e4e4e7";
    if (role === "human") return "#f8fafc";
    if (role === "assistant") return "#38bdf8";
    if (role === "productmanager") return "#fb7185";
    if (role === "coder") return "#34d399";
    return "#fbbf24";
  };

  const statusColor = (status?: AgentStatus) => {
    if (status === "BUSY") return "#ef4444";
    if (status === "WAKING") return "#facc15";
    return "#22c55e";
  };

  const midChatHeight = useMemo(() => {
    if (!midStackHeight) return 0;
    const available = Math.max(0, midStackHeight - MID_SPLITTER_SIZE);
    if (available <= 0) return 0;
    const minChat = MID_CHAT_MIN_HEIGHT;
    const minGraph = MID_GRAPH_MIN_HEIGHT;
    if (available <= minGraph + minChat) {
      return Math.max(minChat, available - minGraph);
    }
    const maxChat = available - minGraph;
    const desired = available * midSplitRatio;
    return Math.min(maxChat, Math.max(minChat, desired));
  }, [midSplitRatio, midStackHeight]);

  useEffect(() => {
    midChatHeightRef.current = midChatHeight;
  }, [midChatHeight]);

  const toggleRightPanel = useCallback((id: RightPanelId) => {
    setRightPanels((prev) =>
      prev.map((panel) =>
        panel.id === id ? { ...panel, collapsed: !panel.collapsed } : panel
      )
    );
  }, []);

  const startMidResize = useCallback(
    (clientY: number) => {
      const container = midStackRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const available = Math.max(0, rect.height - MID_SPLITTER_SIZE);
      if (available <= 0) return;
      const minChat = MID_CHAT_MIN_HEIGHT;
      const minGraph = MID_GRAPH_MIN_HEIGHT;
      const maxChat = Math.max(minChat, available - minGraph);
      const startY = clientY;
      const startHeight = midChatHeightRef.current || available * midSplitRatio;

      const onMove = (e: PointerEvent | MouseEvent) => {
        const delta = e.clientY - startY;
        const next = Math.min(maxChat, Math.max(minChat, startHeight + delta));
        const ratio = available ? next / available : 0.5;
        setMidSplitRatio(ratio);
      };

      const onTouchMove = (e: TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        const delta = touch.clientY - startY;
        const next = Math.min(maxChat, Math.max(minChat, startHeight + delta));
        const ratio = available ? next / available : 0.5;
        setMidSplitRatio(ratio);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("touchend", onUp);
        document.body.style.cursor = "";
      };

      document.body.style.cursor = "row-resize";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      window.addEventListener("touchend", onUp);
    },
    [midSplitRatio]
  );

  const handleMidResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      startMidResize(event.clientY);
    },
    [startMidResize]
  );

  const handleMidMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      startMidResize(event.clientY);
    },
    [startMidResize]
  );

  const handleMidTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      const touch = event.touches[0];
      if (!touch) return;
      startMidResize(touch.clientY);
    },
    [startMidResize]
  );

  const handleRightPanelResizeStart = useCallback(
    (index: number, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const first = rightPanels[index];
      const second = rightPanels[index + 1];
      if (!first || !second) return;
      if (first.collapsed || second.collapsed) return;

      const startY = event.clientY;
      const startFirst = first.size;
      const startSecond = second.size;
      const min = RIGHT_PANEL_MIN_HEIGHT;

      const onMove = (e: PointerEvent) => {
        const delta = e.clientY - startY;
        const total = startFirst + startSecond;
        const nextFirst = Math.min(total - min, Math.max(min, startFirst + delta));
        const nextSecond = total - nextFirst;
        setRightPanels((prev) => {
          if (!prev[index] || !prev[index + 1]) return prev;
          if (prev[index].collapsed || prev[index + 1].collapsed) return prev;
          const next = [...prev];
          next[index] = { ...next[index], size: nextFirst };
          next[index + 1] = { ...next[index + 1], size: nextSecond };
          return next;
        });
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
      };

      document.body.style.cursor = "row-resize";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [rightPanels]
  );

  const handleNodeActivate = useCallback(
    (id: string) => {
      setSelectedAgentId(id);
      setActiveGraphCardAgentId((prev) => (prev === id ? null : id));
      void onSwitchStreamAgent(id);
    },
    [onSwitchStreamAgent]
  );

  const startNodeDrag = useCallback(
    (id: string, clientX: number, clientY: number, onTap?: () => void) => {
      const startOffset = nodeOffsetsRef.current[id] ?? { x: 0, y: 0 };
      const startX = clientX;
      const startY = clientY;
      let moved = false;
      const TAP_THRESHOLD = 4;

      const onMove = (e: PointerEvent | MouseEvent) => {
        const dx = (e.clientX - startX) / (vizScale || 1);
        const dy = (e.clientY - startY) / (vizScale || 1);
        if (Math.abs(e.clientX - startX) > TAP_THRESHOLD || Math.abs(e.clientY - startY) > TAP_THRESHOLD) {
          moved = true;
        }
        setNodeOffsets((prev) => ({
          ...prev,
          [id]: { x: startOffset.x + dx, y: startOffset.y + dy },
        }));
      };

      const onTouchMove = (e: TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        if (
          Math.abs(touch.clientX - startX) > TAP_THRESHOLD ||
          Math.abs(touch.clientY - startY) > TAP_THRESHOLD
        ) {
          moved = true;
        }
        const dx = (touch.clientX - startX) / (vizScale || 1);
        const dy = (touch.clientY - startY) / (vizScale || 1);
        setNodeOffsets((prev) => ({
          ...prev,
          [id]: { x: startOffset.x + dx, y: startOffset.y + dy },
        }));
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("touchend", onUp);
        document.body.style.cursor = "";
        if (!moved) onTap?.();
      };

      document.body.style.cursor = "grabbing";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      window.addEventListener("touchend", onUp);
    },
    [vizScale]
  );

  const handleNodePointerDown = useCallback(
    (id: string, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      startNodeDrag(id, event.clientX, event.clientY, () => handleNodeActivate(id));
    },
    [handleNodeActivate, startNodeDrag]
  );

  const handleNodeMouseDown = useCallback(
    (id: string, event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      startNodeDrag(id, event.clientX, event.clientY, () => handleNodeActivate(id));
    },
    [handleNodeActivate, startNodeDrag]
  );

  const handleNodeTouchStart = useCallback(
    (id: string, event: ReactTouchEvent<HTMLDivElement>) => {
      event.stopPropagation();
      const touch = event.touches[0];
      if (!touch) return;
      startNodeDrag(id, touch.clientX, touch.clientY, () => handleNodeActivate(id));
    },
    [handleNodeActivate, startNodeDrag]
  );

  const summarizeHistoryEntry = useCallback((entry: any, index: number, opts?: { omitRole?: boolean }) => {
    const role = typeof entry?.role === "string" ? entry.role : "unknown";
    const toolCalls = Array.isArray(entry?.tool_calls) ? entry.tool_calls.length : 0;
    const toolName =
      typeof entry?.name === "string"
        ? entry.name
        : typeof entry?.tool_call_id === "string"
          ? entry.tool_call_id.slice(0, 6)
          : "";
    let contentText = "";
    if (typeof entry?.content === "string") {
      contentText = entry.content;
    } else if (entry?.content != null) {
      try {
        contentText = JSON.stringify(entry.content);
      } catch {
        contentText = String(entry.content);
      }
    }
    contentText = contentText.replace(/\s+/g, " ").slice(0, 80);
    const metaParts: string[] = [];
    if (!opts?.omitRole) metaParts.push(role);
    if (role === "tool" && toolName) {
      metaParts.push(toolName);
    } else if (toolCalls > 0) {
      metaParts.push(`tool_calls:${toolCalls}`);
    }
    const meta = metaParts.join(" · ");
    const prefix = meta ? `#${index + 1} ${meta}` : `#${index + 1}`;
    return contentText ? `${prefix} — ${contentText}` : prefix;
  }, []);

  const historyRole = useCallback((entry: any) => {
    return typeof entry?.role === "string" ? entry.role : "unknown";
  }, []);

  const historyAccent = useCallback((role?: string) => {
    if (!role) return "#94a3b8";
    if (role === "human") return "#f8fafc";
    if (role === "assistant") return "#38bdf8";
    if (role === "productmanager") return "#fb7185";
    if (role === "coder") return "#34d399";
    if (role === "tool") return "#fbbf24";
    if (role === "system") return "#a78bfa";
    return "#94a3b8";
  }, []);

  const title = getGroupLabel(activeGroup);

  const graphStats = useMemo(() => {
    const totalEdges = graphEdges.length;
    const totalMessages = graphEdges.reduce((sum, edge) => sum + edge.count, 0);
    return { totalEdges, totalMessages, totalNodes: vizAgents.length };
  }, [graphEdges, vizAgents.length]);

  const dashboardStats = useMemo(() => {
    const activeAgents = Object.values(agentStatusById).filter((status) => status !== "IDLE").length;
    return {
      groups: groups.length,
      activeAgents,
      timelineItems: filteredTimelineItems.length,
      runtimeAgents: vizAgents.length,
      events: vizEvents.length,
      artifacts: (workspaceArtifacts?.subagents?.length ?? 0) + (workspaceArtifacts?.todos?.length ?? 0),
    };
  }, [agentStatusById, groups.length, filteredTimelineItems.length, vizAgents.length, vizEvents.length, workspaceArtifacts?.subagents?.length, workspaceArtifacts?.todos?.length]);

  const turnWorkflowCanvas = useMemo(() => {
    const runNodes = turnWorkflow.nodes.filter((node) => node.type === "run");
    const agentNodes = turnWorkflow.nodes.filter((node) => node.type === "agent");
    const toolNodes = turnWorkflow.nodes.filter((node) => node.type === "tool");

    const positions = new Map<string, { x: number; y: number }>();
    const laneX = { run: 90, agent: 300, tool: 600 };

    const laneAgents = [...agentNodes].sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
    const laneIndexByAgentNodeId = new Map<string, number>();
    laneAgents.forEach((agent, idx) => laneIndexByAgentNodeId.set(agent.id, idx));

    const laneStartY = 70;
    const laneGap = 98;

    const laneBands = laneAgents.map((agent, idx) => ({
      id: agent.id,
      label: agent.label,
      y: laneStartY + idx * laneGap - 26,
      height: 84,
    }));

    runNodes.forEach((node, index) => {
      positions.set(node.id, {
        x: laneX.run,
        y: laneStartY + index * 76,
      });
    });

    laneAgents.forEach((node, idx) => {
      positions.set(node.id, {
        x: laneX.agent,
        y: laneStartY + idx * laneGap,
      });
    });

    const ownerAgentByToolNodeId = new Map<string, string>();
    for (const edge of turnWorkflow.edges) {
      if (!edge.to.startsWith("tool:")) continue;
      if (!edge.from.startsWith("agent:")) continue;
      ownerAgentByToolNodeId.set(edge.to, edge.from);
    }

    const toolStackCountByLane = new Map<number, number>();
    toolNodes.forEach((toolNode, idx) => {
      const ownerAgentNodeId = ownerAgentByToolNodeId.get(toolNode.id);
      const laneIndex = ownerAgentNodeId ? laneIndexByAgentNodeId.get(ownerAgentNodeId) ?? idx : idx;
      const laneCount = toolStackCountByLane.get(laneIndex) ?? 0;
      toolStackCountByLane.set(laneIndex, laneCount + 1);
      positions.set(toolNode.id, {
        x: laneX.tool,
        y: laneStartY + laneIndex * laneGap + laneCount * 38,
      });
    });

    const laneCount = Math.max(1, laneAgents.length);
    const width = 840;
    const height = Math.max(320, laneStartY + laneCount * laneGap + 120);

    return { positions, width, height, laneX, laneBands, ownerAgentByToolNodeId };
  }, [turnWorkflow.edges, turnWorkflow.nodes]);

  const workflowNodeById = useMemo(() => {
    const map = new Map<string, TurnWorkflowNode>();
    turnWorkflow.nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [turnWorkflow.nodes]);

  const selectedWorkflowNode = useMemo(
    () => (selectedWorkflowNodeId ? turnWorkflow.nodes.find((node) => node.id === selectedWorkflowNodeId) ?? null : null),
    [selectedWorkflowNodeId, turnWorkflow.nodes]
  );

  const isTimelineItemRelatedToSelectedNode = useCallback(
    (item: StreamTimelineItem): boolean => {
      if (!selectedWorkflowNode) return false;
      if (selectedWorkflowNode.type === "tool") {
        if (selectedWorkflowNode.toolCallId && item.toolCallId === selectedWorkflowNode.toolCallId) return true;
        if (selectedWorkflowNode.toolName && item.toolName === selectedWorkflowNode.toolName) return true;
        return false;
      }
      if (selectedWorkflowNode.type === "agent") {
        if (selectedWorkflowNode.agentId && item.agentId === selectedWorkflowNode.agentId) return true;
        if (item.sourceTag.includes(selectedWorkflowNode.label)) return true;
        return false;
      }
      if (selectedWorkflowNode.type === "run") {
        return selectedWorkflowNode.runId ? item.mergeKey.includes(selectedWorkflowNode.runId) : item.lane === "status";
      }
      return false;
    },
    [selectedWorkflowNode]
  );

  const workflowFocusedItems = useMemo(() => {
    const selectedTaskItems = selectedTaskFlowState?.timelineItems ?? [];
    if (selectedWorkflowNode) {
      return selectedTaskItems.filter((item) => isTimelineItemRelatedToSelectedNode(item));
    }
    return selectedTaskItems;
  }, [isTimelineItemRelatedToSelectedNode, selectedTaskFlowState, selectedWorkflowNode]);

  useEffect(() => {
    if (!selectedWorkflowNodeId) return;
    const exists = turnWorkflow.nodes.some((node) => node.id === selectedWorkflowNodeId);
    if (!exists) setSelectedWorkflowNodeId(null);
  }, [selectedWorkflowNodeId, turnWorkflow.nodes]);

  useEffect(() => {
    if (selectedWorkflowNodeId || turnWorkflow.nodes.length === 0) return;
    const latestTool = [...turnWorkflow.nodes].reverse().find((node) => node.type === "tool");
    setSelectedWorkflowNodeId((latestTool ?? turnWorkflow.nodes[turnWorkflow.nodes.length - 1])?.id ?? null);
  }, [selectedWorkflowNodeId, turnWorkflow.nodes]);

  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatFeedItems.length, activeGroupId, selectedAgentId]);

  const toggleAgentCollapsed = useCallback((agentId: string) => {
    setCollapsedAgents((prev) => ({ ...prev, [agentId]: !prev[agentId] }));
  }, []);

  const renderGroupRow = (
    g: Group,
    tree?: {
      depth: number;
      hasChildren: boolean;
      collapsed: boolean;
      agentId: string;
      guides: boolean[];
      isLast: boolean;
    }
  ) => {
    const guideWidth = 14;
    const caretWidth = 18;
    const caretGap = 6;
    const depth = tree?.depth ?? 0;
    const prefixWidth = depth > 0 ? depth * guideWidth + guideWidth : 0;
    const previewIndent = tree ? prefixWidth + caretWidth + caretGap : 0;
    return (
      <button
        key={g.id}
        className={cx(
          "row",
          g.id === activeGroupId && "active",
          tree?.agentId && selectedAgentId === tree.agentId && "active"
        )}
        onClick={() => {
          setActiveGroupId(g.id);
          if (tree?.agentId) {
            setSelectedAgentId(tree.agentId);
            void onSwitchStreamAgent(tree.agentId);
          }
        }}
        style={{ paddingLeft: 16 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {tree && tree.depth > 0 ? (
              <span className="tree-prefix">
                {tree.guides.map((hasLine, idx) => (
                  <span
                    key={`${g.id}-guide-${idx}`}
                    className={hasLine ? "tree-line" : "tree-blank"}
                  />
                ))}
                <span className={tree.isLast ? "tree-elbow last" : "tree-elbow"} />
              </span>
            ) : null}
            {tree?.hasChildren ? (
              <button
                type="button"
                className="tree-caret"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleAgentCollapsed(tree.agentId);
                }}
                title={tree.collapsed ? "展开" : "收起"}
              >
                {tree.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </button>
            ) : tree ? (
              <span className="tree-caret-placeholder" />
            ) : null}
            <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {getGroupLabel(g)}
            </div>
          </div>
          {g.unreadCount > 0 && <span className="badge">{g.unreadCount}</span>}
        </div>
        {g.lastMessage ? (
          <div
            className="muted"
            style={{
              fontSize: 12,
              marginTop: 6,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginLeft: previewIndent,
            }}
          >
            {g.lastMessage.content}
          </div>
        ) : null}
        {g.contextTokens > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, marginBottom: 2 }}>
              <span className="muted">Context</span>
              <span className="mono" style={{ color: (g.contextTokens / tokenLimit) > 0.8 ? "#ef4444" : (g.contextTokens / tokenLimit) > 0.5 ? "#facc15" : "#22c55e" }}>
                {g.contextTokens.toLocaleString()}
                <span className="muted" style={{ marginLeft: 4 }}>/ {tokenLimit.toLocaleString()}</span>
              </span>
            </div>
            <div style={{ height: 3, background: "#27272a", borderRadius: 2, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(100, (g.contextTokens / tokenLimit) * 100)}%`,
                  background: (g.contextTokens / tokenLimit) > 0.8 ? "#ef4444" : (g.contextTokens / tokenLimit) > 0.5 ? "#facc15" : "#22c55e",
                  borderRadius: 2,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        )}
      </button>
    );
  };

  const renderAgentOnlyRow = (
    agent: AgentMeta,
    tree: {
      depth: number;
      hasChildren: boolean;
      collapsed: boolean;
      agentId: string;
      guides: boolean[];
      isLast: boolean;
    }
  ) => {
    const guideWidth = 14;
    const caretWidth = 18;
    const caretGap = 6;
    const depth = tree.depth;
    const prefixWidth = depth > 0 ? depth * guideWidth + guideWidth : 0;
    const roleLabel = agent.role || agent.id.slice(0, 8);
    return (
      <button
        key={`agent-only-${agent.id}`}
        className={cx("row", selectedAgentId === agent.id && "active")}
        onClick={() => {
          setSelectedAgentId(agent.id);
          void onSwitchStreamAgent(agent.id);
        }}
        style={{ paddingLeft: 16 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {depth > 0 ? (
              <span className="tree-prefix">
                {tree.guides.map((hasLine, idx) => (
                  <span key={`${agent.id}-guide-${idx}`} className={hasLine ? "tree-line" : "tree-blank"} />
                ))}
                <span className={tree.isLast ? "tree-elbow last" : "tree-elbow"} />
              </span>
            ) : null}
            {tree.hasChildren ? (
              <button
                type="button"
                className="tree-caret"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleAgentCollapsed(tree.agentId);
                }}
                title={tree.collapsed ? "展开" : "收起"}
              >
                {tree.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </button>
            ) : (
              <span className="tree-caret-placeholder" />
            )}
            <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {roleLabel}
            </div>
          </div>
          <span className="mono muted" style={{ fontSize: 11 }}>{agent.id.slice(0, 8)}</span>
        </div>
        <div
          className="muted"
          style={{
            fontSize: 12,
            marginTop: 6,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginLeft: prefixWidth + caretWidth + caretGap,
          }}
        >
          Replay agent lane
        </div>
      </button>
    );
  };

  return (
    <IMShell
      leftWidth={leftPanelWidth}
      rightWidth={rightPanelWidth}
      onStartResize={startColumnResize}
      left={
        <CapabilityRail
          headerTitle={session ? "Swarm Overview" : "Workspace"}
          headerSubtitle="Track threads, runtime agents, and artifact coverage from one place."
        >
          <CapabilitySection
            id="dashboard"
            title="Dashboard"
            defaultExpanded={true}
          >
            <div className="dashboard-card">
              <div className="dashboard-card-body">
                <div className="stats-grid">
                  <div className="stat-tile">
                    <div className="stat-label">Groups</div>
                    <div className="stat-value">{dashboardStats.groups}</div>
                    <div className="stat-hint">Active conversation threads</div>
                  </div>
                  <div className="stat-tile">
                    <div className="stat-label">Agents</div>
                    <div className="stat-value">{dashboardStats.runtimeAgents}</div>
                    <div className="stat-hint">{dashboardStats.activeAgents} currently active</div>
                  </div>
                  <div className="stat-tile">
                    <div className="stat-label">Artifacts</div>
                    <div className="stat-value">{dashboardStats.artifacts}</div>
                    <div className="stat-hint">Cards and todo overlays</div>
                  </div>
                </div>
                <div className="dashboard-card" style={{ marginTop: 12, borderRadius: 14, background: "rgba(248,250,252,0.92)", boxShadow: "none" }}>
                  <div className="dashboard-card-body" style={{ padding: 12 }}>
                    <div className="eyebrow">Identifiers</div>
                    <div className="muted mono" style={{ fontSize: 12, lineHeight: 1.6, marginTop: 6 }}>
                      workspace: {session?.workspaceId ?? "-"}
                      <br />
                      human: {session?.humanAgentId ?? "-"}
                      <br />
                      assistant: {session?.assistantAgentId ?? "-"}
                      <br />
                      workspace path: {workspaceArtifacts?.workspace ?? "-"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CapabilitySection>

          <CapabilitySection
            id="conversation-routes"
            title="Conversation Routes"
            count={agentTreeRows.length + extraGroups.length}
            defaultExpanded={true}
          >
            <div style={{ maxHeight: "100%", overflow: "auto" }}>
              {agentTreeRows.length === 0 && extraGroups.length === 0 ? (
                <div style={{ padding: 16 }} className="muted">
                  No groups yet.
                </div>
              ) : (
                <>
                  {agentTreeRows.map(({ agent, group, depth, hasChildren, collapsed, guides, isLast }) =>
                    group
                      ? renderGroupRow(group, {
                        depth,
                        hasChildren,
                        collapsed,
                        agentId: agent.id,
                        guides,
                        isLast,
                      })
                      : renderAgentOnlyRow(agent, {
                        depth,
                        hasChildren,
                        collapsed,
                        agentId: agent.id,
                        guides,
                        isLast,
                      })
                  )}
                  {extraGroups.map((g) => renderGroupRow(g))}
                </>
              )}
            </div>
          </CapabilitySection>

          <CapabilitySection
            id="workspace-artifacts"
            title="Workspace JSON Artifacts"
            count={workspaceArtifacts?.subagents?.length ?? 0}
            defaultExpanded={true}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div className="muted mono" style={{ fontSize: 12 }}>
                scanned: {workspaceArtifacts?.scannedFiles ?? 0} files
              </div>
              <button
                className="btn"
                style={{ padding: "3px 9px", fontSize: 12 }}
                onClick={() => void refreshWorkspaceArtifacts()}
                disabled={workspaceArtifactsLoading}
              >
                {workspaceArtifactsLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {(workspaceArtifacts?.subagents ?? []).map((card, idx) => (
                <div
                  key={`${card.sourceFile}-${card.name}-${idx}`}
                  style={{ border: "1px solid #dde6ef", borderRadius: 12, padding: 10, background: "#ffffff", boxShadow: "0 8px 20px rgba(15,23,42,0.05)" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>{card.name}</div>
                    <span className="mono muted" style={{ fontSize: 11 }}>{card.model ?? "-"}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>{card.description}</div>
                  <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {card.tools.map((tool) => (
                      <span key={tool} className="mono" style={{ fontSize: 11, border: "1px solid rgba(59,130,246,0.28)", background: "rgba(59,130,246,0.08)", borderRadius: 999, padding: "2px 7px", color: "#1d4ed8" }}>
                        {tool}
                      </span>
                    ))}
                  </div>
                  <div className="muted mono" style={{ fontSize: 11, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={card.sourceFile}>
                    {card.sourceFile}
                  </div>
                </div>
              ))}
              {(workspaceArtifacts?.subagents?.length ?? 0) === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>No subagent cards found in workspace JSON.</div>
              ) : null}
            </div>

            <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>
              TODO cards are rendered as floating overlays on the graph ({workspaceArtifacts?.todos?.length ?? 0}).
            </div>
          </CapabilitySection>
        </CapabilityRail>
      }
      mid={
        <main className="panel panel-mid">
          <div className="header" style={{ display: "block", paddingBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <div className="eyebrow">Swarm Mission Console</div>
                <div className="section-title" style={{ fontSize: 24 }}>{title}</div>
                <div className="section-subtitle">
                  Monitor graph activity, timeline density, and agent execution from a dashboard-style control surface.
                </div>
              </div>
              <div className="toolbar-row" style={{ justifyContent: "flex-end" }}>
                <span className="pill mono">timeline {dashboardStats.timelineItems}</span>
                <span className="pill mono">events {dashboardStats.events}</span>
                <span className="pill mono">active {dashboardStats.activeAgents}</span>
              </div>
            </div>
            <div className="toolbar-row" style={{ marginTop: 12 }}>
              {selectedAgentName ? (
                <>
                  <span className="mono" style={{ fontSize: 12, color: "#1d4ed8", border: "1px solid rgba(59,130,246,0.28)", background: "rgba(59,130,246,0.08)", borderRadius: 999, padding: "3px 9px" }}>
                    Filter: {selectedAgentName}
                  </span>
                  <button
                    className="btn"
                    style={{ padding: "5px 10px", fontSize: 12 }}
                    onClick={() => setSelectedAgentId(null)}
                    title="清除 Agent 过滤"
                  >
                    Clear Filter
                  </button>
                </>
              ) : null}
            </div>
            <div className="toolbar-row" style={{ marginTop: 12 }}>
              <button
                className="btn"
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  borderColor: "rgba(220,38,38,0.32)",
                  background: stoppingAgents ? "rgba(239,68,68,0.18)" : "rgba(239,68,68,0.1)",
                  color: "#b91c1c",
                }}
                onClick={() => void onInterruptAllAgents()}
                disabled={!session || stoppingAgents}
                title="停止所有 agent 当前循环"
              >
                {stoppingAgents ? "Stopping..." : "Stop All Agents"}
              </button>
              <button
                className="btn"
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  borderColor: "rgba(217,119,6,0.3)",
                  background: stoppingCurrentAgent ? "rgba(245,158,11,0.2)" : "rgba(245,158,11,0.12)",
                  color: "#b45309",
                }}
                onClick={() => void onInterruptCurrentAgent()}
                disabled={!(selectedAgentId ?? streamAgentId) || stoppingCurrentAgent}
                title="停止当前选中 Agent 的运行"
              >
                {stoppingCurrentAgent ? "Stopping Agent..." : "Stop Current Agent"}
              </button>
              <button
                className="btn"
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  borderColor: "rgba(59,130,246,0.32)",
                  background: isReplayingTest ? "rgba(59,130,246,0.18)" : "rgba(59,130,246,0.1)",
                  color: "#1d4ed8",
                }}
                onClick={() => void replayFromTestJson()}
                disabled={isReplayingTest}
                title="使用 test.json 一键回放流式渲染"
              >
                {isReplayingTest ? "Replaying test.json..." : "Replay test.json"}
              </button>
              <button
                className="btn"
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => void clearLocalTimeline()}
                disabled={!timelineStorageKey}
                title="清空当前会话的本地时间线缓存"
              >
                Clear Local Timeline
              </button>
              <button
                className="btn"
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => void restoreLocalTimeline()}
                disabled={!timelineStorageKey}
                title="从本地 IndexedDB 恢复当前时间线"
              >
                Restore from Local
              </button>
              <button
                className="btn"
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={exportTimelineJson}
                disabled={filteredTimelineItems.length === 0}
                title="导出当前时间线为 JSON"
              >
                Export Timeline JSON
              </button>
              <div className="muted" style={{ fontSize: 12 }}>
                {status !== "idle" ? `${status}...` : ""}
              </div>
              <div className="muted mono" style={{ fontSize: 12, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={timelineStorageKey ?? undefined}>
                {timelineStatusText}
              </div>
            </div>
          </div>

          <div style={{ padding: "0 18px 14px" }}>
            <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
              <div className="stat-tile">
                <div className="stat-label">Graph nodes</div>
                <div className="stat-value">{graphStats.totalNodes}</div>
                <div className="stat-hint">Visible agents and placeholders</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Flows</div>
                <div className="stat-value">{graphStats.totalEdges}</div>
                <div className="stat-hint">Observed routed connections</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Messages</div>
                <div className="stat-value">{graphStats.totalMessages}</div>
                <div className="stat-hint">Aggregated across graph edges</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Timeline</div>
                <div className="stat-value">{dashboardStats.timelineItems}</div>
                <div className="stat-hint">Chronological execution items</div>
              </div>
            </div>
          </div>

          <div className="mid-stack" ref={midStackRef} style={{ display: "flex", flexDirection: "column", position: "relative" }}>
            <div className="agent-panels" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", border: "none", borderRadius: 0, background: "transparent", boxShadow: "none" }}>
              <div className="agent-panel-header" style={{ cursor: "default", borderBottom: "1px solid var(--line-soft)" }}>
                <span>Chat Feed</span>
                <span className="mono" style={{ fontSize: 11, color: "#71717a" }}>{chatFeedItems.length}</span>
                <div style={{ flex: 1 }} />
                <button
                  className="btn"
                  style={{ padding: "2px 8px", fontSize: 12 }}
                  onClick={() => {
                    setShowExecutionDrawer(true);
                  }}
                >
                  任务流详情
                </button>
              </div>
              <div ref={timelineScrollRef} className={cx("agent-panel-body", "timeline-scroll")} style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, padding: "16px 18px" }}>
                {chatFeedItems.length === 0 ? (
                  <span className="muted">—</span>
                ) : (
                  chatFeedItems.map((item) => {
                    if (item.kind === "human" || item.kind === "assistant") {
                      const isHuman = item.kind === "human";
                      return (
                        <div
                          key={item.id}
                          style={{ display: "flex", justifyContent: isHuman ? "flex-end" : "flex-start" }}
                        >
                          <article className={cx("chat-feed-bubble", isHuman ? "human" : "assistant")}>
                            <div className="chat-feed-meta">
                              <span>{item.title}</span>
                              <span className="mono">{new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                            <RichContent content={item.content || ""} className="timeline-rich" onArtifactClick={openArtifactPreview} />
                          </article>
                        </div>
                      );
                    }

                    const isSubagentCompact = item.compactLabel?.startsWith("子代理任务") ?? false;
                    if (!isSubagentCompact) {
                      const linkedItems = item.linkedTimelineIds
                        .map((id) => timelineItemById.get(id))
                        .filter((entry): entry is StreamTimelineItem => !!entry);
                      const visibleItems = item.compactLabel?.startsWith("深度思考")
                        ? linkedItems.filter((entry) => entry.lane === "reasoning")
                        : item.compactLabel?.startsWith("工具调用")
                          ? linkedItems.filter((entry) => entry.lane === "tool_call" || entry.lane === "tool_result")
                          : linkedItems;

                      return (
                        <article key={item.id} className="chat-feed-bubble assistant" style={{ alignSelf: "stretch" }}>
                          <div className="chat-feed-meta">
                            <span>{item.compactLabel || item.title}</span>
                            <span className="mono">{new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                          <div style={{ display: "grid", gap: 10 }}>
                            {visibleItems.length === 0 ? <span className="muted">—</span> : visibleItems.map((entry) => <TimelineItemView key={`main-detail-${entry.id}`} item={entry} collapseReasoning={false} />)}
                          </div>
                        </article>
                      );
                    }

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="chat-feed-compact"
                        onClick={() => {
                          setSelectedFeedItemId(item.id);
                          setShowExecutionDrawer(true);
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, textAlign: "left" }}>
                            <span className="chat-feed-compact-title">{item.compactLabel}</span>
                            {item.preview ? <span className="chat-feed-compact-preview">{item.preview}</span> : null}
                          </div>
                          <span className="chat-feed-compact-status">{item.status === "error" ? "失败" : item.status === "started" ? "运行中" : "查看"}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {error ? <div className="toast">{error}</div> : null}

          <div style={{ display: "flex", flexDirection: "column" }}>
            <ComposerContextBar
              agentName={selectedAgentName || streamAgentId || "Default Agent"}
              mode={isReplayMode ? "Replay" : "Live"}
              isReplayActive={isReplayMode}
              onReplayToggle={() => {
                if (isReplayMode) {
                  setIsReplayMode(false);
                  setIsReplayingTest(false);
                  if (replayAbortRef.current) {
                    replayAbortRef.current.cancelled = true;
                  }
                } else {
                  void replayFromTestJson();
                }
              }}
              timelineSource={timelineStorageKey ? "Local" : "Live"}
              disabled={status === "boot"}
            />
            <div className="composer">
              <textarea
                className="input textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a message… (Ctrl/Cmd+Enter to send)"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void onSend();
                  }
                }}
              />
              <button className="btn btn-primary" onClick={() => void onSend()} disabled={!draft.trim() || status === "send"}>
                Send
              </button>
            </div>
          </div>
        </main>
      }
      right={showExecutionDrawer ? (
        <section className="panel panel-right execution-sidebar" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div className="header" style={{ minHeight: 56, padding: "10px 14px", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div className="eyebrow">Execution Center</div>
              <div className="section-title" style={{ fontSize: 18, margin: 0 }}>任务流</div>
            </div>
            <div style={{ flex: 1 }} />
            <span className="pill mono">tasks {taskFlowStates.length}</span>
            <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setShowExecutionDrawer(false)}>关闭</button>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: "hidden", background: "linear-gradient(180deg,#f8fafc 0%, #f1f5f9 100%)" }}>
            <div
              ref={taskFlowLayoutRef}
              style={{
                height: "100%",
                display: "grid",
                gridTemplateRows: `${taskFlowSectionHeights.top}px 8px minmax(${TASK_FLOW_MIDDLE_MIN_HEIGHT}px, 1fr) 8px ${taskFlowSectionHeights.preview}px`,
              }}
            >
              <div style={{ overflow: "auto", padding: 12, borderBottom: "1px solid var(--line-soft)", background: "rgba(255,255,255,0.78)" }}>
                <div style={{ display: "grid", gap: 10 }}>
                  {selectedTaskFlowState ? (
                    <div className="card" style={{ borderRadius: 16, boxShadow: "0 10px 30px rgba(15,23,42,0.08)" }}>
                      <div className="card-body" style={{ display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>当前任务：{selectedTaskFlowState.title}</div>
                          <span className="mono muted" style={{ fontSize: 11 }}>{selectedTaskFlowState.outerToolCallId?.slice(0, 12) ?? "[no-task-id]"}</span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          <span className="pill mono">steps {selectedTaskFlowState.timelineItems.length}</span>
                          <span className="pill mono">tools {selectedTaskFlowState.toolItems.length}</span>
                          <span className="pill mono">started {new Date(selectedTaskFlowState.firstAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {taskFlowStates.length === 0 ? <div className="muted">暂无子任务流。</div> : taskFlowStates.map((state) => {
                    const status = getTaskFlowStatus(state);
                    const statusTone = getTaskFlowStatusStyles(status);
                    const isActive = selectedTaskFlowState?.sourceKey === state.sourceKey;
                    return (
                      <button
                        key={`task-flow-${state.sourceKey}`}
                        type="button"
                        className="chat-feed-compact"
                        style={{
                          width: "100%",
                          textAlign: "left",
                          boxShadow: isActive ? "inset 0 0 0 1px rgba(59,130,246,0.4), 0 10px 24px rgba(15,23,42,0.08)" : "0 8px 20px rgba(15,23,42,0.05)",
                          borderRadius: 16,
                          background: isActive ? "linear-gradient(180deg, rgba(239,246,255,0.95), rgba(255,255,255,0.98))" : "rgba(255,255,255,0.95)",
                        }}
                        onClick={() => {
                          setSelectedFeedItemId(`feed-subagent-${state.sourceKey}`);
                          setSelectedWorkflowNodeId(null);
                          setShowTaskDetailCard(true);
                          setShowExecutionDrawer(true);
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                          <div style={{ display: "grid", gap: 4 }}>
                            <span className="chat-feed-compact-title" style={{ fontSize: 14 }}>{state.title}</span>
                            <span className="chat-feed-compact-preview">
                              {state.content.trim()
                                ? summarizePreview(state.content, 96)
                                : state.reasoning.trim()
                                  ? summarizePreview(state.reasoning, 96)
                                  : state.toolItems.length > 0
                                    ? `执行了 ${state.toolItems.length} 个工具步骤`
                                    : "等待任务流事件"}
                            </span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                              <span className="pill mono">messages {state.timelineItems.length}</span>
                              <span className="pill mono">tools {state.toolItems.length}</span>
                            </div>
                          </div>
                          <span className="chat-feed-compact-status" style={{ color: statusTone.color, background: statusTone.bg, border: `1px solid ${statusTone.border}`, padding: "4px 8px", borderRadius: 999 }}>{statusTone.label}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="panel-resizer horizontal" onPointerDown={(event) => startTaskFlowRowResize("top", event)} />

              <div style={{ overflow: "hidden", padding: 12, borderBottom: "1px solid var(--line-soft)", position: "relative" }}>
                  <div
                    ref={taskFlowCanvasScrollRef}
                    style={{ overflow: "auto", height: "100%", cursor: "grab" }}
                    onPointerDown={startTaskFlowCanvasPan}
                  >
                  <svg width={Math.max(turnWorkflowCanvas.width, 1600)} height={Math.max(turnWorkflowCanvas.height, 960)} style={{ display: "block" }}>
                    <text x={turnWorkflowCanvas.laneX.run} y={28} fontSize="11" fill="#64748b" className="mono">TURN</text>
                    <text x={turnWorkflowCanvas.laneX.agent} y={28} fontSize="11" fill="#64748b" className="mono">AGENTS</text>
                    <text x={turnWorkflowCanvas.laneX.tool} y={28} fontSize="11" fill="#64748b" className="mono">TOOLS</text>
                    {turnWorkflowCanvas.laneBands.map((lane, idx) => (
                      <g key={`sidebar-lane-${lane.id}`}>
                        <rect x={250} y={lane.y} width={560} height={lane.height} rx={12} fill={idx % 2 === 0 ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.04)"} stroke="rgba(148,163,184,0.14)" strokeWidth={1} />
                        <text x={258} y={lane.y + 16} fontSize="10" fill="#64748b" className="mono">{lane.label}</text>
                      </g>
                    ))}
                    {turnWorkflow.edges.map((edge) => {
                      const from = turnWorkflowCanvas.positions.get(edge.from);
                      const to = turnWorkflowCanvas.positions.get(edge.to);
                      if (!from || !to) return null;
                      const fromNode = workflowNodeById.get(edge.from);
                      const toNode = workflowNodeById.get(edge.to);
                      const isErrorPath = fromNode?.status === "error" || toNode?.status === "error";
                      const color = isErrorPath ? "#ef4444" : edge.kind === "invoke" ? "#3b82f6" : "#94a3b8";
                      return <path key={`sidebar-edge-${edge.id}`} d={`M ${from.x + 92} ${from.y + 20} C ${from.x + 176} ${from.y + 20}, ${to.x - 30} ${to.y + 20}, ${to.x} ${to.y + 20}`} stroke={color} strokeWidth={isErrorPath ? 2.1 : 1.5} fill="none" strokeDasharray={edge.kind === "spawn" ? "6 6" : "0"} />;
                    })}
                    {turnWorkflow.nodes.map((node) => {
                      const pos = turnWorkflowCanvas.positions.get(node.id);
                      if (!pos) return null;
                      const tone = node.status === "error" ? { bg: "#fee2e2", border: "#ef4444", fg: "#991b1b" } : node.status === "completed" ? { bg: "#dcfce7", border: "#22c55e", fg: "#166534" } : node.status === "running" ? { bg: "#dbeafe", border: "#3b82f6", fg: "#1d4ed8" } : { bg: "#e2e8f0", border: "#94a3b8", fg: "#334155" };
                      return (
                        <g key={`sidebar-node-${node.id}`} onClick={() => { setSelectedWorkflowNodeId(node.id); setShowTaskDetailCard(true); }} style={{ cursor: "pointer" }}>
                          <rect x={pos.x} y={pos.y} width={184} height={56} rx={12} fill={tone.bg} stroke={selectedWorkflowNodeId === node.id ? "#0f172a" : tone.border} strokeWidth={selectedWorkflowNodeId === node.id ? 2 : 1.2} />
                          <text x={pos.x + 10} y={pos.y + 20} fontSize="11" fill="#334155" style={{ fontWeight: 700 }}>{node.type.toUpperCase()}</text>
                          <text x={pos.x + 10} y={pos.y + 36} fontSize="12" fill="#0f172a" style={{ fontWeight: 700 }}>{node.label.slice(0, 22)}</text>
                          <text x={pos.x + 10} y={pos.y + 50} fontSize="10" fill={tone.fg}>{node.status}</text>
                        </g>
                        );
                      })}
                  </svg>
                  </div>
                  {showTaskDetailCard && (selectedWorkflowNode || selectedTaskFlowState) ? (
                    <div style={{ position: "absolute", top: 16, right: 16, width: "min(420px, calc(100% - 32px))", maxHeight: "calc(100% - 32px)", overflow: "auto", display: "grid", gap: 10, padding: 12, borderRadius: 16, background: "rgba(255,255,255,0.96)", border: "1px solid var(--line-soft)", boxShadow: "0 24px 50px rgba(15,23,42,0.16)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                        <div className="eyebrow">Task Detail</div>
                        <button className="btn" style={{ padding: "3px 8px", fontSize: 12 }} onClick={() => setShowTaskDetailCard(false)}>关闭</button>
                      </div>
                      {selectedWorkflowNode ? (
                        <div style={{ display: "grid", gap: 10 }}>
                          <div className="card"><div className="card-body"><div style={{ fontWeight: 700 }}>{selectedWorkflowNode.label}</div><div className="mono muted" style={{ fontSize: 11, marginTop: 4 }}>{selectedWorkflowNode.type} · {selectedWorkflowNode.status}</div></div></div>
                          {selectedWorkflowNode.detail ? <div className="card"><div className="card-title">Detail</div><div className="card-body"><RichContent content={selectedWorkflowNode.detail} className="timeline-rich" onArtifactClick={openArtifactPreview} /></div></div> : null}
                          <div style={{ display: "grid", gap: 10 }}>
                            {workflowFocusedItems.length === 0 ? <span className="muted">暂无任务步骤。</span> : workflowFocusedItems.map((item) => <TimelineItemView key={`workflow-item-${item.id}`} item={item} collapseReasoning={true} />)}
                          </div>
                        </div>
                      ) : selectedTaskFlowState ? (
                        <div style={{ display: "grid", gap: 10 }}>
                          <div className="card"><div className="card-body"><div style={{ fontWeight: 700 }}>{selectedTaskFlowState.title}</div><div className="mono muted" style={{ fontSize: 11, marginTop: 4 }}>{selectedTaskFlowState.outerToolCallId ?? "[no-task-id]"}</div></div></div>
                          {selectedTaskFlowState.reasoning.trim() ? <div className="card"><div className="card-title">Reasoning</div><div className="card-body"><RichContent content={selectedTaskFlowState.reasoning} className="timeline-rich" onArtifactClick={openArtifactPreview} /></div></div> : null}
                          {selectedTaskFlowState.content.trim() ? <div className="card"><div className="card-title">Content</div><div className="card-body"><RichContent content={selectedTaskFlowState.content} className="timeline-rich" onArtifactClick={openArtifactPreview} /></div></div> : null}
                          {detectArtifactReferences([selectedTaskFlowState.content, selectedTaskFlowState.reasoning, ...selectedTaskFlowState.timelineItems.map((item) => item.text || "")].filter(Boolean).join("\n")).length > 0 ? (
                            <div className="card">
                              <div className="card-title">产物链接</div>
                              <div className="card-body" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {detectArtifactReferences([selectedTaskFlowState.content, selectedTaskFlowState.reasoning, ...selectedTaskFlowState.timelineItems.map((item) => item.text || "")].filter(Boolean).join("\n")).map((artifact) => (
                                  <button key={artifact.id} type="button" className="btn" style={{ padding: "3px 8px", fontSize: 12, textDecoration: "underline", textUnderlineOffset: 3 }} onClick={() => void openArtifactPreview(artifact)}>{artifact.label}</button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
              </div>

              <div className="panel-resizer horizontal" onPointerDown={(event) => startTaskFlowRowResize("bottom", event)} />

              <div style={{ overflow: "auto", padding: 12, background: "rgba(255,255,255,0.92)" }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Artifact Preview</div>
                {!artifactPreview.artifact ? (
                  <div className="muted">点击 URL、HTML、文本地址或文件路径后在这里预览。</div>
                ) : artifactPreview.loading ? (
                  <div className="muted">正在加载 {artifactPreview.artifact.label}...</div>
                ) : artifactPreview.error ? (
                  <div className="muted" style={{ color: "#b91c1c" }}>{artifactPreview.error}</div>
                ) : artifactPreview.artifact.kind === "url" ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <a href={artifactPreview.content} target="_blank" rel="noreferrer" style={{ color: "#1d4ed8", textDecoration: "underline" }}>{artifactPreview.content}</a>
                    <iframe src={artifactPreview.content} title={artifactPreview.artifact.label} style={{ width: "100%", minHeight: 300, border: "1px solid var(--line-soft)", borderRadius: 12, background: "#fff" }} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
                  </div>
                ) : /html/i.test(artifactPreview.contentType) ? (
                  <RichContent content={artifactPreview.content} className="timeline-rich" onArtifactClick={openArtifactPreview} />
                ) : (
                  <RichContent content={artifactPreview.content} className="timeline-rich" onArtifactClick={openArtifactPreview} />
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    />
  );
}
