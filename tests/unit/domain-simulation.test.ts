import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ActionSchema,
  ScenarioSchema,
  TurnIdSchema,
  TurnRecordSchema,
  WorldEffectSchema,
  WorldStateSchema,
  addJump,
  canonicalStringify,
  compareDates,
  stableNumericHash,
  type GameAction,
  type Scenario,
  type WorldState,
} from '@pax-localia/domain';
import {
  SeededRandom,
  applyWorldEffects,
  createDeterministicProposal,
  durableOpenFacts,
  extractDeterministicMemory,
  resolveTurnProposal,
} from '@pax-localia/simulation';

function loadScenario(): Scenario {
  return ScenarioSchema.parse(
    JSON.parse(
      readFileSync(path.join(process.cwd(), 'assets/scenarios/selene-border-crisis.json'), 'utf8'),
    ),
  );
}

function worldFrom(scenario: Scenario): WorldState {
  return WorldStateSchema.parse({
    ...structuredClone(scenario.initialWorld),
    scenarioId: scenario.id,
    gameId: 'game:test',
    branchId: 'branch:test',
    playerActorId: 'actor:aster',
  });
}

function action(world: WorldState, text: string): GameAction {
  return ActionSchema.parse({
    id: 'action:test',
    gameId: world.gameId,
    branchId: world.branchId,
    actorId: world.playerActorId,
    status: 'submitted',
    originalText: text,
    targetActorIds: ['actor:brineholm'],
    targetRegionIds: ['region:selene-crossing'],
    classification: 'public',
    priority: 4,
    effort: 70,
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
}

function effects(...values: unknown[]) {
  return values.map((value) => WorldEffectSchema.parse(value));
}

describe('date arithmetic', () => {
  it('clamps month-end and handles leap years deterministically', () => {
    expect(addJump('2024-01-31', { unit: 'month', value: 1, label: 'month' })).toBe('2024-02-29');
    expect(addJump('2023-01-31', { unit: 'month', value: 1, label: 'month' })).toBe('2023-02-28');
    expect(addJump('2024-02-29', { unit: 'year', value: 1, label: 'year' })).toBe('2025-02-28');
    expect(addJump('2032-03-01', { unit: 'week', value: 3, label: 'weeks' })).toBe('2032-03-22');
    expect(compareDates('2032-03-01', '2032-03-02')).toBeLessThan(0);
  });
});

describe('canonical serialization', () => {
  it('sorts object keys and normalizes negative zero', () => {
    expect(canonicalStringify({ z: -0, a: { y: 2, x: 1 } })).toBe('{"a":{"x":1,"y":2},"z":0}');
    expect(stableNumericHash({ b: 2, a: 1 })).toBe(stableNumericHash({ a: 1, b: 2 }));
  });

  it('rejects values outside the JSON data model', () => {
    expect(() => canonicalStringify({ date: new Date() })).toThrow();
  });
});

describe('scenario and world schemas', () => {
  it('validates the bundled deterministic scenario and stable references', () => {
    const scenario = loadScenario();
    expect(Object.keys(scenario.initialWorld.regions)).toHaveLength(15);
    expect(
      Object.values(scenario.initialWorld.regions).every(
        (region) => region.type !== 'land' || Boolean(region.ownerId),
      ),
    ).toBe(true);
    expect(scenario.initialWorld.actors['actor:aster']?.isPlayable).toBe(true);
  });

  it('rejects malformed dates and actor statistics', () => {
    const scenario = loadScenario();
    const invalid = structuredClone(scenario);
    invalid.startDate = '2032-02-31';
    invalid.initialWorld.actors['actor:aster']!.stats.stability = 101;
    expect(ScenarioSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('world effect engine', () => {
  const context = {
    economyEnabled: true,
    militaryEnabled: true,
    fantasyEnabled: false,
  };

  it('bounds relationships and records an explainable delta', () => {
    const world = worldFrom(loadScenario());
    const relation = world.relationships.find(
      (entry) => entry.fromActorId === 'actor:aster' && entry.toActorId === 'actor:brineholm',
    )!;
    relation.score = 90;
    const result = applyWorldEffects(
      world,
      effects({
        type: 'RELATION_ADJUST',
        fromActorId: 'actor:aster',
        toActorId: 'actor:brineholm',
        delta: 30,
        reason: 'Successful summit',
      }),
      context,
    );
    expect(result.world.relationships.find((entry) => entry === relation)?.score).toBeUndefined();
    expect(
      result.world.relationships.find(
        (entry) => entry.fromActorId === 'actor:aster' && entry.toActorId === 'actor:brineholm',
      )?.score,
    ).toBe(100);
    expect(result.results[0]?.deltas[0]).toContain('bounded');
    expect(
      world.relationships.find((entry) => entry.fromActorId === 'actor:aster')?.score,
    ).not.toBe(100);
  });

  it('accepts a claim-backed control transfer and rejects unsupported ownership transfer', () => {
    const world = worldFrom(loadScenario());
    const result = applyWorldEffects(
      world,
      effects(
        {
          type: 'TRANSFER_REGION_CONTROL',
          regionId: 'region:selene-crossing',
          fromActorId: 'actor:brineholm',
          toActorId: 'actor:aster',
          basis: 'Claim-backed advance at the active front',
        },
        {
          type: 'TRANSFER_REGION_OWNERSHIP',
          regionId: 'region:selene-crossing',
          fromActorId: 'actor:brineholm',
          toActorId: 'actor:aster',
          basis: 'A casual declaration',
        },
      ),
      context,
    );
    expect(result.results.map((entry) => entry.status)).toEqual(['accepted', 'rejected']);
    expect(result.results[1]?.reason).toContain('TREATY_REQUIRED');
    expect(result.world.regions['region:selene-crossing']?.controllerId).toBe('actor:aster');
    expect(result.world.regions['region:selene-crossing']?.ownerId).toBe('actor:brineholm');
  });

  it('enforces adjacency for units and resource non-negativity', () => {
    const world = worldFrom(loadScenario());
    const result = applyWorldEffects(
      world,
      effects(
        {
          type: 'MOVE_UNIT',
          unitId: 'unit:aster-first',
          toRegionId: 'region:east-harbor',
        },
        {
          type: 'RESOURCE_ADJUST',
          actorId: 'actor:aster',
          resource: 'treasury',
          delta: -10_000,
          reason: 'Impossible expenditure',
        },
      ),
      context,
    );
    expect(result.results[0]?.reason).toContain('NOT_ADJACENT');
    expect(result.results[1]?.reason).toContain('INSUFFICIENT_RESOURCE');
  });

  it('requires a valid successor before deactivating a territorial actor', () => {
    const world = worldFrom(loadScenario());
    const rejected = applyWorldEffects(
      world,
      effects({
        type: 'DEACTIVATE_ACTOR',
        actorId: 'actor:brineholm',
        reason: 'Institutional collapse',
      }),
      context,
    );
    expect(rejected.results[0]?.reason).toContain('SUCCESSOR_REQUIRED');

    const accepted = applyWorldEffects(
      world,
      effects({
        type: 'DEACTIVATE_ACTOR',
        actorId: 'actor:brineholm',
        successorActorIds: ['actor:veyra'],
        reason: 'Constitutional union',
      }),
      context,
    );
    expect(accepted.results[0]?.status).toBe('accepted');
    expect(accepted.world.actors['actor:brineholm']?.isActive).toBe(false);
    expect(
      Object.values(accepted.world.regions)
        .filter((region) => region.controllerId === 'actor:veyra')
        .map((region) => region.id),
    ).toContain('region:northwatch');
  });
});

describe('seeded turn resolution', () => {
  it('repeats the same proposal from the same seed and counter', () => {
    const scenario = loadScenario();
    const world = worldFrom(scenario);
    const playerAction = action(
      world,
      'Advance into the disputed crossing with strict supply lines',
    );
    const options = {
      startDate: world.date,
      endDate: '2032-04-01' as const,
      difficulty: 'standard' as const,
      seed: 4242,
      rngStep: 0,
    };
    const first = createDeterministicProposal(world, [playerAction], options);
    const second = createDeterministicProposal(world, [playerAction], options);
    expect(first).toEqual(second);
    expect(first.rngStep).toBeGreaterThan(0);

    const random = new SeededRandom(4242);
    expect(random.next()).toBe(new SeededRandom(4242).next());
  });

  it('validates proposal dates before applying any effect', () => {
    const scenario = loadScenario();
    const world = worldFrom(scenario);
    const playerAction = action(world, 'Invest in rail infrastructure');
    const generated = createDeterministicProposal(world, [playerAction], {
      startDate: world.date,
      endDate: '2032-04-01',
      difficulty: 'standard',
      seed: 10,
      rngStep: 0,
    });
    generated.proposal.events[0]!.date = '2033-01-01';
    expect(() =>
      resolveTurnProposal({
        scenario,
        world,
        actions: [playerAction],
        proposal: generated.proposal,
        turnId: TurnIdSchema.parse('turn:test'),
        startDate: world.date,
        endDate: '2032-04-01',
        nextRngStep: generated.rngStep,
      }),
    ).toThrow(/outside the time jump/);
    expect(world.turnNumber).toBe(0);
  });

  it('applies accepted effects without mutating the source snapshot', () => {
    const scenario = loadScenario();
    const world = worldFrom(scenario);
    const playerAction = action(world, 'Invest treasury reserves in industry and infrastructure');
    const generated = createDeterministicProposal(world, [playerAction], {
      startDate: world.date,
      endDate: '2032-04-01',
      difficulty: 'story',
      seed: 7,
      rngStep: 0,
    });
    const resolved = resolveTurnProposal({
      scenario,
      world,
      actions: [playerAction],
      proposal: generated.proposal,
      turnId: TurnIdSchema.parse('turn:test'),
      startDate: world.date,
      endDate: '2032-04-01',
      nextRngStep: generated.rngStep,
    });
    expect(resolved.world.turnNumber).toBe(1);
    expect(resolved.world.date).toBe('2032-04-01');
    expect(resolved.actions[0]?.status).toBe('resolved');
    expect(world.turnNumber).toBe(0);
    expect(durableOpenFacts(resolved.world)).toEqual(
      expect.arrayContaining([expect.stringContaining('Selene Standoff')]),
    );
  });
});

describe('deterministic memory consolidation', () => {
  it('extracts durable factual changes with turn provenance', () => {
    const scenario = loadScenario();
    const world = worldFrom(scenario);
    const applied = applyWorldEffects(
      world,
      effects(
        {
          type: 'RELATION_ADJUST',
          fromActorId: 'actor:aster',
          toActorId: 'actor:brineholm',
          delta: 2,
          reason: 'Kept a promise',
        },
        {
          type: 'STAT_ADJUST',
          actorId: 'actor:aster',
          stat: 'influence',
          delta: 3,
          reason: 'Successful conference',
        },
        {
          type: 'ADD_CLAIM',
          actorId: 'actor:veyra',
          regionId: 'region:red-cliffs',
          strength: 20,
          basis: 'Historic administration',
        },
        {
          type: 'CREATE_TREATY',
          treaty: {
            id: 'treaty:test-memory',
            name: 'Memory Test Accord',
            participantIds: ['actor:aster', 'actor:veyra'],
            type: 'non-aggression',
            clauses: ['Avoid armed incidents'],
            secret: false,
            startDate: world.date,
            status: 'active',
          },
        },
      ),
      { economyEnabled: true, militaryEnabled: true, fantasyEnabled: false },
    );
    const turn = TurnRecordSchema.parse({
      id: 'turn:memory',
      gameId: world.gameId,
      branchId: world.branchId,
      sequence: 1,
      startDate: world.date,
      endDate: '2032-04-01',
      jump: { unit: 'month', value: 1, label: 'One month' },
      actionIds: [],
      providerId: 'deterministic',
      contextHash: 'memory',
      seed: world.rng.seed,
      rngStep: world.rng.step,
      proposedEffects: applied.results.map((result) => result.effect),
      effectResults: applied.results,
      eventIds: [],
      snapshotHash: 'hash',
      status: 'completed',
      summary: 'Memory extraction test',
      createdAt: '2026-07-11T10:00:00.000Z',
      completedAt: '2026-07-11T10:00:00.000Z',
    });
    const memory = extractDeterministicMemory([turn], []);
    expect(memory.startTurn).toBe(1);
    expect(memory.endTurn).toBe(1);
    expect(memory.facts.map((fact) => fact.kind)).toEqual(
      expect.arrayContaining(['relationship', 'stat', 'territory', 'treaty']),
    );
    expect(memory.summary).toContain('[fact]');
  });

  it('produces an explicit empty summary when no durable effects exist', () => {
    const world = worldFrom(loadScenario());
    const turn = TurnRecordSchema.parse({
      id: 'turn:empty-memory',
      gameId: world.gameId,
      branchId: world.branchId,
      sequence: 2,
      startDate: world.date,
      endDate: '2032-04-01',
      jump: { unit: 'month', value: 1, label: 'One month' },
      actionIds: [],
      providerId: 'deterministic',
      contextHash: 'memory',
      seed: world.rng.seed,
      rngStep: world.rng.step,
      proposedEffects: [],
      effectResults: [],
      eventIds: [],
      snapshotHash: 'hash',
      status: 'completed',
      summary: 'No changes',
      createdAt: '2026-07-11T10:00:00.000Z',
      completedAt: '2026-07-11T10:00:00.000Z',
    });
    expect(extractDeterministicMemory([turn], []).summary).toContain('no durable state changes');
  });
});
