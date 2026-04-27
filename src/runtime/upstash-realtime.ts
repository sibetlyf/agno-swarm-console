type RealtimeSubscribeOptions = {
  events: string[];
  history?: { start?: string; end?: string; limit?: number };
  onData: (evt: { id?: string; event: string; data: unknown }) => void;
};

type ChannelHandle = {
  emit: (event: string, payload: unknown) => Promise<void>;
  subscribe: (opts: RealtimeSubscribeOptions) => Promise<() => void>;
};

type RealtimeClient = {
  channel: (name: string) => ChannelHandle;
};

type Entry = {
  id: string;
  event: string;
  data: unknown;
};

const historyByChannel = new Map<string, Entry[]>();
const listenersByChannel = new Map<string, Set<(entry: Entry) => void>>();
let sequence = 0;

function nextId() {
  sequence += 1;
  return `${Date.now()}-${sequence}`;
}

function getHistory(channel: string) {
  const existing = historyByChannel.get(channel);
  if (existing) return existing;
  const created: Entry[] = [];
  historyByChannel.set(channel, created);
  return created;
}

function getListeners(channel: string) {
  const existing = listenersByChannel.get(channel);
  if (existing) return existing;
  const created = new Set<(entry: Entry) => void>();
  listenersByChannel.set(channel, created);
  return created;
}

function shouldInclude(events: string[], event: string) {
  return events.length === 0 || events.includes(event);
}

export function isUpstashRealtimeConfigured() {
  // frontend-only mode: realtime is in-process memory bus
  return true;
}

export function getUpstashRealtime(): RealtimeClient {
  return {
    channel(name: string): ChannelHandle {
      return {
        async emit(event: string, payload: unknown) {
          const entry: Entry = { id: nextId(), event, data: payload ?? null };
          const history = getHistory(name);
          history.push(entry);
          if (history.length > 2000) {
            history.splice(0, history.length - 2000);
          }
          for (const listener of getListeners(name)) {
            listener(entry);
          }
        },
        async subscribe(opts: RealtimeSubscribeOptions) {
          const listener = (entry: Entry) => {
            if (!shouldInclude(opts.events, entry.event)) return;
            opts.onData({ id: entry.id, event: entry.event, data: entry.data });
          };

          const listeners = getListeners(name);
          listeners.add(listener);

          if (opts.history?.start === "-") {
            const limit = opts.history.limit ?? 2000;
            const history = getHistory(name).slice(-limit);
            for (const entry of history) {
              if (!shouldInclude(opts.events, entry.event)) continue;
              opts.onData({ id: entry.id, event: entry.event, data: entry.data });
            }
          }

          return async () => {
            listeners.delete(listener);
          };
        },
      };
    },
  };
}

export async function getUpstashRedis(): Promise<null> {
  return null;
}
