import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { ChannelInfo, ChatMessage, Organization, TeammateInfo } from "../types";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";

/**
 * Voice huddle (BRD Phase 6): a call-style layer over the real channel.
 * Teammates speak with their own server-synthesized voices (Kokoro-82M,
 * open source, on-device to the server); captions + transcript always shown;
 * mic uses the browser SpeechRecognition API when available, with typing as
 * the universal fallback. Ending posts the summary into the channel.
 */
export function HuddleView({
  org,
  channel,
  teammates,
  onClose,
  refresh,
}: {
  org: Organization;
  channel: ChannelInfo;
  teammates: Map<string, TeammateInfo>;
  onClose: () => void;
  refresh: () => void;
}) {
  const [huddleId, setHuddleId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<string[]>([]);
  const [voices, setVoices] = useState(true);
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [caption, setCaption] = useState<string>("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const SpeechRec =
    typeof window !== "undefined"
      ? ((window as unknown as Record<string, unknown>).SpeechRecognition ??
         (window as unknown as Record<string, unknown>).webkitSpeechRecognition)
      : undefined;

  useEffect(() => {
    api.startHuddle(org.id, channel.id)
      .then((res) => {
        setHuddleId(res.huddleId);
        setParticipants(res.participants ?? ["core.executive_assistant"]);
        setVoices(res.voices);
        refresh();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not start the huddle"));
    return () => {
      audioRef.current?.pause();
      recRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speakQueue = useCallback((messages: ChatMessage[]) => {
    for (const m of messages) {
      if (m.author_kind !== "agent" || !m.author_agent) continue;
      const agent = m.author_agent;
      const body = m.body.slice(0, 600);
      queueRef.current = queueRef.current.then(async () => {
        setSpeaking(agent);
        setCaption(body);
        if (voices) {
          try {
            const blob = await api.fetchTtsBlob(org.id, agent, body);
            await new Promise<void>((resolve) => {
              const audio = new Audio(URL.createObjectURL(blob));
              audioRef.current = audio;
              audio.onended = () => { URL.revokeObjectURL(audio.src); resolve(); };
              audio.onerror = () => resolve();
              void audio.play().catch(() => resolve());
            });
          } catch {
            // Voice unavailable → captions carry the huddle; no fake audio.
            await new Promise((r) => setTimeout(r, Math.min(body.length * 40, 4000)));
          }
        } else {
          await new Promise((r) => setTimeout(r, Math.min(body.length * 40, 4000)));
        }
        setSpeaking(null);
      });
    }
  }, [org.id, voices]);

  async function say(body: string) {
    if (!body.trim() || !huddleId || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    try {
      if (/\b(wrap up|end (the )?huddle|that's all)\b/i.test(body)) {
        await api.sendMessage(org.id, channel.id, body.trim(), null, null, huddleId);
        await endHuddle();
        return;
      }
      const { messages } = await api.sendMessage(org.id, channel.id, body.trim(), null, null, huddleId);
      setTranscript((prev) => [...prev, ...messages]);
      speakQueue(messages);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setBusy(false);
    }
  }

  async function endHuddle() {
    if (!huddleId) { onClose(); return; }
    try {
      await api.endHuddle(org.id, huddleId);
    } catch { /* already ended is fine */ }
    refresh();
    onClose();
  }

  function toggleMic() {
    if (!SpeechRec) return;
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const RecCtor = SpeechRec as new () => {
      lang: string; interimResults: boolean; continuous: boolean;
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onend: () => void; onerror: () => void;
      start: () => void; stop: () => void;
    };
    const rec = new RecCtor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const said = Array.from({ length: e.results.length }, (_, i) => e.results[i]![0]!.transcript).join(" ");
      if (said.trim()) void say(said);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  const tiles = participants
    .map((key) => teammates.get(key))
    .filter((t): t is TeammateInfo => !!t);

  return (
    <div className="overlay" role="dialog" aria-label="Huddle">
      <div className="overlay-panel" style={{ width: "min(880px, 96vw)", height: "min(680px, 92vh)" }}>
        <div className="overlay-head">
          <span className="status-dot" aria-hidden="true" />
          <strong>Huddle · #{channel.name}</strong>
          {!voices && <span className="pill amber">captions only — voice unavailable</span>}
          <button className="danger" style={{ marginLeft: "auto", minHeight: 0, padding: "6px 14px" }} onClick={endHuddle}>
            End huddle
          </button>
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 20, gap: 14 }}>
            {error && <p className="error-text" role="alert">{error}</p>}
            <div className="huddle-grid">
              {tiles.map((t) => (
                <div key={t.agentKey} className={`huddle-tile ${speaking === t.agentKey ? "speaking" : ""}`}>
                  <Avatar id={t.agentKey} name={t.name} size={64} presence />
                  <strong>{t.name}</strong>
                  <span className="faint">{speaking === t.agentKey ? "speaking…" : t.role}</span>
                </div>
              ))}
              <div className={`huddle-tile ${listening ? "speaking" : ""}`}>
                <Avatar id="you" name="You" size={64} presence />
                <strong>You</strong>
                <span className="faint">{listening ? "listening…" : "ready"}</span>
              </div>
            </div>

            <div className="huddle-caption" aria-live="polite">
              {speaking
                ? <><strong>{teammates.get(speaking)?.name}:</strong> {caption}</>
                : busy ? "…" : "Speak or type — Maya will bring in the right teammates."}
            </div>

            <form
              className="row"
              onSubmit={(e) => { e.preventDefault(); void say(text); }}
            >
              <button
                type="button"
                className={listening ? "primary" : ""}
                title={SpeechRec ? (listening ? "Stop listening" : "Speak") : "Voice input needs Chrome's speech recognition — type instead"}
                aria-label="Microphone"
                disabled={!SpeechRec || busy}
                onClick={toggleMic}
              >
                <Icon name="activity" size={16} />
              </button>
              <input
                aria-label="Say something"
                placeholder={listening ? "Listening…" : "Say something…"}
                value={text}
                disabled={busy}
                onChange={(e) => setText(e.target.value)}
              />
              <button className="primary" disabled={busy || !text.trim()}>
                <Icon name="send" size={15} />
              </button>
            </form>
          </div>

          <aside style={{ width: 260, borderLeft: "1px solid var(--border-soft)", overflowY: "auto", padding: 14 }} aria-label="Live transcript">
            <h3 className="faint" style={{ textTransform: "uppercase", fontSize: 11.5, letterSpacing: "0.06em" }}>Transcript</h3>
            {transcript.filter((m) => !m.metadata?.huddleId || true).map((m) => (
              <p key={m.id} style={{ fontSize: 13, marginBottom: 8 }}>
                <strong>{m.author_kind === "user" ? "You" : teammates.get(m.author_agent ?? "")?.name ?? "Agent"}:</strong>{" "}
                <span className="muted">{m.body.slice(0, 200)}</span>
              </p>
            ))}
            {transcript.length === 0 && <p className="faint">The transcript appears here as you talk.</p>}
          </aside>
        </div>
      </div>
    </div>
  );
}
