type UUID = string;

type Workspace = { id: UUID; name: string; createdAt: string };
type Agent = {
  id: UUID;
  workspaceId: UUID;
  role: string;
  parentId: UUID | null;
  createdAt: string;
  llmHistory: string;
};
type Group = {
  id: UUID;
  workspaceId: UUID;
  name: string | null;
  memberIds: UUID[];
  contextTokens: number;
  createdAt: string;
  updatedAt: string;
};
type Message = {
  id: UUID;
  workspaceId: UUID;
  groupId: UUID;
  senderId: UUID;
  contentType: string;
  content: string;
  sendTime: string;
};

const workspaces = new Map<UUID, Workspace>();
const agents = new Map<UUID, Agent>();
const groups = new Map<UUID, Group>();
const messages: Message[] = [];
const lastReadByGroupAgent = new Map<string, UUID | null>();

function nowIso() {
  return new Date().toISOString();
}

function rid(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function initialAgentHistory(input: { agentId: UUID; workspaceId: UUID; role: string; guidance?: string }) {
  const base =
    `You are an agent in an IM system.\n` +
    `Your agent_id is: ${input.agentId}.\n` +
    `Your workspace_id is: ${input.workspaceId}.\n` +
    `Your role is: ${input.role}.\n` +
    `Act strictly as this role when replying. Be concise and helpful.\n` +
    `Your replies are NOT automatically delivered to humans.\n` +
    `To send messages, you MUST call tools like send_group_message or send_direct_message.`;
  const history: Array<{ role: "system"; content: string }> = [{ role: "system", content: base }];
  const guidance = (input.guidance ?? "").trim();
  if (guidance) history.push({ role: "system", content: `Additional instructions:\n${guidance}` });
  return JSON.stringify(history);
}

function groupReadKey(groupId: UUID, agentId: UUID) {
  return `${groupId}:${agentId}`;
}

async function listRemoteAgents() {
  const base = (process.env.AGNO_OS_BASE_URL || "http://127.0.0.1:7777").replace(/\/$/, "");
  const res = await fetch(`${base}/agents`, { method: "GET" });
  if (!res.ok) return [] as Array<{ id: string; name?: string }>;
  const body = (await res.json().catch(() => [])) as unknown;
  if (Array.isArray(body)) return body as Array<{ id: string; name?: string }>;
  if (body && typeof body === "object" && Array.isArray((body as { agents?: unknown[] }).agents)) {
    return (body as { agents: Array<{ id: string; name?: string }> }).agents;
  }
  return [] as Array<{ id: string; name?: string }>;
}

function unreadMessagesForAgent(groupId: UUID, agentId: UUID) {
  const group = groups.get(groupId);
  if (!group || !group.memberIds.includes(agentId)) return [] as Message[];
  const all = messages.filter((m) => m.groupId === groupId).sort((a, b) => a.sendTime.localeCompare(b.sendTime));
  const lastRead = lastReadByGroupAgent.get(groupReadKey(groupId, agentId)) ?? null;
  if (!lastRead) return all.filter((m) => m.senderId !== agentId);
  const idx = all.findIndex((m) => m.id === lastRead);
  if (idx < 0) return all.filter((m) => m.senderId !== agentId);
  return all.slice(idx + 1).filter((m) => m.senderId !== agentId);
}

async function ensureWorkspaceDefaults(input: { workspaceId: UUID }) {
  const ws = workspaces.get(input.workspaceId);
  if (!ws) throw new Error(`Workspace not found: ${input.workspaceId}`);

  const humanId = `human-${input.workspaceId}`;
  if (!agents.has(humanId)) {
    agents.set(humanId, {
      id: humanId,
      workspaceId: input.workspaceId,
      role: "human",
      parentId: null,
      createdAt: nowIso(),
      llmHistory: initialAgentHistory({ agentId: humanId, workspaceId: input.workspaceId, role: "human" }),
    });
  }

  const remoteAgents = await listRemoteAgents();
  const firstRemote =
    (process.env.AGNO_AGENT_ID || process.env.AGNO_OS_AGENT_ID || remoteAgents[0]?.id || "assistant-remote").trim();
  const assistantId = firstRemote;
  if (!agents.has(assistantId)) {
    agents.set(assistantId, {
      id: assistantId,
      workspaceId: input.workspaceId,
      role: remoteAgents[0]?.name || "assistant",
      parentId: null,
      createdAt: nowIso(),
      llmHistory: initialAgentHistory({
        agentId: assistantId,
        workspaceId: input.workspaceId,
        role: remoteAgents[0]?.name || "assistant",
      }),
    });
  }

  const existingDefault = [...groups.values()].find(
    (g) => g.workspaceId === input.workspaceId && g.memberIds.includes(humanId) && g.memberIds.includes(assistantId)
  );
  let defaultGroupId = existingDefault?.id;
  if (!defaultGroupId) {
    const id = rid("group");
    const createdAt = nowIso();
    groups.set(id, {
      id,
      workspaceId: input.workspaceId,
      name: "default",
      memberIds: [humanId, assistantId],
      contextTokens: 0,
      createdAt,
      updatedAt: createdAt,
    });
    defaultGroupId = id;
  }

  return {
    workspaceId: input.workspaceId,
    humanAgentId: humanId,
    assistantAgentId: assistantId,
    defaultGroupId,
  };
}

export const memStore = {
  async listWorkspaces() {
    return [...workspaces.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createWorkspaceWithDefaults(input: { name: string }) {
    const workspaceId = rid("workspace");
    workspaces.set(workspaceId, { id: workspaceId, name: input.name || "Default Workspace", createdAt: nowIso() });
    return ensureWorkspaceDefaults({ workspaceId });
  },

  ensureWorkspaceDefaults,

  async listAgents(input?: { workspaceId?: UUID }) {
    if (!input?.workspaceId) return [...agents.values()];
    return [...agents.values()].filter((a) => a.workspaceId === input.workspaceId);
  },

  async listAgentsMeta(input: { workspaceId: UUID }) {
    return [...agents.values()]
      .filter((a) => a.workspaceId === input.workspaceId)
      .map((a) => ({ id: a.id, role: a.role, parentId: a.parentId, createdAt: a.createdAt }));
  },

  async getAgent(input: { agentId: UUID }) {
    const a = agents.get(input.agentId);
    if (!a) throw new Error(`Agent not found: ${input.agentId}`);
    return { id: a.id, role: a.role, llmHistory: a.llmHistory, parentId: a.parentId };
  },

  async setAgentHistory(input: { agentId: UUID; llmHistory: string; workspaceId?: UUID }) {
    const a = agents.get(input.agentId);
    if (!a) throw new Error(`Agent not found: ${input.agentId}`);
    a.llmHistory = input.llmHistory;
  },

  async getAgentRole(input: { agentId: UUID }) {
    return agents.get(input.agentId)?.role ?? null;
  },

  async createSubAgentWithP2P(input: { workspaceId: UUID; creatorId: UUID; role: string; guidance?: string }) {
    const agentId = rid("agent");
    const groupId = rid("group");
    const createdAt = nowIso();
    agents.set(agentId, {
      id: agentId,
      workspaceId: input.workspaceId,
      role: input.role,
      parentId: input.creatorId,
      createdAt,
      llmHistory: initialAgentHistory({
        agentId,
        workspaceId: input.workspaceId,
        role: input.role,
        guidance: input.guidance,
      }),
    });
    groups.set(groupId, {
      id: groupId,
      workspaceId: input.workspaceId,
      name: input.role,
      memberIds: [input.creatorId, agentId],
      contextTokens: 0,
      createdAt,
      updatedAt: createdAt,
    });
    return { agentId, groupId, createdAt };
  },

  async findLatestExactP2PGroupId(input: {
    workspaceId: UUID;
    memberA: UUID;
    memberB: UUID;
    preferredName?: string | null;
  }) {
    const rows = [...groups.values()].filter((g) => {
      if (g.workspaceId !== input.workspaceId) return false;
      if (g.memberIds.length !== 2) return false;
      return g.memberIds.includes(input.memberA) && g.memberIds.includes(input.memberB);
    });
    if (rows.length === 0) return null;
    const preferred = input.preferredName ?? null;
    rows.sort((a, b) => {
      const aPref = preferred && a.name === preferred ? 1 : 0;
      const bPref = preferred && b.name === preferred ? 1 : 0;
      if (aPref !== bPref) return bPref - aPref;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    return rows[0]!.id;
  },

  async listGroups(input: { workspaceId?: UUID; agentId?: UUID }) {
    const filtered = [...groups.values()].filter((g) => {
      if (input.workspaceId && g.workspaceId !== input.workspaceId) return false;
      if (input.agentId && !g.memberIds.includes(input.agentId)) return false;
      return true;
    });
    return filtered
      .map((g) => {
        const groupMessages = messages
          .filter((m) => m.groupId === g.id)
          .sort((a, b) => b.sendTime.localeCompare(a.sendTime));
        const last = groupMessages[0];
        const unreadCount = input.agentId ? unreadMessagesForAgent(g.id, input.agentId).length : 0;
        return {
          id: g.id,
          workspaceId: g.workspaceId,
          name: g.name,
          memberIds: g.memberIds,
          unreadCount,
          contextTokens: g.contextTokens,
          lastMessage: last
            ? {
              content: last.content,
              contentType: last.contentType,
              sendTime: last.sendTime,
              senderId: last.senderId,
            }
            : undefined,
          updatedAt: g.updatedAt,
          createdAt: g.createdAt,
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async createGroup(input: { workspaceId: UUID; memberIds: UUID[]; name?: string }) {
    const id = rid("group");
    const createdAt = nowIso();
    const g: Group = {
      id,
      workspaceId: input.workspaceId,
      name: input.name ?? null,
      memberIds: [...new Set(input.memberIds)],
      contextTokens: 0,
      createdAt,
      updatedAt: createdAt,
    };
    groups.set(id, g);
    return g;
  },

  async mergeDuplicateExactP2PGroups(input: {
    workspaceId: UUID;
    memberA: UUID;
    memberB: UUID;
    preferredName?: string | null;
  }) {
    const target = [...groups.values()].find((g) => {
      if (g.workspaceId !== input.workspaceId) return false;
      if (g.memberIds.length !== 2) return false;
      return g.memberIds.includes(input.memberA) && g.memberIds.includes(input.memberB);
    });
    if (!target) return null;
    if (input.preferredName) target.name = input.preferredName;
    return target.id;
  },

  async addGroupMembers(input: { groupId: UUID; userIds: UUID[] }) {
    const g = groups.get(input.groupId);
    if (!g) throw new Error(`Group not found: ${input.groupId}`);
    g.memberIds = [...new Set([...g.memberIds, ...input.userIds])];
    g.updatedAt = nowIso();
  },

  async listMessages(input: { groupId: UUID }) {
    return messages
      .filter((m) => m.groupId === input.groupId)
      .sort((a, b) => a.sendTime.localeCompare(b.sendTime));
  },

  async sendMessage(input: { groupId: UUID; senderId: UUID; content: string; contentType: string }) {
    const g = groups.get(input.groupId);
    if (!g) throw new Error(`Group not found: ${input.groupId}`);
    const id = rid("msg");
    const sendTime = nowIso();
    const m: Message = {
      id,
      workspaceId: g.workspaceId,
      groupId: input.groupId,
      senderId: input.senderId,
      content: input.content,
      contentType: input.contentType,
      sendTime,
    };
    messages.push(m);
    g.updatedAt = sendTime;
    return { id, sendTime };
  },

  async sendDirectMessage(input: {
    workspaceId: UUID;
    fromId: UUID;
    toId: UUID;
    content: string;
    contentType: string;
    groupName?: string | null;
  }) {
    const existing = await this.findLatestExactP2PGroupId({
      workspaceId: input.workspaceId,
      memberA: input.fromId,
      memberB: input.toId,
      preferredName: input.groupName ?? null,
    });
    let groupId = existing;
    let channel: "new_thread" | "new_group" | "reuse_existing_group" = existing
      ? "reuse_existing_group"
      : "new_group";
    if (!groupId) {
      const created = await this.createGroup({
        workspaceId: input.workspaceId,
        memberIds: [input.fromId, input.toId],
        name: input.groupName ?? undefined,
      });
      groupId = created.id;
      channel = "new_group";
    }
    const msg = await this.sendMessage({
      groupId,
      senderId: input.fromId,
      content: input.content,
      contentType: input.contentType,
    });
    return { groupId, messageId: msg.id, sendTime: msg.sendTime, channel };
  },

  async listGroupMemberIds(input: { groupId: UUID }) {
    return groups.get(input.groupId)?.memberIds ?? [];
  },

  async getGroupWorkspaceId(input: { groupId: UUID }) {
    const wsId = groups.get(input.groupId)?.workspaceId;
    if (!wsId) throw new Error(`Group not found: ${input.groupId}`);
    return wsId;
  },

  async markGroupRead(input: { groupId: UUID; readerId: UUID }) {
    const key = groupReadKey(input.groupId, input.readerId);
    const last = messages.filter((m) => m.groupId === input.groupId).slice(-1)[0]?.id ?? null;
    lastReadByGroupAgent.set(key, last);
  },

  async markGroupReadToMessage(input: { groupId: UUID; readerId: UUID; messageId: UUID }) {
    lastReadByGroupAgent.set(groupReadKey(input.groupId, input.readerId), input.messageId);
  },

  async listUnreadByGroup(input: { agentId: UUID }) {
    const rows: Array<{
      groupId: UUID;
      messages: Array<{
        id: UUID;
        senderId: UUID;
        content: string;
        contentType: string;
        sendTime: string;
      }>;
    }> = [];

    for (const group of groups.values()) {
      if (!group.memberIds.includes(input.agentId)) continue;
      const unread = unreadMessagesForAgent(group.id, input.agentId);
      if (unread.length === 0) continue;
      rows.push({ groupId: group.id, messages: unread });
    }

    rows.sort((a, b) => {
      const at = a.messages[a.messages.length - 1]?.sendTime ?? "";
      const bt = b.messages[b.messages.length - 1]?.sendTime ?? "";
      return bt.localeCompare(at);
    });
    return rows;
  },

  async setGroupContextTokens(input: { groupId: UUID; tokens: number }) {
    const g = groups.get(input.groupId);
    if (!g) return;
    g.contextTokens = Math.max(0, Math.floor(input.tokens || 0));
    g.updatedAt = nowIso();
  },

  async listRecentWorkspaceMessages(input: { workspaceId: UUID; limit: number }) {
    return messages
      .filter((m) => m.workspaceId === input.workspaceId)
      .sort((a, b) => b.sendTime.localeCompare(a.sendTime))
      .slice(0, input.limit);
  },
};
