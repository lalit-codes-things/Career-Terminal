/**
 * Partition key generation utilities.
 *
 * For the `jobs` table the partition key is a deterministic hash derived
 * from the job's geographic location (country + city). This ensures all
 * jobs in the same geographic bucket land in the same DB partition, making
 * range queries and index scans efficient at scale.
 *
 * Rules:
 *  - Input is normalised (lowercased, trimmed) before hashing so that
 *    "New York" and "new york" produce the same key.
 *  - We use SHA-256 truncated to 8 hex chars (32-bit space) — enough
 *    cardinality for ~65k cities × ~200 countries with negligible collision
 *    probability at job-board scale.
 */
import { createHash } from 'crypto';

/**
 * Generates a stable location-based partition key for the `jobs` table.
 *
 * @param country - ISO 3166-1 alpha-2 country code or full name (e.g. "US", "United States")
 * @param city    - City name (e.g. "San Francisco")
 * @returns       8-character hex string used as `location_hash` on job records
 *
 * @example
 * generateLocationPartitionKey('US', 'San Francisco') // => 'a3f1c2d9'
 * generateLocationPartitionKey('us', 'san francisco') // => 'a3f1c2d9' (same — normalised)
 */
export function generateLocationPartitionKey(country: string, city: string): string {
  const normalised = `${country.trim().toLowerCase()}::${city.trim().toLowerCase()}`;
  return createHash('sha256').update(normalised).digest('hex').slice(0, 8);
}

/**
 * Generates a user-scoped partition key.
 * Useful when you want a composite key that ties a sub-entity to a user
 * without a full UUID lookup (e.g. cache keys, sharding hints).
 *
 * @param userId    - The owning user's UUID
 * @param subEntity - A secondary discriminator (e.g. "resume", "notifications")
 * @returns         16-character hex string
 *
 * @example
 * generateUserPartitionKey('user-uuid-123', 'resume') // => 'b2e4a1f3c9d8e7a2'
 */
export function generateUserPartitionKey(userId: string, subEntity: string): string {
  const normalised = `${userId.trim()}::${subEntity.trim().toLowerCase()}`;
  return createHash('sha256').update(normalised).digest('hex').slice(0, 16);
}
