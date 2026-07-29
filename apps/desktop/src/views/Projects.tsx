import { useState, type FormEvent } from "react";
import * as api from "../api";
import type { Organization, Project, RunSummary } from "../types";
import { Icon } from "../components/Icon";
import { StatusPill } from "../components/StatusPill";
import { roleAtLeast } from "../roles";

export function ProjectsView({
  org,
  projects,
  runs,
  onOpen,
  refresh,
}: {
  org: Organization;
  projects: Project[];
  runs: RunSummary[];
  onOpen: (p: Project) => void;
  refresh: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<Project["type"]>("grant_application");
  const [error, setError] = useState<string | null>(null);
  const canCreate = roleAtLeast(org.role, "member");

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createProject(org.id, name, type);
      setName("");
      setCreating(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the project");
    }
  }

  return (
    <>
      <header className="main-header">
        <h1>Projects</h1>
        <div className="header-right">
          {canCreate && (
            <button className="primary" onClick={() => setCreating((v) => !v)}>
              <span className="row"><Icon name="plus" /> New project</span>
            </button>
          )}
        </div>
      </header>
      <div className="main-scroll">
        {creating && (
          <form className="card" onSubmit={create}>
            <h2>New project</h2>
            <div className="field">
              <label htmlFor="p-name">Project name</label>
              <input id="p-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="p-type">Type</label>
              <select id="p-type" value={type} onChange={(e) => setType(e.target.value as Project["type"])}>
                <option value="grant_application">Grant application</option>
                <option value="website">Website</option>
                <option value="other">Other</option>
              </select>
            </div>
            {error && <p className="error-text" role="alert">{error}</p>}
            <div className="row">
              <button className="primary">Create</button>
              <button type="button" className="ghost" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </form>
        )}

        {projects.length === 0 && !creating ? (
          <div className="card empty">
            No projects yet.{" "}
            {canCreate ? "Create one to get started." : "Ask an organization member to create one."}
          </div>
        ) : (
          projects.map((project) => {
            const projectRuns = runs.filter((r) => r.project_id === project.id);
            const latest = projectRuns[0];
            return (
              <div
                key={project.id}
                className="card clickable"
                onClick={() => onOpen(project)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onOpen(project)}
              >
                <div className="row">
                  <Icon name="folder" />
                  <strong>{project.name}</strong>
                  <span className="pill gray">{project.type.replace("_", " ")}</span>
                  {latest && <StatusPill status={latest.status} />}
                  <span className="faint" style={{ marginLeft: "auto" }}>
                    {projectRuns.length} workflow{projectRuns.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
