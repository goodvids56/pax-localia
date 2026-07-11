import { z } from 'zod';
import {
  ActionIdSchema,
  ActionSchema,
  ActorIdSchema,
  AppSettingsSchema,
  BranchIdSchema,
  BranchSummarySchema,
  ConversationIdSchema,
  ConversationSchema,
  CreateGameInputSchema,
  DraftActionInputSchema,
  EventSchema,
  GameIdSchema,
  GameSummarySchema,
  MessageSchema,
  ProviderSettingsSchema,
  RewindInputSchema,
  ScenarioEditorInputSchema,
  ScenarioIdSchema,
  ScenarioSchema,
  ScenarioSummarySchema,
  SendMessageInputSchema,
  TimelineJumpInputSchema,
  TimelineJumpResultSchema,
  WorldStateSchema,
} from './schemas';
import type {
  AppSettings,
  BranchId,
  BranchSummary,
  Conversation,
  ConversationId,
  CreateGameInput,
  DraftActionInput,
  GameAction,
  GameEvent,
  GameId,
  GameSummary,
  Message,
  ProviderSettings,
  RewindInput,
  Scenario,
  ScenarioEditorInput,
  ScenarioId,
  ScenarioSummary,
  SendMessageInput,
  TimelineJumpInput,
  TimelineJumpResult,
  WorldState,
} from './schemas';

export const IpcChannels = {
  appInfo: 'app:get-info',
  appPaths: 'app:get-paths',
  appOpenLogs: 'app:open-logs',
  appExportAll: 'app:export-all-data',
  appDeleteAll: 'app:delete-all-data',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsReset: 'settings:reset',
  settingsStoreToken: 'settings:store-token',
  settingsForgetToken: 'settings:forget-token',
  scenariosList: 'scenarios:list',
  scenariosGet: 'scenarios:get',
  scenariosSave: 'scenarios:save',
  scenariosDuplicate: 'scenarios:duplicate',
  scenariosRemove: 'scenarios:remove',
  scenariosImport: 'scenarios:import',
  scenariosExport: 'scenarios:export',
  scenariosValidate: 'scenarios:validate',
  gamesList: 'games:list',
  gamesCreate: 'games:create',
  gamesLoad: 'games:load',
  gamesRename: 'games:rename',
  gamesDelete: 'games:delete',
  gamesExport: 'games:export',
  gamesImport: 'games:import',
  worldInspectActor: 'world:inspect-actor',
  actionsList: 'actions:list',
  actionsSave: 'actions:save',
  actionsRemove: 'actions:remove',
  actionsReorder: 'actions:reorder',
  chatsList: 'chats:list',
  chatsSend: 'chats:send',
  chatsArchive: 'chats:archive',
  advisorAsk: 'advisor:ask',
  timelineJump: 'timeline:jump',
  timelineCancel: 'timeline:cancel',
  timelineBranches: 'timeline:branches',
  timelineRewind: 'timeline:rewind',
  timelineCompare: 'timeline:compare',
  timelineProgress: 'timeline:progress',
  aiListProviders: 'ai:list-providers',
  aiListModels: 'ai:list-models',
  aiTest: 'ai:test',
  aiDiagnostics: 'ai:diagnostics',
  aiLoadModel: 'ai:load-model',
  aiUnloadModel: 'ai:unload-model',
  databaseIntegrity: 'database:integrity',
} as const;

export const AppInfoSchema = z.object({
  name: z.literal('Pax Localia'),
  version: z.string(),
  platform: z.enum(['win32', 'darwin', 'linux']),
  packaged: z.boolean(),
  noTelemetry: z.literal(true),
});

export type AppInfo = z.infer<typeof AppInfoSchema>;

export const AppPathsSchema = z.object({
  dataDirectory: z.string(),
  logsDirectory: z.string(),
  databaseFile: z.string(),
});

export type AppPaths = z.infer<typeof AppPathsSchema>;

export const OperationResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().max(2_000),
  path: z.string().optional(),
});

export type OperationResult = z.infer<typeof OperationResultSchema>;

export const GameViewSchema = z.object({
  summary: GameSummarySchema,
  world: WorldStateSchema,
  actions: z.array(ActionSchema),
  events: z.array(EventSchema),
  conversations: z.array(ConversationSchema),
  branches: z.array(BranchSummarySchema),
});

export type GameView = z.infer<typeof GameViewSchema>;

export const ScenarioValidationSchema = z.object({
  valid: z.boolean(),
  issues: z.array(
    z.object({
      path: z.string(),
      severity: z.enum(['error', 'warning']),
      message: z.string(),
    }),
  ),
});

export type ScenarioValidation = z.infer<typeof ScenarioValidationSchema>;

export const ProviderCapabilitiesSchema = z.object({
  nativeModelApi: z.boolean(),
  structuredOutput: z.boolean(),
  streaming: z.boolean(),
  modelLifecycle: z.boolean(),
  tokenCounting: z.boolean(),
});

export const LocalModelInfoSchema = z.object({
  key: z.string().min(1).max(500),
  displayName: z.string().min(1).max(500),
  publisher: z.string().max(200).optional(),
  architecture: z.string().max(200).optional(),
  format: z.enum(['GGUF', 'MLX', 'other']).optional(),
  quantization: z.string().max(120).optional(),
  parameterSize: z.string().max(120).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  state: z.enum(['loaded', 'unloaded', 'loading', 'error', 'unknown']),
  instanceId: z.string().max(500).optional(),
  contextLength: z.number().int().positive().optional(),
  maxContextLength: z.number().int().positive().optional(),
  kind: z.enum(['llm', 'embedding', 'vision', 'unknown']),
  capabilities: z.array(z.enum(['chat', 'vision', 'tools', 'reasoning', 'embedding'])),
  loadConfig: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export type LocalModelInfo = z.infer<typeof LocalModelInfoSchema>;
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

export const ProviderStatusSchema = z.object({
  id: z.enum(['lm-studio', 'ollama', 'openai-compatible', 'deterministic']),
  displayName: z.string(),
  recommended: z.boolean(),
  health: z.enum([
    'ready',
    'not-detected',
    'authentication-required',
    'no-models',
    'model-unloaded',
    'error',
  ]),
  endpoint: z.string(),
  message: z.string(),
  capabilities: ProviderCapabilitiesSchema,
});

export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export const ModelProbeResultSchema = z.object({
  status: z.enum(['ready', 'warning', 'failed']),
  connection: z.boolean(),
  authenticated: z.boolean(),
  modelReady: z.boolean(),
  structuredOutput: z.boolean(),
  streaming: z.boolean(),
  contextLength: z.number().int().positive().optional(),
  firstTokenMs: z.number().nonnegative().optional(),
  totalMs: z.number().nonnegative(),
  tokensPerSecond: z.number().nonnegative().optional(),
  suitability: z.object({
    simulation: z.boolean(),
    diplomacy: z.boolean(),
    advisor: z.boolean(),
    summarization: z.boolean(),
  }),
  messages: z.array(z.string().max(1_000)),
  testedAt: z.string().datetime(),
});

export type ModelProbeResult = z.infer<typeof ModelProbeResultSchema>;

export const SanitizedDiagnosticsSchema = z.object({
  generatedAt: z.string().datetime(),
  provider: z.string(),
  endpoint: z.string(),
  endpointPolicy: z.enum(['loopback', 'approved-lan', 'blocked']),
  serverStatus: z.string(),
  nativeApi: z.boolean(),
  modelCount: z.number().int().nonnegative(),
  selectedModel: z.string(),
  selectedModelState: z.string(),
  structuredOutput: z.string(),
  recentErrors: z.array(
    z.object({ code: z.string(), message: z.string(), at: z.string().datetime() }),
  ),
  privacy: z.literal('No prompts, chat text, actions, tokens, headers, or raw responses included.'),
});

export type SanitizedDiagnostics = z.infer<typeof SanitizedDiagnosticsSchema>;

export const TimelineProgressSchema = z.object({
  gameId: GameIdSchema,
  phase: z.enum([
    'assembling',
    'generating',
    'validating',
    'applying',
    'events',
    'saving',
    'memory',
    'complete',
    'cancelled',
    'failed',
  ]),
  detail: z.string().max(500),
  elapsedMs: z.number().int().nonnegative(),
  cancellable: z.boolean(),
});

export type TimelineProgress = z.infer<typeof TimelineProgressSchema>;

export const SnapshotComparisonSchema = z.object({
  leftBranchId: BranchIdSchema,
  rightBranchId: BranchIdSchema,
  territoryChanges: z.array(
    z.object({
      regionId: z.string(),
      regionName: z.string(),
      leftOwner: z.string(),
      rightOwner: z.string(),
    }),
  ),
  statChanges: z.array(
    z.object({
      actorId: z.string(),
      actorName: z.string(),
      stat: z.string(),
      left: z.number(),
      right: z.number(),
    }),
  ),
  treatyChanges: z.array(z.string()),
  conflictChanges: z.array(z.string()),
});

export type SnapshotComparison = z.infer<typeof SnapshotComparisonSchema>;

export const IpcRequestSchemas = {
  [IpcChannels.settingsUpdate]: AppSettingsSchema,
  [IpcChannels.settingsStoreToken]: z.object({
    provider: z.enum(['lm-studio', 'openai-compatible']),
    token: z.string().min(1).max(4_096),
  }),
  [IpcChannels.settingsForgetToken]: z.enum(['lm-studio', 'openai-compatible']),
  [IpcChannels.scenariosGet]: ScenarioIdSchema,
  [IpcChannels.scenariosSave]: ScenarioEditorInputSchema,
  [IpcChannels.scenariosDuplicate]: ScenarioIdSchema,
  [IpcChannels.scenariosRemove]: ScenarioIdSchema,
  [IpcChannels.scenariosExport]: ScenarioIdSchema,
  [IpcChannels.scenariosValidate]: ScenarioSchema,
  [IpcChannels.gamesCreate]: CreateGameInputSchema,
  [IpcChannels.gamesLoad]: GameIdSchema,
  [IpcChannels.gamesRename]: z.object({
    gameId: GameIdSchema,
    title: z.string().trim().min(1).max(160),
  }),
  [IpcChannels.gamesDelete]: GameIdSchema,
  [IpcChannels.gamesExport]: GameIdSchema,
  [IpcChannels.worldInspectActor]: z.object({
    gameId: GameIdSchema,
    branchId: BranchIdSchema,
    actorId: ActorIdSchema,
  }),
  [IpcChannels.actionsList]: z.object({
    gameId: GameIdSchema,
    branchId: BranchIdSchema,
  }),
  [IpcChannels.actionsSave]: DraftActionInputSchema,
  [IpcChannels.actionsRemove]: z.object({
    gameId: GameIdSchema,
    branchId: BranchIdSchema,
    actionId: ActionIdSchema,
  }),
  [IpcChannels.actionsReorder]: z.object({
    gameId: GameIdSchema,
    branchId: BranchIdSchema,
    actionIds: z.array(ActionIdSchema),
  }),
  [IpcChannels.chatsList]: z.object({
    gameId: GameIdSchema,
    branchId: BranchIdSchema,
  }),
  [IpcChannels.chatsSend]: SendMessageInputSchema,
  [IpcChannels.chatsArchive]: z.object({
    conversationId: ConversationIdSchema,
    archived: z.boolean(),
  }),
  [IpcChannels.advisorAsk]: SendMessageInputSchema,
  [IpcChannels.timelineJump]: TimelineJumpInputSchema,
  [IpcChannels.timelineCancel]: GameIdSchema,
  [IpcChannels.timelineBranches]: GameIdSchema,
  [IpcChannels.timelineRewind]: RewindInputSchema,
  [IpcChannels.timelineCompare]: z.object({
    gameId: GameIdSchema,
    leftBranchId: BranchIdSchema,
    rightBranchId: BranchIdSchema,
  }),
  [IpcChannels.aiListModels]: ProviderSettingsSchema,
  [IpcChannels.aiTest]: ProviderSettingsSchema,
  [IpcChannels.aiDiagnostics]: ProviderSettingsSchema,
  [IpcChannels.aiLoadModel]: z.object({
    settings: ProviderSettingsSchema,
    modelKey: z.string().min(1).max(500),
  }),
  [IpcChannels.aiUnloadModel]: z.object({
    settings: ProviderSettingsSchema,
    instanceId: z.string().min(1).max(500),
  }),
} as const;

export interface PaxLocaliaApi {
  app: {
    getInfo(): Promise<AppInfo>;
    getPaths(): Promise<AppPaths>;
    openLogsDirectory(): Promise<OperationResult>;
    exportAllData(): Promise<OperationResult>;
    deleteAllData(): Promise<OperationResult>;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(settings: AppSettings): Promise<AppSettings>;
    reset(): Promise<AppSettings>;
    storeToken(
      provider: 'lm-studio' | 'openai-compatible',
      token: string,
    ): Promise<OperationResult>;
    forgetToken(provider: 'lm-studio' | 'openai-compatible'): Promise<OperationResult>;
  };
  scenarios: {
    list(): Promise<ScenarioSummary[]>;
    get(id: ScenarioId): Promise<Scenario>;
    save(input: ScenarioEditorInput): Promise<Scenario>;
    duplicate(id: ScenarioId): Promise<Scenario>;
    remove(id: ScenarioId): Promise<OperationResult>;
    import(): Promise<OperationResult>;
    export(id: ScenarioId): Promise<OperationResult>;
    validate(scenario: Scenario): Promise<ScenarioValidation>;
  };
  games: {
    list(): Promise<GameSummary[]>;
    create(input: CreateGameInput): Promise<GameView>;
    load(id: GameId): Promise<GameView>;
    rename(id: GameId, title: string): Promise<GameSummary>;
    remove(id: GameId): Promise<OperationResult>;
    export(id: GameId): Promise<OperationResult>;
    import(): Promise<OperationResult>;
  };
  actions: {
    list(gameId: GameId, branchId: BranchId): Promise<GameAction[]>;
    save(input: DraftActionInput): Promise<GameAction[]>;
    remove(gameId: GameId, branchId: BranchId, actionId: string): Promise<GameAction[]>;
    reorder(gameId: GameId, branchId: BranchId, actionIds: string[]): Promise<GameAction[]>;
  };
  chats: {
    list(gameId: GameId, branchId: BranchId): Promise<Conversation[]>;
    send(input: SendMessageInput): Promise<Conversation>;
    archive(conversationId: ConversationId, archived: boolean): Promise<Conversation>;
  };
  advisor: {
    ask(input: SendMessageInput): Promise<Conversation>;
  };
  timeline: {
    jump(input: TimelineJumpInput): Promise<TimelineJumpResult>;
    cancel(gameId: GameId): Promise<OperationResult>;
    branches(gameId: GameId): Promise<BranchSummary[]>;
    rewind(input: RewindInput): Promise<GameView>;
    compare(
      gameId: GameId,
      leftBranchId: BranchId,
      rightBranchId: BranchId,
    ): Promise<SnapshotComparison>;
    onProgress(listener: (progress: TimelineProgress) => void): () => void;
  };
  ai: {
    listProviders(): Promise<ProviderStatus[]>;
    listModels(settings: ProviderSettings): Promise<LocalModelInfo[]>;
    test(settings: ProviderSettings): Promise<ModelProbeResult>;
    diagnostics(settings: ProviderSettings): Promise<SanitizedDiagnostics>;
    loadModel(settings: ProviderSettings, modelKey: string): Promise<LocalModelInfo[]>;
    unloadModel(settings: ProviderSettings, instanceId: string): Promise<LocalModelInfo[]>;
  };
  database: {
    integrityCheck(): Promise<OperationResult>;
  };
}

export type {
  AppSettings,
  BranchSummary,
  Conversation,
  CreateGameInput,
  DraftActionInput,
  GameAction,
  GameEvent,
  GameSummary,
  Message,
  ProviderSettings,
  RewindInput,
  Scenario,
  ScenarioEditorInput,
  ScenarioSummary,
  SendMessageInput,
  TimelineJumpInput,
  TimelineJumpResult,
  WorldState,
};
