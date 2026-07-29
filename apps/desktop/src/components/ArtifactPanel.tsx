import { useEffect, useMemo, useState } from "react";
import * as api from "../api";
import type {
  ArtifactDetail,
  Organization,
  Requirement,
  RunDetail,
  SectionClaim,
} from "../types";
import { Icon } from "./Icon";
import { diffLines } from "../diff";

const TYPE_LABEL: Record<string, string> = {
  compliance_matrix: "Compliance",
  grant_section: "Draft",
  export_package: "Export",
};

export function ArtifactPanel({ org, detail }: { org: Organization; detail: RunDetail | null }) {
  const artifacts = detail?.artifacts ?? [];
  const [activeId, setActiveId] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<ArtifactDetail | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = artifacts.find((a) => a.id === activeId) ?? artifacts[0] ?? null;

  useEffect(() => {
    if (!active) {
      setArtifact(null);
      return;
    }
    let cancelled = false;
    api
      .getArtifact(org.id, active.id)
      .then((a) => {
        if (cancelled) return;
        setArtifact(a);
        setVersion(a.artifact.current_version);
        setShowDiff(false);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load artifact"));
    return () => {
      cancelled = true;
    };
  }, [org.id, active?.id, active?.current_version]);

  const selectedVersion = useMemo(
    () => artifact?.versions.find((v) => v.version === version) ?? null,
    [artifact, version]
  );
  const previousVersion = useMemo(
    () => artifact?.versions.find((v) => v.version === (version ?? 0) - 1) ?? null,
    [artifact, version]
  );

  if (!detail || artifacts.length === 0) {
    return (
      <aside className="artifact-pane" aria-label="Artifacts">
        <div className="artifact-body">
          <div className="empty">
            <Icon name="file-text" size={22} />
            <p className="mt">Artifacts your team produces — compliance matrices, drafts,
            exports — appear here and update live.</p>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="artifact-pane" aria-label="Artifacts">
      <div className="artifact-tabs" role="tablist">
        {artifacts.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={a.id === active?.id}
            className={`artifact-tab ${a.id === active?.id ? "active" : ""}`}
            onClick={() => setActiveId(a.id)}
          >
            {TYPE_LABEL[a.type] ?? a.type}
          </button>
        ))}
      </div>
      {artifact && (
        <div className="artifact-toolbar">
          <span>{artifact.artifact.title}</span>
          <span style={{ marginLeft: "auto" }} />
          {artifact.versions.length > 1 && (
            <>
              <label htmlFor="ver" style={{ margin: 0 }}>Version</label>
              <select
                id="ver"
                value={version ?? undefined}
                onChange={(e) => setVersion(Number(e.target.value))}
              >
                {artifact.versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version}
                  </option>
                ))}
              </select>
              {previousVersion && artifact.artifact.type === "grant_section" && (
                <button className="ghost" onClick={() => setShowDiff((d) => !d)}>
                  {showDiff ? "Content" : "Diff"}
                </button>
              )}
            </>
          )}
        </div>
      )}
      <div className="artifact-body">
        {error && <p className="error-text" role="alert">{error}</p>}
        {!artifact && !error && <p className="muted">Loading…</p>}
        {artifact && selectedVersion && (
          <>
            {artifact.artifact.type === "compliance_matrix" && (
              <ComplianceMatrix content={selectedVersion.content} />
            )}
            {artifact.artifact.type === "grant_section" &&
              (showDiff && previousVersion ? (
                <SectionDiff
                  oldBody={String(previousVersion.content.body ?? "")}
                  newBody={String(selectedVersion.content.body ?? "")}
                />
              ) : (
                <SectionView content={selectedVersion.content} />
              ))}
            {artifact.artifact.type === "export_package" && (
              <ExportView
                orgId={org.id}
                artifactId={artifact.artifact.id}
                markdown={String(selectedVersion.content.markdown ?? "")}
              />
            )}
            <p className="faint mt">
              v{selectedVersion.version} · {selectedVersion.change_summary} ·{" "}
              {selectedVersion.created_by_kind === "agent"
                ? selectedVersion.created_by_agent
                : "you"}
            </p>
          </>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------

function ComplianceMatrix({ content }: { content: Record<string, unknown> }) {
  const requirements = (content.requirements ?? []) as Requirement[];
  return (
    <table>
      <thead>
        <tr><th>Requirement</th><th>Kind</th><th>Source</th></tr>
      </thead>
      <tbody>
        {requirements.map((r, i) => (
          <tr key={i}>
            <td>
              {r.mandatory ? (
                <span className="pill red" style={{ marginRight: 6 }}>must</span>
              ) : (
                <span className="pill gray" style={{ marginRight: 6 }}>should</span>
              )}
              {r.text}
              {r.wordLimit && <div className="faint">Limit: {r.wordLimit} words</div>}
            </td>
            <td className="muted">{r.kind}</td>
            <td className="mono">L{r.sourceLocation.line}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SectionView({ content }: { content: Record<string, unknown> }) {
  const claims = (content.claims ?? []) as SectionClaim[];
  const warnings = (content.warnings ?? []) as string[];
  return (
    <div className="prose">
      <h2>{String(content.title ?? "")}</h2>
      {String(content.body ?? "")
        .split("\n\n")
        .map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      <p className="faint">{Number(content.wordCount ?? 0)} words</p>
      {warnings.length > 0 && (
        <div className="msg-card warn">
          {warnings.map((w, i) => (
            <div key={i} className="row muted" style={{ fontSize: 13 }}>
              <Icon name="alert" size={13} /> {w}
            </div>
          ))}
        </div>
      )}
      <h3 className="mt">Evidence behind each claim</h3>
      {claims.map((c, i) => (
        <div key={i} className={`claim ${c.flagged ? "flagged" : "ok"}`}>
          <span className="support">{c.support.replace("_", " ")}</span>
          <div>{c.text}</div>
        </div>
      ))}
    </div>
  );
}

function SectionDiff({ oldBody, newBody }: { oldBody: string; newBody: string }) {
  const lines = diffLines(oldBody, newBody);
  return (
    <div className="diff" role="figure" aria-label="Changes between versions">
      {lines.map((l, i) => (
        <div key={i} className={`diff-line ${l.kind}`}>
          {l.kind === "added" ? "+ " : l.kind === "removed" ? "− " : "  "}
          {l.text || " "}
        </div>
      ))}
    </div>
  );
}

function ExportView({
  orgId,
  artifactId,
  markdown,
}: {
  orgId: string;
  artifactId: string;
  markdown: string;
}) {
  async function download() {
    const text = await api.getExportMarkdown(orgId, artifactId);
    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "application-package.md";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div>
      <button className="primary" onClick={download}>
        <span className="row"><Icon name="download" /> Download package (.md)</span>
      </button>
      <pre
        className="mono mt"
        style={{ whiteSpace: "pre-wrap", background: "var(--muted)", padding: 12, borderRadius: 8 }}
      >
        {markdown}
      </pre>
    </div>
  );
}
