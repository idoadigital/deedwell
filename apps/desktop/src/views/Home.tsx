import type { Approval, Organization, Project, RunSummary } from "../types";
import { Icon } from "../components/Icon";
import { StatusPill } from "../components/StatusPill";

export function HomeView({
  org,
  projects,
  runs,
  pendingApprovals,
  onOpenProject,
  onGoProjects,
  onGoApprovals,
}: {
  org: Organization;
  projects: Project[];
  runs: RunSummary[];
  pendingApprovals: Approval[];
  onOpenProject: (p: Project) => void;
  onGoProjects: () => void;
  onGoApprovals: () => void;
}) {
  const activeRuns = runs.filter((r) => !["completed", "cancelled"].includes(r.status));
  const needsAttention = runs.filter((r) =>
    ["waiting_for_info", "waiting_approval", "failed", "suspended_budget"].includes(r.status)
  );

  return (
    <>
      <header className="main-header">
        <h1>Home</h1>
        <span className="sub">{org.name}</span>
      </header>
      <div className="main-scroll">
        {needsAttention.length + pendingApprovals.length > 0 && (
          <div className="card" style={{ borderColor: "rgba(245,158,11,0.35)" }}>
            <h2><Icon name="alert" /> Waiting on you</h2>
            {pendingApprovals.length > 0 && (
              <p className="muted">
                {pendingApprovals.length} approval{pendingApprovals.length > 1 ? "s" : ""} pending —{" "}
                <a className="clickable" onClick={onGoApprovals} style={{ cursor: "pointer" }}>
                  review now
                </a>
              </p>
            )}
            {needsAttention.map((run) => {
              const project = projects.find((p) => p.id === run.project_id);
              return (
                <div key={run.id} className="row mt">
                  <StatusPill status={run.status} />
                  <span>{project?.name ?? run.project_name ?? "Project"}</span>
                  {project && (
                    <button className="ghost" onClick={() => onOpenProject(project)}>
                      Open
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="grid-2">
          <div className="card">
            <h2><Icon name="folder" /> Projects</h2>
            {projects.length === 0 ? (
              <div className="empty">
                No projects yet. Start one to put your AI team to work.
                <div className="mt">
                  <button className="primary" onClick={onGoProjects}>
                    <span className="row"><Icon name="plus" /> New project</span>
                  </button>
                </div>
              </div>
            ) : (
              <table>
                <thead>
                  <tr><th>Name</th><th>Type</th><th /></tr>
                </thead>
                <tbody>
                  {projects.slice(0, 6).map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.name}</td>
                      <td className="muted">{p.type.replace("_", " ")}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="ghost" onClick={() => onOpenProject(p)}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h2><Icon name="activity" /> Active work</h2>
            {activeRuns.length === 0 ? (
              <div className="empty">No workflows in flight.</div>
            ) : (
              <table>
                <thead>
                  <tr><th>Project</th><th>Stage</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {activeRuns.slice(0, 6).map((r) => (
                    <tr key={r.id}>
                      <td>{r.project_name}</td>
                      <td className="mono">{r.current_step}</td>
                      <td><StatusPill status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
