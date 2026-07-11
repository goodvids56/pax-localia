import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopRequire = createRequire(path.join(root, 'apps', 'desktop', 'package.json'));
const rootRequire = createRequire(path.join(root, 'package.json'));
const electronExecutable = desktopRequire('electron');
const vitestDirectory = path.dirname(rootRequire.resolve('vitest/package.json'));
const vitestExecutable = path.join(vitestDirectory, 'vitest.mjs');
const args = [
  vitestExecutable,
  'run',
  '--config',
  path.join(root, 'vitest.integration.config.ts'),
  ...process.argv.slice(2),
];

const result = spawnSync(electronExecutable, args, {
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
