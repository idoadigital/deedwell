import { createDeps } from "./bootstrap.js";

/** Standalone workflow worker (production entry; the API disables its inline loop). */
async function main(): Promise<void> {
  const deps = await createDeps();
  const abort = new AbortController();
  process.on("SIGINT", () => abort.abort());
  process.on("SIGTERM", () => abort.abort());
  console.log("Deedwell worker started");
  await deps.engine.runWorkerLoop(`worker-${process.pid}`, {
    intervalMs: 500,
    signal: abort.signal,
  });
  await deps.appPool.end();
  await deps.adminPool.end();
}

main().catch((err) => {
  console.error("Worker crashed:", err);
  process.exit(1);
});
