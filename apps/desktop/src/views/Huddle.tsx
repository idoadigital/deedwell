import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { ChannelInfo, Organization, TeammateInfo } from "../types";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";

/**
 * Real-time voice huddle: ephemeral-token WS session, streaming STT partials,
 * sentence-streamed TTS, ONE orchestrated active speaker with barge-in.
 * Same stage UI as before — tiles, captions, transcript — now event-driven.
 */

interface Line { id: string; speaker: string; body: string; kind: "user" | "agent" | "note" }

// Downsamples mic audio to 16 kHz PCM16 frames for streaming STT.
const WORKLET = `
class DwCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.ratio = sampleRate / 16000; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i += this.ratio) {
        const s = Math.max(-1, Math.min(1, ch[Math.floor(i)]));
        this.buf.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
      if (this.buf.length >= 3200) {
        this.port.postMessage(new Int16Array(this.buf.splice(0, 3200)).buffer);
      }
    }
    return true;
  }
}
registerProcessor("dw-capture", DwCapture);`;

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
  const [live, setLive] = useState(false);
  const [sttOk, setSttOk] = useState(false);
  const [voices, setVoices] = useState(true);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [partial, setPartial] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioQ = useRef<Blob[]>([]);
  const playing = useRef<HTMLAudioElement | null>(null);
  const micStop = useRef<(() => void) | null>(null);

  const addLine = (kind: Line["kind"], speaker: string, body: string) =>
    setLines((prev) => [...prev.slice(-120), { id: `${Date.now()}-${prev.length}`, kind, speaker, body }]);

  const stopPlayback = useCallback(() => {
    audioQ.current = [];
    playing.current?.pause();
    playing.current = null;
  }, []);

  const pump = useCallback(() => {
    if (playing.current || !audioQ.current.length) return;
    const blob = audioQ.current.shift()!;
    const audio = new Audio(URL.createObjectURL(blob));
    playing.current = audio;
    audio.onended = audio.onerror = () => {
      URL.revokeObjectURL(audio.src);
      playing.current = null;
      pump();
    };
    void audio.play().catch(() => { playing.current = null; pump(); });
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;
    (async () => {
      try {
        const started = await api.startHuddle(org.id, channel.id);
        if (cancelled) return;
        setHuddleId(started.huddleId);
        setParticipants(started.participants ?? ["core.executive_assistant"]);
        setVoices(started.voices);
        refresh();
        const sess = await api.rtcSession(org.id, started.huddleId);
        const base = api.API_URL.startsWith("http")
          ? api.API_URL
          : window.location.origin + api.API_URL;
        ws = new WebSocket(`${base.replace(/^http/, "ws")}/v1/rtc?token=${sess.token}`);
        ws.binaryType = "blob";
        wsRef.current = ws;
        ws.onopen = () => setLive(true);
        ws.onclose = () => setLive(false);
        ws.onerror = () => setError("Realtime connection lost — you can still type; replies land in the channel.");
        ws.onmessage = (ev) => {
          if (ev.data instanceof Blob) {
            audioQ.current.push(ev.data);
            pump();
            return;
          }
          try {
            const msg = JSON.parse(String(ev.data));
            switch (msg.type) {
              case "session_started":
                setSttOk(!!msg.stt);
                setVoices(!!msg.voices);
                break;
              case "transcript_partial":
                setPartial(msg.body ?? "");
                break;
              case "transcript_final":
                setPartial("");
                addLine("user", "You", msg.body);
                break;
              case "speaker_change":
                setSpeaking(msg.speaker === "idle" ? null : msg.speaker);
                if (msg.speaker === "user") stopPlayback();
                break;
              case "caption":
                setCaption(msg.body ?? "");
                if (msg.speaker) addLine("agent", msg.speaker, msg.body ?? "");
                break;
              case "interruption":
                stopPlayback();
                addLine("note", "system", "— interrupted —");
                break;
              case "tool_call":
                addLine("note", msg.agent ?? "system", "⚙ " + (msg.detail ?? "working"));
                break;
              case "stt_unavailable":
                setSttOk(false);
                setError(msg.error);
                break;
              case "error":
                setError(msg.error);
                break;
            }
          } catch { /* ignore */ }
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start the huddle");
      }
    })();
    return () => {
      cancelled = true;
      micStop.current?.();
      stopPlayback();
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleMic() {
    if (micOn) {
      micStop.current?.();
      micStop.current = null;
      setMicOn(false);
      return;
    }
    if (!window.isSecureContext) {
      setError("The microphone needs the secure address (https://app.deedwell.org).");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const ctx = new AudioContext();
      await ctx.audioWorklet.addModule(
        URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }))
      );
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "dw-capture");
      node.port.onmessage = (e) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(e.data);
      };
      src.connect(node);
      micStop.current = () => {
        node.disconnect(); src.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
      };
      setMicOn(true);
      stopPlayback();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone unavailable");
    }
  }

  function sendText() {
    const body = text.trim();
    if (!body) return;
    setText("");
    if (/\b(wrap up|end (the )?huddle|that's all)\b/i.test(body)) { void endHuddle(); return; }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      stopPlayback();
      wsRef.current.send(JSON.stringify({ type: "text", body }));
      addLine("user", "You", body);
    } else if (huddleId) {
      void api.sendMessage(org.id, channel.id, body, null, null, huddleId).then(() => refresh());
      addLine("user", "You", body);
    }
  }

  async function endHuddle() {
    micStop.current?.();
    stopPlayback();
    if (huddleId) { try { await api.endHuddle(org.id, huddleId); } catch { /* fine */ } }
    refresh();
    onClose();
  }

  const tiles = participants
    .map((key) => teammates.get(key))
    .filter((t): t is TeammateInfo => !!t);

  return (
    <div className="overlay" role="dialog" aria-label="Huddle">
      <div className="overlay-panel" style={{ width: "min(920px, 96vw)", height: "min(700px, 92vh)" }}>
        <div className="overlay-head">
          <span className="status-dot" aria-hidden="true" />
          <strong>Huddle · #{channel.name}</strong>
          {live
            ? <span className="pill green">live{sttOk ? " · voice in/out" : voices ? " · voice out" : " · captions"}</span>
            : <span className="pill amber">connecting…</span>}
          <button className="danger" style={{ marginLeft: "auto", minHeight: 0, padding: "6px 14px" }} onClick={endHuddle}>
            End huddle
          </button>
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 20, gap: 14, minWidth: 0 }}>
            {error && <p className="error-text" role="alert">{error}</p>}
            <div className="huddle-grid">
              {tiles.map((t) => (
                <div key={t.agentKey} className={"huddle-tile " + (speaking === t.agentKey ? "speaking" : "")}>
                  <Avatar id={t.agentKey} name={t.name} size={64} presence />
                  <strong>{t.name}</strong>
                  <span className="faint">{speaking === t.agentKey ? "speaking…" : t.role}</span>
                </div>
              ))}
              <div className={"huddle-tile " + (micOn || speaking === "user" ? "speaking" : "")}>
                <Avatar id="you" name="You" size={64} presence />
                <strong>You</strong>
                <span className="faint">{micOn ? "mic live" : "mic off"}</span>
              </div>
            </div>

            <div className="huddle-caption" aria-live="polite">
              {partial
                ? <em className="muted">{partial}…</em>
                : speaking && speaking !== "user"
                  ? <><strong>{teammates.get(speaking)?.name ?? ""}:</strong>&nbsp;{caption}</>
                  : "Speak (mic) or type — one voice at a time; talking interrupts."}
            </div>

            <div className="row">
              <button
                className={micOn ? "primary" : ""}
                title={sttOk ? (micOn ? "Mute" : "Unmute — speaking interrupts the agent") : "Speech-to-text unavailable — type instead"}
                aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
                disabled={!live || !sttOk}
                onClick={() => void toggleMic()}
              >
                <Icon name="activity" size={16} /> {micOn ? "Mute" : "Speak"}
              </button>
              <input
                aria-label="Say something"
                placeholder="Type to the team…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendText(); }}
              />
              <button className="primary" onClick={sendText} disabled={!text.trim()}>
                <Icon name="send" size={15} />
              </button>
            </div>
          </div>

          <aside style={{ width: 280, borderLeft: "1px solid var(--border-soft)", overflowY: "auto", padding: 14 }} aria-label="Live transcript">
            <h3 className="faint" style={{ textTransform: "uppercase", fontSize: 11.5, letterSpacing: "0.06em" }}>Transcript</h3>
            {lines.map((l) => (
              <p key={l.id} style={{ fontSize: 13, marginBottom: 8, opacity: l.kind === "note" ? 0.7 : 1 }}>
                <strong>{l.kind === "user" ? "You" : teammates.get(l.speaker)?.name ?? l.speaker}:</strong>{" "}
                <span className="muted">{l.body.slice(0, 240)}</span>
              </p>
            ))}
            {partial && <p style={{ fontSize: 13 }} className="faint"><em>{partial}…</em></p>}
            {lines.length === 0 && !partial && <p className="faint">Live captions and turns appear here.</p>}
          </aside>
        </div>
      </div>
    </div>
  );
}
