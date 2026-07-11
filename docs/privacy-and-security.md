# Privacy and security

## Privacy statement

Pax Localia collects no telemetry. It creates no account, cloud identity,
subscription record, advertising profile, crash upload, remote backup, or
automatic update request.

Games, settings, scenarios, chats, actions, events, summaries, model metadata,
and logs remain in the Electron user-data directory shown in **Settings →
Storage and privacy**.

The only ordinary network recipient is the exact configured local inference
origin. Loopback is the default. Private-LAN origins require a persistent
explicit opt-in and display the host receiving prompts. Public hosts remain
blocked.

## Data at rest

- SQLite stores settings and gameplay under `pax-localia.sqlite`.
- WAL and `-shm` files can exist while the database is open.
- Optional LM Studio/generic tokens use Electron `safeStorage`. The encrypted
  bytes are in `credentials.enc.json`, never SQLite, renderer state,
  localStorage, exports, screenshots, or logs.
- If OS encryption is unavailable, a newly entered token lives in main-process
  memory for that session only.
- Renderer localStorage contains collapsible-panel/layout preferences only.
- Structured logs rotate at 5 MiB with four retained files and redact
  authorization, token, password, prompt, response, message, and action fields.

“Export all data” copies the database and non-secret settings, excluding
credentials and logs. Portable saves include one game and relevant scenario
identity, not global settings.

## Electron hardening

Every game window uses:

```text
contextIsolation = true
nodeIntegration = false
sandbox = true
webSecurity = true
allowRunningInsecureContent = false
devTools = false in packaged builds
```

The preload uses `contextBridge` and named methods grouped by domain. It does
not expose raw `ipcRenderer`, `send`, `invoke`, filesystem paths, Node globals,
environment variables, or shell/process commands.

Every IPC input and output is validated with a shared Zod schema in the main
process. Invalid requests are rejected without logging their payload.

The main process:

- denies permission requests and permission checks;
- denies new windows and webviews;
- blocks unexpected navigation;
- allows development-origin navigation only in Forge development mode;
- applies CSP, `nosniff`, and no-referrer headers;
- never opens arbitrary external links from in-world content.

Release fuses disable Run-as-Node, Node option environment variables, CLI
inspection, and loading outside the integrity-checked ASAR.

## Content Security Policy

Packaged renderer policy is:

```text
default-src 'self'
script-src 'self'
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob:
font-src 'self'
connect-src 'none'
worker-src 'self' blob:
object-src 'none'
frame-src 'none'
base-uri 'none'
form-action 'none'
```

Inline style is required for actor colors and map marker positions. Inline
scripts, eval, remote frames, remote fonts, and remote media are not allowed.
Provider requests run in main-process Node after endpoint validation, so the
renderer does not need `connect-src` access in production.

## Network policy

`packages/ai/src/network.ts` classifies:

- `localhost`, `127.0.0.0/8`, and `::1` as loopback;
- RFC1918 IPv4, link-local IPv4, unique-local/link-local IPv6, and `.local`
  names as LAN only when enabled;
- every other HTTP(S)/WebSocket host as blocked.

Provider URLs cannot contain embedded credentials, queries, or fragments.
Normalization removes only a trailing provider API segment to avoid doubled
`/v1` or `/api/v1`.

Electron's session guard independently blocks remote script, image, font,
media, worker, WebSocket, and navigation requests. Block logs contain a
hostname and resource type only—never query strings or credentials.

Main-process fetch adapters call the same endpoint validator. IPC cannot enable
LAN per request unless the persisted global LAN option is already accepted.

## Threat model

### Compromised or malicious scenario

A scenario can contain adversarial text and IDs but cannot execute code. Zod
limits field types/counts/lengths and editor validation checks references.
Scenario directives are prompt data, not system policy. Packages reject active
SVG and unmanifested files.

### Prompt injection

Player/community text is explicitly delimited as untrusted in-world data.
Models receive no tools. Output can only become state through a bounded Zod
union and deterministic rules; unknown IDs and impossible transfers are
rejected and audited.

### Malicious archive

The ZIP central directory is inspected before decompression for traversal,
links, count/size/ratio limits, malformed offsets, and multi-disk archives.
Checksums and identity are verified before database writes.

### Compromised renderer

The renderer has no Node/SQLite/filesystem access. Its only privileged methods
are the frozen preload surface. Main validates IPC and endpoint policy.
Permissions, windows, navigation, and remote resources remain blocked.

### Local provider

A configured model server receives selected prompt context and can return
malicious output. It cannot access Pax Localia tools or saved state directly.
Raw output is not trusted, not logged by default, and not partially applied.
A LAN server is a separate trust boundary made visible in settings.

### Local machine compromise

Pax Localia does not claim to defend data from an attacker who controls the OS
account, process memory, or Electron installation. OS disk encryption and
account security remain the user's responsibility.

## Security verification

Automated checks cover:

- BrowserWindow preferences, CSP, navigation/permission/window policy, and
  preload surface;
- remote URL and alternate-port blocking;
- LAN opt-in;
- archive traversal, ratio, checksum, unmanifested member, and SVG rejection;
- invalid model output and repair;
- transactional failed-turn rollback;
- sanitized diagnostics;
- packaged native module inclusion and renderer/SQLite readiness.

Before release, run the checklist in `docs/release-checklist.md`.
