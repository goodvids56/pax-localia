import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatInWorldDate,
  type ActorId,
  type AppSettings,
  type BranchId,
  type Commitment,
  type Conversation,
  type GameAction,
  type GameView,
  type JumpSize,
  type RegionId,
  type Scenario,
  type SnapshotComparison,
  type TimelineProgress,
} from '@pax-localia/domain';
import { PoliticalMap } from './PoliticalMap';

interface GameWorldProps {
  game: GameView;
  scenario: Scenario;
  settings: AppSettings;
  progress: TimelineProgress | undefined;
  onGame: (game: GameView) => void;
  onHome: () => void;
  onSettings: () => void;
  onProgress: (progress?: TimelineProgress) => void;
}

type BottomTab = 'actions' | 'diplomacy' | 'advisor';
type LeftTab = 'events' | 'actors' | 'objectives' | 'history' | 'layers';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown local operation error.';
}

export function GameWorld({
  game,
  scenario,
  settings,
  progress,
  onGame,
  onHome,
  onSettings,
  onProgress,
}: GameWorldProps) {
  const [leftTab, setLeftTab] = useState<LeftTab>('events');
  const [bottomTab, setBottomTab] = useState<BottomTab>('actions');
  const [selectedRegionId, setSelectedRegionId] = useState<RegionId>();
  const [selectedActorId, setSelectedActorId] = useState(game.world.playerActorId);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [actionText, setActionText] = useState('');
  const [editingAction, setEditingAction] = useState<GameAction>();
  const [classification, setClassification] = useState<GameAction['classification']>('public');
  const [priority, setPriority] = useState(3);
  const [effort, setEffort] = useState(50);
  const [jump, setJump] = useState<JumpSize>(scenario.allowedJumps[1] ?? scenario.allowedJumps[0]!);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [eventSearch, setEventSearch] = useState('');
  const [eventCategory, setEventCategory] = useState('all');
  const [visibleEvents, setVisibleEvents] = useState(100);
  const [conversationId, setConversationId] = useState<Conversation['id']>();
  const [chatText, setChatText] = useState('');
  const [chatActorIds, setChatActorIds] = useState<ActorId[]>([]);
  const [advisorText, setAdvisorText] = useState('');
  const [comparison, setComparison] = useState<SnapshotComparison>();
  const [compareBranchId, setCompareBranchId] = useState<BranchId>();
  const [rewindTurn, setRewindTurn] = useState<number>();
  const [rewindLabel, setRewindLabel] = useState('');
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const reload = useCallback(async (): Promise<void> => {
    onGame(await window.paxLocalia.games.load(game.summary.id));
  }, [game.summary.id, onGame]);

  useEffect(() => {
    const unsubscribe = window.paxLocalia.timeline.onProgress(onProgress);
    return unsubscribe;
  }, [onProgress]);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const typing =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement;
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault();
        setNotice('All game changes are already saved locally.');
        return;
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      switch (event.key.toLocaleLowerCase()) {
        case 'a':
          setBottomTab('actions');
          requestAnimationFrame(() => composerRef.current?.focus());
          break;
        case 'd':
          setBottomTab('diplomacy');
          break;
        case 'v':
          setBottomTab('advisor');
          break;
        case 't':
          document.querySelector<HTMLSelectElement>('#jump-size')?.focus();
          break;
        case 'e':
          setLeftCollapsed(false);
          setLeftTab('events');
          break;
        case 'l':
          setLeftCollapsed(false);
          setLeftTab('layers');
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const selectRegion = useCallback(
    (id: RegionId): void => {
      setSelectedRegionId(id);
      const actorId = game.world.regions[id]?.controllerId;
      if (actorId) setSelectedActorId(actorId);
      setRightCollapsed(false);
    },
    [game.world.regions],
  );
  const selectActor = useCallback((id: ActorId): void => {
    setSelectedActorId(id);
    setRightCollapsed(false);
  }, []);

  const drafts = game.actions.filter((action) => action.status === 'draft');
  const selectedRegion = selectedRegionId ? game.world.regions[selectedRegionId] : undefined;
  const selectedActor = game.world.actors[selectedActorId];
  const player = game.world.actors[game.world.playerActorId];
  const currentConversation = game.conversations.find(
    (conversation) => conversation.id === conversationId,
  );
  const filteredEvents = useMemo(() => {
    const query = eventSearch.toLocaleLowerCase();
    return game.events.filter(
      (event) =>
        (eventCategory === 'all' || event.category === eventCategory) &&
        (!query ||
          event.title.toLocaleLowerCase().includes(query) ||
          event.narrative.toLocaleLowerCase().includes(query)),
    );
  }, [game.events, eventSearch, eventCategory]);

  if (!player) {
    return <div className="error-state">The player actor is missing from this snapshot.</div>;
  }

  const saveAction = async (): Promise<void> => {
    if (!actionText.trim()) return;
    setBusy('Saving action draft…');
    setError('');
    try {
      await window.paxLocalia.actions.save({
        gameId: game.summary.id,
        branchId: game.summary.branchId,
        ...(editingAction ? { id: editingAction.id } : {}),
        text: actionText,
        targetActorIds:
          selectedActorId && selectedActorId !== game.world.playerActorId ? [selectedActorId] : [],
        targetRegionIds: selectedRegionId ? [selectedRegionId] : [],
        classification,
        priority,
        effort,
      });
      setActionText('');
      setEditingAction(undefined);
      await reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  };

  const editAction = (action: GameAction): void => {
    setEditingAction(action);
    setActionText(action.originalText);
    setClassification(action.classification);
    setPriority(action.priority);
    setEffort(action.effort);
    setBottomTab('actions');
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const removeAction = async (action: GameAction): Promise<void> => {
    setBusy('Deleting draft…');
    try {
      await window.paxLocalia.actions.remove(action.gameId, action.branchId, action.id);
      await reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  };

  const moveAction = async (action: GameAction, offset: number): Promise<void> => {
    const index = drafts.findIndex((candidate) => candidate.id === action.id);
    const target = index + offset;
    if (target < 0 || target >= drafts.length) return;
    const ids = drafts.map((candidate) => candidate.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    try {
      await window.paxLocalia.actions.reorder(game.summary.id, game.summary.branchId, ids);
      await reload();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const advance = async (): Promise<void> => {
    setBusy('Preparing time jump…');
    setError('');
    setNotice('');
    try {
      await window.paxLocalia.timeline.jump({
        gameId: game.summary.id,
        branchId: game.summary.branchId,
        jump,
        provider: settings.provider.type,
        model:
          settings.featureModels.simulation || settings.provider.model || 'deterministic-rules-v1',
      });
      await reload();
      setNotice('Timeline advanced and snapshot saved.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
      window.setTimeout(() => onProgress(undefined), 1_000);
    }
  };

  const sendChat = async (): Promise<void> => {
    const participantActorIds =
      currentConversation?.participantActorIds ??
      chatActorIds.filter((id) => id !== game.world.playerActorId);
    if (!chatText.trim() || participantActorIds.length === 0) return;
    setBusy('Generating local diplomatic reply…');
    setError('');
    try {
      const conversation = await window.paxLocalia.chats.send({
        gameId: game.summary.id,
        branchId: game.summary.branchId,
        ...(currentConversation ? { conversationId: currentConversation.id } : {}),
        participantActorIds,
        type: participantActorIds.length > 1 ? 'group' : 'private',
        text: chatText,
      });
      setConversationId(conversation.id);
      setChatText('');
      await reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  };

  const respondToCommitment = async (
    commitmentId: Commitment['id'],
    response: 'accepted' | 'rejected' | 'pending',
  ): Promise<void> => {
    setBusy(
      `${response === 'pending' ? 'Deferring' : response === 'accepted' ? 'Accepting' : 'Rejecting'} commitment…`,
    );
    setError('');
    try {
      await window.paxLocalia.chats.respondCommitment(
        game.summary.id,
        game.summary.branchId,
        commitmentId,
        response,
      );
      await reload();
      setNotice(
        response === 'pending'
          ? 'Commitment left pending for later review.'
          : `Commitment ${response}. It will influence later simulation.`,
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  };

  const askAdvisor = async (prompt = advisorText): Promise<void> => {
    if (!prompt.trim()) return;
    setBusy('Consulting the local advisor…');
    setError('');
    try {
      const advisorConversation = game.conversations.find(
        (conversation) => conversation.type === 'advisor' && !conversation.archived,
      );
      await window.paxLocalia.advisor.ask({
        gameId: game.summary.id,
        branchId: game.summary.branchId,
        ...(advisorConversation ? { conversationId: advisorConversation.id } : {}),
        participantActorIds: [],
        type: 'advisor',
        text: prompt,
      });
      setAdvisorText('');
      await reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  };

  const createBranch = async (): Promise<void> => {
    if (rewindTurn === undefined || !rewindLabel.trim()) return;
    setBusy('Creating non-destructive branch…');
    try {
      onGame(
        await window.paxLocalia.timeline.rewind({
          gameId: game.summary.id,
          sourceBranchId: game.summary.branchId,
          turnNumber: rewindTurn,
          label: rewindLabel,
        }),
      );
      setRewindTurn(undefined);
      setRewindLabel('');
      setNotice('New branch created. The original future remains available.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  };

  const advisorConversation = game.conversations.find(
    (conversation) => conversation.type === 'advisor' && !conversation.archived,
  );

  return (
    <main className="game-page">
      <header className="game-topbar">
        <button type="button" className="icon-button" onClick={onHome} aria-label="Return home">
          ⌂
        </button>
        <div className="game-identity">
          <strong>{game.summary.title}</strong>
          <span>{game.summary.branchLabel}</span>
        </div>
        <div className="date-block">
          <span>PAUSED</span>
          <strong>{formatInWorldDate(game.world.date)}</strong>
        </div>
        <div className="provider-pill">
          <span className="status-light online" />
          {settings.provider.type === 'deterministic'
            ? 'Deterministic'
            : `${settings.provider.type} · local`}
        </div>
        <div className="save-indicator" title="Completed turns are transactional and autosaved">
          ✓ Saved locally
        </div>
        <label className="jump-select">
          <span>Advance</span>
          <select
            id="jump-size"
            value={`${jump.unit}:${jump.value}`}
            onChange={(event) => {
              const next = scenario.allowedJumps.find(
                (candidate) => `${candidate.unit}:${candidate.value}` === event.target.value,
              );
              if (next) setJump(next);
            }}
          >
            {scenario.allowedJumps.map((candidate) => (
              <option
                key={`${candidate.unit}:${candidate.value}`}
                value={`${candidate.unit}:${candidate.value}`}
              >
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button primary"
          disabled={Boolean(
            progress && !['complete', 'failed', 'cancelled'].includes(progress.phase),
          )}
          onClick={() => void advance()}
        >
          Advance time
        </button>
        <button type="button" className="icon-button" onClick={onSettings} aria-label="Settings">
          ⚙
        </button>
      </header>

      <div
        className={`game-workspace ${leftCollapsed ? 'left-collapsed' : ''} ${rightCollapsed ? 'right-collapsed' : ''}`}
      >
        <nav className="left-rail" aria-label="World view sections">
          {(
            [
              ['events', 'E', 'Events'],
              ['actors', '◉', 'Actors'],
              ['objectives', '◇', 'Objectives'],
              ['history', '⌘', 'History and branches'],
              ['layers', '▱', 'Map layers'],
            ] as const
          ).map(([id, icon, label]) => (
            <button
              type="button"
              key={id}
              className={leftTab === id && !leftCollapsed ? 'active' : ''}
              onClick={() => {
                setLeftTab(id);
                setLeftCollapsed(false);
              }}
              title={label}
              aria-label={label}
            >
              <span>{icon}</span>
              <small>{label.split(' ')[0]}</small>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setLeftCollapsed((value) => !value)}
            aria-label={leftCollapsed ? 'Expand left panel' : 'Collapse left panel'}
          >
            {leftCollapsed ? '›' : '‹'}
          </button>
        </nav>

        {!leftCollapsed && (
          <aside className="left-panel panel" aria-label={`${leftTab} panel`}>
            {leftTab === 'events' && (
              <>
                <header>
                  <h2>Event timeline</h2>
                  <span>{filteredEvents.length}</span>
                </header>
                <div className="filter-row">
                  <input
                    type="search"
                    placeholder="Search events…"
                    value={eventSearch}
                    onChange={(event) => setEventSearch(event.target.value)}
                    aria-label="Search events"
                  />
                  <select
                    value={eventCategory}
                    onChange={(event) => setEventCategory(event.target.value)}
                    aria-label="Filter event category"
                  >
                    <option value="all">All</option>
                    {[
                      'politics',
                      'diplomacy',
                      'military',
                      'economy',
                      'society',
                      'science',
                      'environment',
                      'mystery',
                      'system',
                    ].map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </div>
                <ol className="event-feed" aria-live="polite">
                  {filteredEvents.slice(0, visibleEvents).map((event) => (
                    <li key={event.id} className={`severity-${event.severity}`}>
                      <div>
                        <time>{event.date}</time>
                        <span className="event-category">{event.category}</span>
                        <span aria-label={`Severity ${event.severity}`}>
                          {'◆'.repeat(event.severity)}
                        </span>
                      </div>
                      <h3>{event.title}</h3>
                      <p>{event.narrative}</p>
                      {event.explanationFactors.length > 0 && (
                        <details>
                          <summary>Why did this happen?</summary>
                          <ul>
                            {event.explanationFactors.map((factor) => (
                              <li key={factor}>{factor}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
                {visibleEvents < filteredEvents.length && (
                  <button
                    type="button"
                    className="button subtle full"
                    onClick={() => setVisibleEvents((count) => count + 100)}
                  >
                    Show 100 more
                  </button>
                )}
              </>
            )}
            {leftTab === 'actors' && (
              <>
                <header>
                  <h2>Actors</h2>
                </header>
                <div className="actor-directory">
                  {Object.values(game.world.actors).map((actor) => (
                    <button
                      type="button"
                      key={actor.id}
                      className={actor.id === selectedActorId ? 'active' : ''}
                      onClick={() => selectActor(actor.id)}
                    >
                      <span className="legend-swatch" style={{ background: actor.color }} />
                      <span>
                        <strong>{actor.name}</strong>
                        <small>
                          {actor.kind} · {actor.isActive ? 'active' : 'inactive'}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {leftTab === 'objectives' && (
              <>
                <header>
                  <h2>Objectives</h2>
                </header>
                {scenario.objectives.length ? (
                  <ul className="objective-list">
                    {scenario.objectives.map((objective) => (
                      <li key={objective}>
                        <span>◇</span>
                        {objective}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-state">This is an open sandbox without formal objectives.</p>
                )}
                <h3>Open commitments</h3>
                <ul className="commitment-list">
                  {game.world.commitments
                    .filter((commitment) => ['pending', 'accepted'].includes(commitment.status))
                    .map((commitment) => (
                      <li key={commitment.id}>
                        <span className="badge">{commitment.kind}</span>
                        <strong>{commitment.summary}</strong>
                        <small>{commitment.status}</small>
                      </li>
                    ))}
                </ul>
              </>
            )}
            {leftTab === 'history' && (
              <>
                <header>
                  <h2>Branches</h2>
                  <span>{game.branches.length}</span>
                </header>
                <ul className="branch-list">
                  {game.branches.map((branch) => (
                    <li
                      key={branch.id}
                      className={branch.id === game.summary.branchId ? 'active' : ''}
                    >
                      <strong>{branch.label}</strong>
                      <span>{branch.date}</span>
                      <small>
                        Turn {branch.turnCount} · branch point {branch.branchPointTurn}
                      </small>
                      {branch.id !== game.summary.branchId && (
                        <button
                          type="button"
                          className="button subtle"
                          onClick={() =>
                            void window.paxLocalia.timeline
                              .switchBranch(game.summary.id, branch.id)
                              .then((switched) => {
                                onGame(switched);
                                setNotice(`Switched to ${branch.label}.`);
                              })
                              .catch((caught) => setError(errorMessage(caught)))
                          }
                        >
                          Switch to branch
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <h3>Rewind into a new branch</h3>
                <label>
                  Snapshot turn
                  <input
                    type="number"
                    min={0}
                    max={game.world.turnNumber}
                    value={rewindTurn ?? ''}
                    onChange={(event) =>
                      setRewindTurn(event.target.value ? Number(event.target.value) : undefined)
                    }
                  />
                </label>
                <label>
                  New branch label
                  <input
                    value={rewindLabel}
                    onChange={(event) => setRewindLabel(event.target.value)}
                    placeholder="A different course"
                  />
                </label>
                <button
                  type="button"
                  className="button secondary full"
                  disabled={rewindTurn === undefined || !rewindLabel.trim()}
                  onClick={() => void createBranch()}
                >
                  Create branch
                </button>
                {game.branches.length > 1 && (
                  <>
                    <h3>Compare current state</h3>
                    <select
                      value={compareBranchId ?? ''}
                      onChange={(event) =>
                        setCompareBranchId(
                          (event.target.value || undefined) as BranchId | undefined,
                        )
                      }
                    >
                      <option value="">Choose another branch…</option>
                      {game.branches
                        .filter((branch) => branch.id !== game.summary.branchId)
                        .map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.label}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="button subtle full"
                      disabled={!compareBranchId}
                      onClick={() =>
                        void (async () => {
                          if (!compareBranchId) return;
                          setComparison(
                            await window.paxLocalia.timeline.compare(
                              game.summary.id,
                              game.summary.branchId,
                              compareBranchId,
                            ),
                          );
                        })()
                      }
                    >
                      Compare
                    </button>
                    {comparison && (
                      <div className="comparison">
                        <strong>{comparison.territoryChanges.length} territory changes</strong>
                        <strong>{comparison.statChanges.length} statistic changes</strong>
                        {comparison.territoryChanges.map((change) => (
                          <p key={change.regionId}>
                            {change.regionName}: {change.leftOwner} ↔ {change.rightOwner}
                          </p>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {leftTab === 'layers' && (
              <>
                <header>
                  <h2>Map guide</h2>
                </header>
                <p>
                  Layer controls are overlaid on the map. Legal ownership and military control use
                  the same stable atomic regions; dashed boundaries indicate contested or occupied
                  territory.
                </p>
                <ul>
                  <li>Click a region to inspect it.</li>
                  <li>Scroll or use +/− to zoom.</li>
                  <li>Drag to pan.</li>
                  <li>Use Fit world to restore the view.</li>
                </ul>
              </>
            )}
          </aside>
        )}

        <section className="map-area">
          <PoliticalMap
            datasetId={scenario.mapDatasetId}
            world={game.world}
            selectedRegionId={selectedRegionId}
            reducedMotion={settings.appearance.reducedMotion}
            colorblindMode={settings.appearance.colorblindMode}
            onSelectRegion={selectRegion}
            onSelectActor={selectActor}
          />
        </section>

        {!rightCollapsed && (
          <aside className="right-panel panel" aria-label="Context inspector">
            <header>
              <div>
                <p className="eyebrow">{selectedRegion ? 'Region' : 'Actor'}</p>
                <h2>{selectedRegion?.name ?? selectedActor?.name ?? 'World inspector'}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setRightCollapsed(true)}
                aria-label="Collapse inspector"
              >
                ›
              </button>
            </header>
            {selectedRegion ? (
              <div className="inspector-content">
                <div className="ownership-card">
                  <span>Legal owner</span>
                  <strong>
                    {selectedRegion.ownerId
                      ? (game.world.actors[selectedRegion.ownerId]?.name ?? 'Unknown')
                      : 'None'}
                  </strong>
                  <span>Controller</span>
                  <strong>
                    {selectedRegion.controllerId
                      ? (game.world.actors[selectedRegion.controllerId]?.name ?? 'Unknown')
                      : 'None'}
                  </strong>
                  {(selectedRegion.contested || selectedRegion.occupied) && (
                    <span className="badge danger">
                      {selectedRegion.occupied ? 'Occupied' : 'Contested'}
                    </span>
                  )}
                </div>
                <dl className="detail-list">
                  <dt>Population</dt>
                  <dd>{selectedRegion.population.toLocaleString()}</dd>
                  <dt>Terrain</dt>
                  <dd>{selectedRegion.terrain}</dd>
                  <dt>Development</dt>
                  <dd>{selectedRegion.development}/100</dd>
                  <dt>Infrastructure</dt>
                  <dd>{selectedRegion.infrastructure}/100</dd>
                  <dt>Strategic value</dt>
                  <dd>{selectedRegion.strategicValue}/100</dd>
                  <dt>Resources</dt>
                  <dd>{selectedRegion.resources.join(', ') || 'None reported'}</dd>
                </dl>
                <h3>Cities and units</h3>
                {selectedRegion.cityIds.map((id) => (
                  <p key={id}>{game.world.cities[id]?.name ?? id}</p>
                ))}
                {selectedRegion.unitIds.map((id) => {
                  const unit = game.world.units[id];
                  return unit ? (
                    <p key={id}>
                      {unit.name} · strength {unit.strength} · supply {unit.supply}
                    </p>
                  ) : null;
                })}
              </div>
            ) : selectedActor ? (
              <div className="inspector-content">
                <div className="actor-banner" style={{ borderColor: selectedActor.color }}>
                  <span>{selectedActor.kind}</span>
                  <strong>{selectedActor.leader}</strong>
                  <small>
                    {selectedActor.government} · {selectedActor.ideology}
                  </small>
                </div>
                <p>{selectedActor.description}</p>
                <div className="stat-bars">
                  {Object.entries(selectedActor.stats)
                    .filter(([name]) => name !== 'population')
                    .map(([name, value]) => (
                      <div key={name}>
                        <span>{name}</span>
                        <meter min={0} max={100} value={value} />
                        <strong>{value}</strong>
                      </div>
                    ))}
                </div>
                <dl className="detail-list">
                  <dt>Population</dt>
                  <dd>{selectedActor.stats.population.toLocaleString()}</dd>
                  {Object.entries(selectedActor.resources).map(([resource, value]) => (
                    <div className="contents" key={resource}>
                      <dt>{resource}</dt>
                      <dd>{value.toLocaleString()}</dd>
                    </div>
                  ))}
                </dl>
                <h3>Public goals</h3>
                <ul>
                  {selectedActor.publicGoals.map((goal) => (
                    <li key={goal}>{goal}</li>
                  ))}
                </ul>
                {selectedActor.id !== game.world.playerActorId && (
                  <button
                    type="button"
                    className="button secondary full"
                    onClick={() => {
                      setChatActorIds([selectedActor.id]);
                      setBottomTab('diplomacy');
                    }}
                  >
                    Open diplomatic channel
                  </button>
                )}
              </div>
            ) : (
              <p className="empty-state">Select a region or actor on the map.</p>
            )}
          </aside>
        )}
        {rightCollapsed && (
          <button
            type="button"
            className="right-expand"
            onClick={() => setRightCollapsed(false)}
            aria-label="Expand inspector"
          >
            ‹
          </button>
        )}
      </div>

      <section className="command-deck">
        <nav className="command-tabs" aria-label="Command modes">
          <button
            type="button"
            className={bottomTab === 'actions' ? 'active' : ''}
            onClick={() => setBottomTab('actions')}
          >
            Actions <span>{drafts.length}</span>
          </button>
          <button
            type="button"
            className={bottomTab === 'diplomacy' ? 'active' : ''}
            onClick={() => setBottomTab('diplomacy')}
          >
            Diplomacy{' '}
            <span>{game.conversations.filter((item) => item.type !== 'advisor').length}</span>
          </button>
          <button
            type="button"
            className={bottomTab === 'advisor' ? 'active' : ''}
            onClick={() => setBottomTab('advisor')}
          >
            Advisor
          </button>
        </nav>
        {bottomTab === 'actions' && (
          <div className="action-deck">
            <div className="composer">
              <textarea
                ref={composerRef}
                value={actionText}
                rows={3}
                maxLength={4000}
                placeholder={`What should ${player.shortName} do before the next jump?`}
                onChange={(event) => setActionText(event.target.value)}
              />
              <div className="composer-options">
                <label>
                  Classification
                  <select
                    value={classification}
                    onChange={(event) =>
                      setClassification(event.target.value as GameAction['classification'])
                    }
                  >
                    <option value="public">Public</option>
                    <option value="covert">Covert</option>
                    <option value="diplomatic">Diplomatic</option>
                  </select>
                </label>
                <label>
                  Priority · {priority}
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={priority}
                    onChange={(event) => setPriority(Number(event.target.value))}
                  />
                </label>
                <label>
                  Effort · {effort}%
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={effort}
                    onChange={(event) => setEffort(Number(event.target.value))}
                  />
                </label>
                <span className="target-chips">
                  {selectedActorId !== game.world.playerActorId && selectedActor && (
                    <span className="chip">{selectedActor.shortName}</span>
                  )}
                  {selectedRegion && <span className="chip">{selectedRegion.name}</span>}
                </span>
                {editingAction && (
                  <button
                    type="button"
                    className="button subtle"
                    onClick={() => {
                      setEditingAction(undefined);
                      setActionText('');
                    }}
                  >
                    Cancel edit
                  </button>
                )}
                <button
                  type="button"
                  className="button primary"
                  disabled={!actionText.trim() || Boolean(busy)}
                  onClick={() => void saveAction()}
                >
                  {editingAction ? 'Update draft' : 'Add action'}
                </button>
              </div>
            </div>
            <ol className="action-queue">
              {drafts.map((action, index) => (
                <li key={action.id}>
                  <span className="action-order">{index + 1}</span>
                  <div>
                    <p>{action.originalText}</p>
                    <span>
                      {action.classification} · priority {action.priority} · {action.effort}% effort
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void moveAction(action, -1)}
                    disabled={index === 0}
                    aria-label="Move action up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => void moveAction(action, 1)}
                    disabled={index === drafts.length - 1}
                    aria-label="Move action down"
                  >
                    ↓
                  </button>
                  <button type="button" onClick={() => editAction(action)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => void removeAction(action)}>
                    Delete
                  </button>
                </li>
              ))}
              {drafts.length === 0 && (
                <li className="empty-state">
                  No actions queued. Advancing without actions is valid.
                </li>
              )}
            </ol>
          </div>
        )}
        {bottomTab === 'diplomacy' && (
          <div className="chat-deck">
            <aside className="conversation-list">
              <button
                type="button"
                className={!conversationId ? 'active' : ''}
                onClick={() => setConversationId(undefined)}
              >
                + New channel
              </button>
              {game.conversations
                .filter((conversation) => conversation.type !== 'advisor')
                .map((conversation) => (
                  <button
                    type="button"
                    key={conversation.id}
                    className={conversation.id === conversationId ? 'active' : ''}
                    onClick={() => setConversationId(conversation.id)}
                  >
                    <strong>{conversation.title}</strong>
                    <span>{conversation.updatedDate}</span>
                  </button>
                ))}
            </aside>
            <div className="conversation">
              {!currentConversation && (
                <fieldset className="participant-picker">
                  <legend>Participants</legend>
                  {Object.values(game.world.actors)
                    .filter((actor) => actor.id !== game.world.playerActorId && actor.isActive)
                    .map((actor) => (
                      <label key={actor.id}>
                        <input
                          type="checkbox"
                          checked={chatActorIds.includes(actor.id)}
                          onChange={(event) =>
                            setChatActorIds((current) =>
                              event.target.checked
                                ? [...current, actor.id]
                                : current.filter((id) => id !== actor.id),
                            )
                          }
                        />
                        <span className="legend-swatch" style={{ background: actor.color }} />
                        {actor.name}
                      </label>
                    ))}
                </fieldset>
              )}
              <ol className="message-feed" aria-live="polite">
                {currentConversation?.messages.map((message) => (
                  <li key={message.id} className={message.speaker}>
                    <div>
                      <strong>
                        {message.speakerActorId
                          ? (game.world.actors[message.speakerActorId]?.name ?? message.speaker)
                          : message.speaker === 'player'
                            ? player.name
                            : message.speaker}
                      </strong>
                      <time>{message.date}</time>
                    </div>
                    <p>{message.text}</p>
                    {message.commitmentIds.map((id) => {
                      const commitment = game.world.commitments.find((item) => item.id === id);
                      return commitment ? (
                        <div className="commitment-chip" key={id}>
                          <span>{commitment.kind}</span>
                          <strong>{commitment.summary}</strong>
                          <small>{commitment.status}</small>
                          {commitment.status === 'pending' && (
                            <div className="commitment-actions">
                              <button
                                type="button"
                                onClick={() => void respondToCommitment(commitment.id, 'accepted')}
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => void respondToCommitment(commitment.id, 'rejected')}
                              >
                                Reject
                              </button>
                              <button
                                type="button"
                                onClick={() => void respondToCommitment(commitment.id, 'pending')}
                              >
                                Defer
                              </button>
                            </div>
                          )}
                        </div>
                      ) : null;
                    })}
                  </li>
                ))}
              </ol>
              <div className="chat-composer">
                <textarea
                  rows={2}
                  value={chatText}
                  placeholder="Write a diplomatic message…"
                  onChange={(event) => setChatText(event.target.value)}
                />
                <button
                  type="button"
                  className="button primary"
                  disabled={
                    !chatText.trim() ||
                    (!currentConversation && chatActorIds.length === 0) ||
                    Boolean(busy)
                  }
                  onClick={() => void sendChat()}
                >
                  Send locally
                </button>
              </div>
            </div>
          </div>
        )}
        {bottomTab === 'advisor' && (
          <div className="advisor-deck">
            <div className="quick-prompts">
              {[
                'Summarize the current situation.',
                'What are my biggest risks?',
                'Compare my military position with the selected rival.',
                'Suggest diplomatic options.',
                'Remind me of unresolved promises.',
              ].map((prompt) => (
                <button
                  type="button"
                  className="chip"
                  key={prompt}
                  onClick={() => void askAdvisor(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
            <ol className="message-feed advisor-feed" aria-live="polite">
              {advisorConversation?.messages.map((message) => (
                <li key={message.id} className={message.speaker}>
                  <strong>{message.speaker === 'player' ? player.name : 'Advisor'}</strong>
                  <p>{message.text}</p>
                </li>
              ))}
              {!advisorConversation && (
                <li className="empty-state">
                  The advisor reads known local state only and can never mutate the world.
                </li>
              )}
            </ol>
            <div className="chat-composer">
              <textarea
                rows={2}
                value={advisorText}
                placeholder="Ask about known risks, events, or options…"
                onChange={(event) => setAdvisorText(event.target.value)}
              />
              <button
                type="button"
                className="button primary"
                disabled={!advisorText.trim() || Boolean(busy)}
                onClick={() => void askAdvisor()}
              >
                Ask advisor
              </button>
            </div>
          </div>
        )}
      </section>

      {progress && !['complete', 'failed', 'cancelled'].includes(progress.phase) && (
        <div
          className="simulation-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Simulation progress"
        >
          <div className="panel">
            <p className="eyebrow">Timeline simulation</p>
            <h2>{progress.phase}</h2>
            <div className="phase-track">
              {['assembling', 'generating', 'validating', 'applying', 'saving', 'memory'].map(
                (phase) => (
                  <span className={phase === progress.phase ? 'active' : ''} key={phase}>
                    {phase}
                  </span>
                ),
              )}
            </div>
            <p>{progress.detail}</p>
            <time>{(progress.elapsedMs / 1000).toFixed(1)} seconds elapsed</time>
            {progress.cancellable && (
              <button
                type="button"
                className="button danger"
                onClick={() => void window.paxLocalia.timeline.cancel(game.summary.id)}
              >
                Cancel without applying
              </button>
            )}
          </div>
        </div>
      )}
      {(error || notice || busy) && (
        <div
          className={`toast ${error ? 'error' : notice ? 'success' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          {error || notice || busy}
          {(error || notice) && (
            <button
              type="button"
              onClick={() => {
                setError('');
                setNotice('');
              }}
              aria-label="Dismiss message"
            >
              ×
            </button>
          )}
        </div>
      )}
    </main>
  );
}
