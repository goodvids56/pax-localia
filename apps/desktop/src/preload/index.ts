import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, TimelineProgressSchema, type PaxLocaliaApi } from '@pax-localia/domain';

const api: PaxLocaliaApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IpcChannels.appInfo),
    getPaths: () => ipcRenderer.invoke(IpcChannels.appPaths),
    openLogsDirectory: () => ipcRenderer.invoke(IpcChannels.appOpenLogs),
    exportAllData: () => ipcRenderer.invoke(IpcChannels.appExportAll),
    deleteAllData: () => ipcRenderer.invoke(IpcChannels.appDeleteAll),
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    update: (settings) => ipcRenderer.invoke(IpcChannels.settingsUpdate, settings),
    reset: () => ipcRenderer.invoke(IpcChannels.settingsReset),
    storeToken: (provider, token) =>
      ipcRenderer.invoke(IpcChannels.settingsStoreToken, { provider, token }),
    forgetToken: (provider) => ipcRenderer.invoke(IpcChannels.settingsForgetToken, provider),
  },
  scenarios: {
    list: () => ipcRenderer.invoke(IpcChannels.scenariosList),
    get: (id) => ipcRenderer.invoke(IpcChannels.scenariosGet, id),
    save: (input) => ipcRenderer.invoke(IpcChannels.scenariosSave, input),
    duplicate: (id) => ipcRenderer.invoke(IpcChannels.scenariosDuplicate, id),
    remove: (id) => ipcRenderer.invoke(IpcChannels.scenariosRemove, id),
    import: () => ipcRenderer.invoke(IpcChannels.scenariosImport),
    export: (id) => ipcRenderer.invoke(IpcChannels.scenariosExport, id),
    validate: (scenario) => ipcRenderer.invoke(IpcChannels.scenariosValidate, scenario),
  },
  games: {
    list: () => ipcRenderer.invoke(IpcChannels.gamesList),
    create: (input) => ipcRenderer.invoke(IpcChannels.gamesCreate, input),
    load: (id) => ipcRenderer.invoke(IpcChannels.gamesLoad, id),
    rename: (gameId, title) => ipcRenderer.invoke(IpcChannels.gamesRename, { gameId, title }),
    remove: (id) => ipcRenderer.invoke(IpcChannels.gamesDelete, id),
    export: (id) => ipcRenderer.invoke(IpcChannels.gamesExport, id),
    import: () => ipcRenderer.invoke(IpcChannels.gamesImport),
  },
  actions: {
    list: (gameId, branchId) => ipcRenderer.invoke(IpcChannels.actionsList, { gameId, branchId }),
    save: (input) => ipcRenderer.invoke(IpcChannels.actionsSave, input),
    remove: (gameId, branchId, actionId) =>
      ipcRenderer.invoke(IpcChannels.actionsRemove, { gameId, branchId, actionId }),
    reorder: (gameId, branchId, actionIds) =>
      ipcRenderer.invoke(IpcChannels.actionsReorder, { gameId, branchId, actionIds }),
  },
  chats: {
    list: (gameId, branchId) => ipcRenderer.invoke(IpcChannels.chatsList, { gameId, branchId }),
    send: (input) => ipcRenderer.invoke(IpcChannels.chatsSend, input),
    archive: (conversationId, archived) =>
      ipcRenderer.invoke(IpcChannels.chatsArchive, { conversationId, archived }),
    respondCommitment: (gameId, branchId, commitmentId, response) =>
      ipcRenderer.invoke(IpcChannels.chatsRespondCommitment, {
        gameId,
        branchId,
        commitmentId,
        response,
      }),
  },
  advisor: {
    ask: (input) => ipcRenderer.invoke(IpcChannels.advisorAsk, input),
  },
  timeline: {
    jump: (input) => ipcRenderer.invoke(IpcChannels.timelineJump, input),
    cancel: (gameId) => ipcRenderer.invoke(IpcChannels.timelineCancel, gameId),
    branches: (gameId) => ipcRenderer.invoke(IpcChannels.timelineBranches, gameId),
    switchBranch: (gameId, branchId) =>
      ipcRenderer.invoke(IpcChannels.timelineSwitchBranch, { gameId, branchId }),
    rewind: (input) => ipcRenderer.invoke(IpcChannels.timelineRewind, input),
    compare: (gameId, leftBranchId, rightBranchId) =>
      ipcRenderer.invoke(IpcChannels.timelineCompare, {
        gameId,
        leftBranchId,
        rightBranchId,
      }),
    onProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => {
        const progress = TimelineProgressSchema.safeParse(raw);
        if (progress.success) listener(progress.data);
      };
      ipcRenderer.on(IpcChannels.timelineProgress, handler);
      return () => ipcRenderer.removeListener(IpcChannels.timelineProgress, handler);
    },
  },
  ai: {
    listProviders: () => ipcRenderer.invoke(IpcChannels.aiListProviders),
    listModels: (settings) => ipcRenderer.invoke(IpcChannels.aiListModels, settings),
    test: (settings) => ipcRenderer.invoke(IpcChannels.aiTest, settings),
    diagnostics: (settings) => ipcRenderer.invoke(IpcChannels.aiDiagnostics, settings),
    loadModel: (settings, modelKey) =>
      ipcRenderer.invoke(IpcChannels.aiLoadModel, { settings, modelKey }),
    unloadModel: (settings, instanceId) =>
      ipcRenderer.invoke(IpcChannels.aiUnloadModel, { settings, instanceId }),
  },
  database: {
    integrityCheck: () => ipcRenderer.invoke(IpcChannels.databaseIntegrity),
  },
};

contextBridge.exposeInMainWorld('paxLocalia', Object.freeze(api));
