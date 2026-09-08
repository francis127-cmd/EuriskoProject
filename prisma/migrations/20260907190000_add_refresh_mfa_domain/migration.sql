-- Idempotent: safe to re-run
DO $$ BEGIN
  ALTER TABLE "Company" ADD COLUMN "mfaRequired" BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "User" ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "User" ALTER COLUMN "ssoSubject" DROP NOT NULL;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  CREATE TABLE "RefreshToken" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "token" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "family" TEXT NOT NULL,
      "ip" TEXT,
      "userAgent" TEXT,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "revokedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
      CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
  );
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX "RefreshToken_token_idx" ON "RefreshToken"("token");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX "RefreshToken_family_idx" ON "RefreshToken"("family");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TABLE "MfaSecret" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "userId" TEXT NOT NULL,
      "secret" TEXT NOT NULL,
      "enabled" BOOLEAN NOT NULL DEFAULT false,
      "backupCodes" TEXT NOT NULL DEFAULT '[]',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
      CONSTRAINT "MfaSecret_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "MfaSecret_userId_key" UNIQUE ("userId")
  );
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "MfaSecret" ADD CONSTRAINT "MfaSecret_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TABLE "DomainVerification" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "companyId" TEXT NOT NULL,
      "domain" TEXT NOT NULL,
      "token" TEXT NOT NULL,
      "verified" BOOLEAN NOT NULL DEFAULT false,
      "verifiedAt" TIMESTAMP(3),
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
      CONSTRAINT "DomainVerification_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "DomainVerification_token_key" UNIQUE ("token")
  );
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX "DomainVerification_token_idx" ON "DomainVerification"("token");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "DomainVerification" ADD CONSTRAINT "DomainVerification_companyId_domain_key" UNIQUE ("companyId", "domain");
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "DomainVerification" ADD CONSTRAINT "DomainVerification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
