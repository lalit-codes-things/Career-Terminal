/**
 * pipeline.factory.ts — Composition root for the AI extraction pipeline.
 *
 * OpenRouter is the single LLM gateway. Provider-agnostic by design:
 * OpenRouter unifies 100+ models behind one OpenAI-compatible API.
 *
 * The Stub adapter is always registered so tests and local dev work without
 * real API keys.
 */

import { ExtractionPipeline } from './extraction-pipeline';
import type { AiModelAdapter, AiProviderKind } from './types';
import { OpenRouterAdapter } from './adapters/openrouter.adapter';
import { StubAiAdapter } from './adapters/stub.adapter';
import { buildDefaultTemplates } from './prompt-manager';

function buildProviders(): AiModelAdapter[] {
  const providers: AiModelAdapter[] = [];

  const openrouterKey = process.env['OPENROUTER_API_KEY'];
  if (openrouterKey) {
    providers.push(
      new OpenRouterAdapter({
        apiKey: openrouterKey,
        baseUrl: process.env['OPENROUTER_BASE_URL'],
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

// Register all built-in prompt templates so the pipeline is ready to use
for (const template of buildDefaultTemplates()) {
  pipeline.getPromptManager().register(template);
}

/** Returns the active primary provider name — useful for logging/metrics. */
export function activePrimaryProvider(): AiProviderKind {
  return resolvePreferred(providers);
}
