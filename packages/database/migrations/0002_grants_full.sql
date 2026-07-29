-- Phase 3: full grant workspace — opportunity metadata, eligibility engine,
-- bid/no-bid, applications & sections, budgets, reviewer panel, outcomes.

ALTER TABLE grant_opportunities
  ADD COLUMN opportunity_number text,
  ADD COLUMN agency text,
  ADD COLUMN deadline date,
  ADD COLUMN funding_min numeric,
  ADD COLUMN funding_max numeric,
  ADD COLUMN geography text,
  ADD COLUMN source_url text,
  ADD COLUMN status text NOT NULL DEFAULT 'intake'
    CHECK (status IN ('intake','in_progress','not_pursued','ready','submitted','closed'));

ALTER TABLE grant_opportunities DROP CONSTRAINT grant_opportunities_source_check;
ALTER TABLE grant_opportunities ADD CONSTRAINT grant_opportunities_source_check
  CHECK (source IN ('upload','manual','grants_gov'));

ALTER TABLE artifacts DROP CONSTRAINT artifacts_type_check;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_type_check CHECK (type IN
  ('compliance_matrix','grant_section','export_package',
   'application_plan','budget','logic_model','review_report','compliance_report'));

CREATE TABLE eligibility_rules (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  opportunity_id uuid NOT NULL REFERENCES grant_opportunities(id),
  rule_key       text NOT NULL,
  kind           text NOT NULL CHECK (kind IN
    ('entity_type','registration_required','geography','max_annual_budget','deadline_future')),
  params         jsonb NOT NULL DEFAULT '{}',
  source_line    integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, rule_key)
);

CREATE TABLE eligibility_results (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  opportunity_id uuid NOT NULL REFERENCES grant_opportunities(id),
  run_id         uuid REFERENCES workflow_runs(id),
  overall        text NOT NULL CHECK (overall IN
    ('verified_eligible','likely_eligible','ineligible','insufficient_information','conflicting')),
  rule_findings  jsonb NOT NULL DEFAULT '[]',
  missing_facts  jsonb NOT NULL DEFAULT '[]',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX eligibility_results_opp_idx ON eligibility_results (opportunity_id, created_at);

CREATE TABLE bid_decisions (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  opportunity_id uuid NOT NULL REFERENCES grant_opportunities(id),
  run_id         uuid REFERENCES workflow_runs(id),
  scores         jsonb NOT NULL,
  total          numeric NOT NULL,
  recommendation text NOT NULL CHECK (recommendation IN ('apply','do_not_apply','needs_review')),
  rationale      text NOT NULL,
  decision       text CHECK (decision IN ('pursue','decline')),
  decided_by     uuid REFERENCES users(id),
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bid_decisions_opp_idx ON bid_decisions (opportunity_id, created_at);

CREATE TABLE grant_applications (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  project_id     uuid NOT NULL REFERENCES projects(id),
  opportunity_id uuid NOT NULL REFERENCES grant_opportunities(id),
  run_id         uuid REFERENCES workflow_runs(id),
  status         text NOT NULL DEFAULT 'planning' CHECK (status IN
    ('planning','drafting','review','ready','not_pursued','submitted','closed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER grant_applications_updated BEFORE UPDATE ON grant_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE application_sections (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  application_id uuid NOT NULL REFERENCES grant_applications(id),
  order_idx      integer NOT NULL,
  title          text NOT NULL,
  objective      text NOT NULL,
  word_limit     integer,
  requirement_lines jsonb NOT NULL DEFAULT '[]',
  artifact_id    uuid REFERENCES artifacts(id),
  status         text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','drafted','revised')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, order_idx)
);
CREATE TRIGGER application_sections_updated BEFORE UPDATE ON application_sections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE budgets (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  application_id uuid NOT NULL REFERENCES grant_applications(id),
  artifact_id    uuid REFERENCES artifacts(id),
  currency       text NOT NULL DEFAULT 'USD',
  total          numeric NOT NULL DEFAULT 0,
  warnings       jsonb NOT NULL DEFAULT '[]',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id)
);

CREATE TABLE budget_items (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  budget_id   uuid NOT NULL REFERENCES budgets(id),
  category    text NOT NULL,
  description text NOT NULL,
  activity    text NOT NULL,
  quantity    numeric NOT NULL,
  unit_cost   numeric NOT NULL,
  amount      numeric NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX budget_items_budget_idx ON budget_items (budget_id);
-- Idempotency for redrafts: rebuilding the budget updates items in place.
CREATE UNIQUE INDEX budget_items_dedup_idx ON budget_items (budget_id, md5(description));

CREATE TABLE review_runs (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  application_id uuid NOT NULL REFERENCES grant_applications(id),
  run_id         uuid REFERENCES workflow_runs(id),
  artifact_id    uuid REFERENCES artifacts(id),
  overall_score  numeric NOT NULL,
  max_score      numeric NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE review_scores (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  review_run_id uuid NOT NULL REFERENCES review_runs(id),
  reviewer      text NOT NULL,
  criterion     text NOT NULL,
  score         numeric NOT NULL,
  max_score     numeric NOT NULL,
  strengths     text NOT NULL,
  weaknesses    text NOT NULL,
  fatal_flaw    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_scores_run_idx ON review_scores (review_run_id);

CREATE TABLE grant_outcomes (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  application_id uuid NOT NULL REFERENCES grant_applications(id),
  status         text NOT NULL CHECK (status IN
    ('submitted','not_submitted','withdrawn','awarded','rejected','waitlisted')),
  award_amount   numeric,
  feedback       text,
  lessons        text,
  recorded_by    uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id)
);
CREATE TRIGGER grant_outcomes_updated BEFORE UPDATE ON grant_outcomes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS + grants
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'eligibility_rules','eligibility_results','bid_decisions','grant_applications',
    'application_sections','budgets','budget_items','review_runs','review_scores','grant_outcomes'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())',
      t, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON grant_applications, application_sections, budgets,
  budget_items, grant_outcomes, bid_decisions TO deedwell_app;
GRANT SELECT, INSERT ON eligibility_rules, eligibility_results,
  review_runs, review_scores TO deedwell_app;
