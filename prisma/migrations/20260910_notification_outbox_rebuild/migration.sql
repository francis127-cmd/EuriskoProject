-- Repair: the 20260904 rewrite left a legacy NotificationEvent table with the
-- old shape (no attempts/lastError/idempotencyKey, NOT NULL requestId, enum
-- status). The previous idempotent migration skipped CREATE TABLE because the
-- name already existed. Rebuild only when empty so live data can never drop.
DO $$ DECLARE c INT; BEGIN
  SELECT count(*) INTO c FROM "NotificationEvent";
  IF c = 0 THEN
    DROP TABLE "NotificationEvent";
  END IF;
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
