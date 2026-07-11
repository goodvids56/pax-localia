import { useEffect, useState } from 'react';
import type { AppPaths, AppSettings } from '@pax-localia/domain';

interface SettingsPageProps {
  settings: AppSettings;
  onClose: () => void;
  onSaved: (settings: AppSettings) => void;
  onDiagnostics: () => void;
  onLicenses: () => void;
}

type SettingsTab =
  'general' | 'appearance' | 'ai' | 'simulation' | 'storage' | 'shortcuts' | 'accessibility';

export function SettingsPage({
  settings,
  onClose,
  onSaved,
  onDiagnostics,
  onLicenses,
}: SettingsPageProps) {
  const [draft, setDraft] = useState(settings);
  const [tab, setTab] = useState<SettingsTab>('general');
  const [paths, setPaths] = useState<AppPaths>();
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void window.paxLocalia.app.getPaths().then(setPaths);
  }, []);

  const save = async (): Promise<void> => {
    setBusy('Saving settings…');
    setError('');
    try {
      const saved = await window.paxLocalia.settings.update(draft);
      setDraft(saved);
      onSaved(saved);
      setNotice('Settings saved locally.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save settings.');
    } finally {
      setBusy('');
    }
  };

  const operation = async (
    label: string,
    action: () => Promise<{ message: string }>,
  ): Promise<void> => {
    setBusy(label);
    setError('');
    try {
      setNotice((await action()).message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Operation failed.');
    } finally {
      setBusy('');
    }
  };

  return (
    <main className="settings-page">
      <header className="screen-header">
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close settings">
          ←
        </button>
        <div>
          <p className="eyebrow">Local configuration</p>
          <h1>Settings</h1>
        </div>
        <span className="save-state">{busy || 'Changes are not saved automatically'}</span>
        <button type="button" className="button primary" onClick={() => void save()}>
          Save
        </button>
      </header>
      <div className="settings-layout">
        <nav aria-label="Settings sections">
          {(
            [
              'general',
              'appearance',
              'ai',
              'simulation',
              'storage',
              'shortcuts',
              'accessibility',
            ] as const
          ).map((item) => (
            <button
              type="button"
              key={item}
              className={tab === item ? 'active' : ''}
              onClick={() => setTab(item)}
            >
              {item === 'ai' ? 'Local AI' : item[0]?.toLocaleUpperCase() + item.slice(1)}
            </button>
          ))}
          <button type="button" onClick={onLicenses}>
            Licenses & notices
          </button>
        </nav>
        <section className="settings-content">
          {tab === 'general' && (
            <>
              <h2>General</h2>
              <div className="callout success">
                Pax Localia has no account, analytics, cloud save, advertising, or automatic update
                check.
              </div>
              <label>
                Simulation detail
                <select
                  value={draft.simulation.detail}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      simulation: {
                        ...current.simulation,
                        detail: event.target.value as AppSettings['simulation']['detail'],
                      },
                    }))
                  }
                >
                  <option value="compact">Compact · smaller local prompts</option>
                  <option value="standard">Standard</option>
                  <option value="detailed">Detailed · larger local prompts</option>
                </select>
              </label>
            </>
          )}
          {tab === 'appearance' && (
            <>
              <h2>Appearance</h2>
              <div className="settings-grid">
                <label>
                  Theme
                  <select
                    value={draft.appearance.theme}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        appearance: {
                          ...current.appearance,
                          theme: event.target.value as AppSettings['appearance']['theme'],
                        },
                      }))
                    }
                  >
                    <option value="dark">Slate & parchment</option>
                    <option value="high-contrast">High contrast</option>
                  </select>
                </label>
                <label>
                  Color-vision palette
                  <select
                    value={draft.appearance.colorblindMode}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        appearance: {
                          ...current.appearance,
                          colorblindMode: event.target
                            .value as AppSettings['appearance']['colorblindMode'],
                        },
                      }))
                    }
                  >
                    <option value="off">Original actor colors</option>
                    <option value="deuteranopia">Deuteranopia-safe</option>
                    <option value="protanopia">Protanopia-safe</option>
                    <option value="tritanopia">Tritanopia-safe</option>
                  </select>
                </label>
                <label>
                  UI scale · {Math.round(draft.appearance.uiScale * 100)}%
                  <input
                    type="range"
                    min={0.8}
                    max={1.5}
                    step={0.05}
                    value={draft.appearance.uiScale}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        appearance: {
                          ...current.appearance,
                          uiScale: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  Text scale · {Math.round(draft.appearance.textScale * 100)}%
                  <input
                    type="range"
                    min={0.8}
                    max={1.5}
                    step={0.05}
                    value={draft.appearance.textScale}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        appearance: {
                          ...current.appearance,
                          textScale: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </label>
              </div>
            </>
          )}
          {tab === 'ai' && (
            <>
              <h2>Local inference</h2>
              <div className="privacy-endpoint">
                <span>Current provider</span>
                <strong>{draft.provider.type}</strong>
                <code>
                  {draft.provider.type === 'deterministic'
                    ? 'No network endpoint'
                    : draft.provider.endpoint}
                </code>
              </div>
              <p>
                LM Studio is recommended. Model files are never bundled or downloaded by Pax
                Localia. State-changing output must pass strict JSON validation and deterministic
                rules before it can be saved.
              </p>
              <div className="row-actions">
                <button type="button" className="button secondary" onClick={onDiagnostics}>
                  Model diagnostics
                </button>
                {(draft.provider.type === 'lm-studio' ||
                  draft.provider.type === 'openai-compatible') &&
                  draft.provider.hasStoredToken && (
                    <button
                      type="button"
                      className="button danger"
                      onClick={() =>
                        void operation('Removing token…', async () => {
                          const result = await window.paxLocalia.settings.forgetToken(
                            draft.provider.type as 'lm-studio' | 'openai-compatible',
                          );
                          const next = await window.paxLocalia.settings.get();
                          setDraft(next);
                          onSaved(next);
                          return result;
                        })
                      }
                    >
                      Forget token
                    </button>
                  )}
              </div>
              <details>
                <summary>Generation limits</summary>
                <div className="settings-grid">
                  <label>
                    Loaded context estimate
                    <input
                      type="number"
                      min={1024}
                      value={draft.provider.contextLength}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          provider: {
                            ...current.provider,
                            contextLength: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Maximum output tokens
                    <input
                      type="number"
                      min={128}
                      max={32768}
                      value={draft.provider.maxOutputTokens}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          provider: {
                            ...current.provider,
                            maxOutputTokens: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Timeout (seconds)
                    <input
                      type="number"
                      min={1}
                      max={600}
                      value={draft.provider.timeoutMs / 1000}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          provider: {
                            ...current.provider,
                            timeoutMs: Number(event.target.value) * 1000,
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Creativity
                    <input
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.05}
                      value={draft.provider.temperature}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          provider: {
                            ...current.provider,
                            temperature: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                </div>
              </details>
            </>
          )}
          {tab === 'simulation' && (
            <>
              <h2>Simulation and long-game memory</h2>
              <div className="settings-grid">
                <label>
                  Turns per factual block summary
                  <input
                    type="number"
                    min={2}
                    max={20}
                    value={draft.simulation.memoryBlockTurns}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        simulation: {
                          ...current.simulation,
                          memoryBlockTurns: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  Blocks per era summary
                  <input
                    type="number"
                    min={2}
                    max={20}
                    value={draft.simulation.memoryEraBlocks}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        simulation: {
                          ...current.simulation,
                          memoryEraBlocks: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  Rolling automatic backups
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={draft.simulation.autosaveBackups}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        simulation: {
                          ...current.simulation,
                          autosaveBackups: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </label>
              </div>
            </>
          )}
          {tab === 'storage' && (
            <>
              <h2>Storage and privacy</h2>
              <div className="path-list">
                <span>Data directory</span>
                <code>{paths?.dataDirectory ?? 'Loading…'}</code>
                <span>Database</span>
                <code>{paths?.databaseFile ?? 'Loading…'}</code>
                <span>Logs</span>
                <code>{paths?.logsDirectory ?? 'Loading…'}</code>
              </div>
              <p>
                Logs contain timestamps, operation names, counts, and sanitized error codes. They
                exclude prompt text, chat text, action text, authorization headers, and tokens.
              </p>
              <div className="button-grid">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    void operation('Checking database…', () =>
                      window.paxLocalia.database.integrityCheck(),
                    )
                  }
                >
                  Run integrity check
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    void operation('Opening logs…', () => window.paxLocalia.app.openLogsDirectory())
                  }
                >
                  Open logs directory
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    void operation('Exporting local data…', () =>
                      window.paxLocalia.app.exportAllData(),
                    )
                  }
                >
                  Export all data
                </button>
                <button
                  type="button"
                  className="button danger"
                  onClick={() =>
                    void operation('Deleting local data…', () =>
                      window.paxLocalia.app.deleteAllData(),
                    )
                  }
                >
                  Delete all user data
                </button>
              </div>
            </>
          )}
          {tab === 'shortcuts' && (
            <>
              <h2>Keyboard shortcuts</h2>
              <dl className="shortcut-list">
                <dt>Ctrl/Cmd + S</dt>
                <dd>Persist the current draft/settings</dd>
                <dt>Ctrl/Cmd + K</dt>
                <dd>Open scenario/search palette</dd>
                <dt>A</dt>
                <dd>Focus action composer</dd>
                <dt>D</dt>
                <dd>Open diplomacy</dd>
                <dt>V</dt>
                <dd>Open advisor</dd>
                <dt>T</dt>
                <dd>Open timeline jump controls</dd>
                <dt>E</dt>
                <dd>Open events</dd>
                <dt>L</dt>
                <dd>Open map layers</dd>
                <dt>Escape</dt>
                <dd>Close the topmost dialog or return</dd>
              </dl>
            </>
          )}
          {tab === 'accessibility' && (
            <>
              <h2>Accessibility</h2>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.appearance.reducedMotion}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      appearance: {
                        ...current.appearance,
                        reducedMotion: event.target.checked,
                      },
                    }))
                  }
                />
                Reduce map and panel motion
              </label>
              <p>
                Ownership conflicts use dashed patterns in addition to color. All main controls are
                keyboard reachable and event/chat feeds use semantic lists.
              </p>
            </>
          )}
          {notice && <div className="callout success">{notice}</div>}
          {error && (
            <div role="alert" className="error-state">
              {error}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
