import { createHash } from 'node:crypto';
import { ScenarioSchema, canonicalStringify, type Scenario } from '@pax-localia/domain';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';

const MAX_FILES = 200;
const MAX_COMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;

export const PackageManifestSchema = z.object({
  packageType: z.enum(['scenario', 'save']),
  schemaVersion: z.literal(1),
  title: z.string().min(1).max(200),
  id: z.string().min(1).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  author: z.string().min(1).max(200),
  license: z.string().min(1).max(120),
  createdAt: z.string().datetime(),
  modifiedAt: z.string().datetime(),
  requiredAppVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  checksums: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
});

export type PackageManifest = z.infer<typeof PackageManifestSchema>;

export interface PackagePreview {
  manifest: PackageManifest;
  files: { path: string; sizeBytes: number; checksum: string }[];
  warnings: string[];
  licenses: string[];
}

export interface ImportedScenarioPackage {
  preview: PackagePreview;
  scenario: Scenario;
}

const PortableSaveSchema = z.object({
  schemaVersion: z.literal(1),
  game: z.record(z.string(), z.unknown()),
  branches: z.array(z.record(z.string(), z.unknown())),
  turns: z.array(z.record(z.string(), z.unknown())),
  snapshots: z.array(z.record(z.string(), z.unknown())),
  actions: z.array(z.record(z.string(), z.unknown())),
  events: z.array(z.record(z.string(), z.unknown())),
  conversations: z.array(z.record(z.string(), z.unknown())),
  messages: z.array(z.record(z.string(), z.unknown())),
  memorySummaries: z.array(z.record(z.string(), z.unknown())),
});

export type PortableSave = z.infer<typeof PortableSaveSchema>;

function checksum(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function safePath(filename: string): boolean {
  if (!filename || filename.includes('\0') || filename.includes('\\')) return false;
  if (filename.startsWith('/') || /^[a-z]:/i.test(filename)) return false;
  const parts = filename.split('/');
  return !parts.some((part) => part === '..' || part === '.');
}

interface CentralEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

function readUInt16(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8);
}

function readUInt32(data: Uint8Array, offset: number): number {
  return (
    (data[offset]! |
      (data[offset + 1]! << 8) |
      (data[offset + 2]! << 16) |
      (data[offset + 3]! << 24)) >>>
    0
  );
}

function inspectCentralDirectory(data: Uint8Array): CentralEntry[] {
  if (data.byteLength > MAX_COMPRESSED_BYTES) {
    throw new Error('Archive exceeds the 50 MiB compressed package limit.');
  }
  let endOffset = -1;
  const lowerBound = Math.max(0, data.length - 65_557);
  for (let offset = data.length - 22; offset >= lowerBound; offset -= 1) {
    if (readUInt32(data, offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('Archive has no valid ZIP end record.');
  const disk = readUInt16(data, endOffset + 4);
  const centralDisk = readUInt16(data, endOffset + 6);
  const entriesCount = readUInt16(data, endOffset + 10);
  const centralSize = readUInt32(data, endOffset + 12);
  const centralOffset = readUInt32(data, endOffset + 16);
  if (disk !== 0 || centralDisk !== 0)
    throw new Error('Multi-disk ZIP archives are not supported.');
  if (entriesCount > MAX_FILES) throw new Error(`Archive exceeds the ${MAX_FILES}-file limit.`);
  if (centralOffset + centralSize > data.length) {
    throw new Error('ZIP central directory points outside the archive.');
  }

  const decoder = new TextDecoder();
  const entries: CentralEntry[] = [];
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entriesCount; index += 1) {
    if (readUInt32(data, offset) !== 0x02014b50) {
      throw new Error('Invalid ZIP central-directory entry.');
    }
    const versionMadeBy = readUInt16(data, offset + 4);
    const compressedSize = readUInt32(data, offset + 20);
    const uncompressedSize = readUInt32(data, offset + 24);
    const filenameLength = readUInt16(data, offset + 28);
    const extraLength = readUInt16(data, offset + 30);
    const commentLength = readUInt16(data, offset + 32);
    const externalAttributes = readUInt32(data, offset + 38);
    const nameStart = offset + 46;
    const nameEnd = nameStart + filenameLength;
    if (nameEnd > data.length) throw new Error('Truncated ZIP filename.');
    const name = decoder.decode(data.slice(nameStart, nameEnd));
    if (!safePath(name)) throw new Error(`Unsafe archive path rejected: ${name}`);
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const madeByUnix = versionMadeBy >>> 8 === 3;
    if (madeByUnix && (unixMode & 0xf000) === 0xa000) {
      throw new Error(`Symbolic links are not allowed in packages: ${name}`);
    }
    if (uncompressedSize > MAX_FILE_BYTES) {
      throw new Error(`Archive member exceeds the 25 MiB limit: ${name}`);
    }
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO) {
      throw new Error(`Suspicious compression ratio rejected: ${name}`);
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('Archive exceeds the 200 MiB expanded-size limit.');
    }
    entries.push({ name, compressedSize, uncompressedSize });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function parseJsonFile(files: Record<string, Uint8Array>, name: string): unknown {
  const data = files[name];
  if (!data) throw new Error(`Package is missing ${name}.`);
  try {
    return JSON.parse(strFromU8(data));
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
}

function unpack(data: Uint8Array): {
  entries: CentralEntry[];
  files: Record<string, Uint8Array>;
  manifest: PackageManifest;
} {
  const entries = inspectCentralDirectory(data);
  const files = unzipSync(data);
  const manifest = PackageManifestSchema.parse(parseJsonFile(files, 'manifest.json'));
  for (const [name, expected] of Object.entries(manifest.checksums)) {
    const file = files[name];
    if (!file) throw new Error(`Manifest references missing file: ${name}`);
    if (checksum(file) !== expected) throw new Error(`Checksum mismatch for ${name}.`);
  }
  for (const name of Object.keys(files)) {
    if (name === 'manifest.json' || name.endsWith('/')) continue;
    if (!manifest.checksums[name]) {
      throw new Error(`Unmanifested file rejected: ${name}`);
    }
    if (name.toLocaleLowerCase().endsWith('.svg')) {
      throw new Error('SVG assets are rejected because they can contain active content.');
    }
  }
  return { entries, files, manifest };
}

function createArchive(
  manifestInput: Omit<PackageManifest, 'checksums'>,
  sourceFiles: Record<string, Uint8Array>,
): Uint8Array {
  const orderedFiles = Object.fromEntries(
    Object.entries(sourceFiles).sort(([left], [right]) => left.localeCompare(right)),
  );
  const checksums = Object.fromEntries(
    Object.entries(orderedFiles).map(([name, contents]) => [name, checksum(contents)]),
  );
  const manifest = PackageManifestSchema.parse({ ...manifestInput, checksums });
  const files = {
    'manifest.json': strToU8(`${canonicalStringify(manifest)}\n`),
    ...orderedFiles,
  };
  return zipSync(files, {
    level: 6,
    mtime: new Date('1980-01-01T00:00:00.000Z'),
  });
}

function previewFor(
  entries: CentralEntry[],
  files: Record<string, Uint8Array>,
  manifest: PackageManifest,
): PackagePreview {
  const licenseFiles = Object.keys(files).filter((name) => name.startsWith('LICENSES/'));
  return {
    manifest,
    files: entries
      .filter((entry) => !entry.name.endsWith('/'))
      .map((entry) => ({
        path: entry.name,
        sizeBytes: entry.uncompressedSize,
        checksum:
          entry.name === 'manifest.json'
            ? checksum(files[entry.name] ?? new Uint8Array())
            : (manifest.checksums[entry.name] ?? ''),
      })),
    warnings: licenseFiles.length === 0 ? ['Package contains no LICENSES/ notices.'] : [],
    licenses: licenseFiles.map((name) => strFromU8(files[name] ?? new Uint8Array())),
  };
}

export function exportScenarioPackage(scenarioInput: Scenario, appVersion: string): Uint8Array {
  const scenario = ScenarioSchema.parse(scenarioInput);
  const timestamp = new Date().toISOString();
  const licenseText = `Scenario: ${scenario.title}\nLicense: ${scenario.license}\nAuthor: ${scenario.author}\n`;
  return createArchive(
    {
      packageType: 'scenario',
      schemaVersion: 1,
      title: scenario.title,
      id: scenario.id,
      version: scenario.version,
      author: scenario.author,
      license: scenario.license,
      createdAt: timestamp,
      modifiedAt: timestamp,
      requiredAppVersion: appVersion,
    },
    {
      'scenario.json': strToU8(`${canonicalStringify(scenario)}\n`),
      'LICENSES/scenario.txt': strToU8(licenseText),
    },
  );
}

export function importScenarioPackage(data: Uint8Array): ImportedScenarioPackage {
  const { entries, files, manifest } = unpack(data);
  if (manifest.packageType !== 'scenario') throw new Error('Package is not a scenario package.');
  const scenario = ScenarioSchema.parse(parseJsonFile(files, 'scenario.json'));
  if (scenario.id !== manifest.id || scenario.version !== manifest.version) {
    throw new Error('Scenario identity does not match its manifest.');
  }
  return {
    preview: previewFor(entries, files, manifest),
    scenario,
  };
}

export function exportSavePackage(
  saveInput: PortableSave,
  metadata: {
    id: string;
    title: string;
    author: string;
    appVersion: string;
  },
): Uint8Array {
  const save = PortableSaveSchema.parse(saveInput);
  const timestamp = new Date().toISOString();
  return createArchive(
    {
      packageType: 'save',
      schemaVersion: 1,
      title: metadata.title,
      id: metadata.id,
      version: '1.0.0',
      author: metadata.author,
      license: 'Private user data',
      createdAt: timestamp,
      modifiedAt: timestamp,
      requiredAppVersion: metadata.appVersion,
    },
    {
      'save.json': strToU8(`${canonicalStringify(save)}\n`),
      'LICENSES/application.txt': strToU8(
        'Pax Localia application code is distributed under GPL-3.0-or-later.\n',
      ),
    },
  );
}

export function importSavePackage(data: Uint8Array): {
  preview: PackagePreview;
  save: PortableSave;
} {
  const { entries, files, manifest } = unpack(data);
  if (manifest.packageType !== 'save') throw new Error('Package is not a save package.');
  return {
    preview: previewFor(entries, files, manifest),
    save: PortableSaveSchema.parse(parseJsonFile(files, 'save.json')),
  };
}
