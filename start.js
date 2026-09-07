import 'dotenv/config';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

async function main() {
  console.log('[start.js] Running startup tasks...');

  // Step 1: Ensure required columns exist (idempotent)
  console.log('[start.js] Ensuring required columns...');
  const client = new PrismaClient();
  try {
    await client.$executeRawUnsafe(`
      ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "domain" TEXT;
      ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "ssoProvider" TEXT;
      ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "googleClientId" TEXT;
      ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "authMode" TEXT NOT NULL DEFAULT 'PASSWORD';
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
    `);
    console.log('[start.js] Columns ensured.');

    // Make ssoSubject nullable if it was NOT NULL
    await client.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "User" ALTER COLUMN "ssoSubject" DROP NOT NULL;
      EXCEPTION WHEN others THEN null;
      END $$;
    `);

    // Drop old unique indexes that conflict with the new schema
    await client.$executeRawUnsafe(`
      DROP INDEX IF EXISTS "User_companyId_ssoSubject_key";
    `);
  } catch (e) {
    console.warn('[start.js] Column setup warning:', (e as Error).message);
  } finally {
    await client.$disconnect();
  }

  // Step 2: Clean up stuck migrations
  console.log('[start.js] Cleaning up stuck migrations...');
  try {
    const stuckClient = new PrismaClient();
    await stuckClient.$executeRawUnsafe(`
      DELETE FROM "_prisma_migrations"
      WHERE "migration_name" = '20260905180000_add_multi_tenancy'
        AND "finished_at" IS NULL;
    `);
    console.log('[start.js] Stuck migrations cleaned.');
    await stuckClient.$disconnect();
  } catch (e) {
    console.warn('[start.js] Stuck migration cleanup warning:', (e as Error).message);
  }

  // Step 3: Run Prisma migrations
  console.log('[start.js] Running prisma migrate deploy...');
  try {
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('[start.js] Migrations applied.');
  } catch (e) {
    console.error('[start.js] Migration failed:', (e as Error).message);
    // Don't exit — the app might still work with existing schema
  }

  // Step 4: Generate Prisma Client
  console.log('[start.js] Running prisma generate...');
  try {
    execSync('npx prisma generate', { stdio: 'inherit' });
    console.log('[start.js] Prisma client generated.');
  } catch (e) {
    console.error('[start.js] Generate failed:', (e as Error).message);
  }

  // Step 5: Start the application
  console.log('[start.js] Starting NestJS application...');
  require('./dist/main');
}

main().catch((e) => {
  console.error('[start.js] Fatal error:', e);
  process.exit(1);
});
