import { z } from 'zod';
import type {
  LocalModelInfo,
  ModelProbeResult,
  ProviderCapabilities,
  ProviderSettings,
} from '@pax-localia/domain';
import { normalizeProviderBaseUrl } from './network';
import { ensureResponseOk, request, responseJson } from './request';
import { jsonSchemaFor, parseStructuredValue } from './structured';
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

interface OllamaOptions {
  settings: ProviderSettings;
  fetch?: FetchTransport;
}

const tagsSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      model: z.string().optional(),
      size: z.number().optional(),
      details: z
        .object({
          format: z.string().optional(),
          family: z.string().optional(),
          parameter_size: z.string().optional(),
          quantization_level: z.string().optional(),
        })
        .optional(),
    }),
  ),
});

export class OllamaProvider implements LocalAIProvider {
  readonly id = 'ollama' as const;
  readonly displayName = 'Ollama';
  private readonly settings: ProviderSettings;
  private readonly fetchTransport: FetchTransport;
  private readonly baseUrl: string;

  constructor(options: OllamaOptions) {
    this.settings = options.settings;
    this.fetchTransport = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = normalizeProviderBaseUrl(
      options.settings.endpoint,
      'ollama',
      options.settings.allowLan,
    );
  }

  capabilities(): Promise<ProviderCapabilities> {
    return Promise.resolve({
      nativeModelApi: true,
      structuredOutput: true,
      streaming: true,
      modelLifecycle: false,
      tokenCounting: true,
    });
  }

  async listModels(signal?: AbortSignal): Promise<LocalModelInfo[]> {
    const { response } = await request({
      fetch: this.fetchTransport,
      url: `${this.baseUrl}/api/tags`,
      timeoutMs: Math.min(this.settings.timeoutMs, 15_000),
      ...(signal ? { signal } : {}),
    });
    await ensureResponseOk(response);
    const parsed = tagsSchema.safeParse(await responseJson(response));
    if (!parsed.success) {
      throw new LocalAIError(
        'MALFORMED_RESPONSE',
        'Ollama returned a malformed /api/tags response.',
      );
    }
    return parsed.data.models.map((model) => ({
      key: model.model ?? model.name,
      displayName: model.name,
      ...(model.details?.family ? { architecture: model.details.family } : {}),
      ...(model.details?.format
        ? {
            format:
              model.details.format.toLocaleLowerCase() === 'gguf'
                ? ('GGUF' as const)
                : ('other' as const),
          }
        : {}),
      ...(model.details?.quantization_level
        ? { quantization: model.details.quantization_level }
        : {}),
      ...(model.details?.parameter_size ? { parameterSize: model.details.parameter_size } : {}),
      ...(model.size !== undefined ? { sizeBytes: model.size } : {}),
      state: 'unloaded',
      kind: 'llm',
      capabilities: ['chat'],
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
            ? `Connected to Ollama; ${models.length} local model${models.length === 1 ? '' : 's'} found.`
            : 'Ollama is running but no local models are installed.',
        capabilities: await this.capabilities(),
      };
    } catch (error) {
      if (error instanceof LocalAIError) {
        return {
          ok: false,
          status: error.code === 'SERVER_UNAVAILABLE' ? 'not-detected' : 'error',
          message: `${error.message} ${error.help}`,
          capabilities: await this.capabilities(),
        };
      }
      throw error;
    }
  }

  private async chatRequest(
    body: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ payload: unknown; durationMs: number }> {
    const result = await request({
      fetch: this.fetchTransport,
      url: `${this.baseUrl}/api/chat`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      timeoutMs,
      ...(signal ? { signal } : {}),
    });
    await ensureResponseOk(result.response);
    return { payload: await responseJson(result.response), durationMs: result.durationMs };
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
      stream: false,
      format: jsonSchemaFor(generation.schema),
      options: {
        temperature: generation.temperature,
        num_predict: generation.maxOutputTokens,
      },
      keep_alive: this.settings.keepAlive ? '5m' : 0,
    };
    let raw = '';
    let durationMs = 0;
    try {
      const response = await this.chatRequest(body, generation.timeoutMs, signal);
      durationMs += response.durationMs;
      const parsed = z
        .object({
          message: z.object({ content: z.string() }),
          prompt_eval_count: z.number().optional(),
          eval_count: z.number().optional(),
          eval_duration: z.number().optional(),
        })
        .safeParse(response.payload);
      if (!parsed.success)
        throw new LocalAIError('MALFORMED_RESPONSE', 'Malformed Ollama chat response.');
      raw = parsed.data.message.content;
      const value = parseStructuredValue(raw, generation.schema).value;
      return {
        value,
        rawCharacterCount: raw.length,
        model: generation.model,
        durationMs,
        repaired: false,
        usage: {
          ...(parsed.data.prompt_eval_count !== undefined
            ? { promptTokens: parsed.data.prompt_eval_count }
            : {}),
          ...(parsed.data.eval_count !== undefined
            ? { completionTokens: parsed.data.eval_count }
            : {}),
          ...(parsed.data.eval_count && parsed.data.eval_duration
            ? {
                tokensPerSecond:
                  parsed.data.eval_count / (parsed.data.eval_duration / 1_000_000_000),
              }
            : {}),
        },
      };
    } catch (error) {
      if (
        !(error instanceof LocalAIError) ||
        !['MALFORMED_RESPONSE', 'SCHEMA_VALIDATION_FAILED'].includes(error.code)
      ) {
        throw error;
      }
      const repair = await this.chatRequest(
        {
          ...body,
          options: { temperature: 0, num_predict: generation.maxOutputTokens },
          messages: [
            ...(body.messages as { role: string; content: string }[]),
            { role: 'assistant', content: raw.slice(0, 12_000) },
            {
              role: 'user',
              content: `Return only corrected JSON. Validation error: ${error.message.slice(0, 2_000)}`,
            },
          ],
        },
        generation.timeoutMs,
        signal,
      );
      durationMs += repair.durationMs;
      const content = z
        .object({ message: z.object({ content: z.string() }) })
        .safeParse(repair.payload);
      if (!content.success) {
        throw new LocalAIError('SCHEMA_VALIDATION_FAILED', 'Ollama repair response was malformed.');
      }
      try {
        const value = parseStructuredValue(content.data.message.content, generation.schema).value;
        return {
          value,
          rawCharacterCount: content.data.message.content.length,
          model: generation.model,
          durationMs,
          repaired: true,
        };
      } catch {
        throw new LocalAIError(
          'SCHEMA_VALIDATION_FAILED',
          'The Ollama response remained invalid after one constrained repair.',
        );
      }
    }
  }

  async generateChat(
    generation: ChatGenerationRequest,
    signal?: AbortSignal,
  ): Promise<ChatGenerationResult> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, generation.timeoutMs);
    const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const started = performance.now();
    try {
      const response = await this.fetchTransport(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: generation.model,
          messages: generation.messages,
          stream: true,
          options: {
            temperature: generation.temperature,
            num_predict: generation.maxOutputTokens,
          },
          keep_alive: this.settings.keepAlive ? '5m' : 0,
        }),
        signal: controller.signal,
      });
      await ensureResponseOk(response);
      if (!response.body) throw new LocalAIError('STREAM_DISCONNECTED', 'Missing Ollama stream.');
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
          if (!line.trim()) continue;
          const parsed = z
            .object({
              message: z.object({ content: z.string() }).optional(),
              done: z.boolean().optional(),
              prompt_eval_count: z.number().optional(),
              eval_count: z.number().optional(),
              eval_duration: z.number().optional(),
            })
            .safeParse(JSON.parse(line));
          if (!parsed.success) continue;
          const delta = parsed.data.message?.content;
          if (delta) {
            text += delta;
            generation.onProgress?.({ phase: 'message', textDelta: delta });
          }
          if (parsed.data.done) {
            completed = true;
            usage = {
              ...(parsed.data.prompt_eval_count !== undefined
                ? { promptTokens: parsed.data.prompt_eval_count }
                : {}),
              ...(parsed.data.eval_count !== undefined
                ? { completionTokens: parsed.data.eval_count }
                : {}),
              ...(parsed.data.eval_count && parsed.data.eval_duration
                ? {
                    tokensPerSecond:
                      parsed.data.eval_count / (parsed.data.eval_duration / 1_000_000_000),
                  }
                : {}),
            };
            generation.onProgress?.({ phase: 'complete' });
          }
        }
      }
      if (!completed) {
        throw new LocalAIError('STREAM_DISCONNECTED', 'Ollama stream ended unexpectedly.');
      }
      return {
        text,
        model: generation.model,
        durationMs: performance.now() - started,
        ...(usage ? { usage } : {}),
      };
    } catch (error) {
      if (timedOut) throw new LocalAIError('TIMEOUT', 'Ollama generation timed out.');
      if (signal?.aborted) throw new LocalAIError('ABORTED', 'Ollama generation was cancelled.');
      if (error instanceof LocalAIError) throw error;
      throw new LocalAIError(
        'SERVER_UNAVAILABLE',
        `Ollama streaming failed: ${error instanceof Error ? error.message : 'network error'}`,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async probe(model: string, signal?: AbortSignal): Promise<ModelProbeResult> {
    const started = performance.now();
    let structuredOutput = false;
    let streaming = false;
    const messages: string[] = [];
    try {
      const result = await this.generateStructured(
        {
          model,
          schemaName: 'pax_localia_probe',
          schema: z.object({ ok: z.literal(true), value: z.number().int() }),
          system: 'Return only valid JSON.',
          user: 'Return {"ok":true,"value":7}.',
          temperature: 0,
          maxOutputTokens: 64,
          timeoutMs: Math.min(this.settings.timeoutMs, 60_000),
          retryCount: 0,
        },
        signal,
      );
      structuredOutput = result.value.value === 7;
      messages.push('Ollama JSON-schema response validated.');
      const chat = await this.generateChat(
        {
          model,
          messages: [{ role: 'user', content: 'Reply only OK.' }],
          temperature: 0,
          maxOutputTokens: 8,
          timeoutMs: Math.min(this.settings.timeoutMs, 60_000),
        },
        signal,
      );
      streaming = chat.text.length > 0;
      messages.push('Ollama streaming completed.');
    } catch (error) {
      messages.push(
        error instanceof LocalAIError
          ? `${error.code}: ${error.message} ${error.help}`
          : 'Probe failed.',
      );
    }
    const ready = structuredOutput && streaming;
    return {
      status: ready ? 'ready' : structuredOutput || streaming ? 'warning' : 'failed',
      connection: structuredOutput || streaming,
      authenticated: true,
      modelReady: structuredOutput || streaming,
      structuredOutput,
      streaming,
      contextLength: this.settings.contextLength,
      totalMs: performance.now() - started,
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
