import React, { useState, ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Props for a single collapsible section in the CapabilityRail.
 */
export interface CapabilitySectionProps {
  /** Unique identifier for the section */
  id: string;
  /** Title displayed in the section header */
  title: string;
  /** Optional icon displayed next to the title */
  icon?: ReactNode;
  /** Optional count displayed as a pill/badge */
  count?: number;
  /** Optional badge text (e.g., "New", "Active") */
  badge?: string;
  /** Color theme for the badge */
  badgeColor?: "blue" | "green" | "red" | "amber" | "default";
  /** Content to render when the section is expanded */
  children: ReactNode;
  /** Whether the section is expanded by default */
  defaultExpanded?: boolean;
  /** Callback when the section is toggled */
  onToggle?: (expanded: boolean) => void;
}

/**
 * A collapsible section component for the CapabilityRail.
 * Uses semantic HTML and controlled state for expand/collapse.
 */
export function CapabilitySection({
  id,
  title,
  icon,
  count,
  badge,
  badgeColor = "default",
  children,
  defaultExpanded = false,
  onToggle,
}: CapabilitySectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const handleToggle = () => {
    const nextState = !isExpanded;
    setIsExpanded(nextState);
    onToggle?.(nextState);
  };

  // Map badge colors to CSS variables from globals.css
  const getBadgeStyles = (): React.CSSProperties => {
    switch (badgeColor) {
      case "blue":
        return { 
          background: "var(--blue-soft)", 
          color: "var(--text-strong)", 
          border: "1px solid var(--blue-border)" 
        };
      case "green":
        return { 
          background: "var(--green-soft)", 
          color: "var(--green-strong)", 
          border: "1px solid var(--green-border)" 
        };
      case "red":
        return { 
          background: "var(--red-soft)", 
          color: "var(--red-strong)", 
          border: "1px solid var(--red-border)" 
        };
      case "amber":
        return { 
          background: "var(--amber-soft)", 
          color: "var(--text-strong)", 
          border: "1px solid var(--amber-border)" 
        };
      default:
        return { 
          background: "var(--surface-2)", 
          color: "var(--text-soft)", 
          border: "1px solid var(--line-strong)" 
        };
    }
  };

  return (
    <section 
      className="capability-section"
      style={{
        display: "flex",
        flexDirection: "column",
        borderBottom: "1px solid var(--line-soft)",
      }}
    >
      <header 
        onClick={handleToggle}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          cursor: "pointer",
          userSelect: "none",
          background: isExpanded ? "var(--surface-0)" : "transparent",
          transition: "background 150ms ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-0)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = isExpanded ? "var(--surface-0)" : "transparent")}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "var(--text-muted)", display: "flex", alignItems: "center" }}>
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
          {icon && <span style={{ color: "var(--text-soft)", display: "flex", alignItems: "center" }}>{icon}</span>}
          <h3 style={{ margin: 0, fontSize: "13px", fontWeight: 600, color: "var(--text-strong)" }}>
            {title}
          </h3>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {badge && (
            <span 
              style={{
                ...getBadgeStyles(),
                fontSize: "11px",
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: "4px",
                textTransform: "uppercase",
                letterSpacing: "0.02em",
              }}
            >
              {badge}
            </span>
          )}
          {count !== undefined && (
            <span 
              className="pill mono"
              style={{
                padding: "2px 8px",
                fontSize: "12px",
                background: "var(--surface-2)",
              }}
            >
              {count}
            </span>
          )}
        </div>
      </header>
      
      {isExpanded && (
        <div 
          style={{ 
            padding: "8px 16px 16px 16px",
            background: "var(--surface-0)",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * Props for the CapabilityRail component.
 */
export interface CapabilityRailProps {
  /** Main header title for the rail */
  headerTitle?: string;
  /** Subtitle or description for the rail */
  headerSubtitle?: string;
  /** The sections to render within the rail */
  children: ReactNode;
  /** Optional CSS class name */
  className?: string;
}

/**
 * CapabilityRail component inspired by Hermes's multi-panel sidebar.
 * Organizes workspace/threads, agents, skills, memory, todos, artifacts, and control center into collapsible sections.
 */
export function CapabilityRail({
  headerTitle = "Workspace",
  headerSubtitle = "Track threads, agents, and artifacts",
  children,
  className = "",
}: CapabilityRailProps) {
  return (
    <aside 
      className={`panel panel-left ${className}`}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--surface-1)",
        borderRight: "1px solid var(--line-strong)",
      }}
    >
      {/* Rail Header */}
      <header 
        className="header" 
        style={{ 
          alignItems: "flex-start", 
          flexDirection: "column", 
          padding: "16px",
          minHeight: "auto",
          background: "var(--surface-0)",
          borderBottom: "1px solid var(--line-strong)",
        }}
      >
        <div className="eyebrow" style={{ marginBottom: "4px" }}>Control Center</div>
        <h2 className="section-title" style={{ fontSize: "20px", margin: 0 }}>{headerTitle}</h2>
        <p className="section-subtitle" style={{ margin: "4px 0 0 0" }}>{headerSubtitle}</p>
      </header>

      {/* Scrollable Sections Area */}
      <div 
        className="list"
        style={{ 
          flex: 1, 
          overflowY: "auto", 
          overflowX: "hidden",
          display: "flex",
          flexDirection: "column",
          padding: 0,
        }}
      >
        {children}
      </div>
    </aside>
  );
}
