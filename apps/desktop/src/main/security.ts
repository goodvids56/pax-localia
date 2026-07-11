import { session, type BrowserWindow } from 'electron';
import type { Logger } from 'pino';
import { isRuntimeRequestAllowed } from '@pax-localia/ai';

export interface ApprovedEndpoint {
  url: string;
  allowLan: boolean;
}

export function isNavigationAllowed(
  target: string,
  current: string,
  developmentOrigin?: string,
): boolean {
  try {
    const targetUrl = new URL(target);
    if (targetUrl.protocol === 'file:' && new URL(current).protocol === 'file:') return true;
    if (
      developmentOrigin &&
      targetUrl.origin === developmentOrigin &&
      new URL(current).origin === developmentOrigin
    ) {
      return true;
    }
    return target === 'about:blank' && current === '';
  } catch {
    return false;
  }
}

export function installSessionSecurity(
  window: BrowserWindow,
  endpoints: () => readonly ApprovedEndpoint[],
  logger: Logger,
  developmentOrigin?: string,
): void {
  const appSession = session.defaultSession;
  appSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  appSession.setPermissionCheckHandler(() => false);

  appSession.webRequest.onBeforeRequest((details, callback) => {
    if (developmentOrigin && details.url.startsWith(developmentOrigin)) {
      callback({ cancel: false });
      return;
    }
    const allowed = isRuntimeRequestAllowed(details.url, endpoints());
    if (!allowed) {
      let hostname = 'invalid-url';
      try {
        hostname = new URL(details.url).hostname || new URL(details.url).protocol;
      } catch {
        // Keep sanitized fallback.
      }
      logger.warn(
        { hostname, resourceType: details.resourceType },
        'Blocked request outside offline network policy',
      );
    }
    callback({ cancel: !allowed });
  });

  appSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame') {
      callback(details.responseHeaders ? { responseHeaders: details.responseHeaders } : {});
      return;
    }
    const development = Boolean(developmentOrigin);
    const csp = development
      ? `default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ${developmentOrigin ?? ''} ws://127.0.0.1:* ws://localhost:*; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`
      : `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer'],
      },
    });
  });

  window.webContents.on('will-navigate', (event, target) => {
    if (!isNavigationAllowed(target, window.webContents.getURL(), developmentOrigin)) {
      event.preventDefault();
      logger.warn({ targetOrigin: safeOrigin(target) }, 'Blocked renderer navigation');
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    logger.warn({ targetOrigin: safeOrigin(url) }, 'Blocked renderer window creation');
    return { action: 'deny' };
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function safeOrigin(raw: string): string {
  try {
    return new URL(raw).origin;
  } catch {
    return 'invalid-url';
  }
}
