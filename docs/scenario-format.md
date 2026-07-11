# Scenario and save formats

## In-memory schema

`ScenarioSchema` in `packages/domain/src/schemas.ts` is the runtime authority.
The current `schemaVersion` is `1`.

A scenario contains metadata, timeline bounds, a map dataset key, allowed jump
sizes, local-model guidance, AI/safety directives, optional objectives, feature
flags, initial world state, seed events, and attribution.

The initial world contains keyed actors, regions, cities, units, directed
relationships, treaties, conflicts, commitments, scenario variables, the
starting date, and a seeded random state. Game/branch/player IDs are added only
when a local game is created.

IDs use stable namespaced strings such as:

```text
scenario:selene-border-crisis
actor:aster
region:selene-crossing
city:lumen
unit:aster-first
```

Changing an atomic region ID after publishing a scenario is a breaking change
for saves and branches.

## Geometry

`mapDatasetId` resolves to a bundled immutable GeoJSON feature collection.
Regions refer to a stable `featureId`; geometry is never copied into every
snapshot. Runtime border changes transfer legal ownership or military control
of whole atomic regions.

Current editor validation checks:

- known map dataset and feature IDs;
- legal owners for ordinary land;
- owner/controller and neighbor references;
- reciprocal adjacency;
- actor capitals;
- city/region references;
- valid colors and duplicate-color warnings;
- scenario Zod constraints and attributions.

Arbitrary polygon drawing and LLM-generated geometry are intentionally absent.

## `.chronicle` package

A portable scenario is a ZIP with strict UTF-8 paths:

```text
manifest.json
scenario.json
LICENSES/
  scenario.txt
assets/                 # reserved for sanitized future image assets
```

The version-1 manifest is:

```json
{
  "packageType": "scenario",
  "schemaVersion": 1,
  "title": "The Selene Border Crisis",
  "id": "scenario:selene-border-crisis",
  "version": "1.0.0",
  "author": "Pax Localia contributors",
  "license": "CC-BY-SA-4.0",
  "createdAt": "2026-07-11T00:00:00.000Z",
  "modifiedAt": "2026-07-11T00:00:00.000Z",
  "requiredAppVersion": "0.1.0",
  "checksums": {
    "scenario.json": "<sha256>",
    "LICENSES/scenario.txt": "<sha256>"
  }
}
```

Canonical JSON sorts object keys. ZIP member order is deterministic; manifest
timestamps reflect export time.

## `.localia-save` package

Portable saves use the same manifest/checksum envelope with
`packageType: "save"` and a `save.json` snapshot-first payload:

- game row;
- all branches;
- turn audit records;
- immutable snapshots and hashes;
- actions and events;
- conversations and messages;
- memory summaries.

The export excludes global settings, credentials, logs, unrelated games, model
files, and full prompt/response content.

An imported save must reference an installed matching scenario. Every snapshot
is parsed through `WorldStateSchema`, and its canonical SHA-256 is verified
before any transaction. A duplicate game ID is rejected instead of silently
overwriting local history.

## Import security

Before decompression, the central directory is inspected and rejected for:

- more than 200 files;
- more than 50 MiB compressed or 200 MiB expanded;
- a member over 25 MiB;
- a compression ratio over 100:1;
- multi-disk or malformed central directories;
- absolute paths, drive paths, backslashes, `.`/`..`, NULs, or traversal;
- symbolic links.

After decompression:

- every file must be listed in the checksum manifest;
- every listed checksum must match;
- active SVG content is rejected;
- package type/version and scenario identity must match;
- unknown future package schema versions are rejected deliberately.

The main process owns native file dialogs. The renderer receives an operation
result, not an arbitrary filesystem API.

## Scenario ID conflicts

Import preview reports title, author, license files, members, sizes, and
warnings. On an ID collision the user can install a scenario as a copy, replace
an editable local/imported scenario, or cancel. Bundled scenarios are immutable
and must be duplicated.

## Versioning and migrations

Package schema and scenario content version are separate:

- `schemaVersion` changes when the data shape changes.
- `version` is the scenario author's semantic content version.
- `requiredAppVersion` describes the minimum reader.

Version 1 is the only released schema in this alpha. Unknown future fields are
not silently dropped: strict structured objects reject unsupported shapes where
state integrity matters. Add a migration before incrementing the supported
schema list, preserve a fixture for the previous version, and test canonical
round trips before release.

## Adding a scenario

1. Add or generate stable geometry in `packages/map-data` and
   `assets/maps/`.
2. Add source data to `scripts/generate-seeds.ts` or create a local package in
   the editor.
3. Include title, author, license, and factual/data attribution.
4. Run:

   ```bash
   pnpm exec tsx scripts/generate-seeds.ts
   pnpm format
   pnpm exec tsx scripts/generate-asset-manifest.ts
   pnpm validate
   pnpm test
   ```

5. Never import community/proprietary presets without explicit compatible
   licensing.
