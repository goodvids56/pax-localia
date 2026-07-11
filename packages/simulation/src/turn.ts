import {
  ActionSchema,
  TurnProposalSchema,
  WorldStateSchema,
  compareDates,
  isDateWithin,
  type EffectResult,
  type GameAction,
  type GameEvent,
  type InWorldDate,
  type Scenario,
  type TurnId,
  type TurnProposal,
  type WorldState,
} from '@pax-localia/domain';
import { flattenProposalEffects, materializeEvents } from './deterministic';
import { applyWorldEffects } from './effects';

export interface ResolveProposalInput {
  scenario: Scenario;
  world: WorldState;
  actions: GameAction[];
  proposal: TurnProposal;
  turnId: TurnId;
  startDate: InWorldDate;
  endDate: InWorldDate;
  nextRngStep: number;
}

export interface ResolvedProposal {
  world: WorldState;
  actions: GameAction[];
  events: GameEvent[];
  effectResults: EffectResult[];
}

function validateProposalReferences(input: ResolveProposalInput): void {
  const actionIds = new Set(input.actions.map((action) => action.id));
  for (const resolution of input.proposal.actionResolutions) {
    if (!actionIds.has(resolution.actionId)) {
      throw new Error(`Proposal references unknown action ${resolution.actionId}.`);
    }
  }
  for (const event of input.proposal.events) {
    if (!isDateWithin(event.date, input.startDate, input.endDate)) {
      throw new Error(`Generated event date ${event.date} falls outside the time jump.`);
    }
    for (const actorId of event.actorIds) {
      if (!input.world.actors[actorId]) {
        throw new Error(`Generated event references unknown actor ${actorId}.`);
      }
    }
    for (const regionId of event.regionIds) {
      if (!input.world.regions[regionId]) {
        throw new Error(`Generated event references unknown region ${regionId}.`);
      }
    }
    for (const actionId of event.causedByActionIds) {
      if (!actionIds.has(actionId)) {
        throw new Error(`Generated event references unknown action ${actionId}.`);
      }
    }
  }
}

export function resolveTurnProposal(input: ResolveProposalInput): ResolvedProposal {
  const proposal = TurnProposalSchema.parse(input.proposal);
  if (compareDates(input.endDate, input.startDate) <= 0) {
    throw new Error('A time jump must end after it starts.');
  }
  validateProposalReferences({ ...input, proposal });
  const effects = flattenProposalEffects(proposal);
  const applied = applyWorldEffects(input.world, effects, {
    economyEnabled: input.scenario.featureFlags.economy,
    militaryEnabled: input.scenario.featureFlags.military,
    fantasyEnabled: input.scenario.featureFlags.fantasyRules,
  });
  const events = materializeEvents(proposal, input.turnId);
  const resolutions = new Map(
    proposal.actionResolutions.map((resolution) => [resolution.actionId, resolution]),
  );
  const actions = input.actions.map((action) => {
    const resolution = resolutions.get(action.id);
    if (!resolution) return action;
    return ActionSchema.parse({
      ...action,
      status: 'resolved',
      interpretation: resolution.interpretation,
      feasibility: resolution.feasibility,
      outcome: resolution.outcome,
      resolution: resolution.explanation,
    });
  });
  const world = WorldStateSchema.parse({
    ...applied.world,
    date: input.endDate,
    turnNumber: input.world.turnNumber + 1,
    lastEventIds: events.map((event) => event.id),
    rng: {
      seed: input.world.rng.seed,
      step: input.nextRngStep,
    },
  });
  return { world, actions, events, effectResults: applied.results };
}
