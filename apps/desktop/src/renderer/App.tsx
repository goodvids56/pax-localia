import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ActorId,
  GameView,
  ScenarioId,
  ScenarioSummary,
  TimelineProgress,
} from '@pax-localia/domain';
import { DiagnosticsPage } from './components/DiagnosticsPage';
import { GameWorld } from './components/GameWorld';
import { ScenarioEditor } from './components/ScenarioEditor';
import { SettingsPage } from './components/SettingsPage';
import { SetupWizard } from './components/SetupWizard';
import thirdPartyNotices from './third-party-notices.txt?raw';
import { useAppStore } from './store';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected local application error.';
}

export default function App() {
  const {
    screen,
    previousScreen,
    settings,
    scenarios,
    games,
    selectedScenario,
    game,
    loading,
    error,
    notice,
    progress,
    setScreen,
    setSettings,
    setScenarios,
    setGames,
    setSelectedScenario,
    setGame,
    setLoading,
    setError,
    setNotice,
    setProgress,
  } = useAppStore();
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('all');
  const [newActorId, setNewActorId] = useState<ActorId>();
  const [newTitle, setNewTitle] = useState('');
  const [difficulty, setDifficulty] = useState<'story' | 'standard' | 'challenging'>('standard');
  const [fogOfWar, setFogOfWar] = useState(true);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2_000_000_000));

  const refreshLibrary = useCallback(async (): Promise<void> => {
    const [nextScenarios, nextGames] = await Promise.all([
      window.paxLocalia.scenarios.list(),
      window.paxLocalia.games.list(),
    ]);
    setScenarios(nextScenarios);
    setGames(nextGames);
  }, [setGames, setScenarios]);

  useEffect(() => {
    let active = true;
    setLoading('Opening local database and validating bundled scenarios…');
    void Promise.all([
      window.paxLocalia.settings.get(),
      window.paxLocalia.scenarios.list(),
      window.paxLocalia.games.list(),
    ])
      .then(([nextSettings, nextScenarios, nextGames]) => {
        if (!active) return;
        setSettings(nextSettings);
        setScenarios(nextScenarios);
        setGames(nextGames);
        if (!nextSettings.firstRunComplete) setScreen('setup');
        setLoading('');
      })
      .catch((caught) => {
        if (active) setError(message(caught));
      });
    return () => {
      active = false;
    };
  }, [setError, setGames, setLoading, setScenarios, setScreen, setSettings]);

  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.appearance.theme;
    document.documentElement.style.setProperty('--ui-scale', String(settings.appearance.uiScale));
    document.documentElement.style.setProperty(
      '--text-scale',
      String(settings.appearance.textScale),
    );
    document.documentElement.classList.toggle('reduced-motion', settings.appearance.reducedMotion);
  }, [settings]);

  const handleProgress = useCallback(
    (next?: TimelineProgress): void => setProgress(next),
    [setProgress],
  );

  const openScenario = async (
    summaryOrId: ScenarioSummary | ScenarioId,
    destination: 'new-game' | 'editor',
  ): Promise<void> => {
    setLoading('Loading scenario…');
    setError('');
    try {
      const id = typeof summaryOrId === 'string' ? summaryOrId : summaryOrId.id;
      const scenario = await window.paxLocalia.scenarios.get(id);
      setSelectedScenario(scenario);
      setNewActorId(
        Object.values(scenario.initialWorld.actors).find(
          (actor) => actor.isPlayable && actor.isActive,
        )?.id,
      );
      setNewTitle(`${scenario.title} — ${new Date().toLocaleDateString()}`);
      setDifficulty(scenario.defaultDifficulty);
      setFogOfWar(scenario.featureFlags.fogOfWar);
      setScreen(destination);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading('');
    }
  };

  const openGame = async (id: GameView['summary']['id']): Promise<void> => {
    setLoading('Loading immutable snapshot and local projections…');
    setError('');
    try {
      const loaded = await window.paxLocalia.games.load(id);
      const scenario = await window.paxLocalia.scenarios.get(loaded.summary.scenarioId);
      setGame(loaded);
      setSelectedScenario(scenario);
      setScreen('game');
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading('');
    }
  };

  const startGame = async (): Promise<void> => {
    if (!selectedScenario || !newActorId || !settings) return;
    setLoading('Creating local game and turn-zero snapshot…');
    setError('');
    try {
      const created = await window.paxLocalia.games.create({
        scenarioId: selectedScenario.id,
        actorId: newActorId,
        title: newTitle,
        difficulty,
        provider: settings.provider.type,
        model: settings.provider.model,
        creativity: settings.provider.temperature,
        detail: settings.simulation.detail,
        fogOfWar,
        seed,
      });
      setGame(created);
      await refreshLibrary();
      setScreen('game');
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading('');
    }
  };

  const filteredScenarios = useMemo(() => {
    const query = search.toLocaleLowerCase();
    return scenarios.filter(
      (scenario) =>
        (tag === 'all' || scenario.tags.includes(tag)) &&
        (!query ||
          scenario.title.toLocaleLowerCase().includes(query) ||
          scenario.subtitle.toLocaleLowerCase().includes(query) ||
          scenario.tags.some((item) => item.toLocaleLowerCase().includes(query))),
    );
  }, [scenarios, search, tag]);
  const tags = useMemo(
    () => [...new Set(scenarios.flatMap((scenario) => scenario.tags))].sort(),
    [scenarios],
  );

  if (!settings || (loading && !settings)) {
    return (
      <main className="boot-screen">
        <div className="brand-mark">PL</div>
        <h1>Pax Localia</h1>
        <p>{loading || 'Opening local application…'}</p>
        {error && <div className="error-state">{error}</div>}
      </main>
    );
  }

  if (screen === 'setup') {
    return (
      <SetupWizard
        settings={settings}
        onSaved={setSettings}
        onComplete={() => setScreen('home')}
        onDiagnostics={() => setScreen('diagnostics')}
      />
    );
  }

  if (screen === 'settings') {
    return (
      <SettingsPage
        settings={settings}
        onClose={() => setScreen(previousScreen === 'settings' ? 'home' : previousScreen)}
        onSaved={setSettings}
        onDiagnostics={() => setScreen('diagnostics')}
        onLicenses={() => setScreen('licenses')}
      />
    );
  }

  if (screen === 'diagnostics') {
    return (
      <DiagnosticsPage
        settings={settings}
        onClose={() => setScreen(settings.firstRunComplete ? 'settings' : 'setup')}
        onSettings={setSettings}
      />
    );
  }

  if (screen === 'licenses') {
    return (
      <main className="document-page">
        <header className="screen-header">
          <button
            type="button"
            className="icon-button"
            onClick={() => setScreen('settings')}
            aria-label="Close licenses"
          >
            ←
          </button>
          <div>
            <p className="eyebrow">Acknowledgements</p>
            <h1>Licenses and third-party notices</h1>
          </div>
        </header>
        <section className="document-content">
          <div className="callout">
            Pax Localia is original software distributed under GPL-3.0-or-later. It contains no Pax
            Historia source, prompts, presets, branding, maps, or proprietary assets.
          </div>
          <pre>{thirdPartyNotices}</pre>
        </section>
      </main>
    );
  }

  if (screen === 'editor' && selectedScenario) {
    return (
      <ScenarioEditor
        scenario={selectedScenario}
        onClose={() => setScreen('library')}
        onSaved={(saved) => {
          setSelectedScenario(saved);
          setNotice('Scenario saved locally.');
          void refreshLibrary();
        }}
        onTestLaunch={(scenario) => {
          setSelectedScenario(scenario);
          setNewActorId(
            Object.values(scenario.initialWorld.actors).find(
              (actor) => actor.isPlayable && actor.isActive,
            )?.id,
          );
          setNewTitle(`${scenario.title} — Test`);
          setScreen('new-game');
        }}
      />
    );
  }

  if (screen === 'new-game' && selectedScenario) {
    const actors = Object.values(selectedScenario.initialWorld.actors).filter(
      (actor) => actor.isPlayable && actor.isActive,
    );
    return (
      <main className="new-game-page">
        <header className="screen-header">
          <button
            type="button"
            className="icon-button"
            onClick={() => setScreen('library')}
            aria-label="Back to scenarios"
          >
            ←
          </button>
          <div>
            <p className="eyebrow">New timeline</p>
            <h1>{selectedScenario.title}</h1>
          </div>
        </header>
        <section className="new-game-layout">
          <div className="scenario-intro panel">
            <p className="eyebrow">{selectedScenario.startDate}</p>
            <h2>{selectedScenario.subtitle}</h2>
            <p>{selectedScenario.description}</p>
            <h3>World premise</h3>
            <p>{selectedScenario.worldSummary}</p>
            <div className="tag-row">
              {selectedScenario.tags.map((item) => (
                <span className="badge" key={item}>
                  {item}
                </span>
              ))}
            </div>
          </div>
          <form
            className="new-game-form panel"
            onSubmit={(event) => {
              event.preventDefault();
              void startGame();
            }}
          >
            <h2>Choose your actor</h2>
            <div className="actor-choice-grid">
              {actors.map((actor) => (
                <label
                  key={actor.id}
                  className={newActorId === actor.id ? 'selected' : ''}
                  style={{ borderColor: actor.color }}
                >
                  <input
                    type="radio"
                    name="actor"
                    value={actor.id}
                    checked={newActorId === actor.id}
                    onChange={() => setNewActorId(actor.id)}
                  />
                  <strong>{actor.name}</strong>
                  <span>{actor.kind}</span>
                  <small>{actor.government}</small>
                </label>
              ))}
            </div>
            <label>
              Game title
              <input
                value={newTitle}
                maxLength={160}
                onChange={(event) => setNewTitle(event.target.value)}
                required
              />
            </label>
            <div className="settings-grid">
              <label>
                Difficulty
                <select
                  value={difficulty}
                  onChange={(event) =>
                    setDifficulty(event.target.value as 'story' | 'standard' | 'challenging')
                  }
                >
                  <option value="story">Story · lower resistance</option>
                  <option value="standard">Standard</option>
                  <option value="challenging">Challenging · coordinated resistance</option>
                </select>
              </label>
              <label>
                Local provider
                <input
                  readOnly
                  value={
                    settings.provider.type === 'deterministic'
                      ? 'Deterministic rules (no model)'
                      : `${settings.provider.type} · ${settings.provider.model || 'no model selected'}`
                  }
                />
              </label>
              <label>
                Reproducible seed
                <input
                  type="number"
                  value={seed}
                  onChange={(event) => setSeed(Number(event.target.value))}
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={fogOfWar}
                  disabled={!selectedScenario.featureFlags.fogOfWar}
                  onChange={(event) => setFogOfWar(event.target.checked)}
                />
                Fog of war
              </label>
            </div>
            {settings.provider.type !== 'deterministic' && !settings.provider.model && (
              <div className="error-state">
                Select and test a local model in Settings, or choose deterministic mode.
              </div>
            )}
            <button
              type="submit"
              className="button primary large"
              disabled={
                !newActorId ||
                !newTitle.trim() ||
                (settings.provider.type !== 'deterministic' && !settings.provider.model)
              }
            >
              Create local timeline
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (screen === 'game' && game && selectedScenario) {
    return (
      <GameWorld
        game={game}
        scenario={selectedScenario}
        settings={settings}
        progress={progress}
        onGame={setGame}
        onHome={() => {
          void refreshLibrary();
          setScreen('home');
        }}
        onSettings={() => setScreen('settings')}
        onProgress={handleProgress}
      />
    );
  }

  if (screen === 'library') {
    return (
      <main className="library-page">
        <header className="screen-header">
          <button
            type="button"
            className="icon-button"
            onClick={() => setScreen('home')}
            aria-label="Back home"
          >
            ←
          </button>
          <div>
            <p className="eyebrow">Local content</p>
            <h1>Scenario library</h1>
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              void window.paxLocalia.scenarios
                .import()
                .then((result) => {
                  setNotice(result.message);
                  return refreshLibrary();
                })
                .catch((caught) => setError(message(caught)))
            }
          >
            Import .chronicle
          </button>
        </header>
        <section className="library-tools">
          <input
            type="search"
            placeholder="Search titles, descriptions, and tags…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select value={tag} onChange={(event) => setTag(event.target.value)}>
            <option value="all">All tags</option>
            {tags.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <span>{filteredScenarios.length} local scenarios</span>
        </section>
        <section className="scenario-grid">
          {filteredScenarios.map((scenario, index) => (
            <article className="scenario-card" key={scenario.id}>
              <div className={`scenario-art art-${index % 3}`}>
                <span>{scenario.startDate.slice(0, 4)}</span>
                <strong>{scenario.title.slice(0, 2).toLocaleUpperCase()}</strong>
              </div>
              <div>
                <p className="eyebrow">{scenario.author}</p>
                <h2>{scenario.title}</h2>
                <p>{scenario.subtitle}</p>
                <div className="tag-row">
                  {scenario.tags.slice(0, 4).map((item) => (
                    <span className="badge" key={item}>
                      {item}
                    </span>
                  ))}
                </div>
                <dl>
                  <dt>Start</dt>
                  <dd>{scenario.startDate}</dd>
                  <dt>Playable actors</dt>
                  <dd>{scenario.playableActors}</dd>
                  <dt>License</dt>
                  <dd>{scenario.license}</dd>
                </dl>
                <div className="card-actions">
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => void openScenario(scenario, 'new-game')}
                  >
                    Start timeline
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      void window.paxLocalia.scenarios
                        .duplicate(scenario.id)
                        .then((copy) => {
                          setSelectedScenario(copy);
                          setScreen('editor');
                          return refreshLibrary();
                        })
                        .catch((caught) => setError(message(caught)))
                    }
                  >
                    Duplicate & edit
                  </button>
                  <button
                    type="button"
                    className="button subtle"
                    onClick={() =>
                      void window.paxLocalia.scenarios
                        .export(scenario.id)
                        .then((result) => setNotice(result.message))
                        .catch((caught) => setError(message(caught)))
                    }
                  >
                    Export
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
        {filteredScenarios.length === 0 && (
          <div className="empty-state large">
            No local scenario matches this filter. Clear the search or import a package.
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="home-page">
      <header className="home-header">
        <div className="brand">
          <span className="brand-mark">PL</span>
          <div>
            <p className="eyebrow">Offline geopolitical sandbox</p>
            <h1>Pax Localia</h1>
          </div>
        </div>
        <div className="provider-pill">
          <span className="status-light online" />
          {settings.provider.type === 'deterministic'
            ? 'Deterministic mode'
            : `${settings.provider.type} · ${settings.provider.model || 'model not selected'}`}
        </div>
        <button type="button" className="button subtle" onClick={() => setScreen('settings')}>
          Settings
        </button>
      </header>
      <section className="home-hero">
        <div>
          <p className="eyebrow">History is paused</p>
          <h2>Choose the pressure point. The world will answer.</h2>
          <p>
            Direct nations, factions, organizations, and characters across branching local
            timelines. Every save, chat, map, and model request remains under your control.
          </p>
          <div className="row-actions">
            <button
              type="button"
              className="button primary large"
              onClick={() => setScreen('library')}
            >
              Create a new timeline
            </button>
            <button
              type="button"
              className="button secondary large"
              onClick={() => {
                const first = scenarios[0];
                if (first) {
                  void window.paxLocalia.scenarios
                    .duplicate(first.id)
                    .then((copy) => {
                      setSelectedScenario(copy);
                      setScreen('editor');
                      return refreshLibrary();
                    })
                    .catch((caught) => setError(message(caught)));
                }
              }}
            >
              Scenario workshop
            </button>
          </div>
        </div>
        <div className="hero-globe" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
      <section className="home-section">
        <header>
          <div>
            <p className="eyebrow">Autosaved locally</p>
            <h2>Continue a timeline</h2>
          </div>
          <button
            type="button"
            className="button subtle"
            onClick={() =>
              void window.paxLocalia.games
                .import()
                .then((result) => {
                  setNotice(result.message);
                  return refreshLibrary();
                })
                .catch((caught) => setError(message(caught)))
            }
          >
            Import save
          </button>
        </header>
        {games.length > 0 ? (
          <div className="recent-grid">
            {games.slice(0, 6).map((recent) => (
              <article key={recent.id} className="recent-card">
                <span className="timeline-thread" />
                <p className="eyebrow">{recent.actorName}</p>
                <h3>{recent.title}</h3>
                <p>
                  {recent.branchLabel} · turn {recent.turnNumber}
                </p>
                <time>{recent.date}</time>
                <div className="card-actions">
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => void openGame(recent.id)}
                  >
                    Continue
                  </button>
                  <button
                    type="button"
                    className="button subtle"
                    onClick={() =>
                      void window.paxLocalia.games
                        .export(recent.id)
                        .then((result) => setNotice(result.message))
                        .catch((caught) => setError(message(caught)))
                    }
                  >
                    Export
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state large">
            <strong>No timelines yet.</strong>
            <span>Choose a bundled scenario to create a turn-zero snapshot.</span>
          </div>
        )}
      </section>
      <section className="home-section">
        <header>
          <div>
            <p className="eyebrow">Bundled · no downloads</p>
            <h2>Featured scenarios</h2>
          </div>
          <button type="button" className="button subtle" onClick={() => setScreen('library')}>
            Browse all
          </button>
        </header>
        <div className="featured-row">
          {scenarios.slice(0, 3).map((scenario) => (
            <button
              type="button"
              key={scenario.id}
              onClick={() => void openScenario(scenario, 'new-game')}
            >
              <span>{scenario.startDate.slice(0, 4)}</span>
              <strong>{scenario.title}</strong>
              <small>{scenario.subtitle}</small>
            </button>
          ))}
        </div>
      </section>
      {(loading || error || notice) && (
        <div className={`toast ${error ? 'error' : notice ? 'success' : ''}`} role="status">
          {error || notice || loading}
          {(error || notice) && (
            <button
              type="button"
              onClick={() => {
                setError('');
                setNotice('');
              }}
              aria-label="Dismiss"
            >
              ×
            </button>
          )}
        </div>
      )}
    </main>
  );
}
