import type { AiAdapterRequest, AiAdapterResponse, AiModelAdapter, AiProviderKind } from '../types';

/**
 * OpenRouterAdapter — fallback provider via OpenRouter.
 *
 * OpenRouter unifies 100+ models behind a single OpenAI-compatible API.
 * We default to DeepSeek-V3 through OpenRouter so we can fail over from
 * direct DeepSeek without changing model logic.  Callers can override the
 * model per-request through the ExtractionPipeline providerOverride mechanism.
 *
 * Docs: https://openrouter.ai/docs
 */
export class OpenRouterAdapter implements AiModelAdapter {
  readonly provider: AiProviderKind = 'openrouter';
  readonly supportedModels = [
    'deepseek/deepseek-chat',          // fast  — mirrors primary
    'deepseek/deepseek-r1',            // powerful
    'meta-llama/llama-3.3-70b-instruct', // balanced fallback
    'google/gemini-flash-1.5',         // cheap / fast
  ];

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly siteUrl: string;
  private readonly siteName: string;

  constructor(options: {
    apiKey: string;
    baseUrl?: string;
    siteUrl?: string;
    siteName?: string;
  }) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://openrouter.ai/api/v1';
    this.siteUrl = options.siteUrl ?? 'https://career-terminal.app';
    this.siteName = options.siteName ?? 'CareerTerminal';
  }

  async complete(request: AiAdapterRequest): Promise<AiAdapterResponse> {
    const start = Date.now();

    const body = {
      model: request.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: request.stream ?? false,
      response_format: { type: 'json_object' },
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': this.siteUrl,
        'X-Title': this.siteName,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new OpenRouterAdapterError(
        `OpenRouter API error ${response.status}: ${errorText}`,
        response.status,
        this.isRetryable(response.status),
      );
    }

    if (request.stream && request.onChunk) {
      return this.handleStream(response, request, start);
    }

    const data = (await response.json()) as OpenRouterCompletionResponse;
    const choice = data.choices[0];
    if (!choice) throw new OpenRouterAdapterError('No completion choice returned', 500, false);

    return {
      rawText: choice.message.content ?? '',
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      model: data.model ?? request.model,
      finishReason: choice.finish_reason === 'length' ? 'length' : 'stop',
      latencyMs: Date.now() - start,
    };
  }

  private async handleStream(
    response: Response,
    request: AiAdapterRequest,
    start: number,
  ): Promise<AiAdapterResponse> {
    if (!response.body) throw new OpenRouterAdapterError('No stream body', 500, false);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    let chunkIndex = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let model = request.model;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n').filter((l) => l.startsWith('data: '));

      for (const line of lines) {
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') {
          request.onChunk?.({ chunkIndex, delta: '', finished: true });
          continue;
        }
        try {
          const parsed = JSON.parse(raw) as OpenRouterStreamChunk;
          model = parsed.model ?? model;
          const delta = parsed.choices[0]?.delta?.content ?? '';
          if (delta) {
            accumulated += delta;
            request.onChunk?.({ chunkIndex: chunkIndex++, delta, finished: false });
          }
          if (parsed.usage) {
            inputTokens = parsed.usage.prompt_tokens ?? 0;
            outputTokens = parsed.usage.completion_tokens ?? 0;
          }
        } catch {
          // malformed SSE chunk — skip
        }
      }
    }

    return {
      rawText: accumulated,
      inputTokens,
      outputTokens,
      model,
      finishReason: 'stop',
      latencyMs: Date.now() - start,
    };
  }

  private isRetryable(statusCode: number): boolean {
    return statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503;
  }
}

export class OpenRouterAdapterError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'OpenRouterAdapterError';
  }
}

// ─── Response shapes ──────────────────────────────────────────────────────────

interface OpenRouterCompletionResponse {
  model?: string;
  choices: Array<{
    message: { content: string | null };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface OpenRouterStreamChunk {
  model?: string;
  choices: Array<{ delta?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
