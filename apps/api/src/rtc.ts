import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { uuidv7, withContext } from "@deedwell/database";
import { handleUserMessage, type ChannelRow } from "./assistant.js";
import { TEAMMATES, teammateByKey } from "./teammates.js";

const TEAMMATES_KEYS = TEAMMATES.map((t) => t.agentKey);
import { synthesize, voiceEnabled } from "./tts.js";
import {
  TurnManager, turnConfigFromEnv, classifyWhileAgentSpeaking, routeTurn,
  type CommittedTurn,
} from "./huddle-turns.js";
import { HttpError, type AppContext } from "./app.js";

/**
 * Real-time huddle session (WS transport; the token/event contract is
 * transport-agnostic so an SFU/WebRTC backend can slot in later).
 *
 * - Ephemeral single-use tokens (5 min TTL, hashed at rest) gate the socket.
 * - Streaming STT: audio frames proxy to a Vosk server (open source) —
 *   partials stream back live; finals persist and drive the agent pipeline.
 * - Orchestrator: ONE active speaker; agent replies come from the existing
 *   intent pipeline (context packager = existing buildContext: transcript,
 *   FTS retrieval, artifacts, memory). Sentence-level TTS streaming with
 *   barge-in: user speech or an interrupt frame cancels remaining sentences.
 * - Events (persisted + streamed): transcript_final, speaker_change,
 *   interruption, tool_call, session_started/ended, stt_unavailable.
 */

const STT_URL = process.env.STT_URL ?? "ws://127.0.0.1:2700";

interface SessionCtx {
  tenantId: string;
  userId: string;
  huddleId: string;
  channel: ChannelRow;
}

export function registerRtc(app: FastifyInstance, ctx: AppContext): void {
  // ---- ephemeral token issuance ------------------------------------------
  app.post("/v1/orgs/:orgId/huddles/:huddleId/rtc-session", async (req, reply) => {
    ctx.requireRole(req, "member");
    const { huddleId } = req.params as { huddleId: string };
    const result = await ctx.inOrg(req, async (client) => {
      const huddle = await client.query(
        `SELECT h.id, h.channel_id, c.key, c.name, c.kind, c.agent_key, c.project_id, p.type AS project_type
         FROM huddles h JOIN channels c ON c.id = h.channel_id
         LEFT JOIN projects p ON p.id = c.project_id
         WHERE h.id = $1 AND h.status = 'active'`,
        [huddleId]
      );
      if (!huddle.rows[0]) throw new HttpError(404, "No active huddle with that id");
      const token = randomBytes(24).toString("base64url");
      await client.query(
        `INSERT INTO huddle_sessions (id, tenant_id, huddle_id, user_id, token_hash, expires_at)
         VALUES ($1,$2,$3,$4,$5, now() + interval '5 minutes')`,
        [uuidv7(), req.orgId, huddleId, req.userId, sha(token)]
      );
      return { token, sttAvailable: true, voices: voiceEnabled() };
    });
    return reply.status(201).send({ ...result, wsPath: `/v1/rtc?token=${result.token}` });
  });

  // ---- the realtime socket (plugin must load before the route exists) ----
  void app.register(async (scope) => {
    await scope.register(websocket);
    scope.get("/v1/rtc", { websocket: true }, async (connection, req) => {
    // @fastify/websocket v10 passes a SocketStream; v11 passes the raw socket.
    const socket = ((connection as unknown as { socket?: WebSocket }).socket ??
      (connection as unknown as WebSocket)) as WebSocket;
    const token = (req.query as { token?: string }).token ?? "";
    const session = await redeemToken(ctx, token);
    if (!session) {
      socket.send(JSON.stringify({ type: "error", error: "Invalid or expired session token" }));
      socket.close();
      return;
    }
    const send = (msg: Record<string, unknown>) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
    };

    let seq = 0;
    let interrupted = false;
    let activeSpeaker: string | null = null; // agentKey while an agent holds the floor
    let agentAskedQuestion = false;          // last spoken sentence ended with "?"
    let closed = false;
    let sttReady = false;
    let currentTurnId = "";                  // only the latest committed turn may speak
    const turnConfig = turnConfigFromEnv();
    const speakChain = { p: Promise.resolve() };

    const persistEvent = (type: string, payload: Record<string, unknown> = {}) =>
      withContext(ctx.deps.appPool, { tenantId: session.tenantId, userId: session.userId }, (c) =>
        c.query(
          `INSERT INTO huddle_events (id, tenant_id, huddle_id, type, payload) VALUES ($1,$2,$3,$4,$5)`,
          [uuidv7(), session.tenantId, session.huddleId, type, JSON.stringify(payload)]
        )
      ).catch(() => undefined);

    const persistSegment = (kind: "user" | "agent", agent: string | null, body: string) => {
      const mySeq = ++seq;
      return withContext(ctx.deps.appPool, { tenantId: session.tenantId, userId: session.userId }, (c) =>
        c.query(
          `INSERT INTO transcript_segments (id, tenant_id, huddle_id, seq, speaker_kind, speaker_agent, body)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [uuidv7(), session.tenantId, session.huddleId, mySeq, kind, agent, body.slice(0, 2000)]
        )
      ).catch(() => undefined);
    };

    // ---- barge-in: anything from the user takes the floor back -----------
    const bargeIn = (reason: string) => {
      if (activeSpeaker) {
        interrupted = true;
        send({ type: "interruption", interrupted: activeSpeaker, reason });
        void persistEvent("interruption", { interrupted: activeSpeaker, reason });
        activeSpeaker = null;
        send({ type: "speaker_change", speaker: "user" });
      }
    };

    // ---- orchestrated agent reply (single active speaker, no crosstalk) --
    const respond = (finalText: string, turn?: CommittedTurn) => {
      const myTurnId = turn?.turnId ?? `text-${Date.now().toString(36)}`;
      currentTurnId = myTurnId; // a newer turn instantly stales older replies
      const committedAt = Date.now();
      let firstAudioLogged = false;
      speakChain.p = speakChain.p.then(async () => {
        if (closed || currentTurnId !== myTurnId) return; // stale — never speak
        interrupted = false;
        send({ type: "state", state: "deciding" });
        send({ type: "transcript_final", speaker: "user", body: finalText, turnId: myTurnId });
        void persistEvent("transcript_final", { speaker: "user", body: finalText.slice(0, 300), turnId: myTurnId });
        void persistSegment("user", null, finalText);
        if (turn) {
          void persistEvent("turn_committed", { turnId: myTurnId, reason: turn.reason, waitedMs: turn.waitedMs });
        }
        // Orchestrator: explicit addressing > ownership/continuity > expertise.
        const decision = routeTurn(myTurnId, finalText, {
          participants: sessionParticipants,
          taskOwnerAgent: null,
          recentSpeakers: recentAgentSpeakers,
          defaultAgent: session.channel.kind === "dm" && session.channel.agent_key
            ? session.channel.agent_key : "core.executive_assistant",
        });
        send({ type: "routing", primary: decision.primaryCandidateId, reasons: decision.reasonCodes, confidence: decision.routingConfidence });
        void persistEvent("routing", { ...decision } as Record<string, unknown>);
        console.log(JSON.stringify({ at: "huddle_routing", ...decision }));
        try {
          // Existing pipeline: context packager (transcript + FTS retrieval +
          // artifacts + memory) and intent execution — unchanged.
          const messages = await withContext(
            ctx.deps.appPool, { tenantId: session.tenantId, userId: session.userId },
            (client) => handleUserMessage(
              ctx.deps, client, { tenantId: session.tenantId, userId: session.userId },
              session.channel, finalText, null, null, session.huddleId,
              decision.primaryCandidateId
            )
          );
          if (closed || currentTurnId !== myTurnId) return; // turn changed while thinking
          for (const m of messages) {
            if (closed || interrupted || currentTurnId !== myTurnId) break;
            if (m.author_kind !== "agent") continue;
            const agent = String(m.author_agent);
            recentAgentSpeakers.unshift(agent);
            recentAgentSpeakers.length = Math.min(recentAgentSpeakers.length, 5);
            const body = String(m.body);
            if ((m.metadata as { runId?: string })?.runId) {
              send({ type: "tool_call", agent, detail: "started a workflow" });
              void persistEvent("tool_call", { agent, runId: (m.metadata as { runId?: string }).runId });
            }
            activeSpeaker = agent;
            send({ type: "speaker_change", speaker: agent, turnId: myTurnId });
            void persistEvent("speaker_change", { speaker: agent, turnId: myTurnId });
            void persistEvent("floor", { granted: agent, turnId: myTurnId });
            void persistSegment("agent", agent, body);
            // Sentence-level streaming TTS with barge-in between sentences.
            const sentences = body.match(/[^.!?\n]+[.!?]?/g) ?? [body];
            for (const sentence of sentences) {
              if (closed || interrupted || currentTurnId !== myTurnId) break;
              const clean = sentence.trim();
              if (!clean) continue;
              agentAskedQuestion = clean.endsWith("?");
              send({ type: "caption", speaker: agent, body: clean });
              if (!firstAudioLogged) {
                firstAudioLogged = true;
                console.log(JSON.stringify({ at: "huddle_latency", turnId: myTurnId, commitToFirstAudioMs: Date.now() - committedAt }));
              }
              if (voiceEnabled()) {
                try {
                  const wav = await synthesize(
                    ctx.deps.storage, teammateByKey.get(agent)?.voice ?? "af_heart", clean
                  );
                  if (closed || interrupted) break;
                  socket.send(wav); // binary frame = audio for the last caption
                } catch { /* captions carry it */ }
              }
            }
            if (activeSpeaker === agent) {
              activeSpeaker = null;
              send({ type: "speaker_change", speaker: "idle" });
            }
          }
        } catch (err) {
          send({ type: "error", error: err instanceof Error ? err.message.slice(0, 200) : "reply failed" });
        }
      });
    };

    // ---- streaming STT bridge (Vosk) -------------------------------------
    let stt: WebSocket | null = null;
    try {
      stt = new WebSocket(STT_URL);
      await new Promise<void>((resolve, reject) => {
        stt!.once("open", () => resolve());
        stt!.once("error", (e) => reject(e));
        setTimeout(() => reject(new Error("stt timeout")), 4000);
      });
      stt.send(JSON.stringify({ config: { sample_rate: 16000 } }));
      sttReady = true;
      stt.on("message", (data) => {
        try {
          const msg = JSON.parse(String(data)) as { partial?: string; text?: string };
          if (msg.partial !== undefined) {
            const p = msg.partial.trim();
            if (p) {
              if (activeSpeaker) {
                // Backchannels ("yeah", "mm-hmm") must not steal the floor.
                const cls = classifyWhileAgentSpeaking(p, turnConfig, agentAskedQuestion);
                if (cls === "interruption") bargeIn("user interrupted");
                else if (cls === "backchannel") {
                  send({ type: "backchannel", body: p });
                  void persistEvent("backchannel", { body: p.slice(0, 60) });
                  return; // acknowledged, not a turn
                }
              }
              turns.onPartial(p);
            }
            send({ type: "transcript_partial", speaker: "user", body: msg.partial });
          } else if (msg.text && msg.text.trim()) {
            // ASR finals are candidate segments — the Turn Manager decides
            // when the thought is actually complete (hybrid endpointing).
            if (activeSpeaker) {
              const cls = classifyWhileAgentSpeaking(msg.text.trim(), turnConfig, agentAskedQuestion);
              if (cls === "backchannel") {
                void persistEvent("backchannel", { body: msg.text.trim().slice(0, 60) });
                return;
              }
            }
            turns.onFinal(msg.text.trim());
          }
        } catch { /* ignore malformed */ }
      });
    } catch {
      sttReady = false;
      send({ type: "stt_unavailable", error: "Speech-to-text engine is unavailable — type instead." });
      void persistEvent("stt_unavailable");
    }

    const sessionParticipants = TEAMMATES_KEYS;
    const recentAgentSpeakers: string[] = [];
    const turns = new TurnManager(
      turnConfig,
      (turn) => respond(turn.text, turn),
      (state) => send({ type: "state", state: state.toLowerCase() })
    );

    send({ type: "session_started", stt: sttReady, voices: voiceEnabled(), turnConfig });
    void persistEvent("session_started", { stt: sttReady });

    socket.on("message", (raw, isBinary) => {
      if (isBinary) {
        // 16 kHz mono PCM16 frames from the client's AudioWorklet → Vosk.
        if (sttReady && stt?.readyState === WebSocket.OPEN) stt.send(raw as Buffer);
        return;
      }
      try {
        const msg = z.object({ type: z.string(), body: z.string().max(2000).optional() })
          .parse(JSON.parse(String(raw)));
        if (msg.type === "text" && msg.body?.trim()) {
          // Typed input is a deliberate, complete turn — committed immediately.
          bargeIn("user message");
          respond(msg.body.trim());
        } else if (msg.type === "interrupt") {
          bargeIn("user interrupt");
        } else if (msg.type === "flush") {
          turns.flush(); // deliberate end-of-turn (e.g. user muted the mic)
        }
      } catch { /* ignore malformed control frames */ }
    });

      socket.on("close", () => {
        closed = true;
        turns.dispose();
        stt?.close();
        void persistEvent("session_ended");
      });
    });
  });
}

function sha(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function redeemToken(ctx: AppContext, token: string): Promise<SessionCtx | null> {
  if (!token || token.length > 128) return null;
  const { rows } = await ctx.deps.adminPool.query(
    `UPDATE huddle_sessions SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING tenant_id, user_id, huddle_id`,
    [sha(token)]
  );
  if (!rows[0]) return null;
  const channel = await ctx.deps.adminPool.query(
    `SELECT c.id, c.key, c.name, c.kind, c.agent_key, c.project_id, p.type AS project_type
     FROM huddles h JOIN channels c ON c.id = h.channel_id
     LEFT JOIN projects p ON p.id = c.project_id WHERE h.id = $1`,
    [rows[0].huddle_id]
  );
  if (!channel.rows[0]) return null;
  return {
    tenantId: rows[0].tenant_id,
    userId: rows[0].user_id,
    huddleId: rows[0].huddle_id,
    channel: channel.rows[0] as ChannelRow,
  };
}
