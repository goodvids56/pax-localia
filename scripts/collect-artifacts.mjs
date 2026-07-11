import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const argumentsMap = new Map(
  process.argv
    .slice(2)
    .map((entry) => entry.split('=', 2))
    .filter((entry) => entry.length === 2),
);
const osName = argumentsMap.get('--os') ?? process.platform;
const architecture = argumentsMap.get('--arch') ?? process.arch;
const commit = (argumentsMap.get('--sha') ?? process.env.GITHUB_SHA ?? 'local').slice(0, 8);
const root = process.cwd();
const packageMetadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = packageMetadata.version;
if (typeof version !== 'string') throw new Error('package.json has no version.');

const allowedExtensions = new Set(
  osName === 'windows' || osName === 'win32'
    ? ['.exe', '.msi', '.zip']
    : osName === 'macos' || osName === 'darwin'
      ? ['.dmg', '.zip']
      : ['.AppImage', '.deb', '.rpm', '.zip'],
);

function collect(directory) {
  return readdirSync(directory).flatMap((name) => {
    const filename = path.join(directory, name);
    return statSync(filename).isDirectory() ? collect(filename) : [filename];
  });
}

const makeDirectory = path.join(root, 'out', 'make');
if (!statSync(makeDirectory, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error('Forge make output directory does not exist.');
}
const distributions = collect(makeDirectory)
  .filter((filename) =>
    [...allowedExtensions].some((extension) =>
      filename.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase()),
    ),
  )
  .sort();
if (distributions.length === 0) {
  throw new Error(`No expected ${osName} distributable was produced under out/make.`);
}

const prefix = `pax-localia-${version}-${osName}-${architecture}-${commit}-unsigned`;
const outputDirectory = path.join(root, 'artifacts', prefix);
rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const copied = distributions.map((source, index) => {
  const extension =
    [...allowedExtensions].find((candidate) =>
      source.toLocaleLowerCase().endsWith(candidate.toLocaleLowerCase()),
    ) ?? path.extname(source);
  const suffix =
    distributions.filter((candidate) =>
      candidate.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase()),
    ).length > 1
      ? `-${index + 1}`
      : '';
  const destination = path.join(outputDirectory, `${prefix}${suffix}${extension}`);
  copyFileSync(source, destination);
  return destination;
});

for (const notice of ['THIRD_PARTY_NOTICES.txt', 'DATASETS.md']) {
  const source = path.join(root, 'assets', 'licenses', notice);
  const destination = path.join(outputDirectory, notice);
  copyFileSync(source, destination);
  copied.push(destination);
}

const checksums = copied
  .map((filename) => {
    const hash = createHash('sha256').update(readFileSync(filename)).digest('hex');
    return `${hash}  ${path.basename(filename)}`;
  })
  .sort()
  .join('\n');
writeFileSync(path.join(outputDirectory, 'SHA256SUMS.txt'), `${checksums}\n`);

console.log(
  JSON.stringify(
    {
      artifactDirectory: outputDirectory,
      distributables: distributions.map((filename) => path.relative(root, filename)),
      files: readdirSync(outputDirectory).sort(),
    },
    null,
    2,
  ),
);
