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

console.log('=== Step 1: Running prisma migrate deploy ===');
let out = run('npx prisma migrate deploy');
console.log(out);

if (out.includes('P3009') || out.includes('does not exist')) {
  console.log('=== Migration issue detected — cleaning stuck entries ===');
  let fixSql = "DELETE FROM _prisma_migrations WHERE applied_at IS NULL;";
  if (out.includes('does not exist')) {
    fixSql += "\nDROP TABLE IF EXISTS \"_prisma_migrations\" CASCADE;";
  }
  const sqlPath = path.join(process.cwd(), 'fix.sql');
  fs.writeFileSync(sqlPath, fixSql);
  
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
