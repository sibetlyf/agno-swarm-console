import React, { useState, ReactNode } from "react";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle } from "lucide-react";

/**
 * Props for the base tool card components.
 */
export interface BaseToolCardProps {
  /** Name of the tool being invoked */
  toolName: string;
  /** Short summary or description of the tool invocation */
  summary?: string;
  /** Arguments passed to the tool, displayed in expandable section */
  args?: Record<string, unknown> | string;
  /** Optional CSS class name */
  className?: string;
  /** Whether the details section is expanded by default */
  defaultExpanded?: boolean;
}

/**
 * Props for the ToolUsingCard component.
 */
export interface ToolUsingCardProps extends BaseToolCardProps {}

/**
 * Props for the ToolResultCard component.
 */
export interface ToolResultCardProps extends BaseToolCardProps {
  /** The result returned by the tool */
  result?: Record<string, unknown> | string;
}

/**
 * Props for the ToolErrorCard component.
 */
export interface ToolErrorCardProps extends BaseToolCardProps {
  /** The error message or object returned by the tool */
  error: string | Error | Record<string, unknown>;
}

/**
 * Internal component to render JSON or string data in a formatted block.
 */
function JsonViewer({ data, label }: { data: Record<string, unknown> | string; label: string }) {
  const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <div 
        style={{ 
          fontSize: "11px", 
          fontWeight: 700, 
          color: "var(--text-muted)", 
          textTransform: "uppercase", 
          letterSpacing: "0.05em" 
        }}
      >
        {label}
      </div>
      <pre 
        className="mono"
        style={{ 
          margin: 0, 
          padding: "8px 10px", 
          background: "var(--surface-1)", 
          border: "0", 
          borderRadius: "6px",
          color: "var(--text-body)",
          overflowX: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: "12px"
        }}
      >
        {content}
      </pre>
    </div>
  );
}

/**
 * Internal layout component for tool cards.
 */
function ToolCardLayout({
  icon,
  title,
  subtitle,
  statusColor,
  isExpanded,
  onToggle,
  children,
  className = "",
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  statusColor: "blue" | "green" | "red" | "default";
  isExpanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
  className?: string;
}) {
  const getStatusStyles = (): React.CSSProperties => {
    switch (statusColor) {
      case "blue":
        return { 
          background: "var(--blue-soft)", 
          borderColor: "var(--blue-border)", 
          color: "var(--text-strong)" 
        };
      case "green":
        return { 
          background: "var(--green-soft)", 
          borderColor: "var(--green-border)", 
          color: "var(--green-strong)" 
        };
      case "red":
        return { 
          background: "var(--red-soft)", 
          borderColor: "var(--red-border)", 
          color: "var(--red-strong)" 
        };
      default:
        return { 
          background: "var(--surface-2)", 
          borderColor: "var(--line-strong)", 
          color: "var(--text-soft)" 
        };
    }
  };

  const statusStyles = getStatusStyles();
  const hasChildren = React.Children.count(children) > 0;

  return (
    <article 
      className={`tool-card ${className}`}
      style={{
        border: "0",
        borderRadius: "12px",
        background: "var(--surface-1)",
        overflow: "hidden",
        boxShadow: "var(--shadow-card)",
        marginBottom: "8px",
      }}
    >
      <header
        onClick={() => hasChildren && onToggle()}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 12px",
          cursor: hasChildren ? "pointer" : "default",
          userSelect: "none",
          background: isExpanded ? "var(--surface-0)" : "transparent",
          transition: "background 150ms ease",
        }}
        onMouseEnter={(e) => { if (hasChildren) e.currentTarget.style.background = "var(--surface-0)"; }}
        onMouseLeave={(e) => { if (hasChildren) e.currentTarget.style.background = isExpanded ? "var(--surface-0)" : "transparent"; }}
      >
        <div 
          style={{ 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center",
            width: "28px", 
            height: "28px", 
            borderRadius: "8px",
            background: statusStyles.background,
            border: `0`,
            color: statusStyles.color,
            marginRight: "12px",
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <h4 
              style={{ 
                margin: 0, 
                fontSize: "14px", 
                fontWeight: 600, 
                color: "var(--text-strong)", 
                whiteSpace: "nowrap", 
                overflow: "hidden", 
                textOverflow: "ellipsis" 
              }}
            >
              {title}
            </h4>
          </div>
          {subtitle && (
            <div 
              style={{ 
                fontSize: "12px", 
                color: "var(--text-muted)", 
                whiteSpace: "nowrap", 
                overflow: "hidden", 
                textOverflow: "ellipsis", 
                marginTop: "2px" 
              }}
            >
              {subtitle}
            </div>
          )}
        </div>

        {hasChildren && (
          <div style={{ color: "var(--text-muted)", marginLeft: "8px", display: "flex", alignItems: "center" }}>
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </div>
        )}
      </header>

      {isExpanded && hasChildren && (
        <section 
          style={{ 
            borderTop: "0",
            background: "var(--surface-0)",
            padding: "12px",
            fontSize: "13px",
          }}
        >
          {children}
        </section>
      )}
    </article>
  );
}

/**
 * Renders a tool invocation in a loading/using state.
 * Displays a spinner icon and blue styling.
 */
export function ToolUsingCard({
  toolName,
  summary = "Calling tool...",
  args,
  className = "",
  defaultExpanded = false,
}: ToolUsingCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <ToolCardLayout
      icon={<Loader2 size={16} className="animate-spin" />}
      title={toolName}
      subtitle={summary}
      statusColor="blue"
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      className={className}
    >
      {args && <JsonViewer data={args} label="Arguments" />}
    </ToolCardLayout>
  );
}

/**
 * Renders a completed tool invocation.
 * Displays a check icon and green styling.
 */
export function ToolResultCard({
  toolName,
  summary = "Tool call completed",
  args,
  result,
  className = "",
  defaultExpanded = false,
}: ToolResultCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  
  const hasContent = args !== undefined || result !== undefined;

  return (
    <ToolCardLayout
      icon={<CheckCircle2 size={16} />}
      title={toolName}
      subtitle={summary}
      statusColor="green"
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      className={className}
    >
      {hasContent && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {args && <JsonViewer data={args} label="Arguments" />}
          {result && <JsonViewer data={result} label="Result" />}
        </div>
      )}
    </ToolCardLayout>
  );
}

/**
 * Renders a failed tool invocation.
 * Displays an X icon and red styling.
 */
export function ToolErrorCard({
  toolName,
  summary = "Tool call failed",
  args,
  error,
  className = "",
  defaultExpanded = true,
}: ToolErrorCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const errorContent = error instanceof Error ? error.message : error;

  return (
    <ToolCardLayout
      icon={<XCircle size={16} />}
      title={toolName}
      subtitle={summary}
      statusColor="red"
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      className={className}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {args && <JsonViewer data={args} label="Arguments" />}
        <JsonViewer data={errorContent as string | Record<string, unknown>} label="Error" />
      </div>
    </ToolCardLayout>
  );
}
