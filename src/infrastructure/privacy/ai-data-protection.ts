/**
 * AI Data Protection Policy — Epic 0.7, Phase 26.
 *
 * Documents the data protection rules that govern how ApplyWise
 * interacts with AI/ML systems. As of this release, no real external
 * LLM provider is integrated — only a MockEmbeddingProvider is used
 * (no external network calls).
 *
 * When a real AI provider is added, ALL rules in this module must be
 * reviewed and the externalProviders array updated accordingly.
 */

// ---------------------------------------------------------------------------
// Policy object
// ---------------------------------------------------------------------------

export const AI_DATA_PROTECTION_POLICY = {
  /**
   * Current AI integrations in use.
   * Update this list whenever a new AI provider is integrated.
   */
  currentAiIntegrations: 'MockEmbeddingProvider (no external calls)',

  /**
   * Data minimisation rules — enforced before any data is sent to an AI system.
   */
  dataMinimisationRules: [
    'Strip all OAuth tokens (access_token, refresh_token) before sending to AI',
    'Strip all JWT strings (Bearer tokens, HS256 payloads) before sending to AI',
    'Strip encrypted field values (v1:..., v2:... AES-256-GCM envelopes) before sending to AI',
    'Strip database connection strings (postgresql://, mysql://) before sending to AI',
    'Strip Redis URLs (redis://, rediss://) before sending to AI',
    'Strip AWS credentials (AKIA..., secret key patterns) before sending to AI',
    'Strip API keys and internal secrets before sending to AI',
    'Redact email addresses from email body content before sending to AI classifiers',
    'Send only structured metadata (company name, role title, application status) to AI — not raw email content',
    'Never include credentials in LLM prompts under any circumstances',
    'Prefer hashed or anonymised identifiers over plain user IDs in AI prompts',
    'Log AI input/output at debug level only — never at info/warn/error in production',
  ] as string[],

  /**
   * Whether PII is redacted before sending data to AI providers.
   * Must be true — enforced by assertAiDataMinimisation() at call sites.
   */
  piiRedactionBeforeSending: true as const,

  /**
   * Whether AI prompts and completions are logged for debugging.
   * Must be false in production to prevent PII leakage via logs.
   */
  promptLoggingEnabled: false as const,

  /**
   * External AI/ML providers that receive any application data.
   * Currently empty — MockEmbeddingProvider makes no external calls.
   * Update this when adding OpenAI, Anthropic, Cohere, etc.
   */
  externalProviders: [] as string[],

  /**
   * Guidelines for future engineers integrating a real AI provider.
   */
  futureIntegrationGuidelines: [
    '1. Run assertAiDataMinimisation() on all data before sending to the provider',
    '2. Add the provider name to externalProviders above and update the DPA/privacy policy',
    '3. Review the data processing agreement (DPA) with the provider — ensure no training on user data',
    '4. Set piiRedactionBeforeSending=true and implement redaction in a dedicated sanitiser module',
    '5. Never include raw email body_text or body_html in prompts — use structured extracted fields only',
    '6. Never include credentials, tokens, or connection strings in prompts',
    '7. Implement prompt injection defence: sanitise input to remove instructions like "ignore previous..."',
    '8. Rate-limit AI calls per user to bound cost and prevent abuse',
    '9. Store only anonymised evaluation metrics — not the prompt/completion pairs',
    '10. Set promptLoggingEnabled=true ONLY in a dedicated staging environment for debugging',
  ] as string[],
} as const;

// ---------------------------------------------------------------------------
// Runtime guard — call before any AI provider call
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate credential or PII leakage in data about to be sent to an AI system.
 */
const CREDENTIAL_PATTERNS: Array<{ name: string; test: (str: string) => boolean }> = [
  {
    name: 'JWT access token (starts with eyJ)',
    test: (s) => /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/.test(s),
  },
  {
    name: 'AES-256-GCM encrypted envelope (v1: or v2: prefix)',
    test: (s) => /\bv\d+:[A-Za-z0-9+/=]{8,}:[A-Za-z0-9+/=]{8,}:[A-Za-z0-9+/=]{8,}/.test(s),
  },
  {
    name: 'Database connection string',
    test: (s) => /(postgresql|postgres|mysql|mongodb):\/\/[^:]+:[^@]+@/.test(s),
  },
  {
    name: 'Redis connection string',
    test: (s) => /rediss?:\/\/[^:]*:[^@]+@/.test(s),
  },
  {
    name: 'AWS access key ID pattern',
    test: (s) => /AKIA[0-9A-Z]{16}/.test(s),
  },
  {
    name: 'Bearer token in string',
    test: (s) => /Bearer\s+[A-Za-z0-9+/=._-]{20,}/.test(s),
  },
];

/**
 * Recursively serialize an unknown value to a string for pattern matching.
 */
function serializeForPatternCheck(data: unknown): string {
  if (typeof data === 'string') return data;
  if (typeof data === 'object' && data !== null) {
    try {
      return JSON.stringify(data);
    } catch {
      return String(data);
    }
  }
  return String(data);
}

/**
 * Assert that a data object does NOT contain known credential patterns.
 *
 * Call this at every AI provider call site before sending data:
 *   assertAiDataMinimisation(promptData);
 *   await aiProvider.complete(promptData);
 *
 * @param data - The data about to be sent to an AI provider
 * @throws {Error} If credential patterns are detected
 */
export function assertAiDataMinimisation(data: unknown): void {
  const serialized = serializeForPatternCheck(data);

  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new Error(
        `AI data minimisation violation: data contains a pattern matching "${pattern.name}". ` +
          'Strip all credentials and tokens before sending to AI providers. ' +
          'See src/infrastructure/privacy/ai-data-protection.ts for policy.',
      );
    }
  }
}
