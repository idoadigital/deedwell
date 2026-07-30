-- Phase 6: huddles — a live voice layer over a channel conversation.
CREATE TABLE huddles (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES organizations(id),
  channel_id uuid NOT NULL REFERENCES channels(id),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  started_by uuid NOT NULL REFERENCES users(id),
  summary    text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz
);
CREATE INDEX huddles_channel_idx ON huddles (channel_id, started_at);
ALTER TABLE huddles ENABLE ROW LEVEL SECURITY;
CREATE POLICY huddles_tenant ON huddles
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON huddles TO deedwell_app;
