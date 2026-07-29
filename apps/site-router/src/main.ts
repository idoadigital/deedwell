import { createAdminPool, LocalFsStorage } from "@deedwell/database";
import { buildSiteRouter } from "./router.js";

async function main(): Promise<void> {
  const app = buildSiteRouter({
    adminPool: createAdminPool(),
    storage: new LocalFsStorage(process.env.DATA_DIR ?? "./.data"),
  });
  const port = Number(process.env.SITE_ROUTER_PORT ?? 8788);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Deedwell Site Router listening on :${port}`);
}

main().catch((err) => {
  console.error("Site Router failed to start:", err);
  process.exit(1);
});
