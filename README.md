# Pax Localia

Pax Localia is an original, offline-first desktop alternate-history and
geopolitical sandbox. Choose a bundled or locally created scenario, control an
actor, queue free-text actions, negotiate, consult an advisor, and advance a
branching timeline. A deterministic rules engine owns every world mutation;
optional local models propose structured outcomes and prose.

The application does not contain or reuse Pax Historia source code, prompts,
presets, branding, maps, icons, or proprietary assets.

## Alpha capabilities

- Secure Electron shell with renderer sandboxing, context isolation, a
  restrictive CSP, typed allowlisted IPC, navigation blocking, and no renderer
  Node access.
- Snapshot-first SQLite persistence with WAL, foreign keys, transactional turns,
  integrity diagnostics, autosaved drafts, immutable turn snapshots, rewind,
  branch comparison, and portable saves.
- Three bundled local scenarios: an original three-state border crisis, a
  sourced 1914 July Crisis micro-scenario, and an original science-fiction
  setting with non-country actors.
- Interactive MapLibre political map using only bundled GeoJSON. An accessible
  SVG political map is used when WebGL is unavailable.
- Multiple editable/reorderable action drafts, seeded deterministic resolution,
  bounded statistics, territorial invariants, events, explainable factors, and
  atomic-region ownership/control changes.
- One-to-one and group diplomacy, structured commitments with accept/reject/
  defer controls, and a read-only advisor.
- First-class LM Studio discovery, native model metadata and explicit lifecycle
  controls, strict JSON-schema output, constrained repair, streaming text,
  cancellation, context budgeting, typed diagnostics, and secure token storage.
- Ollama, generic local OpenAI-compatible, and model-free deterministic
  providers.
- Form-based scenario metadata, actor, feature, and atomic-region editing plus a
  schema-checked advanced JSON editor, validation, duplication, export, and test
  launch.
- Strict `.chronicle` and `.localia-save` archives with checksums, path and size
  limits, compression-ratio checks, SVG rejection, and import validation.

## Offline promise

The packaged app requires no account, login, token service, subscription, CDN,
remote font, tile server, analytics endpoint, cloud database, or update check.
All ordinary assets are bundled. Runtime HTTP/WebSocket access is blocked except
for the exact configured loopback inference origin, or a private-LAN origin
after a persistent explicit opt-in.

LM Studio and Ollama are separate local applications. Pax Localia never starts
them, downloads a model, or sends prompts to a public API. Deterministic mode is
always available without either application.

## Quick start

Prerequisites:

- Node.js `22.14.0` (pinned in `.node-version`).
- pnpm `10.33.3` through Corepack.
- A Python/C++ native build toolchain if a prebuilt `better-sqlite3` binary is
  unavailable.
- Linux packaging: `dpkg`, `fakeroot`, RPM tooling, and Xvfb for headless UI
  checks. Platform packaging is intended to run on its native OS.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The first-run screen can immediately select deterministic mode. All normal
configuration is stored locally; no `.env` file is required.

## Local model setup

### LM Studio (recommended)

1. Install LM Studio and download a chat/instruct model inside LM Studio.
2. Open **Developer → Local Server**, or run:

   ```bash
   lms server start --port 1234
   ```

3. In Pax Localia choose **LM Studio** and keep the default
   `http://127.0.0.1:1234`, unless the local server uses another port.
4. Refresh models. Native `GET /api/v1/models` metadata is preferred; older
   servers fall back to `GET /v1/models`.
5. Select a chat-capable model. Downloaded but unloaded models can use LM
   Studio's JIT loading, or be explicitly loaded from diagnostics. Optional
   load fields include context length and Flash Attention; blank values preserve
   LM Studio defaults.
6. Run **Test for Pax Localia**. It performs a tiny strict JSON-schema request
   and a short streaming request, then reports measured readiness, context,
   latency, and provider-reported throughput.

If LM Studio requires a local API token, enter it on the setup screen. Electron
`safeStorage` encrypts it using the operating-system credential facility. When
OS encryption is unavailable, the token is retained only in memory for that
session.

Pax Localia never automatically unloads a model. Explicit unload targets the
reported LM Studio instance ID.

### Ollama

Start Ollama normally, choose `http://127.0.0.1:11434`, refresh `/api/tags`,
select an installed model, and run the same local compatibility probe. No model
is pulled by Pax Localia.

### Generic local compatible server

Choose **Local compatible server**, enter a loopback base URL, select a model
reported by `/v1/models`, and run the probe. An optional local token is stored
the same way as an LM Studio token.

Private-LAN endpoints are blocked until **Allow LAN providers** is explicitly
enabled. The UI keeps the receiving hostname visible. Public hosts remain
blocked.

### Deterministic mode

Choose **Deterministic mode** on first run or in settings. It uses a stored seed
and rule factors for complete model-free turns, grounded diplomacy responses,
advisor summaries, and factual memory extraction. It makes no network request.

## Commands

```bash
pnpm dev                 # Forge + Vite development app
pnpm format:check        # formatting gate
pnpm lint                # strict ESLint
pnpm typecheck           # strict TypeScript
pnpm test                # unit/security tests with coverage
pnpm test:integration    # SQLite tests under the Electron ABI
pnpm test:lmstudio      # optional live LM Studio discovery/probe/cancel test
pnpm test:ollama        # optional live Ollama discovery/probe/cancel test
pnpm validate            # scenarios, maps, checksums, notices
pnpm test:e2e            # package, then Electron/Playwright smoke flows
pnpm build               # unpacked native package for the host OS
pnpm package             # alias of the unpacked host package
pnpm make                # native installers/archives for the host OS
pnpm smoke:packaged      # packaged startup + SQLite/renderer readiness
```

On headless Linux:

```bash
xvfb-run -a pnpm test:e2e
xvfb-run -a pnpm smoke:packaged
```

Forge rebuilds `better-sqlite3` for the exact Electron ABI. The package allowlist
copies only the external native module and its two runtime helpers into the
ASAR; all TypeScript workspaces and renderer libraries are Vite-bundled.

## Local data locations

Default Electron user-data paths:

- Windows: `%APPDATA%\Pax Localia`
- macOS: `~/Library/Application Support/Pax Localia`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/Pax Localia`

The directory contains:

- `pax-localia.sqlite`, `-wal`, and `-shm`: settings, scenarios, games,
  snapshots, events, actions, conversations, and model-request metadata.
- `credentials.enc.json`: optional OS-encrypted local-provider tokens.
- `logs/pax-localia.log*`: rotated structured logs with prompt/action/token
  fields redacted.

Use **Settings → Storage and privacy** to display the exact paths, run
`PRAGMA integrity_check`, open logs, export data without credentials, or delete
all user-created local data.

## Packaging status

Electron Forge was chosen because it integrates native dependency rebuilding,
host-native makers, Vite, ASAR native unpacking, and Electron fuse hardening in
one maintained configuration.

- Windows x64: unsigned Squirrel installer and ZIP.
- Linux x64: unsigned DEB and RPM.
- macOS runner architecture: unsigned DMG and ZIP.

Ordinary CI artifacts are intentionally unsigned. Windows signing and Apple
notarization are not configured and are never claimed. See
[`docs/release-checklist.md`](docs/release-checklist.md).

The workflow at [`.github/workflows/build.yml`](.github/workflows/build.yml)
runs pull requests, pushes to `main`, and manual dispatches. Its Ubuntu quality
gate precedes a fail-fast-disabled Windows/Linux/macOS packaging matrix.
Artifacts are named with version, OS, architecture, and short commit SHA and
retained for 21 days.

## Documentation

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/ai-contracts.md`](docs/ai-contracts.md)
- [`docs/scenario-format.md`](docs/scenario-format.md)
- [`docs/privacy-and-security.md`](docs/privacy-and-security.md)
- [`docs/troubleshooting.md`](docs/troubleshooting.md)
- [`CONTRIBUTING.md`](CONTRIBUTING.md)

## Known alpha limitations

- Bundled maps are intentionally small schematic atomic-region datasets, not a
  full administrative world atlas.
- Arbitrary polygon drawing, headless/LAN hosting, multiplayer, cloud sync,
  marketplaces, Steam integration, and automatic updates are not implemented.
- Branch creation/comparison is functional; branch rename/delete and richer
  visual trees remain follow-up work.
- The editor's common metadata, actor, rules, ownership, validation, and test
  launch paths are form-based. Less common treaty/conflict/city fields currently
  use the validated advanced JSON view.
- Long-game deterministic facts are extractable, but automatic era-summary
  regeneration UI is not yet complete.
- Release artifacts are unsigned unless a downstream maintainer adds signing on
  trusted infrastructure.

## License

Application source is GPL-3.0-or-later. Scenario and dataset notices are bundled
under `assets/licenses/` and shown in the application.
