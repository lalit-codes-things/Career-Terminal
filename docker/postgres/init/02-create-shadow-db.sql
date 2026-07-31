-- Career Terminal — Shadow Database for Prisma Migrate Dev
--
-- Prisma migrate dev uses a shadow database for schema diffing.
-- This script creates the shadow database and provisions the same
-- extensions as the primary database so that vector(1536) and other
-- extension-dependent types are available during development migrations.
--
-- Run after 00-extensions.sql and 01-create-app-roles.sh.

-- Create shadow database if it does not exist
SELECT 'CREATE DATABASE career_terminal_shadow'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'career-terminal-shadow')\\gexec

-- Grant access to the migration role (used by prisma migrate dev)
GRANT ALL PRIVILEGES ON DATABASE "career-terminal-shadow" TO career_terminal_migr;
