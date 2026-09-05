-- CreateEnum
CREATE TYPE "PriorityLevel" AS ENUM ('LOW', 'STANDARD', 'URGENT');

-- CreateEnum
CREATE TYPE "RequestState" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELED');

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "PriorityLevel" NOT NULL DEFAULT 'STANDARD',
    "state" "RequestState" NOT NULL DEFAULT 'PENDING',
    "assignedHrId" TEXT,
    "documentKey" TEXT,
    "resolutionNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "oldState" "RequestState" NOT NULL,
    "newState" "RequestState" NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Request_priority_state_idx" ON "Request"("priority", "state");

-- CreateIndex
CREATE INDEX "Request_employeeId_idx" ON "Request"("employeeId");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
