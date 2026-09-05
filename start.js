const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', timeout: 60000 });
  } catch (e) {
    return (e.stdout || '') + '\n' + (e.stderr || '');
  }
}

console.log('=== Step 1: Running prisma migrate deploy ===');
let out = run('npx prisma migrate deploy');
console.log(out);

if (out.includes('P3009')) {
  console.log('=== P3009 detected — writing fix SQL ===');
  const sqlPath = path.join(process.cwd(), 'fix.sql');
  fs.writeFileSync(sqlPath, "DELETE FROM _prisma_migrations WHERE applied_at IS NULL AND started_at IS NOT NULL;\n");

  console.log('=== Running prisma db execute --file ===');
  let fixOut = run(`npx prisma db execute --file ${sqlPath}`);
  console.log(fixOut);

  try { fs.unlinkSync(sqlPath); } catch {}

  console.log('=== Retrying prisma migrate deploy ===');
  out = run('npx prisma migrate deploy');
  console.log(out);
}

console.log('=== Step 2: Seeding ===');
const seedOut = run('npx tsx prisma/seed.ts');
console.log(seedOut);

console.log('=== Step 3: Starting server ===');
execSync('node dist/src/main.js', { stdio: 'inherit' });
