-- Idempotent: safe to re-run
DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD COLUMN "action" TEXT NOT NULL DEFAULT 'STATE_TRANSITION';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
