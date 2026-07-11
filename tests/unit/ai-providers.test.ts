import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AppSettingsSchema,
  ProviderSettingsSchema,
  ScenarioSchema,
  TurnProposalSchema,
  WorldStateSchema,
  type ProviderSettings,
} from '@pax-localia/domain';
import {
  DeterministicLocalProvider,
  LMStudioProvider,
  LocalAIError,
  OllamaProvider,
  OpenAICompatibleProvider,
  assembleTurnContext,
  classifyEndpoint,
  normalizeProviderBaseUrl,
  parseStructuredValue,
  sanitizeDiagnosticValue,
  stripMarkdownJsonFence,
  type FetchTransport,
} from '@pax-localia/ai';

const nativeModels = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests/fixtures/lm-native-models.json'), 'utf8'),
) as unknown;

function settings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return ProviderSettingsSchema.parse({
    type: 'lm-studio',
    endpoint: 'http://127.0.0.1:1234',
    model: 'publisher/atlas-8b-q4',
    allowLan: false,
    hasStoredToken: false,
    contextLength: 8192,
    temperature: 0.2,
    maxOutputTokens: 512,
    timeoutMs: 2_000,
    retries: 0,
    keepAlive: true,
    loadConfig: {},
    ...overrides,
  });
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function completion(content: string, usage?: unknown): Response {
  return json({
    choices: [{ message: { content } }],
    ...(usage ? { usage } : {}),
  });
}

function stream(lines: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        lines.forEach((line) => controller.enqueue(encoder.encode(`${line}\n`)));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

describe('provider endpoint policy', () => {
  it('normalizes LM Studio paths without doubled API segments', () => {
    expect(normalizeProviderBaseUrl('http://127.0.0.1:1234/api/v1/', 'lm-studio', false)).toBe(
      'http://127.0.0.1:1234',
    );
    expect(normalizeProviderBaseUrl('http://localhost:1234/v1', 'lm-studio', false)).toBe(
      'http://localhost:1234',
    );
  });

  it('blocks public and unapproved LAN endpoints', () => {
    expect(classifyEndpoint('http://127.0.0.1:1234', false)).toBe('loopback');
    expect(classifyEndpoint('http://192.168.1.20:1234', false)).toBe('blocked');
    expect(classifyEndpoint('http://192.168.1.20:1234', true)).toBe('approved-lan');
    expect(classifyEndpoint('https://api.example.com', true)).toBe('blocked');
    expect(
      () =>
        new LMStudioProvider({
          settings: settings({ endpoint: 'https://api.example.com', allowLan: true }),
        }),
    ).toThrow(LocalAIError);
  });

  it('rejects credentials and query strings in endpoint URLs', () => {
    expect(() =>
      normalizeProviderBaseUrl('http://user:secret@127.0.0.1:1234?token=bad', 'lm-studio', false),
    ).toThrow(/cannot contain credentials/);
  });
});

describe('LM Studio model discovery', () => {
  it('normalizes native GGUF and MLX metadata and excludes embedding models', async () => {
    const fetch = vi.fn<FetchTransport>(async () => json(nativeModels));
    const provider = new LMStudioProvider({ settings: settings(), fetch });
    const models = await provider.listModels();
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      key: 'publisher/atlas-8b-q4',
      format: 'GGUF',
      quantization: 'Q4_K_M',
      state: 'loaded',
      instanceId: 'instance-atlas',
      contextLength: 8192,
      maxContextLength: 131072,
    });
    expect(models[0]?.capabilities).toContain('reasoning');
    expect(models[1]).toMatchObject({
      key: 'publisher/cascade-12b-mlx',
      format: 'MLX',
      state: 'unloaded',
    });
    expect((await provider.capabilities()).modelLifecycle).toBe(true);
  });

  it('falls back to /v1/models when the native API is absent', async () => {
    const urls: string[] = [];
    const fetch: FetchTransport = async (input) => {
      const url = String(input);
      urls.push(url);
      return url.endsWith('/api/v1/models')
        ? json({ error: 'not found' }, 404)
        : json({ data: [{ id: 'local-chat', owned_by: 'local' }] });
    };
    const provider = new LMStudioProvider({ settings: settings(), fetch });
    expect((await provider.listModels()).map((model) => model.key)).toEqual(['local-chat']);
    expect(urls).toEqual([
      'http://127.0.0.1:1234/api/v1/models',
      'http://127.0.0.1:1234/v1/models',
    ]);
    expect((await provider.capabilities()).nativeModelApi).toBe(false);
  });

  it('distinguishes an authentication challenge', async () => {
    const provider = new LMStudioProvider({
      settings: settings(),
      fetch: async () => json({ error: { message: 'token required' } }, 401),
    });
    const health = await provider.healthCheck();
    expect(health.status).toBe('authentication-required');
    expect(health.message).toContain('Enter the local server token');
  });

  it('uses bearer authentication without exposing it in a model result', async () => {
    let authorization = '';
    const provider = new LMStudioProvider({
      settings: settings(),
      token: 'private-local-token',
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get('Authorization') ?? '';
        return json(nativeModels);
      },
    });
    const models = await provider.listModels();
    expect(authorization).toBe('Bearer private-local-token');
    expect(JSON.stringify(models)).not.toContain('private-local-token');
  });

  it('supports explicit load and unload while refreshing instance state', async () => {
    const calls: string[] = [];
    const fetch: FetchTransport = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/load') || url.endsWith('/unload')) return json({ ok: true });
      return json(nativeModels);
    };
    const provider = new LMStudioProvider({ settings: settings(), fetch });
    await provider.listModels();
    await provider.loadModel('publisher/cascade-12b-mlx', {
      contextLength: 4096,
      flashAttention: true,
    });
    await provider.unloadModel('instance-atlas');
    expect(calls).toContain('POST http://127.0.0.1:1234/api/v1/models/load');
    expect(calls).toContain('POST http://127.0.0.1:1234/api/v1/models/unload');
  });

  it('maps native model load failures to a typed error', async () => {
    const fetch: FetchTransport = async (input) =>
      String(input).endsWith('/load')
        ? json({ error: { message: 'insufficient GPU memory' } }, 500)
        : json(nativeModels);
    const provider = new LMStudioProvider({ settings: settings(), fetch });
    await provider.listModels();
    await expect(provider.loadModel('publisher/cascade-12b-mlx', {})).rejects.toMatchObject({
      code: 'MODEL_LOAD_FAILED',
    });
  });
});

describe('structured output and streaming', () => {
  const tinySchema = z.object({ ok: z.literal(true), value: z.number().int() });

  it('validates strict JSON schema output and reported usage', async () => {
    const provider = new OpenAICompatibleProvider({
      settings: settings({ type: 'openai-compatible' }),
      fetch: async () =>
        completion('{"ok":true,"value":7}', {
          prompt_tokens: 12,
          completion_tokens: 8,
          tokens_per_second: 22,
        }),
    });
    const result = await provider.generateStructured({
      model: 'local-chat',
      schemaName: 'tiny',
      schema: tinySchema,
      system: 'JSON only.',
      user: 'Return seven.',
      temperature: 0,
      maxOutputTokens: 64,
      timeoutMs: 1_000,
      retryCount: 0,
    });
    expect(result.value).toEqual({ ok: true, value: 7 });
    expect(result.usage).toEqual({
      promptTokens: 12,
      completionTokens: 8,
      tokensPerSecond: 22,
    });
  });

  it('strips only an obvious markdown JSON fence', () => {
    expect(stripMarkdownJsonFence('```json\n{"ok":true,"value":7}\n```')).toBe(
      '{"ok":true,"value":7}',
    );
    expect(parseStructuredValue('```json\n{"ok":true,"value":7}\n```', tinySchema).value).toEqual({
      ok: true,
      value: 7,
    });
    expect(() => parseStructuredValue('before {"ok":true}', tinySchema)).toThrow(/invalid JSON/);
  });

  it('performs one constrained repair when valid JSON violates the schema', async () => {
    let requests = 0;
    const provider = new OpenAICompatibleProvider({
      settings: settings({ type: 'openai-compatible' }),
      fetch: async () => {
        requests += 1;
        return completion(requests === 1 ? '{"ok":true,"value":"wrong"}' : '{"ok":true,"value":7}');
      },
    });
    const result = await provider.generateStructured({
      model: 'local-chat',
      schemaName: 'tiny',
      schema: tinySchema,
      system: 'JSON only.',
      user: 'Return seven.',
      temperature: 0.4,
      maxOutputTokens: 64,
      timeoutMs: 1_000,
      retryCount: 0,
    });
    expect(result.repaired).toBe(true);
    expect(result.value.value).toBe(7);
    expect(requests).toBe(2);
  });

  it('never returns a still-invalid repair', async () => {
    const provider = new OpenAICompatibleProvider({
      settings: settings({ type: 'openai-compatible' }),
      fetch: async () => completion('{"ok":true,"value":"wrong"}'),
    });
    await expect(
      provider.generateStructured({
        model: 'local-chat',
        schemaName: 'tiny',
        schema: tinySchema,
        system: 'JSON only.',
        user: 'Return seven.',
        temperature: 0,
        maxOutputTokens: 64,
        timeoutMs: 1_000,
        retryCount: 0,
      }),
    ).rejects.toMatchObject({ code: 'SCHEMA_VALIDATION_FAILED' });
  });

  it('assembles streamed text and discards separated reasoning content', async () => {
    const phases: string[] = [];
    const provider = new OpenAICompatibleProvider({
      settings: settings({ type: 'openai-compatible' }),
      fetch: async () =>
        stream([
          'data: {"choices":[{"delta":{"reasoning_content":"private thought"}}]}',
          'data: {"choices":[{"delta":{"content":"Public"}}]}',
          'data: {"choices":[{"delta":{"content":" answer"}}]}',
          'data: [DONE]',
        ]),
    });
    const result = await provider.generateChat({
      model: 'local-chat',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0,
      maxOutputTokens: 20,
      timeoutMs: 1_000,
      onProgress: (progress) => phases.push(progress.phase),
    });
    expect(result.text).toBe('Public answer');
    expect(result.text).not.toContain('private thought');
    expect(phases).toContain('reasoning');
    expect(phases).toContain('complete');
  });

  it('reports a disconnected stream and supports abort/timeout', async () => {
    const disconnected = new OpenAICompatibleProvider({
      settings: settings({ type: 'openai-compatible' }),
      fetch: async () => stream(['data: {"choices":[{"delta":{"content":"partial"}}]}']),
    });
    await expect(
      disconnected.generateChat({
        model: 'local-chat',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0,
        maxOutputTokens: 20,
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'STREAM_DISCONNECTED' });

    const hangingFetch: FetchTransport = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      });
    const hanging = new OpenAICompatibleProvider({
      settings: settings({ type: 'openai-compatible' }),
      fetch: hangingFetch,
    });
    await expect(
      hanging.generateStructured({
        model: 'local-chat',
        schemaName: 'tiny',
        schema: tinySchema,
        system: 'JSON',
        user: 'JSON',
        temperature: 0,
        maxOutputTokens: 10,
        timeoutMs: 10,
        retryCount: 0,
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });

    const controller = new AbortController();
    const aborted = hanging.generateStructured(
      {
        model: 'local-chat',
        schemaName: 'tiny',
        schema: tinySchema,
        system: 'JSON',
        user: 'JSON',
        temperature: 0,
        maxOutputTokens: 10,
        timeoutMs: 1_000,
        retryCount: 0,
      },
      controller.signal,
    );
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ code: 'ABORTED' });
  });
});

describe('Ollama and deterministic fallback providers', () => {
  it('discovers Ollama metadata and resolves structured JSON', async () => {
    const fetch: FetchTransport = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return json({
          models: [
            {
              name: 'local-instruct:latest',
              size: 4_000_000_000,
              details: {
                format: 'gguf',
                family: 'local-family',
                parameter_size: '7B',
                quantization_level: 'Q4_K_M',
              },
            },
          ],
        });
      }
      return json({
        message: { content: '{"ok":true,"value":7}' },
        prompt_eval_count: 10,
        eval_count: 5,
        eval_duration: 1_000_000_000,
      });
    };
    const provider = new OllamaProvider({
      settings: settings({
        type: 'ollama',
        endpoint: 'http://127.0.0.1:11434',
        model: 'local-instruct:latest',
      }),
      fetch,
    });
    expect(await provider.listModels()).toEqual([
      expect.objectContaining({
        key: 'local-instruct:latest',
        format: 'GGUF',
        architecture: 'local-family',
        quantization: 'Q4_K_M',
      }),
    ]);
    expect((await provider.healthCheck()).status).toBe('ready');
    const result = await provider.generateStructured({
      model: 'local-instruct:latest',
      schemaName: 'tiny',
      schema: z.object({ ok: z.literal(true), value: z.number() }),
      system: 'JSON',
      user: 'Seven',
      temperature: 0,
      maxOutputTokens: 20,
      timeoutMs: 1_000,
      retryCount: 0,
    });
    expect(result.value.value).toBe(7);
    expect(result.usage?.tokensPerSecond).toBe(5);
  });

  it('streams Ollama NDJSON and detects completion', async () => {
    const encoder = new TextEncoder();
    const provider = new OllamaProvider({
      settings: settings({
        type: 'ollama',
        endpoint: 'http://127.0.0.1:11434',
      }),
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `${JSON.stringify({ message: { content: 'Local ' }, done: false })}\n`,
                ),
              );
              controller.enqueue(
                encoder.encode(
                  `${JSON.stringify({
                    message: { content: 'reply' },
                    done: true,
                    eval_count: 2,
                    eval_duration: 1_000_000_000,
                  })}\n`,
                ),
              );
              controller.close();
            },
          }),
        ),
    });
    const result = await provider.generateChat({
      model: 'local',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0,
      maxOutputTokens: 10,
      timeoutMs: 1_000,
    });
    expect(result.text).toBe('Local reply');
    expect(result.usage?.tokensPerSecond).toBe(2);
  });

  it('provides an honest no-network deterministic fallback', async () => {
    const provider = new DeterministicLocalProvider();
    expect((await provider.healthCheck()).status).toBe('ready');
    expect(await provider.listModels()).toEqual([
      expect.objectContaining({ key: 'deterministic-rules-v1', state: 'loaded' }),
    ]);
    const risk = await provider.generateChat({
      model: 'deterministic-rules-v1',
      messages: [{ role: 'user', content: 'What are my biggest risks?' }],
      temperature: 0,
      maxOutputTokens: 10,
      timeoutMs: 10,
    });
    expect(risk.text).toContain('Deterministic assessment');
    expect((await provider.probe()).suitability.simulation).toBe(true);
    await expect(
      provider.generateStructured({
        model: 'deterministic-rules-v1',
        schemaName: 'turn',
        schema: z.object({}),
        system: '',
        user: '',
        temperature: 0,
        maxOutputTokens: 10,
        timeoutMs: 10,
        retryCount: 0,
      }),
    ).rejects.toMatchObject({ code: 'STRUCTURED_OUTPUT_UNSUPPORTED' });
  });
});

describe('context and diagnostics privacy', () => {
  it('selects relevant state within explicit budgets', () => {
    const scenario = ScenarioSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(process.cwd(), 'assets/scenarios/selene-border-crisis.json'),
          'utf8',
        ),
      ),
    );
    const world = WorldStateSchema.parse({
      ...scenario.initialWorld,
      scenarioId: scenario.id,
      gameId: 'game:context',
      branchId: 'branch:context',
      playerActorId: 'actor:aster',
    });
    const context = assembleTurnContext(scenario, world, [], scenario.seedEvents, [], {
      totalCharacters: 5_000,
    });
    expect(context.characterCount).toBeLessThan(8_000);
    expect(context.included.actorIds).toContain('actor:aster');
    expect(context.system).toContain('untrusted_*');
    expect(context.user).toContain('<trusted_scenario>');
  });

  it('redacts sensitive diagnostic fields recursively', () => {
    const report = sanitizeDiagnosticValue({
      endpoint: 'http://127.0.0.1:1234',
      authorization: 'Bearer secret',
      nested: {
        token: 'secret',
        promptText: 'private action',
        model: 'local',
      },
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('private action');
    expect(serialized).toContain('127.0.0.1');
    expect(serialized).toContain('local');
  });

  it('keeps default settings strictly local', () => {
    const parsed = AppSettingsSchema.parse({
      schemaVersion: 1,
      firstRunComplete: false,
      provider: settings({ type: 'deterministic' }),
      featureModels: { simulation: '', diplomacy: '', advisor: '', summarization: '' },
      appearance: {
        theme: 'dark',
        colorblindMode: 'off',
        reducedMotion: false,
        uiScale: 1,
        textScale: 1,
        soundVolume: 0,
      },
      simulation: {
        detail: 'standard',
        memoryBlockTurns: 5,
        memoryEraBlocks: 5,
        autosaveBackups: 10,
      },
      privacy: {
        retainPromptMetadata: true,
        retainPromptContent: false,
        allowLanProviders: false,
      },
    });
    expect(parsed.privacy.retainPromptContent).toBe(false);
  });

  it('rejects a turn proposal with unrecognized structure', () => {
    expect(
      TurnProposalSchema.safeParse({
        summary: 'unsafe',
        arbitraryDatabasePatch: { sql: 'DROP TABLE games' },
      }).success,
    ).toBe(false);
  });
});
