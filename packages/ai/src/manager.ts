import { createHash } from 'node:crypto';
import type {
  LocalModelInfo,
  ModelProbeResult,
  ProviderSettings,
  ProviderStatus,
  SanitizedDiagnostics,
} from '@pax-localia/domain';
import { DeterministicLocalProvider } from './deterministic-provider';
import { LMStudioProvider } from './lm-studio';
import { classifyEndpoint, sanitizedEndpoint } from './network';
import { OllamaProvider } from './ollama';
import { OpenAICompatibleProvider } from './openai-compatible';
import { LocalAIError, type FetchTransport, type LocalAIProvider } from './types';

interface RecentError {
  code: string;
  message: string;
  at: string;
}

export interface AIManagerOptions {
  tokenFor(provider: 'lm-studio' | 'openai-compatible'): string | undefined;
  fetch?: FetchTransport;
  readProbeCache?: (key: string) => unknown;
  writeProbeCache?: (
    key: string,
    provider: string,
    endpoint: string,
    model: string,
    metadataHash: string,
    result: ModelProbeResult,
  ) => void;
}

export class AIManager {
  private readonly errors: RecentError[] = [];
  private readonly options: AIManagerOptions;

  constructor(options: AIManagerOptions) {
    this.options = options;
  }

  createProvider(settings: ProviderSettings): LocalAIProvider {
    const fetchOption = this.options.fetch ? { fetch: this.options.fetch } : {};
    switch (settings.type) {
      case 'lm-studio': {
        const token = this.options.tokenFor('lm-studio');
        return new LMStudioProvider({
          settings,
          ...(token ? { token } : {}),
          ...fetchOption,
        });
      }
      case 'ollama':
        return new OllamaProvider({ settings, ...fetchOption });
      case 'openai-compatible': {
        const token = this.options.tokenFor('openai-compatible');
        return new OpenAICompatibleProvider({
          settings,
          ...(token ? { token } : {}),
          ...fetchOption,
        });
      }
      case 'deterministic':
        return new DeterministicLocalProvider();
    }
  }

  private recordError(error: unknown): void {
    const providerError =
      error instanceof LocalAIError
        ? error
        : new LocalAIError('HTTP_ERROR', error instanceof Error ? error.message : 'Unknown error');
    this.errors.unshift({
      code: providerError.code,
      message: providerError.message.slice(0, 500),
      at: new Date().toISOString(),
    });
    this.errors.splice(10);
  }

  async providerStatuses(current: ProviderSettings): Promise<ProviderStatus[]> {
    const candidates: ProviderSettings[] = [
      {
        ...current,
        type: 'lm-studio',
        endpoint: current.type === 'lm-studio' ? current.endpoint : 'http://127.0.0.1:1234',
        model: current.type === 'lm-studio' ? current.model : '',
      },
      {
        ...current,
        type: 'ollama',
        endpoint: current.type === 'ollama' ? current.endpoint : 'http://127.0.0.1:11434',
        model: current.type === 'ollama' ? current.model : '',
      },
      {
        ...current,
        type: 'openai-compatible',
        endpoint: current.type === 'openai-compatible' ? current.endpoint : 'http://127.0.0.1:8080',
        model: current.type === 'openai-compatible' ? current.model : '',
      },
      {
        ...current,
        type: 'deterministic',
        endpoint: 'http://127.0.0.1:1',
        model: 'deterministic-rules-v1',
      },
    ];
    return Promise.all(
      candidates.map(async (settings) => {
        const provider = this.createProvider(settings);
        const health = await provider.healthCheck();
        return {
          id: provider.id,
          displayName: provider.displayName,
          recommended: provider.id === 'lm-studio',
          health: health.status,
          endpoint:
            provider.id === 'deterministic' ? 'No endpoint' : sanitizedEndpoint(settings.endpoint),
          message: health.message,
          capabilities: health.capabilities,
        };
      }),
    );
  }

  async listModels(settings: ProviderSettings, signal?: AbortSignal): Promise<LocalModelInfo[]> {
    try {
      return await this.createProvider(settings).listModels(signal);
    } catch (error) {
      this.recordError(error);
      throw error;
    }
  }

  async probe(settings: ProviderSettings, signal?: AbortSignal): Promise<ModelProbeResult> {
    const metadata = JSON.stringify({
      type: settings.type,
      endpoint: sanitizedEndpoint(settings.endpoint),
      model: settings.model,
      contextLength: settings.contextLength,
    });
    const metadataHash = createHash('sha256').update(metadata).digest('hex');
    const cacheKey = createHash('sha256').update(`probe:${metadataHash}`).digest('hex');
    const cached = this.options.readProbeCache?.(cacheKey);
    if (cached && typeof cached === 'object') {
      const testedAt = new Date((cached as { testedAt?: string }).testedAt ?? 0).valueOf();
      if (Date.now() - testedAt < 30 * 60 * 1_000) {
        return cached as ModelProbeResult;
      }
    }
    try {
      const result = await this.createProvider(settings).probe(settings.model, signal);
      this.options.writeProbeCache?.(
        cacheKey,
        settings.type,
        sanitizedEndpoint(settings.endpoint),
        settings.model,
        metadataHash,
        result,
      );
      return result;
    } catch (error) {
      this.recordError(error);
      throw error;
    }
  }

  async diagnostics(settings: ProviderSettings): Promise<SanitizedDiagnostics> {
    const provider = this.createProvider(settings);
    let serverStatus: string;
    let models: LocalModelInfo[] = [];
    let nativeApi = false;
    try {
      const health = await provider.healthCheck();
      serverStatus = `${health.status}: ${health.message}`;
      nativeApi = health.capabilities.nativeModelApi;
      if (health.ok) models = await provider.listModels();
    } catch (error) {
      this.recordError(error);
      serverStatus =
        error instanceof LocalAIError ? `${error.code}: ${error.message}` : 'Unknown error';
    }
    const selected = models.find((model) => model.key === settings.model);
    const endpointPolicy =
      settings.type === 'deterministic'
        ? 'loopback'
        : classifyEndpoint(settings.endpoint, settings.allowLan);
    return {
      generatedAt: new Date().toISOString(),
      provider: provider.displayName,
      endpoint:
        settings.type === 'deterministic' ? 'No endpoint' : sanitizedEndpoint(settings.endpoint),
      endpointPolicy,
      serverStatus,
      nativeApi,
      modelCount: models.length,
      selectedModel: selected?.displayName ?? (settings.model || 'None selected'),
      selectedModelState: selected?.state ?? 'unknown',
      structuredOutput: 'Run “Test for Pax Localia” for a measured result.',
      recentErrors: this.errors.map((entry) => ({ ...entry })),
      privacy: 'No prompts, chat text, actions, tokens, headers, or raw responses included.',
    };
  }

  async loadModel(settings: ProviderSettings, signal?: AbortSignal): Promise<LocalModelInfo[]> {
    const provider = this.createProvider(settings);
    if (!provider.loadModel) {
      throw new LocalAIError('UNSUPPORTED_API', 'This provider cannot explicitly load models.');
    }
    try {
      const loadConfig = {
        ...(settings.loadConfig.contextLength !== undefined
          ? { contextLength: settings.loadConfig.contextLength }
          : {}),
        ...(settings.loadConfig.flashAttention !== undefined
          ? { flashAttention: settings.loadConfig.flashAttention }
          : {}),
        ...(settings.loadConfig.evaluationBatchSize !== undefined
          ? { evaluationBatchSize: settings.loadConfig.evaluationBatchSize }
          : {}),
        ...(settings.loadConfig.gpuKvCache !== undefined
          ? { gpuKvCache: settings.loadConfig.gpuKvCache }
          : {}),
        ...(settings.loadConfig.moeExpertCount !== undefined
          ? { moeExpertCount: settings.loadConfig.moeExpertCount }
          : {}),
      };
      return await provider.loadModel(settings.model, loadConfig, signal);
    } catch (error) {
      this.recordError(error);
      throw error;
    }
  }

  async unloadModel(
    settings: ProviderSettings,
    instanceId: string,
    signal?: AbortSignal,
  ): Promise<LocalModelInfo[]> {
    const provider = this.createProvider(settings);
    if (!provider.unloadModel) {
      throw new LocalAIError('UNSUPPORTED_API', 'This provider cannot explicitly unload models.');
    }
    try {
      return await provider.unloadModel(instanceId, signal);
    } catch (error) {
      this.recordError(error);
      throw error;
    }
  }
}

export function sanitizeDiagnosticValue(value: unknown): unknown {
  const blocked = /(token|authorization|prompt|chat|action|response|secret|password|api.?key)/i;
  if (Array.isArray(value)) return value.map(sanitizeDiagnosticValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        blocked.test(key) ? '[REDACTED]' : sanitizeDiagnosticValue(entry),
      ]),
    );
  }
  return value;
}
