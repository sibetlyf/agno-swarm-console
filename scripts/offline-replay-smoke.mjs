import fs from "node:fs";
import path from "node:path";

function readJson(filePath) {
  const text = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error(`${filePath} is not a JSON array`);
  }
  return parsed;
}

function assertEventShape(events, name) {
  if (events.length === 0) {
    throw new Error(`${name}: empty replay data`);
  }
  for (const [i, evt] of events.entries()) {
    if (!evt || typeof evt !== "object") {
      throw new Error(`${name}: item[${i}] is not an object`);
    }
    if (typeof evt.event !== "string" || evt.event.length === 0) {
      throw new Error(`${name}: item[${i}] missing event`);
    }
  }
}

function assertCoverage(events, name) {
  const set = new Set(events.map((e) => e.event));
  const must = ["RunStarted", "RunContent"];
  for (const m of must) {
    if (!set.has(m)) {
      throw new Error(`${name}: missing required event ${m}`);
    }
  }
}

function assertSubagentCompatibility() {
  const sample = {
    event: "RunContent",
    content_type: "run_content",
    content: "hello",
    source: "subagent",
    subagent_name: "poet",
    agent_id: "agent-sub-1",
    agent_name: "poet",
    run_id: "run-sub-1",
    parent_run_id: "run-parent-1",
  };

  const required = ["source", "subagent_name", "agent_id", "run_id", "parent_run_id"];
  for (const key of required) {
    if (typeof sample[key] !== "string" || sample[key].length === 0) {
      throw new Error(`subagent compatibility sample missing ${key}`);
    }
  }

  const nested = {
    event: "RunContent",
    content_type: "run_content",
    content: "hi",
    metadata: {
      source: "subagent",
      subagent_name: "coder",
      agent_name: "coder",
      run_id: "run-sub-2",
      parent_run_id: "run-parent-2",
    },
  };

  if (
    !nested.metadata ||
    nested.metadata.source !== "subagent" ||
    typeof nested.metadata.subagent_name !== "string"
  ) {
    throw new Error("subagent nested metadata compatibility sample invalid");
  }
}

function main() {
  const cwd = process.cwd();
  const fromEnv = process.env.REPLAY_FILE ? [path.resolve(cwd, process.env.REPLAY_FILE)] : [];
  const candidateRaw = [
    ...fromEnv,
    path.resolve(cwd, "../test.json"),
    path.resolve(cwd, "../../test.json"),
    path.resolve(cwd, "../../../replay_render_test.json"),
    path.resolve(cwd, "../../../replay_preview.json"),
  ];
  const candidates = [...new Set(candidateRaw.map((p) => path.normalize(p)))].filter((p) => fs.existsSync(p));

  if (candidates.length === 0) {
    throw new Error("No replay files found (tried REPLAY_FILE, ../test.json, ../../test.json, replay_render_test.json, replay_preview.json)");
  }

  for (const file of candidates) {
    const events = readJson(file);
    const name = path.basename(file);
    assertEventShape(events, name);
    assertCoverage(events, name);
    const kinds = new Set(events.map((e) => e.content_type).filter(Boolean));
    console.log(`[offline-replay] ${name}: ${events.length} events, content_types=${[...kinds].join(", ")}`);
  }

  assertSubagentCompatibility();

  console.log("[offline-replay] smoke test passed");
}

main();
