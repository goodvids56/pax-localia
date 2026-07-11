import { LocalAIError, type FetchTransport } from './types';

export interface RequestOptions {
  fetch: FetchTransport;
  url: string;
  init?: RequestInit;
  timeoutMs: number;
  signal?: AbortSignal;
}

export async function request(
  options: RequestOptions,
): Promise<{ response: Response; durationMs: number }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  const abort = (): void => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const started = performance.now();

  try {
    const response = await options.fetch(options.url, {
      ...options.init,
      signal: controller.signal,
    });
    return { response, durationMs: performance.now() - started };
  } catch (error) {
    if (timedOut) {
      throw new LocalAIError('TIMEOUT', `Local provider timed out after ${options.timeoutMs} ms.`);
    }
    if (options.signal?.aborted || controller.signal.aborted) {
      throw new LocalAIError('ABORTED', 'Local generation was cancelled.');
    }
    throw new LocalAIError(
      'SERVER_UNAVAILABLE',
      `Could not reach the local provider: ${error instanceof Error ? error.message : 'network error'}`,
      undefined,
      true,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

export async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new LocalAIError(
      'MALFORMED_RESPONSE',
      `The local provider returned non-JSON content (HTTP ${response.status}).`,
      response.status,
    );
  }
}

export async function ensureResponseOk(response: Response): Promise<void> {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) {
    throw new LocalAIError(
      'AUTHENTICATION_REQUIRED',
      'The local provider requires a valid token.',
      response.status,
    );
  }
  let message = `Local provider returned HTTP ${response.status}.`;
  try {
    const payload = (await response.clone().json()) as {
      error?: { message?: string; type?: string; code?: string } | string;
      message?: string;
    };
    const detail =
      typeof payload.error === 'string'
        ? payload.error
        : (payload.error?.message ?? payload.message ?? '');
    if (detail) message = detail.slice(0, 800);
  } catch {
    // Do not include raw response bodies in errors or diagnostics.
  }
  const normalized = message.toLocaleLowerCase();
  if (normalized.includes('context') && /(length|overflow|window|token)/.test(normalized)) {
    throw new LocalAIError('CONTEXT_OVERFLOW', message, response.status);
  }
  if (normalized.includes('not loaded') || normalized.includes('no loaded model')) {
    throw new LocalAIError('MODEL_NOT_LOADED', message, response.status, true);
  }
  if (response.status === 404 && normalized.includes('model')) {
    throw new LocalAIError('MODEL_NOT_FOUND', message, response.status);
  }
  throw new LocalAIError('HTTP_ERROR', message, response.status, response.status >= 500);
}

export function authorizationHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
