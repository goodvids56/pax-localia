import { z } from 'zod';

const BaseIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/i, 'IDs may contain letters, numbers, dots, colons, _ and -');

export const ScenarioIdSchema = BaseIdSchema.brand<'ScenarioId'>();
export const ActorIdSchema = BaseIdSchema.brand<'ActorId'>();
export const RegionIdSchema = BaseIdSchema.brand<'RegionId'>();
export const CityIdSchema = BaseIdSchema.brand<'CityId'>();
export const UnitIdSchema = BaseIdSchema.brand<'UnitId'>();
export const TreatyIdSchema = BaseIdSchema.brand<'TreatyId'>();
export const ConflictIdSchema = BaseIdSchema.brand<'ConflictId'>();
export const ActionIdSchema = BaseIdSchema.brand<'ActionId'>();
export const EventIdSchema = BaseIdSchema.brand<'EventId'>();
export const TurnIdSchema = BaseIdSchema.brand<'TurnId'>();
export const GameIdSchema = BaseIdSchema.brand<'GameId'>();
export const BranchIdSchema = BaseIdSchema.brand<'BranchId'>();
export const ConversationIdSchema = BaseIdSchema.brand<'ConversationId'>();
export const MessageIdSchema = BaseIdSchema.brand<'MessageId'>();
export const CommitmentIdSchema = BaseIdSchema.brand<'CommitmentId'>();

export type ScenarioId = z.infer<typeof ScenarioIdSchema>;
export type ActorId = z.infer<typeof ActorIdSchema>;
export type RegionId = z.infer<typeof RegionIdSchema>;
export type CityId = z.infer<typeof CityIdSchema>;
export type UnitId = z.infer<typeof UnitIdSchema>;
export type TreatyId = z.infer<typeof TreatyIdSchema>;
export type ConflictId = z.infer<typeof ConflictIdSchema>;
export type ActionId = z.infer<typeof ActionIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type TurnId = z.infer<typeof TurnIdSchema>;
export type GameId = z.infer<typeof GameIdSchema>;
export type BranchId = z.infer<typeof BranchIdSchema>;
export type ConversationId = z.infer<typeof ConversationIdSchema>;
export type MessageId = z.infer<typeof MessageIdSchema>;
export type CommitmentId = z.infer<typeof CommitmentIdSchema>;

export const InWorldDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO calendar date (YYYY-MM-DD)')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
  }, 'Invalid calendar date');

export type InWorldDate = z.infer<typeof InWorldDateSchema>;

const ColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'Expected a six-digit hex color');
const ScoreSchema = z.number().int().min(-100).max(100);
const PercentSchema = z.number().int().min(0).max(100);
const CoordinateSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const JsonValueSchema = z.json();

export const ActorKindSchema = z.enum([
  'country',
  'faction',
  'organization',
  'character',
  'city-state',
  'rebel-movement',
  'custom',
]);

export const ActorStatsSchema = z.object({
  population: z.number().int().nonnegative().max(10_000_000_000),
  economy: PercentSchema,
  stability: PercentSchema,
  legitimacy: PercentSchema,
  militaryCapacity: PercentSchema,
  technology: PercentSchema,
  influence: PercentSchema,
});

export const ActorSchema = z.object({
  id: ActorIdSchema,
  kind: ActorKindSchema,
  name: z.string().trim().min(1).max(120),
  shortName: z.string().trim().min(1).max(40),
  adjective: z.string().trim().min(1).max(60),
  aliases: z.array(z.string().max(80)).max(20).default([]),
  color: ColorSchema,
  secondaryColor: ColorSchema.optional(),
  emblemAssetId: BaseIdSchema.optional(),
  capitalCityId: CityIdSchema.optional(),
  controlledRegionIds: z.array(RegionIdSchema),
  claims: z.array(
    z.object({ regionId: RegionIdSchema, strength: PercentSchema, basis: z.string().max(240) }),
  ),
  leader: z.string().max(120),
  government: z.string().max(120),
  ideology: z.string().max(120),
  description: z.string().max(2_000),
  stats: ActorStatsSchema,
  resources: z.record(z.string().min(1).max(60), z.number().int()).default({}),
  publicGoals: z.array(z.string().max(300)).max(20),
  privateGoals: z.array(z.string().max(300)).max(20),
  fears: z.array(z.string().max(300)).max(20),
  redLines: z.array(z.string().max(300)).max(20),
  personality: z.array(z.string().max(100)).max(20),
  memories: z.array(z.string().max(500)).max(50),
  isPlayable: z.boolean(),
  isActive: z.boolean(),
  successorIds: z.array(ActorIdSchema).default([]),
  predecessorIds: z.array(ActorIdSchema).default([]),
  variables: z.record(z.string(), JsonValueSchema).default({}),
});

export type Actor = z.infer<typeof ActorSchema>;

export const RegionSchema = z.object({
  id: RegionIdSchema,
  featureId: BaseIdSchema,
  name: z.string().min(1).max(120),
  type: z.enum(['land', 'coastal', 'ocean', 'strait', 'lake', 'special']),
  controllerId: ActorIdSchema.optional(),
  ownerId: ActorIdSchema.optional(),
  claimActorIds: z.array(ActorIdSchema).default([]),
  occupied: z.boolean().default(false),
  contested: z.boolean().default(false),
  population: z.number().int().nonnegative(),
  development: PercentSchema,
  terrain: z.enum([
    'plains',
    'hills',
    'mountains',
    'forest',
    'desert',
    'tundra',
    'wetlands',
    'urban',
    'ocean',
  ]),
  resources: z.array(z.string().max(60)).max(20),
  infrastructure: PercentSchema,
  strategicValue: PercentSchema,
  cityIds: z.array(CityIdSchema),
  unitIds: z.array(UnitIdSchema),
  neighborIds: z.array(RegionIdSchema),
  labelPosition: CoordinateSchema,
});

export type Region = z.infer<typeof RegionSchema>;

export const CitySchema = z.object({
  id: CityIdSchema,
  name: z.string().min(1).max(120),
  coordinates: CoordinateSchema,
  kind: z.enum(['city', 'capital', 'port', 'fortress', 'station', 'ruin', 'custom']),
  regionId: RegionIdSchema,
  controllerId: ActorIdSchema.optional(),
  isCapital: z.boolean(),
  populationBand: z.enum(['tiny', 'small', 'medium', 'large', 'metropolis']),
  importance: PercentSchema,
  infrastructure: PercentSchema,
  damage: PercentSchema,
  description: z.string().max(500).default(''),
});

export type City = z.infer<typeof CitySchema>;

export const MilitaryUnitSchema = z.object({
  id: UnitIdSchema,
  actorId: ActorIdSchema,
  name: z.string().min(1).max(120),
  kind: z.enum(['army', 'fleet', 'air-wing', 'militia', 'special', 'fantasy', 'space']),
  strength: PercentSchema,
  readiness: PercentSchema,
  morale: PercentSchema,
  supply: PercentSchema,
  regionId: RegionIdSchema,
  coordinates: CoordinateSchema.optional(),
  destinationRegionId: RegionIdSchema.optional(),
  path: z.array(RegionIdSchema).max(50).default([]),
  stance: z.enum(['defend', 'advance', 'hold', 'raid', 'retreat', 'patrol']),
  createdDate: InWorldDateSchema,
  destroyedDate: InWorldDateSchema.optional(),
  status: z.enum(['active', 'damaged', 'retreating', 'destroyed']),
});

export type MilitaryUnit = z.infer<typeof MilitaryUnitSchema>;

export const RelationshipSchema = z.object({
  fromActorId: ActorIdSchema,
  toActorId: ActorIdSchema,
  score: ScoreSchema,
  trust: PercentSchema,
  fear: PercentSchema,
  dependency: PercentSchema,
  trade: PercentSchema,
  intelligence: PercentSchema,
  ideologicalAffinity: ScoreSchema,
  publicStance: z.string().max(240),
  privateStance: z.string().max(240),
  grievances: z.array(z.string().max(300)).max(30),
  favors: z.array(z.string().max(300)).max(30),
  promises: z.array(z.string().max(300)).max(30),
  knownThreats: z.array(z.string().max(300)).max(30),
  lastInteractionDate: InWorldDateSchema.optional(),
});

export type Relationship = z.infer<typeof RelationshipSchema>;

export const TreatySchema = z.object({
  id: TreatyIdSchema,
  name: z.string().min(1).max(160),
  participantIds: z.array(ActorIdSchema).min(2).max(30),
  type: z.enum([
    'alliance',
    'non-aggression',
    'trade',
    'sanctions',
    'peace',
    'guarantee',
    'custom',
  ]),
  clauses: z.array(z.string().max(500)).min(1).max(30),
  secret: z.boolean(),
  startDate: InWorldDateSchema,
  endDate: InWorldDateSchema.optional(),
  status: z.enum(['proposed', 'active', 'suspended', 'expired', 'broken']),
});

export type Treaty = z.infer<typeof TreatySchema>;

export const ConflictSchema = z.object({
  id: ConflictIdSchema,
  name: z.string().min(1).max(160),
  attackerIds: z.array(ActorIdSchema).min(1),
  defenderIds: z.array(ActorIdSchema).min(1),
  warGoals: z.array(z.string().max(500)).max(20),
  occupiedRegionIds: z.array(RegionIdSchema),
  intensity: PercentSchema,
  exhaustion: z.record(ActorIdSchema, PercentSchema),
  casualtiesBand: z.enum(['none', 'low', 'moderate', 'high', 'catastrophic']),
  fronts: z.array(z.string().max(300)).max(20),
  startDate: InWorldDateSchema,
  endDate: InWorldDateSchema.optional(),
  status: z.enum(['active', 'ceasefire', 'peace-talks', 'ended']),
  peaceStatus: z.string().max(500).default(''),
});

export type Conflict = z.infer<typeof ConflictSchema>;

export const CommitmentSchema = z.object({
  id: CommitmentIdSchema,
  conversationId: ConversationIdSchema.optional(),
  fromActorId: ActorIdSchema,
  toActorIds: z.array(ActorIdSchema).min(1),
  kind: z.enum(['offer', 'demand', 'promise', 'threat', 'agreement']),
  summary: z.string().min(1).max(500),
  terms: z.array(z.string().max(500)).max(20),
  createdDate: InWorldDateSchema,
  reviewDate: InWorldDateSchema.optional(),
  status: z.enum(['pending', 'accepted', 'rejected', 'fulfilled', 'broken', 'expired']),
});

export type Commitment = z.infer<typeof CommitmentSchema>;

export const EventCategorySchema = z.enum([
  'politics',
  'diplomacy',
  'military',
  'economy',
  'society',
  'science',
  'environment',
  'mystery',
  'system',
]);

export const EventSchema = z.object({
  id: EventIdSchema,
  turnId: TurnIdSchema.optional(),
  date: InWorldDateSchema,
  category: EventCategorySchema,
  severity: z.number().int().min(1).max(5),
  title: z.string().min(1).max(160),
  narrative: z.string().min(1).max(3_000),
  actorIds: z.array(ActorIdSchema),
  regionIds: z.array(RegionIdSchema),
  cityIds: z.array(CityIdSchema).default([]),
  unitIds: z.array(UnitIdSchema).default([]),
  visibility: z.enum(['public', 'player', 'secret']),
  reliability: z.enum(['confirmed', 'likely', 'rumor', 'unknown']),
  source: z.string().max(120),
  tags: z.array(z.string().max(60)).max(20),
  causedByActionIds: z.array(ActionIdSchema).default([]),
  parentEventId: EventIdSchema.optional(),
  explanationFactors: z.array(z.string().max(300)).max(20).default([]),
});

export type GameEvent = z.infer<typeof EventSchema>;

export const ActionSchema = z.object({
  id: ActionIdSchema,
  gameId: GameIdSchema,
  branchId: BranchIdSchema,
  actorId: ActorIdSchema,
  status: z.enum(['draft', 'submitted', 'resolved']),
  originalText: z.string().trim().min(1).max(4_000),
  enhancedText: z.string().trim().max(4_000).optional(),
  targetActorIds: z.array(ActorIdSchema).max(20),
  targetRegionIds: z.array(RegionIdSchema).max(20),
  classification: z.enum(['public', 'covert', 'diplomatic']),
  priority: z.number().int().min(1).max(5),
  effort: z.number().int().min(1).max(100),
  scheduledDate: InWorldDateSchema.optional(),
  order: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  interpretation: z.string().max(2_000).optional(),
  feasibility: z.number().min(0).max(1).optional(),
  outcome: z.enum(['success', 'partial', 'failure', 'backfire', 'deferred']).optional(),
  resolution: z.string().max(3_000).optional(),
});

export type GameAction = z.infer<typeof ActionSchema>;

export const MessageSchema = z.object({
  id: MessageIdSchema,
  conversationId: ConversationIdSchema,
  speakerActorId: ActorIdSchema.optional(),
  speaker: z.enum(['player', 'actor', 'advisor', 'system']),
  audienceActorIds: z.array(ActorIdSchema),
  date: InWorldDateSchema,
  tone: z.string().max(80),
  text: z.string().min(1).max(10_000),
  commitmentIds: z.array(CommitmentIdSchema).default([]),
  createdAt: z.string().datetime(),
});

export const ConversationSchema = z.object({
  id: ConversationIdSchema,
  gameId: GameIdSchema,
  branchId: BranchIdSchema,
  participantActorIds: z.array(ActorIdSchema).max(20),
  type: z.enum(['private', 'group', 'broadcast', 'advisor']),
  title: z.string().min(1).max(160),
  createdDate: InWorldDateSchema,
  updatedDate: InWorldDateSchema,
  archived: z.boolean(),
  muted: z.boolean(),
  summary: z.string().max(4_000).default(''),
  summaryThroughMessageId: MessageIdSchema.optional(),
  messages: z.array(MessageSchema),
});

export type Conversation = z.infer<typeof ConversationSchema>;
export type Message = z.infer<typeof MessageSchema>;

export const WorldStateSchema = z.object({
  schemaVersion: z.literal(1),
  scenarioId: ScenarioIdSchema,
  gameId: GameIdSchema,
  branchId: BranchIdSchema,
  date: InWorldDateSchema,
  turnNumber: z.number().int().nonnegative(),
  playerActorId: ActorIdSchema,
  actors: z.record(z.string(), ActorSchema),
  regions: z.record(z.string(), RegionSchema),
  cities: z.record(z.string(), CitySchema),
  units: z.record(z.string(), MilitaryUnitSchema),
  relationships: z.array(RelationshipSchema),
  treaties: z.array(TreatySchema),
  conflicts: z.array(ConflictSchema),
  commitments: z.array(CommitmentSchema),
  variables: z.record(z.string(), JsonValueSchema),
  lastEventIds: z.array(EventIdSchema).max(100),
  rng: z.object({ seed: z.number().int(), step: z.number().int().nonnegative() }),
});

export type WorldState = z.infer<typeof WorldStateSchema>;

export const JumpUnitSchema = z.enum(['day', 'week', 'month', 'year']);
export const JumpSizeSchema = z.object({
  unit: JumpUnitSchema,
  value: z.number().int().min(1).max(100),
  label: z.string().min(1).max(60),
});

export type JumpSize = z.infer<typeof JumpSizeSchema>;

export const ScenarioSchema = z.object({
  id: ScenarioIdSchema,
  schemaVersion: z.literal(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: z.string().min(1).max(160),
  subtitle: z.string().max(240),
  description: z.string().min(1).max(5_000),
  author: z.string().min(1).max(160),
  license: z.string().min(1).max(120),
  tags: z.array(z.string().max(60)).max(20),
  contentRating: z.enum(['everyone', 'teen', 'mature']),
  startDate: InWorldDateSchema,
  minimumDate: InWorldDateSchema,
  maximumDate: InWorldDateSchema,
  calendar: z.literal('gregorian'),
  worldName: z.string().min(1).max(160),
  worldSummary: z.string().min(1).max(3_000),
  historicalContext: z.string().max(5_000),
  mapDatasetId: BaseIdSchema,
  thumbnailAssetId: BaseIdSchema.optional(),
  defaultDifficulty: z.enum(['story', 'standard', 'challenging']),
  allowedJumps: z.array(JumpSizeSchema).min(1),
  recommendedModels: z.array(z.string().max(200)).max(10),
  aiDirectives: z.array(z.string().max(500)).max(30),
  safetyConstraints: z.array(z.string().max(500)).max(30),
  objectives: z.array(z.string().max(500)).max(30),
  featureFlags: z.object({
    economy: z.boolean(),
    military: z.boolean(),
    characterRoleplay: z.boolean(),
    fogOfWar: z.boolean(),
    fantasyRules: z.boolean(),
  }),
  initialWorld: WorldStateSchema.omit({
    scenarioId: true,
    gameId: true,
    branchId: true,
    playerActorId: true,
  }),
  seedEvents: z.array(EventSchema),
  attribution: z.array(
    z.object({
      title: z.string().min(1).max(200),
      source: z.string().min(1).max(300),
      license: z.string().min(1).max(120),
    }),
  ),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

const EffectReasonSchema = z.string().trim().min(1).max(500);

export const WorldEffectSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('RELATION_ADJUST'),
    fromActorId: ActorIdSchema,
    toActorId: ActorIdSchema,
    delta: z.number().int().min(-100).max(100),
    reason: EffectReasonSchema,
  }),
  z.object({
    type: z.literal('STAT_ADJUST'),
    actorId: ActorIdSchema,
    stat: z.enum([
      'economy',
      'stability',
      'legitimacy',
      'militaryCapacity',
      'technology',
      'influence',
    ]),
    delta: z.number().int().min(-100).max(100),
    reason: EffectReasonSchema,
  }),
  z.object({
    type: z.literal('RESOURCE_ADJUST'),
    actorId: ActorIdSchema,
    resource: z.string().min(1).max(60),
    delta: z.number().int().min(-1_000_000_000).max(1_000_000_000),
    reason: EffectReasonSchema,
  }),
  z.object({
    type: z.literal('TRANSFER_REGION_CONTROL'),
    regionId: RegionIdSchema,
    fromActorId: ActorIdSchema.optional(),
    toActorId: ActorIdSchema,
    basis: EffectReasonSchema,
  }),
  z.object({
    type: z.literal('TRANSFER_REGION_OWNERSHIP'),
    regionId: RegionIdSchema,
    fromActorId: ActorIdSchema.optional(),
    toActorId: ActorIdSchema,
    treatyId: TreatyIdSchema.optional(),
    basis: EffectReasonSchema,
  }),
  z.object({ type: z.literal('CREATE_ACTOR'), actor: ActorSchema }),
  z.object({
    type: z.literal('DEACTIVATE_ACTOR'),
    actorId: ActorIdSchema,
    successorActorIds: z.array(ActorIdSchema).optional(),
    reason: EffectReasonSchema,
  }),
  z.object({ type: z.literal('CREATE_TREATY'), treaty: TreatySchema }),
  z.object({
    type: z.literal('UPDATE_TREATY'),
    treatyId: TreatyIdSchema,
    patch: TreatySchema.partial().omit({ id: true }),
  }),
  z.object({ type: z.literal('START_CONFLICT'), conflict: ConflictSchema }),
  z.object({
    type: z.literal('UPDATE_CONFLICT'),
    conflictId: ConflictIdSchema,
    patch: ConflictSchema.partial().omit({ id: true }),
  }),
  z.object({
    type: z.literal('END_CONFLICT'),
    conflictId: ConflictIdSchema,
    outcome: EffectReasonSchema,
  }),
  z.object({ type: z.literal('CREATE_UNIT'), unit: MilitaryUnitSchema }),
  z.object({
    type: z.literal('MOVE_UNIT'),
    unitId: UnitIdSchema,
    toRegionId: RegionIdSchema,
    strengthDelta: z.number().int().min(-100).max(100).optional(),
  }),
  z.object({
    type: z.literal('DAMAGE_CITY'),
    cityId: CityIdSchema,
    damageDelta: z.number().int().min(-100).max(100),
    reason: EffectReasonSchema,
  }),
  z.object({ type: z.literal('CREATE_CITY'), city: CitySchema }),
  z.object({
    type: z.literal('SET_VARIABLE'),
    namespace: z.string().min(1).max(80),
    key: z.string().min(1).max(80),
    value: JsonValueSchema,
  }),
  z.object({
    type: z.literal('ADD_CLAIM'),
    actorId: ActorIdSchema,
    regionId: RegionIdSchema,
    strength: PercentSchema,
    basis: EffectReasonSchema.optional(),
  }),
  z.object({
    type: z.literal('REMOVE_CLAIM'),
    actorId: ActorIdSchema,
    regionId: RegionIdSchema,
  }),
  z.object({ type: z.literal('ADD_COMMITMENT'), commitment: CommitmentSchema }),
]);

export type WorldEffect = z.infer<typeof WorldEffectSchema>;

export const TurnProposalSchema = z.object({
  summary: z.string().min(1).max(4_000),
  actionResolutions: z
    .array(
      z.object({
        actionId: ActionIdSchema,
        interpretation: z.string().min(1).max(2_000),
        feasibility: z.number().min(0).max(1),
        outcome: z.enum(['success', 'partial', 'failure', 'backfire', 'deferred']),
        explanation: z.string().min(1).max(3_000),
        effects: z.array(WorldEffectSchema).max(50),
      }),
    )
    .max(50),
  autonomousDevelopments: z
    .array(
      z.object({
        cause: z.string().min(1).max(1_000),
        actors: z.array(ActorIdSchema).max(20),
        effects: z.array(WorldEffectSchema).max(30),
      }),
    )
    .max(30),
  events: z
    .array(
      z.object({
        date: InWorldDateSchema,
        category: EventCategorySchema,
        severity: z.number().int().min(1).max(5),
        title: z.string().min(1).max(160),
        narrative: z.string().min(1).max(3_000),
        actorIds: z.array(ActorIdSchema).max(30),
        regionIds: z.array(RegionIdSchema).max(50),
        causedByActionIds: z.array(ActionIdSchema).max(30),
        effectIndexes: z.array(z.number().int().nonnegative()).max(80),
      }),
    )
    .max(100),
  suggestedFollowUps: z.array(z.string().max(300)).max(8),
});

export type TurnProposal = z.infer<typeof TurnProposalSchema>;

export const EffectResultSchema = z.object({
  effect: WorldEffectSchema,
  status: z.enum(['accepted', 'rejected']),
  reason: z.string().max(500),
  deltas: z.array(z.string().max(500)).max(20),
});

export type EffectResult = z.infer<typeof EffectResultSchema>;

export const TurnRecordSchema = z.object({
  id: TurnIdSchema,
  gameId: GameIdSchema,
  branchId: BranchIdSchema,
  sequence: z.number().int().positive(),
  startDate: InWorldDateSchema,
  endDate: InWorldDateSchema,
  jump: JumpSizeSchema,
  actionIds: z.array(ActionIdSchema),
  providerId: z.string().max(80),
  model: z.string().max(240).optional(),
  contextHash: z.string().max(128),
  seed: z.number().int(),
  rngStep: z.number().int().nonnegative(),
  proposedEffects: z.array(WorldEffectSchema),
  effectResults: z.array(EffectResultSchema),
  eventIds: z.array(EventIdSchema),
  snapshotHash: z.string().max(128),
  status: z.enum([
    'preparing',
    'generating',
    'applying',
    'completed',
    'cancelled',
    'failed',
    'intervened',
  ]),
  summary: z.string().max(4_000),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});

export type TurnRecord = z.infer<typeof TurnRecordSchema>;

export const ProviderTypeSchema = z.enum([
  'lm-studio',
  'ollama',
  'openai-compatible',
  'deterministic',
]);

export const ProviderSettingsSchema = z.object({
  type: ProviderTypeSchema,
  endpoint: z.string().url().max(500),
  model: z.string().max(240).default(''),
  allowLan: z.boolean().default(false),
  hasStoredToken: z.boolean().default(false),
  contextLength: z.number().int().min(1_024).max(10_000_000).default(8_192),
  temperature: z.number().min(0).max(2).default(0.4),
  maxOutputTokens: z.number().int().min(128).max(32_768).default(2_048),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
  retries: z.number().int().min(0).max(2).default(1),
  keepAlive: z.boolean().default(true),
  loadConfig: z
    .object({
      contextLength: z.number().int().min(1_024).max(10_000_000).optional(),
      flashAttention: z.boolean().optional(),
      evaluationBatchSize: z.number().int().min(1).max(65_536).optional(),
      gpuKvCache: z.boolean().optional(),
      moeExpertCount: z.number().int().min(1).max(1_000).optional(),
    })
    .default({}),
});

export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

export const AppSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  firstRunComplete: z.boolean(),
  provider: ProviderSettingsSchema,
  featureModels: z.object({
    simulation: z.string().max(240).default(''),
    diplomacy: z.string().max(240).default(''),
    advisor: z.string().max(240).default(''),
    summarization: z.string().max(240).default(''),
  }),
  appearance: z.object({
    theme: z.enum(['dark', 'high-contrast']),
    colorblindMode: z.enum(['off', 'deuteranopia', 'protanopia', 'tritanopia']),
    reducedMotion: z.boolean(),
    uiScale: z.number().min(0.8).max(1.5),
    textScale: z.number().min(0.8).max(1.5),
    soundVolume: z.number().min(0).max(1),
  }),
  simulation: z.object({
    detail: z.enum(['compact', 'standard', 'detailed']),
    memoryBlockTurns: z.number().int().min(2).max(20),
    memoryEraBlocks: z.number().int().min(2).max(20),
    autosaveBackups: z.number().int().min(1).max(50),
  }),
  privacy: z.object({
    retainPromptMetadata: z.boolean(),
    retainPromptContent: z.boolean(),
    allowLanProviders: z.boolean(),
  }),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const DefaultSettings: AppSettings = {
  schemaVersion: 1,
  firstRunComplete: false,
  provider: {
    type: 'deterministic',
    endpoint: 'http://127.0.0.1:1234',
    model: '',
    allowLan: false,
    hasStoredToken: false,
    contextLength: 8_192,
    temperature: 0.4,
    maxOutputTokens: 2_048,
    timeoutMs: 120_000,
    retries: 1,
    keepAlive: true,
    loadConfig: {},
  },
  featureModels: { simulation: '', diplomacy: '', advisor: '', summarization: '' },
  appearance: {
    theme: 'dark',
    colorblindMode: 'off',
    reducedMotion: false,
    uiScale: 1,
    textScale: 1,
    soundVolume: 0,
  },
  simulation: {
    detail: 'standard',
    memoryBlockTurns: 5,
    memoryEraBlocks: 5,
    autosaveBackups: 10,
  },
  privacy: {
    retainPromptMetadata: true,
    retainPromptContent: false,
    allowLanProviders: false,
  },
};

export const ScenarioSummarySchema = ScenarioSchema.pick({
  id: true,
  title: true,
  subtitle: true,
  author: true,
  license: true,
  tags: true,
  startDate: true,
  contentRating: true,
  version: true,
}).extend({
  playableActors: z.number().int().nonnegative(),
  compatibility: z.enum(['compatible', 'upgrade-available', 'unsupported']),
});

export type ScenarioSummary = z.infer<typeof ScenarioSummarySchema>;

export const GameSummarySchema = z.object({
  id: GameIdSchema,
  scenarioId: ScenarioIdSchema,
  title: z.string().min(1).max(160),
  actorName: z.string().min(1).max(120),
  branchId: BranchIdSchema,
  branchLabel: z.string().max(120),
  date: InWorldDateSchema,
  turnNumber: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

export type GameSummary = z.infer<typeof GameSummarySchema>;

export const BranchSummarySchema = z.object({
  id: BranchIdSchema,
  gameId: GameIdSchema,
  parentBranchId: BranchIdSchema.optional(),
  branchPointTurn: z.number().int().nonnegative(),
  label: z.string().min(1).max(120),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  turnCount: z.number().int().nonnegative(),
  date: InWorldDateSchema,
});

export type BranchSummary = z.infer<typeof BranchSummarySchema>;

export const CreateGameInputSchema = z.object({
  scenarioId: ScenarioIdSchema,
  actorId: ActorIdSchema,
  title: z.string().trim().min(1).max(160),
  difficulty: z.enum(['story', 'standard', 'challenging']),
  provider: ProviderTypeSchema,
  model: z.string().max(240).default(''),
  creativity: z.number().min(0).max(2),
  detail: z.enum(['compact', 'standard', 'detailed']),
  fogOfWar: z.boolean(),
  seed: z.number().int(),
});

export type CreateGameInput = z.infer<typeof CreateGameInputSchema>;

export const DraftActionInputSchema = z.object({
  gameId: GameIdSchema,
  branchId: BranchIdSchema,
  id: ActionIdSchema.optional(),
  text: z.string().trim().min(1).max(4_000),
  targetActorIds: z.array(ActorIdSchema).max(20).default([]),
  targetRegionIds: z.array(RegionIdSchema).max(20).default([]),
  classification: z.enum(['public', 'covert', 'diplomatic']).default('public'),
  priority: z.number().int().min(1).max(5).default(3),
  effort: z.number().int().min(1).max(100).default(50),
  scheduledDate: InWorldDateSchema.optional(),
});

export type DraftActionInput = z.infer<typeof DraftActionInputSchema>;

export const TimelineJumpInputSchema = z.object({
  gameId: GameIdSchema,
  branchId: BranchIdSchema,
  jump: JumpSizeSchema,
  provider: ProviderTypeSchema,
  model: z.string().max(240).default(''),
});

export type TimelineJumpInput = z.infer<typeof TimelineJumpInputSchema>;

export const TimelineJumpResultSchema = z.object({
  turn: TurnRecordSchema,
  world: WorldStateSchema,
  events: z.array(EventSchema),
  actions: z.array(ActionSchema),
});

export type TimelineJumpResult = z.infer<typeof TimelineJumpResultSchema>;

export const SendMessageInputSchema = z.object({
  gameId: GameIdSchema,
  branchId: BranchIdSchema,
  conversationId: ConversationIdSchema.optional(),
  participantActorIds: z.array(ActorIdSchema).max(20),
  type: z.enum(['private', 'group', 'advisor']),
  text: z.string().trim().min(1).max(10_000),
});

export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const RewindInputSchema = z.object({
  gameId: GameIdSchema,
  sourceBranchId: BranchIdSchema,
  turnNumber: z.number().int().nonnegative(),
  label: z.string().trim().min(1).max(120),
});

export type RewindInput = z.infer<typeof RewindInputSchema>;

export const ScenarioEditorInputSchema = z.object({
  scenario: ScenarioSchema,
  saveAsCopy: z.boolean().default(false),
});

export type ScenarioEditorInput = z.infer<typeof ScenarioEditorInputSchema>;
