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

export const ArtifactType = z.enum(["compliance_matrix", "grant_section", "export_package"]);
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
  outputSchemaRef: z.enum(["requirements_extraction", "section_draft"]),
  maxOutputRetries: z.number().int().min(0).max(5).default(2),
});
export type AgentDefinition = z.infer<typeof AgentDefinition>;
