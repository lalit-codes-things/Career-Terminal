import { DataPlaneClient } from '../services/data-plane-client.service';
import { prisma } from '../config/database';
import { cacheService } from '../services/cache/cache.service';

describe('DataPlaneClient', () => {
  const region = 'us-east-1';
  const client = new DataPlaneClient(region);

  it('should be initialized with a region', () => {
    expect(client.region).toBe(region);
  });

  it('should return the prisma client from getDatabaseClient', () => {
    expect(client.getDatabaseClient()).toBe(prisma);
  });

  it('should return the cache service from getCacheClient', () => {
    expect(client.getCacheClient()).toBe(cacheService);
  });

  it('should throw error for getStorageClient (not yet implemented)', () => {
    expect(() => client.getStorageClient()).toThrow(/not yet implemented/);
  });
});
