import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api";
import { subscribeSSE, type SSESubscription } from "./sse";
import type { Approval, Organization, Project, RunSummary, WorkflowEvent } from "./types";
import { Icon } from "./components/Icon";
import { LoginView } from "./views/Login";
import { OrgSetupView } from "./views/OrgSetup";
import { HomeView } from "./views/Home";
import { ProjectsView } from "./views/Projects";
import { AgentsView } from "./views/Agents";
import { ApprovalsView } from "./views/Approvals";
import { WorkspaceView } from "./views/Workspace";
import { GrantsView } from "./views/Grants";
import { PassportView } from "./views/Passport";

type NavId = "home" | "projects" | "grants" | "passport" | "agents" | "approvals";

const ORG_KEY = "deedwell.org";

export default function App() {
  const [authed, setAuthed] = useState<boolean>(!!api.getToken());
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [nav, setNav] = useState<NavId>("home");
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const sseRef = useRef<SSESubscription | null>(null);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  // ---- session bootstrap --------------------------------------------------
  useEffect(() => {
    if (!authed) {
      setOrgs(null);
      setOrg(null);
      return;
    }
    api
      .me()
      .then(({ organizations }) => {
        setOrgs(organizations);
        const savedId = localStorage.getItem(ORG_KEY);
        const saved = organizations.find((o) => o.id === savedId);
        if (saved) setOrg(saved);
        else if (organizations.length === 1) setOrg(organizations[0]!);
      })
      .catch(() => setAuthed(!!api.getToken()));
  }, [authed]);

  // ---- org data + realtime ------------------------------------------------
  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    Promise.all([api.listProjects(org.id), api.listRuns(org.id), api.listApprovals(org.id)])
      .then(([p, r, a]) => {
        if (cancelled) return;
        setProjects(p.projects);
        setRuns(r.runs);
        setApprovals(a.approvals);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [org, refreshTick]);

  useEffect(() => {
    if (!org) return;
    const token = api.getToken();
    if (!token) return;
    // Live activity stream; a slow poll below covers reconnect gaps.
    sseRef.current = subscribeSSE(
      `${api.API_URL}/v1/orgs/${org.id}/events`,
      token,
      (data) => {
        try {
          const event = JSON.parse(data) as WorkflowEvent;
          if (event.type === "run_updated") refresh();
        } catch {
          /* ignore malformed events */
        }
      }
    );
    const poll = setInterval(refresh, 8000);
    return () => {
      sseRef.current?.close();
      clearInterval(poll);
    };
  }, [org, refresh]);

  const pendingApprovals = useMemo(
    () => approvals.filter((a) => a.status === "pending"),
    [approvals]
  );

  // ---- gates --------------------------------------------------------------
  if (!authed) return <LoginView onAuthed={() => setAuthed(true)} />;
  if (!orgs) return <div className="auth-wrap"><p className="muted">Loading your workspace…</p></div>;
  if (!org) {
    return (
      <OrgSetupView
        organizations={orgs}
        onSelect={(o) => {
          localStorage.setItem(ORG_KEY, o.id);
          setOrg(o);
        }}
        onCreated={() => api.me().then(({ organizations }) => setOrgs(organizations))}
      />
    );
  }

  const openProject = (project: Project) => {
    setActiveProject(project);
  };

  const navItems: Array<{ id: NavId; icon: string; label: string; badge?: number }> = [
    { id: "home", icon: "home", label: "Home" },
    { id: "projects", icon: "folder", label: "Projects" },
    { id: "grants", icon: "file-text", label: "Grants" },
    { id: "agents", icon: "users", label: "AI Team" },
    { id: "approvals", icon: "check-circle", label: "Approvals", badge: pendingApprovals.length },
  ];

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Primary">
        <div className="brand">
          <span className="brand-mark">D</span> Deedwell
        </div>
        <div className="org-badge">
          Organization
          <strong>{org.name}</strong>
        </div>
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${nav === item.id && !activeProject ? "active" : ""}`}
            onClick={() => {
              setNav(item.id);
              setActiveProject(null);
            }}
          >
            <Icon name={item.icon} />
            {item.label}
            {item.badge ? <span className="badge">{item.badge}</span> : null}
          </button>
        ))}
        {activeProject && (
          <button className="nav-item active" style={{ marginTop: 8 }}>
            <Icon name="file-text" />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeProject.name}
            </span>
          </button>
        )}
        <div className="spacer" />
        <button
          className="nav-item"
          onClick={() => {
            localStorage.removeItem(ORG_KEY);
            setOrg(null);
            setActiveProject(null);
          }}
        >
          <Icon name="columns" /> Switch organization
        </button>
        <button
          className="nav-item"
          onClick={() => {
            void api.logout().catch(() => undefined);
            api.setToken(null);
            setAuthed(false);
          }}
        >
          <Icon name="log-out" /> Sign out
        </button>
      </nav>

      <div className="main">
        {activeProject ? (
          <WorkspaceView
            org={org}
            project={activeProject}
            runs={runs.filter((r) => r.project_id === activeProject.id)}
            onBack={() => setActiveProject(null)}
            refresh={refresh}
          />
        ) : nav === "home" ? (
          <HomeView
            org={org}
            projects={projects}
            runs={runs}
            pendingApprovals={pendingApprovals}
            onOpenProject={openProject}
            onGoProjects={() => setNav("projects")}
            onGoApprovals={() => setNav("approvals")}
          />
        ) : nav === "projects" ? (
          <ProjectsView org={org} projects={projects} runs={runs} onOpen={openProject} refresh={refresh} />
        ) : nav === "grants" ? (
          <GrantsView
            org={org}
            projects={projects}
            onOpenProject={(projectId) => {
              const project = projects.find((p) => p.id === projectId);
              if (project) openProject(project);
            }}
            onOpenPassport={() => setNav("passport")}
          />
        ) : nav === "passport" ? (
          <PassportView org={org} onBack={() => setNav("grants")} />
        ) : nav === "agents" ? (
          <AgentsView />
        ) : (
          <ApprovalsView
            org={org}
            approvals={approvals}
            refresh={refresh}
            onOpenProject={(projectId) => {
              const project = projects.find((p) => p.id === projectId);
              if (project) openProject(project);
            }}
          />
        )}
      </div>
    </div>
  );
}
