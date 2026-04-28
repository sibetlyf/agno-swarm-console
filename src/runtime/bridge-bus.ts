import { AgentEventBus } from "./event-bus";

let bridgeBus: AgentEventBus | null = null;

export function getBridgeBus() {
  if (!bridgeBus) bridgeBus = new AgentEventBus();
  return bridgeBus;
}
