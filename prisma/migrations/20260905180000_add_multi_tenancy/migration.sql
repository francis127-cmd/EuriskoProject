-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");
CREATE INDEX "Company_slug_idx" ON "Company"("slug");

-- AlterTable: Add companyId to User
ALTER TABLE "User" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- AlterTable: Add companyId to Department
ALTER TABLE "Department" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "Department_companyId_idx" ON "Department"("companyId");

-- Drop old unique constraint on Department.code and add new one
DROP INDEX IF EXISTS "Department_code_key";
CREATE UNIQUE INDEX "Department_companyId_code_key" ON "Department"("companyId", "code");

-- Update old unique indexes on User
DROP INDEX IF EXISTS "User_ssoSubject_key";
DROP INDEX IF EXISTS "User_email_key";
CREATE UNIQUE INDEX "User_companyId_ssoSubject_key" ON "User"("companyId", "ssoSubject");
CREATE UNIQUE INDEX "User_companyId_email_key" ON "User"("companyId", "email");

-- Add foreign keys
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Department" ADD CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
