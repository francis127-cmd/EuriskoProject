require('dotenv/config');
const { execSync } = require('child_process');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

async function main() {
  console.log('[start.js] Running startup tasks...');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Step 1: Ensure required columns exist (idempotent)
  console.log('[start.js] Ensuring required columns...');
  try {
    await pool.query(`
      ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "domain" TEXT;
      ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "ssoProvider" TEXT;
      ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "googleClientId" TEXT;
      ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "authMode" TEXT NOT NULL DEFAULT 'PASSWORD';
      ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "mfaRequired" BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;
    `);
    console.log('[start.js] Columns ensured.');

    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE "User" ALTER COLUMN "ssoSubject" DROP NOT NULL;
      EXCEPTION WHEN others THEN null;
      END $$;
    `);

    await pool.query(`DROP INDEX IF EXISTS "User_companyId_ssoSubject_key";`);
  } catch (e) {
    console.warn('[start.js] Column setup warning:', e && e.message ? e.message : e);
  }

  // Step 2: Create new tables (idempotent)
  console.log('[start.js] Creating new tables...');
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "RefreshToken" (
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

      CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_token_key" ON "RefreshToken"("token");
      CREATE INDEX IF NOT EXISTS "RefreshToken_token_idx" ON "RefreshToken"("token");
      CREATE INDEX IF NOT EXISTS "RefreshToken_userId_idx" ON "RefreshToken"("userId");
      CREATE INDEX IF NOT EXISTS "RefreshToken_family_idx" ON "RefreshToken"("family");

      ALTER TABLE "RefreshToken"
        ADD CONSTRAINT IF NOT EXISTS "RefreshToken_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    `);
    console.log('[start.js] RefreshToken table ensured.');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "MfaSecret" (
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

      ALTER TABLE "MfaSecret"
        ADD CONSTRAINT IF NOT EXISTS "MfaSecret_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    `);
    console.log('[start.js] MfaSecret table ensured.');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "DomainVerification" (
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

      CREATE INDEX IF NOT EXISTS "DomainVerification_token_idx" ON "DomainVerification"("token");

      ALTER TABLE "DomainVerification"
        ADD CONSTRAINT IF NOT EXISTS "DomainVerification_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

      DO $$ BEGIN
        ALTER TABLE "DomainVerification" ADD CONSTRAINT "DomainVerification_companyId_domain_key"
          UNIQUE ("companyId", "domain");
      EXCEPTION WHEN others THEN null;
      END $$;
    `);
    console.log('[start.js] DomainVerification table ensured.');
  } catch (e) {
    console.warn('[start.js] Table creation warning:', e && e.message ? e.message : e);
  }

  // Step 3: Clean up stuck migrations
  console.log('[start.js] Cleaning up stuck migrations...');
  try {
    const result = await pool.query(`
      DELETE FROM "_prisma_migrations"
      WHERE "finished_at" IS NULL
    `);
    console.log('[start.js] Stuck migrations cleaned. Rows affected:', result.rowCount);
  } catch (e) {
    console.warn('[start.js] Stuck migration cleanup warning:', e && e.message ? e.message : e);
  }

  await pool.end();

  // Step 4: Run Prisma migrations
  console.log('[start.js] Running prisma migrate deploy...');
  try {
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('[start.js] Migrations applied.');
  } catch (e) {
    console.error('[start.js] Migration failed:', e && e.message ? e.message : e);
  }

  // Step 5: Generate Prisma Client
  console.log('[start.js] Running prisma generate...');
  try {
    execSync('npx prisma generate', { stdio: 'inherit' });
    console.log('[start.js] Prisma client generated.');
  } catch (e) {
    console.error('[start.js] Generate failed:', e && e.message ? e.message : e);
  }

  // Step 6: Start the application
  console.log('[start.js] Starting NestJS application...');
  require('./dist/main');
}

main().catch((e) => {
  console.error('[start.js] Fatal error:', e);
  process.exit(1);
});
