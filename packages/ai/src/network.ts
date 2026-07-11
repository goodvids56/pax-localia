import { isIP } from 'node:net';
import { LocalAIError } from './types';

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLocaleLowerCase();
  if (normalized === 'localhost' || normalized === '::1') return true;
  if (isIP(normalized) === 4) {
    return normalized.startsWith('127.');
  }
  return false;
}

function isPrivateLanHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLocaleLowerCase();
  if (normalized.endsWith('.local')) return true;
  const kind = isIP(normalized);
  if (kind === 4) {
    const parts = normalized.split('.').map(Number);
    const [first, second] = parts;
    return (
      first === 10 ||
      (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    );
  }
  if (kind === 6) {
    return (
      normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')
    );
  }
  return false;
}

export function classifyEndpoint(
  raw: string,
  allowLan: boolean,
): 'loopback' | 'approved-lan' | 'blocked' {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return 'blocked';
    if (isLoopbackHost(url.hostname)) return 'loopback';
    if (allowLan && isPrivateLanHost(url.hostname)) return 'approved-lan';
    return 'blocked';
  } catch {
    return 'blocked';
  }
}

export function assertEndpointAllowed(raw: string, allowLan: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LocalAIError('NETWORK_POLICY_BLOCKED', 'The provider endpoint is not a valid URL.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new LocalAIError(
      'NETWORK_POLICY_BLOCKED',
      'Provider URLs cannot contain credentials, queries, or fragments.',
    );
  }
  if (classifyEndpoint(raw, allowLan) === 'blocked') {
    throw new LocalAIError(
      'NETWORK_POLICY_BLOCKED',
      `Pax Localia blocked the provider host ${url.hostname}.`,
    );
  }
  return url;
}

export function normalizeProviderBaseUrl(
  raw: string,
  provider: 'lm-studio' | 'ollama' | 'openai-compatible',
  allowLan: boolean,
): string {
  const url = assertEndpointAllowed(raw, allowLan);
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (provider === 'lm-studio') {
    url.pathname = url.pathname.replace(/\/(?:api\/v1|v1)\/?$/i, '');
  } else if (provider === 'openai-compatible') {
    url.pathname = url.pathname.replace(/\/v1\/?$/i, '');
  } else {
    url.pathname = url.pathname.replace(/\/api\/?$/i, '');
  }
  return url.toString().replace(/\/$/, '');
}

export function sanitizedEndpoint(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return 'invalid endpoint';
  }
}

export function isRuntimeRequestAllowed(
  raw: string,
  configuredEndpoints: readonly { url: string; allowLan: boolean }[],
): boolean {
  let candidate: URL;
  try {
    candidate = new URL(raw);
  } catch {
    return false;
  }
  if (['file:', 'data:', 'blob:', 'pax-localia:'].includes(candidate.protocol)) return true;
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(candidate.protocol)) return false;

  return configuredEndpoints.some((entry) => {
    if (classifyEndpoint(entry.url, entry.allowLan) === 'blocked') return false;
    try {
      const allowed = new URL(entry.url);
      const candidateProtocol =
        candidate.protocol === 'ws:'
          ? 'http:'
          : candidate.protocol === 'wss:'
            ? 'https:'
            : candidate.protocol;
      return (
        candidateProtocol === allowed.protocol &&
        candidate.hostname === allowed.hostname &&
        candidate.port === allowed.port
      );
    } catch {
      return false;
    }
  });
}
