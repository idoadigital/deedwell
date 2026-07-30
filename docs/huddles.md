# Huddles (Phase 6)

A huddle is a **voice layer over the real channel** — utterances are genuine messages
(metadata.huddleId), so intent routing, workflows, approvals ("approve" works by voice),
memory, and the milestone bridge all function mid-huddle. Nothing is a parallel fake pipeline.

- **Voices**: Kokoro-82M (Apache-2.0 open-source TTS) runs in-process in Node via ONNX —
  no Python, no external voice API, no audio leaves the server. Each of the 13 teammates has
  a distinct voice (teammates.ts). Clips are content-addressed and cached (repeat lines serve
  in ~30ms; cold synthesis ≈ real-time on CPU). `VOICE_PROVIDER=off` disables voice honestly:
  the endpoint returns 503 and the huddle runs captions-only with a visible badge.
- **Facilitation**: Maya opens and facilitates; participants are the channel's natural team
  (DM partner, grant team, or website team). One active huddle per channel; re-joining resumes.
- **UI**: call-style tiles with speaking glow, live captions (aria-live), always-on transcript
  pane, mic via the browser SpeechRecognition API where available (typing is the universal
  fallback — no fake mic), sequential audio playback queue.
- **Ending** ("wrap up" or the button): the huddle closes with a summary message in the
  channel — exchange count, decisions made during the huddle (from real approval records),
  and the transcript. Audited start/end.
## Realtime session (upgrade)

- **Transport**: WebSocket audio session gated by **ephemeral single-use tokens** (5-min TTL,
  hashed at rest, redeemed atomically). Stated plainly: this is WS, not an SFU/WebRTC stack —
  the token + event contract is transport-agnostic so an SFU can replace the pipe later.
- **Streaming STT**: Vosk small-English model in a **memory-capped container** (700MB limit,
  ~140MB actual — the initial large-model attempt OOM-killed the cluster's Traefik and was
  replaced). True partials stream live; finals drive the existing agent pipeline. Verified
  closed-loop: Kokoro-spoken audio transcribed verbatim by Vosk.
- **Orchestrator**: ONE active speaker, serialized replies (no crosstalk). **Barge-in**: user
  speech (a partial arriving) or an interrupt frame cancels remaining TTS sentences mid-reply;
  sentence-level TTS streaming makes interruption near-immediate.
- **Context packager**: unchanged — the existing buildContext (transcript, FTS retrieval,
  artifacts, memory) feeds every huddle reply.
- **Persistence** (migration 0008, tenant-scoped RLS): `huddle_sessions`,
  `transcript_segments`, `huddle_events` (session_started/ended, transcript_final,
  speaker_change, interruption, tool_call, stt_unavailable) — streamed to the client and stored.
- **UI**: same stage — tiles/captions/transcript — now event-driven, with live partial line,
  streaming mic (AudioWorklet → 16k PCM16), mute/unmute, and honest degraded modes
  (stt_unavailable → type; voice off → captions).
- **Deferred honestly**: SFU/WebRTC transport, multi-human huddles, echo-cancellation tuning
  beyond the browser's built-ins.
