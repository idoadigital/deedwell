-- Real-time huddle sessions: ephemeral tokens, transcript segments, events.

CREATE TABLE huddle_sessions (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  huddle_id  uuid NOT NULL REFERENCES huddles(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  used_at    timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transcript_segments (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  huddle_id  uuid NOT NULL REFERENCES huddles(id),
  seq        integer NOT NULL,
  speaker_kind text NOT NULL CHECK (speaker_kind IN ('user','agent')),
  speaker_agent text,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (huddle_id, seq)
);

CREATE TABLE huddle_events (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  huddle_id  uuid NOT NULL REFERENCES huddles(id),
  type       text NOT NULL CHECK (type IN
    ('session_started','transcript_final','speaker_change','interruption','tool_call','session_ended','stt_unavailable')),
  payload    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX huddle_events_huddle_idx ON huddle_events (huddle_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['huddle_sessions','transcript_segments','huddle_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())',
      t, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON huddle_sessions TO deedwell_app;
GRANT SELECT, INSERT ON transcript_segments, huddle_events TO deedwell_app;
