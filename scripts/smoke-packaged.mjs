import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

function executablePath() {
  const root = process.cwd();
  if (process.platform === 'win32') {
    return path.join(root, 'out', 'Pax Localia-win32-x64', 'pax-localia.exe');
  }
  if (process.platform === 'darwin') {
    return path.join(
      root,
      'out',
      `Pax Localia-darwin-${process.arch}`,
      'Pax Localia.app',
      'Contents',
      'MacOS',
      'Pax Localia',
    );
  }
  return path.join(root, 'out', 'Pax Localia-linux-x64', 'pax-localia');
}

const executable = executablePath();
if (!existsSync(executable)) {
  throw new Error(`Packaged executable was not found: ${executable}`);
}

const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'pax-localia-package-smoke-'));
const marker = path.join(temporaryDirectory, 'ready.json');
const child = spawn(executable, process.platform === 'linux' ? ['--no-sandbox'] : [], {
  env: {
    ...process.env,
    PAX_LOCALIA_E2E_DATA_DIR: path.join(temporaryDirectory, 'data'),
    PAX_LOCALIA_SMOKE_FILE: marker,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => {
  output = `${output}${String(chunk)}`.slice(-8_000);
});
child.stderr.on('data', (chunk) => {
  output = `${output}${String(chunk)}`.slice(-8_000);
});
let exited = false;
let exitCode = null;
child.once('exit', (code) => {
  exited = true;
  exitCode = code;
});

try {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (existsSync(marker)) {
      const status = JSON.parse(readFileSync(marker, 'utf8'));
      if (status.rendererLoaded !== true || status.databaseInitialized !== true) {
        throw new Error(`Packaged readiness marker was invalid: ${JSON.stringify(status)}`);
      }
      console.log('Packaged app initialized SQLite and loaded the renderer.');
      process.exitCode = 0;
      break;
    }
    if (exited) {
      throw new Error(`Packaged app exited early (${exitCode}).\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!existsSync(marker)) {
    throw new Error(`Packaged app did not become ready within 20 seconds.\n${output}`);
  }
} finally {
  if (!exited) child.kill();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
