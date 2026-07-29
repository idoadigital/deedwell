export type OrgRole = "owner" | "admin" | "member" | "viewer";

export interface Organization {
  id: string;
  slug: string;
  name: string;
  role: OrgRole;
}

export interface Project {
  id: string;
  name: string;
  type: "grant_application" | "website" | "other";
  status: string;
  created_at: string;
}

export type RunStatus =
  | "pending"
  | "running"
  | "waiting_for_info"
  | "waiting_approval"
  | "suspended_budget"
  | "failed"
  | "completed"
  | "cancelled";

export interface RunSummary {
  id: string;
  project_id: string;
  project_name?: string;
  definition: string;
  status: RunStatus;
  current_step: string;
  steps_used: number;
  step_budget: number;
  last_error: string | null;
  waiting: { kind: string; payload: string } | null;
  created_at: string;
  updated_at: string;
}

export interface RunStep {
  seq: number;
  step: string;
  attempt: number;
  status: "completed" | "failed";
  error: string | null;
  duration_ms: number;
  created_at: string;
}

export interface Approval {
  id: string;
  run_id?: string;
  kind: string;
  payload: { artifactId?: string; version?: number; warnings?: string[] };
  status: "pending" | "approved" | "rejected";
  note: string | null;
  created_at: string;
  project_name?: string;
  project_id?: string;
}

export interface ArtifactSummary {
  id: string;
  type:
    | "compliance_matrix"
    | "grant_section"
    | "export_package"
    | "application_plan"
    | "budget"
    | "logic_model"
    | "review_report"
    | "compliance_report";
  title: string;
  current_version: number;
  updated_at: string;
}

export interface RunDetail {
  run: RunSummary;
  steps: RunStep[];
  approvals: Approval[];
  artifacts: ArtifactSummary[];
}

export interface ArtifactVersion {
  version: number;
  content: Record<string, unknown>;
  created_by_kind: "user" | "agent";
  created_by_agent: string | null;
  change_summary: string;
  created_at: string;
}

export interface ArtifactDetail {
  artifact: ArtifactSummary & { project_id: string; run_id: string | null };
  versions: ArtifactVersion[];
}

export interface AgentInfo {
  agent_key: string;
  version: number;
  display_name: string;
  team: string;
  role: string;
  allowed_tools: string[];
}

export interface OrgFactRow {
  fact_key: string;
  value: string;
  status: string;
  updated_at: string;
}

export interface Requirement {
  text: string;
  kind: string;
  mandatory: boolean;
  sourceLocation: { line: number; quote: string };
  wordLimit: number | null;
}

export interface SectionClaim {
  text: string;
  factKey: string | null;
  support: string;
  flagged: boolean;
}

// ---- Phase 3 ----

export interface PassportFieldStatus {
  key: string;
  label: string;
  section: string;
  required: boolean;
  hint?: string;
  value: string | null;
  status: string | null;
}

export interface PassportStatus {
  fields: PassportFieldStatus[];
  completeness: number;
  requiredMissing: string[];
}

export interface SearchHit {
  externalId: string;
  opportunityNumber: string;
  title: string;
  agency: string;
  closeDate: string | null;
  status: string;
  sourceUrl: string;
  source: string;
}

export interface OpportunityRow {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  funder: string;
  source: string;
  opportunity_number: string | null;
  deadline: string | null;
  funding_max: string | null;
  status: string;
  eligibility: string | null;
  bid_recommendation: string | null;
  created_at: string;
}

export interface OpportunityDetail {
  opportunity: OpportunityRow & { injection_warnings: unknown[] };
  eligibility: {
    overall: string;
    rule_findings: Array<{ ruleKey: string; status: string; evidence: string }>;
    missing_facts: string[];
  } | null;
  bid: {
    id: string;
    scores: Array<{ key: string; label: string; score: number; weight: number; note: string }>;
    total: string | number;
    recommendation: string;
    rationale: string;
    decision: string | null;
  } | null;
  application: { id: string; run_id: string; status: string } | null;
}

export interface ApplicationRow {
  id: string;
  project_id: string;
  opportunity_id: string;
  run_id: string;
  status: string;
  opportunity_title: string;
  funder: string;
  deadline: string | null;
  outcome: string | null;
  award_amount: string | null;
}

export interface WorkflowEvent {
  type: "run_updated";
  tenantId: string;
  runId: string;
  status: RunStatus;
  step: string;
}
