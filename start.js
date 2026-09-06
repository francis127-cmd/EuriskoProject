const { execSync } = require('child_process');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', timeout: 120000 });
  } catch (e) {
    return (e.stdout || '') + '\n' + (e.stderr || '');
  }
}

console.log('=== Running prisma migrate deploy ===');
let out = run('npx prisma migrate deploy');
console.log(out);

if (out.includes('P3009')) {
  console.log('=== P3009 — cleaning stuck migrations ===');
  const fs = require('fs');
  const path = require('path');
  const fixPath = path.join(process.cwd(), 'fix.sql');
  fs.writeFileSync(fixPath, "DELETE FROM _prisma_migrations WHERE applied_at IS NULL AND started_at IS NOT NULL;\n");
  run(`npx prisma db execute --file ${fixPath}`);
  fs.unlinkSync(fixPath);
  out = run('npx prisma migrate deploy');
  console.log(out);
}

console.log('=== Seeding ===');
console.log(run('npx tsx prisma/seed.ts'));

console.log('=== Starting server ===');
execSync('node dist/src/main.js', { stdio: 'inherit' });
