-- Idempotent: safe to re-run
DO $$ BEGIN
  ALTER TABLE "RequestType" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "DepartmentMember" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_requestId_fkey";
EXCEPTION WHEN undefined_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AuditLog" ALTER COLUMN "requestId" DROP NOT NULL;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
