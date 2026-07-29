import { z } from "zod";
import { uuidv7 } from "@deedwell/database";
import { ExtractedRequirement, OrgFact } from "@deedwell/schemas";
import type { ToolGateway } from "@deedwell/tools";

/** Grant Team tools, registered through the gateway (never called directly). */
export function registerGrantTools(gateway: ToolGateway): void {
  gateway.register({
    name: "record_requirements",
    description: "Persist extracted requirements for a grant opportunity (idempotent).",
    inputSchema: z.object({
      opportunityId: z.string().uuid(),
      requirements: z.array(ExtractedRequirement).min(1),
    }),
    outputSchema: z.object({ recorded: z.number().int() }),
    handler: async (client, identity, input) => {
      let recorded = 0;
      for (const req of input.requirements) {
        const { rowCount } = await client.query(
          `INSERT INTO grant_requirements (id, tenant_id, opportunity_id, text, kind,
             mandatory, source_line, source_quote, word_limit)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (opportunity_id, source_line, md5(text)) DO NOTHING`,
          [uuidv7(), identity.tenantId, input.opportunityId, req.text, req.kind,
           req.mandatory, req.sourceLocation.line, req.sourceLocation.quote, req.wordLimit]
        );
        recorded += rowCount ?? 0;
      }
      return { recorded };
    },
  });

  gateway.register({
    name: "fetch_org_facts",
    description: "Read the organization's fact ledger (tenant-scoped).",
    inputSchema: z.object({}),
    outputSchema: z.object({ facts: z.array(OrgFact) }),
    handler: async (client) => {
      const { rows } = await client.query(
        "SELECT fact_key, value, status FROM org_facts ORDER BY fact_key"
      );
      return {
        facts: rows.map((r) => ({ key: r.fact_key, value: r.value, status: r.status })),
      };
    },
  });
}
