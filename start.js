const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', timeout: 120000 });
  } catch (e) {
    return (e.stdout || '') + '\n' + (e.stderr || '');
  }
}

console.log('=== Step 0: Ensure required columns exist ===');
const ensureColumnsSql = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Company' AND column_name = 'domain') THEN
    ALTER TABLE "Company" ADD COLUMN "domain" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS "Company_domain_key" ON "Company"("domain");
    CREATE INDEX IF NOT EXISTS "Company_domain_idx" ON "Company"("domain");
    RAISE NOTICE 'Added domain column to Company';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Company' AND column_name = 'ssoProvider') THEN
    ALTER TABLE "Company" ADD COLUMN "ssoProvider" TEXT DEFAULT 'GOOGLE';
    RAISE NOTICE 'Added ssoProvider column to Company';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Company' AND column_name = 'googleClientId') THEN
    ALTER TABLE "Company" ADD COLUMN "googleClientId" TEXT;
    RAISE NOTICE 'Added googleClientId column to Company';
  END IF;

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
    RAISE NOTICE 'Created Invitation table';
  END IF;
END $$;
`;
const colSqlPath = path.join(process.cwd(), 'ensure_columns.sql');
fs.writeFileSync(colSqlPath, ensureColumnsSql);
console.log(run(`npx prisma db execute --file ${colSqlPath}`));
try { fs.unlinkSync(colSqlPath); } catch {}

console.log('=== Step 1: Clear stuck migration records ===');
const clearSql = `DELETE FROM "_prisma_migrations" WHERE "applied_at" IS NULL;`;
const clearSqlPath = path.join(process.cwd(), 'clear_stuck.sql');
fs.writeFileSync(clearSqlPath, clearSql);
console.log(run(`npx prisma db execute --file ${clearSqlPath}`));
try { fs.unlinkSync(clearSqlPath); } catch {}

console.log('=== Step 2: Running prisma migrate deploy ===');
let out = run('npx prisma migrate deploy');
console.log(out);

if (out.includes('P3009')) {
  console.log('=== P3009 persists — trying full cleanup ===');
  const deepClean = `DELETE FROM "_prisma_migrations" WHERE "finished_at" IS NULL;`;
  const deepCleanPath = path.join(process.cwd(), 'deep_clean.sql');
  fs.writeFileSync(deepCleanPath, deepClean);
  console.log(run(`npx prisma db execute --file ${deepCleanPath}`));
  try { fs.unlinkSync(deepCleanPath); } catch {}
  out = run('npx prisma migrate deploy');
  console.log(out);
}

console.log('=== Seeding ===');
console.log(run('npx tsx prisma/seed.ts'));

console.log('=== Starting server ===');
execSync('node dist/src/main.js', { stdio: 'inherit' });
