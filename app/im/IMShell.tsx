import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

type IMShellProps = {
  left: ReactNode;
  mid: ReactNode;
  right?: ReactNode;
  leftWidth?: number;
  rightWidth?: number;
  onStartResize?: (edge: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) => void;
};

const RESIZER_SIZE = 8;

export function IMShell({ left, mid, right, leftWidth = 320, rightWidth = 560, onStartResize }: IMShellProps) {
  const columns = right
    ? `${leftWidth}px ${RESIZER_SIZE}px minmax(0, 1fr) ${RESIZER_SIZE}px ${rightWidth}px`
    : `${leftWidth}px ${RESIZER_SIZE}px minmax(0, 1fr)`;

  return (
    <div className={`app dark ${right ? "" : "no-right"}`.trim()} style={{ gridTemplateColumns: columns }}>
      {left}
      <div className="panel-resizer vertical" onPointerDown={(event) => onStartResize?.("left", event)} />
      {mid}
      {right ? <div className="panel-resizer vertical" onPointerDown={(event) => onStartResize?.("right", event)} /> : null}
      {right ?? null}
    </div>
  );
}
