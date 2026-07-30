-- Slack-style interface: DM conversations with AI teammates + default channels.

ALTER TABLE channels DROP CONSTRAINT channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check
  CHECK (kind IN ('team','project','dm'));
ALTER TABLE channels ADD COLUMN agent_key text;
ALTER TABLE channels ADD COLUMN starred boolean NOT NULL DEFAULT false;

GRANT UPDATE (starred) ON channels TO deedwell_app;
