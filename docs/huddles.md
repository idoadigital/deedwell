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
- **Deferred honestly**: server-side STT (whisper.cpp is the planned path), multi-human
  huddles/WebRTC, barge-in interruption of playback.
