import type { EffectResult, GameEvent, TurnRecord, WorldState } from '@pax-localia/domain';

export interface MemoryFact {
  kind:
    | 'territory'
    | 'stat'
    | 'relationship'
    | 'treaty'
    | 'conflict'
    | 'commitment'
    | 'actor'
    | 'event';
  text: string;
  sourceTurn: number;
  eventIds: string[];
  certainty: 'fact' | 'rumor' | 'intention';
}

export interface MemorySummary {
  startTurn: number;
  endTurn: number;
  eventIds: string[];
  facts: MemoryFact[];
  summary: string;
}

function factFromEffect(
  result: EffectResult,
  turn: number,
  eventIds: string[],
): MemoryFact | undefined {
  if (result.status !== 'accepted') return undefined;
  const effect = result.effect;
  const text = result.deltas.join('; ') || effect.type;
  switch (effect.type) {
    case 'TRANSFER_REGION_CONTROL':
    case 'TRANSFER_REGION_OWNERSHIP':
    case 'ADD_CLAIM':
    case 'REMOVE_CLAIM':
      return { kind: 'territory', text, sourceTurn: turn, eventIds, certainty: 'fact' };
    case 'STAT_ADJUST':
    case 'RESOURCE_ADJUST':
      return { kind: 'stat', text, sourceTurn: turn, eventIds, certainty: 'fact' };
    case 'RELATION_ADJUST':
      return { kind: 'relationship', text, sourceTurn: turn, eventIds, certainty: 'fact' };
    case 'CREATE_TREATY':
    case 'UPDATE_TREATY':
      return { kind: 'treaty', text, sourceTurn: turn, eventIds, certainty: 'fact' };
    case 'START_CONFLICT':
    case 'UPDATE_CONFLICT':
    case 'END_CONFLICT':
      return { kind: 'conflict', text, sourceTurn: turn, eventIds, certainty: 'fact' };
    case 'ADD_COMMITMENT':
      return { kind: 'commitment', text, sourceTurn: turn, eventIds, certainty: 'intention' };
    case 'CREATE_ACTOR':
    case 'DEACTIVATE_ACTOR':
      return { kind: 'actor', text, sourceTurn: turn, eventIds, certainty: 'fact' };
    case 'CREATE_UNIT':
    case 'MOVE_UNIT':
    case 'DAMAGE_CITY':
    case 'CREATE_CITY':
    case 'SET_VARIABLE':
      return { kind: 'event', text, sourceTurn: turn, eventIds, certainty: 'fact' };
  }
}

export function extractDeterministicMemory(
  turns: readonly TurnRecord[],
  events: readonly GameEvent[],
): MemorySummary {
  const sortedTurns = [...turns].sort((left, right) => left.sequence - right.sequence);
  const eventIds = events.map((event) => event.id);
  const facts = sortedTurns.flatMap((turn) =>
    turn.effectResults
      .map((result) => factFromEffect(result, turn.sequence, turn.eventIds))
      .filter((fact): fact is MemoryFact => fact !== undefined),
  );
  for (const event of events.filter((candidate) => candidate.severity >= 4)) {
    facts.push({
      kind: 'event',
      text: `${event.date}: ${event.title} — ${event.narrative}`,
      sourceTurn: sortedTurns.find((turn) => turn.id === event.turnId)?.sequence ?? 0,
      eventIds: [event.id],
      certainty: event.reliability === 'confirmed' ? 'fact' : 'rumor',
    });
  }
  const startTurn = sortedTurns[0]?.sequence ?? 0;
  const endTurn = sortedTurns.at(-1)?.sequence ?? startTurn;
  const keyFacts = facts.slice(0, 24);
  return {
    startTurn,
    endTurn,
    eventIds,
    facts,
    summary:
      keyFacts.length === 0
        ? `Turns ${startTurn}–${endTurn} contained no durable state changes.`
        : keyFacts.map((fact) => `[${fact.certainty}] ${fact.text}`).join(' '),
  };
}

export function durableOpenFacts(world: WorldState): string[] {
  return [
    ...world.treaties
      .filter((treaty) => ['proposed', 'active', 'suspended'].includes(treaty.status))
      .map((treaty) => `Treaty: ${treaty.name} (${treaty.status})`),
    ...world.conflicts
      .filter((conflict) => conflict.status !== 'ended')
      .map((conflict) => `Conflict: ${conflict.name} (${conflict.status})`),
    ...world.commitments
      .filter((commitment) => ['pending', 'accepted'].includes(commitment.status))
      .map((commitment) => `Commitment: ${commitment.summary} (${commitment.status})`),
    ...Object.values(world.actors)
      .filter((actor) => !actor.isActive)
      .map((actor) => `Inactive actor: ${actor.name}`),
  ];
}
