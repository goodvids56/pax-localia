# Release checklist

## Source and content

- [ ] Version matches the intended tag.
- [ ] `pnpm install --frozen-lockfile` succeeds with no peer mismatch.
- [ ] `pnpm format:check`, `lint`, and `typecheck` pass.
- [ ] Unit coverage thresholds pass.
- [ ] Electron-ABI integration tests pass.
- [ ] Scenario/map/checksum/license validation passes.
- [ ] Bundled content is original, public domain, or compatibly licensed.
- [ ] No proprietary Pax Historia asset, text, source, prompt, or preset exists.

## Security and privacy

- [ ] First launch succeeds with external internet unavailable.
- [ ] Remote script/image/font/WebSocket probes are blocked.
- [ ] Only the configured loopback origin receives model requests.
- [ ] LAN requires both persistent global and provider opt-ins.
- [ ] CSP has no remote source or production `unsafe-eval`.
- [ ] BrowserWindow uses isolation, sandbox, no Node integration, and no
      packaged devtools.
- [ ] Preload exports only named typed methods.
- [ ] Permission, navigation, window, and webview blockers are active.
- [ ] Release fuses are applied.
- [ ] Shareable diagnostics contain no prompts, actions, chats, raw responses,
      authorization, token, or username-bearing paths.
- [ ] Archive traversal/size/ratio/checksum/SVG tests pass.

## Persistence

- [ ] New game, deterministic turn, restart, and identical reload pass.
- [ ] Failed and cancelled generation leave the current snapshot unchanged.
- [ ] Rewind creates a new branch and preserves the original future.
- [ ] Scenario and save export/import hashes match.
- [ ] `PRAGMA integrity_check` returns `ok`.
- [ ] Migration from the oldest supported fixture creates a backup and passes.

## Local providers

- [ ] Deterministic mode works without a server.
- [ ] LM Studio not-detected/auth/no-model/unloaded/ready states are actionable.
- [ ] Native and fallback model discovery behave correctly.
- [ ] Explicit LM Studio load/unload uses exact instance IDs.
- [ ] Strict structured output probe passes on at least one documented local
      model and fails safely on the invalid fixture.
- [ ] Stream disconnect, cancellation, timeout, context overflow, and removed
      model are recoverable.
- [ ] Ollama and generic compatible manual smoke scripts pass if installed.
- [ ] No model is automatically downloaded, started, or unloaded.

## Native artifacts

On each native runner:

- [ ] `pnpm make` runs rather than only Vite build.
- [ ] `better-sqlite3` is rebuilt for the exact Electron ABI/architecture.
- [ ] Native binary exists under `app.asar.unpacked`.
- [ ] Test/source/cache/local database files are absent.
- [ ] Expected installer/archive exists; no empty artifact upload.
- [ ] `pnpm smoke:packaged` writes the renderer/SQLite readiness marker.
- [ ] SHA-256 manifest uses `hash  filename` consistently.
- [ ] Artifact name contains version, OS, architecture, and short commit SHA.
- [ ] Third-party notices are attached.

Expected unsigned families:

- Windows x64: Squirrel `.exe`, ZIP.
- Linux x64: `.deb`, `.rpm`.
- macOS runner architecture: `.dmg`, ZIP.

Ordinary PR/default-branch artifacts are unsigned. Do not describe them as
signed or notarized.

## Signing and publication

This repository does not currently include a publishing workflow.

If a maintainer adds one:

- trigger only from trusted version tags or manual trusted dispatch;
- verify tag version against `package.json`;
- use artifacts built from the exact tag commit;
- isolate `contents: write` in the release job;
- expose no signing secret to pull requests/forks;
- sign/notarize only when every required secret is present;
- verify combined checksums;
- create a draft release;
- never publish automatically from a pull request.

Document secret names, never values.

## Current known limitations

- Atomic maps are schematic and small.
- Rich arbitrary polygon editing is not implemented.
- Branch rename/delete and richer branch-tree visuals remain follow-up work.
- Automatic era-summary regeneration UI is incomplete.
- Headless/LAN hosting and multiple human players are not implemented.
- Sound/music, mod directories, Steam integration, and automatic updates are
  not implemented.
- Maintainer signing/notarization is not configured.
