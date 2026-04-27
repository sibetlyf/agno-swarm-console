import React from "react";
import { Bot, Zap, RotateCcw, ArrowDownToLine, Clock } from "lucide-react";

/**
 * Props for the ComposerContextBar component.
 */
export interface ComposerContextBarProps {
  /** Current selected agent name or ID */
  agentName?: string;
  /** Callback when agent selector is clicked */
  onAgentClick?: () => void;

  /** Current mode (e.g., "Chat", "Task", "Debug") */
  mode?: string;
  /** Callback when mode is toggled/clicked */
  onModeClick?: () => void;

  /** Whether replay state is active */
  isReplayActive?: boolean;
  /** Callback to toggle replay state */
  onReplayToggle?: (active: boolean) => void;

  /** Whether auto-follow is enabled */
  isAutoFollow?: boolean;
  /** Callback to toggle auto-follow */
  onAutoFollowToggle?: (active: boolean) => void;

  /** Current timeline source (e.g., "Live", "Local", "Remote") */
  timelineSource?: string;
  /** Callback when timeline source is clicked */
  onTimelineSourceClick?: () => void;

  /** Whether the entire bar or its interactive elements should be disabled */
  disabled?: boolean;

  /** Optional CSS class name */
  className?: string;
}

/**
 * A compact context bar displayed near the composer input area.
 * Shows session-level settings like current agent, mode, replay state, auto-follow, and timeline source.
 */
export function ComposerContextBar({
  agentName = "Default Agent",
  onAgentClick,
  mode = "Chat",
  onModeClick,
  isReplayActive = false,
  onReplayToggle,
  isAutoFollow = true,
  onAutoFollowToggle,
  timelineSource = "Live",
  onTimelineSourceClick,
  disabled = false,
  className = "",
}: ComposerContextBarProps) {
  return (
    <div 
      className={`composer-context-bar ${className}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 14px",
        background: "var(--surface-0)",
        borderTop: "1px solid var(--line-soft)",
        overflowX: "auto",
        scrollbarWidth: "none", // Firefox
        msOverflowStyle: "none", // IE/Edge
      }}
    >
      {/* Agent Selector */}
      <button
        type="button"
        className="pill"
        disabled={disabled}
        onClick={onAgentClick}
        style={{
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          background: "var(--surface-1)",
          transition: "background 150ms ease, border-color 150ms ease",
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = "var(--surface-2)";
        }}
        onMouseLeave={(e) => {
          if (!disabled) e.currentTarget.style.background = "var(--surface-1)";
        }}
      >
        <Bot size={14} />
        <span>{agentName}</span>
      </button>

      {/* Mode Toggle */}
      <button
        type="button"
        className="pill"
        disabled={disabled}
        onClick={onModeClick}
        style={{
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          background: "var(--surface-1)",
          transition: "background 150ms ease",
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = "var(--surface-2)";
        }}
        onMouseLeave={(e) => {
          if (!disabled) e.currentTarget.style.background = "var(--surface-1)";
        }}
      >
        <Zap size={14} />
        <span>{mode}</span>
      </button>

      {/* Replay Indicator/Toggle */}
      <button
        type="button"
        className="pill"
        disabled={disabled}
        onClick={() => onReplayToggle?.(!isReplayActive)}
        style={{
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          background: isReplayActive ? "var(--amber-soft)" : "var(--surface-1)",
          borderColor: isReplayActive ? "var(--amber-border)" : "var(--line-strong)",
          color: isReplayActive ? "var(--text-strong)" : "var(--text-soft)",
          transition: "all 150ms ease",
        }}
        onMouseEnter={(e) => {
          if (!disabled && !isReplayActive) e.currentTarget.style.background = "var(--surface-2)";
        }}
        onMouseLeave={(e) => {
          if (!disabled && !isReplayActive) e.currentTarget.style.background = "var(--surface-1)";
        }}
      >
        <RotateCcw size={14} />
        <span>{isReplayActive ? "Replaying" : "Replay"}</span>
      </button>

      {/* Auto-follow Toggle */}
      <button
        type="button"
        className="pill"
        disabled={disabled}
        onClick={() => onAutoFollowToggle?.(!isAutoFollow)}
        style={{
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          background: isAutoFollow ? "var(--blue-soft)" : "var(--surface-1)",
          borderColor: isAutoFollow ? "var(--blue-border)" : "var(--line-strong)",
          color: isAutoFollow ? "var(--text-strong)" : "var(--text-soft)",
          transition: "all 150ms ease",
        }}
        onMouseEnter={(e) => {
          if (!disabled && !isAutoFollow) e.currentTarget.style.background = "var(--surface-2)";
        }}
        onMouseLeave={(e) => {
          if (!disabled && !isAutoFollow) e.currentTarget.style.background = "var(--surface-1)";
        }}
      >
        <ArrowDownToLine size={14} />
        <span>{isAutoFollow ? "Auto-follow" : "Follow Paused"}</span>
      </button>

      {/* Timeline Source */}
      <button
        type="button"
        className="pill"
        disabled={disabled}
        onClick={onTimelineSourceClick}
        style={{
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          background: "var(--surface-1)",
          transition: "background 150ms ease",
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = "var(--surface-2)";
        }}
        onMouseLeave={(e) => {
          if (!disabled) e.currentTarget.style.background = "var(--surface-1)";
        }}
      >
        <Clock size={14} />
        <span>{timelineSource}</span>
      </button>
    </div>
  );
}
