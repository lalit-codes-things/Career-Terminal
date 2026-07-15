/**
 * Prisma client singleton.
 * Ensures a single database connection pool across the application.
 * Prevents connection exhaustion during hot-reloads in development.
 */
import { PrismaClient } from '@prisma/client';

// Extend the global namespace to store the Prisma client across hot-reloads
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Singleton Prisma client instance.
 * In development, reuses the existing client to avoid connection pool exhaustion
 * during hot module reloading.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
