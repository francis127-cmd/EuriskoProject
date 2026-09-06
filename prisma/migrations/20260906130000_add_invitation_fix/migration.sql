-- This migration creates the Invitation table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'Invitation') THEN
    CREATE TABLE "Invitation" (
      "id" TEXT NOT NULL,
      "companyId" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "platformRole" "PlatformRole" NOT NULL DEFAULT 'EMPLOYEE',
      "departmentCode" TEXT,
      "departmentRole" "DepartmentRole",
      "token" TEXT NOT NULL,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");
    CREATE UNIQUE INDEX "Invitation_companyId_email_key" ON "Invitation"("companyId", "email");
    CREATE INDEX "Invitation_token_idx" ON "Invitation"("token");
    ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
