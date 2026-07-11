import { AIManager, LocalAIError, type ChatGenerationRequest } from '@pax-localia/ai';
import { ProviderSettingsSchema } from '@pax-localia/domain';

async function main(): Promise<void> {
  const argumentsMap = new Map(
    process.argv
      .slice(2)
      .map((entry) => entry.split('=', 2))
      .filter((entry): entry is [string, string] => entry.length === 2),
  );
  const providerType = argumentsMap.get('--provider') ?? 'lm-studio';
  if (!['lm-studio', 'ollama', 'openai-compatible'].includes(providerType)) {
    throw new Error(
      'Use --provider=lm-studio, --provider=ollama, or --provider=openai-compatible.',
    );
  }
  const defaultEndpoint =
    providerType === 'lm-studio'
      ? 'http://127.0.0.1:1234'
      : providerType === 'ollama'
        ? 'http://127.0.0.1:11434'
        : 'http://127.0.0.1:8080';
  const settings = ProviderSettingsSchema.parse({
    type: providerType,
    endpoint: argumentsMap.get('--endpoint') ?? defaultEndpoint,
    model: argumentsMap.get('--model') ?? '',
    allowLan: argumentsMap.get('--allow-lan') === 'true',
    hasStoredToken: false,
    contextLength: Number(argumentsMap.get('--context') ?? 8192),
    temperature: 0,
    maxOutputTokens: 128,
    timeoutMs: Number(argumentsMap.get('--timeout-ms') ?? 120_000),
    retries: 0,
    keepAlive: true,
    loadConfig: {},
  });
  const manager = new AIManager({ tokenFor: () => undefined });

  const models = await manager.listModels(settings);
  if (models.length === 0) throw new Error('The local provider reported no chat models.');
  const model = settings.model || models[0]!.key;
  const selectedSettings = { ...settings, model };
  console.log(
    JSON.stringify(
      {
        endpoint: settings.endpoint,
        models,
        selectedModel: model,
      },
      null,
      2,
    ),
  );

  const probe = await manager.probe(selectedSettings);
  console.log(JSON.stringify({ probe }, null, 2));
  if (probe.status === 'failed') process.exitCode = 1;

  const provider = manager.createProvider(selectedSettings);
  const controller = new AbortController();
  let receivedDelta = false;
  const cancelRequest: ChatGenerationRequest = {
    model,
    messages: [{ role: 'user', content: 'Reply with the single word READY.' }],
    temperature: 0,
    maxOutputTokens: 16,
    timeoutMs: settings.timeoutMs,
    onProgress: (progress) => {
      if (progress.phase === 'message' && !receivedDelta) {
        receivedDelta = true;
        controller.abort();
      }
    },
  };
  try {
    await provider.generateChat(cancelRequest, controller.signal);
    console.log('Short stream completed before cancellation could interrupt it.');
  } catch (error) {
    if (error instanceof LocalAIError && error.code === 'ABORTED') {
      console.log('Streaming cancellation passed.');
    } else {
      throw error;
    }
  }

  console.log(
    JSON.stringify(
      {
        diagnostics: await manager.diagnostics(selectedSettings),
      },
      null,
      2,
    ),
  );
}

void main();
