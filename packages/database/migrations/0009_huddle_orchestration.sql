-- Orchestrated huddle events: routing, turn commits, backchannels, floor.
ALTER TABLE huddle_events DROP CONSTRAINT huddle_events_type_check;
ALTER TABLE huddle_events ADD CONSTRAINT huddle_events_type_check CHECK (type IN
  ('session_started','transcript_final','speaker_change','interruption','tool_call',
   'session_ended','stt_unavailable','turn_committed','routing','backchannel','floor'));
