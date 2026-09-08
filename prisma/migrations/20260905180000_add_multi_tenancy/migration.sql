-- Idempotent: safe to re-run
DO $$ BEGIN
  CREATE TABLE "Company" (
      "id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
  );
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX "Company_slug_idx" ON "Company"("slug");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "User" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX "User_companyId_idx" ON "User"("companyId");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Department" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX "Department_companyId_idx" ON "Department"("companyId");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DROP INDEX IF EXISTS "Department_code_key";

DO $$ BEGIN
  CREATE UNIQUE INDEX "Department_companyId_code_key" ON "Department"("companyId", "code");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DROP INDEX IF EXISTS "User_ssoSubject_key";
DROP INDEX IF EXISTS "User_email_key";

DO $$ BEGIN
  CREATE UNIQUE INDEX "User_companyId_ssoSubject_key" ON "User"("companyId", "ssoSubject");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE UNIQUE INDEX "User_companyId_email_key" ON "User"("companyId", "email");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Department" ADD CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
