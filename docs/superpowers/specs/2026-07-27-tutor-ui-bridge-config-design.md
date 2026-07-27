# Tutor UI v2.0 — bridge configuration, health gating, and guaranteed access link

**Date:** 2026-07-27
**Status:** Approved
**Plugin:** `tutor-ui` (marketplace `jolo-plugins`) — target version **2.0.0**

## Problem

The bridge (`template/chat-server.js`, 139 lines) does five jobs in one file and assumes a
happy path: a logged-in `claude` CLI on `PATH`, port 8770 free, and the site served over
HTTP. When any assumption breaks, the tutor fails *after* the user has already typed a
question, with a message that does not say what to fix.

Observed failure modes:

| # | Cause | Current symptom |
|---|-------|-----------------|
| 1 | Site opened via `file://` (double-click `index.html`) | `fetch("/api/ask")` fails; panel looks broken |
| 2 | `claude` not on `PATH` | error on first message only (`chat-server.js:69`) |
| 3 | CLI installed but not logged in | `El CLI devolvió código 1` |
| 4 | Port 8770 in use | `EADDRINUSE` crash, yet `iniciar-tutor.cmd:10` already printed the link |
| 5 | Node missing | generic message after the fact |

Separately, the port is hardcoded in three places (server default, launcher echo,
`SKILL.md`), so any advertised link is a guess rather than a fact. And there is no way to
use the plugin without a subscription-backed CLI login.

## Goals

1. Every successful start prints the **actual** URL the site is reachable at.
2. "Ask AI" is verified working **before** the user asks anything, or the failure is
   reported with an actionable fix.
3. Support two backends — the logged-in `claude` CLI (subscription) and the Anthropic
   Messages API (key + configurable base URL).
4. Ask for that choice **once per machine** and persist it.

## Non-goals

- Migrating already-generated sites. They keep their existing self-contained
  `chat-server.js` and continue to work untouched.
- Providers other than Anthropic. A custom `baseUrl` is expected to speak the Messages
  API (gateway / LiteLLM / proxy); non-Anthropic wire formats are out of scope.
- Multi-user or non-loopback serving. The bridge stays bound to `127.0.0.1`.

## Architecture

### File layout

```
template/
  chat-server.js          HTTP routing + startup sequence only (~120 lines)
  lib/
    config.js             resolve · load · save · wizard
    context.js            gather site context for API mode
    providers/
      cli.js              spawn `claude`
      api.js              POST {baseUrl}/v1/messages
  tutor.config.json       optional per-site override (gitignored)
```

The template stays **zero runtime dependencies**. Tests live in the plugin repo
(`plugins/tutor-ui/test/`), not in `template/`, so generated sites are not polluted.

### Provider interface

Both providers export exactly two functions. `chat-server.js` knows nothing about
`claude` or HTTP APIs.

```js
async function ask({ message, sessionId, model, extraDirs, page })
  // -> { reply: string, sessionId: string }
  // throws Error with .userMessage for display

async function check()
  // -> { ok: boolean, detail: string, model: string }
```

This is the isolation boundary: either provider can be replaced or tested without
touching the server.

## Configuration

### Resolution order

First match wins, per key:

1. Command-line flags: `--port`, `--no-open`
2. Environment: `TUTOR_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `PORT`,
   `TUTOR_NAME`
3. `<site>/tutor.config.json` — per-site override, added to `.gitignore`
4. `~/.tutor-ui/config.json` — the per-machine store
5. Built-in defaults
6. If `provider` is still unresolved → run the wizard, which writes (4)

### Shape

```json
{
  "version": 1,
  "provider": "cli",
  "cli":  { "bin": "C:\\Users\\gcicl\\...\\claude.cmd" },
  "api":  { "baseUrl": "https://api.anthropic.com",
            "keyEnv": "ANTHROPIC_API_KEY",
            "key": null },
  "models": { "opus":   "claude-opus-5",
              "sonnet": "claude-sonnet-5",
              "haiku":  "claude-haiku-4-5-20251001",
              "default": "sonnet" },
  "port": 8770,
  "openBrowser": true
}
```

`config.js` exports `load()`, `needsSetup(cfg)`, `runWizard()`, `save(cfg)`,
`configPath()`. The home path is `path.join(os.homedir(), ".tutor-ui", "config.json")`.

### Key storage

`api.keyEnv` is the default and is preferred: the key is read from the environment and
never written to disk. If the user chooses to paste a key during the wizard, it is
written to `api.key` in `~/.tutor-ui/config.json` with mode `0600`, and the wizard prints
a warning that the key is now readable on disk. `api.key` is never written to a per-site
`tutor.config.json`.

### CLI binary resolution

`cli.js` resolves the binary once and caches the result into `cli.bin`:

1. `cfg.cli.bin` if it still exists on disk
2. `where claude` (Windows) / `which claude` (POSIX)
3. Known install locations: `%LOCALAPPDATA%\Programs\claude\claude.exe`,
   `~/.local/bin/claude`, `~/.claude/local/claude`
4. Fail with install instructions

This removes the dependency on the spawning process having a fresh `PATH`, which is a
known failure mode on this machine for long-lived agent hosts.

### Wizard

Runs when `needsSetup()` is true, or on `--reconfigure`. Uses `node:readline`; the
launcher already opens a console, so this costs nothing.

```
No encontré configuración (~/.tutor-ui/config.json).

¿Cómo hablo con Claude?
  1) CLI `claude` ya logueado  (tu suscripción, sin API key)   [recomendado]
  2) API key de Anthropic
> 1

Buscando `claude`...  ✅ C:\Users\gcicl\...\claude.cmd
Probando...           ✅ responde

Puerto [8770]:
¿Abrir el navegador solo? [S/n]:

✅ Guardado en C:\Users\gcicl\.tutor-ui\config.json
```

Path 2 prompts for `baseUrl` (default `https://api.anthropic.com`), then offers to read
`ANTHROPIC_API_KEY` from the environment or accept a pasted key. Either way it runs
`check()` before saving and reports the result. `check()` failures do not block *saving* —
the config is written regardless, so the user never has to re-answer the questions. The
wizard then hands control to the normal startup sequence, where the same failure is
re-detected at step 3 and exits with the fix. Answers are preserved; only the boot stops.

## Startup sequence

`chat-server.js` on boot:

1. Parse flags: `--port N`, `--no-open`, `--reconfigure`
2. `config.load()`; run the wizard if needed
3. `provider.check()` **fast path** — for `cli`, `claude --version`; for `api`, nothing.
   A failure here is fatal: print the specific fix and exit non-zero.
4. `listen(port, "127.0.0.1")`. On `EADDRINUSE`, retry `port+1 … port+10` and log the
   shift. Exhausting the range is fatal.
5. Fire the **deep probe** in the background — a real request capped at 5 output tokens.
   This is what catches "installed but not logged in" and "invalid API key" without
   delaying startup.
6. Print the banner and open the browser if `openBrowser`.

```
  ✅ Tutor listo · CLI · claude-sonnet-5

     👉  http://localhost:8771

  (Ctrl+C para salir · config: C:\Users\gcicl\.tutor-ui\config.json)
```

The hardcoded port echo is removed from `iniciar-tutor.cmd` and `iniciar-tutor.sh`.

## Health endpoint

```
GET /api/health
  -> { provider, stage, detail, model, port, configPath }
     stage: "probing" | "ok" | "fail"
```

`stage` starts at `probing` and is updated by the deep probe. `detail` carries the
human-readable reason on `fail`.

### Client behaviour (`assets/tutor.js`)

- If `location.protocol === "file:"`, replace the panel body with a card showing the exact
  command to run and the folder path. Do not call `/api/health`. This permanently removes
  failure mode #1.
- Otherwise poll `/api/health` on load (and every 3s while `probing`, max 20 polls).
  Render a pill in `.tt-head`: ⚪ probando → 🟢 listo / 🔴 error. Clicking a red pill shows
  `detail` and `configPath`.
- While `stage === "fail"`, the send button is disabled with the reason as its tooltip.

## API mode

### Request

`POST {baseUrl}/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`,
`content-type: application/json`. Model alias resolves through `cfg.models`; an empty
alias uses `cfg.models.default`.

### Sessions

An in-memory `Map<sessionId, {messages, lastUsed}>`; `sessionId` is random hex. Capped at
20 turns and 200KB per session, evicted after 2h idle.

**Accepted consequence:** in-memory sessions do not survive a server restart, while CLI
sessions persist under `~/.claude/projects/`. The browser holds `sessionId` in
`localStorage`, so a chat resumed after a restart will not find its history. When an
unknown `sessionId` arrives, the server starts a fresh conversation and returns a flag
that makes the client append a `sys` line saying the thread was reset. CLI mode is
unaffected.

**Accepted consequence:** API mode bills per message; CLI mode does not. The wizard states
this when path 2 is selected.

### Context gathering (`lib/context.js`)

API mode has no `Read`/`Grep`/`Glob` tools, so the server supplies context itself.
`gather({ page, extraDirs })` returns a string assembled from:

| Source | Cap |
|--------|-----|
| `CONTEXTO.md` | 20KB |
| Current page HTML → text (tags, `<script>`, `<style>` stripped); `page` comes from the client's `location.pathname` | 15KB |
| `RAW/` — filenames plus the first 2KB of each text-like file | 20KB |
| `extraDirs` — filenames only, not contents | 5KB |

Hard total cap 60KB. Every truncation is logged to the console so a user with oversized
material can see what was dropped.

## SKILL.md changes

Add a mandatory closing step, *Entregá el link*:

1. Start the bridge.
2. Poll `/api/health` until `stage !== "probing"`.
3. Report `http://localhost:<port>` as a clickable link together with the health state.
4. If `stage === "fail"`, report `detail` and the fix. **Do not claim the site is done.**

Also update *Cómo se ejecuta* for the wizard, `--reconfigure`, `--port`, and the fact that
the port may shift.

## Testing

`node:test`, no dependencies, under `plugins/tutor-ui/test/`.

- `config.js` — resolution order across all four layers; `0600` on written key files;
  round-trip save/load.
- `context.js` — each cap enforced independently and in total; HTML→text stripping;
  missing `CONTEXTO.md` and missing `RAW/` handled.
- `providers/api.js` — `check()` and `ask()` against a stub HTTP server; 401 → "key
  inválida", `ENOTFOUND` → "baseUrl inalcanzable", 404 → "endpoint incorrecto"; unknown
  `sessionId` returns the reset flag.
- `providers/cli.js` — against a fake `claude` script that echoes the JSON envelope;
  non-zero exit and malformed JSON both produce a `userMessage`.
- Integration — boot the server on an ephemeral port with a stub provider; assert
  `/api/health` transitions `probing → ok`, `/api/ask` round-trips, and `EADDRINUSE`
  retry lands on `port+1`.

## Version and migration

`plugin.json` → `2.0.0`. No migration path: existing generated sites keep their old
`chat-server.js`. Only newly scaffolded sites receive the new template.
