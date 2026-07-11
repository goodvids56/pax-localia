# Contributing to Pax Localia

Pax Localia is an offline-first GPL-3.0-or-later project. Contributions must
preserve local-only gameplay, deterministic state authority, Electron process
boundaries, and data licensing.

Do not contribute copied Pax Historia code, private prompts, presets, branding,
maps, text, icons, screenshots, or proprietary assets.

## Structure

```text
apps/desktop/             Electron main, preload, React renderer, Forge/Vite
packages/domain/          IDs, Zod schemas, IPC contracts, dates, canonical JSON
packages/simulation/      Pure effect rules, deterministic turns, memory
packages/ai/              Local endpoint policy and provider adapters
packages/database/        SQLite migrations and repositories
packages/map-data/        Stable bundled atomic geometry
packages/scenario-sdk/    Secure portable package bytes
assets/                   Runtime scenarios, maps, checksums, notices
tests/unit/               Pure contracts, providers, security, archives
tests/integration/        Electron-ABI SQLite flows
tests/e2e/                Electron/Playwright user smoke flows
docs/                     Architecture, formats, privacy, operations
```

Domain and simulation packages may not import Electron or React. Renderer code
may not import Node APIs, SQLite, provider transports, or local file APIs.

## Setup and quality gates

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm validate
pnpm package
xvfb-run -a pnpm test:e2e       # headless Linux
xvfb-run -a pnpm smoke:packaged # headless Linux
```

Use `pnpm make` on each native target OS for release artifacts.

Do not silence strict errors with broad disables or `any`. A narrow,
documented test-fixture rule can be appropriate where a framework interface
requires synthetic asynchronous functions.

## Adding a world effect

1. Add a bounded discriminated-union member to `WorldEffectSchema`.
2. Implement it in `applySingleEffect`.
3. Validate IDs, activity, feature flags, bounds, and geographic/diplomatic
   basis before mutation.
4. Return public deltas/factors. Never expose model chain-of-thought.
5. Add acceptance and rejection tests.
6. Update turn/memory mapping and `docs/ai-contracts.md`.

Effects apply to a cloned state. Do not accept arbitrary JSON Patch, SQL, object
paths, callbacks, or model-authored code.

## Adding a provider

Implement `LocalAIProvider` with:

- an endpoint policy that cannot bypass the global LAN opt-in;
- typed error mapping and actionable local help;
- cancellation and timeout;
- complete-body structured validation;
- no prompt/raw-response logging;
- model/capability claims based on reported metadata or a probe;
- deterministic/mock transport fixtures.

Do not add public API presets, model downloads, MCP, tools, shell execution, or
server-side conversation state as the save authority.

## Adding or editing scenarios

Use the editor for local scenarios or update `scripts/generate-seeds.ts` for
bundled content. Every dataset and factual source needs an offline notice and a
compatible license.

After generated content changes:

```bash
pnpm exec tsx scripts/generate-seeds.ts
pnpm format
pnpm exec tsx scripts/generate-asset-manifest.ts
pnpm validate
```

Stable atomic region IDs are save compatibility. Do not silently rename them.

## Database migrations

- Append a migration; never edit a released migration.
- Keep all turn state mutation transactional.
- Add a fixture for the prior schema.
- Verify backup, migration, restart, integrity, and import/export.
- Do not put gameplay persistence in renderer localStorage.

## IPC and renderer features

Every new privileged action needs:

1. a named channel in `IpcChannels`;
2. a request Zod schema;
3. a typed preload method;
4. a main handler with request and response validation;
5. a focused security/behavior test.

Never expose generic `send`, `invoke`, event forwarding, arbitrary paths, or
Node objects.

## Pull requests

Keep commits logically scoped. In the description include:

- behavior and architecture changed;
- privacy/network implications;
- tests actually run;
- data/license changes;
- known limitations.

Release signing, publishing, PR labels, and merge state are maintainer actions.
