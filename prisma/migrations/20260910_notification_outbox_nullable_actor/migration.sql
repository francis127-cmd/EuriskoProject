-- Idempotent: safe to re-run (start.js cleans stuck migrations, then re-applies)
DO $$ BEGIN
  ALTER TABLE "AuditLog" ALTER COLUMN "actorId" DROP NOT NULL;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "requestId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NotificationEvent_idempotencyKey_key" UNIQUE ("idempotencyKey")
  );
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX "NotificationEvent_status_createdAt_idx" ON "NotificationEvent"("status", "createdAt");
EXCEPTION WHEN duplicate_table THEN null;
END $$;
