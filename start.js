const { execSync } = require('child_process');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

async function main() {
  console.log('Running migrations...');
  let output = run('npx prisma migrate deploy');
  console.log(output);

  if (output.includes('P3009')) {
    console.log('P3009 detected — cleaning up stuck migrations...');
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("DELETE FROM _prisma_migrations WHERE applied_at IS NULL AND started_at IS NOT NULL");
    await client.end();
    console.log('Retrying migration...');
    output = run('npx prisma migrate deploy');
    console.log(output);
  }

  console.log('Seeding database...');
  run('npx tsx prisma/seed.ts');

  console.log('Starting server...');
  execSync('node dist/src/main.js', { stdio: 'inherit' });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
