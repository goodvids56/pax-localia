import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const assetsDirectory = path.join(root, 'assets');

function collect(directory: string): string[] {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const fullPath = path.join(directory, name);
      if (statSync(fullPath).isDirectory()) return collect(fullPath);
      return [path.relative(assetsDirectory, fullPath).replaceAll(path.sep, '/')];
    });
}

const files = collect(assetsDirectory).filter((filename) => filename !== 'manifest.json');
const manifest = {
  schemaVersion: 1,
  generatedBy: 'scripts/generate-asset-manifest.ts',
  files: Object.fromEntries(
    files.map((filename) => {
      const data = readFileSync(path.join(assetsDirectory, filename));
      return [
        filename,
        {
          sizeBytes: data.byteLength,
          sha256: createHash('sha256').update(data).digest('hex'),
        },
      ];
    }),
  ),
};

writeFileSync(
  path.join(assetsDirectory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`Recorded ${files.length} bundled assets.`);
