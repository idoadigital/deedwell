import { z } from "zod";

// ---------------------------------------------------------------------------
// Identity & tenancy
// ---------------------------------------------------------------------------

export const OrgRole = z.enum(["owner", "admin", "member", "viewer"]);
export type OrgRole = z.infer<typeof OrgRole>;

/** Role hierarchy for permission checks: higher index = more authority. */
export const ORG_ROLE_ORDER: OrgRole[] = ["viewer", "member", "admin", "owner"];

export const RegisterInput = z.object({
  email: z.string().email().max(320),
  password: z.string().min(10).max(256),
  displayName: z.string().min(1).max(120),
});

export const LoginInput = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});

export const CreateOrgInput = z.object({
  name: z.string().min(2).max(200),
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "lowercase letters, digits, hyphens"),
});

export const AddMemberInput = z.object({
  email: z.string().email(),
  role: OrgRole,
});

// ---------------------------------------------------------------------------
// Projects & files
// ---------------------------------------------------------------------------

export const ProjectType = z.enum(["grant_application", "website", "other"]);

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(200),
  type: ProjectType,
});

export const UploadFileInput = z.object({
  filename: z.string().min(1).max(255),
  // Base64 payload keeps the slice transport-simple; multipart streaming is a
  // planned replacement and changes nothing downstream of the storage adapter.
  contentBase64: z.string().max(10_000_000),
  mime: z.enum(["text/plain", "text/markdown"]),
});

// ---------------------------------------------------------------------------
// Grant domain — compliance matrix & sections
// ---------------------------------------------------------------------------

export const RequirementKind = z.enum([
  "eligibility",
  "narrative",
  "budget",
  "attachment",
  "formatting",
  "deadline",
  "other",
]);

export const SourceLocation = z.object({
  line: z.number().int().positive(),
  quote: z.string().min(1).max(2000),
});

export const ExtractedRequirement = z.object({
  text: z.string().min(1).max(4000),
  kind: RequirementKind,
  mandatory: z.boolean(),
  sourceLocation: SourceLocation,
  wordLimit: z.number().int().positive().nullable(),
});
export type ExtractedRequirement = z.infer<typeof ExtractedRequirement>;

/** Requirements Analyst output contract (agent output schema). */
export const RequirementsExtractionOutput = z.object({
  requirements: z.array(ExtractedRequirement).min(1),
  documentSummary: z.string().max(2000),
});
export type RequirementsExtractionOutput = z.infer<typeof RequirementsExtractionOutput>;

export const FactStatus = z.enum([
  "verified",
  "user_certified",
  "estimate",
  "assumption",
  "unsupported",
]);
export type FactStatus = z.infer<typeof FactStatus>;

export const OrgFact = z.object({
  key: z.string().min(1).max(120),
  value: z.string().min(1).max(4000),
  status: FactStatus,
});
export type OrgFact = z.infer<typeof OrgFact>;

export const SectionClaim = z.object({
  text: z.string().min(1).max(4000),
  factKey: z.string().nullable(),
  support: FactStatus,
  flagged: z.boolean(),
});
export type SectionClaim = z.infer<typeof SectionClaim>;

/** Grant Writer output contract (agent output schema). */
export const SectionDraftOutput = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1),
  claims: z.array(SectionClaim),
  wordCount: z.number().int().nonnegative(),
});
export type SectionDraftOutput = z.infer<typeof SectionDraftOutput>;

export const ProvideInfoInput = z.object({
  facts: z
    .array(z.object({ key: z.string().min(1).max(120), value: z.string().min(1).max(4000) }))
    .min(1),
});

export const ApprovalDecisionInput = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(2000).optional(),
});

export const StartGrantSliceInput = z.object({
  fileId: z.string().uuid(),
  opportunityTitle: z.string().min(1).max(300),
  funder: z.string().min(1).max(300),
  sectionTitle: z.string().min(1).max(300).default("Statement of Need"),
});

// ---------------------------------------------------------------------------
// Workflow engine
// ---------------------------------------------------------------------------

export const WorkflowRunStatus = z.enum([
  "pending",
  "running",
  "waiting_for_info",
  "waiting_approval",
  "suspended_budget",
  "failed",
  "completed",
  "cancelled",
]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatus>;

export const ArtifactType = z.enum([
  "compliance_matrix",
  "grant_section",
  "export_package",
  "application_plan",
  "budget",
  "logic_model",
  "review_report",
  "compliance_report",
]);
export type ArtifactType = z.infer<typeof ArtifactType>;

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------

export const AgentDefinition = z.object({
  agentKey: z.string().min(1).max(120),
  version: z.number().int().positive(),
  displayName: z.string(),
  team: z.enum(["core", "grant", "website"]),
  role: z.string(),
  instructions: z.string(),
  allowedTools: z.array(z.string()),
  outputSchemaRef: z.enum([
    "requirements_extraction",
    "section_draft",
    "section_plan",
    "budget",
    "logic_model",
    "review_panel",
    // "none" marks agents whose work is deterministic system logic (e.g. the
    // eligibility engine) — listed in the directory, never sent to a model.
    "none",
  ]),
  maxOutputRetries: z.number().int().min(0).max(5).default(2),
});
export type AgentDefinition = z.infer<typeof AgentDefinition>;

// ---------------------------------------------------------------------------
// Phase 3 — Funding Passport
// ---------------------------------------------------------------------------

export const PassportField = z.object({
  key: z.string(),
  label: z.string(),
  section: z.string(),
  required: z.boolean(),
  hint: z.string().optional(),
});
export type PassportField = z.infer<typeof PassportField>;

// ---------------------------------------------------------------------------
// Phase 3 — Eligibility engine (deterministic; the model never decides)
// ---------------------------------------------------------------------------

export const EligibilityStatus = z.enum([
  "verified_eligible",
  "likely_eligible",
  "ineligible",
  "insufficient_information",
  "conflicting",
]);
export type EligibilityStatus = z.infer<typeof EligibilityStatus>;

export const EligibilityRuleKind = z.enum([
  "entity_type",
  "registration_required",
  "geography",
  "max_annual_budget",
  "deadline_future",
]);

export const EligibilityRule = z.object({
  ruleKey: z.string(),
  kind: EligibilityRuleKind,
  params: z.record(z.unknown()),
  sourceLine: z.number().int().nullable(),
});
export type EligibilityRule = z.infer<typeof EligibilityRule>;

export const RuleFinding = z.object({
  ruleKey: z.string(),
  status: z.enum(["pass", "fail", "unknown"]),
  evidence: z.string(),
  factKey: z.string().nullable(),
});
export type RuleFinding = z.infer<typeof RuleFinding>;

// ---------------------------------------------------------------------------
// Phase 3 — Bid/no-bid
// ---------------------------------------------------------------------------

export const BidDimension = z.object({
  key: z.string(),
  label: z.string(),
  score: z.number().min(0).max(5),
  weight: z.number(),
  note: z.string(),
});
export type BidDimension = z.infer<typeof BidDimension>;

export const BidRecommendation = z.enum(["apply", "do_not_apply", "needs_review"]);
export type BidRecommendation = z.infer<typeof BidRecommendation>;

// ---------------------------------------------------------------------------
// Phase 3 — Agent output contracts
// ---------------------------------------------------------------------------

export const SectionPlanOutput = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        objective: z.string().min(1).max(2000),
        wordLimit: z.number().int().positive().nullable(),
        requirementLines: z.array(z.number().int()),
      })
    )
    .min(1)
    .max(12),
  activities: z.array(z.string().min(1).max(300)).min(1).max(20),
});
export type SectionPlanOutput = z.infer<typeof SectionPlanOutput>;

export const BudgetOutput = z.object({
  currency: z.literal("USD"),
  items: z
    .array(
      z.object({
        category: z.enum(["personnel", "direct", "indirect", "equipment", "travel", "other"]),
        description: z.string().min(1).max(400),
        activity: z.string().min(1).max(300),
        quantity: z.number().positive(),
        unitCost: z.number().nonnegative(),
      })
    )
    .min(1)
    .max(60),
  narrative: z.string().min(1),
});
export type BudgetOutput = z.infer<typeof BudgetOutput>;

export const LogicModelOutput = z.object({
  problem: z.string().min(1),
  inputs: z.array(z.string()).min(1),
  activities: z.array(z.string()).min(1),
  outputs: z.array(z.string()).min(1),
  outcomes: z.array(z.string()).min(1),
  impact: z.string().min(1),
  indicators: z
    .array(
      z.object({
        outcome: z.string(),
        indicator: z.string(),
        baseline: z.string(),
        target: z.string(),
        source: z.string(),
        frequency: z.string(),
      })
    )
    .min(1),
});
export type LogicModelOutput = z.infer<typeof LogicModelOutput>;

export const ReviewPanelOutput = z.object({
  reviews: z
    .array(
      z.object({
        reviewer: z.enum(["program", "financial", "compliance", "skeptic"]),
        criterion: z.string().min(1).max(300),
        score: z.number().min(0).max(5),
        maxScore: z.literal(5),
        strengths: z.string(),
        weaknesses: z.string(),
        fatalFlaw: z.boolean(),
      })
    )
    .min(4),
  revisionRecommendations: z.array(z.string()).max(20),
});
export type ReviewPanelOutput = z.infer<typeof ReviewPanelOutput>;

// ---------------------------------------------------------------------------
// Phase 3 — API inputs
// ---------------------------------------------------------------------------

export const GrantSearchInput = z.object({
  keyword: z.string().min(2).max(200),
});

export const ImportOpportunityInput = z.object({
  title: z.string().min(1).max(400),
  funder: z.string().min(1).max(300),
  opportunityNumber: z.string().max(100).nullable().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  fundingMin: z.number().nonnegative().nullable().optional(),
  fundingMax: z.number().nonnegative().nullable().optional(),
  geography: z.string().max(200).nullable().optional(),
  sourceUrl: z.string().url().max(1000).nullable().optional(),
  source: z.enum(["manual", "grants_gov"]).default("manual"),
});

export const StartGrantApplicationInput = z.object({
  opportunityId: z.string().uuid(),
  fileId: z.string().uuid(),
});

export const RecordOutcomeInput = z.object({
  status: z.enum(["submitted", "not_submitted", "withdrawn", "awarded", "rejected", "waitlisted"]),
  awardAmount: z.number().nonnegative().nullable().optional(),
  feedback: z.string().max(4000).optional(),
  lessons: z.string().max(4000).optional(),
});
