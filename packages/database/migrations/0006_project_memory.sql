-- Agent context & memory: persistent per-project memory + message retrieval.

CREATE TABLE project_memories (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES organizations(id),
  project_id    uuid NOT NULL REFERENCES projects(id),
  summary       text NOT NULL DEFAULT '',
  key_decisions jsonb NOT NULL DEFAULT '[]',
  known_urls    jsonb NOT NULL DEFAULT '{}',
  latest_status text NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);
ALTER TABLE project_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_memories_tenant ON project_memories
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON project_memories TO deedwell_app;

-- Relevance retrieval over conversation history (hybrid keyword search now;
-- a pgvector embedding column is the documented upgrade path behind the same
-- retrieval interface — BRD §12.5 forbids vector-only retrieval anyway).
CREATE INDEX messages_fts_idx ON messages
  USING GIN (to_tsvector('english', body));
