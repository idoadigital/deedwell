import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { audit, tenantFileKey, uuidv7 } from "@deedwell/database";
import { PostMessageInput, UploadFileInput } from "@deedwell/schemas";
import {
  createProjectChannel,
  ensureChannels,
  handleUserMessage,
  type ChannelRow,
} from "./assistant.js";
import { TEAMMATES } from "./teammates.js";
import { HttpError, type AppContext } from "./app.js";

export function registerChatRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Cancel a run that hasn't finished (safe: steps are transactional).
  app.post("/v1/orgs/:orgId/runs/:runId/cancel", async (req) => {
    ctx.requireRole(req, "member");
    const { runId } = req.params as { runId: string };
    await ctx.inOrg(req, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE workflow_runs SET status = 'cancelled'
         WHERE id = $1 AND status IN ('pending','running','waiting_for_info','waiting_approval','suspended_budget')`,
        [runId]
      );
      if (!rowCount) throw new HttpError(409, "Run is already finished");
      await audit(client, {
        tenantId: req.orgId!, actorUser: req.userId, action: "workflow.cancelled",
        entityType: "workflow_run", entityId: runId, metadata: {},
      });
    });
    return { ok: true };
  });

  // Secure diagnostics (spec §2): component health, no secrets/prompts/content.
  app.get("/v1/diagnostics", async () => {
    const out: Record<string, unknown> = {
      modelProviderConfigured: ctx.deps.provider.name !== "mock",
      modelProvider: ctx.deps.provider.name,
      grantSource: ctx.deps.grantSource.name,
    };
    try {
      await ctx.deps.appPool.query("SELECT 1");
      out.database = "healthy";
    } catch { out.database = "unhealthy"; }
    try {
      const { rows } = await ctx.deps.adminPool.query(
        "SELECT COUNT(*)::int AS n FROM workflow_runs WHERE status IN ('pending','running')"
      );
      out.workflowEngine = "healthy";
      out.activeRuns = rows[0].n;
    } catch { out.workflowEngine = "unhealthy"; }
    if (ctx.deps.provider.name === "openai") {
      try {
        const res = await fetch(
          `${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/models`,
          { headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(5000) }
        );
        out.providerConnectivity = res.ok ? "healthy" : `unhealthy (${res.status})`;
      } catch { out.providerConnectivity = "unhealthy (unreachable)"; }
    } else {
      out.providerConnectivity = "n/a (mock)";
    }
    out.realtime = "in-process";
    return out;
  });

  // Everything the workspace shell needs, in ONE round trip / transaction.
  app.get("/v1/orgs/:orgId/workspace", async (req) => {
    ctx.requireRole(req, "viewer");
    const out = await ctx.inOrg(req, async (client) => {
      await ensureChannels(client, req.orgId!);
      const channels = await client.query(
        `SELECT c.id, c.key, c.name, c.kind, c.project_id, c.agent_key, c.starred,
                p.type AS project_type,
                (SELECT MAX(created_at) FROM messages m WHERE m.channel_id = c.id) AS last_message_at
         FROM channels c LEFT JOIN projects p ON p.id = c.project_id
         ORDER BY c.kind, c.created_at`
      );
      const runs = await client.query(
        `SELECT r.id, r.project_id, p.name AS project_name, r.definition, r.status,
                r.current_step, r.steps_used, r.step_budget, r.last_error,
                r.state->'waiting' AS waiting, r.created_at, r.updated_at
         FROM workflow_runs r JOIN projects p ON p.id = r.project_id
         ORDER BY r.updated_at DESC LIMIT 100`
      );
      const sites = await client.query(
        `SELECT s.id, s.project_id, p.name AS project_name, s.slug, s.name, s.status,
                s.theme, s.created_at,
                (SELECT version FROM site_releases rr WHERE rr.id = s.preview_release_id) AS preview_version,
                (SELECT version FROM site_releases rr WHERE rr.id = s.active_release_id) AS live_version,
                (SELECT COUNT(*)::int FROM form_submissions fs WHERE fs.site_id = s.id) AS submissions
         FROM sites s JOIN projects p ON p.id = s.project_id ORDER BY s.created_at DESC`
      );
      const members = await client.query(
        `SELECT u.id, u.display_name, u.email, m.role
         FROM organization_memberships m JOIN users u ON u.id = m.user_id ORDER BY u.display_name`
      );
      const projects = await client.query(
        "SELECT id, name, type, status, created_at FROM projects ORDER BY created_at DESC"
      );
      const approvals = await client.query(
        `SELECT a.id, a.run_id, a.kind, a.payload, a.status, a.note, a.created_at,
                p.name AS project_name, r.project_id
         FROM approvals a JOIN workflow_runs r ON r.id = a.run_id
         JOIN projects p ON p.id = r.project_id
         ORDER BY a.created_at DESC LIMIT 100`
      );
      return {
        channels: channels.rows, runs: runs.rows, sites: sites.rows,
        members: members.rows, projects: projects.rows, approvals: approvals.rows,
      };
    });
    return { ...out, teammates: TEAMMATES };
  });

  app.get("/v1/orgs/:orgId/channels", async (req) => {
    ctx.requireRole(req, "viewer");
    const { rows } = await ctx.inOrg(req, async (client) => {
      await ensureChannels(client, req.orgId!);
      return client.query(
        `SELECT c.id, c.key, c.name, c.kind, c.project_id, c.agent_key, c.starred,
                p.type AS project_type,
                (SELECT MAX(created_at) FROM messages m WHERE m.channel_id = c.id) AS last_message_at
         FROM channels c LEFT JOIN projects p ON p.id = c.project_id
         ORDER BY c.kind, c.created_at`
      );
    });
    return { channels: rows, teammates: TEAMMATES };
  });

  app.post("/v1/orgs/:orgId/channels", async (req, reply) => {
    ctx.requireRole(req, "member");
    const input = z.object({ name: z.string().min(2).max(80) }).parse(req.body);
    const result = await ctx.inOrg(req, (client) =>
      createProjectChannel(client, req.orgId!, req.userId!, input.name, "other")
    );
    return reply.status(201).send(result);
  });

  app.post("/v1/orgs/:orgId/channels/:channelId/star", async (req) => {
    ctx.requireRole(req, "viewer");
    const { channelId } = req.params as { channelId: string };
    const input = z.object({ starred: z.boolean() }).parse(req.body);
    await ctx.inOrg(req, async (client) => {
      const { rowCount } = await client.query(
        "UPDATE channels SET starred = $2 WHERE id = $1", [channelId, input.starred]
      );
      if (!rowCount) throw new HttpError(404, "Channel not found");
    });
    return { ok: true };
  });

  app.get("/v1/orgs/:orgId/members", async (req) => {
    ctx.requireRole(req, "viewer");
    const { rows } = await ctx.inOrg(req, (client) =>
      client.query(
        `SELECT u.id, u.display_name, u.email, m.role
         FROM organization_memberships m JOIN users u ON u.id = m.user_id
         ORDER BY u.display_name`
      )
    );
    return { members: rows };
  });

  // Attach a file inside a conversation. Files land in the channel's project,
  // or in a shared inbox project for DMs and team channels.
  app.post("/v1/orgs/:orgId/channels/:channelId/files", async (req, reply) => {
    ctx.requireRole(req, "member");
    const { channelId } = req.params as { channelId: string };
    const input = UploadFileInput.parse(req.body);
    const content = Buffer.from(input.contentBase64, "base64");
    if (content.length === 0) throw new HttpError(400, "File is empty");
    if (content.length > 8_000_000) throw new HttpError(413, "File exceeds the 8 MB limit");
    const result = await ctx.inOrg(req, async (client) => {
      const channel = await client.query(
        "SELECT id, project_id FROM channels WHERE id = $1", [channelId]
      );
      if (!channel.rows[0]) throw new HttpError(404, "Channel not found");
      let projectId: string | null = channel.rows[0].project_id;
      if (!projectId) {
        const shared = await client.query(
          "SELECT id FROM projects WHERE name = 'Shared Files' LIMIT 1"
        );
        projectId = shared.rows[0]?.id ?? uuidv7();
        if (!shared.rows[0]) {
          await client.query(
            `INSERT INTO projects (id, tenant_id, name, type, created_by)
             VALUES ($1,$2,'Shared Files','other',$3)`,
            [projectId, req.orgId, req.userId]
          );
        }
      }
      const fileId = uuidv7();
      const storageKey = tenantFileKey(req.orgId!, fileId, input.filename);
      await ctx.deps.storage.put(storageKey, content);
      await client.query(
        `INSERT INTO files (id, tenant_id, project_id, filename, mime, size_bytes, sha256, storage_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [fileId, req.orgId, projectId, input.filename, input.mime, content.length,
         createHash("sha256").update(content).digest("hex"), storageKey, req.userId]
      );
      await audit(client, {
        tenantId: req.orgId!, actorUser: req.userId, action: "file.uploaded",
        entityType: "file", entityId: fileId,
        metadata: { filename: input.filename, via: "chat" },
      });
      return { fileId, filename: input.filename };
    });
    return reply.status(201).send(result);
  });

  app.get("/v1/orgs/:orgId/channels/:channelId/messages", async (req) => {
    ctx.requireRole(req, "viewer");
    const { channelId } = req.params as { channelId: string };
    const { rows } = await ctx.inOrg(req, async (client) => {
      const channel = await client.query("SELECT id FROM channels WHERE id = $1", [channelId]);
      if (!channel.rows[0]) throw new HttpError(404, "Channel not found");
      return client.query(
        `SELECT m.id, m.author_kind, m.author_user, m.author_agent, u.display_name AS author_name,
                m.body, m.metadata, m.created_at
         FROM messages m LEFT JOIN users u ON u.id = m.author_user
         WHERE m.channel_id = $1 ORDER BY m.created_at ASC LIMIT 300`,
        [channelId]
      );
    });
    return { messages: rows };
  });

  app.post("/v1/orgs/:orgId/channels/:channelId/messages", async (req, reply) => {
    ctx.requireRole(req, "member");
    const { channelId } = req.params as { channelId: string };
    const input = PostMessageInput.parse(req.body);
    const messages = await ctx.inOrg(req, async (client) => {
      const channel = await client.query(
        `SELECT c.id, c.key, c.name, c.kind, c.project_id, p.type AS project_type
         FROM channels c LEFT JOIN projects p ON p.id = c.project_id WHERE c.id = $1`,
        [channelId]
      );
      if (!channel.rows[0]) throw new HttpError(404, "Channel not found");
      if (input.fileId) {
        const file = await client.query("SELECT id FROM files WHERE id = $1", [input.fileId]);
        if (!file.rows[0]) throw new HttpError(404, "Attached file not found");
      }
      return handleUserMessage(
        ctx.deps, client,
        { tenantId: req.orgId!, userId: req.userId! },
        channel.rows[0] as ChannelRow,
        input.body,
        input.fileId ?? null,
        input.clientKey ?? null,
        input.huddleId ?? null
      );
    });
    // Wake any live listeners (SSE) in this org.
    ctx.deps.engine.events.emit("event", {
      type: "message_created", tenantId: req.orgId, channelId,
    } as never);
    return reply.status(201).send({ messages });
  });
}
