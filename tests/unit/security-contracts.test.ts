import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IpcChannels } from '@pax-localia/domain';
import { isRuntimeRequestAllowed } from '@pax-localia/ai';

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), 'utf8');
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const fullPath = path.join(directory, name);
    return statSync(fullPath).isDirectory() ? filesUnder(fullPath) : [fullPath];
  });
}

describe('Electron security contract', () => {
  it('enables isolation and sandboxing while disabling renderer Node access', () => {
    const main = source('apps/desktop/src/main/index.ts');
    expect(main).toContain('contextIsolation: true');
    expect(main).toContain('nodeIntegration: false');
    expect(main).toContain('sandbox: true');
    expect(main).toContain('webSecurity: true');
    expect(main).toContain('allowRunningInsecureContent: false');
  });

  it('uses a restrictive CSP and blocks navigation, windows, permissions, and webviews', () => {
    const security = source('apps/desktop/src/main/security.ts');
    const html = source('apps/desktop/src/renderer/index.html');
    expect(security).toContain("object-src 'none'");
    expect(security).toContain("frame-src 'none'");
    expect(security).toContain('setPermissionRequestHandler');
    expect(security).toContain("return { action: 'deny' }");
    expect(security).toContain('will-attach-webview');
    expect(html).not.toMatch(/script-src[^"]*https?:/);
    expect(html).not.toMatch(/font-src[^"]*https?:/);
  });

  it('exposes a named, domain-grouped bridge rather than generic IPC primitives', () => {
    const preload = source('apps/desktop/src/preload/index.ts');
    expect(preload).toContain("exposeInMainWorld('paxLocalia'");
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*(send|invoke)/);
    expect(preload).not.toMatch(/from ['"]node:(fs|child_process|process)/);
    for (const domain of [
      'app',
      'settings',
      'scenarios',
      'games',
      'actions',
      'chats',
      'advisor',
      'timeline',
      'ai',
      'database',
    ]) {
      expect(preload).toContain(`${domain}: {`);
    }
    expect(new Set(Object.values(IpcChannels)).size).toBe(Object.values(IpcChannels).length);
  });
});

describe('runtime network policy', () => {
  const endpoints = [{ url: 'http://127.0.0.1:1234', allowLan: false }];

  it('allows packaged assets and the exact configured loopback origin', () => {
    expect(isRuntimeRequestAllowed('file:///opt/Pax%20Localia/index.html', endpoints)).toBe(true);
    expect(isRuntimeRequestAllowed('blob:file:///worker', endpoints)).toBe(true);
    expect(isRuntimeRequestAllowed('http://127.0.0.1:1234/v1/models', endpoints)).toBe(true);
    expect(isRuntimeRequestAllowed('ws://127.0.0.1:1234/stream', endpoints)).toBe(true);
  });

  it('blocks remote scripts, images, fonts, alternate ports, and unapproved LAN hosts', () => {
    for (const url of [
      'https://cdn.example.com/app.js',
      'https://images.example.com/map.png?token=secret',
      'https://fonts.example.com/font.woff2',
      'http://127.0.0.1:9999/v1/models',
      'http://192.168.1.20:1234/v1/models',
      'wss://public.example.com/socket',
    ]) {
      expect(isRuntimeRequestAllowed(url, endpoints), url).toBe(false);
    }
  });

  it('contains no renderer runtime CDN, remote font, tile, analytics, or public API URL', () => {
    const rendererRoot = path.join(process.cwd(), 'apps/desktop/src/renderer');
    const rendererSource = filesUnder(rendererRoot)
      .filter(
        (filename) =>
          !filename.includes(`${path.sep}.vite${path.sep}`) &&
          /\.(?:ts|tsx|css|html)$/.test(filename),
      )
      .map((filename) => readFileSync(filename, 'utf8'))
      .join('\n');
    expect(rendererSource).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|localhost)/);
    expect(rendererSource).not.toMatch(
      /google-analytics|segment\.com|sentry\.io|fonts\.googleapis/,
    );
  });
});
