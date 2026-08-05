/**
 * pipeline.factory.ts — Composition root for the AI extraction pipeline.
 *
 * Reads API keys from environment, instantiates the concrete adapters
 * (DeepSeek primary, OpenRouter fallback), registers them with ExtractionPipeline,
 * and exports a singleton that every capability module can import.
 *
 * Key design decisions:
 *  - DeepSeek is always the preferred provider when DEEPSEEK_API_KEY is set.
 *  - OpenRouter is registered as the fallback when OPENROUTER_API_KEY is set.
 *  - If neither key is present (test environments), the StubAiAdapter is used.
 *  - Exactly one ExtractionPipeline instance is created per process; callers
 *    import `pipeline` and do not call this factory themselves.
 */

import { ExtractionPipeline } from './extraction-pipeline';
import type { AiModelAdapter, AiProviderKind } from './types';
import { DeepSeekAdapter } from './adapters/deepseek.adapter';
import { OpenRouterAdapter } from './adapters/openrouter.adapter';
import { StubAiAdapter } from './adapters/stub.adapter';

function buildProviders(): AiModelAdapter[] {
  const providers: AiModelAdapter[] = [];

  const deepseekKey = process.env['DEEPSEEK_API_KEY'];
  if (deepseekKey) {
    providers.push(
      new DeepSeekAdapter({
        apiKey: deepseekKey,
        baseUrl: process.env['DEEPSEEK_BASE_URL'],
      }),
    );
  }

  const openrouterKey = process.env['OPENROUTER_API_KEY'];
  if (openrouterKey) {
    providers.push(
      new OpenRouterAdapter({
        apiKey: openrouterKey,
        siteUrl: process.env['OPENROUTER_SITE_URL'],
        siteName: process.env['OPENROUTER_SITE_NAME'],
      }),
    );
  }

  // Always keep a stub so tests and CI work without real keys
  providers.push(new StubAiAdapter());

  return providers;
}

function resolvePreferred(providers: AiModelAdapter[]): AiProviderKind {
  const first = providers[0];
  if (!first) return 'stub';
  return first.provider;
}

const providers = buildProviders();

export const pipeline = new ExtractionPipeline({
  providers,
  preferredProvider: resolvePreferred(providers),
  retryPolicy: {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 8000,
    backoffMultiplier: 2,
  },
  costBudget: {
    maxUsdPerCall: 0.05,
    maxTokensPerCall: 8192,
    maxCallsPerMinute: 60,
  },
  humanReviewThreshold: 0.55,
});

/** Returns the active primary provider name — useful for logging/metrics. */
export function activePrimaryProvider(): AiProviderKind {
  return resolvePreferred(providers);
}
