import type { Pool } from "pg";
import type { AgentDefinition } from "@deedwell/schemas";
import { randomUUID } from "node:crypto";

/** Persist agent definitions as versioned platform records (idempotent). */
export async function seedAgentDefinitions(pool: Pool, agents: AgentDefinition[]): Promise<void> {
  for (const agent of agents) {
    await pool.query(
      `INSERT INTO agent_definitions (id, agent_key, version, display_name, team, role,
         instructions, allowed_tools, output_schema_ref, budgets)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (agent_key, version) DO NOTHING`,
      [randomUUID(), agent.agentKey, agent.version, agent.displayName, agent.team, agent.role,
       agent.instructions, agent.allowedTools, agent.outputSchemaRef,
       JSON.stringify({ maxOutputRetries: agent.maxOutputRetries })]
    );
  }
}
