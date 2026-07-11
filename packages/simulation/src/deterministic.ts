import {
  EventIdSchema,
  type GameAction,
  type GameEvent,
  type InWorldDate,
  type TurnId,
  type TurnProposal,
  type WorldEffect,
  type WorldState,
} from '@pax-localia/domain';

export class SeededRandom {
  private state: number;
  private counter: number;

  constructor(seed: number, step = 0) {
    this.state = seed | 0 || 0x6d2b79f5;
    this.counter = 0;
    for (let index = 0; index < step; index += 1) {
      this.next();
    }
  }

  get step(): number {
    return this.counter;
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value | 0;
    this.counter += 1;
    return (value >>> 0) / 4_294_967_296;
  }
}

export interface DeterministicTurnOptions {
  startDate: InWorldDate;
  endDate: InWorldDate;
  difficulty: 'story' | 'standard' | 'challenging';
  seed: number;
  rngStep: number;
}

export interface DeterministicTurnResult {
  proposal: TurnProposal;
  rngStep: number;
}

function classify(
  text: string,
): 'military' | 'economy' | 'diplomacy' | 'stability' | 'science' | 'general' {
  const normalized = text.toLocaleLowerCase();
  if (/\b(attack|invade|occupy|advance|mobilize|siege|raid)\b/.test(normalized)) {
    return 'military';
  }
  if (/\b(trade|invest|industry|econom|market|infrastructure|resource)\b/.test(normalized)) {
    return 'economy';
  }
  if (/\b(negotiate|treaty|diplom|offer|summit|talk|alliance|apolog)\b/.test(normalized)) {
    return 'diplomacy';
  }
  if (/\b(reform|stabil|legitim|welfare|protest|security)\b/.test(normalized)) {
    return 'stability';
  }
  if (/\b(research|science|technology|laboratory|education)\b/.test(normalized)) {
    return 'science';
  }
  return 'general';
}

function difficultyResistance(difficulty: DeterministicTurnOptions['difficulty']): number {
  switch (difficulty) {
    case 'story':
      return 0.08;
    case 'standard':
      return 0.18;
    case 'challenging':
      return 0.3;
  }
}

function actionFeasibility(
  action: GameAction,
  world: WorldState,
  random: SeededRandom,
  difficulty: DeterministicTurnOptions['difficulty'],
): number {
  const actor = world.actors[action.actorId];
  if (!actor) {
    return 0;
  }
  const capability = (actor.stats.stability + actor.stats.economy + actor.stats.influence) / 300;
  const effort = action.effort / 100;
  const priority = action.priority / 5;
  const uncertainty = (random.next() - 0.5) * 0.24;
  return Math.min(
    0.98,
    Math.max(
      0.02,
      capability * 0.42 +
        effort * 0.35 +
        priority * 0.18 +
        uncertainty -
        difficultyResistance(difficulty),
    ),
  );
}

function outcomeFor(
  feasibility: number,
  roll: number,
): 'success' | 'partial' | 'failure' | 'backfire' {
  const margin = feasibility - roll;
  if (margin > 0.22) return 'success';
  if (margin > -0.08) return 'partial';
  if (margin > -0.35) return 'failure';
  return 'backfire';
}

function effectsForAction(
  action: GameAction,
  world: WorldState,
  category: ReturnType<typeof classify>,
  outcome: ReturnType<typeof outcomeFor>,
): WorldEffect[] {
  const magnitude =
    outcome === 'success' ? 5 : outcome === 'partial' ? 2 : outcome === 'failure' ? 0 : -3;
  const reason = `Deterministic ${outcome} resolution of player action`;
  const effects: WorldEffect[] = [];

  switch (category) {
    case 'military': {
      effects.push({
        type: 'STAT_ADJUST',
        actorId: action.actorId,
        stat: 'militaryCapacity',
        delta: outcome === 'backfire' ? -5 : -2,
        reason: 'Operational readiness and logistics expenditure',
      });
      const regionId = action.targetRegionIds[0];
      if ((outcome === 'success' || outcome === 'partial') && regionId) {
        const currentController = world.regions[regionId]?.controllerId;
        effects.push({
          type: 'TRANSFER_REGION_CONTROL',
          regionId,
          ...(currentController ? { fromActorId: currentController } : {}),
          toActorId: action.actorId,
          basis: reason,
        });
      }
      break;
    }
    case 'economy':
      effects.push(
        {
          type: 'RESOURCE_ADJUST',
          actorId: action.actorId,
          resource: 'treasury',
          delta: -Math.max(1, Math.round(action.effort / 10)),
          reason: 'Committed project resources',
        },
        {
          type: 'STAT_ADJUST',
          actorId: action.actorId,
          stat: 'economy',
          delta: magnitude,
          reason,
        },
      );
      break;
    case 'diplomacy': {
      const targetActorId = action.targetActorIds[0];
      if (targetActorId) {
        effects.push({
          type: 'RELATION_ADJUST',
          fromActorId: action.actorId,
          toActorId: targetActorId,
          delta: magnitude,
          reason,
        });
      } else {
        effects.push({
          type: 'STAT_ADJUST',
          actorId: action.actorId,
          stat: 'influence',
          delta: magnitude,
          reason,
        });
      }
      break;
    }
    case 'stability':
      effects.push({
        type: 'STAT_ADJUST',
        actorId: action.actorId,
        stat: 'stability',
        delta: magnitude,
        reason,
      });
      break;
    case 'science':
      effects.push({
        type: 'STAT_ADJUST',
        actorId: action.actorId,
        stat: 'technology',
        delta: magnitude,
        reason,
      });
      break;
    case 'general':
      effects.push({
        type: 'STAT_ADJUST',
        actorId: action.actorId,
        stat: 'influence',
        delta: magnitude,
        reason,
      });
      break;
  }
  return effects;
}

function eventCategory(
  category: ReturnType<typeof classify>,
): 'military' | 'economy' | 'diplomacy' | 'politics' | 'science' {
  if (category === 'stability' || category === 'general') return 'politics';
  return category;
}

export function createDeterministicProposal(
  world: WorldState,
  actions: readonly GameAction[],
  options: DeterministicTurnOptions,
): DeterministicTurnResult {
  const random = new SeededRandom(options.seed, options.rngStep);
  const actionResolutions: TurnProposal['actionResolutions'] = [];
  const events: TurnProposal['events'] = [];

  for (const action of actions) {
    const category = classify(action.enhancedText || action.originalText);
    const feasibility = actionFeasibility(action, world, random, options.difficulty);
    const outcome = outcomeFor(feasibility, random.next());
    const actor = world.actors[action.actorId];
    const actorName = actor?.name ?? 'Unknown actor';
    const effects = effectsForAction(action, world, category, outcome);
    const explanation =
      `${actorName} committed ${action.effort}% effort at priority ${action.priority}. ` +
      `Capability, resistance, and seeded uncertainty produced a ${outcome} outcome.`;

    actionResolutions.push({
      actionId: action.id,
      interpretation: action.originalText,
      feasibility,
      outcome,
      explanation,
      effects,
    });
    events.push({
      date: options.endDate,
      category: eventCategory(category),
      severity: outcome === 'backfire' ? 4 : outcome === 'failure' ? 2 : 3,
      title: `${actorName}: ${outcome === 'success' ? 'Initiative succeeds' : outcome === 'partial' ? 'Mixed result' : outcome === 'failure' ? 'Initiative stalls' : 'Initiative backfires'}`,
      narrative: `${actorName} attempted: “${action.originalText}” ${explanation}`,
      actorIds: [action.actorId, ...action.targetActorIds],
      regionIds: action.targetRegionIds,
      causedByActionIds: [action.id],
      effectIndexes: effects.map((_, index) => index),
    });
  }

  const autonomousDevelopments: TurnProposal['autonomousDevelopments'] = [];
  for (const commitment of world.commitments) {
    if (commitment.status !== 'accepted') continue;
    const targetActorId = commitment.toActorIds[0];
    if (!targetActorId) continue;
    autonomousDevelopments.push({
      cause: `Ongoing accepted commitment: ${commitment.summary}`,
      actors: [commitment.fromActorId, targetActorId],
      effects: [
        {
          type: 'RELATION_ADJUST',
          fromActorId: commitment.fromActorId,
          toActorId: targetActorId,
          delta: 1,
          reason: 'Continued compliance with an accepted commitment',
        },
      ],
    });
  }

  if (actions.length === 0) {
    events.push({
      date: options.endDate,
      category: 'system',
      severity: 1,
      title: 'The world advances',
      narrative:
        'No national actions were submitted. Institutions continued routine work while existing commitments remained in force.',
      actorIds: [world.playerActorId],
      regionIds: [],
      causedByActionIds: [],
      effectIndexes: [],
    });
  }

  return {
    proposal: {
      summary:
        actions.length === 0
          ? 'The period passed without a new player initiative.'
          : `${actions.length} player ${actions.length === 1 ? 'initiative was' : 'initiatives were'} resolved by the deterministic rules engine.`,
      actionResolutions,
      autonomousDevelopments,
      events,
      suggestedFollowUps: [
        'Review the resulting actor statistics.',
        'Inspect commitments before advancing again.',
        'Use diplomacy to reduce resistance to a future initiative.',
      ],
    },
    rngStep: random.step,
  };
}

export function flattenProposalEffects(proposal: TurnProposal): WorldEffect[] {
  return [
    ...proposal.actionResolutions.flatMap((resolution) => resolution.effects),
    ...proposal.autonomousDevelopments.flatMap((development) => development.effects),
  ];
}

export function materializeEvents(proposal: TurnProposal, turnId: TurnId): GameEvent[] {
  const suffix = turnId.replaceAll(/[^a-z0-9]/gi, '-').toLocaleLowerCase();
  return proposal.events.map((event, index) => ({
    id: EventIdSchema.parse(`event:${suffix}:${index}`),
    turnId,
    ...event,
    cityIds: [],
    unitIds: [],
    visibility: 'public',
    reliability: 'confirmed',
    source: 'simulation',
    tags: [event.category],
    explanationFactors: [
      'Action effort',
      'Actor capabilities',
      'Difficulty resistance',
      'Seeded uncertainty',
    ],
  }));
}
