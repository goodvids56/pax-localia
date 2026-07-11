import {
  TreatySchema,
  type Actor,
  type ActorId,
  type EffectResult,
  type Region,
  type Treaty,
  type WorldEffect,
  type WorldState,
} from '@pax-localia/domain';

export interface EffectContext {
  militaryEnabled: boolean;
  economyEnabled: boolean;
  fantasyEnabled: boolean;
}

export interface ApplyEffectsResult {
  world: WorldState;
  results: EffectResult[];
}

class RuleRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const clamp = (value: number, minimum = 0, maximum = 100): number =>
  Math.min(maximum, Math.max(minimum, value));

function requireActor(world: WorldState, id: ActorId, active = true): Actor {
  const actor = world.actors[id];
  if (!actor) {
    throw new RuleRejection('ACTOR_NOT_FOUND', `Actor ${id} does not exist.`);
  }
  if (active && !actor.isActive) {
    throw new RuleRejection('ACTOR_INACTIVE', `${actor.name} is not active.`);
  }
  return actor;
}

function requireRegion(world: WorldState, id: string): Region {
  const region = world.regions[id];
  if (!region) {
    throw new RuleRejection('REGION_NOT_FOUND', `Region ${id} does not exist.`);
  }
  return region;
}

function territorialBasisExists(world: WorldState, toActorId: ActorId, region: Region): boolean {
  const actor = requireActor(world, toActorId);
  if (actor.claims.some((claim) => claim.regionId === region.id)) {
    return true;
  }

  const hasAdjacentControl = region.neighborIds.some(
    (neighborId) => world.regions[neighborId]?.controllerId === toActorId,
  );
  if (!hasAdjacentControl) {
    return false;
  }

  return world.conflicts.some(
    (conflict) =>
      conflict.status !== 'ended' &&
      (conflict.attackerIds.includes(toActorId) || conflict.defenderIds.includes(toActorId)) &&
      region.controllerId !== undefined &&
      (conflict.attackerIds.includes(region.controllerId) ||
        conflict.defenderIds.includes(region.controllerId)),
  );
}

function updateControlledRegions(
  world: WorldState,
  region: Region,
  oldControllerId: ActorId | undefined,
  newControllerId: ActorId,
): void {
  if (oldControllerId) {
    const oldActor = requireActor(world, oldControllerId, false);
    oldActor.controlledRegionIds = oldActor.controlledRegionIds.filter((id) => id !== region.id);
  }
  const newActor = requireActor(world, newControllerId);
  if (!newActor.controlledRegionIds.includes(region.id)) {
    newActor.controlledRegionIds.push(region.id);
  }
  region.controllerId = newControllerId;
}

function validateTreaty(world: WorldState, treaty: Treaty): void {
  const participants = new Set(treaty.participantIds);
  if (participants.size !== treaty.participantIds.length) {
    throw new RuleRejection('DUPLICATE_PARTICIPANT', 'Treaty participants must be unique.');
  }
  for (const actorId of participants) {
    requireActor(world, actorId);
  }
}

function applySingleEffect(
  world: WorldState,
  effect: WorldEffect,
  context: EffectContext,
): string[] {
  switch (effect.type) {
    case 'RELATION_ADJUST': {
      requireActor(world, effect.fromActorId);
      requireActor(world, effect.toActorId);
      if (effect.fromActorId === effect.toActorId) {
        throw new RuleRejection('SELF_RELATION', 'An actor cannot have a relation with itself.');
      }
      const relation = world.relationships.find(
        (entry) => entry.fromActorId === effect.fromActorId && entry.toActorId === effect.toActorId,
      );
      if (!relation) {
        throw new RuleRejection('RELATION_NOT_FOUND', 'The directed relationship does not exist.');
      }
      const before = relation.score;
      relation.score = clamp(relation.score + effect.delta, -100, 100);
      return [`relationship ${before} → ${relation.score} (bounded to -100…100)`];
    }
    case 'STAT_ADJUST': {
      const actor = requireActor(world, effect.actorId);
      if (effect.stat === 'economy' && !context.economyEnabled) {
        throw new RuleRejection('FEATURE_DISABLED', 'Economy rules are disabled in this scenario.');
      }
      const before = actor.stats[effect.stat];
      actor.stats[effect.stat] = clamp(before + effect.delta);
      return [`${effect.stat} ${before} → ${actor.stats[effect.stat]} (bounded to 0…100)`];
    }
    case 'RESOURCE_ADJUST': {
      if (!context.economyEnabled) {
        throw new RuleRejection(
          'FEATURE_DISABLED',
          'Resource rules are disabled in this scenario.',
        );
      }
      const actor = requireActor(world, effect.actorId);
      const before = actor.resources[effect.resource] ?? 0;
      const after = before + effect.delta;
      if (!Number.isSafeInteger(after) || after < 0) {
        throw new RuleRejection(
          'INSUFFICIENT_RESOURCE',
          `${actor.name} cannot reduce ${effect.resource} below zero.`,
        );
      }
      actor.resources[effect.resource] = after;
      return [`${effect.resource} ${before} → ${after}`];
    }
    case 'TRANSFER_REGION_CONTROL': {
      if (!context.militaryEnabled) {
        throw new RuleRejection(
          'FEATURE_DISABLED',
          'Military control is disabled in this scenario.',
        );
      }
      const region = requireRegion(world, effect.regionId);
      requireActor(world, effect.toActorId);
      if (effect.fromActorId && region.controllerId !== effect.fromActorId) {
        throw new RuleRejection(
          'STALE_CONTROLLER',
          'The proposed former controller is not current.',
        );
      }
      if (region.controllerId === effect.toActorId) {
        throw new RuleRejection('ALREADY_CONTROLLED', 'The actor already controls this region.');
      }
      if (!territorialBasisExists(world, effect.toActorId, region)) {
        throw new RuleRejection(
          'NO_TERRITORIAL_BASIS',
          'Control transfer requires an adjacent conflict front or an established claim.',
        );
      }
      const before = region.controllerId;
      updateControlledRegions(world, region, before, effect.toActorId);
      region.occupied = region.ownerId !== effect.toActorId;
      region.contested = region.occupied;
      return [`controller ${before ?? 'none'} → ${effect.toActorId}`];
    }
    case 'TRANSFER_REGION_OWNERSHIP': {
      const region = requireRegion(world, effect.regionId);
      requireActor(world, effect.toActorId);
      if (region.type === 'ocean' || region.type === 'lake') {
        throw new RuleRejection(
          'NON_OWNABLE_REGION',
          'Water regions cannot receive legal ownership.',
        );
      }
      if (effect.fromActorId && region.ownerId !== effect.fromActorId) {
        throw new RuleRejection('STALE_OWNER', 'The proposed former owner is not current.');
      }
      if (!effect.treatyId) {
        throw new RuleRejection(
          'TREATY_REQUIRED',
          'Legal ownership transfer requires an active treaty.',
        );
      }
      const treaty = world.treaties.find(
        (candidate) => candidate.id === effect.treatyId && candidate.status === 'active',
      );
      if (!treaty || !treaty.participantIds.includes(effect.toActorId)) {
        throw new RuleRejection(
          'INVALID_TREATY',
          'No active participating treaty supports transfer.',
        );
      }
      const before = region.ownerId;
      region.ownerId = effect.toActorId;
      if (!region.controllerId) {
        updateControlledRegions(world, region, undefined, effect.toActorId);
      }
      region.occupied = region.controllerId !== region.ownerId;
      region.contested = region.occupied;
      return [`legal owner ${before ?? 'none'} → ${effect.toActorId}`];
    }
    case 'CREATE_ACTOR': {
      if (world.actors[effect.actor.id]) {
        throw new RuleRejection('DUPLICATE_ID', `Actor ${effect.actor.id} already exists.`);
      }
      for (const regionId of effect.actor.controlledRegionIds) {
        requireRegion(world, regionId);
      }
      world.actors[effect.actor.id] = structuredClone(effect.actor);
      return [`created actor ${effect.actor.name}`];
    }
    case 'DEACTIVATE_ACTOR': {
      const actor = requireActor(world, effect.actorId);
      if (effect.actorId === world.playerActorId) {
        throw new RuleRejection('PLAYER_ACTOR', 'The player actor cannot be deactivated directly.');
      }
      const successors = effect.successorActorIds ?? [];
      for (const successorId of successors) {
        requireActor(world, successorId);
      }
      if (actor.controlledRegionIds.length > 0 && successors.length === 0) {
        throw new RuleRejection(
          'SUCCESSOR_REQUIRED',
          'An actor with controlled regions requires a successor.',
        );
      }
      actor.isActive = false;
      actor.successorIds = successors;
      for (const regionId of [...actor.controlledRegionIds]) {
        const successorId = successors[0];
        if (successorId) {
          updateControlledRegions(world, requireRegion(world, regionId), actor.id, successorId);
        }
      }
      return [`deactivated ${actor.name}`];
    }
    case 'CREATE_TREATY': {
      if (world.treaties.some((treaty) => treaty.id === effect.treaty.id)) {
        throw new RuleRejection('DUPLICATE_ID', `Treaty ${effect.treaty.id} already exists.`);
      }
      validateTreaty(world, effect.treaty);
      world.treaties.push(structuredClone(effect.treaty));
      return [`created treaty ${effect.treaty.name}`];
    }
    case 'UPDATE_TREATY': {
      const treaty = world.treaties.find((candidate) => candidate.id === effect.treatyId);
      if (!treaty) {
        throw new RuleRejection('TREATY_NOT_FOUND', `Treaty ${effect.treatyId} does not exist.`);
      }
      const next = TreatySchema.parse({ ...treaty, ...effect.patch });
      validateTreaty(world, next);
      Object.assign(treaty, effect.patch);
      return [`updated treaty ${treaty.name}`];
    }
    case 'START_CONFLICT': {
      if (!context.militaryEnabled) {
        throw new RuleRejection(
          'FEATURE_DISABLED',
          'Conflict rules are disabled in this scenario.',
        );
      }
      if (world.conflicts.some((conflict) => conflict.id === effect.conflict.id)) {
        throw new RuleRejection('DUPLICATE_ID', `Conflict ${effect.conflict.id} already exists.`);
      }
      const attackerIds = new Set(effect.conflict.attackerIds);
      for (const actorId of [...effect.conflict.attackerIds, ...effect.conflict.defenderIds]) {
        requireActor(world, actorId);
      }
      if (effect.conflict.defenderIds.some((actorId) => attackerIds.has(actorId))) {
        throw new RuleRejection(
          'CONFLICT_SIDE_OVERLAP',
          'An actor cannot be on both sides of a conflict.',
        );
      }
      world.conflicts.push(structuredClone(effect.conflict));
      return [`started conflict ${effect.conflict.name}`];
    }
    case 'UPDATE_CONFLICT': {
      const conflict = world.conflicts.find((candidate) => candidate.id === effect.conflictId);
      if (!conflict) {
        throw new RuleRejection('CONFLICT_NOT_FOUND', 'The conflict does not exist.');
      }
      Object.assign(conflict, effect.patch);
      conflict.intensity = clamp(conflict.intensity);
      return [`updated conflict ${conflict.name}`];
    }
    case 'END_CONFLICT': {
      const conflict = world.conflicts.find((candidate) => candidate.id === effect.conflictId);
      if (!conflict || conflict.status === 'ended') {
        throw new RuleRejection('CONFLICT_NOT_ACTIVE', 'The conflict is not active.');
      }
      conflict.status = 'ended';
      conflict.endDate = world.date;
      conflict.peaceStatus = effect.outcome;
      return [`ended conflict ${conflict.name}`];
    }
    case 'CREATE_UNIT': {
      if (!context.militaryEnabled) {
        throw new RuleRejection('FEATURE_DISABLED', 'Military units are disabled.');
      }
      if (world.units[effect.unit.id]) {
        throw new RuleRejection('DUPLICATE_ID', `Unit ${effect.unit.id} already exists.`);
      }
      const actor = requireActor(world, effect.unit.actorId);
      const region = requireRegion(world, effect.unit.regionId);
      if (region.controllerId !== actor.id) {
        throw new RuleRejection('FOREIGN_DEPLOYMENT', 'New units require a controlled region.');
      }
      world.units[effect.unit.id] = structuredClone(effect.unit);
      region.unitIds.push(effect.unit.id);
      return [`created unit ${effect.unit.name}`];
    }
    case 'MOVE_UNIT': {
      if (!context.militaryEnabled) {
        throw new RuleRejection('FEATURE_DISABLED', 'Military units are disabled.');
      }
      const unit = world.units[effect.unitId];
      if (!unit || unit.status === 'destroyed') {
        throw new RuleRejection('UNIT_NOT_ACTIVE', 'The unit does not exist or is destroyed.');
      }
      const from = requireRegion(world, unit.regionId);
      const to = requireRegion(world, effect.toRegionId);
      if (!from.neighborIds.includes(to.id)) {
        throw new RuleRejection('NOT_ADJACENT', 'Unit movement must follow adjacent regions.');
      }
      from.unitIds = from.unitIds.filter((id) => id !== unit.id);
      if (!to.unitIds.includes(unit.id)) {
        to.unitIds.push(unit.id);
      }
      unit.regionId = to.id;
      unit.destinationRegionId = undefined;
      unit.path = [];
      if (effect.strengthDelta !== undefined) {
        unit.strength = clamp(unit.strength + effect.strengthDelta);
        if (unit.strength === 0) {
          unit.status = 'destroyed';
          unit.destroyedDate = world.date;
        }
      }
      return [`moved ${unit.name} ${from.name} → ${to.name}`];
    }
    case 'DAMAGE_CITY': {
      const city = world.cities[effect.cityId];
      if (!city) {
        throw new RuleRejection('CITY_NOT_FOUND', 'The city does not exist.');
      }
      const before = city.damage;
      city.damage = clamp(city.damage + effect.damageDelta);
      return [`${city.name} damage ${before} → ${city.damage}`];
    }
    case 'CREATE_CITY': {
      if (world.cities[effect.city.id]) {
        throw new RuleRejection('DUPLICATE_ID', `City ${effect.city.id} already exists.`);
      }
      const region = requireRegion(world, effect.city.regionId);
      if (effect.city.controllerId) {
        requireActor(world, effect.city.controllerId);
      }
      world.cities[effect.city.id] = structuredClone(effect.city);
      region.cityIds.push(effect.city.id);
      return [`created city ${effect.city.name}`];
    }
    case 'SET_VARIABLE': {
      if (effect.namespace === 'core') {
        throw new RuleRejection('PROTECTED_NAMESPACE', 'The core variable namespace is protected.');
      }
      const key = `${effect.namespace}.${effect.key}`;
      world.variables[key] = effect.value;
      return [`set variable ${key}`];
    }
    case 'ADD_CLAIM': {
      const actor = requireActor(world, effect.actorId);
      const region = requireRegion(world, effect.regionId);
      const existing = actor.claims.find((claim) => claim.regionId === region.id);
      if (existing) {
        existing.strength = effect.strength;
        existing.basis = effect.basis ?? existing.basis;
      } else {
        actor.claims.push({
          regionId: region.id,
          strength: effect.strength,
          basis: effect.basis ?? 'Recorded claim',
        });
      }
      if (!region.claimActorIds.includes(actor.id)) {
        region.claimActorIds.push(actor.id);
      }
      return [`${actor.name} claim on ${region.name}: ${effect.strength}`];
    }
    case 'REMOVE_CLAIM': {
      const actor = requireActor(world, effect.actorId);
      const region = requireRegion(world, effect.regionId);
      if (!actor.claims.some((claim) => claim.regionId === region.id)) {
        throw new RuleRejection('CLAIM_NOT_FOUND', 'The actor has no claim on this region.');
      }
      actor.claims = actor.claims.filter((claim) => claim.regionId !== region.id);
      region.claimActorIds = region.claimActorIds.filter((id) => id !== actor.id);
      return [`removed ${actor.name} claim on ${region.name}`];
    }
    case 'ADD_COMMITMENT': {
      if (world.commitments.some((entry) => entry.id === effect.commitment.id)) {
        throw new RuleRejection(
          'DUPLICATE_ID',
          `Commitment ${effect.commitment.id} already exists.`,
        );
      }
      requireActor(world, effect.commitment.fromActorId);
      for (const actorId of effect.commitment.toActorIds) {
        requireActor(world, actorId);
      }
      world.commitments.push(structuredClone(effect.commitment));
      return [`added ${effect.commitment.kind}: ${effect.commitment.summary}`];
    }
  }
}

export function applyWorldEffects(
  initialWorld: WorldState,
  effects: readonly WorldEffect[],
  context: EffectContext,
): ApplyEffectsResult {
  const world = structuredClone(initialWorld);
  const results: EffectResult[] = [];

  for (const effect of effects) {
    const checkpoint = structuredClone(world);
    try {
      const deltas = applySingleEffect(world, effect, context);
      results.push({ effect, status: 'accepted', reason: 'Validated and applied.', deltas });
    } catch (error) {
      Object.assign(world, checkpoint);
      const rejection =
        error instanceof RuleRejection
          ? `${error.code}: ${error.message}`
          : `INTERNAL_RULE_ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`;
      results.push({ effect, status: 'rejected', reason: rejection, deltas: [] });
    }
  }

  return { world, results };
}
