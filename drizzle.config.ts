import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
config({ path: '.env.local', quiet: true });
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle/generated',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
