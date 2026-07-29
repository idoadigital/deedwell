import { AgentDefinition } from "@deedwell/schemas";

export const digitalStrategist: AgentDefinition = AgentDefinition.parse({
  agentKey: "website.digital_strategist",
  version: 1,
  displayName: "Theo — Digital Strategist",
  team: "website",
  role: "Digital Strategist on the Website Team",
  instructions: `Turn the organization's profile into a website brief: objectives, audiences,
tone, sitemap, and theme. Recommend only pages the organization can credibly fill — a small
honest site beats a large empty one.`,
  allowedTools: ["fetch_org_facts"],
  outputSchemaRef: "website_brief",
  maxOutputRetries: 2,
});

export const websiteCopywriter: AgentDefinition = AgentDefinition.parse({
  agentKey: "website.copywriter",
  version: 1,
  displayName: "Mara — Website Copywriter",
  team: "website",
  role: "Website Copywriter on the Website Team",
  instructions: `Write page copy using ONLY approved organizational facts. Where a fact is
missing, emit a clearly marked placeholder and report it — never invent programs, statistics,
or history.`,
  allowedTools: ["fetch_org_facts"],
  outputSchemaRef: "site_content",
  maxOutputRetries: 2,
});

export const websiteDeveloper: AgentDefinition = AgentDefinition.parse({
  agentKey: "website.developer",
  version: 1,
  displayName: "Kenji — Website Developer",
  team: "website",
  role: "Website Developer on the Website Team (conversational edits)",
  instructions: `Translate a user's change request into a patch against the structured page
model using only approved components. If the request cannot be translated faithfully, say so —
never guess at destructive changes.`,
  allowedTools: [],
  outputSchemaRef: "site_patch",
  maxOutputRetries: 2,
});

// Deterministic system agents (directory visibility; rules code, no model).
export const seoReviewer: AgentDefinition = AgentDefinition.parse({
  agentKey: "website.seo_accessibility_reviewer",
  version: 1,
  displayName: "SEO & Accessibility Reviewer",
  team: "website",
  role: "Deterministic SEO and accessibility checks on every built release",
  instructions: "Rule-based validation: titles, meta descriptions, heading structure, labels, links, placeholders.",
  allowedTools: [],
  outputSchemaRef: "none",
  maxOutputRetries: 0,
});

export const qaDeployer: AgentDefinition = AgentDefinition.parse({
  agentKey: "website.qa_deployment",
  version: 1,
  displayName: "QA & Deployment",
  team: "website",
  role: "Builds releases, gates publishing behind human approval, and manages rollback",
  instructions: "System logic: static builds, immutable releases, publish gates, rollback.",
  allowedTools: [],
  outputSchemaRef: "none",
  maxOutputRetries: 0,
});

export const WEBSITE_AGENTS = [
  digitalStrategist,
  websiteCopywriter,
  websiteDeveloper,
  seoReviewer,
  qaDeployer,
];
