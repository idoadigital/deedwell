-- Grant application workspace: durable task state, verifiable activity
-- timeline, and research provenance. The chat thread stops being the only
-- source of application state (workspace spec §1, §4, §19).

-- A blocked-but-remembered user intent (e.g. "apply" waiting on a document)
-- lives on the project so it survives refreshes, restarts, and agent handoffs.
ALTER TABLE projects ADD COLUMN pending_intent jsonb;
ALTER TABLE projects ADD COLUMN workspace_status text NOT NULL DEFAULT 'created';
ALTER TABLE projects ADD COLUMN workspace_phase text NOT NULL DEFAULT '';

-- Structured, user-safe work events (never chain-of-thought).
CREATE TABLE workspace_events (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES organizations(id),
  project_id   uuid NOT NULL REFERENCES projects(id),
  run_id       uuid,
  event_type   text NOT NULL,
  title        text NOT NULL,
  summary      text NOT NULL DEFAULT '',
  status       text NOT NULL CHECK (status IN ('in_progress','completed','failed','blocked')),
  agent_key    text,
  artifact_id  uuid,
  metadata     jsonb NOT NULL DEFAULT '{}',
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX workspace_events_project_idx ON workspace_events (project_id, created_at DESC);
ALTER TABLE workspace_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_events_tenant ON workspace_events
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON workspace_events TO deedwell_app;

-- Every retrieved source is recorded with URL, timestamp, and outcome, so no
-- research claim exists without provenance (workspace spec §5, §19).
CREATE TABLE research_sources (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES organizations(id),
  project_id   uuid NOT NULL REFERENCES projects(id),
  url          text,
  title        text NOT NULL,
  publisher    text,
  source_type  text NOT NULL DEFAULT 'OFFICIAL_ANNOUNCEMENT',
  reliability  text NOT NULL DEFAULT 'PRIMARY_OFFICIAL',
  fetch_status text NOT NULL DEFAULT 'retrieved',
  file_id      uuid,
  excerpt      text NOT NULL DEFAULT '',
  retrieved_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_sources_project_idx ON research_sources (project_id, retrieved_at DESC);
ALTER TABLE research_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY research_sources_tenant ON research_sources
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON research_sources TO deedwell_app;
