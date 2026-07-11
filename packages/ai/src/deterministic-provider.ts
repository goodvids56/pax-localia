import type { LocalModelInfo, ModelProbeResult, ProviderCapabilities } from '@pax-localia/domain';
import {
  LocalAIError,
  type ChatGenerationRequest,
  type ChatGenerationResult,
  type HealthResult,
  type LocalAIProvider,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
} from './types';

export class DeterministicLocalProvider implements LocalAIProvider {
  readonly id = 'deterministic' as const;
  readonly displayName = 'Deterministic rules (no model)';

  async capabilities(): Promise<ProviderCapabilities> {
    return {
      nativeModelApi: false,
      structuredOutput: false,
      streaming: false,
      modelLifecycle: false,
      tokenCounting: false,
    };
  }

  async listModels(): Promise<LocalModelInfo[]> {
    return [
      {
        key: 'deterministic-rules-v1',
        displayName: 'Pax Localia deterministic rules v1',
        publisher: 'Pax Localia contributors',
        state: 'loaded',
        kind: 'llm',
        capabilities: ['chat'],
        loadConfig: {},
      },
    ];
  }

  async healthCheck(): Promise<HealthResult> {
    return {
      ok: true,
      status: 'ready',
      message: 'Offline deterministic simulation is always available and sends no prompts.',
      capabilities: await this.capabilities(),
    };
  }

  async generateStructured<T>(
    _request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>> {
    throw new LocalAIError(
      'STRUCTURED_OUTPUT_UNSUPPORTED',
      'Deterministic state proposals are produced directly by the rules engine.',
    );
  }

  async generateChat(request: ChatGenerationRequest): Promise<ChatGenerationResult> {
    const latest = request.messages.at(-1)?.content ?? '';
    const normalized = latest.toLocaleLowerCase();
    const text = normalized.includes('risk')
      ? 'Deterministic assessment: compare stability, military readiness, active conflicts, and unresolved commitments before advancing time.'
      : normalized.includes('promise') || normalized.includes('commitment')
        ? 'Deterministic assessment: review accepted and pending commitments; broken promises affect relations during later turns.'
        : 'Deterministic mode can summarize known state and apply rules, but it does not generate open-ended model prose. Inspect the cited state panels for exact values.';
    return {
      text,
      model: 'deterministic-rules-v1',
      durationMs: 0,
    };
  }

  async probe(): Promise<ModelProbeResult> {
    return {
      status: 'ready',
      connection: true,
      authenticated: true,
      modelReady: true,
      structuredOutput: false,
      streaming: false,
      totalMs: 0,
      suitability: {
        simulation: true,
        diplomacy: true,
        advisor: true,
        summarization: true,
      },
      messages: [
        'No local model server is required.',
        'Simulation, diplomacy rules, advisor summaries, and memory extraction are deterministic.',
      ],
      testedAt: new Date().toISOString(),
    };
  }
}
