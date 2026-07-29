import { createAdminPool, migrate } from "./index.js";

const pool = createAdminPool();
migrate(pool)
  .then((applied) => {
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
    return pool.end();
  })
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
    return pool.end();
  });
