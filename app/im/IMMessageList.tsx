import type { ReactNode } from "react";

type Message = {
  id: string;
  senderId: string;
  content: string;
  contentType: string;
  sendTime: string;
};

type IMMessageListProps = {
  messages: Message[];
  humanAgentId?: string | null;
  agentRoleById: Map<string, string>;
  fmtTime: (iso: string) => string;
  renderContent: (content: string) => ReactNode;
  cx: (...classes: Array<string | false | undefined | null>) => string;
  selectedSenderId?: string | null;
  onSelectSenderId?: (senderId: string | null) => void;
};

export function IMMessageList({
  messages,
  humanAgentId,
  agentRoleById,
  fmtTime,
  renderContent,
  cx,
  selectedSenderId,
  onSelectSenderId,
}: IMMessageListProps) {
  const laneOrder: string[] = [];
  const laneMap = new Map<string, { senderId: string; senderRole: string; isMe: boolean; items: Message[] }>();

  for (const m of messages) {
    const isMe = m.senderId === humanAgentId;
    const senderRole = agentRoleById.get(m.senderId) ?? (isMe ? "human" : m.senderId.slice(0, 8));
    const laneId = `${m.senderId}:${senderRole}`;
    if (!laneMap.has(laneId)) {
      laneMap.set(laneId, { senderId: m.senderId, senderRole, isMe, items: [] });
      laneOrder.push(laneId);
    }
    laneMap.get(laneId)!.items.push(m);
  }

  return (
    <div className="message-lanes">
      {laneOrder.map((laneId) => {
        const lane = laneMap.get(laneId);
        if (!lane) return null;
        return (
          <section
            key={laneId}
            className={cx(
              "message-lane",
              lane.isMe && "mine",
              selectedSenderId === lane.senderId && "selected"
            )}
          >
            <header className="message-lane-header">
              <button
                type="button"
                className="message-lane-title-btn"
                onClick={() => onSelectSenderId?.(lane.senderId)}
                title="筛选该 Agent"
              >
                <span className="message-lane-title">{lane.senderRole}</span>
                <span className="message-lane-meta mono">{lane.senderId.slice(0, 8)}</span>
              </button>
              {selectedSenderId === lane.senderId ? (
                <button
                  type="button"
                  className="message-lane-clear"
                  onClick={() => onSelectSenderId?.(null)}
                  title="清除筛选"
                >
                  清除
                </button>
              ) : null}
            </header>

            <div className="message-lane-body">
              {lane.items.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    justifyContent: lane.isMe ? "flex-end" : "flex-start",
                    marginBottom: 10,
                  }}
                >
                  <div className={cx("bubble", lane.isMe ? "me" : "other")}>
                    <div className="bubble-meta">{fmtTime(m.sendTime)}</div>
                    {renderContent(m.content)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
