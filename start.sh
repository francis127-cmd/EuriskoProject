#!/bin/sh
set -e

echo "Running migrations..."
MIGRATE_OUT=$(npx prisma migrate deploy 2>&1) || true
echo "$MIGRATE_OUT"

if echo "$MIGRATE_OUT" | grep -q "P3009"; then
  echo "P3009 detected — deleting stuck migration rows..."
  npx prisma db execute --stdin --schema prisma/schema.prisma <<'EOSQL'
DELETE FROM _prisma_migrations WHERE applied_at IS NULL AND started_at IS NOT NULL;
EOSQL
  echo "Retrying migration..."
  npx prisma migrate deploy 2>&1
fi

echo "Seeding database..."
npx tsx prisma/seed.ts

echo "Starting server..."
exec node dist/src/main.js
