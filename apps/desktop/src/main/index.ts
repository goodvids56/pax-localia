import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, Menu } from 'electron';
import type { Logger } from 'pino';
import { AppService } from './app-service';
import { registerIpcHandlers } from './ipc';
import { createLogger } from './logger';
import { installSessionSecurity } from './security';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | undefined;
let service: AppService | undefined;
let logger: Logger | undefined;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: 'Pax Localia',
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#111820',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
      devTools: !app.isPackaged,
    },
  });
  const developmentOrigin = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin
    : undefined;
  installSessionSecurity(
    window,
    () => service?.approvedEndpoints() ?? [],
    serviceLogger(),
    developmentOrigin,
  );
  service?.setProgressTarget(window);
  window.once('ready-to-show', () => window.show());
  window.webContents.on('render-process-gone', (_event, details) => {
    serviceLogger().error(
      { reason: details.reason, exitCode: details.exitCode },
      'Renderer process exited',
    );
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  return window;
}

function serviceLogger() {
  if (!logger) throw new Error('Application logger is not initialized.');
  return logger;
}

void app.whenReady().then(() => {
  app.setAppUserModelId('org.paxlocalia.desktop');
  const dataDirectory = app.getPath('userData');
  const logsDirectory = path.join(dataDirectory, 'logs');
  mkdirSync(logsDirectory, { recursive: true });
  logger = createLogger(logsDirectory);
  service = new AppService(dataDirectory, logsDirectory, logger);
  registerIpcHandlers(service, logger);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Pax Localia',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'quit', accelerator: 'CmdOrCtrl+Q' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload', visible: !app.isPackaged },
          { role: 'toggleDevTools', visible: !app.isPackaged },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'togglefullscreen' },
        ],
      },
    ]),
  );
  mainWindow = createMainWindow();
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  service?.close();
  service = undefined;
});
