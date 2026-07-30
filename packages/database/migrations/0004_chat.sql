-- Chat-first workspace: channels + messages (threads via parent_id).

CREATE TABLE channels (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES organizations(id),
  key        text NOT NULL,             -- 'general' | 'project:<uuid>'
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('team','project')),
  project_id uuid REFERENCES projects(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);
CREATE INDEX channels_tenant_idx ON channels (tenant_id);

CREATE TABLE messages (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  channel_id   uuid NOT NULL REFERENCES channels(id),
  parent_id    uuid REFERENCES messages(id),
  author_kind  text NOT NULL CHECK (author_kind IN ('user','agent','system')),
  author_user  uuid REFERENCES users(id),
  author_agent text,
  body         text NOT NULL,
  metadata     jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_channel_idx ON messages (channel_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['channels','messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())',
      t, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON channels, messages TO deedwell_app;
