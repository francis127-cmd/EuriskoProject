import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { InfraExceptionFilter } from './common/infra-exception.filter';
import { PrismaClient } from '@prisma/client';

async function ensureInvitationTable() {
  const prisma = new PrismaClient();
  try {
    const exists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'Invitation') as "exists"`
    );
    if (!exists[0]?.exists) {
      console.log('[BOOTSTRAP] Invitation table missing — creating...');
      await prisma.$executeRawUnsafe(`
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
      `);
      console.log('[BOOTSTRAP] Invitation table created successfully');
    } else {
      console.log('[BOOTSTRAP] Invitation table already exists');
    }
  } catch (e) {
    console.error('[BOOTSTRAP] Failed to ensure Invitation table:', e);
  } finally {
    await prisma.$disconnect();
  }
}

async function bootstrap() {
  await ensureInvitationTable();
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.useGlobalFilters(new InfraExceptionFilter());
  const port = process.env['PORT'] ? Number(process.env['PORT']) : 3000;
  await app.listen(port);
}
bootstrap();
