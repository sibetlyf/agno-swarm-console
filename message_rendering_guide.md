# Agent Message Model & Rendering Guide for Frontend

This document provides a detailed specification for parsing and rendering the multi-agent message stream found in `test.json`. It covers separate rendering for reasoning, tool calls, results, and content for both the main agent and subagents, including association logic for streaming and concurrent execution.

---

## 1. Message Stream Architecture

The message stream consists of a sequence of **Event Objects**. Each object represents a step in the agentic workflow (starting a run, generating content, calling a tool, etc.).

### Core Identifiers for Mapping
*   `session_id`: Global identifier for the entire conversation.
*   `run_id`: Uniquely identifies one interaction cycle (one request/response pair).
*   `agent_id` / `agent_name`: Identifies which agent produced the event.
*   `tool_call_id`: 
    *   **Main Stream**: Links `ToolCallStarted` and `ToolCallCompleted`.
    *   **Subagent Logic**: In `CustomEvent` objects, this ID links the subagent's activity back to the specific `assign_task` tool call made by the Orchestrator.

---

## 2. Main Agent (Orchestrator) Rendering

The Main Agent's events are top-level objects in the JSON array.

### A. Thinking / Reasoning
*   **Event**: `RunContent`
*   **Condition**: `reasoning_content` is not empty.
*   **Parsing**: Append `reasoning_content` to the reasoning block of the current `run_id`.
*   **Rendering**: Usually rendered in a collapsible "Thought" or "Reasoning" section.

### B. Content (Final Answer Chunks)
*   **Event**: `RunContent`
*   **Condition**: `content` is not empty.
*   **Parsing**: Append `content` to the main message body.
*   **Rendering**: Standard Markdown rendering.

### C. Tool Call
*   **Event**: `ToolCallStarted`
*   **Parsing**: 
    *   `tool.tool_name`: Name of the tool.
    *   `tool.tool_args`: Arguments passed.
    *   `tool.tool_call_id`: Store this to match the result later.
*   **Rendering**: Render a "Tool Calling" indicator with the name and arguments (e.g., a code block or structured tag).

### D. Tool Result
*   **Event**: `ToolCallCompleted`
*   **Parsing**:
    *   `tool.tool_call_id`: Match with the `ToolCallStarted`.
    *   `tool.result`: The output of the tool.
*   **Rendering**: Render the result below the corresponding tool call. If the tool is `assign_task`, this often serves as the "header" for the subagent's workspace.

---

## 3. Subagent Rendering

Subagent events are nested within `CustomEvent` objects to keep them associated with the Orchestrator's execution flow.

### A. Identification & Routing
*   **Event**: `CustomEvent`
*   **Condition**: `metadata.source == "subagent"`.
*   **Routing Key**: Use `tool_call_id` from the **top-level** `CustomEvent` object. All subagent chunks with the same `tool_call_id` belong to the same subagent task execution.
*   **Subagent Name**: `metadata.subagent_name`.

### B. Subagent Reasoning
*   **Event Path**: `metadata.raw_event` where `event == "RunContent"`.
*   **Condition**: `metadata.raw_event.reasoning_content` is not empty.
*   **Rendering**: Render in the subagent's specific "Reasoning" section.

### C. Subagent Content
*   **Event Path**: `metadata.raw_event` where `event == "RunContent"`.
*   **Condition**: `metadata.raw_event.content` is not empty.
*   **Rendering**: Render in the subagent's output area.

### D. Subagent Tool Calls & Results
*   **Tool Call Start**: `metadata.raw_event.event == "ToolCallStarted"`.
    *   Inner ID: `metadata.raw_event.tool.tool_call_id`.
*   **Tool Call Completion**: `metadata.raw_event.event == "ToolCallCompleted"`.
*   **Rendering**: Similar to the Main Agent, but scoped within the subagent's UI component.

---

## 4. Handling Concurrency & Streaming

### Concurrent Execution
In `test.json`, multiple subagents (e.g., "北京专家", "上海专家") run in parallel. Their `CustomEvent` chunks will be interleaved.

**Frontend Strategy:**
1.  Maintain a map of active subagent tasks: `Record<ToolCallID, SubagentState>`.
2.  When a `CustomEvent` arrives:
    *   Lookup `SubagentState` using `tool_call_id`.
    *   Update the specific subagent's reasoning/content/tools buffers.
    *   Trigger a re-render only for that specific component.

### Streaming Delta Logic
*   Messages are incremental. `RunContent` events for the same `run_id` should be concatenated.
*   The `type` field in `CustomEvent` (e.g., `"content"`, `"document"`) provides a hint for the UI (e.g., whether to show as a message chunk or a structured update).

---

## 5. Visual Mapping Table

| Element | Main Agent Path | Subagent Path (Nested in `CustomEvent`) |
| :--- | :--- | :--- |
| **Reasoning** | `RunContent.reasoning_content` | `metadata.raw_event.reasoning_content` |
| **Content** | `RunContent.content` | `metadata.raw_event.content` |
| **Tool Call** | `ToolCallStarted.tool` | `metadata.raw_event.tool` (where `event: ToolCallStarted`) |
| **Tool Result** | `ToolCallCompleted.tool.result` | `metadata.raw_event.tool.result` (where `event: ToolCallCompleted`) |
| **Mapping ID**| `run_id` | `tool_call_id` (outer) + `run_id` (inner) |

---

## 7. Streaming Examples (Real JSON Chunks)

To handle streaming, the frontend must concatenate the delta values from consecutive events. Below are real examples of how these chunks appear in the message stream.

### A. Main Agent Reasoning (Orchestrator Thinking)
**Chunk 1:**
```json
{
  "event": "RunContent",
  "run_id": "cedea636-1487-457f-9fa8-dfca40dd1d86",
  "reasoning_content": "用户",
  "content": ""
}
```
**Chunk 2:**
```json
{
  "event": "RunContent",
  "run_id": "cedea636-1487-457f-9fa8-dfca40dd1d86",
  "reasoning_content": "想要",
  "content": ""
}
```
*Result: "用户想要"*

### B. Main Agent Content (Orchestrator Output)
**Chunk 1:**
```json
{
  "event": "RunContent",
  "run_id": "cedea636-1487-457f-9fa8-dfca40dd1d86",
  "reasoning_content": "",
  "content": "\n\n太好了"
}
```
**Chunk 2:**
```json
{
  "event": "RunContent",
  "run_id": "cedea636-1487-457f-9fa8-dfca40dd1d86",
  "reasoning_content": "",
  "content": "！三个子智能"
}
```
*Result: "\n\n太好了！三个子智能"*

### C. Subagent Reasoning (Nested in CustomEvent)
**Chunk 1:**
```json
{
  "event": "CustomEvent",
  "tool_call_id": "call_04af08d0468648948d8828f0",
  "metadata": {
    "source": "subagent",
    "raw_event": {
      "event": "RunContent",
      "reasoning_content": "用户",
      "content": null
    }
  }
}
```
**Chunk 2:**
```json
{
  "event": "CustomEvent",
  "tool_call_id": "call_04af08d0468648948d8828f0",
  "metadata": {
    "source": "subagent",
    "raw_event": {
      "event": "RunContent",
      "reasoning_content": "需要我",
      "content": null
    }
  }
}
```
*Result for Subagent `call_04af...`: "用户需要我"*

### D. Subagent Content (Nested in CustomEvent)
**Chunk 1:**
```json
{
  "event": "CustomEvent",
  "tool_call_id": "call_04af08d0468648948d8828f0",
  "metadata": {
    "source": "subagent",
    "raw_event": {
      "event": "RunContent",
      "reasoning_content": "",
      "content": "现在让我整理"
    }
  }
}
```
**Chunk 2:**
```json
{
  "event": "CustomEvent",
  "tool_call_id": "call_04af08d0468648948d8828f0",
  "metadata": {
    "source": "subagent",
    "raw_event": {
      "event": "RunContent",
      "reasoning_content": "",
      "content": "成一份完整的上海"
    }
  }
}
```
*Result for Subagent `call_04af...`: "现在让我整理成一份完整的上海"*

---

## 8. Concurrent Tool Call Example

When multiple tools are called (e.g., three subagents assigned tasks simultaneously):

1.  **Orchestrator** emits 3 `ToolCallStarted` events:
    *   `call_A` (北京旅行攻略专家)
    *   `call_B` (上海旅行攻略专家)
    *   `call_C` (西安旅行攻略专家)
2.  **Stream** starts receiving `CustomEvent` objects:
    *   `CustomEvent` (ID: `call_B`) -> "上海的..."
    *   `CustomEvent` (ID: `call_A`) -> "北京的..."
    *   `CustomEvent` (ID: `call_B`) -> "...天气不错"
    *   `CustomEvent` (ID: `call_C`) -> "西安是..."

**Frontend Implementation:**
```javascript
// Example state update
function onEvent(event) {
  if (event.event === "RunContent") {
    updateMainMessage(event.run_id, event.content, event.reasoning_content);
  } else if (event.event === "CustomEvent" && event.metadata.source === "subagent") {
    const subId = event.tool_call_id;
    const raw = event.metadata.raw_event;
    updateSubagentView(subId, raw.content, raw.reasoning_content);
  }
}
```

---

## 9. Complete Tool Call & Result JSON Examples

To ensure the frontend can correctly parse tool interactions, here are the full JSON objects for tool start and completion, including all original parameters.

### A. Main Agent: Tool Call Started (Complete)
```json
{
  "created_at": 1776134404,
  "event": "ToolCallStarted",
  "agent_id": "orchestrator-5e190317-f017-4877-8749-423fd7279ca7",
  "agent_name": "Orchestrator",
  "run_id": "cedea636-1487-457f-9fa8-dfca40dd1d86",
  "session_id": "session_123",
  "tool": {
    "tool_call_id": "call_61dabaa792b44af2ae93195b",
    "tool_name": "create_subagent",
    "tool_args": {
      "name": "北京旅行攻略专家",
      "description": "专注于北京旅行攻略的子智能体，负责查询北京的景点、美食、交通、住宿等旅行信息",
      "instructions": "你是一位北京旅行攻略专家，负责为用户提供详细的北京旅行攻略。你需要：\n1. 搜索北京的热门景点、美食推荐、住宿建议\n2. 查询北京的交通信息和最佳游览路线\n3. 提供实用的旅行贴士和注意事项\n4. 整合信息形成完整的旅行攻略",
      "tools": [
        "get_search",
        "search_poi",
        "direction_transit_integrated",
        "distance_calculation",
        "get_weather"
      ],
      "skills": []
    },
    "tool_call_error": null,
    "result": null,
    "metrics": null,
    "child_run_id": null,
    "stop_after_tool_call": false,
    "created_at": 1776134404,
    "requires_confirmation": null,
    "confirmed": null,
    "confirmation_note": null,
    "requires_user_input": null,
    "user_input_schema": null,
    "user_feedback_schema": null,
    "answered": null,
    "external_execution_required": null,
    "external_execution_silent": null,
    "approval_type": null,
    "approval_id": null
  }
}
```

### B. Main Agent: Tool Call Completed (Complete)
```json
{
  "created_at": 1776134405,
  "event": "ToolCallCompleted",
  "agent_id": "orchestrator-5e190317-f017-4877-8749-423fd7279ca7",
  "agent_name": "Orchestrator",
  "run_id": "cedea636-1487-457f-9fa8-dfca40dd1d86",
  "session_id": "session_123",
  "content": "create_subagent(...) completed in 0.0041s. ",
  "tool": {
    "tool_call_id": "call_61dabaa792b44af2ae93195b",
    "tool_name": "create_subagent",
    "tool_args": {
      "name": "北京旅行攻略专家",
      "description": "专注于北京旅行攻略的子智能体，负责查询北京的景点、美食、交通、住宿等旅行信息",
      "instructions": "你是一位北京旅行攻略专家...",
      "tools": ["get_search", "search_poi", "direction_transit_integrated", "distance_calculation", "get_weather"],
      "skills": []
    },
    "tool_call_error": false,
    "result": "{'name': '北京旅行攻略专家', 'description': '专注于北京旅行攻略的子智能体...', 'msg': '创建子智能体北京旅行攻略专家成功！你可以通过`assign_task`指令将任务分配给它'}",
    "metrics": {
      "start_time": 1776134404.9995694,
      "end_time": 1776134405.003697,
      "duration": 0.004127600004721899
    },
    "child_run_id": null,
    "stop_after_tool_call": false,
    "created_at": 1776134405,
    "requires_confirmation": null,
    "confirmed": null,
    "confirmation_note": null,
    "requires_user_input": null,
    "user_input_schema": null,
    "user_feedback_schema": null,
    "answered": null,
    "external_execution_required": null,
    "external_execution_silent": null,
    "approval_type": null,
    "approval_id": null
  }
}
```

### C. Subagent: Tool Call Started (Nested CustomEvent)
```json
{
  "created_at": 1776134453,
  "event": "CustomEvent",
  "agent_id": "orchestrator-5e190317-f017-4877-8749-423fd7279ca7",
  "agent_name": "Orchestrator",
  "run_id": "cedea636-1487-457f-9fa8-dfca40dd1d86",
  "session_id": "session_123",
  "content": "",
  "tool_call_id": "call_5c41e53236a944d8a1e7d8aa",
  "type": "document",
  "metadata": {
    "source": "subagent",
    "subagent_name": "北京旅行攻略专家",
    "event": "ToolCallStarted",
    "content_type": "",
    "agent_id": "北京旅行攻略专家-5e190317-f017-4877-8749-423fd7279ca7",
    "agent_name": "北京旅行攻略专家",
    "run_id": "9cfbb1ac-a57e-4b87-810c-15961efcadad",
    "parent_run_id": null,
    "session_id": "北京旅行攻略专家-5e190317-f017-4877-8749-423fd7279ca7",
    "tool_call_id": null,
    "tool": {
      "tool_call_id": "call_697bc159c850471b91d9ae85",
      "tool_name": "search_poi",
      "tool_args": {
        "keywords": "故宫",
        "city": "北京",
        "citylimit": true
      },
      "tool_call_error": null,
      "result": null,
      "metrics": null,
      "child_run_id": null,
      "stop_after_tool_call": false,
      "created_at": 1776134453,
      "requires_confirmation": null,
      "confirmed": null,
      "confirmation_note": null,
      "requires_user_input": null,
      "user_input_schema": null,
      "user_feedback_schema": null,
      "answered": null,
      "external_execution_required": null,
      "external_execution_silent": null,
      "approval_type": null,
      "approval_id": null
    },
    "model_provider_data": null,
    "citations": null,
    "extra_data": null,
    "raw_event": {
      "created_at": 1776134453,
      "event": "ToolCallStarted",
      "agent_id": "北京旅行攻略专家-5e190317-f017-4877-8749-423fd7279ca7",
      "agent_name": "北京旅行攻略专家",
      "run_id": "9cfbb1ac-a57e-4b87-810c-15961efcadad",
      "parent_run_id": null,
      "session_id": "北京旅行攻略专家-5e190317-f017-4877-8749-423fd7279ca7",
      "workflow_id": null,
      "workflow_run_id": null,
      "step_id": null,
      "step_name": null,
      "step_index": null,
      "tools": null,
      "content": null,
      "tool": {
        "tool_call_id": "call_697bc159c850471b91d9ae85",
        "tool_name": "search_poi",
        "tool_args": {
          "keywords": "故宫",
          "city": "北京",
          "citylimit": true
        },
        "tool_call_error": null,
        "result": null,
        "metrics": null,
        "child_run_id": null,
        "stop_after_tool_call": false,
        "created_at": 1776134453,
        "requires_confirmation": null,
        "confirmed": null,
        "confirmation_note": null,
        "requires_user_input": null,
        "user_input_schema": null,
        "user_feedback_schema": null,
        "answered": null,
        "external_execution_required": null,
        "external_execution_silent": null,
        "approval_type": null,
        "approval_id": null
      }
    }
  }
}
```

### D. Subagent: Tool Call Completed (Nested CustomEvent)
```json
{
  "created_at": 1776134492,
  "event": "CustomEvent",
  "agent_id": "orchestrator-5e190317-f017-4877-8749-423fd7279ca7",
  "agent_name": "Orchestrator",
  "run_id": "cedea636-1487-457f-9fa8-dfca40dd1d86",
  "session_id": "session_123",
  "content": "search_poi(keywords=北京烤鸭, city=北京, citylimit=True) completed in 7.9676s. ",
  "tool_call_id": "call_5c41e53236a944d8a1e7d8aa",
  "type": "document",
  "metadata": {
    "source": "subagent",
    "subagent_name": "北京旅行攻略专家",
    "event": "ToolCallCompleted",
    "content_type": "",
    "agent_id": "北京旅行攻略专家-5e190317-f017-4877-8749-423fd7279ca7",
    "agent_name": "北京旅行攻略专家",
    "run_id": "9cfbb1ac-a57e-4b87-810c-15961efcadad",
    "parent_run_id": null,
    "session_id": "北京旅行攻略专家-5e190317-f017-4877-8749-423fd7279ca7",
    "tool_call_id": null,
    "tool": {
      "tool_call_id": "call_478dd75359b1433197f659bc",
      "tool_name": "search_poi",
      "tool_args": {
        "keywords": "北京烤鸭",
        "city": "北京",
        "citylimit": true
      },
      "tool_call_error": false,
      "result": "{\"title\": \"🔍 周边搜索结果（共20个）\", \"content\": \"...\"}",
      "metrics": {
        "start_time": 1776134484.6261973,
        "end_time": 1776134492.5938447,
        "duration": 7.967647299999953
      },
      "child_run_id": null,
      "stop_after_tool_call": false,
      "created_at": 1776134492,
      "requires_confirmation": null,
      "confirmed": null,
      "confirmation_note": null,
      "requires_user_input": null,
      "user_input_schema": null,
      "user_feedback_schema": null,
      "answered": null,
      "external_execution_required": null,
      "external_execution_silent": null,
      "approval_type": null,
      "approval_id": null
    },
    "raw_event": {
      "created_at": 1776134492,
      "event": "ToolCallCompleted",
      "agent_id": "北京旅行攻略专家-5e190317-f017-4877-8749-423fd7279ca7",
      "agent_name": "北京旅行攻略专家",
      "run_id": "9cfbb1ac-a57e-4b87-810c-15961efcadad",
      "parent_run_id": null,
      "session_id": "北京旅行攻略专家-5e190317-f017-4877-8749-423fd7279ca7",
      "tool": {
        "tool_call_id": "call_478dd75359b1433197f659bc",
        "tool_name": "search_poi",
        "tool_args": {
          "keywords": "北京烤鸭",
          "city": "北京",
          "citylimit": true
        },
        "tool_call_error": false,
        "result": "...",
        "metrics": { "duration": 7.9676 },
        "created_at": 1776134492
      }
    }
  }
}
```
