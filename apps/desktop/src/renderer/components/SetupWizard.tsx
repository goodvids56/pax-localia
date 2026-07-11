import { useEffect, useState } from 'react';
import type {
  AppSettings,
  LocalModelInfo,
  ModelProbeResult,
  ProviderStatus,
} from '@pax-localia/domain';

interface SetupWizardProps {
  settings: AppSettings;
  onSaved: (settings: AppSettings) => void;
  onComplete: () => void;
  onDiagnostics: () => void;
}

const providerDefaults = {
  'lm-studio': 'http://127.0.0.1:1234',
  ollama: 'http://127.0.0.1:11434',
  'openai-compatible': 'http://127.0.0.1:8080',
  deterministic: 'http://127.0.0.1:1',
} as const;

export function SetupWizard({ settings, onSaved, onComplete, onDiagnostics }: SetupWizardProps) {
  const [draft, setDraft] = useState(settings);
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [models, setModels] = useState<LocalModelInfo[]>([]);
  const [probe, setProbe] = useState<ModelProbeResult>();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const detect = async (): Promise<void> => {
    setBusy('Detecting local providers…');
    setError('');
    try {
      setStatuses(await window.paxLocalia.ai.listProviders());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Provider detection failed.');
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    let active = true;
    void window.paxLocalia.ai
      .listProviders()
      .then((providerStatuses) => {
        if (active) setStatuses(providerStatuses);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Provider detection failed.');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const chooseProvider = (type: AppSettings['provider']['type']): void => {
    setDraft((current) => ({
      ...current,
      provider: {
        ...current.provider,
        type,
        endpoint: providerDefaults[type],
        model: type === 'deterministic' ? 'deterministic-rules-v1' : '',
        hasStoredToken: false,
      },
    }));
    setModels([]);
    setProbe(undefined);
  };

  const saveDraft = async (next = draft): Promise<AppSettings> => {
    const saved = await window.paxLocalia.settings.update(next);
    setDraft(saved);
    onSaved(saved);
    return saved;
  };

  const refreshModels = async (): Promise<void> => {
    setBusy('Refreshing local model metadata…');
    setError('');
    try {
      const saved = await saveDraft();
      setModels(await window.paxLocalia.ai.listModels(saved.provider));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not list models.');
    } finally {
      setBusy('');
    }
  };

  const storeToken = async (): Promise<void> => {
    if (draft.provider.type !== 'lm-studio' && draft.provider.type !== 'openai-compatible') return;
    setBusy('Securing token…');
    setError('');
    try {
      await window.paxLocalia.settings.storeToken(draft.provider.type, token);
      setToken('');
      const saved = await window.paxLocalia.settings.get();
      setDraft(saved);
      onSaved(saved);
      await refreshModels();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not store token.');
    } finally {
      setBusy('');
    }
  };

  const testModel = async (): Promise<void> => {
    setBusy('Testing connection, load state, JSON schema, and streaming…');
    setError('');
    try {
      const saved = await saveDraft();
      setProbe(await window.paxLocalia.ai.test(saved.provider));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Model test failed.');
    } finally {
      setBusy('');
    }
  };

  const loadModel = async (): Promise<void> => {
    setBusy('Asking LM Studio to load the selected model…');
    setError('');
    try {
      const saved = await saveDraft();
      setModels(await window.paxLocalia.ai.loadModel(saved.provider, saved.provider.model));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Model load failed.');
    } finally {
      setBusy('');
    }
  };

  const finish = async (): Promise<void> => {
    setBusy('Saving offline setup…');
    try {
      const next = {
        ...draft,
        firstRunComplete: true,
      };
      await saveDraft(next);
      onComplete();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save setup.');
    } finally {
      setBusy('');
    }
  };

  const selectedStatus = statuses.find((status) => status.id === draft.provider.type);
  const selectedModel = models.find((model) => model.key === draft.provider.model);
  const canFinish =
    draft.provider.type === 'deterministic' ||
    (Boolean(draft.provider.model) && probe?.modelReady === true);

  return (
    <main className="setup-page">
      <section className="setup-hero">
        <p className="eyebrow">Pax Localia · offline-first</p>
        <h1>Forge a history that stays on your computer.</h1>
        <p>
          Choose a local inference provider or begin with the deterministic rules engine. Pax
          Localia collects no telemetry and never contacts a public AI API.
        </p>
      </section>

      <section className="setup-grid" aria-label="Local provider choices">
        {(['lm-studio', 'ollama', 'openai-compatible', 'deterministic'] as const).map(
          (provider) => {
            const status = statuses.find((candidate) => candidate.id === provider);
            return (
              <button
                type="button"
                key={provider}
                className={`provider-card ${draft.provider.type === provider ? 'selected' : ''}`}
                onClick={() => chooseProvider(provider)}
              >
                <span className="provider-heading">
                  {provider === 'lm-studio'
                    ? 'LM Studio'
                    : provider === 'ollama'
                      ? 'Ollama'
                      : provider === 'openai-compatible'
                        ? 'Local compatible server'
                        : 'Deterministic mode'}
                  {provider === 'lm-studio' && <span className="badge warm">Recommended</span>}
                </span>
                <span className={`status-dot ${status?.health ?? 'unknown'}`}>
                  {status?.health ?? 'Not tested'}
                </span>
                <span>{status?.message ?? 'Run detection to inspect this local provider.'}</span>
              </button>
            );
          },
        )}
      </section>

      <section className="panel setup-detail">
        <header>
          <div>
            <p className="eyebrow">Local connection</p>
            <h2>
              {draft.provider.type === 'lm-studio'
                ? 'LM Studio setup'
                : (selectedStatus?.displayName ?? 'Deterministic rules')}
            </h2>
          </div>
          <button type="button" className="button subtle" onClick={() => void detect()}>
            Retry detection
          </button>
        </header>

        {draft.provider.type === 'lm-studio' && selectedStatus?.health === 'not-detected' && (
          <div className="callout">
            Start the Local Server in LM Studio’s Developer tab, or run{' '}
            <code>lms server start --port 1234</code>. Pax Localia does not launch it or download
            models automatically.
          </div>
        )}

        {draft.provider.type !== 'deterministic' ? (
          <>
            <label>
              Endpoint
              <input
                value={draft.provider.endpoint}
                spellCheck={false}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    provider: { ...current.provider, endpoint: event.target.value },
                  }))
                }
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.provider.allowLan}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    provider: { ...current.provider, allowLan: event.target.checked },
                    privacy: {
                      ...current.privacy,
                      allowLanProviders: event.target.checked,
                    },
                  }))
                }
              />
              Allow this private-LAN endpoint. Prompts will be sent to the exact host shown above.
            </label>
            {(draft.provider.type === 'lm-studio' ||
              draft.provider.type === 'openai-compatible') && (
              <div className="inline-fields">
                <label>
                  Optional local server token
                  <input
                    type="password"
                    value={token}
                    autoComplete="off"
                    onChange={(event) => setToken(event.target.value)}
                    placeholder={
                      draft.provider.hasStoredToken
                        ? 'Token stored securely'
                        : 'No token configured'
                    }
                  />
                </label>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!token || Boolean(busy)}
                  onClick={() => void storeToken()}
                >
                  Store token
                </button>
              </div>
            )}
            <div className="row-actions">
              <button
                type="button"
                className="button secondary"
                disabled={Boolean(busy)}
                onClick={() => void refreshModels()}
              >
                Refresh models
              </button>
              <button type="button" className="button subtle" onClick={onDiagnostics}>
                Open detailed diagnostics
              </button>
            </div>
            {models.length > 0 ? (
              <label>
                Chat / simulation model
                <select
                  value={draft.provider.model}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      provider: { ...current.provider, model: event.target.value },
                    }))
                  }
                >
                  <option value="">Select a local model…</option>
                  {models.map((model) => (
                    <option value={model.key} key={model.key}>
                      {model.displayName} · {model.state}
                      {model.quantization ? ` · ${model.quantization}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="empty-state">
                No models listed yet. Download an instruct model inside your provider, then refresh.
              </p>
            )}
            {selectedModel && (
              <div className="model-metadata">
                <span className="badge">{selectedModel.state}</span>
                {selectedModel.format && <span>{selectedModel.format}</span>}
                {selectedModel.architecture && <span>{selectedModel.architecture}</span>}
                {selectedModel.parameterSize && <span>{selectedModel.parameterSize}</span>}
                {selectedModel.quantization && <span>{selectedModel.quantization}</span>}
                {selectedModel.contextLength && (
                  <span>{selectedModel.contextLength.toLocaleString()} loaded context</span>
                )}
              </div>
            )}
            {draft.provider.type === 'lm-studio' && selectedModel?.state === 'unloaded' && (
              <details>
                <summary>Explicit LM Studio load options</summary>
                <div className="settings-grid">
                  <label>
                    Context length (blank = LM Studio default)
                    <input
                      type="number"
                      min={1024}
                      placeholder="Automatic"
                      value={draft.provider.loadConfig.contextLength ?? ''}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          provider: {
                            ...current.provider,
                            loadConfig: {
                              ...current.provider.loadConfig,
                              contextLength: event.target.value
                                ? Number(event.target.value)
                                : undefined,
                            },
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Flash Attention
                    <select
                      value={
                        draft.provider.loadConfig.flashAttention === undefined
                          ? 'auto'
                          : String(draft.provider.loadConfig.flashAttention)
                      }
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          provider: {
                            ...current.provider,
                            loadConfig: {
                              ...current.provider.loadConfig,
                              flashAttention:
                                event.target.value === 'auto'
                                  ? undefined
                                  : event.target.value === 'true',
                            },
                          },
                        }))
                      }
                    >
                      <option value="auto">Automatic / LM Studio default</option>
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => void loadModel()}
                  disabled={!draft.provider.model || Boolean(busy)}
                >
                  Load selected model
                </button>
              </details>
            )}
            <button
              type="button"
              className="button primary"
              disabled={!draft.provider.model || Boolean(busy)}
              onClick={() => void testModel()}
            >
              Test for Pax Localia
            </button>
            {probe && (
              <div className={`probe-result ${probe.status}`}>
                <strong>{probe.status === 'ready' ? 'Ready' : 'Needs attention'}</strong>
                <span>JSON schema: {probe.structuredOutput ? 'passed' : 'failed'}</span>
                <span>Streaming: {probe.streaming ? 'passed' : 'failed'}</span>
                <span>Elapsed: {Math.round(probe.totalMs)} ms</span>
                {probe.messages.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="callout success">
            Deterministic mode is ready. It uses seeded rules, supports complete offline gameplay,
            and makes no network request.
          </div>
        )}

        {busy && <p className="loading-state">{busy}</p>}
        {error && (
          <div role="alert" className="error-state">
            {error}
          </div>
        )}
        <footer>
          <p>
            Privacy: ordinary game data remains local. When enabled, only the configured local
            endpoint receives selected prompt context.
          </p>
          <button
            type="button"
            className="button primary large"
            disabled={!canFinish || Boolean(busy)}
            onClick={() => void finish()}
          >
            Enter Pax Localia
          </button>
        </footer>
      </section>
    </main>
  );
}
