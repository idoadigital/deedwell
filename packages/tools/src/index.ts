import { z } from "zod";
import type { PoolClient } from "pg";
import { uuidv7 } from "@deedwell/database";
import { summarize } from "@deedwell/observability";
import type { AgentDefinition } from "@deedwell/schemas";

/**
 * Tool Gateway: the single choke point for agent tool use.
 * Every invocation requires full identity, passes the agent's allowlist,
 * validates input and output, and leaves an audit row — success or failure.
 */

export interface ToolIdentity {
  tenantId: string;
  userId: string | null;
  agentKey: string;
  runId: string | null;
}

export interface ToolDefinition<I, O> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  /** Runs on the tenant-scoped client — RLS applies to everything it touches. */
  handler: (client: PoolClient, identity: ToolIdentity, input: I) => Promise<O>;
}

export class ToolError extends Error {
  constructor(
    public readonly code:
      | "unknown_tool"
      | "not_permitted"
      | "invalid_input"
      | "invalid_output"
      | "handler_failed"
      | "missing_identity",
    message: string
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export class ToolGateway {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();

  register<I, O>(def: ToolDefinition<I, O>): void {
    if (this.tools.has(def.name)) throw new Error(`Tool already registered: ${def.name}`);
    this.tools.set(def.name, def as ToolDefinition<unknown, unknown>);
  }

  async invoke<O = unknown>(
    client: PoolClient,
    identity: ToolIdentity,
    agent: AgentDefinition,
    toolName: string,
    input: unknown
  ): Promise<O> {
    if (!identity.tenantId || !identity.agentKey) {
      throw new ToolError("missing_identity", "Tool calls require tenant and agent identity");
    }
    const started = Date.now();
    const finishAudit = async (ok: boolean, output: unknown, error?: string) => {
      await client.query(
        `INSERT INTO tool_invocations (id, tenant_id, run_id, agent_key, tool, ok,
           input_summary, output_summary, error, duration_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          uuidv7(),
          identity.tenantId,
          identity.runId,
          identity.agentKey,
          toolName,
          ok,
          summarize(input),
          ok ? summarize(output) : null,
          error ?? null,
          Date.now() - started,
        ]
      );
    };

    const def = this.tools.get(toolName);
    if (!def) {
      await finishAudit(false, null, "unknown tool");
      throw new ToolError("unknown_tool", `Unknown tool: ${toolName}`);
    }
    if (!agent.allowedTools.includes(toolName)) {
      await finishAudit(false, null, "not in agent allowlist");
      throw new ToolError(
        "not_permitted",
        `Agent "${agent.agentKey}" is not permitted to use tool "${toolName}"`
      );
    }

    const parsedInput = def.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      await finishAudit(false, null, `invalid input: ${parsedInput.error.message.slice(0, 400)}`);
      throw new ToolError("invalid_input", `Invalid input for ${toolName}`);
    }

    let output: unknown;
    try {
      output = await def.handler(client, identity, parsedInput.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await finishAudit(false, null, msg.slice(0, 800));
      throw new ToolError("handler_failed", `Tool ${toolName} failed: ${msg}`);
    }

    const parsedOutput = def.outputSchema.safeParse(output);
    if (!parsedOutput.success) {
      await finishAudit(false, null, "invalid output");
      throw new ToolError("invalid_output", `Tool ${toolName} produced invalid output`);
    }
    await finishAudit(true, parsedOutput.data);
    return parsedOutput.data as O;
  }
}
