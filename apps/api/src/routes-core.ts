import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  SESSION_TTL_MS,
  verifyPassword,
} from "@deedwell/auth";
import { audit, tenantFileKey, uuidv7, withContext } from "@deedwell/database";
import {
  AddMemberInput,
  CreateOrgInput,
  CreateProjectInput,
  LoginInput,
  ProvideInfoInput,
  RegisterInput,
  UploadFileInput,
} from "@deedwell/schemas";
import { HttpError, type AppContext } from "./app.js";

const MAX_FILE_BYTES = 8_000_000;

export function registerCoreRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { deps } = ctx;

  // ---- auth ---------------------------------------------------------------

  app.post("/v1/auth/register", async (req, reply) => {
    const input = RegisterInput.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const userId = uuidv7();
    try {
      await deps.appPool.query(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES ($1,$2,$3,$4)",
        [userId, input.email, passwordHash, input.displayName]
      );
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new HttpError(409, "An account with this email already exists");
      }
      throw err;
    }
    const token = await createSession(deps.appPool, userId);
    return reply.status(201).send({ userId, token });
  });

  app.post("/v1/auth/login", async (req) => {
    const input = LoginInput.parse(req.body);
    const { rows } = await deps.appPool.query(
      "SELECT id, password_hash FROM users WHERE email = $1",
      [input.email]
    );
    // Same error for unknown email and wrong password.
    if (!rows[0] || !(await verifyPassword(input.password, rows[0].password_hash))) {
      throw new HttpError(401, "Invalid email or password");
    }
    const token = await createSession(deps.appPool, rows[0].id);
    return { userId: rows[0].id, token };
  });

  app.post("/v1/auth/logout", async (req) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      await deps.appPool.query(
        "UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
        [hashSessionToken(header.slice("Bearer ".length))]
      );
    }
    return { ok: true };
  });

  // ---- me & orgs ----------------------------------------------------------

  app.get("/v1/me", async (req) => {
    const orgs = await withContext(deps.appPool, { tenantId: null, userId: req.userId }, (client) =>
      client.query(
        `SELECT o.id, o.slug, o.name, m.role
         FROM organizations o
         JOIN organization_memberships m ON m.tenant_id = o.id
         WHERE m.user_id = $1 ORDER BY o.name`,
        [req.userId]
      )
    );
    return { userId: req.userId, organizations: orgs.rows };
  });

  app.post("/v1/orgs", async (req, reply) => {
    const input = CreateOrgInput.parse(req.body);
    const orgId = uuidv7();
    await withContext(deps.appPool, { tenantId: orgId, userId: req.userId }, async (client) => {
      try {
        await client.query(
          "INSERT INTO organizations (id, slug, name, created_by) VALUES ($1,$2,$3,$4)",
          [orgId, input.slug, input.name, req.userId]
        );
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw new HttpError(409, "This organization slug is already taken");
        }
        throw err;
      }
      await client.query(
        "INSERT INTO organization_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,'owner')",
        [uuidv7(), orgId, req.userId]
      );
      await audit(client, {
        tenantId: orgId, actorUser: req.userId, action: "org.created",
        entityType: "organization", entityId: orgId, metadata: { slug: input.slug },
      });
    });
    return reply.status(201).send({ orgId });
  });

  app.post("/v1/orgs/:orgId/members", async (req, reply) => {
    ctx.requireRole(req, "admin");
    const input = AddMemberInput.parse(req.body);
    if (input.role === "owner") throw new HttpError(403, "Ownership cannot be granted this way");
    const result = await ctx.inOrg(req, async (client) => {
      const user = await client.query("SELECT id FROM users WHERE email = $1", [input.email]);
      if (!user.rows[0]) throw new HttpError(404, "No account exists for that email");
      await client.query(
        `INSERT INTO organization_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [uuidv7(), req.orgId, user.rows[0].id, input.role]
      );
      await audit(client, {
        tenantId: req.orgId!, actorUser: req.userId, action: "member.added",
        entityType: "user", entityId: user.rows[0].id, metadata: { role: input.role },
      });
      return { userId: user.rows[0].id };
    });
    return reply.status(201).send(result);
  });

  // ---- organization facts (evidence ledger seed) --------------------------

  app.get("/v1/orgs/:orgId/facts", async (req) => {
    ctx.requireRole(req, "viewer");
    const { rows } = await ctx.inOrg(req, (client) =>
      client.query("SELECT fact_key, value, status, updated_at FROM org_facts ORDER BY fact_key")
    );
    return { facts: rows };
  });

  app.post("/v1/orgs/:orgId/facts", async (req, reply) => {
    ctx.requireRole(req, "member");
    const input = ProvideInfoInput.parse(req.body);
    await ctx.inOrg(req, async (client) => {
      for (const fact of input.facts) {
        await client.query(
          `INSERT INTO org_facts (id, tenant_id, fact_key, value, status, certified_by)
           VALUES ($1,$2,$3,$4,'user_certified',$5)
           ON CONFLICT (tenant_id, fact_key)
           DO UPDATE SET value = EXCLUDED.value, status = 'user_certified', certified_by = EXCLUDED.certified_by`,
          [uuidv7(), req.orgId, fact.key, fact.value, req.userId]
        );
      }
      await audit(client, {
        tenantId: req.orgId!, actorUser: req.userId, action: "facts.certified",
        entityType: "org_facts", metadata: { keys: input.facts.map((f) => f.key) },
      });
    });
    return reply.status(201).send({ ok: true });
  });

  // ---- projects & files ---------------------------------------------------

  app.post("/v1/orgs/:orgId/projects", async (req, reply) => {
    ctx.requireRole(req, "member");
    const input = CreateProjectInput.parse(req.body);
    const projectId = uuidv7();
    await ctx.inOrg(req, async (client) => {
      await client.query(
        "INSERT INTO projects (id, tenant_id, name, type, created_by) VALUES ($1,$2,$3,$4,$5)",
        [projectId, req.orgId, input.name, input.type, req.userId]
      );
      await audit(client, {
        tenantId: req.orgId!, actorUser: req.userId, action: "project.created",
        entityType: "project", entityId: projectId, metadata: { type: input.type },
      });
    });
    return reply.status(201).send({ projectId });
  });

  app.get("/v1/orgs/:orgId/projects", async (req) => {
    ctx.requireRole(req, "viewer");
    const { rows } = await ctx.inOrg(req, (client) =>
      client.query("SELECT id, name, type, status, created_at FROM projects ORDER BY created_at DESC")
    );
    return { projects: rows };
  });

  app.post("/v1/orgs/:orgId/projects/:projectId/files", async (req, reply) => {
    ctx.requireRole(req, "member");
    const { projectId } = req.params as { projectId: string };
    const input = UploadFileInput.parse(req.body);
    const content = Buffer.from(input.contentBase64, "base64");
    if (content.length === 0) throw new HttpError(400, "File is empty");
    if (content.length > MAX_FILE_BYTES) throw new HttpError(413, "File exceeds the 8 MB limit");

    const fileId = uuidv7();
    const storageKey = tenantFileKey(req.orgId!, fileId, input.filename);
    const result = await ctx.inOrg(req, async (client) => {
      const project = await client.query("SELECT id FROM projects WHERE id = $1", [projectId]);
      if (!project.rows[0]) throw new HttpError(404, "Project not found");
      await deps.storage.put(storageKey, content);
      await client.query(
        `INSERT INTO files (id, tenant_id, project_id, filename, mime, size_bytes, sha256, storage_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [fileId, req.orgId, projectId, input.filename, input.mime, content.length,
         createHash("sha256").update(content).digest("hex"), storageKey, req.userId]
      );
      await audit(client, {
        tenantId: req.orgId!, actorUser: req.userId, action: "file.uploaded",
        entityType: "file", entityId: fileId,
        metadata: { filename: input.filename, bytes: content.length },
      });
      return { fileId };
    });
    return reply.status(201).send(result);
  });
}

async function createSession(pool: AppContext["deps"]["appPool"], userId: string): Promise<string> {
  const { token, tokenHash } = generateSessionToken();
  await pool.query(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)",
    [uuidv7(), userId, tokenHash, new Date(Date.now() + SESSION_TTL_MS)]
  );
  return token;
}
