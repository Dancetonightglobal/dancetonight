-- Runs before the drizzle-kit migrations (src/db/migrate.ts executes this file first).
-- Idempotent: safe to run on every migrate. Supabase ships both extensions.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
