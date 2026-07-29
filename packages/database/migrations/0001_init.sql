-- Deedwell migration 0001: identity, tenancy, workflow engine, artifacts,
-- grant slice, governance. RLS everywhere a tenant owns rows.

CREATE EXTENSION IF NOT EXISTS citext;

-- Session-context accessors used by every RLS policy.
CREATE OR REPLACE FUNCTION app_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_user() RETURNS uuid
  LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS
  $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ---------------------------------------------------------------------------
-- Platform identity (no tenant scope; app role access is intentional and
-- limited to what login/session resolution requires).
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         citext NOT NULL UNIQUE,
  password_hash text   NOT NULL,
  display_name  text   NOT NULL,
  mfa_enrolled  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sessions (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

CREATE TABLE organizations (
  id         uuid PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  profile    jsonb NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER organizations_updated BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE organization_memberships (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES organizations(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  role       text NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX memberships_user_idx ON organization_memberships (user_id);
CREATE TRIGGER memberships_updated BEFORE UPDATE ON organization_memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invitations (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES organizations(id),
  email       citext NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin','member','viewer')),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Work management
-- ---------------------------------------------------------------------------

CREATE TABLE projects (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES organizations(id),
  name       text NOT NULL,
  type       text NOT NULL CHECK (type IN ('grant_application','website','other')),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_tenant_idx ON projects (tenant_id);
CREATE TRIGGER projects_updated BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE files (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES organizations(id),
  project_id  uuid NOT NULL REFERENCES projects(id),
  filename    text NOT NULL,
  mime        text NOT NULL,
  size_bytes  bigint NOT NULL,
  sha256      text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  -- Honest status: the malware-scanning worker is not yet implemented.
  scan_status text NOT NULL DEFAULT 'not_scanned'
              CHECK (scan_status IN ('not_scanned','pending','clean','infected')),
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_tenant_project_idx ON files (tenant_id, project_id);
CREATE TRIGGER files_updated BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Workflow engine (ADR-0002)
-- ---------------------------------------------------------------------------

CREATE TABLE workflow_runs (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES organizations(id),
  project_id         uuid NOT NULL REFERENCES projects(id),
  definition         text NOT NULL,
  definition_version integer NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','running','waiting_for_info','waiting_approval',
     'suspended_budget','failed','completed','cancelled')),
  current_step    text NOT NULL,
  state           jsonb NOT NULL DEFAULT '{}',
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 3,
  step_budget     integer NOT NULL DEFAULT 50,
  steps_used      integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  claimed_by      text,
  claimed_at      timestamptz,
  last_error      text,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_runs_claim_idx ON workflow_runs (status, next_attempt_at);
CREATE INDEX workflow_runs_tenant_idx ON workflow_runs (tenant_id);
CREATE TRIGGER workflow_runs_updated BEFORE UPDATE ON workflow_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE workflow_steps (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  run_id         uuid NOT NULL REFERENCES workflow_runs(id),
  seq            integer NOT NULL,
  step           text NOT NULL,
  attempt        integer NOT NULL,
  status         text NOT NULL CHECK (status IN ('completed','failed')),
  output_summary text,
  error          text,
  duration_ms    integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);
CREATE INDEX workflow_steps_run_idx ON workflow_steps (run_id);

CREATE TABLE approvals (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES organizations(id),
  run_id     uuid NOT NULL REFERENCES workflow_runs(id),
  kind       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approvals_run_idx ON approvals (run_id);
CREATE TRIGGER approvals_updated BEFORE UPDATE ON approvals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Agents & tool gateway audit
-- ---------------------------------------------------------------------------

CREATE TABLE agent_definitions (
  id                uuid PRIMARY KEY,
  agent_key         text NOT NULL,
  version           integer NOT NULL,
  display_name      text NOT NULL,
  team              text NOT NULL,
  role              text NOT NULL,
  instructions      text NOT NULL,
  allowed_tools     text[] NOT NULL,
  output_schema_ref text NOT NULL,
  budgets           jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_key, version)
);

CREATE TABLE tool_invocations (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  run_id         uuid,
  agent_key      text NOT NULL,
  tool           text NOT NULL,
  ok             boolean NOT NULL,
  input_summary  text NOT NULL,
  output_summary text,
  error          text,
  duration_ms    integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_invocations_tenant_idx ON tool_invocations (tenant_id, created_at);

-- ---------------------------------------------------------------------------
-- Artifacts
-- ---------------------------------------------------------------------------

CREATE TABLE artifacts (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES organizations(id),
  project_id      uuid NOT NULL REFERENCES projects(id),
  run_id          uuid REFERENCES workflow_runs(id),
  type            text NOT NULL CHECK (type IN ('compliance_matrix','grant_section','export_package')),
  title           text NOT NULL,
  current_version integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artifacts_tenant_project_idx ON artifacts (tenant_id, project_id);
CREATE TRIGGER artifacts_updated BEFORE UPDATE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE artifact_versions (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL,
  artifact_id      uuid NOT NULL REFERENCES artifacts(id),
  version          integer NOT NULL,
  content          jsonb NOT NULL,
  created_by_kind  text NOT NULL CHECK (created_by_kind IN ('user','agent')),
  created_by_user  uuid REFERENCES users(id),
  created_by_agent text,
  change_summary   text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, version)
);

-- ---------------------------------------------------------------------------
-- Grant slice
-- ---------------------------------------------------------------------------

CREATE TABLE grant_opportunities (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES organizations(id),
  project_id         uuid NOT NULL REFERENCES projects(id),
  title              text NOT NULL,
  funder             text NOT NULL,
  source             text NOT NULL CHECK (source IN ('upload','manual')),
  file_id            uuid REFERENCES files(id),
  injection_warnings jsonb NOT NULL DEFAULT '[]',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER grant_opportunities_updated BEFORE UPDATE ON grant_opportunities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE grant_requirements (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  opportunity_id uuid NOT NULL REFERENCES grant_opportunities(id),
  text           text NOT NULL,
  kind           text NOT NULL,
  mandatory      boolean NOT NULL,
  source_line    integer NOT NULL,
  source_quote   text NOT NULL,
  word_limit     integer,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','covered','waived')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- Idempotency: re-running the extraction step must not duplicate rows.
CREATE UNIQUE INDEX grant_requirements_dedup_idx
  ON grant_requirements (opportunity_id, source_line, md5(text));

CREATE TABLE org_facts (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES organizations(id),
  fact_key     text NOT NULL,
  value        text NOT NULL,
  status       text NOT NULL CHECK (status IN
    ('verified','user_certified','estimate','assumption','unsupported')),
  source       text,
  certified_by uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, fact_key)
);
CREATE TRIGGER org_facts_updated BEFORE UPDATE ON org_facts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Governance
-- ---------------------------------------------------------------------------

CREATE TABLE audit_events (
  id          uuid PRIMARY KEY,
  seq         bigserial,
  tenant_id   uuid NOT NULL,
  actor_user  uuid,
  actor_agent text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  metadata    jsonb NOT NULL DEFAULT '{}',
  prev_hash   text NOT NULL,
  event_hash  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_tenant_idx ON audit_events (tenant_id, seq);

CREATE TABLE usage_ledger (
  id        uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  run_id    uuid,
  kind      text NOT NULL CHECK (kind IN ('model_tokens','steps')),
  quantity  numeric NOT NULL,
  metadata  jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_ledger_tenant_idx ON usage_ledger (tenant_id, created_at);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE organizations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE files                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_steps           ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals                ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_invocations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_versions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_opportunities      ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_requirements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_facts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_ledger             ENABLE ROW LEVEL SECURITY;

-- An org row is visible inside its own tenant context, or to any of its members
-- (so users can list their organizations before selecting one).
CREATE POLICY org_select ON organizations FOR SELECT USING (
  id = app_tenant()
  OR EXISTS (SELECT 1 FROM organization_memberships m
             WHERE m.tenant_id = organizations.id AND m.user_id = app_user())
);
CREATE POLICY org_insert ON organizations FOR INSERT WITH CHECK (id = app_tenant());
CREATE POLICY org_update ON organizations FOR UPDATE USING (id = app_tenant());

CREATE POLICY memberships_select ON organization_memberships FOR SELECT USING (
  tenant_id = app_tenant() OR user_id = app_user()
);
CREATE POLICY memberships_write ON organization_memberships FOR INSERT
  WITH CHECK (tenant_id = app_tenant());
CREATE POLICY memberships_update ON organization_memberships FOR UPDATE
  USING (tenant_id = app_tenant());

-- Plain tenant policies for everything else.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invitations','projects','files','workflow_runs','workflow_steps','approvals',
    'tool_invocations','artifacts','artifact_versions','grant_opportunities',
    'grant_requirements','org_facts','audit_events','usage_ledger'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I_tenant ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())',
      t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Grants for the RLS-bound application role (created by the migration runner).
-- Append-only tables get no UPDATE/DELETE (threat model T9).
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO deedwell_app;
GRANT SELECT, INSERT, UPDATE ON users, sessions, organizations,
  organization_memberships, invitations, projects, files, workflow_runs,
  approvals, artifacts, grant_opportunities, org_facts TO deedwell_app;
GRANT SELECT, INSERT ON workflow_steps, tool_invocations, artifact_versions,
  grant_requirements, audit_events, usage_ledger TO deedwell_app;
GRANT SELECT ON agent_definitions TO deedwell_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO deedwell_app;
