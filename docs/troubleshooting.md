# Troubleshooting

## LM Studio is not detected

Pax Localia probes `http://127.0.0.1:1234` by default.

1. Open LM Studio.
2. Open the Developer tab and start the Local Server, or run:

   ```bash
   lms server start --port 1234
   ```

3. Verify the shown LM Studio port.
4. Put the base origin—not `/v1` or `/api/v1`—in Pax Localia and retry.

Pax Localia never runs `lms` or starts LM Studio itself. Deterministic mode
remains fully usable.

## Authentication required

The local server returned 401/403. Enter its local API token on setup and
retest. Tokens are sent as `Authorization: Bearer …`, encrypted with Electron
`safeStorage`, and redacted from logs/reports.

Use **Forget token** to remove it. Do not put a token in the endpoint URL.

## Connected, no models

Download a chat/instruct model in LM Studio. Embedding-only models are
deliberately hidden from simulation/chat selectors. Pax Localia does not offer
an automatic model download.

With Ollama, install/pull a model using Ollama's own CLI or UI, then refresh
`/api/tags`.

## Model is downloaded but unloaded

LM Studio may JIT-load it on the first inference request. If the native API is
available, diagnostics also offers an explicit Load button. Start with
**Automatic / LM Studio defaults**.

If loading fails:

- lower configured context length;
- leave Flash Attention/KV/evaluation batch options automatic;
- choose a smaller model or quantization;
- free GPU/RAM;
- inspect LM Studio's local logs.

Pax Localia never automatically unloads an instance.

## Wrong port or older LM Studio API

An unavailable server and an unsupported native API are different states.
When `/api/v1/models` is absent but `/v1/models` works, ordinary inference stays
available and native metadata/lifecycle badges are disabled.

Use the sanitized report to confirm which path succeeded.

## Structured-output test fails

Simulation requires a complete response matching the strict turn schema.

- update LM Studio/Ollama;
- choose an instruct model with measured JSON-schema support;
- reduce creativity;
- use a smaller output contract/simulation detail;
- verify the selected model still exists and is loaded;
- switch the current turn to deterministic mode.

Pax Localia attempts one constrained repair. A second invalid result is shown as
a recoverable error and leaves drafts/world state unchanged.

## Context overflow

The loaded instance context can be shorter than a model's architectural
maximum. Pax Localia prefers the loaded context value.

- lower simulation detail;
- use a shorter jump;
- load with a larger context if memory permits;
- reduce maximum output tokens only if the proposal still has enough room;
- consolidate older context or use deterministic mode.

## Streaming disconnect or cancellation

A disconnected stream never saves a partial chat response as authoritative
state. Retry after verifying model readiness. Cancelling a time jump before
database application preserves the prior world and drafts.

## Ollama unavailable or model not found

Default endpoint: `http://127.0.0.1:11434`.

Confirm Ollama is running and the selected name still appears in `ollama list`.
Refresh models after renaming/removing one. Pax Localia never pulls a missing
model automatically.

## LAN endpoint is blocked

Enable the global LAN-provider option and the provider's LAN checkbox. Only
private/link-local IP ranges and `.local` hosts are eligible. Public internet
hosts remain blocked even after LAN opt-in.

Confirm that the exact displayed host is one you control; it receives selected
prompt context.

## Native module / `better-sqlite3` error

Use the pinned Node and pnpm versions, then reinstall and rebuild:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec electron-rebuild -f -w better-sqlite3
pnpm package
```

The packaged binary must exist under
`resources/app.asar.unpacked/node_modules/better-sqlite3/`. Run:

```bash
xvfb-run -a pnpm smoke:packaged   # headless Linux
pnpm smoke:packaged               # Windows/macOS or graphical Linux
```

Do not replace SQLite with renderer localStorage.

## Corrupted save or failed integrity check

1. Stop advancing the affected game.
2. Export all data if possible.
3. Run **Settings → Storage → Integrity check**.
4. Keep `pax-localia.sqlite`, `-wal`, and `-shm` together before copying.
5. Restore a known export or migration backup.

Migrations create a timestamped `pre-migration-*.bak` before upgrading an older
database. Imported snapshots must pass canonical hashes.

## Linux GPU, WebGL, or sandbox issues

MapLibre needs WebGL. If context creation fails, Pax Localia automatically uses
the selectable, keyboard-accessible SVG political map. This is expected under
some Xvfb/software-rendering environments.

Some distributions restrict unprivileged Chromium sandboxing. Prefer fixing
the system sandbox/package permissions. `--no-sandbox` is used only by isolated
CI smoke tests and is not recommended for ordinary play.

Ensure Mesa/OpenGL libraries are installed for hardware map rendering.

## Packaging tool errors

Packaging is host-native:

- Squirrel/ZIP on Windows;
- DMG/ZIP on macOS;
- DEB/RPM on Linux.

Install the maker's native system tools. `pnpm package` creates an unpacked app;
`pnpm make` creates installers/archives. Unsigned builds do not require secrets.

## Where diagnostics and logs live

Open **Settings → Storage and privacy** to display the exact data/log paths.
The shareable diagnostics report excludes prompt text, chat, actions, raw
responses, tokens, authorization headers, and username-bearing file paths.
