import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import * as api from "../api";
import type { ChannelInfo, ChatMessage, Organization, TeammateInfo } from "../types";
import { Icon } from "../components/Icon";
import { roleAtLeast } from "../roles";

export function agentColor(key: string): string {
  const hue = [...key].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7);
  return `hsl(${hue} 45% 38%)`;
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
            <button
              type="button" className="icon-btn" title="Attach a file (.txt/.md)"
              aria-label="Attach file" disabled={!canPost}
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="upload" size={15} />
            </button>
            <button
              type="button" className="icon-btn"
              title="Voice input arrives with huddles (Phase 6)"
              aria-label="Voice input (not yet available)" disabled
            >
              <Icon name="activity" size={15} />
            </button>
            <button
              type="button" className="icon-btn" title="Mention a teammate"
              aria-label="Mention" disabled={!canPost}
              onClick={() => setText((t) => `${t}@`)}
            >
              <Icon name="users" size={15} />
            </button>
            <button className="primary send" disabled={!canPost || busy || !text.trim()}>
              Send
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
        <div style={{ width: 34, flexShrink: 0 }} />
      ) : (
        <div
          className="m-avatar"
          style={{ background: isAgent ? agentColor(m.author_agent ?? "") : "var(--info-dim)", color: isAgent ? "#fff" : "var(--info)" }}
          aria-hidden="true"
        >
          {who.name.slice(0, 2).toUpperCase()}
        </div>
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

        {meta.approvalId && (
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
    <div className="row" style={{ marginTop: 6 }}>
      <button className="primary" disabled={busy} onClick={() => decide("approved")}>Approve</button>
      <button className="danger" disabled={busy} onClick={() => decide("rejected")}>Reject</button>
    </div>
  );
}
