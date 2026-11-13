import type { ReactNode, CSSProperties } from "react";
export type WorkspaceView =
  "overview" | "evaluations" | "evidence" | "datasets" | "reviews";
export interface WorkspaceLayout {
  view: WorkspaceView;
  inspector_width: number;
  run_id: string | null;
  family: string;
}
export function Workspace({
  sidebar,
  header,
  children,
  inspector,
  width,
  onResize,
}: {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
  inspector?: ReactNode;
  width: number;
  onResize: (width: number) => void;
}) {
  return (
    <div
      className="frame"
      style={{ "--inspector-width": `${width}px` } as CSSProperties}
    >
      <a className="skip-link" href="#workspace-main">
        Skip to research workspace
      </a>
      <aside className="sidebar" aria-label="Workspace navigation">
        {sidebar}
      </aside>
      <div className="frame-body">
        <header className="topbar">{header}</header>
        <div className={`workspace-grid ${inspector ? "has-inspector" : ""}`}>
          <main id="workspace-main" tabIndex={-1}>
            {children}
          </main>
          {inspector && (
            <aside className="inspector" aria-label="Evidence inspector">
              <div className="resize-control">
                <label htmlFor="inspector-resize">Inspector width</label>
                <input
                  id="inspector-resize"
                  type="range"
                  min={260}
                  max={560}
                  value={width}
                  onChange={(e) => onResize(+e.target.value)}
                />
              </div>
              {inspector}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">
        ↗
      </span>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
export function Status({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warning";
}) {
  return <span className={`status ${tone}`}>{children}</span>;
}
