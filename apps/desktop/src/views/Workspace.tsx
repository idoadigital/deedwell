import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import * as api from "../api";
import type { Organization, Project, RunDetail, RunStep, RunSummary } from "../types";
import { Icon } from "../components/Icon";
import { StatusPill } from "../components/StatusPill";
import { ArtifactPanel } from "../components/ArtifactPanel";
import { roleAtLeast } from "../roles";

interface Message {
  key: string;
  who: string;
  avatar: string;
  tone: "agent" | "system" | "user";
  when: string | null;
  text: string;
  error?: string;
}

const STEP_NARRATION: Record<string, { who: string; avatar: string; text: string }> = {
  parse_document: {
    who: "Priya · Requirements Analyst",
    avatar: "PR",
    text: "Reviewed the opportunity document and checked it for embedded instructions.",
  },
  extract_requirements: {
    who: "Priya · Requirements Analyst",
    avatar: "PR",
    text: "Extracted the funder's requirements with source locations and built the compliance matrix.",
  },
  check_org_info: {
    who: "Priya · Requirements Analyst",
    avatar: "PR",
    text: "Checked the organization profile against what this opportunity requires.",
  },
  draft_section: {
    who: "Marcus · Grant Writer",
    avatar: "MA",
    text: "Drafted the section from approved organizational facts and flagged anything unsupported.",
  },
  export_package: {
    who: "Deedwell",
    avatar: "D",
    text: "Assembled the approved export package.",
  },
  eligibility_check: {
    who: "Elena · Eligibility Analyst",
    avatar: "EL",
    text: "Ran the deterministic eligibility rules against the organization's fact ledger.",
  },
  bid_no_bid: {
    who: "Noor · Funding Strategist",
    avatar: "NO",
    text: "Scored this opportunity across eligibility, timing, readiness, fit, and burden.",
  },
  bid_gate: {
    who: "Deedwell",
    avatar: "D",
    text: "Recorded your bid decision.",
  },
  plan_application: {
    who: "Sofia · Program Design Specialist",
    avatar: "SO",
    text: "Planned the application sections and program activities from the requirements.",
  },
  build_budget: {
    who: "Ade · Budget Specialist",
    avatar: "AD",
    text: "Built the line-item budget, tying every line to a planned activity.",
  },
  build_logic_model: {
    who: "Ingrid · MEL Specialist",
    avatar: "IN",
    text: "Produced the logic model and indicator table.",
  },
  review_panel: {
    who: "Reviewer Panel",
    avatar: "RP",
    text: "Four reviewer perspectives scored the application against the funder's requirements.",
  },
  final_compliance: {
    who: "Deedwell",
    avatar: "D",
    text: "Ran the final deterministic compliance checks.",
  },
  final_gate: {
    who: "Deedwell",
    avatar: "D",
    text: "Recorded your final decision.",
  },
  export_full: {
    who: "Deedwell",
    avatar: "D",
    text: "Assembled the approved application package with budget CSV.",
  },
};

export function WorkspaceView({
  org,
  project,
  runs,
  onBack,
  refresh,
}: {
  org: Organization;
  project: Project;
  runs: RunSummary[];
  onBack: () => void;
  refresh: () => void;
}) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestRun = runs[0] ?? null;

  useEffect(() => {
    if (!latestRun) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    api
      .getRun(org.id, latestRun.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load run"));
    return () => {
      cancelled = true;
    };
  }, [org.id, latestRun?.id, latestRun?.updated_at, latestRun?.status]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [detail?.steps.length, detail?.run.status]);

  const messages = useMemo(() => (detail ? buildMessages(detail) : []), [detail]);

  return (
    <>
      <header className="main-header">
        <button className="ghost" onClick={onBack} aria-label="Back to projects">
          ← Back
        </button>
        <h1>{project.name}</h1>
        {latestRun && <StatusPill status={detail?.run.status ?? latestRun.status} />}
      </header>
      <div className="workspace">
        <div className="timeline-pane">
          <div className="timeline-scroll" ref={scrollRef}>
            {error && <p className="error-text" role="alert">{error}</p>}
            {!latestRun && <IntakeCard org={org} project={project} refresh={refresh} />}
            {messages.map((m) => (
              <div className="msg" key={m.key}>
                <span className={`avatar ${m.tone}`} aria-hidden="true">{m.avatar}</span>
                <div className="msg-body">
                  <div className="msg-head">
                    <span className="who">{m.who}</span>
                    {m.when && <span className="when">{formatTime(m.when)}</span>}
                  </div>
                  <div className="msg-text">{m.text}</div>
                  {m.error && <div className="error-text">{m.error}</div>}
                </div>
              </div>
            ))}
            {detail && <ContextCards org={org} detail={detail} refresh={refresh} />}
          </div>
          {detail && <UsageFooter detail={detail} />}
        </div>
        <ArtifactPanel org={org} detail={detail} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function buildMessages(detail: RunDetail): Message[] {
  const messages: Message[] = [
    {
      key: "start",
      who: "You",
      avatar: "YO",
      tone: "user",
      when: detail.run.created_at,
      text: "Started a grant application from an uploaded opportunity document.",
    },
  ];
  for (const step of detail.steps) {
    const meta = STEP_NARRATION[step.step];
    messages.push({
      key: `step-${step.seq}`,
      who: meta?.who ?? step.step,
      avatar: meta?.avatar ?? "AI",
      tone: step.step === "export_package" ? "system" : "agent",
      when: step.created_at,
      text:
        step.status === "failed"
          ? `Attempt ${step.attempt} of "${step.step}" failed.`
          : meta?.text ?? `Completed step "${step.step}".`,
      ...(step.status === "failed" && step.error ? { error: step.error } : {}),
    });
  }
  return messages;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Contextual action cards (the "composer" of this conversation)
// ---------------------------------------------------------------------------

function ContextCards({
  org,
  detail,
  refresh,
}: {
  org: Organization;
  detail: RunDetail;
  refresh: () => void;
}) {
  const status = detail.run.status;
  if (status === "waiting_for_info") {
    return <InfoRequestCard org={org} detail={detail} refresh={refresh} />;
  }
  if (status === "waiting_approval") {
    return <ApprovalCard org={org} detail={detail} refresh={refresh} />;
  }
  if (status === "failed") {
    return (
      <div className="msg-card warn">
        <strong>This workflow stopped after repeated failures.</strong>
        <p className="muted mt">{detail.run.last_error}</p>
        <p className="faint">The run is preserved and can be resumed once the cause is fixed.</p>
      </div>
    );
  }
  if (status === "suspended_budget") {
    return (
      <div className="msg-card warn">
        <strong>Paused: this run reached its usage budget.</strong>
        <p className="muted mt">A human needs to review and raise the budget before it continues.</p>
      </div>
    );
  }
  if (status === "completed") {
    return (
      <div className="msg-card">
        <div className="row">
          <Icon name="check-circle" />
          <strong>Application package ready.</strong>
        </div>
        <p className="muted mt">
          Open the <em>Export</em> tab in the artifact panel to review and download it. Deedwell
          prepares stronger applications — funding is never guaranteed.
        </p>
      </div>
    );
  }
  return (
    <div className="msg">
      <span className="avatar agent" aria-hidden="true">…</span>
      <div className="msg-body">
        <div className="msg-text">The team is working — currently at “{detail.run.current_step}”.</div>
      </div>
    </div>
  );
}

function parseMissingFacts(detail: RunDetail): string[] {
  try {
    const payload = detail.run.waiting?.payload;
    if (!payload) return [];
    const parsed = JSON.parse(payload) as { missingFacts?: string[] };
    return parsed.missingFacts ?? [];
  } catch {
    return [];
  }
}

const FACT_LABELS: Record<string, string> = {
  legal_name: "Legal name of the organization",
  entity_type: "Entity type (e.g. 501(c)(3))",
  registration_status: "Registration status",
  annual_budget: "Annual budget",
  mission: "Mission statement",
};

function InfoRequestCard({
  org,
  detail,
  refresh,
}: {
  org: Organization;
  detail: RunDetail;
  refresh: () => void;
}) {
  const missing = parseMissingFacts(detail);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canProvide = roleAtLeast(org.role, "member");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.provideInfo(
        org.id,
        detail.run.id,
        missing.map((key) => ({ key, value: values[key] ?? "" })).filter((f) => f.value.trim())
      );
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the information");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="msg">
      <span className="avatar agent" aria-hidden="true">PR</span>
      <div className="msg-body">
        <div className="msg-head"><span className="who">Priya · Requirements Analyst</span></div>
        <div className="msg-text">
          Before drafting, I need a few facts about your organization. What you enter is recorded
          as user-certified evidence.
        </div>
        <form className="msg-card" onSubmit={submit}>
          {missing.map((key) => (
            <div className="field" key={key}>
              <label htmlFor={`fact-${key}`}>{FACT_LABELS[key] ?? key.replace(/_/g, " ")}</label>
              <input
                id={`fact-${key}`}
                required
                disabled={!canProvide}
                value={values[key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              />
            </div>
          ))}
          {error && <p className="error-text" role="alert">{error}</p>}
          {canProvide ? (
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Provide information"}
            </button>
          ) : (
            <p className="faint">A member of your organization needs to provide this.</p>
          )}
        </form>
      </div>
    </div>
  );
}

const APPROVAL_PRESENTATION: Record<
  string,
  { who: string; avatar: string; text: string; yes: string; no: string }
> = {
  section_export: {
    who: "Marcus · Grant Writer", avatar: "MA",
    text: "The draft is ready for your review. Nothing is exported until you approve it.",
    yes: "Approve & export", no: "Request changes",
  },
  bid_decision: {
    who: "Noor · Funding Strategist", avatar: "NO",
    text: "Here is my bid/no-bid assessment. Pursue this opportunity, or pass and save the effort?",
    yes: "Pursue this grant", no: "Don't pursue",
  },
  final_export: {
    who: "Deedwell", avatar: "D",
    text: "The full application passed internal review and compliance checks. Approve to export the final package.",
    yes: "Approve & export package", no: "Send back for redrafting",
  },
};

function ApprovalCard({
  org,
  detail,
  refresh,
}: {
  org: Organization;
  detail: RunDetail;
  refresh: () => void;
}) {
  const approval = detail.approvals.find((a) => a.status === "pending");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canDecide = roleAtLeast(org.role, "admin");

  if (!approval) return null;
  const meta = APPROVAL_PRESENTATION[approval.kind] ?? APPROVAL_PRESENTATION.section_export!;
  const payload = approval.payload as {
    warnings?: string[];
    recommendation?: string;
    total?: number;
    rationale?: string;
    dimensions?: Array<{ label: string; score: number; note: string }>;
    reviewScore?: string;
  };

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      await api.decideApproval(org.id, approval!.id, decision, note || undefined);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="msg">
      <span className="avatar agent" aria-hidden="true">{meta.avatar}</span>
      <div className="msg-body">
        <div className="msg-head"><span className="who">{meta.who}</span></div>
        <div className="msg-text">{meta.text}</div>
        <div className="msg-card">
          {payload.recommendation && (
            <p style={{ marginBottom: 8 }}>
              <span className={`pill ${payload.recommendation === "apply" ? "green" : payload.recommendation === "needs_review" ? "amber" : "red"}`}>
                {payload.recommendation.replace(/_/g, " ")} · {payload.total}/100
              </span>
            </p>
          )}
          {payload.rationale && <p className="muted" style={{ fontSize: 13 }}>{payload.rationale}</p>}
          {payload.dimensions && (
            <table style={{ marginBottom: 8 }}>
              <tbody>
                {payload.dimensions.map((d) => (
                  <tr key={d.label}>
                    <td style={{ width: 170 }}>{d.label}</td>
                    <td className="mono" style={{ width: 46 }}>{d.score}/5</td>
                    <td className="faint">{d.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {payload.reviewScore && (
            <p className="muted" style={{ fontSize: 13 }}>Internal review panel score: {payload.reviewScore}</p>
          )}
          {(approval.payload.warnings?.length ?? 0) > 0 && (
            <div className="msg-card warn" style={{ marginTop: 0 }}>
              <strong style={{ fontSize: 12.5 }}>Flagged for your attention</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {approval.payload.warnings!.map((w, i) => (
                  <li key={i} className="muted" style={{ fontSize: 13 }}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {canDecide ? (
            <>
              <div className="field mt">
                <label htmlFor="approval-note">Note (optional)</label>
                <input id="approval-note" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              {error && <p className="error-text" role="alert">{error}</p>}
              <div className="row">
                <button className="primary" disabled={busy} onClick={() => decide("approved")}>
                  {meta.yes}
                </button>
                <button className="danger" disabled={busy} onClick={() => decide("rejected")}>
                  {meta.no}
                </button>
              </div>
            </>
          ) : (
            <p className="faint" style={{ marginTop: 8 }}>
              An admin or owner must approve this before export.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function IntakeCard({
  org,
  project,
  refresh,
}: {
  org: Organization;
  project: Project;
  refresh: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [funder, setFunder] = useState("");
  const [deadline, setDeadline] = useState("");
  const [fundingMax, setFundingMax] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canStart = roleAtLeast(org.role, "member");

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of buf) binary += String.fromCharCode(byte);
      const { fileId } = await api.uploadFile(
        org.id,
        project.id,
        file.name,
        file.name.endsWith(".md") ? "text/markdown" : "text/plain",
        btoa(binary)
      );
      const { opportunityId } = await api.importOpportunity(org.id, project.id, {
        title,
        funder,
        deadline: deadline || null,
        fundingMax: fundingMax ? Number(fundingMax) : null,
        source: "manual",
      });
      await api.startGrantApplication(org.id, project.id, { opportunityId, fileId });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the workflow");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="msg">
      <span className="avatar system" aria-hidden="true">D</span>
      <div className="msg-body">
        <div className="msg-head"><span className="who">Deedwell</span></div>
        <div className="msg-text">
          Upload a grant opportunity document (.txt or .md for now) and the Grant Team will
          extract requirements, check eligibility, score the bid decision, and — if you choose
          to pursue it — plan, draft, budget, and review the full application.
        </div>
        {canStart ? (
          <form className="msg-card" onSubmit={start}>
            <div className="field">
              <label htmlFor="opp-file">Opportunity document</label>
              <input
                id="opp-file"
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="opp-title">Opportunity title</label>
                <input id="opp-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="opp-funder">Funder</label>
                <input id="opp-funder" required value={funder} onChange={(e) => setFunder(e.target.value)} />
              </div>
            </div>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="opp-deadline">Deadline (if known)</label>
                <input
                  id="opp-deadline"
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="opp-max">Maximum award (USD, if known)</label>
                <input
                  id="opp-max"
                  type="number"
                  min="0"
                  value={fundingMax}
                  onChange={(e) => setFundingMax(e.target.value)}
                />
              </div>
            </div>
            {error && <p className="error-text" role="alert">{error}</p>}
            <button className="primary" disabled={busy || !file}>
              <span className="row"><Icon name="upload" /> {busy ? "Starting…" : "Start grant workflow"}</span>
            </button>
          </form>
        ) : (
          <p className="faint">Viewers can follow work here; starting workflows requires the member role.</p>
        )}
      </div>
    </div>
  );
}

function UsageFooter({ detail }: { detail: RunDetail }) {
  return (
    <div className="composer">
      <div className="row faint">
        <Icon name="activity" size={13} />
        Workflow “{detail.run.definition}” · step {detail.run.steps_used} of budget{" "}
        {detail.run.step_budget} · every action is audited
      </div>
    </div>
  );
}
