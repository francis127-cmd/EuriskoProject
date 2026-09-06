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

console.log('=== Running prisma migrate deploy ===');
let out = run('npx prisma migrate deploy');
console.log(out);

if (out.includes('P3009')) {
  console.log('=== P3009 — resolving stuck migrations ===');
  const matches = out.match(/`([\d_]+_[\w]+)` migration/);
  if (matches && matches[1]) {
    const name = matches[1];
    console.log(`Resolving stuck migration: ${name}`);
    const r = run(`npx prisma migrate resolve --rolled-back ${name}`);
    console.log(r);
  }
  console.log('=== Retrying prisma migrate deploy ===');
  out = run('npx prisma migrate deploy');
  console.log(out);
}

console.log('=== Seeding ===');
console.log(run('npx tsx prisma/seed.ts'));

console.log('=== Starting server ===');
execSync('node dist/src/main.js', { stdio: 'inherit' });
