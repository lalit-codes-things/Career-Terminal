#!/bin/sh
# =============================================================================
# Career Terminal — Shadow Database Bootstrap
# =============================================================================
#
# Creates the shadow database used by Prisma migrate dev for schema diffing.
# Also provisions extensions on the shadow database so vector(1536) and
# other extension-dependent types are available during development.
#
# This runs as the container superuser during postgres initialization.
# =============================================================================

set -e

# Only create if POSTGRES_USER and POSTGRES_DB are set (standard PG env)
if [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_DB" ]; then
  echo "create-shadow-db: POSTGRES_USER/POSTGRES_DB are required" >&2
  exit 1
fi

SHADOW_DB="career-terminal-shadow"

# Create shadow database if it does not exist
if ! psql -U "$POSTGRES_USER" -tc "SELECT 1 FROM pg_database WHERE datname = '$SHADOW_DB'" | grep -q 1; then
  createdb -U "$POSTGRES_USER" "$SHADOW_DB"
  echo "create-shadow-db: created database $SHADOW_DB"
else
  echo "create-shadow-db: database $SHADOW_DB already exists"
fi

# Provision extensions on the shadow database (same as primary)
for ext in vector pgcrypto pg_trgm btree_gin; do
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$SHADOW_DB" -c "CREATE EXTENSION IF NOT EXISTS $ext"
done

# Grant access to the migration role
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$SHADOW_DB" \
  -c "GRANT ALL PRIVILEGES ON DATABASE \"$SHADOW_DB\" TO career_terminal_migr"

echo "create-shadow-db: extensions provisioned on $SHADOW_DB"
