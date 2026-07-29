import type { Pool } from "pg";
import { uuidv7 } from "@deedwell/database";
import { AgentDefinition } from "@deedwell/schemas";

export const requirementsAnalyst: AgentDefinition = AgentDefinition.parse({
  agentKey: "grant.requirements_analyst",
  version: 1,
  displayName: "Priya — Requirements Analyst",
  team: "grant",
  role: "Requirements Analyst on the Grant Team",
  instructions: `Convert grant announcement text into a structured compliance matrix.
Every requirement must be traceable to a source line and quote in the document.
Separate mandatory requirements (must/shall/required) from advisory ones.
Never invent requirements that are not present in the source material.`,
  allowedTools: ["record_requirements", "fetch_org_facts"],
  outputSchemaRef: "requirements_extraction",
  maxOutputRetries: 2,
});

export const grantWriter: AgentDefinition = AgentDefinition.parse({
  agentKey: "grant.writer",
  version: 1,
  displayName: "Marcus — Grant Writer",
  team: "grant",
  role: "Grant Writer on the Grant Team",
  instructions: `Draft proposal sections using ONLY the organizational facts provided.
Every material claim must cite the fact it rests on.
Flag any claim that lacks a verified or user-certified fact — never hide gaps
behind professional-sounding language.`,
  allowedTools: ["fetch_org_facts"],
  outputSchemaRef: "section_draft",
  maxOutputRetries: 2,
});

export const ALL_AGENTS = [requirementsAnalyst, grantWriter];

/** Persist agent definitions as versioned records (platform-level, not tenant data). */
export async function seedAgentDefinitions(adminPool: Pool): Promise<void> {
  for (const agent of ALL_AGENTS) {
    await adminPool.query(
      `INSERT INTO agent_definitions (id, agent_key, version, display_name, team, role,
         instructions, allowed_tools, output_schema_ref, budgets)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (agent_key, version) DO NOTHING`,
      [uuidv7(), agent.agentKey, agent.version, agent.displayName, agent.team, agent.role,
       agent.instructions, agent.allowedTools, agent.outputSchemaRef,
       JSON.stringify({ maxOutputRetries: agent.maxOutputRetries })]
    );
  }
}
