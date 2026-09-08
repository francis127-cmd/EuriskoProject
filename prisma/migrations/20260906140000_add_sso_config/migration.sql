-- Idempotent: safe to re-run
DO $$ BEGIN
  ALTER TABLE "Company" ADD COLUMN "domain" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Company" ADD COLUMN "ssoProvider" TEXT DEFAULT 'GOOGLE';
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Company" ADD COLUMN "googleClientId" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  CREATE UNIQUE INDEX "Company_domain_key" ON "Company"("domain");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX "Company_domain_idx" ON "Company"("domain");
EXCEPTION WHEN duplicate_table THEN null;
END $$;
