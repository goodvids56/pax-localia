import { existsSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import pino, { type Logger } from 'pino';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const ROTATIONS = 4;

function rotate(logFile: string): void {
  if (!existsSync(logFile) || statSync(logFile).size < MAX_LOG_BYTES) return;
  for (let index = ROTATIONS - 1; index >= 1; index -= 1) {
    const source = `${logFile}.${index}`;
    const destination = `${logFile}.${index + 1}`;
    if (existsSync(source)) renameSync(source, destination);
  }
  renameSync(logFile, `${logFile}.1`);
}

export function createLogger(logDirectory: string): Logger {
  const logFile = path.join(logDirectory, 'pax-localia.log');
  rotate(logFile);
  return pino(
    {
      level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'headers.authorization',
          '*.token',
          '*.apiKey',
          '*.password',
          '*.prompt',
          '*.response',
          '*.messages',
          '*.actions',
        ],
        censor: '[REDACTED]',
      },
      base: {
        application: 'Pax Localia',
        version: process.env.npm_package_version ?? '0.1.0',
      },
    },
    pino.destination({ dest: logFile, sync: false, mkdir: true }),
  );
}
