# agno-swarm-console

Agno Swarm Console - A standalone IM/SWARM visualization console for Agno OS agent events.

**Key features:**
- Frontend IM rendering (`/im`) and SWARM graph visualization (`/graph`)
- Agno OS bridge adapter for real-time event streaming
- CustomEvent metadata parsing including `metadata.raw_event` and `source=subagent` routing
- Tool lifecycle correlation by `tool_call_id`
- In-memory storage (no database required)

## Environment Variables

### Required
- `GLM_API_KEY` - ZhipuAI API key (or use `OPENROUTER_API_KEY` for OpenRouter)
- `AGNO_OS_BASE_URL` - Agno OS server URL (default: `http://127.0.0.1:7777`)

### Optional
- `LLM_PROVIDER` - LLM provider: `glm` (default) or `openrouter`
- `GLM_BASE_URL` - GLM API base URL (default: `https://open.bigmodel.cn/api/paas/v4/chat/completions`)
- `GLM_MODEL` - GLM model name (default: `glm-4.7`)
- `OPENROUTER_API_KEY` - OpenRouter API key (required when `LLM_PROVIDER=openrouter`)
- `OPENROUTER_BASE_URL` - OpenRouter base URL (default: `https://openrouter.ai/api/v1/chat/completions`)
- `OPENROUTER_MODEL` - OpenRouter model name
- `OPENROUTER_HTTP_REFERER` - HTTP Referer header for OpenRouter
- `OPENROUTER_APP_TITLE` - App title for OpenRouter
- `AGNO_OS_BRIDGE_ENABLED` - Enable Agno bridge (default: `true`)
- `AGNO_AGENT_ID` - Preferred fixed remote agent ID (auto-selects first if empty)
- `AGNO_OS_AGENT_ID` - Backward-compatible alias for fixed remote agent ID
- `NEXT_PUBLIC_BACKEND_ORIGIN` - Backend origin for frontend (e.g., `http://127.0.0.1:3018`)
- `NEXT_PUBLIC_DIRECT_BACKEND_MODE` - Direct backend mode (default: `false`)
- `REDIS_URL` - Redis URL for Upstash realtime (optional)

## Quick Start

```bash
cd agno-swarm-console
npm install
GLM_API_KEY=your_key npm run dev
```

Server runs at `http://127.0.0.1:3018`

## Usage Guide (Recommended)

### 1) Start Agno OS on fixed port (7777)

Ensure your Agno OS server is reachable at:

`http://127.0.0.1:7777`

If it uses a different host/port, set `AGNO_OS_BASE_URL`.

### 2) Configure target agent

Set either:
- `AGNO_AGENT_ID` (preferred)
- `AGNO_OS_AGENT_ID` (compat alias)

If neither is set, app will auto-pick the first agent from `GET /agents`.

Resolution order used at runtime:
1. `AGNO_AGENT_ID`
2. `AGNO_OS_AGENT_ID`
3. If stream target agent exists in remote `/agents`, use it
4. Otherwise fallback to first remote agent from `/agents`

### 3) Run console

```bash
cd agno-swarm-console
npm install
AGNO_OS_BASE_URL=http://127.0.0.1:7777 AGNO_AGENT_ID=your_agent_id GLM_API_KEY=your_key npm run dev
```

Open:
- `http://127.0.0.1:3018/im` (消息+工具流+SWARM视图)
- `http://127.0.0.1:3018/graph` (图形拓扑页)

### 4) Verify replay compatibility (test.json)

Use built-in smoke replay:

```bash
npm run test:replay
```

Optional custom replay file:

```bash
REPLAY_FILE=../test.json npm run test:replay
```

### 5) Production build

```bash
npm run build
npm run start
```

## Event Adaptation Notes

- Agno stream is normalized before UI rendering.
- `CustomEvent` is parsed with metadata support:
  - `metadata.raw_event`
  - `metadata.source` (`subagent` / `agent`)
  - `metadata.subagent_name`
  - `metadata.tool_call_id`
- Tool lifecycle (`started/completed/error`) is correlated by `tool_call_id`.

## Stream Debug Log (session JSON)

- Frontend now batches received stream JSON events and posts to:
  - `POST /api/debug/stream-log`
- Server stores session-scoped debug files at:
  - `.debug-stream/<sessionId>.json`
- Session id is shown in `/im` right panel as `Debug session`.

## LLM Provider Configuration

### Using GLM (default)
```bash
GLM_API_KEY=your_key npm run dev
```

### Using OpenRouter
```bash
LLM_PROVIDER=openrouter OPENROUTER_API_KEY=your_key npm run dev
```

## Agno OS Bridge

When Agno OS is running at `http://127.0.0.1:7777`:

1. The backend proxies SSE streams from AgentOS
2. Agno events are normalized to swarm-compatible format
3. CustomEvent metadata is parsed including:
   - `metadata.raw_event` - Full original Agno event
   - `metadata.source` - `subagent` or `agent`
   - `metadata.subagent_name` - Subagent name for UI grouping
   - `metadata.tool_call_id` - Tool lifecycle correlation
   - `metadata.parent_run_id` - Parent run tracking

## Frontend Pages

- **IM Page** (`/im`) - Real-time message rendering with SWARM visualization
- **Graph Page** (`/graph`) - Agent topology and message flow visualization

Both pages support:
- Multi-agent conversation threads
- Subagent hierarchy visualization
- Tool call lifecycle tracking
- Reasoning content display

## Architecture

- **No database dependency** - Uses in-memory store (`src/lib/swarm-memory-store.ts`)
- **Agno adapter** (`src/runtime/agno-adapter.ts`) - Handles Agno OS event streaming and parsing
- **Event normalization** - Converts Agno events to swarm-compatible format with full metadata preservation

## API Routes

- `GET /api/health` - Health check
- `GET/POST /api/workspaces` - List/create workspaces
- `GET/POST /api/groups` - List/create groups
- `GET/POST /api/groups/:groupId/messages` - List/send messages
- `GET /api/agents/:agentId/context-stream` - SSE stream for agent events
- `GET/POST /api/agents` - List/create agents
- `GET /api/agent-graph` - Get agent graph data
- `GET /api/ui-stream` - UI event stream for visualization

## Build

```bash
npm run build
npm run start
```

## Notes

- The in-memory store resets on server restart (for persistence, use the original swarm-ide with database)
- CustomEvent events are fully parsed with `metadata.raw_event` preserved for inspection
- Tool lifecycle is tracked by `tool_call_id` for deterministic ordering
- Subagent events are routed by `metadata.source=subagent` and grouped by `subagent_name`
