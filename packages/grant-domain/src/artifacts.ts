import type { PoolClient } from "pg";
import { uuidv7 } from "@deedwell/database";
import type { ArtifactType } from "@deedwell/schemas";

/**
 * Artifact service (slice subset): typed, versioned, append-only versions.
 * Runs inside the caller's transaction, so a crashed step never leaves a
 * half-written version behind.
 */
export async function upsertArtifactVersion(
  client: PoolClient,
  args: {
    tenantId: string;
    projectId: string;
    runId: string;
    type: ArtifactType;
    title: string;
    content: unknown;
    agentKey: string;
    changeSummary: string;
  }
): Promise<{ artifactId: string; version: number }> {
  const existing = await client.query(
    "SELECT id, current_version FROM artifacts WHERE run_id = $1 AND type = $2",
    [args.runId, args.type]
  );
  let artifactId: string;
  let version: number;
  if (existing.rows[0]) {
    artifactId = existing.rows[0].id;
    version = existing.rows[0].current_version + 1;
  } else {
    artifactId = uuidv7();
    version = 1;
    await client.query(
      `INSERT INTO artifacts (id, tenant_id, project_id, run_id, type, title, current_version)
       VALUES ($1,$2,$3,$4,$5,$6,0)`,
      [artifactId, args.tenantId, args.projectId, args.runId, args.type, args.title]
    );
  }
  await client.query(
    `INSERT INTO artifact_versions (id, tenant_id, artifact_id, version, content,
       created_by_kind, created_by_agent, change_summary)
     VALUES ($1,$2,$3,$4,$5,'agent',$6,$7)`,
    [uuidv7(), args.tenantId, artifactId, version, JSON.stringify(args.content),
     args.agentKey, args.changeSummary]
  );
  await client.query("UPDATE artifacts SET current_version = $2 WHERE id = $1", [artifactId, version]);
  return { artifactId, version };
}
