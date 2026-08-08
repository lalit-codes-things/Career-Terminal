import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema',
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://career:terminal@localhost:5432/career_terminal',
  },
});
