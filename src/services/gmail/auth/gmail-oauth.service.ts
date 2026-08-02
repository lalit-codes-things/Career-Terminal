/**
 * Gmail OAuth2 Service — Core authentication flow.
 *
 * Handles the complete OAuth2 lifecycle:
 * 1. Generate authorization URL with CSRF state
 * 2. Handle callback: exchange code → fetch profile → store connection
 * 3. Refresh expired access tokens automatically
 * 4. Provide valid access tokens on demand
 *
 * Uses the official `googleapis` library for OAuth2 operations.
 * Tokens are encrypted at rest via AES-256-GCM before database storage.
 */
import { google } from 'googleapis';
import { config } from '../../../config';
import { prisma } from '../../../config/database';
import { OAuthError, TokenError, NotFoundError } from '../../../errors/app-errors';
import { cryptoService } from '../../../infrastructure/crypto/crypto-service';
import { oauthStateService } from './oauth-state.service';
import { userService } from '../../user';
import type {
  OAuthCallbackResult,
  GoogleTokens,
  GoogleUserProfile,
  TokenRefreshResult,
} from '../models/gmail.types';

/** Gmail scopes — read-only access + email address. */
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

/** Buffer before actual expiry to trigger proactive refresh (5 minutes). */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export class GmailOAuthService {
  private readonly oauth2Client: {
    generateAuthUrl: (options: Record<string, unknown>) => string;
    setCredentials: (credentials: Record<string, unknown>) => void;
    getToken: (code: string) => Promise<{
      tokens: {
        access_token?: string;
        refresh_token?: string;
        expiry_date?: number;
        scope?: string;
      };
    }>;
    refreshAccessToken: () => Promise<{
      credentials: {
        access_token?: string;
        refresh_token?: string;
        expiry_date?: number;
        scope?: string;
      };
    }>;
  };

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      config.google.redirectUri,
    );
  }

  /**
   * Generates the Google OAuth2 authorization URL.
   *
   * @param userId - The platform user ID initiating the connection
   * @returns The full authorization URL to redirect the user to
   */
  async getAuthorizationUrl(userId: string): Promise<string> {
    const state = await oauthStateService.generateState(userId);

    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline', // Request refresh token
      prompt: 'consent', // Always show consent screen to get refresh token
      scope: GMAIL_SCOPES,
      state,
      include_granted_scopes: true,
    });

    return Promise.resolve(url);
  }

  /**
   * Handles the OAuth2 callback after user authorization.
   *
   * Flow:
   * 1. Validate the CSRF state parameter
   * 2. Exchange authorization code for tokens
   * 3. Fetch the user's Gmail profile (email address)
   * 4. Encrypt tokens and upsert the connection in the database
   *
   * @param code - The authorization code from Google
   * @param state - The state parameter for CSRF validation
   * @returns Connection details (connectionId, emailAddress)
   * @throws {OAuthError} If state is invalid or token exchange fails
   */
  async handleCallback(code: string, state: string): Promise<OAuthCallbackResult> {
    // Step 1: Validate CSRF state (now async — supports Redis backend)
    const userId = await oauthStateService.validateAndConsume(state);

    // Step 2: Exchange code for tokens
    const tokens = await this.exchangeCodeForTokens(code);

    // Step 3: Fetch user's email address
    const profile = await this.fetchUserProfile(tokens.accessToken);

    // Step 4: Encrypt and store
    const connection = await this.storeConnection(userId, tokens, profile);

    return {
      connectionId: connection.id,
      emailAddress: profile.email,
      provider: 'GMAIL',
    };
  }

  /**
   * Refreshes an expired access token using the stored refresh token.
   *
   * @param connectionId - The UserEmailConnection ID
   * @returns Fresh access token and new expiry
   * @throws {NotFoundError} If the connection doesn't exist
   * @throws {TokenError} If the refresh token is revoked or invalid
   */
  async refreshAccessToken(userId: string, connectionId: string): Promise<TokenRefreshResult> {
    const connection = await prisma.userEmailConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new NotFoundError('UserEmailConnection', connectionId);
    }

    if (connection.userId !== userId) {
      throw new TokenError('Unauthorized: connection does not belong to the requesting user');
    }

    // Decrypt the stored refresh token
    const refreshToken = await cryptoService.decrypt(connection.refreshTokenEncrypted);

    try {
      // Set the refresh token and request a new access token
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await this.oauth2Client.refreshAccessToken();

      if (!credentials.access_token || credentials.expiry_date === undefined) {
        throw new TokenError('Google returned empty credentials during refresh');
      }

      // Encrypt and update the new access token
      const encryptedAccessToken = (await cryptoService.encrypt(credentials.access_token))
        .ciphertext;
      const expiryDate = new Date(credentials.expiry_date);

      await prisma.userEmailConnection.update({
        where: { id: connectionId },
        data: {
          accessTokenEncrypted: encryptedAccessToken,
          tokenExpiry: expiryDate,
          status: 'ACTIVE',
        },
      });

      return {
        accessToken: credentials.access_token,
        expiryDate: credentials.expiry_date,
      };
    } catch (error) {
      // Mark the connection as having an error if refresh fails
      await prisma.userEmailConnection.update({
        where: { id: connectionId },
        data: { status: 'ERROR' },
      });

      if (error instanceof TokenError) throw error;
      throw new TokenError(
        `Failed to refresh access token: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Returns a valid access token for the given connection.
   * Automatically refreshes the token if it's expired or about to expire.
   *
   * @param connectionId - The UserEmailConnection ID
   * @returns A valid (non-expired) access token
   */
  async getValidAccessToken(userId: string, connectionId: string): Promise<string> {
    const connection = await prisma.userEmailConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new NotFoundError('UserEmailConnection', connectionId);
    }

    if (connection.userId !== userId) {
      throw new TokenError('Unauthorized: connection does not belong to the requesting user');
    }

    if (connection.status === 'REVOKED') {
      throw new TokenError('This email connection has been revoked. Please reconnect.');
    }

    // Check if token is expired or about to expire
    const now = Date.now();
    const expiryMs = connection.tokenExpiry.getTime();
    const needsRefresh = now >= expiryMs - TOKEN_EXPIRY_BUFFER_MS;

    if (needsRefresh) {
      const refreshed = await this.refreshAccessToken(userId, connectionId);
      return refreshed.accessToken;
    }

    // Token is still valid — decrypt and return
    return await cryptoService.decrypt(connection.accessTokenEncrypted);
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Exchanges an authorization code for OAuth2 tokens.
   */
  private async exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);

      if (!tokens.access_token) {
        throw new OAuthError('Google did not return an access token');
      }
      if (!tokens.refresh_token) {
        throw new OAuthError(
          'Google did not return a refresh token. This may happen if the user has previously authorized the app. Revoke access and try again.',
        );
      }

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date ?? Date.now() + 3600 * 1000,
        scope: tokens.scope ?? GMAIL_SCOPES.join(' '),
      };
    } catch (error) {
      if (error instanceof OAuthError) throw error;
      throw new OAuthError(
        `Failed to exchange authorization code: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Fetches the authenticated user's email address from Google.
   */
  private async fetchUserProfile(accessToken: string): Promise<GoogleUserProfile> {
    try {
      this.oauth2Client.setCredentials({ access_token: accessToken });
      const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
      const { data } = await oauth2.userinfo.get();

      if (!data.email) {
        throw new OAuthError('Could not retrieve email address from Google profile');
      }

      return {
        email: data.email,
        name: data.name ?? undefined,
        picture: data.picture ?? undefined,
      };
    } catch (error) {
      if (error instanceof OAuthError) throw error;
      throw new OAuthError(
        `Failed to fetch Google profile: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Encrypts tokens and upserts the UserEmailConnection in the database.
   */
  private async storeConnection(
    userId: string,
    tokens: GoogleTokens,
    profile: GoogleUserProfile,
  ): Promise<{ id: string }> {
    const encryptedAccessToken = (await cryptoService.encrypt(tokens.accessToken)).ciphertext;
    const encryptedRefreshToken = (await cryptoService.encrypt(tokens.refreshToken)).ciphertext;
    const scopes = tokens.scope.split(' ');
    const userScope = await userService.userScopeFor(userId);

    const connection = await prisma.userEmailConnection.upsert({
      where: {
        unique_user_provider_email: {
          legacyUserId: userId,
          provider: 'GMAIL',
          emailAddress: profile.email,
        },
      },
      create: {
        userId: userScope.userId,
        legacyUserId: userScope.legacyUserId,
        provider: 'GMAIL',
        emailAddress: profile.email,
        accessTokenEncrypted: encryptedAccessToken,
        refreshTokenEncrypted: encryptedRefreshToken,
        tokenExpiry: new Date(tokens.expiryDate),
        scopes,
        status: 'ACTIVE',
      },
      update: {
        userId: userScope.userId,
        accessTokenEncrypted: encryptedAccessToken,
        refreshTokenEncrypted: encryptedRefreshToken,
        tokenExpiry: new Date(tokens.expiryDate),
        scopes,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    await userService.updateProfile(userId, { fullName: profile.name ?? undefined });

    return connection;
  }
}

/** Singleton instance. */
export const gmailOAuthService = new GmailOAuthService();
