import type { Pool } from "pg";
import {
  createAdminPool,
  createAppPool,
  LocalFsStorage,
  type StorageAdapter,
} from "@deedwell/database";
import { createModelProvider, type ModelProvider } from "@deedwell/agent-runtime";
import { ToolGateway } from "@deedwell/tools";
import { PgWorkflowEngine } from "@deedwell/workflows";
import {
  buildGrantSliceWorkflow,
  registerGrantTools,
  seedAgentDefinitions,
  type GrantServices,
} from "@deedwell/grant-domain";

export interface Deps {
  adminPool: Pool;
  appPool: Pool;
  storage: StorageAdapter;
  provider: ModelProvider;
  gateway: ToolGateway;
  engine: PgWorkflowEngine<GrantServices>;
}

export async function createDeps(overrides: Partial<{
  adminPool: Pool;
  appPool: Pool;
  storage: StorageAdapter;
  provider: ModelProvider;
  backoffMs: (attempt: number) => number;
}> = {}): Promise<Deps> {
  const adminPool = overrides.adminPool ?? createAdminPool();
  const appPool = overrides.appPool ?? createAppPool();
  const storage = overrides.storage ?? new LocalFsStorage(process.env.DATA_DIR ?? "./.data");
  const provider = overrides.provider ?? createModelProvider();

  const gateway = new ToolGateway();
  registerGrantTools(gateway);

  const services: GrantServices = { provider, gateway, storage };
  const engine = new PgWorkflowEngine<GrantServices>(
    adminPool,
    appPool,
    services,
    overrides.backoffMs
  );
  engine.register(buildGrantSliceWorkflow());

  await seedAgentDefinitions(adminPool);
  return { adminPool, appPool, storage, provider, gateway, engine };
}
