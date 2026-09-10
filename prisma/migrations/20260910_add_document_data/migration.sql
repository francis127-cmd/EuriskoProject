-- Idempotent: safe to re-run (start.js cleans stuck migrations, then re-applies)
DO $$ BEGIN
  ALTER TABLE "Document" ADD COLUMN "data" BYTEA;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
