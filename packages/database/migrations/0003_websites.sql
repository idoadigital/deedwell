-- Phase 4: website builder — structured CMS model, releases, forms.

CREATE TABLE sites (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES organizations(id),
  project_id         uuid NOT NULL REFERENCES projects(id),
  slug               text NOT NULL UNIQUE,  -- global: becomes <slug>.sites / <slug>.preview
  name               text NOT NULL,
  theme              jsonb NOT NULL DEFAULT '{}',
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','preview','published')),
  preview_release_id uuid,
  active_release_id  uuid,
  created_by         uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sites_tenant_idx ON sites (tenant_id);
CREATE TRIGGER sites_updated BEFORE UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE site_pages (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  site_id    uuid NOT NULL REFERENCES sites(id),
  slug       text NOT NULL,
  title      text NOT NULL,
  order_idx  integer NOT NULL,
  blocks     jsonb NOT NULL DEFAULT '[]',
  seo        jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, slug)
);
CREATE TRIGGER site_pages_updated BEFORE UPDATE ON site_pages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE site_releases (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  site_id        uuid NOT NULL REFERENCES sites(id),
  version        integer NOT NULL,
  snapshot       jsonb NOT NULL,          -- immutable pages+theme at build time
  storage_prefix text NOT NULL,
  checks         jsonb NOT NULL DEFAULT '[]',
  status         text NOT NULL DEFAULT 'built'
                 CHECK (status IN ('built','published','superseded')),
  run_id         uuid REFERENCES workflow_runs(id),
  approved_by    uuid REFERENCES users(id),
  published_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, version)
);
CREATE TRIGGER site_releases_updated BEFORE UPDATE ON site_releases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE form_submissions (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  site_id    uuid NOT NULL REFERENCES sites(id),
  form_key   text NOT NULL,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_submissions_site_idx ON form_submissions (site_id, created_at);

ALTER TABLE artifacts DROP CONSTRAINT artifacts_type_check;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_type_check CHECK (type IN
  ('compliance_matrix','grant_section','export_package','application_plan','budget',
   'logic_model','review_report','compliance_report','website_brief'));

-- RLS + grants
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sites','site_pages','site_releases','form_submissions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())',
      t, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON sites, site_releases TO deedwell_app;
-- site_pages is the mutable CMS working copy (releases are the immutable record).
GRANT SELECT, INSERT, UPDATE, DELETE ON site_pages TO deedwell_app;
GRANT SELECT ON form_submissions TO deedwell_app;
-- The public Site Router (a platform service, not a tenant actor) resolves
-- hosts and stores form submissions via the admin role; tenants read their
-- submissions through the RLS-bound API.
