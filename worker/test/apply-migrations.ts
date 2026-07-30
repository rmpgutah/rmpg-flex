// Test infra only: applies ../migrations/0001_init.sql to the isolated Miniflare D1 instance
// used by vitest-pool-workers. Not a deploy-time migration runner (see wrangler.toml/schema.sql for that).
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
