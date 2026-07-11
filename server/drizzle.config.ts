import { defineConfig } from 'drizzle-kit';

// dbCredentials.url is only used by drizzle-kit's own CLI commands (generate
// reads schema statically, doesn't connect; push/studio would connect using
// this). It is never read by the app at runtime — createDb (src/db/client.ts)
// takes its connection string from serverEnvSchema.DATABASE_URL instead.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://irlo:irlo@localhost:5432/irlo_dev',
  },
});
