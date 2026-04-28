# AGENTS.md

## What this repo is
- Single-package Next.js App Router project (`package.json` only, npm lockfile present).
- Purpose: IM + SWARM visualization console for Agno OS streams (`README.md`).
- Storage is in-memory only via `src/lib/swarm-memory-store.ts` (state resets on server restart).

## Exact developer commands
- Install: `npm install`
- Dev server: `npm run dev` → binds `127.0.0.1:3018`
- Build: `npm run build` → `next build --webpack`
- Start prod server: `npm run start` → binds `127.0.0.1:3018`
- Lint: `npm run lint`
- Replay smoke test: `npm run test:replay`

### Focused verification (no dedicated script exists)
- Typecheck is not scripted; use: `npx tsc --noEmit`
- Practical local order for changes touching runtime/UI:
  1) `npm run lint`
  2) `npx tsc --noEmit`
  3) `npm run test:replay` (if event/stream/render logic changed)

## Required runtime/env facts
- Core envs used by runtime paths:
  - `AGNO_OS_BASE_URL` (default `http://127.0.0.1:7777`)
  - `AGNO_OS_BRIDGE_ENABLED` (default true unless explicitly `false`)
  - `AGNO_AGENT_ID` (preferred fixed remote agent) or `AGNO_OS_AGENT_ID` (alias)
  - `GLM_API_KEY` (or `OPENROUTER_API_KEY` when `LLM_PROVIDER=openrouter`)
- Frontend backend-origin switching is controlled by:
  - `NEXT_PUBLIC_BACKEND_ORIGIN`
  - `NEXT_PUBLIC_DIRECT_BACKEND_MODE`
  (see `app/im/page.tsx`)

## Architecture map (only high-signal boundaries)
- `app/`
  - UI pages: `/im`, `/graph`, root page.
  - API routes under `app/api/**`; these routes are explicitly Node runtime (`export const runtime = "nodejs"`).
- `src/lib/`
  - `swarm-memory-store.ts`: all workspace/agent/group/message state + default workspace bootstrap.
  - `config.ts`: reads `config/app.json` (`tokenLimit`) with in-process cache.
- `src/runtime/`
  - `agno-adapter.ts`: bridges AgentOS SSE, normalizes events, routes subagent metadata, correlates tool lifecycle by `tool_call_id`.
  - `agno-event-processor.ts`: dedupe + reorder window for near-simultaneous events.
  - `ui-bus.ts` and `bridge-bus.ts`: in-memory event buses backing `/api/ui-stream` and `/api/agents/[agentId]/context-stream`.
  - `mcp.ts`: loads MCP servers from config and registers MCP tools dynamically.

## Stream/test/debug quirks agents often miss
- `scripts/offline-replay-smoke.mjs` requires replay JSON array and enforces presence of `RunStarted` + `RunContent`.
- Replay file lookup order includes `REPLAY_FILE` env and several parent-relative fallbacks; keep this in mind before declaring replay failures.
- Stream debug persistence writes session files to `.debug-stream/<sessionId>.json` via `POST /api/debug/stream-log`.

## Config/toolchain quirks
- ESLint is flat config (`eslint.config.mjs`) with `eslint-config-next/core-web-vitals`.
- Tailwind uses v4 PostCSS plugin (`@tailwindcss/postcss`) in `postcss.config.js`.
- TS path aliases are active (`@/lib/*`, `@/runtime/*`, `@/app/*`) in `tsconfig.json`.
- Two Next config files exist (`next.config.ts` and `next.config.mjs`); verify both before changing Next build/runtime config.

## Workspace artifact scanning behavior
- `GET /api/workspace-artifacts` resolves workspace from backend endpoint (`/workspace`, `/api/workspace`, `/api/debug/workspace`) or env (`WORKSPACE`/`RUNSPACE`).
- It recursively scans up to 200 JSON files and extracts subagent cards + todo docs.
- If this endpoint appears empty, first verify filesystem readability of resolved workspace/runspace.

## Security/ops gotcha
- `mcp.json` currently contains inline credentials/API keys. Treat it as sensitive; do not copy values into commits, docs, logs, or PR text.
