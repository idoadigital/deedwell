import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import * as api from "../api";
import type { ChannelInfo, ChatMessage, Organization, TeammateInfo } from "../types";
import { Icon } from "../components/Icon";
import { Avatar } from "../components/Avatar";
import { chips, fitLabel, headline, type BidPayload } from "../decision";
import { roleAtLeast } from "../roles";

export function agentColor(key: string): string {
  const hue = [...key].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7);
  return `hsl(${hue} 40% 45%)`;
}

export function splitAgent(teammates: Map<string, TeammateInfo>, agentKey: string | null) {
  if (!agentKey) return { name: "Deedwell", role: "" };
  const mate = teammates.get(agentKey);
  return mate ? { name: mate.name, role: mate.role } : { name: agentKey, role: "" };
}

export function ChatView({
  org,
  channel,
  teammates,
  refreshTick,
  refresh,
  onOpenChannel,
  onOpenWork,
}: {
  org: Organization;
  channel: ChannelInfo;
  teammates: Map<string, TeammateInfo>;
  refreshTick: number;
  refresh: () => void;
  onOpenChannel: (channelId: string) => void;
  onOpenWork: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canPost = roleAtLeast(org.role, "member");

  useEffect(() => {
    let cancelled = false;
    api
      .listMessages(org.id, channel.id)
      .then(({ messages }) => {
        if (!cancelled) setMessages(messages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load messages"));
    return () => {
      cancelled = true;
    };
  }, [org.id, channel.id, refreshTick]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, channel.id]);

  async function send(body: string, fileId?: string | null) {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { messages: created } = await api.sendMessage(org.id, channel.id, body.trim(), fileId);
      setMessages((prev) => [...prev, ...created]);
      setText("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message failed to send");
    } finally {
      setBusy(false);
    }
  }

  async function attach(file: File) {
    setBusy(true);
    setError(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of buf) binary += String.fromCharCode(byte);
      const { fileId, filename } = await api.uploadChatFile(
        org.id, channel.id, file.name,
        file.name.endsWith(".md") ? "text/markdown" : "text/plain", btoa(binary)
      );
      setBusy(false);
      await send(`Attached: ${filename}`, fileId);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(text);
    }
  }

  return (
    <>
      <div className="chat-scroll" ref={scrollRef}>
        {messages.map((m, i) => (
          <Message
            key={m.id}
            m={m}
            prev={messages[i - 1]}
            teammates={teammates}
            org={org}
            onOpenChannel={onOpenChannel}
            onOpenWork={onOpenWork}
            onQuickSend={(body) => void send(body)}
            refresh={refresh}
          />
        ))}
        {messages.length === 0 && (
          <p className="empty">No messages yet — say hello.</p>
        )}
      </div>
      <div className="composer-wrap">
        {error && <p className="error-text" role="alert">{error}</p>}
        <form
          className="composer-box"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <textarea
            aria-label={`Message ${channel.kind === "dm" ? channel.name : `#${channel.name}`}`}
            placeholder={
              canPost
                ? `Message ${channel.kind === "dm" ? channel.name : `#${channel.name}`}`
                : "Viewers can read but not post"
            }
            value={text}
            disabled={!canPost || busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
          />
          <div className="composer-actions">
            <button type="button" className="icon-btn" title="Attach a file (.txt/.md)"
              aria-label="Attach file" disabled={!canPost} onClick={() => fileRef.current?.click()}>
              <Icon name="plus" size={16} />
            </button>
            <button type="button" className="icon-btn" title="Bold (wraps **text**)"
              aria-label="Format text" disabled={!canPost}
              onClick={() => setText((t) => (t.trim() ? `**${t.trim()}**` : t))}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Aa</span>
            </button>
            <button type="button" className="icon-btn" title="Add an emoji"
              aria-label="Add emoji" disabled={!canPost}
              onClick={() => setText((t) => `${t}🙂`)}>
              <span style={{ fontSize: 15 }}>☺</span>
            </button>
            <button type="button" className="icon-btn" title="Mention a teammate"
              aria-label="Mention a teammate" disabled={!canPost}
              onClick={() => setText((t) => `${t}@`)}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>@</span>
            </button>
            <button type="button" className="icon-btn" title="Attach a file"
              aria-label="Attach a file" disabled={!canPost} onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={15} />
            </button>
            <span className="sep" aria-hidden="true" />
            <button type="button" className="icon-btn" title="Ask Maya what to do next"
              aria-label="AI assist" disabled={!canPost} style={{ color: "#7c5cbf" }}
              onClick={() => setText("Maya, what should we do next?")}>
              <span style={{ fontSize: 15 }}>✦</span>
            </button>
            <button className="send" disabled={!canPost || busy || !text.trim()} aria-label="Send message">
              <Icon name="send" size={16} />
            </button>
          </div>
          <input
            ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void attach(file);
              e.target.value = "";
            }}
          />
        </form>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function Message({
  m,
  prev,
  teammates,
  org,
  onOpenChannel,
  onOpenWork,
  onQuickSend,
  refresh,
}: {
  m: ChatMessage;
  prev?: ChatMessage;
  teammates: Map<string, TeammateInfo>;
  org: Organization;
  onOpenChannel: (id: string) => void;
  onOpenWork: () => void;
  onQuickSend: (body: string) => void;
  refresh: () => void;
}) {
  const isAgent = m.author_kind === "agent";
  const who = isAgent ? splitAgent(teammates, m.author_agent) : { name: m.author_name ?? "You", role: "" };
  const grouped =
    prev &&
    prev.author_kind === m.author_kind &&
    prev.author_agent === m.author_agent &&
    prev.author_user === m.author_user &&
    new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 4 * 60_000;
  const meta = m.metadata ?? {};

  return (
    <div className="chat-msg">
      {grouped ? (
        <div style={{ width: 44, flexShrink: 0 }} />
      ) : (
        <Avatar
          id={m.author_agent ?? m.author_user ?? "user"}
          name={who.name}
          size={44}
          presence={isAgent}
        />
      )}
      <div className="m-body">
        {!grouped && (
          <div className="m-head">
            <span className="m-name">{who.name}</span>
            {who.role && <span className="m-role">{who.role}</span>}
            <span className="m-time">
              {new Date(m.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        )}
        <div className="m-text">{meta.fileId ? <><Icon name="file-text" size={13} /> {m.body}</> : m.body}</div>

        {meta.searchResults && (
          <div className="chat-card">
            {meta.searchResults.map((r) => (
              <div key={r.index} className="row" style={{ padding: "6px 0", borderBottom: "1px solid var(--border-soft)" }}>
                <span className="pill blue">#{r.index}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{r.title}</div>
                  <div className="faint">
                    {r.funder}{r.number ? ` · ${r.number}` : ""}{r.closeDate ? ` · closes ${r.closeDate}` : ""}
                    {r.sourceUrl?.startsWith("http") && (
                      <> · <a href={r.sourceUrl} target="_blank" rel="noreferrer">details ↗</a></>
                    )}
                  </div>
                </div>
                <button className="ghost" onClick={() => onQuickSend(`apply for #${r.index}`)}>
                  Apply
                </button>
              </div>
            ))}
          </div>
        )}

        {meta.infoRequest && meta.infoRequest.length > 0 && (
          <InfoQuickForm keys={meta.infoRequest} onSubmit={onQuickSend} />
        )}

        {meta.approvalId && meta.approvalKind === "bid_decision" && (
          <GrantDecisionCard
            org={org}
            approvalId={meta.approvalId}
            payload={(meta.approvalPayload ?? {}) as BidPayload}
            refresh={refresh}
          />
        )}
        {meta.approvalId && meta.approvalKind !== "bid_decision" && (
          <ApprovalActions org={org} approvalId={meta.approvalId} refresh={refresh} />
        )}

        {meta.goToChannelId && (
          <div className="chat-card">
            <button className="primary" onClick={() => onOpenChannel(meta.goToChannelId!)}>
              Open channel →
            </button>
          </div>
        )}

        {meta.runId && !meta.approvalId && (
          <div style={{ marginTop: 4 }}>
            <button className="ghost" onClick={onOpenWork}>
              <span className="row"><Icon name="file-text" size={13} /> View the work</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoQuickForm({ keys, onSubmit }: { keys: string[]; onSubmit: (body: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  if (sent) return null;
  return (
    <form
      className="chat-card"
      onSubmit={(e) => {
        e.preventDefault();
        const lines = keys
          .filter((k) => values[k]?.trim())
          .map((k) => `${k}: ${values[k]!.trim()}`);
        if (lines.length) {
          onSubmit(lines.join("\n"));
          setSent(true);
        }
      }}
    >
      {keys.map((k) => (
        <div className="field" key={k} style={{ marginBottom: 8 }}>
          <label htmlFor={`iq-${k}`}>{k.replace(/_/g, " ")}</label>
          <input id={`iq-${k}`} value={values[k] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />
        </div>
      ))}
      <button className="primary">Send answers</button>
    </form>
  );
}

/** Reusable, fully wired decision card for bid/no-bid approvals (theme.png). */
function GrantDecisionCard({
  org,
  approvalId,
  payload,
  refresh,
}: {
  org: Organization;
  approvalId: string;
  payload: BidPayload;
  refresh: () => void;
}) {
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canDecide = roleAtLeast(org.role, "admin");
  const total = Number(payload.total ?? 0);
  const fit = fitLabel(payload.recommendation, total);
  const chipList = chips(payload.dimensions);

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    try {
      await api.decideApproval(org.id, approvalId, decision);
      setDone(decision === "approved" ? "Proceeding — the team is on it." : "Passed on this one.");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="decision-card">
      <div className="decision-top">
        <div className="decision-score">
          <div className="medal" aria-hidden="true"><Icon name="check-circle" size={26} /></div>
          <div className="num">{total}<small> /100</small></div>
          <div className={`fit ${fit.tone === "good" ? "" : fit.tone === "warn" ? "warn" : "low"}`}>{fit.label}</div>
        </div>
        <div className="decision-main">
          <div className="headline">{headline(payload.recommendation)}</div>
          <div className="expl">{(payload.rationale ?? "").split(". ").slice(1).join(". ") || payload.rationale}</div>
          <div className="decision-chips">
            {chipList.map((c) => (
              <span key={c.label} className={`chip ${c.good ? "good" : ""}`}>
                <Icon name={c.good ? "check-circle" : "clock"} size={13} /> {c.label}: {c.value}
              </span>
            ))}
          </div>
        </div>
      </div>
      {payload.dimensions && (
        <div className="decision-why">
          <div className="why-title"><Icon name="alert" size={14} /> Why this score?</div>
          <p>{payload.dimensions.map((d) => d.note).slice(0, 2).join(" ")}</p>
        </div>
      )}
      <div className="decision-actions">
        {done ? (
          <span className="pill green">{done}</span>
        ) : canDecide ? (
          <>
            <button className="primary" disabled={busy} onClick={() => decide("approved")}>
              Proceed →
            </button>
            <button className="danger" disabled={busy} onClick={() => decide("rejected")}>
              Pass ✕
            </button>
          </>
        ) : (
          <span className="faint">An admin can decide here or by replying "approve" / "pass".</span>
        )}
      </div>
    </div>
  );
}

function ApprovalActions({
  org,
  approvalId,
  refresh,
}: {
  org: Organization;
  approvalId: string;
  refresh: () => void;
}) {
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canDecide = roleAtLeast(org.role, "admin");
  if (!canDecide) return <p className="faint">An admin can approve this here or by replying "approve".</p>;
  if (done) return <p className="faint">You {done} this.</p>;
  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    try {
      await api.decideApproval(org.id, approvalId, decision);
      setDone(decision);
      refresh();
    } catch {
      setDone(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="row" style={{ marginTop: 8 }}>
      <button className="primary" disabled={busy} onClick={() => decide("approved")}>Proceed →</button>
      <button className="danger" disabled={busy} onClick={() => decide("rejected")}>Pass ✕</button>
    </div>
  );
}
