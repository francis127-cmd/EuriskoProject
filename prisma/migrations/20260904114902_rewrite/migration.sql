/*
  Warnings:

  - You are about to drop the column `newState` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `oldState` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `timestamp` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `updatedBy` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `assignedHrId` on the `Request` table. All the data in the column will be lost.
  - You are about to drop the column `documentKey` on the `Request` table. All the data in the column will be lost.
  - You are about to drop the column `state` on the `Request` table. All the data in the column will be lost.
  - You are about to drop the column `version` on the `Request` table. All the data in the column will be lost.
  - The `priority` column on the `Request` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `actorId` to the `AuditLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `departmentId` to the `Request` table without a default value. This is not possible if the table is not empty.
  - Added the required column `requestTypeId` to the `Request` table without a default value. This is not possible if the table is not empty.
  - Made the column `description` on table `Request` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('EMPLOYEE', 'SYSTEM_ADMIN');

-- CreateEnum
CREATE TYPE "DepartmentRole" AS ENUM ('AGENT', 'MANAGER');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'STANDARD', 'URGENT');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- DropIndex
DROP INDEX "Request_employeeId_idx";

-- DropIndex
DROP INDEX "Request_priority_state_idx";

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "newState",
DROP COLUMN "oldState",
DROP COLUMN "timestamp",
DROP COLUMN "updatedBy",
ADD COLUMN     "actorId" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "newValue" TEXT,
ADD COLUMN     "oldValue" TEXT,
ALTER COLUMN "requestId" DROP NOT NULL,
ALTER COLUMN "action" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Request" DROP COLUMN "assignedHrId",
DROP COLUMN "documentKey",
DROP COLUMN "state",
DROP COLUMN "version",
ADD COLUMN     "claimedBy" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "departmentId" TEXT NOT NULL,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "requestTypeId" TEXT NOT NULL,
ADD COLUMN     "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "description" SET NOT NULL,
ALTER COLUMN "description" SET DEFAULT '',
DROP COLUMN "priority",
ADD COLUMN     "priority" "Priority" NOT NULL DEFAULT 'STANDARD';

-- DropEnum
DROP TYPE "PriorityLevel";

-- DropEnum
DROP TYPE "RequestState";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "ssoSubject" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "platformRole" "PlatformRole" NOT NULL DEFAULT 'EMPLOYEE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentMember" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentRole" "DepartmentRole" NOT NULL DEFAULT 'AGENT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartmentMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestType" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "defaultPriority" "Priority" NOT NULL DEFAULT 'STANDARD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgeAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_ssoSubject_key" ON "User"("ssoSubject");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_ssoSubject_idx" ON "User"("ssoSubject");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE INDEX "Department_code_idx" ON "Department"("code");

-- CreateIndex
CREATE INDEX "DepartmentMember_userId_active_idx" ON "DepartmentMember"("userId", "active");

-- CreateIndex
CREATE INDEX "DepartmentMember_departmentId_active_idx" ON "DepartmentMember"("departmentId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentMember_departmentId_userId_key" ON "DepartmentMember"("departmentId", "userId");

-- CreateIndex
CREATE INDEX "RequestType_departmentId_active_idx" ON "RequestType"("departmentId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RequestType_departmentId_code_key" ON "RequestType"("departmentId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_requestId_idx" ON "Document"("requestId");

-- CreateIndex
CREATE INDEX "Document_purgeAt_deletedAt_idx" ON "Document"("purgeAt", "deletedAt");

-- CreateIndex
CREATE INDEX "Document_storageKey_idx" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "NotificationEvent_status_createdAt_idx" ON "NotificationEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationEvent_requestId_idx" ON "NotificationEvent"("requestId");

-- CreateIndex
CREATE INDEX "AuditLog_requestId_createdAt_idx" ON "AuditLog"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "Request_employeeId_createdAt_idx" ON "Request"("employeeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Request_departmentId_status_priority_createdAt_idx" ON "Request"("departmentId", "status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "Request_status_idx" ON "Request"("status");

-- AddForeignKey
ALTER TABLE "DepartmentMember" ADD CONSTRAINT "DepartmentMember_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentMember" ADD CONSTRAINT "DepartmentMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestType" ADD CONSTRAINT "RequestType_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_requestTypeId_fkey" FOREIGN KEY ("requestTypeId") REFERENCES "RequestType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_claimedBy_fkey" FOREIGN KEY ("claimedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
