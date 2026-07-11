import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScenarioSchema, canonicalStringify } from '@pax-localia/domain';
import {
  exportSavePackage,
  exportScenarioPackage,
  importSavePackage,
  importScenarioPackage,
  PackageManifestSchema,
} from '@pax-localia/scenario-sdk';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

function scenario() {
  return ScenarioSchema.parse(
    JSON.parse(
      readFileSync(path.join(process.cwd(), 'assets/scenarios/selene-border-crisis.json'), 'utf8'),
    ),
  );
}

function checksum(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

describe('portable scenario packages', () => {
  it('round-trips a scenario with matching canonical state', () => {
    const source = scenario();
    const bytes = exportScenarioPackage(source, '0.1.0');
    const imported = importScenarioPackage(bytes);
    expect(canonicalStringify(imported.scenario)).toBe(canonicalStringify(source));
    expect(imported.preview.manifest.packageType).toBe('scenario');
    expect(imported.preview.licenses).toHaveLength(1);
    expect(imported.preview.warnings).toEqual([]);
  });

  it('exports deterministically apart from manifest timestamps', () => {
    const bytes = exportScenarioPackage(scenario(), '0.1.0');
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      'LICENSES/scenario.txt',
      'manifest.json',
      'scenario.json',
    ]);
    const manifest = PackageManifestSchema.parse(
      JSON.parse(strFromU8(files['manifest.json']!)) as unknown,
    );
    expect(manifest.checksums['scenario.json']).toBe(checksum(files['scenario.json']!));
  });

  it('rejects zip-slip paths before extraction', () => {
    const malicious = zipSync({
      '../outside.json': strToU8('{}'),
      'manifest.json': strToU8('{}'),
    });
    expect(() => importScenarioPackage(malicious)).toThrow(/Unsafe archive path/);
  });

  it('rejects suspicious decompression ratios', () => {
    const bomb = zipSync(
      {
        'manifest.json': strToU8('x'.repeat(2_000_000)),
      },
      { level: 9 },
    );
    expect(() => importScenarioPackage(bomb)).toThrow(/compression ratio/);
  });

  it('rejects checksum tampering and unmanifested files', () => {
    const original = unzipSync(exportScenarioPackage(scenario(), '0.1.0'));
    const tampered = zipSync({
      ...original,
      'scenario.json': strToU8('{"tampered":true}'),
    });
    expect(() => importScenarioPackage(tampered)).toThrow(/Checksum mismatch/);

    const extra = zipSync({
      ...original,
      'assets/unlisted.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    expect(() => importScenarioPackage(extra)).toThrow(/Unmanifested file/);
  });

  it('rejects active SVG content even when checksummed', () => {
    const source = unzipSync(exportScenarioPackage(scenario(), '0.1.0'));
    const svg = strToU8('<svg onload="alert(1)"/>');
    const manifest = JSON.parse(strFromU8(source['manifest.json']!)) as {
      checksums: Record<string, string>;
    };
    manifest.checksums['assets/icon.svg'] = checksum(svg);
    const archive = zipSync({
      ...source,
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'assets/icon.svg': svg,
    });
    expect(() => importScenarioPackage(archive)).toThrow(/SVG assets are rejected/);
  });
});

describe('portable save packages', () => {
  it('round-trips snapshot-first rows without global settings or logs', () => {
    const save = {
      schemaVersion: 1 as const,
      game: { id: 'game:test', title: 'Test timeline' },
      branches: [{ id: 'branch:test', world_json: '{}' }],
      turns: [],
      snapshots: [],
      actions: [],
      events: [],
      conversations: [],
      messages: [],
      memorySummaries: [],
    };
    const bytes = exportSavePackage(save, {
      id: 'game:test',
      title: 'Test timeline',
      author: 'Local player',
      appVersion: '0.1.0',
    });
    const imported = importSavePackage(bytes);
    expect(imported.save).toEqual(save);
    expect(JSON.stringify(imported.save)).not.toContain('authorization');
    expect(imported.preview.manifest.license).toBe('Private user data');
  });
});
