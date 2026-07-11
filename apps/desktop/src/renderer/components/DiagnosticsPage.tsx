import { useState } from 'react';
import type {
  AppSettings,
  LocalModelInfo,
  ModelProbeResult,
  ProviderStatus,
  SanitizedDiagnostics,
} from '@pax-localia/domain';

interface DiagnosticsPageProps {
  settings: AppSettings;
  onClose: () => void;
  onSettings: (settings: AppSettings) => void;
}

export function DiagnosticsPage({ settings, onClose, onSettings }: DiagnosticsPageProps) {
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [models, setModels] = useState<LocalModelInfo[]>([]);
  const [probe, setProbe] = useState<ModelProbeResult>();
  const [report, setReport] = useState<SanitizedDiagnostics>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const run = async (label: string, task: () => Promise<void>): Promise<void> => {
    setBusy(label);
    setError('');
    try {
      await task();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Diagnostic operation failed.');
    } finally {
      setBusy('');
    }
  };

  const refresh = (): Promise<void> =>
    run('Testing local endpoints and reading model metadata…', async () => {
      const [providerStatuses, modelList, diagnostics] = await Promise.all([
        window.paxLocalia.ai.listProviders(),
        window.paxLocalia.ai.listModels(settings.provider),
        window.paxLocalia.ai.diagnostics(settings.provider),
      ]);
      setStatuses(providerStatuses);
      setModels(modelList);
      setReport(diagnostics);
    });

  const selected = models.find((model) => model.key === settings.provider.model);

  return (
    <main className="diagnostics-page">
      <header className="screen-header">
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close diagnostics"
        >
          ←
        </button>
        <div>
          <p className="eyebrow">Local inference</p>
          <h1>Model diagnostics</h1>
        </div>
        <span className="save-state">{busy || 'No public service contacted'}</span>
        <button type="button" className="button primary" onClick={() => void refresh()}>
          Run diagnostics
        </button>
      </header>
      <section className="diagnostic-grid">
        <article className="panel diagnostic-card">
          <p className="eyebrow">Configured endpoint</p>
          <h2>{settings.provider.type}</h2>
          <code>
            {settings.provider.type === 'deterministic'
              ? 'No endpoint'
              : settings.provider.endpoint}
          </code>
          <dl>
            <dt>LAN prompts</dt>
            <dd>{settings.provider.allowLan ? 'Explicitly enabled' : 'Blocked'}</dd>
            <dt>Stored token</dt>
            <dd>{settings.provider.hasStoredToken ? 'Present in OS-encrypted store' : 'None'}</dd>
            <dt>Loaded context estimate</dt>
            <dd>{settings.provider.contextLength.toLocaleString()}</dd>
          </dl>
        </article>
        <article className="panel diagnostic-card">
          <p className="eyebrow">Selected model</p>
          <h2>{selected?.displayName ?? (settings.provider.model || 'No model selected')}</h2>
          {selected ? (
            <dl>
              <dt>State</dt>
              <dd>{selected.state}</dd>
              <dt>Format</dt>
              <dd>{selected.format ?? 'Not reported'}</dd>
              <dt>Architecture</dt>
              <dd>{selected.architecture ?? 'Not reported'}</dd>
              <dt>Quantization</dt>
              <dd>{selected.quantization ?? 'Not reported'}</dd>
              <dt>Configured context</dt>
              <dd>{selected.contextLength?.toLocaleString() ?? 'Not reported'}</dd>
              <dt>Maximum context</dt>
              <dd>{selected.maxContextLength?.toLocaleString() ?? 'Not reported'}</dd>
            </dl>
          ) : (
            <p className="empty-state">Refresh to retrieve model metadata.</p>
          )}
        </article>
      </section>

      <section className="panel diagnostics-main">
        <header>
          <div>
            <p className="eyebrow">Test for Pax Localia</p>
            <h2>Measured capabilities</h2>
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={!settings.provider.model || Boolean(busy)}
            onClick={() =>
              void run('Testing strict JSON and streaming…', async () => {
                setProbe(await window.paxLocalia.ai.test(settings.provider));
              })
            }
          >
            Run model probe
          </button>
        </header>
        {probe ? (
          <div className="probe-grid">
            <span className={probe.connection ? 'pass' : 'fail'}>
              Connection · {probe.connection ? 'pass' : 'fail'}
            </span>
            <span className={probe.modelReady ? 'pass' : 'fail'}>
              Model readiness · {probe.modelReady ? 'pass' : 'fail'}
            </span>
            <span className={probe.structuredOutput ? 'pass' : 'fail'}>
              Strict JSON schema · {probe.structuredOutput ? 'pass' : 'fail'}
            </span>
            <span className={probe.streaming ? 'pass' : 'fail'}>
              Streaming · {probe.streaming ? 'pass' : 'fail'}
            </span>
            <span>Elapsed · {Math.round(probe.totalMs)} ms</span>
            {probe.firstTokenMs !== undefined && (
              <span>First token · {Math.round(probe.firstTokenMs)} ms</span>
            )}
            {probe.tokensPerSecond !== undefined && (
              <span>Reported speed · {probe.tokensPerSecond.toFixed(1)} tok/s</span>
            )}
            <div className="probe-messages">
              {probe.messages.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          </div>
        ) : (
          <p className="empty-state">
            This sends a tiny low-token request to the configured local endpoint.
          </p>
        )}
      </section>

      {settings.provider.type === 'lm-studio' && selected && (
        <section className="panel diagnostics-main">
          <header>
            <div>
              <p className="eyebrow">LM Studio native lifecycle</p>
              <h2>Explicit model controls</h2>
            </div>
            {selected.state === 'loaded' && selected.instanceId ? (
              <button
                type="button"
                className="button danger"
                onClick={() =>
                  void run('Unloading selected instance…', async () => {
                    setModels(
                      await window.paxLocalia.ai.unloadModel(
                        settings.provider,
                        selected.instanceId!,
                      ),
                    );
                  })
                }
              >
                Unload this instance
              </button>
            ) : (
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  void run('Loading selected model…', async () => {
                    setModels(
                      await window.paxLocalia.ai.loadModel(
                        settings.provider,
                        settings.provider.model,
                      ),
                    );
                  })
                }
              >
                Load with configured options
              </button>
            )}
          </header>
          <p>
            Pax Localia never unloads a model automatically. An explicit load is tracked by its
            reported instance ID and remains under your control.
          </p>
        </section>
      )}

      {statuses.length > 0 && (
        <section className="panel diagnostics-main">
          <h2>Provider detection</h2>
          <ul className="provider-status-list">
            {statuses.map((status) => (
              <li key={status.id}>
                <span className={`status-dot ${status.health}`}>{status.health}</span>
                <strong>{status.displayName}</strong>
                <code>{status.endpoint}</code>
                <p>{status.message}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report && (
        <section className="panel diagnostics-main">
          <header>
            <div>
              <p className="eyebrow">Safe to share</p>
              <h2>Sanitized report</h2>
            </div>
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(JSON.stringify(report, null, 2))
                  .then(() => setCopied(true))
                  .catch(() => setError('Clipboard access was denied. Select the report manually.'))
              }
            >
              {copied ? 'Copied' : 'Copy sanitized report'}
            </button>
          </header>
          <textarea
            readOnly
            className="diagnostic-report"
            value={JSON.stringify(report, null, 2)}
            aria-label="Sanitized diagnostic report"
          />
          <p>{report.privacy}</p>
        </section>
      )}

      {settings.provider.hasStoredToken &&
        (settings.provider.type === 'lm-studio' ||
          settings.provider.type === 'openai-compatible') && (
          <button
            type="button"
            className="button danger"
            onClick={() =>
              void run('Removing stored token…', async () => {
                await window.paxLocalia.settings.forgetToken(settings.provider.type as 'lm-studio');
                const next = await window.paxLocalia.settings.get();
                onSettings(next);
              })
            }
          >
            Forget token
          </button>
        )}
      {error && (
        <div role="alert" className="error-state">
          {error}
        </div>
      )}
    </main>
  );
}
