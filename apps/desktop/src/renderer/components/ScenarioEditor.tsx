import { useMemo, useState } from 'react';
import {
  ScenarioSchema,
  type Actor,
  type Scenario,
  type ScenarioValidation,
} from '@pax-localia/domain';
import { getMapDataset } from '@pax-localia/map-data';

interface ScenarioEditorProps {
  scenario: Scenario;
  onClose: () => void;
  onSaved: (scenario: Scenario) => void;
  onTestLaunch: (scenario: Scenario) => void;
}

type EditorTab = 'metadata' | 'actors' | 'map' | 'rules' | 'json' | 'validation';

export function ScenarioEditor({ scenario, onClose, onSaved, onTestLaunch }: ScenarioEditorProps) {
  const [draft, setDraft] = useState(() => structuredClone(scenario));
  const [tab, setTab] = useState<EditorTab>('metadata');
  const [selectedActorId, setSelectedActorId] = useState(
    Object.keys(scenario.initialWorld.actors)[0] ?? '',
  );
  const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([]);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(scenario, null, 2));
  const [validation, setValidation] = useState<ScenarioValidation>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const geometry = useMemo(() => getMapDataset(draft.mapDatasetId), [draft.mapDatasetId]);
  const selectedActor = draft.initialWorld.actors[selectedActorId];

  const syncJson = (next: Scenario): void => {
    setDraft(next);
    setJsonText(JSON.stringify(next, null, 2));
  };

  const updateActor = (patch: Partial<Actor>): void => {
    if (!selectedActor) return;
    const actor = { ...selectedActor, ...patch };
    syncJson({
      ...draft,
      initialWorld: {
        ...draft.initialWorld,
        actors: { ...draft.initialWorld.actors, [actor.id]: actor },
      },
    });
  };

  const assignRegions = (): void => {
    if (!selectedActor || selectedRegionIds.length === 0) return;
    const actors = structuredClone(draft.initialWorld.actors);
    const regions = structuredClone(draft.initialWorld.regions);
    for (const regionId of selectedRegionIds) {
      const region = regions[regionId];
      if (!region) continue;
      for (const actor of Object.values(actors)) {
        actor.controlledRegionIds = actor.controlledRegionIds.filter((id) => id !== region.id);
      }
      region.ownerId = selectedActor.id;
      region.controllerId = selectedActor.id;
      region.occupied = false;
      region.contested = false;
      const owner = actors[selectedActor.id];
      if (owner && !owner.controlledRegionIds.includes(region.id)) {
        owner.controlledRegionIds.push(region.id);
      }
    }
    syncJson({
      ...draft,
      initialWorld: { ...draft.initialWorld, actors, regions },
    });
    setSelectedRegionIds([]);
  };

  const addActor = (): void => {
    const template = Object.values(draft.initialWorld.actors)[0];
    if (!template) return;
    const id = `actor:custom-${crypto.randomUUID().slice(0, 8)}` as Actor['id'];
    const actorTemplate = structuredClone(template);
    delete actorTemplate.capitalCityId;
    const actor: Actor = {
      ...actorTemplate,
      id,
      name: 'New actor',
      shortName: 'New actor',
      adjective: 'New',
      color: '#7a8795',
      controlledRegionIds: [],
      claims: [],
      publicGoals: [],
      privateGoals: [],
      memories: [],
      isPlayable: true,
    };
    syncJson({
      ...draft,
      initialWorld: {
        ...draft.initialWorld,
        actors: { ...draft.initialWorld.actors, [id]: actor },
      },
    });
    setSelectedActorId(id);
  };

  const applyJson = (): void => {
    setError('');
    try {
      const parsed = ScenarioSchema.parse(JSON.parse(jsonText));
      setDraft(parsed);
      setJsonText(JSON.stringify(parsed, null, 2));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Invalid scenario JSON.');
    }
  };

  const validate = async (): Promise<ScenarioValidation | undefined> => {
    setBusy('Validating scenario references, map features, ownership, and assets…');
    setError('');
    try {
      const result = await window.paxLocalia.scenarios.validate(draft);
      setValidation(result);
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Validation failed.');
      return undefined;
    } finally {
      setBusy('');
    }
  };

  const save = async (): Promise<void> => {
    const result = await validate();
    if (!result?.valid) {
      setTab('validation');
      return;
    }
    setBusy('Saving scenario locally…');
    try {
      const saved = await window.paxLocalia.scenarios.save({ scenario: draft, saveAsCopy: false });
      syncJson(saved);
      onSaved(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save scenario.');
    } finally {
      setBusy('');
    }
  };

  return (
    <main className="editor-page">
      <header className="editor-header">
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close editor">
          ←
        </button>
        <div>
          <p className="eyebrow">Scenario workshop</p>
          <h1>{draft.title}</h1>
        </div>
        <span className="save-state">{busy || 'Local draft'}</span>
        <button type="button" className="button secondary" onClick={() => void validate()}>
          Validate
        </button>
        <button type="button" className="button primary" onClick={() => void save()}>
          Save scenario
        </button>
      </header>
      <nav className="tab-strip" aria-label="Scenario editor sections">
        {(['metadata', 'actors', 'map', 'rules', 'json', 'validation'] as const).map((item) => (
          <button
            type="button"
            key={item}
            className={tab === item ? 'active' : ''}
            onClick={() => setTab(item)}
          >
            {item === 'json' ? 'Advanced JSON' : item[0]?.toLocaleUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
      <section className="editor-content">
        {tab === 'metadata' && (
          <div className="form-page">
            <h2>Metadata and timeline</h2>
            <div className="settings-grid">
              <label>
                Title
                <input
                  value={draft.title}
                  onChange={(event) => syncJson({ ...draft, title: event.target.value })}
                />
              </label>
              <label>
                Subtitle
                <input
                  value={draft.subtitle}
                  onChange={(event) => syncJson({ ...draft, subtitle: event.target.value })}
                />
              </label>
              <label>
                Author
                <input
                  value={draft.author}
                  onChange={(event) => syncJson({ ...draft, author: event.target.value })}
                />
              </label>
              <label>
                License
                <input
                  value={draft.license}
                  onChange={(event) => syncJson({ ...draft, license: event.target.value })}
                />
              </label>
              <label>
                Start date
                <input
                  type="date"
                  value={draft.startDate}
                  onChange={(event) => syncJson({ ...draft, startDate: event.target.value })}
                />
              </label>
              <label>
                Maximum date
                <input
                  type="date"
                  value={draft.maximumDate}
                  onChange={(event) => syncJson({ ...draft, maximumDate: event.target.value })}
                />
              </label>
            </div>
            <label>
              Description
              <textarea
                rows={5}
                value={draft.description}
                onChange={(event) => syncJson({ ...draft, description: event.target.value })}
              />
            </label>
            <label>
              World summary
              <textarea
                rows={4}
                value={draft.worldSummary}
                onChange={(event) => syncJson({ ...draft, worldSummary: event.target.value })}
              />
            </label>
            <label>
              Tags (comma separated)
              <input
                value={draft.tags.join(', ')}
                onChange={(event) =>
                  syncJson({
                    ...draft,
                    tags: event.target.value
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
          </div>
        )}
        {tab === 'actors' && (
          <div className="editor-split">
            <aside className="editor-list">
              <button type="button" className="button secondary full" onClick={addActor}>
                + Add actor
              </button>
              {Object.values(draft.initialWorld.actors).map((actor) => (
                <button
                  type="button"
                  key={actor.id}
                  className={actor.id === selectedActorId ? 'active' : ''}
                  onClick={() => setSelectedActorId(actor.id)}
                >
                  <span className="legend-swatch" style={{ background: actor.color }} />
                  <span>
                    <strong>{actor.name}</strong>
                    <small>{actor.kind}</small>
                  </span>
                </button>
              ))}
            </aside>
            {selectedActor && (
              <div className="form-page">
                <h2>{selectedActor.name}</h2>
                <div className="settings-grid">
                  <label>
                    Name
                    <input
                      value={selectedActor.name}
                      onChange={(event) => updateActor({ name: event.target.value })}
                    />
                  </label>
                  <label>
                    Short name
                    <input
                      value={selectedActor.shortName}
                      onChange={(event) => updateActor({ shortName: event.target.value })}
                    />
                  </label>
                  <label>
                    Map color
                    <input
                      type="color"
                      value={selectedActor.color}
                      onChange={(event) => updateActor({ color: event.target.value })}
                    />
                  </label>
                  <label>
                    Kind
                    <select
                      value={selectedActor.kind}
                      onChange={(event) =>
                        updateActor({ kind: event.target.value as Actor['kind'] })
                      }
                    >
                      {[
                        'country',
                        'faction',
                        'organization',
                        'character',
                        'city-state',
                        'rebel-movement',
                        'custom',
                      ].map((kind) => (
                        <option key={kind}>{kind}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Leader
                    <input
                      value={selectedActor.leader}
                      onChange={(event) => updateActor({ leader: event.target.value })}
                    />
                  </label>
                  <label>
                    Government
                    <input
                      value={selectedActor.government}
                      onChange={(event) => updateActor({ government: event.target.value })}
                    />
                  </label>
                </div>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={selectedActor.isPlayable}
                    onChange={(event) => updateActor({ isPlayable: event.target.checked })}
                  />
                  Playable actor
                </label>
                <label>
                  Internal description
                  <textarea
                    rows={5}
                    value={selectedActor.description}
                    onChange={(event) => updateActor({ description: event.target.value })}
                  />
                </label>
                <h3>Starting statistics</h3>
                <div className="stat-editor">
                  {(Object.entries(selectedActor.stats) as [keyof Actor['stats'], number][]).map(
                    ([key, value]) => (
                      <label key={key}>
                        {key}
                        <input
                          type="number"
                          min={0}
                          max={key === 'population' ? 10_000_000_000 : 100}
                          value={value}
                          onChange={(event) =>
                            updateActor({
                              stats: {
                                ...selectedActor.stats,
                                [key]: Number(event.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    ),
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {tab === 'map' && (
          <div className="form-page">
            <h2>Atomic region ownership and control</h2>
            <p>
              Select one or more bundled atomic regions, choose an actor in the Actors section, then
              assign. Polygon drawing is intentionally outside this alpha.
            </p>
            <div className="region-grid">
              {geometry.features.map((feature) => {
                const region = draft.initialWorld.regions[feature.id];
                const owner = region?.ownerId
                  ? draft.initialWorld.actors[region.ownerId]
                  : undefined;
                const selected = selectedRegionIds.includes(feature.id);
                return (
                  <button
                    type="button"
                    key={feature.id}
                    className={selected ? 'selected' : ''}
                    style={{ borderColor: owner?.color }}
                    onClick={() =>
                      setSelectedRegionIds((current) =>
                        current.includes(feature.id)
                          ? current.filter((id) => id !== feature.id)
                          : [...current, feature.id],
                      )
                    }
                  >
                    <strong>{feature.properties.name}</strong>
                    <span>{owner?.shortName ?? 'Unowned'}</span>
                    {region?.contested && <span className="badge danger">Contested</span>}
                  </button>
                );
              })}
            </div>
            <div className="sticky-actions">
              <span>{selectedRegionIds.length} selected</span>
              <button
                type="button"
                className="button primary"
                disabled={!selectedActor || selectedRegionIds.length === 0}
                onClick={assignRegions}
              >
                Assign to {selectedActor?.shortName ?? 'selected actor'}
              </button>
            </div>
          </div>
        )}
        {tab === 'rules' && (
          <div className="form-page">
            <h2>Features, objectives, and AI boundaries</h2>
            <div className="check-grid">
              {Object.entries(draft.featureFlags).map(([flag, enabled]) => (
                <label className="check-row" key={flag}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) =>
                      syncJson({
                        ...draft,
                        featureFlags: {
                          ...draft.featureFlags,
                          [flag]: event.target.checked,
                        },
                      })
                    }
                  />
                  {flag}
                </label>
              ))}
            </div>
            <label>
              Objectives (one per line)
              <textarea
                rows={5}
                value={draft.objectives.join('\n')}
                onChange={(event) =>
                  syncJson({
                    ...draft,
                    objectives: event.target.value.split('\n').filter(Boolean),
                  })
                }
              />
            </label>
            <label>
              Scenario directives (data-constrained; no tools)
              <textarea
                rows={7}
                value={draft.aiDirectives.join('\n')}
                onChange={(event) =>
                  syncJson({
                    ...draft,
                    aiDirectives: event.target.value.split('\n').filter(Boolean),
                  })
                }
              />
            </label>
          </div>
        )}
        {tab === 'json' && (
          <div className="json-editor form-page">
            <h2>Advanced JSON</h2>
            <p>
              Edits remain local and must pass the same schema and semantic validation as forms.
            </p>
            <textarea
              value={jsonText}
              onChange={(event) => setJsonText(event.target.value)}
              spellCheck={false}
              aria-label="Scenario JSON"
            />
            <button type="button" className="button secondary" onClick={applyJson}>
              Parse and format
            </button>
          </div>
        )}
        {tab === 'validation' && (
          <div className="form-page">
            <h2>Validation and test launch</h2>
            {!validation ? (
              <p className="empty-state">Run validation to inspect this scenario.</p>
            ) : (
              <>
                <div className={`callout ${validation.valid ? 'success' : ''}`}>
                  {validation.valid
                    ? 'Scenario is valid and can be launched.'
                    : 'Resolve all errors before saving or launching.'}
                </div>
                <ul className="validation-list">
                  {validation.issues.map((issue, index) => (
                    <li className={issue.severity} key={`${issue.path}-${index}`}>
                      <strong>{issue.path || 'scenario'}</strong>
                      <span>{issue.message}</span>
                    </li>
                  ))}
                  {validation.issues.length === 0 && <li>No validation issues.</li>}
                </ul>
                <button
                  type="button"
                  className="button primary"
                  disabled={!validation.valid}
                  onClick={() => onTestLaunch(draft)}
                >
                  Test launch
                </button>
              </>
            )}
          </div>
        )}
        {error && (
          <div role="alert" className="error-state floating-error">
            {error}
          </div>
        )}
      </section>
    </main>
  );
}
