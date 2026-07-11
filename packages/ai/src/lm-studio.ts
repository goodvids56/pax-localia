import { z } from 'zod';
import type {
  LocalModelInfo,
  ModelProbeResult,
  ProviderCapabilities,
  ProviderSettings,
} from '@pax-localia/domain';
import { OpenAICompatibleProvider } from './openai-compatible';
import { authorizationHeaders, ensureResponseOk, request, responseJson } from './request';
import {
  LocalAIError,
  type FetchTransport,
  type HealthResult,
  type ModelLoadOptions,
} from './types';

interface LMStudioOptions {
  settings: ProviderSettings;
  token?: string;
  fetch?: FetchTransport;
}

const nativeModelSchema = z
  .object({
    key: z.string().optional(),
    id: z.string().optional(),
    display_name: z.string().optional(),
    name: z.string().optional(),
    publisher: z.string().optional(),
    architecture: z.string().optional(),
    arch: z.string().optional(),
    format: z.string().optional(),
    compatibility_type: z.string().optional(),
    quantization: z.string().optional(),
    parameter_size: z.string().optional(),
    size_bytes: z.number().optional(),
    type: z.string().optional(),
    model_type: z.string().optional(),
    state: z.string().optional(),
    max_context_length: z.number().optional(),
    context_length: z.number().optional(),
    capabilities: z.array(z.string()).optional(),
    trained_for_tool_use: z.boolean().optional(),
    vision: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    loaded_instances: z
      .array(
        z
          .object({
            id: z.string().optional(),
            instance_id: z.string().optional(),
            context_length: z.number().optional(),
            config: z.record(z.string(), z.unknown()).optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

function nativeModels(payload: unknown): z.infer<typeof nativeModelSchema>[] | undefined {
  const wrapped = z.object({ models: z.array(nativeModelSchema) }).safeParse(payload);
  if (wrapped.success) return wrapped.data.models;
  const direct = z.array(nativeModelSchema).safeParse(payload);
  return direct.success ? direct.data : undefined;
}

function scalarLoadConfig(
  value: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string | number | boolean | null] =>
        entry[1] === null ||
        typeof entry[1] === 'string' ||
        typeof entry[1] === 'number' ||
        typeof entry[1] === 'boolean',
    ),
  );
}

export class LMStudioProvider extends OpenAICompatibleProvider {
  override readonly id = 'lm-studio' as const;
  override readonly displayName = 'LM Studio';
  private nativeApiAvailable: boolean | undefined;

  constructor(options: LMStudioOptions) {
    super({
      id: 'lm-studio',
      displayName: 'LM Studio',
      settings: options.settings,
      ...(options.token ? { token: options.token } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  override capabilities(): Promise<ProviderCapabilities> {
    return Promise.resolve({
      nativeModelApi: this.nativeApiAvailable === true,
      structuredOutput: true,
      streaming: true,
      modelLifecycle: this.nativeApiAvailable === true,
      tokenCounting: this.nativeApiAvailable === true,
    });
  }

  private async listNative(signal?: AbortSignal): Promise<LocalModelInfo[] | undefined> {
    const { response } = await request({
      fetch: this.fetchTransport,
      url: `${this.baseUrl}/api/v1/models`,
      init: { headers: authorizationHeaders(this.token) },
      timeoutMs: Math.min(this.settings.timeoutMs, 15_000),
      ...(signal ? { signal } : {}),
    });
    if (response.status === 404 || response.status === 405) {
      this.nativeApiAvailable = false;
      return undefined;
    }
    await ensureResponseOk(response);
    const payload = nativeModels(await responseJson(response));
    if (!payload) {
      this.nativeApiAvailable = false;
      return undefined;
    }
    this.nativeApiAvailable = true;
    return payload
      .map((model): LocalModelInfo | undefined => {
        const key = model.key ?? model.id;
        if (!key) return undefined;
        const modelType = (model.type ?? model.model_type ?? 'unknown').toLocaleLowerCase();
        if (modelType.includes('embed')) return undefined;
        if (
          modelType !== 'unknown' &&
          !modelType.includes('llm') &&
          !modelType.includes('chat') &&
          !modelType.includes('vision')
        ) {
          return undefined;
        }
        const loaded = model.loaded_instances?.[0];
        const reportedCapabilities = new Set(
          (model.capabilities ?? []).map((capability) => capability.toLocaleLowerCase()),
        );
        const capabilities: LocalModelInfo['capabilities'] = ['chat'];
        if (model.vision || reportedCapabilities.has('vision')) capabilities.push('vision');
        if (model.trained_for_tool_use || reportedCapabilities.has('tools')) {
          capabilities.push('tools');
        }
        if (model.reasoning || reportedCapabilities.has('reasoning'))
          capabilities.push('reasoning');
        const formatName = (model.format ?? model.compatibility_type ?? '').toLocaleUpperCase();
        const format =
          formatName === 'GGUF'
            ? 'GGUF'
            : formatName === 'MLX'
              ? 'MLX'
              : formatName
                ? 'other'
                : undefined;
        const configuredContext =
          loaded?.context_length ??
          (typeof loaded?.config?.context_length === 'number'
            ? loaded.config.context_length
            : undefined) ??
          model.context_length;
        const normalizedState = (model.state ?? '').toLocaleLowerCase();
        const state: LocalModelInfo['state'] = loaded
          ? 'loaded'
          : normalizedState.includes('load') && !normalizedState.includes('unload')
            ? 'loading'
            : normalizedState.includes('error')
              ? 'error'
              : 'unloaded';
        return {
          key,
          displayName: model.display_name ?? model.name ?? key,
          ...(model.publisher ? { publisher: model.publisher } : {}),
          ...((model.architecture ?? model.arch)
            ? { architecture: model.architecture ?? model.arch }
            : {}),
          ...(format ? { format } : {}),
          ...(model.quantization ? { quantization: model.quantization } : {}),
          ...(model.parameter_size ? { parameterSize: model.parameter_size } : {}),
          ...(model.size_bytes !== undefined ? { sizeBytes: model.size_bytes } : {}),
          state,
          ...((loaded?.id ?? loaded?.instance_id)
            ? { instanceId: loaded?.id ?? loaded?.instance_id }
            : {}),
          ...(configuredContext ? { contextLength: configuredContext } : {}),
          ...(model.max_context_length ? { maxContextLength: model.max_context_length } : {}),
          kind: modelType.includes('vision') ? 'vision' : 'llm',
          capabilities,
          loadConfig: scalarLoadConfig(loaded?.config),
        };
      })
      .filter((model): model is LocalModelInfo => model !== undefined);
  }

  override async listModels(signal?: AbortSignal): Promise<LocalModelInfo[]> {
    const native = await this.listNative(signal);
    if (native) return native;
    return super.listModels(signal);
  }

  override async healthCheck(signal?: AbortSignal): Promise<HealthResult> {
    try {
      const models = await this.listModels(signal);
      if (models.length === 0) {
        return {
          ok: false,
          status: 'no-models',
          message:
            'LM Studio is connected but has no reported chat model. Download an instruct model inside LM Studio.',
          capabilities: await this.capabilities(),
        };
      }
      const loadedCount = models.filter((model) => model.state === 'loaded').length;
      return {
        ok: true,
        status: loadedCount > 0 || this.nativeApiAvailable === false ? 'ready' : 'model-unloaded',
        message:
          this.nativeApiAvailable === false
            ? `Connected through LM Studio’s OpenAI-compatible API. Native lifecycle metadata is unavailable.`
            : `${models.length} chat model${models.length === 1 ? '' : 's'} found; ${loadedCount} loaded.`,
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

  async loadModel(
    modelKey: string,
    options: ModelLoadOptions,
    signal?: AbortSignal,
  ): Promise<LocalModelInfo[]> {
    if (this.nativeApiAvailable === false) {
      throw new LocalAIError(
        'UNSUPPORTED_API',
        'This LM Studio server does not expose native model lifecycle endpoints.',
      );
    }
    const config = {
      ...(options.contextLength !== undefined ? { context_length: options.contextLength } : {}),
      ...(options.flashAttention !== undefined ? { flash_attention: options.flashAttention } : {}),
      ...(options.evaluationBatchSize !== undefined
        ? { eval_batch_size: options.evaluationBatchSize }
        : {}),
      ...(options.gpuKvCache !== undefined ? { offload_kv_cache_to_gpu: options.gpuKvCache } : {}),
      ...(options.moeExpertCount !== undefined ? { num_experts_used: options.moeExpertCount } : {}),
    };
    const { response } = await request({
      fetch: this.fetchTransport,
      url: `${this.baseUrl}/api/v1/models/load`,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authorizationHeaders(this.token),
        },
        body: JSON.stringify({
          model: modelKey,
          config,
          echo_load_config: true,
        }),
      },
      timeoutMs: Math.max(this.settings.timeoutMs, 180_000),
      ...(signal ? { signal } : {}),
    });
    try {
      await ensureResponseOk(response);
      await responseJson(response);
    } catch (error) {
      if (error instanceof LocalAIError) {
        throw new LocalAIError('MODEL_LOAD_FAILED', error.message, error.status, true);
      }
      throw error;
    }
    return this.listModels(signal);
  }

  async unloadModel(instanceId: string, signal?: AbortSignal): Promise<LocalModelInfo[]> {
    if (this.nativeApiAvailable === false) {
      throw new LocalAIError(
        'UNSUPPORTED_API',
        'This LM Studio server does not expose native model lifecycle endpoints.',
      );
    }
    const { response } = await request({
      fetch: this.fetchTransport,
      url: `${this.baseUrl}/api/v1/models/unload`,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authorizationHeaders(this.token),
        },
        body: JSON.stringify({ instance_id: instanceId }),
      },
      timeoutMs: Math.min(this.settings.timeoutMs, 60_000),
      ...(signal ? { signal } : {}),
    });
    await ensureResponseOk(response);
    if (response.status !== 204) await responseJson(response);
    return this.listModels(signal);
  }

  override async probe(model: string, signal?: AbortSignal): Promise<ModelProbeResult> {
    const result = await super.probe(model, signal);
    try {
      const models = await this.listModels(signal);
      const selected = models.find((candidate) => candidate.key === model);
      if (!selected) {
        return {
          ...result,
          status: 'failed',
          modelReady: false,
          messages: [...result.messages, 'The selected model disappeared after the probe.'],
        };
      }
      return {
        ...result,
        ...(selected.contextLength
          ? { contextLength: selected.contextLength }
          : selected.maxContextLength
            ? { contextLength: selected.maxContextLength }
            : {}),
        modelReady: selected.state !== 'error',
        messages: [
          ...result.messages,
          selected.state === 'unloaded'
            ? 'The model is downloaded but currently unloaded; first use may trigger JIT loading.'
            : `LM Studio reports model state: ${selected.state}.`,
        ],
      };
    } catch {
      return result;
    }
  }
}
