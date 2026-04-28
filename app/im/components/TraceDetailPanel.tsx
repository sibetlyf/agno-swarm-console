import React, { useState } from "react";
import { 
  Activity, 
  Clock, 
  Wrench, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ChevronRight, 
  ChevronDown,
  TerminalSquare,
  Cpu,
  BrainCircuit,
  X
} from "lucide-react";

/**
 * Represents a single execution step in the trace.
 */
export interface TraceStep {
  /** Unique identifier for the step */
  id: string;
  /** Type of the step */
  type: "tool" | "agent" | "system" | "reasoning";
  /** Display name of the step */
  name: string;
  /** Current status of the step */
  status: "pending" | "running" | "completed" | "error";
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Input data for the step */
  input?: Record<string, unknown> | string;
  /** Output or result data from the step */
  output?: Record<string, unknown> | string;
  /** Error message if the step failed */
  error?: string;
  /** Timestamp when the step started or was recorded */
  timestamp: number;
}

/**
 * Props for the TraceDetailPanel component.
 */
export interface TraceDetailPanelProps {
  /** Name of the agent being traced */
  agentName: string;
  /** Optional role or description of the agent */
  agentRole?: string;
  /** Current execution status of the agent */
  status: "running" | "completed" | "error" | "idle";
  /** Total execution duration in milliseconds */
  durationMs?: number;
  /** Number of tool calls made */
  totalTools?: number;
  /** Total number of events processed */
  totalEvents?: number;
  /** List of execution steps */
  steps: TraceStep[];
  /** Callback when the panel is closed */
  onClose?: () => void;
}

/**
 * Formats milliseconds into a readable duration string.
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 */
const formatDuration = (ms?: number): string => {
  if (ms === undefined) return "--";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

/**
 * A JSON viewer component for displaying structured data.
 * @param props - Component props
 * @param props.data - Data to display
 * @param props.title - Title of the section
 */
const JsonViewer = ({ data, title }: { data: unknown; title: string }) => {
  if (data === undefined || data === null) return null;
  
  const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
      <div 
        style={{ 
          fontSize: "12px", 
          fontWeight: 600, 
          color: "var(--text-soft)", 
          textTransform: "uppercase", 
          letterSpacing: "0.05em" 
        }}
      >
        {title}
      </div>
      <pre 
        className="mono"
        style={{ 
          margin: 0, 
          padding: "12px", 
          background: "var(--surface-2)", 
          border: "1px solid var(--line-soft)",
          borderRadius: "8px",
          fontSize: "12px",
          color: "var(--text-body)",
          overflowX: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word"
        }}
      >
        {content}
      </pre>
    </div>
  );
};

/**
 * TraceDetailPanel component inspired by Coze's trace-detail-panel.
 * Displays selected agent execution details with structured sections for header, metrics, step list, and step detail.
 */
export function TraceDetailPanel({
  agentName,
  agentRole,
  status,
  durationMs,
  totalTools = 0,
  totalEvents = 0,
  steps,
  onClose
}: TraceDetailPanelProps) {
  const [expandedStepId, setExpandedStepId] = useState<string | null>(
    steps.length > 0 ? steps[0].id : null
  );

  const getStatusColor = () => {
    switch (status) {
      case "completed": return "var(--green-strong)";
      case "error": return "var(--red-strong)";
      case "running": return "var(--blue-border)";
      default: return "var(--text-muted)";
    }
  };

  const getStatusBg = () => {
    switch (status) {
      case "completed": return "var(--green-soft)";
      case "error": return "var(--red-soft)";
      case "running": return "var(--blue-soft)";
      default: return "var(--surface-2)";
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case "completed": return <CheckCircle2 size={14} />;
      case "error": return <AlertCircle size={14} />;
      case "running": return <Loader2 size={14} className="animate-spin" />;
      default: return <Activity size={14} />;
    }
  };

  const getStepIcon = (type: TraceStep["type"]) => {
    switch (type) {
      case "tool": return <Wrench size={14} />;
      case "agent": return <Cpu size={14} />;
      case "reasoning": return <BrainCircuit size={14} />;
      default: return <TerminalSquare size={14} />;
    }
  };

  return (
    <aside 
      style={{ 
        display: "flex", 
        flexDirection: "column", 
        height: "100%", 
        background: "var(--surface-0)",
        borderLeft: "1px solid var(--line-strong)",
        width: "100%",
        maxWidth: "480px",
        overflow: "hidden"
      }}
    >
      {/* Header Section */}
      <header 
        style={{ 
          padding: "16px 20px", 
          borderBottom: "1px solid var(--line-strong)",
          background: "var(--surface-1)",
          display: "flex",
          flexDirection: "column",
          gap: "12px"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--text-strong)" }}>
                {agentName}
              </h2>
              <span 
                style={{ 
                  display: "inline-flex", 
                  alignItems: "center", 
                  gap: "4px",
                  padding: "2px 8px", 
                  borderRadius: "999px", 
                  fontSize: "11px", 
                  fontWeight: 600,
                  background: getStatusBg(),
                  color: getStatusColor(),
                  border: `1px solid ${getStatusColor()}`,
                  textTransform: "uppercase",
                  letterSpacing: "0.02em"
                }}
              >
                {getStatusIcon()}
                {status}
              </span>
            </div>
            {agentRole && (
              <span style={{ fontSize: "13px", color: "var(--text-soft)" }}>
                {agentRole}
              </span>
            )}
          </div>
          {onClose && (
            <button 
              onClick={onClose}
              style={{ 
                background: "transparent", 
                border: "none", 
                color: "var(--text-muted)", 
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "6px"
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface-2)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              aria-label="Close trace details"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Metrics Strip */}
        <div 
          style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(3, 1fr)", 
            gap: "8px",
            marginTop: "4px"
          }}
        >
          <div 
            style={{ 
              display: "flex", 
              flexDirection: "column", 
              gap: "2px", 
              padding: "8px 12px", 
              background: "var(--surface-2)", 
              borderRadius: "8px", 
              border: "1px solid var(--line-soft)" 
            }}
          >
            <span 
              style={{ 
                fontSize: "11px", 
                color: "var(--text-muted)", 
                display: "flex", 
                alignItems: "center", 
                gap: "4px", 
                fontWeight: 600 
              }}
            >
              <Clock size={12} /> DURATION
            </span>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)" }}>
              {formatDuration(durationMs)}
            </span>
          </div>
          <div 
            style={{ 
              display: "flex", 
              flexDirection: "column", 
              gap: "2px", 
              padding: "8px 12px", 
              background: "var(--surface-2)", 
              borderRadius: "8px", 
              border: "1px solid var(--line-soft)" 
            }}
          >
            <span 
              style={{ 
                fontSize: "11px", 
                color: "var(--text-muted)", 
                display: "flex", 
                alignItems: "center", 
                gap: "4px", 
                fontWeight: 600 
              }}
            >
              <Wrench size={12} /> TOOLS
            </span>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)" }}>
              {totalTools}
            </span>
          </div>
          <div 
            style={{ 
              display: "flex", 
              flexDirection: "column", 
              gap: "2px", 
              padding: "8px 12px", 
              background: "var(--surface-2)", 
              borderRadius: "8px", 
              border: "1px solid var(--line-soft)" 
            }}
          >
            <span 
              style={{ 
                fontSize: "11px", 
                color: "var(--text-muted)", 
                display: "flex", 
                alignItems: "center", 
                gap: "4px", 
                fontWeight: 600 
              }}
            >
              <Activity size={12} /> EVENTS
            </span>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)" }}>
              {totalEvents}
            </span>
          </div>
        </div>
      </header>

      {/* Step List Section */}
      <section 
        style={{ 
          flex: 1, 
          overflowY: "auto", 
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px"
        }}
      >
        <h3 
          style={{ 
            margin: "0 0 4px 0", 
            fontSize: "12px", 
            fontWeight: 700, 
            color: "var(--text-muted)", 
            textTransform: "uppercase", 
            letterSpacing: "0.05em" 
          }}
        >
          Execution Trace
        </h3>
        
        {steps.length === 0 ? (
          <div 
            style={{ 
              display: "flex", 
              flexDirection: "column", 
              alignItems: "center", 
              justifyContent: "center", 
              padding: "32px 0", 
              color: "var(--text-muted)", 
              gap: "8px", 
              textAlign: "center" 
            }}
          >
            <Activity size={24} style={{ opacity: 0.5 }} />
            <span style={{ fontSize: "13px" }}>No execution steps recorded yet.</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {steps.map((step) => {
              const isExpanded = expandedStepId === step.id;
              
              return (
                <article 
                  key={step.id}
                  style={{ 
                    display: "flex", 
                    flexDirection: "column",
                    background: "var(--surface-1)",
                    border: isExpanded ? "1px solid var(--blue-border)" : "1px solid var(--line-strong)",
                    borderRadius: "10px",
                    overflow: "hidden",
                    boxShadow: isExpanded ? "0 2px 8px rgba(59, 130, 246, 0.08)" : "var(--shadow-card)",
                    transition: "all 150ms ease"
                  }}
                >
                  {/* Step Header (Accordion Toggle) */}
                  <header
                    onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 14px",
                      background: isExpanded ? "var(--blue-soft)" : "transparent",
                      cursor: "pointer",
                      width: "100%",
                      textAlign: "left",
                      userSelect: "none"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ color: "var(--text-muted)", display: "flex", alignItems: "center" }}>
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </span>
                      <div 
                        style={{ 
                          display: "flex", 
                          alignItems: "center", 
                          justifyContent: "center",
                          width: "24px", 
                          height: "24px", 
                          borderRadius: "6px",
                          background: "var(--surface-2)",
                          color: "var(--text-soft)"
                        }}
                      >
                        {getStepIcon(step.type)}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-strong)" }}>
                          {step.name}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                          {new Date(step.timestamp).toLocaleTimeString(undefined, { 
                            hour12: false, 
                            hour: "2-digit", 
                            minute: "2-digit", 
                            second: "2-digit", 
                            fractionalSecondDigits: 3 
                          })}
                        </span>
                      </div>
                    </div>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      {step.durationMs !== undefined && (
                        <span className="mono" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                          {formatDuration(step.durationMs)}
                        </span>
                      )}
                      {step.status === "running" && <Loader2 size={14} className="animate-spin" style={{ color: "var(--blue-border)" }} />}
                      {step.status === "completed" && <CheckCircle2 size={14} style={{ color: "var(--green-strong)" }} />}
                      {step.status === "error" && <AlertCircle size={14} style={{ color: "var(--red-strong)" }} />}
                    </div>
                  </header>
                  
                  {/* Step Detail (Expanded Content) */}
                  {isExpanded && (
                    <div 
                      style={{ 
                        padding: "0 14px 14px 14px", 
                        borderTop: "1px solid var(--line-soft)", 
                        background: "var(--surface-1)" 
                      }}
                    >
                      {step.error && (
                        <div 
                          style={{ 
                            marginTop: "12px", 
                            padding: "10px 12px", 
                            background: "var(--red-soft)", 
                            border: "1px solid var(--red-border)", 
                            borderRadius: "8px", 
                            color: "var(--red-strong)", 
                            fontSize: "13px", 
                            display: "flex", 
                            gap: "8px", 
                            alignItems: "flex-start" 
                          }}
                        >
                          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
                          <span style={{ wordBreak: "break-word" }}>{step.error}</span>
                        </div>
                      )}
                      
                      <JsonViewer data={step.input} title="Input" />
                      <JsonViewer data={step.output} title="Output / Result" />
                      
                      {!step.input && !step.output && !step.error && (
                        <div 
                          style={{ 
                            padding: "16px 0", 
                            textAlign: "center", 
                            color: "var(--text-muted)", 
                            fontSize: "12px", 
                            fontStyle: "italic" 
                          }}
                        >
                          No detailed data available for this step.
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </aside>
  );
}
