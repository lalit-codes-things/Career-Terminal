import { prisma } from '../config/database';
import { cacheService } from './cache/cache.service';
import { SupportedRegion } from './placement/placement.types';

/**
 * DataPlaneClient — routes operations to the correct regional service.
 * 
 * This is an abstraction layer that allows the application to be region-aware.
 * Initially, since we only have one region, it delegates to the local services.
 * In the future, this will handle routing to different regional databases,
 * queues, and storage buckets.
 */
export class DataPlaneClient {
  constructor(public readonly region: SupportedRegion) {}

  /**
   * Returns the database client for the region.
   * For now, returns the master Prisma client singleton.
   */
  getDatabaseClient() {
    // In the future, this will return a region-specific Prisma client
    // or a connection handle from a pool.
    return prisma;
  }

  /**
   * Returns the cache/queue client for the region.
   * For now, returns the shared cacheService singleton.
   */
  getCacheClient() {
    // In the future, this will return a region-specific Redis client.
    return cacheService;
  }

  /**
   * Returns the storage client for the region.
   * Not yet implemented as we are currently using a single-region bucket.
   */
  getStorageClient() {
    throw new Error(`Storage client for region ${this.region} not yet implemented`);
  }
}
