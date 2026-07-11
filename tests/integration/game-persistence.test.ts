import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ActionSchema,
  CommitmentSchema,
  CreateGameInputSchema,
  DraftActionInputSchema,
  ScenarioSchema,
  TurnRecordSchema,
  canonicalStringify,
  type GameAction,
  type Scenario,
  type TurnRecord,
} from '@pax-localia/domain';
import { PaxDatabase, currentSchemaVersion } from '@pax-localia/database';
import {
  createDeterministicProposal,
  flattenProposalEffects,
  resolveTurnProposal,
} from '@pax-localia/simulation';

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function temporaryDatabase(name: string): { directory: string; file: string } {
  const directory = mkdtempSync(path.join(os.tmpdir(), `pax-localia-${name}-`));
  temporaryDirectories.push(directory);
  return { directory, file: path.join(directory, 'test.sqlite') };
}

function scenarios(): Scenario[] {
  const directory = path.join(process.cwd(), 'assets/scenarios');
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) =>
      ScenarioSchema.parse(JSON.parse(readFileSync(path.join(directory, name), 'utf8'))),
    );
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function createTestGame(database: PaxDatabase) {
  const allScenarios = scenarios();
  database.seedScenarios(allScenarios);
  const scenario = allScenarios.find(
    (candidate) => candidate.id === 'scenario:selene-border-crisis',
  )!;
  const input = CreateGameInputSchema.parse({
    scenarioId: scenario.id,
    actorId: 'actor:aster',
    title: 'Integration timeline',
    difficulty: 'story',
    provider: 'deterministic',
    model: 'deterministic-rules-v1',
    creativity: 0,
    detail: 'standard',
    fogOfWar: true,
    seed: 7,
  });
  return { scenario, view: database.createGame(input, scenario) };
}

function completeTurn(database: PaxDatabase, scenario: Scenario, action: GameAction): TurnRecord {
  const world = database.getWorld(action.gameId, action.branchId);
  const submitted = ActionSchema.parse({ ...action, status: 'submitted' });
  const generated = createDeterministicProposal(world, [submitted], {
    startDate: world.date,
    endDate: '2032-04-01',
    difficulty: 'story',
    seed: world.rng.seed,
    rngStep: world.rng.step,
  });
  const turnId = 'turn:integration' as TurnRecord['id'];
  const resolved = resolveTurnProposal({
    scenario,
    world,
    actions: [submitted],
    proposal: generated.proposal,
    turnId,
    startDate: world.date,
    endDate: '2032-04-01',
    nextRngStep: generated.rngStep,
  });
  const timestamp = '2026-07-11T10:00:00.000Z';
  const turn = TurnRecordSchema.parse({
    id: turnId,
    gameId: world.gameId,
    branchId: world.branchId,
    sequence: 1,
    startDate: world.date,
    endDate: '2032-04-01',
    jump: { unit: 'month', value: 1, label: 'One month' },
    actionIds: [submitted.id],
    providerId: 'deterministic',
    model: 'deterministic-rules-v1',
    contextHash: 'deterministic',
    seed: world.rng.seed,
    rngStep: generated.rngStep,
    proposedEffects: flattenProposalEffects(generated.proposal),
    effectResults: resolved.effectResults,
    eventIds: resolved.events.map((event) => event.id),
    snapshotHash: hash(resolved.world),
    status: 'completed',
    summary: generated.proposal.summary,
    createdAt: timestamp,
    completedAt: timestamp,
  });
  database.commitTurn({
    turn,
    world: resolved.world,
    events: resolved.events,
    actions: resolved.actions,
  });
  return turn;
}

describe('snapshot-first persistence integration', () => {
  it('creates, advances, autosaves, restarts, and reloads identical state', () => {
    const location = temporaryDatabase('restart');
    let database = new PaxDatabase(location.file);
    const { scenario, view } = createTestGame(database);
    const actions = database.saveAction(
      DraftActionInputSchema.parse({
        gameId: view.summary.id,
        branchId: view.summary.branchId,
        text: 'Invest treasury reserves in the rail and port network',
        targetActorIds: [],
        targetRegionIds: ['region:aster-bay'],
        classification: 'public',
        priority: 5,
        effort: 70,
      }),
    );
    const draft = actions.find((action) => action.status === 'draft')!;
    completeTurn(database, scenario, draft);
    const beforeRestart = database.loadGame(view.summary.id);
    expect(beforeRestart.world.turnNumber).toBe(1);
    expect(beforeRestart.events.some((event) => event.turnId === 'turn:integration')).toBe(true);
    expect(beforeRestart.actions.find((action) => action.id === draft.id)?.status).toBe('resolved');
    const serialized = canonicalStringify(beforeRestart.world);
    database.close();

    database = new PaxDatabase(location.file);
    expect(canonicalStringify(database.loadGame(view.summary.id).world)).toBe(serialized);
    expect(database.integrityCheck()).toEqual(['ok']);
    database.close();
  });

  it('leaves current state unchanged when turn validation fails', () => {
    const location = temporaryDatabase('rollback');
    const database = new PaxDatabase(location.file);
    const { scenario, view } = createTestGame(database);
    const draft = database.saveAction(
      DraftActionInputSchema.parse({
        gameId: view.summary.id,
        branchId: view.summary.branchId,
        text: 'Open a regional economic forum',
        targetActorIds: ['actor:brineholm'],
        targetRegionIds: [],
        classification: 'diplomatic',
        priority: 3,
        effort: 40,
      }),
    )[0]!;
    const original = canonicalStringify(database.getWorld(view.summary.id, view.summary.branchId));
    const submitted = ActionSchema.parse({ ...draft, status: 'submitted' });
    const generated = createDeterministicProposal(view.world, [submitted], {
      startDate: view.world.date,
      endDate: '2032-04-01',
      difficulty: 'standard',
      seed: view.world.rng.seed,
      rngStep: 0,
    });
    const resolved = resolveTurnProposal({
      scenario,
      world: view.world,
      actions: [submitted],
      proposal: generated.proposal,
      turnId: 'turn:invalid' as TurnRecord['id'],
      startDate: view.world.date,
      endDate: '2032-04-01',
      nextRngStep: generated.rngStep,
    });
    const invalid = TurnRecordSchema.parse({
      id: 'turn:invalid',
      gameId: view.summary.id,
      branchId: view.summary.branchId,
      sequence: 1,
      startDate: view.world.date,
      endDate: '2032-04-01',
      jump: { unit: 'month', value: 1, label: 'One month' },
      actionIds: [draft.id],
      providerId: 'deterministic',
      contextHash: 'test',
      seed: 7,
      rngStep: generated.rngStep,
      proposedEffects: [],
      effectResults: [],
      eventIds: resolved.events.map((event) => event.id),
      snapshotHash: 'wrong-hash',
      status: 'completed',
      summary: 'Invalid test',
      createdAt: '2026-07-11T10:00:00.000Z',
      completedAt: '2026-07-11T10:00:00.000Z',
    });
    expect(() =>
      database.commitTurn({
        turn: invalid,
        world: resolved.world,
        events: resolved.events,
        actions: resolved.actions,
      }),
    ).toThrow(/snapshot hash/);
    expect(canonicalStringify(database.getWorld(view.summary.id, view.summary.branchId))).toBe(
      original,
    );
    expect(database.listActions(view.summary.id, view.summary.branchId)[0]?.status).toBe('draft');
    database.close();
  });

  it('creates a non-destructive rewind branch and compares divergent state', () => {
    const location = temporaryDatabase('branch');
    const database = new PaxDatabase(location.file);
    const { scenario, view } = createTestGame(database);
    const draft = database.saveAction(
      DraftActionInputSchema.parse({
        gameId: view.summary.id,
        branchId: view.summary.branchId,
        text: 'Invest treasury reserves in industry',
        targetActorIds: [],
        targetRegionIds: [],
        classification: 'public',
        priority: 5,
        effort: 80,
      }),
    )[0]!;
    completeTurn(database, scenario, draft);
    const branched = database.rewind({
      gameId: view.summary.id,
      sourceBranchId: view.summary.branchId,
      turnNumber: 0,
      label: 'Peaceful alternative',
    });
    expect(branched.summary.branchId).not.toBe(view.summary.branchId);
    expect(branched.world.turnNumber).toBe(0);
    const branches = database.listBranches(view.summary.id);
    expect(branches).toHaveLength(2);
    expect(branches.find((branch) => branch.id === view.summary.branchId)?.turnCount).toBe(1);
    const comparison = database.compareBranches(
      view.summary.id,
      view.summary.branchId,
      branched.summary.branchId,
    );
    expect(comparison.statChanges.length + comparison.territoryChanges.length).toBeGreaterThan(0);
    database.close();
  });

  it('persists structured diplomatic commitments into later simulation context', () => {
    const location = temporaryDatabase('commitment');
    const database = new PaxDatabase(location.file);
    const { view } = createTestGame(database);
    const commitment = CommitmentSchema.parse({
      id: 'commitment:test',
      fromActorId: 'actor:aster',
      toActorIds: ['actor:brineholm'],
      kind: 'promise',
      summary: 'Keep civilian river traffic open',
      terms: ['No blockade of civilian cargo'],
      createdDate: view.world.date,
      status: 'pending',
    });
    database.addCommitment(view.summary.id, view.summary.branchId, commitment);
    database.respondToCommitment(view.summary.id, view.summary.branchId, commitment.id, 'accepted');
    const world = database.getWorld(view.summary.id, view.summary.branchId);
    expect(world.commitments[0]?.status).toBe('accepted');
    const generated = createDeterministicProposal(world, [], {
      startDate: world.date,
      endDate: '2032-04-01',
      difficulty: 'standard',
      seed: world.rng.seed,
      rngStep: 0,
    });
    expect(generated.proposal.autonomousDevelopments[0]?.cause).toContain('civilian river traffic');
    expect(generated.proposal.autonomousDevelopments[0]?.effects[0]).toMatchObject({
      type: 'RELATION_ADJUST',
      delta: 1,
    });
    database.close();
  });

  it('securely round-trips all portable game rows into a fresh database', () => {
    const sourceLocation = temporaryDatabase('export-source');
    const source = new PaxDatabase(sourceLocation.file);
    const { scenario, view } = createTestGame(source);
    const draft = source.saveAction(
      DraftActionInputSchema.parse({
        gameId: view.summary.id,
        branchId: view.summary.branchId,
        text: 'Invest in infrastructure',
        targetActorIds: [],
        targetRegionIds: [],
        classification: 'public',
        priority: 4,
        effort: 60,
      }),
    )[0]!;
    completeTurn(source, scenario, draft);
    const portable = source.exportGameRows(view.summary.id);
    const expected = canonicalStringify(source.loadGame(view.summary.id).world);
    source.close();

    const targetLocation = temporaryDatabase('export-target');
    const target = new PaxDatabase(targetLocation.file);
    target.seedScenarios(scenarios());
    target.importGameRows(portable);
    expect(canonicalStringify(target.loadGame(view.summary.id).world)).toBe(expected);
    expect(target.integrityCheck()).toEqual(['ok']);
    expect(() => target.importGameRows(portable)).toThrow(/already exists/);
    target.close();
  });

  it('applies every migration and enables integrity protections', () => {
    const location = temporaryDatabase('migration');
    const database = new PaxDatabase(location.file);
    expect(currentSchemaVersion()).toBeGreaterThanOrEqual(2);
    expect(database.integrityCheck()).toEqual(['ok']);
    database.close();
  });
});
