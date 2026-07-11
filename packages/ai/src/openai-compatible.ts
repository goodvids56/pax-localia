import { z } from 'zod';
import type {
  LocalModelInfo,
  ModelProbeResult,
  ProviderCapabilities,
  ProviderSettings,
} from '@pax-localia/domain';
import { normalizeProviderBaseUrl } from './network';
import { authorizationHeaders, ensureResponseOk, request, responseJson } from './request';
import {
  contentFromOpenAIResponse,
  jsonSchemaFor,
  parseStructuredValue,
  usageFromOpenAIResponse,
} from './structured';
import {
  LocalAIError,
  type ChatGenerationRequest,
  type ChatGenerationResult,
  type FetchTransport,
  type HealthResult,
  type LocalAIProvider,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
} from './types';

interface OpenAIClientOptions {
  id?: 'openai-compatible' | 'lm-studio';
  displayName?: string;
  settings: ProviderSettings;
  token?: string;
  fetch?: FetchTransport;
}

const modelListSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string(),
        object: z.string().optional(),
        type: z.string().optional(),
        owned_by: z.string().optional(),
        max_context_length: z.number().optional(),
        context_length: z.number().optional(),
      })
      .passthrough(),
  ),
});

export class OpenAICompatibleProvider implements LocalAIProvider {
  readonly id: 'openai-compatible' | 'lm-studio';
  readonly displayName: string;
  protected readonly settings: ProviderSettings;
  protected readonly token: string | undefined;
  protected readonly fetchTransport: FetchTransport;
  protected readonly baseUrl: string;

  constructor(options: OpenAIClientOptions) {
    this.id = options.id ?? 'openai-compatible';
    this.displayName = options.displayName ?? 'Local OpenAI-compatible server';
    this.settings = options.settings;
    this.token = options.token;
    this.fetchTransport = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = normalizeProviderBaseUrl(
      options.settings.endpoint,
      this.id === 'lm-studio' ? 'lm-studio' : 'openai-compatible',
      options.settings.allowLan,
    );
  }

  capabilities(): Promise<ProviderCapabilities> {
    return Promise.resolve({
      nativeModelApi: false,
      structuredOutput: true,
      streaming: true,
      modelLifecycle: false,
      tokenCounting: false,
    });
  }

  async listModels(signal?: AbortSignal): Promise<LocalModelInfo[]> {
    const { response } = await request({
      fetch: this.fetchTransport,
      url: `${this.baseUrl}/v1/models`,
      init: { headers: authorizationHeaders(this.token) },
      timeoutMs: Math.min(this.settings.timeoutMs, 15_000),
      ...(signal ? { signal } : {}),
    });
    await ensureResponseOk(response);
    const payload = modelListSchema.safeParse(await responseJson(response));
    if (!payload.success) {
      throw new LocalAIError('MALFORMED_RESPONSE', 'The /v1/models response was malformed.');
    }
    return payload.data.data
      .filter((model) => model.type !== 'embedding')
      .map((model) => ({
        key: model.id,
        displayName: model.id,
        ...(model.owned_by ? { publisher: model.owned_by } : {}),
        state: 'unknown' as const,
        ...(model.context_length ? { contextLength: model.context_length } : {}),
        ...(model.max_context_length ? { maxContextLength: model.max_context_length } : {}),
        kind: model.type === 'vision' ? ('vision' as const) : ('unknown' as const),
        capabilities: model.type === 'vision' ? (['chat', 'vision'] as const) : (['chat'] as const),
        loadConfig: {},
      }));
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthResult> {
    try {
      const models = await this.listModels(signal);
      return {
        ok: models.length > 0,
        status: models.length > 0 ? 'ready' : 'no-models',
        message:
          models.length > 0
            ? `Connected to ${this.displayName}; ${models.length} model${models.length === 1 ? '' : 's'} reported.`
            : 'Connected, but the server reported no chat models.',
        capabilities: await this.capabilities(),
      };
    } catch (error) {
      if (error instanceof LocalAIError) {
        return {
          ok: false,
          status:
            error.code === 'AUTHENTICATION_REQUIRED'
              ? 'authentication-required'
              : error.code === 'SERVER_UNAVAILABLE'
                ? 'not-detected'
                : 'error',
          message: `${error.message} ${error.help}`,
          capabilities: await this.capabilities(),
        };
      }
      throw error;
    }
  }

  protected async completion(
    body: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ payload: unknown; durationMs: number }> {
    const { response, durationMs } = await request({
      fetch: this.fetchTransport,
      url: `${this.baseUrl}/v1/chat/completions`,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authorizationHeaders(this.token),
        },
        body: JSON.stringify(body),
      },
      timeoutMs,
      ...(signal ? { signal } : {}),
    });
    await ensureResponseOk(response);
    return { payload: await responseJson(response), durationMs };
  }

  async generateStructured<T>(
    generation: StructuredGenerationRequest<T>,
    signal?: AbortSignal,
  ): Promise<StructuredGenerationResult<T>> {
    const body = {
      model: generation.model,
      messages: [
        { role: 'system', content: generation.system },
        { role: 'user', content: generation.user },
      ],
      temperature: generation.temperature,
      max_tokens: generation.maxOutputTokens,
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: generation.schemaName.replaceAll(/[^a-z0-9_-]/gi, '_').slice(0, 64),
          strict: true,
          schema: jsonSchemaFor(generation.schema),
        },
      },
    };

    let raw = '';
    let initialError: LocalAIError | undefined;
    let totalDuration = 0;
    for (let networkAttempt = 0; networkAttempt <= generation.retryCount; networkAttempt += 1) {
      try {
        const response = await this.completion(body, generation.timeoutMs, signal);
        totalDuration += response.durationMs;
        raw = contentFromOpenAIResponse(response.payload);
        const parsed = parseStructuredValue(raw, generation.schema);
        return {
          value: parsed.value,
          rawCharacterCount: raw.length,
          model: generation.model,
          durationMs: totalDuration,
          repaired: false,
          usage: usageFromOpenAIResponse(response.payload),
        };
      } catch (error) {
        const providerError =
          error instanceof LocalAIError
            ? error
            : new LocalAIError('HTTP_ERROR', 'Unknown local provider error.');
        initialError = providerError;
        if (!providerError.retryable || networkAttempt >= generation.retryCount) break;
      }
    }

    if (
      initialError?.code !== 'MALFORMED_RESPONSE' &&
      initialError?.code !== 'SCHEMA_VALIDATION_FAILED'
    ) {
      throw initialError ?? new LocalAIError('MALFORMED_RESPONSE', 'Structured response failed.');
    }

    const repairBody = {
      ...body,
      temperature: 0,
      messages: [
        ...(body.messages as { role: string; content: string }[]),
        {
          role: 'assistant',
          content: raw.slice(0, 12_000),
        },
        {
          role: 'user',
          content:
            `Return only corrected JSON matching the supplied schema. Validation error: ` +
            initialError.message.slice(0, 2_000),
        },
      ],
    };
    const repairedResponse = await this.completion(repairBody, generation.timeoutMs, signal);
    totalDuration += repairedResponse.durationMs;
    const repairedRaw = contentFromOpenAIResponse(repairedResponse.payload);
    try {
      const parsed = parseStructuredValue(repairedRaw, generation.schema);
      return {
        value: parsed.value,
        rawCharacterCount: repairedRaw.length,
        model: generation.model,
        durationMs: totalDuration,
        repaired: true,
        usage: usageFromOpenAIResponse(repairedResponse.payload),
      };
    } catch {
      throw new LocalAIError(
        'SCHEMA_VALIDATION_FAILED',
        'The local model response remained invalid after one constrained repair.',
      );
    }
  }

  async generateChat(
    generation: ChatGenerationRequest,
    signal?: AbortSignal,
  ): Promise<ChatGenerationResult> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, generation.timeoutMs);
    const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const started = performance.now();
    let response: Response;
    try {
      response = await this.fetchTransport(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authorizationHeaders(this.token),
        },
        body: JSON.stringify({
          model: generation.model,
          messages: generation.messages,
          temperature: generation.temperature,
          max_tokens: generation.maxOutputTokens,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: controller.signal,
      });
      await ensureResponseOk(response);
      if (!response.body) {
        throw new LocalAIError('STREAM_DISCONNECTED', 'The response had no streaming body.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      let completed = false;
      let usage: ChatGenerationResult['usage'];

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            completed = true;
            generation.onProgress?.({ phase: 'complete' });
            continue;
          }
          if (!data) continue;
          let payload: unknown;
          try {
            payload = JSON.parse(data);
          } catch {
            continue;
          }
          const parsed = z
            .object({
              choices: z
                .array(
                  z.object({
                    delta: z
                      .object({
                        content: z.string().optional(),
                        reasoning_content: z.string().optional(),
                      })
                      .optional(),
                  }),
                )
                .optional(),
              usage: z
                .object({
                  prompt_tokens: z.number().optional(),
                  completion_tokens: z.number().optional(),
                  tokens_per_second: z.number().optional(),
                })
                .optional(),
            })
            .safeParse(payload);
          if (!parsed.success) continue;
          const delta = parsed.data.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            generation.onProgress?.({ phase: 'reasoning' });
          }
          if (delta?.content) {
            text += delta.content;
            generation.onProgress?.({ phase: 'message', textDelta: delta.content });
          }
          if (parsed.data.usage) {
            usage = {
              ...(parsed.data.usage.prompt_tokens !== undefined
                ? { promptTokens: parsed.data.usage.prompt_tokens }
                : {}),
              ...(parsed.data.usage.completion_tokens !== undefined
                ? { completionTokens: parsed.data.usage.completion_tokens }
                : {}),
              ...(parsed.data.usage.tokens_per_second !== undefined
                ? { tokensPerSecond: parsed.data.usage.tokens_per_second }
                : {}),
            };
          }
        }
      }
      if (!completed) {
        throw new LocalAIError(
          'STREAM_DISCONNECTED',
          'The local provider stream ended before its completion marker.',
          undefined,
          true,
        );
      }
      return {
        text,
        model: generation.model,
        durationMs: performance.now() - started,
        ...(usage ? { usage } : {}),
      };
    } catch (error) {
      if (timedOut) {
        throw new LocalAIError(
          'TIMEOUT',
          `Local provider timed out after ${generation.timeoutMs} ms.`,
        );
      }
      if (signal?.aborted) throw new LocalAIError('ABORTED', 'Local generation was cancelled.');
      if (error instanceof LocalAIError) throw error;
      throw new LocalAIError(
        'SERVER_UNAVAILABLE',
        `Local streaming failed: ${error instanceof Error ? error.message : 'network error'}`,
        undefined,
        true,
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  async probe(model: string, signal?: AbortSignal): Promise<ModelProbeResult> {
    const started = performance.now();
    const messages: string[] = [];
    let structuredOutput = false;
    let streaming = false;
    let firstTokenMs: number | undefined;
    let generatedUsage: StructuredGenerationResult<{ ok: true; value: number }>['usage'];
    try {
      const schema = z.object({ ok: z.literal(true), value: z.number().int() });
      const result = await this.generateStructured(
        {
          model,
          schemaName: 'pax_localia_probe',
          schema,
          system: 'Return the requested tiny JSON object. No prose.',
          user: 'Return {"ok":true,"value":7}.',
          temperature: 0,
          maxOutputTokens: 64,
          timeoutMs: Math.min(this.settings.timeoutMs, 60_000),
          retryCount: 0,
        },
        signal,
      );
      structuredOutput = result.value.value === 7;
      generatedUsage = result.usage;
      messages.push('Strict JSON-schema response validated.');

      const streamStart = performance.now();
      const chat = await this.generateChat(
        {
          model,
          messages: [
            { role: 'system', content: 'Reply with only OK.' },
            { role: 'user', content: 'Ready?' },
          ],
          temperature: 0,
          maxOutputTokens: 8,
          timeoutMs: Math.min(this.settings.timeoutMs, 60_000),
          onProgress: (progress) => {
            if (progress.phase === 'message' && firstTokenMs === undefined) {
              firstTokenMs = performance.now() - streamStart;
            }
          },
        },
        signal,
      );
      streaming = chat.text.length > 0;
      messages.push('Streaming response completed.');
    } catch (error) {
      const providerError =
        error instanceof LocalAIError
          ? error
          : new LocalAIError('HTTP_ERROR', 'Unknown probe failure.');
      messages.push(`${providerError.code}: ${providerError.message} ${providerError.help}`);
    }
    const totalMs = performance.now() - started;
    const ready = structuredOutput && streaming;
    return {
      status: ready ? 'ready' : structuredOutput || streaming ? 'warning' : 'failed',
      connection: structuredOutput || streaming,
      authenticated: true,
      modelReady: structuredOutput || streaming,
      structuredOutput,
      streaming,
      contextLength: this.settings.contextLength,
      ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
      totalMs,
      ...(generatedUsage?.tokensPerSecond !== undefined
        ? { tokensPerSecond: generatedUsage.tokensPerSecond }
        : {}),
      suitability: {
        simulation: structuredOutput,
        diplomacy: streaming,
        advisor: streaming,
        summarization: structuredOutput || streaming,
      },
      messages,
      testedAt: new Date().toISOString(),
    };
  }
}
