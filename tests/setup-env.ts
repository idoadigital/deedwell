// Test environment: the dev Postgres container on :55432 and a scratch data dir.
process.env.DATABASE_URL ??= "postgres://deedwell:deedwell@localhost:55432/deedwell";
process.env.APP_DB_PASSWORD ??= "test_app_password";
process.env.DATABASE_APP_URL ??= `postgres://deedwell_app:${process.env.APP_DB_PASSWORD}@localhost:55432/deedwell`;
process.env.DATA_DIR ??= "./.data-test";
process.env.MODEL_PROVIDER ??= "mock";
process.env.GRANT_SOURCE ??= "mock";
process.env.LOG_LEVEL ??= "silent";
process.env.VOICE_PROVIDER ??= "off";
