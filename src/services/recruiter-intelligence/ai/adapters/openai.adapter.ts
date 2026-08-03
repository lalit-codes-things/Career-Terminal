import type { AiAdapterRequest, AiAdapterResponse, AiModelAdapter, AiProviderKind } from '../types';

/**
 * OpenAiAdapter — wraps the OpenAI Chat Completions API.
 * All provider-specific concerns are isolated here.
 * The pipeline only sees AiModelAdapter.
 */
export class OpenAiAdapter implements AiModelAdapter {
  readonly provider: AiProviderKind = 'openai';
  readonly supportedModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey: string; baseUrl?: string }) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
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
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new OpenAiAdapterError(
        `OpenAI API error ${response.status}: ${errorText}`,
        response.status,
        this.isRetryable(response.status),
      );
    }

    if (request.stream && request.onChunk) {
      return this.handleStream(response, request, start);
    }

    const data = (await response.json()) as OpenAiCompletionResponse;
    const choice = data.choices[0];
    if (!choice) throw new OpenAiAdapterError('No completion choice returned', 500, false);

    return {
      rawText: choice.message.content ?? '',
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      model: data.model,
      finishReason: choice.finish_reason === 'length' ? 'length' : 'stop',
      latencyMs: Date.now() - start,
    };
  }

  private async handleStream(
    response: Response,
    request: AiAdapterRequest,
    start: number,
  ): Promise<AiAdapterResponse> {
    if (!response.body) throw new OpenAiAdapterError('No response body for stream', 500, false);

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
          const parsed = JSON.parse(raw) as OpenAiStreamChunk;
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

export class OpenAiAdapterError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'OpenAiAdapterError';
  }
}

// ─── Response shapes ──────────────────────────────────────────────────────────

interface OpenAiCompletionResponse {
  model: string;
  choices: Array<{
    message: { content: string | null };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface OpenAiStreamChunk {
  model?: string;
  choices: Array<{ delta?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
