import {
  ActionSchema,
  ActorSchema,
  AppInfoSchema,
  AppPathsSchema,
  AppSettingsSchema,
  BranchSummarySchema,
  CommitmentSchema,
  ConversationSchema,
  GameSummarySchema,
  GameViewSchema,
  IpcChannels,
  IpcRequestSchemas,
  LocalModelInfoSchema,
  ModelProbeResultSchema,
  OperationResultSchema,
  ProviderStatusSchema,
  SanitizedDiagnosticsSchema,
  ScenarioSchema,
  ScenarioSummarySchema,
  ScenarioValidationSchema,
  SnapshotComparisonSchema,
  TimelineJumpResultSchema,
} from '@pax-localia/domain';
import { LocalAIError } from '@pax-localia/ai';
import { app, ipcMain } from 'electron';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AppService } from './app-service';

function register<InputSchema extends z.ZodType, OutputSchema extends z.ZodType>(
  channel: string,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  logger: Logger,
  handler: (input: z.output<InputSchema>) => z.input<OutputSchema> | Promise<z.input<OutputSchema>>,
): void {
  ipcMain.handle(channel, async (_event, input: unknown) => {
    let parsed: z.output<InputSchema>;
    try {
      parsed = inputSchema.parse(input);
    } catch {
      logger.warn({ channel }, 'Rejected invalid IPC request');
      throw new Error(`Invalid request for ${channel}.`);
    }
    try {
      const output = await handler(parsed);
      return outputSchema.parse(output);
    } catch (error) {
      const message =
        error instanceof LocalAIError
          ? `${error.message} ${error.help}`
          : error instanceof Error
            ? error.message
            : 'Unknown local application error.';
      logger.error(
        {
          channel,
          code: error instanceof LocalAIError ? error.code : 'APPLICATION_ERROR',
          message,
        },
        'IPC operation failed',
      );
      throw new Error(message, { cause: error });
    }
  });
}

export function registerIpcHandlers(service: AppService, logger: Logger): void {
  const none = z.undefined();
  register(IpcChannels.appInfo, none, AppInfoSchema, logger, () => ({
    name: 'Pax Localia' as const,
    version: app.getVersion(),
    platform: process.platform as 'win32' | 'darwin' | 'linux',
    packaged: app.isPackaged,
    noTelemetry: true as const,
  }));
  register(IpcChannels.appPaths, none, AppPathsSchema, logger, () => service.paths);
  register(IpcChannels.appOpenLogs, none, OperationResultSchema, logger, () =>
    service.openLogsDirectory(),
  );
  register(IpcChannels.appExportAll, none, OperationResultSchema, logger, () =>
    service.exportAllData(),
  );
  register(IpcChannels.appDeleteAll, none, OperationResultSchema, logger, () =>
    service.deleteAllData(),
  );

  register(IpcChannels.settingsGet, none, AppSettingsSchema, logger, () => service.settings());
  register(
    IpcChannels.settingsUpdate,
    IpcRequestSchemas[IpcChannels.settingsUpdate],
    AppSettingsSchema,
    logger,
    (settings) => service.updateSettings(settings),
  );
  register(IpcChannels.settingsReset, none, AppSettingsSchema, logger, () =>
    service.resetSettings(),
  );
  register(
    IpcChannels.settingsStoreToken,
    IpcRequestSchemas[IpcChannels.settingsStoreToken],
    OperationResultSchema,
    logger,
    ({ provider, token }) => service.storeToken(provider, token),
  );
  register(
    IpcChannels.settingsForgetToken,
    IpcRequestSchemas[IpcChannels.settingsForgetToken],
    OperationResultSchema,
    logger,
    (provider) => service.forgetToken(provider),
  );

  register(IpcChannels.scenariosList, none, z.array(ScenarioSummarySchema), logger, () =>
    service.listScenarios(),
  );
  register(
    IpcChannels.scenariosGet,
    IpcRequestSchemas[IpcChannels.scenariosGet],
    ScenarioSchema,
    logger,
    (id) => service.getScenario(id),
  );
  register(
    IpcChannels.scenariosSave,
    IpcRequestSchemas[IpcChannels.scenariosSave],
    ScenarioSchema,
    logger,
    (input) => service.saveScenario(input),
  );
  register(
    IpcChannels.scenariosDuplicate,
    IpcRequestSchemas[IpcChannels.scenariosDuplicate],
    ScenarioSchema,
    logger,
    (id) => service.duplicateScenario(id),
  );
  register(
    IpcChannels.scenariosRemove,
    IpcRequestSchemas[IpcChannels.scenariosRemove],
    OperationResultSchema,
    logger,
    (id) => service.removeScenario(id),
  );
  register(IpcChannels.scenariosImport, none, OperationResultSchema, logger, () =>
    service.importScenario(),
  );
  register(
    IpcChannels.scenariosExport,
    IpcRequestSchemas[IpcChannels.scenariosExport],
    OperationResultSchema,
    logger,
    (id) => service.exportScenario(id),
  );
  register(
    IpcChannels.scenariosValidate,
    IpcRequestSchemas[IpcChannels.scenariosValidate],
    ScenarioValidationSchema,
    logger,
    (scenario) => service.validateScenario(scenario),
  );

  register(IpcChannels.gamesList, none, z.array(GameSummarySchema), logger, () =>
    service.database.listGames(),
  );
  register(
    IpcChannels.gamesCreate,
    IpcRequestSchemas[IpcChannels.gamesCreate],
    GameViewSchema,
    logger,
    (input) => service.createGame(input),
  );
  register(
    IpcChannels.gamesLoad,
    IpcRequestSchemas[IpcChannels.gamesLoad],
    GameViewSchema,
    logger,
    (id) => service.database.loadGame(id),
  );
  register(
    IpcChannels.gamesRename,
    IpcRequestSchemas[IpcChannels.gamesRename],
    GameSummarySchema,
    logger,
    ({ gameId, title }) => service.database.renameGame(gameId, title),
  );
  register(
    IpcChannels.gamesDelete,
    IpcRequestSchemas[IpcChannels.gamesDelete],
    OperationResultSchema,
    logger,
    (id) => {
      service.database.deleteGame(id);
      return { ok: true, message: 'Game deleted from local storage.' };
    },
  );
  register(
    IpcChannels.gamesExport,
    IpcRequestSchemas[IpcChannels.gamesExport],
    OperationResultSchema,
    logger,
    (id) => service.exportGame(id),
  );
  register(IpcChannels.gamesImport, none, OperationResultSchema, logger, () =>
    service.importGame(),
  );
  register(
    IpcChannels.worldInspectActor,
    IpcRequestSchemas[IpcChannels.worldInspectActor],
    ActorSchema,
    logger,
    ({ gameId, branchId, actorId }) => {
      const actor = service.database.getWorld(gameId, branchId).actors[actorId];
      if (!actor) throw new Error('Actor was not found.');
      return actor;
    },
  );

  register(
    IpcChannels.actionsList,
    IpcRequestSchemas[IpcChannels.actionsList],
    z.array(ActionSchema),
    logger,
    ({ gameId, branchId }) => service.database.listActions(gameId, branchId),
  );
  register(
    IpcChannels.actionsSave,
    IpcRequestSchemas[IpcChannels.actionsSave],
    z.array(ActionSchema),
    logger,
    (input) => service.database.saveAction(input),
  );
  register(
    IpcChannels.actionsRemove,
    IpcRequestSchemas[IpcChannels.actionsRemove],
    z.array(ActionSchema),
    logger,
    ({ gameId, branchId, actionId }) => service.database.removeAction(gameId, branchId, actionId),
  );
  register(
    IpcChannels.actionsReorder,
    IpcRequestSchemas[IpcChannels.actionsReorder],
    z.array(ActionSchema),
    logger,
    ({ gameId, branchId, actionIds }) =>
      service.database.reorderActions(gameId, branchId, actionIds),
  );

  register(
    IpcChannels.chatsList,
    IpcRequestSchemas[IpcChannels.chatsList],
    z.array(ConversationSchema),
    logger,
    ({ gameId, branchId }) => service.database.listConversations(gameId, branchId),
  );
  register(
    IpcChannels.chatsSend,
    IpcRequestSchemas[IpcChannels.chatsSend],
    ConversationSchema,
    logger,
    (input) => service.sendMessage(input),
  );
  register(
    IpcChannels.advisorAsk,
    IpcRequestSchemas[IpcChannels.advisorAsk],
    ConversationSchema,
    logger,
    (input) => service.sendMessage(input, true),
  );
  register(
    IpcChannels.chatsArchive,
    IpcRequestSchemas[IpcChannels.chatsArchive],
    ConversationSchema,
    logger,
    ({ conversationId, archived }) => service.archiveConversation(conversationId, archived),
  );
  register(
    IpcChannels.chatsRespondCommitment,
    IpcRequestSchemas[IpcChannels.chatsRespondCommitment],
    CommitmentSchema,
    logger,
    ({ gameId, branchId, commitmentId, response }) =>
      service.database.respondToCommitment(gameId, branchId, commitmentId, response),
  );

  register(
    IpcChannels.timelineJump,
    IpcRequestSchemas[IpcChannels.timelineJump],
    TimelineJumpResultSchema,
    logger,
    (input) => service.jumpTimeline(input),
  );
  register(
    IpcChannels.timelineCancel,
    IpcRequestSchemas[IpcChannels.timelineCancel],
    OperationResultSchema,
    logger,
    (gameId) => service.cancelTimeline(gameId),
  );
  register(
    IpcChannels.timelineBranches,
    IpcRequestSchemas[IpcChannels.gamesLoad],
    z.array(BranchSummarySchema),
    logger,
    (gameId) => service.database.listBranches(gameId),
  );
  register(
    IpcChannels.timelineSwitchBranch,
    IpcRequestSchemas[IpcChannels.timelineSwitchBranch],
    GameViewSchema,
    logger,
    ({ gameId, branchId }) => service.database.switchBranch(gameId, branchId),
  );
  register(
    IpcChannels.timelineRewind,
    IpcRequestSchemas[IpcChannels.timelineRewind],
    GameViewSchema,
    logger,
    (input) => service.rewind(input),
  );
  register(
    IpcChannels.timelineCompare,
    IpcRequestSchemas[IpcChannels.timelineCompare],
    SnapshotComparisonSchema,
    logger,
    ({ gameId, leftBranchId, rightBranchId }) =>
      service.compareBranches(gameId, leftBranchId, rightBranchId),
  );

  register(IpcChannels.aiListProviders, none, z.array(ProviderStatusSchema), logger, () =>
    service.listProviderStatuses(),
  );
  register(
    IpcChannels.aiListModels,
    IpcRequestSchemas[IpcChannels.aiListModels],
    z.array(LocalModelInfoSchema),
    logger,
    (settings) => service.listModels(settings),
  );
  register(
    IpcChannels.aiTest,
    IpcRequestSchemas[IpcChannels.aiTest],
    ModelProbeResultSchema,
    logger,
    (settings) => service.testModel(settings),
  );
  register(
    IpcChannels.aiDiagnostics,
    IpcRequestSchemas[IpcChannels.aiDiagnostics],
    SanitizedDiagnosticsSchema,
    logger,
    (settings) => service.diagnostics(settings),
  );
  register(
    IpcChannels.aiLoadModel,
    IpcRequestSchemas[IpcChannels.aiLoadModel],
    z.array(LocalModelInfoSchema),
    logger,
    ({ settings, modelKey }) => service.loadModel(settings, modelKey),
  );
  register(
    IpcChannels.aiUnloadModel,
    IpcRequestSchemas[IpcChannels.aiUnloadModel],
    z.array(LocalModelInfoSchema),
    logger,
    ({ settings, instanceId }) => service.unloadModel(settings, instanceId),
  );

  register(IpcChannels.databaseIntegrity, none, OperationResultSchema, logger, () =>
    service.integrityCheck(),
  );
}
