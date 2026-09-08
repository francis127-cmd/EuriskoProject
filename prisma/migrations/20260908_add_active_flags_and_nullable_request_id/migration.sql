-- AlterTable: Add active flags and make AuditLog.requestId nullable
ALTER TABLE "RequestType" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DepartmentMember" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_requestId_fkey";
ALTER TABLE "AuditLog" ALTER COLUMN "requestId" DROP NOT NULL;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;
