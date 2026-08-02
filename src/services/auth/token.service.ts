/**
 * TokenService — stateless JWT access tokens + Redis-backed refresh tokens.
 *
 * Architecture:
 *   Access token  → short-lived (15 min) HS256 JWT, verified in-process.
 *                   Stateless: no DB/cache hit on every request.
 *   Refresh token → opaque random token stored in Redis with 7-day TTL.
 *                   Rotating: each use issues a new pair and revokes the old one.
 *                   Stored under key:  refresh:<userId>:<tokenId>
 *
 * Why not store the refresh token in a DB?
 *   Redis TTL handles expiry automatically — no cron job needed.
 *   O(1) lookup vs a DB round-trip for every token refresh.
 *
 * Security notes:
 *   - Access token JTI is NOT tracked in Redis (short-lived, stateless).
 *     For hard revocation (e.g. ban user), call revokeAllRefreshTokens(userId)
 *     and set the access token expiry window accordingly.
 *   - Refresh token IDs are 32-byte hex strings (256-bit entropy).
 *   - Secrets are read from environment variables — never hardcoded.
 */
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import type { ICacheService } from '../cache/cache.service';
import { cacheService as defaultCacheService } from '../cache/cache.service';
import { TokenError } from '../../errors/app-errors';
import { logger } from '../../lib/logger';
import { config } from '../../config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 15 minutes in seconds (JWT exp field uses seconds). */
const ACCESS_TOKEN_TTL_SEC = 15 * 60;

/** 7 days in milliseconds (Redis TTL uses ms via ICacheService). */
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

const REFRESH_KEY_PREFIX = 'refresh:';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenPair {
  accessToken: string;
  /** Opaque refresh token — store in httpOnly cookie or secure storage. */
  refreshToken: string;
  /** UTC epoch seconds when the access token expires. */
  accessTokenExpiresAt: number;
}

export interface AccessTokenPayload {
  /** Subject — the user's UUID. */
  sub: string;
  /** JWT ID — unique per token issuance. */
  jti: string;
  /** Issued at (epoch seconds). */
  iat: number;
  /** Expiry (epoch seconds). */
  exp: number;
}

interface RefreshTokenRecord {
  userId: string;
  tokenId: string;
  issuedAt: number;
}

// ---------------------------------------------------------------------------
// TokenService
// ---------------------------------------------------------------------------

export class TokenService {
  private readonly jwtSecret: string;
  private readonly cache: ICacheService;

  constructor(cache: ICacheService = defaultCacheService) {
    const secret = config.jwtSecret;
    if (!secret) {
      throw new Error('Missing required environment variable: JWT_SECRET');
    }
    this.jwtSecret = secret;
    this.cache = cache;
  }

  // -------------------------------------------------------------------------
  // Issue
  // -------------------------------------------------------------------------

  /**
   * Creates a new access + refresh token pair for the given user.
   * The refresh token is persisted in Redis with a 7-day TTL.
   */
  async issueTokenPair(userId: string): Promise<TokenPair> {
    const jti = randomBytes(16).toString('hex');
    const now = Math.floor(Date.now() / 1_000);

    // ── Access token (JWT) ─────────────────────────────────────────────────
    const accessToken = jwt.sign({ sub: userId, jti }, this.jwtSecret, {
      expiresIn: ACCESS_TOKEN_TTL_SEC,
      algorithm: 'HS256',
    });

    // ── Refresh token (opaque, stored in Redis) ────────────────────────────
    const tokenId = randomBytes(32).toString('hex');
    const record: RefreshTokenRecord = { userId, tokenId, issuedAt: now };
    const cacheKey = this.refreshKey(userId, tokenId);

    await this.cache.set<RefreshTokenRecord>(cacheKey, record, REFRESH_TOKEN_TTL_MS);

    logger.info('[TokenService] Token pair issued', { userId, jti });

    return {
      accessToken,
      refreshToken: tokenId,
      accessTokenExpiresAt: now + ACCESS_TOKEN_TTL_SEC,
    };
  }

  // -------------------------------------------------------------------------
  // Verify access token
  // -------------------------------------------------------------------------

  /**
   * Verifies the JWT signature and expiry.
   * Throws TokenError for expired or tampered tokens.
   * Returns the decoded payload — caller gets the userId from `payload.sub`.
   */
  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      return jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
      }) as AccessTokenPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new TokenError('Access token has expired', 'TOKEN_EXPIRED');
      }
      throw new TokenError('Invalid access token', 'TOKEN_INVALID');
    }
  }

  // -------------------------------------------------------------------------
  // Refresh
  // -------------------------------------------------------------------------

  /**
   * Validates a refresh token, revokes it (rotation), and issues a fresh pair.
   *
   * Rotation means each refresh token is single-use — stolen tokens are
   * invalidated the moment the legitimate user next refreshes.
   */
  async rotateTokenPair(userId: string, refreshToken: string): Promise<TokenPair> {
    const cacheKey = this.refreshKey(userId, refreshToken);
    const record = await this.cache.getDel<RefreshTokenRecord>(cacheKey);

    if (!record || record.userId !== userId) {
      throw new TokenError('Refresh token is invalid or expired', 'REFRESH_TOKEN_INVALID');
    }

    return this.issueTokenPair(userId);
  }

  // -------------------------------------------------------------------------
  // Revocation
  // -------------------------------------------------------------------------

  /**
   * Revokes a single refresh token (e.g. on logout from one device).
   */
  async revokeRefreshToken(userId: string, refreshToken: string): Promise<void> {
    await this.cache.del(this.refreshKey(userId, refreshToken));
    logger.info('[TokenService] Refresh token revoked', { userId });
  }

  /**
   * Revokes ALL refresh tokens for a user (e.g. on password change, account ban).
   * Uses prefix deletion so all devices are logged out atomically.
   */
  async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.cache.delByPrefix(`${REFRESH_KEY_PREFIX}${userId}:`);
    logger.info('[TokenService] All refresh tokens revoked', { userId });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private refreshKey(userId: string, tokenId: string): string {
    return `${REFRESH_KEY_PREFIX}${userId}:${tokenId}`;
  }
}

// Singleton — TokenService is injected with the default cacheService
export const tokenService = new TokenService();
