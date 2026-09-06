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

console.log('=== Step 0: Ensure Invitation table exists ===');
const createTableSql = `
DO $$ 
BEGIN
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
    RAISE NOTICE 'Invitation table created';
  ELSE
    RAISE NOTICE 'Invitation table already exists';
  END IF;
END $$;
`;
const sqlPath = path.join(process.cwd(), 'ensure_invitation.sql');
fs.writeFileSync(sqlPath, createTableSql);
let sqlOut = run(`npx prisma db execute --file ${sqlPath}`);
console.log(sqlOut);
try { fs.unlinkSync(sqlPath); } catch {}

console.log('=== Step 1: Running prisma migrate deploy ===');
let out = run('npx prisma migrate deploy');
console.log(out);

if (out.includes('P3009')) {
  console.log('=== P3009 detected — writing fix SQL ===');
  const fixPath = path.join(process.cwd(), 'fix.sql');
  fs.writeFileSync(fixPath, "DELETE FROM _prisma_migrations WHERE applied_at IS NULL AND started_at IS NOT NULL;\n");
  let fixOut = run(`npx prisma db execute --file ${fixPath}`);
  console.log(fixOut);
  try { fs.unlinkSync(fixPath); } catch {}
  console.log('=== Retrying prisma migrate deploy ===');
  out = run('npx prisma migrate deploy');
  console.log(out);
}

console.log('=== Step 2: Seeding ===');
const seedOut = run('npx tsx prisma/seed.ts');
console.log(seedOut);

console.log('=== Step 3: Starting server ===');
execSync('node dist/src/main.js', { stdio: 'inherit' });
