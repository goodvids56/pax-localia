import type { z } from 'zod';
import type {
  LocalModelInfo,
  ModelProbeResult,
  ProviderCapabilities,
  ProviderSettings,
} from '@pax-localia/domain';

export type ProviderErrorCode =
  | 'NETWORK_POLICY_BLOCKED'
  | 'SERVER_UNAVAILABLE'
  | 'AUTHENTICATION_REQUIRED'
  | 'MALFORMED_RESPONSE'
  | 'UNSUPPORTED_API'
  | 'NO_MODELS'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_NOT_LOADED'
  | 'MODEL_LOAD_FAILED'
  | 'CONTEXT_OVERFLOW'
  | 'STRUCTURED_OUTPUT_UNSUPPORTED'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'STREAM_DISCONNECTED'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'HTTP_ERROR';

const helpText: Record<ProviderErrorCode, string> = {
  NETWORK_POLICY_BLOCKED:
    'Use a loopback endpoint, or explicitly enable LAN providers for a private-network address.',
  SERVER_UNAVAILABLE:
    'Confirm the local server is running and that the port matches its developer/server settings.',
  AUTHENTICATION_REQUIRED: 'Enter the local server token in Pax Localia settings, then test again.',
  MALFORMED_RESPONSE:
    'The server returned an unexpected response. Update the server or use its OpenAI-compatible mode.',
  UNSUPPORTED_API:
    'The installed server version does not expose this feature. Basic compatible inference may still work.',
  NO_MODELS:
    'Download an instruct/chat model in the local provider application. Pax Localia never downloads one automatically.',
  MODEL_NOT_FOUND: 'Refresh the model list and select an available model.',
  MODEL_NOT_LOADED: 'Load the selected model or enable the provider’s just-in-time loading.',
  MODEL_LOAD_FAILED:
    'Review local provider memory/load settings and try a smaller context or quantization.',
  CONTEXT_OVERFLOW:
    'Use a shorter context, reduce simulation detail, or load the model with a larger context.',
  STRUCTURED_OUTPUT_UNSUPPORTED:
    'Use deterministic simulation or choose a model/server that passes the JSON-schema probe.',
  SCHEMA_VALIDATION_FAILED:
    'The model response was not safe to apply. Retry, lower creativity, or use deterministic resolution.',
  STREAM_DISCONNECTED:
    'The local stream ended unexpectedly. Retry; saved conversation history remains unchanged.',
  TIMEOUT: 'Increase the provider timeout or verify that the model finished loading.',
  ABORTED: 'The local generation was cancelled.',
  HTTP_ERROR: 'Inspect the sanitized diagnostics and local provider logs.',
};

export class LocalAIError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LocalAIError';
  }

  get help(): string {
    return helpText[this.code];
  }
}

export interface HealthResult {
  ok: boolean;
  status:
    'ready' | 'not-detected' | 'authentication-required' | 'no-models' | 'model-unloaded' | 'error';
  message: string;
  capabilities: ProviderCapabilities;
}

export interface StructuredGenerationRequest<T> {
  model: string;
  schemaName: string;
  schema: z.ZodType<T>;
  system: string;
  user: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retryCount: number;
}

export interface StructuredGenerationResult<T> {
  value: T;
  rawCharacterCount: number;
  model: string;
  durationMs: number;
  repaired: boolean;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    tokensPerSecond?: number;
  };
}

export interface ChatGenerationRequest {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  onProgress?: (progress: {
    phase: 'loading' | 'prompt' | 'reasoning' | 'message' | 'complete';
    textDelta?: string;
  }) => void;
}

export interface ChatGenerationResult {
  text: string;
  model: string;
  durationMs: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    tokensPerSecond?: number;
  };
}

export interface ModelLoadOptions {
  contextLength?: number;
  flashAttention?: boolean;
  evaluationBatchSize?: number;
  gpuKvCache?: boolean;
  moeExpertCount?: number;
}

export interface LocalAIProvider {
  readonly id: ProviderSettings['type'];
  readonly displayName: string;
  capabilities(): Promise<ProviderCapabilities>;
  listModels(signal?: AbortSignal): Promise<LocalModelInfo[]>;
  healthCheck(signal?: AbortSignal): Promise<HealthResult>;
  generateStructured<T>(
    request: StructuredGenerationRequest<T>,
    signal?: AbortSignal,
  ): Promise<StructuredGenerationResult<T>>;
  generateChat(request: ChatGenerationRequest, signal?: AbortSignal): Promise<ChatGenerationResult>;
  probe(model: string, signal?: AbortSignal): Promise<ModelProbeResult>;
  loadModel?(
    modelKey: string,
    options: ModelLoadOptions,
    signal?: AbortSignal,
  ): Promise<LocalModelInfo[]>;
  unloadModel?(instanceId: string, signal?: AbortSignal): Promise<LocalModelInfo[]>;
}

export type FetchTransport = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;
