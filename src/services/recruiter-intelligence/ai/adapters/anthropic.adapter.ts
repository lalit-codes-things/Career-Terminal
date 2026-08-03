import type { AiAdapterRequest, AiAdapterResponse, AiModelAdapter, AiProviderKind } from '../types';

/**
 * AnthropicAdapter — wraps the Anthropic Messages API.
 * All provider-specific concerns are isolated here.
 */
export class AnthropicAdapter implements AiModelAdapter {
  readonly provider: AiProviderKind = 'anthropic';
  readonly supportedModels = [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-haiku-20240307',
  ];

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly apiVersion = '2023-06-01';

  constructor(options: { apiKey: string; baseUrl?: string }) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.anthropic.com/v1';
  }

  async complete(request: AiAdapterRequest): Promise<AiAdapterResponse> {
    const start = Date.now();

    const body: AnthropicRequest = {
      model: request.model,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.userPrompt }],
      stream: request.stream ?? false,
    };

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AnthropicAdapterError(
        `Anthropic API error ${response.status}: ${errorText}`,
        response.status,
        this.isRetryable(response.status),
      );
    }

    if (request.stream && request.onChunk) {
      return this.handleStream(response, request, start);
    }

    const data = (await response.json()) as AnthropicResponse;
    const textBlock = data.content.find((b) => b.type === 'text');

    return {
      rawText: textBlock?.text ?? '',
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      model: data.model,
      finishReason: data.stop_reason === 'max_tokens' ? 'length' : 'stop',
      latencyMs: Date.now() - start,
    };
  }

  private async handleStream(
    response: Response,
    request: AiAdapterRequest,
    start: number,
  ): Promise<AiAdapterResponse> {
    if (!response.body) throw new AnthropicAdapterError('No stream body', 500, false);

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
      const lines = text.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        try {
          const event = JSON.parse(raw) as AnthropicStreamEvent;
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const delta = event.delta.text ?? '';
            accumulated += delta;
            request.onChunk?.({ chunkIndex: chunkIndex++, delta, finished: false });
          }
          if (event.type === 'message_delta' && event.usage) {
            outputTokens = event.usage.output_tokens ?? 0;
          }
          if (event.type === 'message_start' && event.message) {
            model = event.message.model ?? model;
            inputTokens = event.message.usage?.input_tokens ?? 0;
          }
          if (event.type === 'message_stop') {
            request.onChunk?.({ chunkIndex, delta: '', finished: true });
          }
        } catch {
          // skip malformed events
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
    return statusCode === 429 || statusCode === 500 || statusCode === 529;
  }
}

export class AnthropicAdapterError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AnthropicAdapterError';
  }
}

// ─── Request/Response shapes ──────────────────────────────────────────────────

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  temperature: number;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  stream: boolean;
}

interface AnthropicResponse {
  model: string;
  content: Array<{ type: string; text?: string }>;
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
}

interface AnthropicStreamEvent {
  type: string;
  delta?: { type: string; text?: string };
  usage?: { output_tokens?: number };
  message?: {
    model?: string;
    usage?: { input_tokens?: number };
  };
}
