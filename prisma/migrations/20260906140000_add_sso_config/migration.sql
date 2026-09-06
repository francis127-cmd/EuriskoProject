-- AlterTable
ALTER TABLE "Company" ADD COLUMN "domain" TEXT,
ADD COLUMN "ssoProvider" TEXT DEFAULT 'GOOGLE',
ADD COLUMN "googleClientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Company_domain_key" ON "Company"("domain");
CREATE INDEX "Company_domain_idx" ON "Company"("domain");
