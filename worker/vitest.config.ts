import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

const migrationsPath = path.join(__dirname, 'migrations');

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(migrationsPath);
  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            d1Databases: { DB: 'kimi-connect-db' },
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
