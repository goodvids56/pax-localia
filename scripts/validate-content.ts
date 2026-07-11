import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ScenarioSchema, canonicalStringify } from '@pax-localia/domain';
import { getMapDataset, listMapDatasets } from '@pax-localia/map-data';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets');
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  generatedBy: z.literal('scripts/generate-asset-manifest.ts'),
  files: z.record(
    z.string(),
    z.object({
      sizeBytes: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});

function fail(message: string): never {
  throw new Error(`Content validation failed: ${message}`);
}

function collect(directory: string): string[] {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const fullPath = path.join(directory, name);
      return statSync(fullPath).isDirectory()
        ? collect(fullPath)
        : [path.relative(assets, fullPath).replaceAll(path.sep, '/')];
    });
}

const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')),
);
const files = collect(assets).filter((filename) => filename !== 'manifest.json');
if (files.length !== Object.keys(manifest.files).length) {
  fail('asset manifest file count does not match the bundled asset tree');
}
for (const filename of files) {
  const entry = manifest.files[filename];
  if (!entry) fail(`asset is missing from manifest: ${filename}`);
  const data = readFileSync(path.join(assets, filename));
  const checksum = createHash('sha256').update(data).digest('hex');
  if (entry.sizeBytes !== data.byteLength || entry.sha256 !== checksum) {
    fail(`asset checksum or size is stale: ${filename}`);
  }
}

const scenarioDirectory = path.join(assets, 'scenarios');
const scenarios = readdirSync(scenarioDirectory)
  .filter((filename) => filename.endsWith('.json'))
  .sort()
  .map((filename) => ({
    filename,
    scenario: ScenarioSchema.parse(
      JSON.parse(readFileSync(path.join(scenarioDirectory, filename), 'utf8')),
    ),
  }));
if (scenarios.length < 3) fail('at least three seed scenarios are required');
if (!scenarios.some(({ scenario }) => scenario.tags.includes('historical'))) {
  fail('a historical seed scenario with attribution is required');
}
if (!scenarios.some(({ scenario }) => scenario.featureFlags.fantasyRules)) {
  fail('a speculative seed scenario demonstrating custom rules is required');
}

const scenarioIds = new Set<string>();
for (const { filename, scenario } of scenarios) {
  if (scenarioIds.has(scenario.id)) fail(`duplicate scenario ID ${scenario.id}`);
  scenarioIds.add(scenario.id);
  if (scenario.attribution.length === 0) fail(`${filename} has no attribution`);
  if (scenario.allowedJumps.length === 0) fail(`${filename} allows no time jumps`);
  const map = getMapDataset(scenario.mapDatasetId);
  const featureIds = new Set(map.features.map((feature) => feature.id));
  for (const region of Object.values(scenario.initialWorld.regions)) {
    if (!featureIds.has(region.featureId)) {
      fail(`${filename}: region ${region.id} references missing map feature`);
    }
    if (region.type === 'land' && !region.ownerId) {
      fail(`${filename}: land region ${region.id} has no legal owner`);
    }
    if (region.ownerId && !scenario.initialWorld.actors[region.ownerId]) {
      fail(`${filename}: region ${region.id} has an orphan owner`);
    }
    for (const neighborId of region.neighborIds) {
      const neighbor = scenario.initialWorld.regions[neighborId];
      if (!neighbor) fail(`${filename}: region ${region.id} has an orphan neighbor`);
      if (!neighbor.neighborIds.includes(region.id)) {
        fail(`${filename}: adjacency ${region.id} ↔ ${neighborId} is not reciprocal`);
      }
    }
  }
  for (const actor of Object.values(scenario.initialWorld.actors)) {
    if (
      actor.isActive &&
      actor.controlledRegionIds.length > 0 &&
      (!actor.capitalCityId || !scenario.initialWorld.cities[actor.capitalCityId])
    ) {
      fail(`${filename}: territorial actor ${actor.id} has no valid capital`);
    }
  }
  for (const city of Object.values(scenario.initialWorld.cities)) {
    if (!scenario.initialWorld.regions[city.regionId]) {
      fail(`${filename}: city ${city.id} has an orphan region`);
    }
  }
}

for (const datasetId of listMapDatasets()) {
  const filename = `${datasetId.replace('map:', '')}.geojson`;
  const disk: unknown = JSON.parse(
    readFileSync(path.join(assets, 'maps', filename), 'utf8'),
  ) as unknown;
  if (canonicalStringify(disk) !== canonicalStringify(getMapDataset(datasetId))) {
    fail(`runtime map differs from committed GeoJSON: ${filename}`);
  }
}

const notices = readFileSync(
  path.join(assets, 'licenses', 'THIRD_PARTY_NOTICES.txt'),
  'utf8',
).toLocaleLowerCase();
for (const required of [
  'electron',
  'react',
  'zustand',
  'zod',
  'better-sqlite3',
  'maplibre',
  'pino',
  'date-fns',
  'fflate',
]) {
  if (!notices.includes(required)) fail(`third-party notices omit ${required}`);
}

const workflowSource = readFileSync(path.join(root, '.github', 'workflows', 'build.yml'), 'utf8');
const workflow = parseYaml(workflowSource) as unknown;
if (!workflow || typeof workflow !== 'object') fail('build workflow YAML is invalid');
if (workflowSource.includes('pull_request_target')) {
  fail('build workflow must not execute untrusted code through pull_request_target');
}
for (const match of workflowSource.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/g)) {
  if (!/^[0-9a-f]{40}$/.test(match[1] ?? '')) {
    fail(`GitHub Action is not pinned to an immutable full SHA: ${match[0]}`);
  }
}
for (const required of [
  'permissions:\n  contents: read',
  'fail-fast: false',
  'windows-latest',
  'ubuntu-24.04',
  'macos-15',
  'pnpm install --frozen-lockfile',
  'electron-forge make',
  'smoke:packaged',
  'if-no-files-found: error',
]) {
  if (!workflowSource.includes(required)) fail(`build workflow omits: ${required}`);
}

console.log(
  `Validated ${scenarios.length} scenarios, ${listMapDatasets().length} map datasets, ${files.length} checksummed assets, runtime notices, and pinned CI workflow syntax.`,
);
