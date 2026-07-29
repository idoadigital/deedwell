import { useEffect, useState } from "react";
import * as api from "../api";
import type { AgentInfo } from "../types";
import { Icon } from "../components/Icon";

const TEAM_LABEL: Record<string, string> = {
  core: "Core Team",
  grant: "Grant Team",
  website: "Website Team",
};

export function AgentsView() {
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listAgents()
      .then(({ agents }) => setAgents(agents))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load agents"));
  }, []);

  return (
    <>
      <header className="main-header">
        <h1>AI Team</h1>
        <span className="sub">Your organization&rsquo;s specialist agents</span>
      </header>
      <div className="main-scroll">
        {error && <p className="error-text" role="alert">{error}</p>}
        {!agents && !error && <p className="muted">Loading…</p>}
        {agents?.map((agent) => (
          <div className="card" key={agent.agent_key}>
            <div className="row">
              <span className="avatar agent" aria-hidden="true">
                {initials(agent.display_name)}
              </span>
              <div>
                <strong>{agent.display_name}</strong>
                <div className="faint">{agent.role}</div>
              </div>
              <span className="pill blue" style={{ marginLeft: "auto" }}>
                {TEAM_LABEL[agent.team] ?? agent.team}
              </span>
              <span className="pill gray">v{agent.version}</span>
            </div>
            <div className="row mt faint">
              <Icon name="bot" size={13} />
              Permitted tools: {agent.allowed_tools.join(", ") || "none"}
            </div>
          </div>
        ))}
        {agents && (
          <p className="faint">
            Agents are AI team members with defined roles, tool permissions, and budgets. They
            can&rsquo;t publish, export, or spend beyond limits without your approval.
          </p>
        )}
      </div>
    </>
  );
}

function initials(name: string): string {
  const first = name.split(/[\s—-]+/)[0] ?? "";
  return first.slice(0, 2).toUpperCase();
}
