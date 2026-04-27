# Agno `test.json` 消息体全量梳理 + swarm-ide 前端渲染方案

## 1. 数据来源与说明

- 主分析文件：`G:\MOMA\llm-host-claw\test.json`
- 同哈希副本：`G:\MOMA\llm-host-claw\hostclaw-ui\test.json`
- 文件条目总数：**635**

> 注：`agent-ui/test.json` 与上面两个文件哈希不同，本分析仅基于你前面反复提到的根目录 `test.json`（与 `hostclaw-ui/test.json` 一致）。

---

## 2. 消息体类型统计（event 维度）

| event | count |
|---|---:|
| RunStarted | 1 |
| ModelRequestStarted | 3 |
| RunContent | 191 |
| ModelRequestCompleted | 3 |
| ToolCallStarted | 6 |
| ToolCallCompleted | 6 |
| CustomEvent | 421 |
| RunContentCompleted | 1 |
| SessionSummaryStarted | 1 |
| SessionSummaryCompleted | 1 |
| RunCompleted | 1 |

结论：**CustomEvent + RunContent 占绝对多数**，前端渲染必须以这两类为主路径。

---

## 3. 每类消息体字段全集（keys union）

### 3.1 RunStarted
字段：
`agent_id, agent_name, created_at, event, model, model_provider, run_id, session_id`

### 3.2 ModelRequestStarted
字段：
`agent_id, agent_name, created_at, event, model, model_provider, run_id, session_id`

### 3.3 RunContent
字段：
`agent_id, agent_name, content, content_type, created_at, event, model_provider_data, reasoning_content, run_id, session_id, workflow_agent`

### 3.4 ModelRequestCompleted
字段：
`agent_id, agent_name, cache_read_tokens, cache_write_tokens, created_at, event, input_tokens, model, model_provider, output_tokens, reasoning_tokens, run_id, session_id, time_to_first_token, total_tokens`

### 3.5 ToolCallStarted
字段：
`agent_id, agent_name, created_at, event, run_id, session_id, tool`

### 3.6 ToolCallCompleted
字段：
`agent_id, agent_name, content, created_at, event, run_id, session_id, tool`

### 3.7 CustomEvent
字段：
`agent_id, agent_name, content, created_at, event, metadata, run_id, session_id, tool_call_id, type`

### 3.8 RunContentCompleted
字段：
`agent_id, agent_name, created_at, event, run_id, session_id`

### 3.9 SessionSummaryStarted
字段：
`agent_id, agent_name, created_at, event, run_id, session_id`

### 3.10 SessionSummaryCompleted
字段：
`agent_id, agent_name, created_at, event, run_id, session_id, session_summary`

### 3.11 RunCompleted
字段：
`agent_id, agent_name, content, content_type, created_at, event, metrics, model_provider_data, reasoning_content, run_id, session_id, session_state`

---

## 4. content_type 统计

- 全局 `content_type`：`str` 为主（192）
- `CustomEvent.metadata.content_type`：
  - `str`: 295
  - 空字符串/空值（主要对应 document 类型投影）: 126

---

## 5. CustomEvent 重点拆解（尤其 metadata）

### 5.1 CustomEvent.type 分布

| type | count |
|---|---:|
| content | 295 |
| document | 126 |

### 5.2 `metadata.event` 分布（CustomEvent 内）

| metadata.event | count |
|---|---:|
| RunContent | 295 |
| ToolCallStarted | 54 |
| ToolCallCompleted | 54 |
| ToolCallError | 18 |

### 5.3 `metadata` 字段全集

`agent_id, agent_name, citations, content_type, event, extra_data, model_provider_data, parent_run_id, raw_event, run_id, session_id, source, subagent_name, tool, tool_call_id`

其中最关键：
- `source`：通常为 `subagent`
- `subagent_name`：子代理名（UI 分组主键）
- `event`：原始事件类型（RunContent/ToolCall*）
- `run_id` / `parent_run_id`：父子链路
- `tool`：工具调用详情
- `raw_event`：原始 Agno 事件完整对象（最权威回放源）

### 5.4 `metadata.raw_event` 字段全集

`additional_input, agent_id, agent_name, audio, citations, content, content_type, created_at, error, event, image, images, model_provider_data, parent_run_id, reasoning_content, reasoning_messages, reasoning_steps, references, response_audio, run_id, session_id, step_id, step_index, step_name, tool, tools, videos, workflow_agent, workflow_id, workflow_run_id`

> 结论：前端如果只依赖顶层 `content`，会丢失大量结构化上下文；应将 `raw_event` 作为“高级详情面板”的主数据源。

---

## 6. 典型消息样例（精简）

### 6.1 RunContent（主内容流）
```json
{
  "event": "RunContent",
  "content": "...",
  "content_type": "str",
  "reasoning_content": "...",
  "run_id": "...",
  "session_id": "..."
}
```

### 6.2 ToolCallStarted / ToolCallCompleted
```json
{
  "event": "ToolCallStarted",
  "tool": {
    "tool_call_id": "call_xxx",
    "tool_name": "create_subagent",
    "tool_args": {"...": "..."}
  }
}
```

```json
{
  "event": "ToolCallCompleted",
  "content": "create_subagent(...) completed ...",
  "tool": {
    "tool_call_id": "call_xxx",
    "tool_name": "create_subagent",
    "result": "..."
  }
}
```

### 6.3 CustomEvent（subagent 投影）
```json
{
  "event": "CustomEvent",
  "type": "content",
  "content": "...",
  "tool_call_id": "call_xxx",
  "metadata": {
    "source": "subagent",
    "subagent_name": "...",
    "event": "RunContent",
    "run_id": "...",
    "parent_run_id": null,
    "tool": null,
    "raw_event": {"event": "RunContent", "reasoning_content": "...", "content": "..."}
  }
}
```

---

## 7. 基于 swarm-ide 的更合理前端渲染方案

> 目标：保证 Agno 标准流式事件“完整可见、层次清晰、可追踪 subagent 父子关系”。

### 7.1 统一前端事件模型（建议）

新增一个标准化结构 `NormalizedStreamItem`：

```ts
type NormalizedStreamItem = {
  id: string;                 // 本地生成
  ts: number;                 // created_at/now
  phase: 'lifecycle' | 'reasoning' | 'content' | 'tool' | 'summary' | 'error';
  kind: string;               // RunContent / ToolCallStarted / CustomEvent ...
  source: 'agent' | 'subagent';
  agentName?: string;
  subagentName?: string;
  runId?: string;
  parentRunId?: string;
  toolCallId?: string;
  text?: string;              // 可直接展示的文本
  payload: unknown;           // 原始事件体（完整保留）
}
```

### 7.2 渲染分层（强烈建议）

1. **主对话层（Content Lane）**
   - 仅展示用户最关心文本：`RunContent.content` + `CustomEvent(type=content).content`
   - 按 `source/subagent_name` 打标签

2. **思考层（Reasoning Lane）**
   - 展示 `reasoning_content`
   - 合并连续 chunk（同 runId + source）

3. **工具层（Tool Lane）**
   - `ToolCallStarted/Completed/Error`
   - 以 `tool_call_id` 为主键折叠成一个卡片
   - 卡片内展示 `args/result/error`

4. **生命周期层（Lifecycle Lane）**
   - RunStarted / ModelRequest* / RunContentCompleted / RunCompleted
   - 默认折叠，仅调试展开

5. **摘要层（Summary Lane）**
   - SessionSummaryStarted/Completed 单独展示

### 7.3 CustomEvent 专项策略（关键）

- `type=content`：走主对话层
- `type=document`：走文档层（可点击展开 raw_event）
- 所有 CustomEvent 都保留 `metadata.raw_event` 的 JSON 查看入口
- `metadata.source=subagent` 时，按 `subagent_name + run_id` 分组显示子线程

### 7.4 去重与并流规则

- 去重键建议：
  - 优先 `run_id + event + tool_call_id + created_at + text_hash`
  - 其次 `event + created_at + content_hash`
- 合并规则：
  - 连续 RunContent 且同 runId/source -> 追加文本
  - 连续 reasoning_content 同 runId/source -> 追加 reasoning buffer

### 7.5 性能与可观测性

- UI 内存缓冲上限（例如 5k items），超出归档到 IndexedDB
- 对 `payload` 只做惰性 JSON 展开（避免首屏卡顿）
- 增加“事件类型过滤器”与“只看异常”开关

### 7.6 与当前 swarm-ide 对接建议

你当前已在 `page.tsx` 做了 `normalizeIncomingAgentSseEvent`，下一步建议：

1. 把现有 `normalizeAgentStreamChunk` 升级为“**chunk + card 双模型**”
2. 新增 `useStreamReducer`，统一做去重/合并/分层
3. 在 UI 上拆成 4 个可折叠面板（content/reasoning/tools/lifecycle）
4. 对 CustomEvent 增加 `metadata` Inspector（默认折叠）

---

## 8. 结论

1. `test.json` 的核心不是“纯文本流”，而是“**Agno 事件 + 大量 CustomEvent 投影**”。
2. `CustomEvent.metadata`（尤其 `raw_event`）包含最完整语义，必须作为前端高级渲染的数据主源之一。
3. 对 swarm-ide，最合理的方向是“分层渲染 + 事件归一化 + 子代理分组 + 工具调用折叠卡片”。
