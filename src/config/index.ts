/**
 * Centralized application configuration.
 * Loads and validates all environment variables at startup.
 */
import 'dotenv/config';

interface AppConfig {
  /** Server port */
  port: number;
  /** Runtime environment */
  nodeEnv: string;
  /** Whether we're in production */
  isProduction: boolean;

  /** Google OAuth2 credentials */
  google: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };

  /** Encryption key for token storage (32 bytes hex) */
  encryptionKey: string;

  /** Database connection URL */
  databaseUrl: string;
}

/**
 * Reads an environment variable, throwing if required and missing.
 */
function getEnv(key: string, required = true): string {
  const value = process.env[key];
  if (!value && required) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value ?? '';
}

/**
 * Build and validate the application configuration.
 * Called once at module load — crashes early on missing config.
 */
function loadConfig(): AppConfig {
  const nodeEnv = getEnv('NODE_ENV', false) || 'development';

  return {
    port: parseInt(getEnv('PORT', false) || '3000', 10),
    nodeEnv,
    isProduction: nodeEnv === 'production',

    google: {
      clientId: getEnv('GOOGLE_CLIENT_ID'),
      clientSecret: getEnv('GOOGLE_CLIENT_SECRET'),
      redirectUri: getEnv('GOOGLE_REDIRECT_URI'),
    },

    encryptionKey: getEnv('ENCRYPTION_KEY'),
    databaseUrl: getEnv('DATABASE_URL'),
  };
}

export const config = loadConfig();
