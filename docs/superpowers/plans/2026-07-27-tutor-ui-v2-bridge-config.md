# Tutor UI v2.0 Bridge Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tutor bridge print the real access link, verify "Ask AI" works before the user asks anything, and support both the `claude` CLI and the Anthropic API behind a once-per-machine config.

**Architecture:** Split the monolithic `chat-server.js` into a thin HTTP/startup shell plus four focused modules — `lib/config.js` (resolution + wizard), `lib/context.js` (site context for API mode), and two providers behind a two-function interface (`ask`, `check`). Startup becomes a gate: fast check blocks boot, deep probe runs in background and feeds `GET /api/health`, which the client renders as a status pill.

**Tech Stack:** Node.js ≥18 (built-in `fetch`, `node:test`), zero runtime dependencies, vanilla browser JS (ES5 style, matching existing `tutor.js`).

**Spec:** `docs/superpowers/specs/2026-07-27-tutor-ui-bridge-config-design.md`

## Global Constraints

- Template stays **zero runtime dependencies**. Tests live in `plugins/tutor-ui/test/`, never in `template/`.
- Node ≥18 required (`fetch`, `node:test`). State this in README and check at boot.
- Server binds `127.0.0.1` only. Never `0.0.0.0`.
- Browser code is ES5-style vanilla JS (`var`, `function`) to match `assets/tutor.js`.
- All user-facing strings in **Spanish**, matching existing template copy.
- `api.key`, when persisted, is written only to `~/.tutor-ui/config.json` with mode `0600` — never to a per-site `tutor.config.json`.
- Model ids are exactly: `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`.
- Anthropic API calls send header `anthropic-version: 2023-06-01`.
- Every change to `template/` must be mirrored into `examples/espacio-estados/`.

---

### Task 1: `lib/config.js` — resolution, persistence, wizard

**Files:**
- Create: `plugins/tutor-ui/template/lib/config.js`
- Create: `plugins/tutor-ui/test/config.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `DEFAULTS` — frozen default config object
  - `resolve({ env, flags, siteCfg, homeCfg })` → merged config (pure, testable)
  - `load({ siteDir, env, flags })` → `{ cfg, sources }`
  - `save(cfg)` → writes `~/.tutor-ui/config.json`, mode `0600`
  - `configPath()` → absolute path to the home config
  - `needsSetup(cfg)` → boolean
  - `runWizard({ siteDir })` → `Promise<cfg>`
  - `apiKeyOf(cfg, env)` → resolved key string or `null`

- [ ] **Step 1: Write the failing tests**

```js
// plugins/tutor-ui/test/config.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const cfgmod = require("../template/lib/config.js");

test("defaults apply when nothing is provided", () => {
  const c = cfgmod.resolve({ env: {}, flags: {}, siteCfg: null, homeCfg: null });
  assert.equal(c.port, 8770);
  assert.equal(c.provider, null);
  assert.equal(c.models.default, "sonnet");
  assert.equal(c.api.baseUrl, "https://api.anthropic.com");
});

test("home config beats defaults", () => {
  const c = cfgmod.resolve({ env: {}, flags: {}, siteCfg: null,
                             homeCfg: { provider: "cli", port: 9000 } });
  assert.equal(c.provider, "cli");
  assert.equal(c.port, 9000);
});

test("site config beats home config", () => {
  const c = cfgmod.resolve({ env: {}, flags: {},
                             siteCfg: { port: 7000 },
                             homeCfg: { provider: "cli", port: 9000 } });
  assert.equal(c.port, 7000);
  assert.equal(c.provider, "cli");
});

test("env beats site config", () => {
  const c = cfgmod.resolve({ env: { PORT: "6000" }, flags: {},
                             siteCfg: { port: 7000 }, homeCfg: { port: 9000 } });
  assert.equal(c.port, 6000);
});

test("flags beat env", () => {
  const c = cfgmod.resolve({ env: { PORT: "6000" }, flags: { port: 5000 },
                             siteCfg: { port: 7000 }, homeCfg: { port: 9000 } });
  assert.equal(c.port, 5000);
});

test("--no-open flag overrides openBrowser", () => {
  const c = cfgmod.resolve({ env: {}, flags: { noOpen: true },
                             siteCfg: null, homeCfg: { openBrowser: true } });
  assert.equal(c.openBrowser, false);
});

test("ANTHROPIC_BASE_URL and TUTOR_PROVIDER are honoured", () => {
  const c = cfgmod.resolve({
    env: { TUTOR_PROVIDER: "api", ANTHROPIC_BASE_URL: "http://localhost:4000" },
    flags: {}, siteCfg: null, homeCfg: null });
  assert.equal(c.provider, "api");
  assert.equal(c.api.baseUrl, "http://localhost:4000");
});

test("needsSetup is true only when provider is unresolved", () => {
  assert.equal(cfgmod.needsSetup({ provider: null }), true);
  assert.equal(cfgmod.needsSetup({ provider: "cli" }), false);
});

test("apiKeyOf prefers keyEnv over stored key", () => {
  const cfg = { api: { keyEnv: "MY_KEY", key: "stored" } };
  assert.equal(cfgmod.apiKeyOf(cfg, { MY_KEY: "from-env" }), "from-env");
  assert.equal(cfgmod.apiKeyOf(cfg, {}), "stored");
  assert.equal(cfgmod.apiKeyOf({ api: { keyEnv: "X", key: null } }, {}), null);
});

test("models merge rather than replace", () => {
  const c = cfgmod.resolve({ env: {}, flags: {}, siteCfg: null,
                             homeCfg: { models: { default: "haiku" } } });
  assert.equal(c.models.default, "haiku");
  assert.equal(c.models.opus, "claude-opus-5");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test plugins/tutor-ui/test/config.test.js`
Expected: FAIL — `Cannot find module '../template/lib/config.js'`

- [ ] **Step 3: Implement `lib/config.js`**

`DEFAULTS`:

```js
const DEFAULTS = {
  version: 1,
  provider: null,
  cli: { bin: null },
  api: { baseUrl: "https://api.anthropic.com", keyEnv: "ANTHROPIC_API_KEY", key: null },
  models: { opus: "claude-opus-5", sonnet: "claude-sonnet-5",
            haiku: "claude-haiku-4-5-20251001", default: "sonnet" },
  port: 8770,
  openBrowser: true
};
```

`resolve` deep-merges in order `DEFAULTS → homeCfg → siteCfg → env → flags`. Nested objects
(`cli`, `api`, `models`) merge key-by-key; scalars overwrite. Env mapping:
`TUTOR_PROVIDER→provider`, `ANTHROPIC_BASE_URL→api.baseUrl`, `ANTHROPIC_API_KEY→api.key`,
`PORT→port` (parsed with `parseInt`, ignored if `NaN`), `TUTOR_NAME→tutorName`. Flags:
`{ port, noOpen }` where `noOpen: true` sets `openBrowser=false`.

`configPath()` returns `path.join(os.homedir(), ".tutor-ui", "config.json")`.
`save(cfg)` `mkdirSync` the parent with `{recursive:true}`, writes JSON with
`{ mode: 0o600 }`, then `fs.chmodSync(p, 0o600)` (chmod is a no-op on Windows but harmless).
`apiKeyOf(cfg, env)` returns `env[cfg.api.keyEnv] || cfg.api.key || null`.

`runWizard({ siteDir })` uses `node:readline/promises` on stdin/stdout and follows the
script in the spec's *Wizard* section. It resolves the CLI binary via
`providers/cli.js#resolveBin()` for path 1, prompts `baseUrl` + key handling for path 2,
runs the provider's `check()`, prints the result, then `save()`s regardless of check
outcome and returns the config.

- [ ] **Step 4: Run tests**

Run: `node --test plugins/tutor-ui/test/config.test.js`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/tutor-ui/template/lib/config.js plugins/tutor-ui/test/config.test.js
git commit -m "feat(tutor-ui): config resolution, persistence and first-run wizard"
```

---

### Task 2: `lib/context.js` — site context gathering for API mode

**Files:**
- Create: `plugins/tutor-ui/template/lib/context.js`
- Create: `plugins/tutor-ui/test/context.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `CAPS` = `{ contexto: 20480, page: 15360, raw: 20480, extra: 5120, total: 61440 }`
  - `htmlToText(html)` → plain text with `<script>`, `<style>`, tags and entities handled
  - `gather({ siteDir, page, extraDirs })` → `{ text, truncated: string[] }`

- [ ] **Step 1: Write the failing tests**

```js
// plugins/tutor-ui/test/context.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ctx = require("../template/lib/context.js");

function tmpSite(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-"));
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
  return dir;
}

test("htmlToText strips scripts, styles and tags", () => {
  const t = ctx.htmlToText(
    "<style>a{color:red}</style><script>var x=1</script><h1>T&iacute;tulo</h1><p>Hola <b>ah&iacute;</b></p>");
  assert.ok(!t.includes("color:red"));
  assert.ok(!t.includes("var x"));
  assert.ok(t.includes("Hola"));
  assert.ok(t.includes("ahí"));
});

test("gather includes CONTEXTO.md when present", () => {
  const dir = tmpSite({ "CONTEXTO.md": "El sitio trata de matrices." });
  const r = ctx.gather({ siteDir: dir, page: "/", extraDirs: [] });
  assert.ok(r.text.includes("El sitio trata de matrices."));
  assert.deepEqual(r.truncated, []);
});

test("gather survives a missing CONTEXTO.md and missing RAW", () => {
  const dir = tmpSite({ "index.html": "<h1>hola</h1>" });
  const r = ctx.gather({ siteDir: dir, page: "/index.html", extraDirs: [] });
  assert.ok(r.text.includes("hola"));
});

test("gather reads the page named by `page`", () => {
  const dir = tmpSite({ "1-modulo.html": "<article>contenido del modulo uno</article>" });
  const r = ctx.gather({ siteDir: dir, page: "/1-modulo.html", extraDirs: [] });
  assert.ok(r.text.includes("contenido del modulo uno"));
});

test("gather refuses to escape the site directory", () => {
  const dir = tmpSite({ "index.html": "<p>ok</p>" });
  const r = ctx.gather({ siteDir: dir, page: "/../../etc/passwd", extraDirs: [] });
  assert.ok(!r.text.includes("root:"));
});

test("CONTEXTO.md over its cap is truncated and reported", () => {
  const dir = tmpSite({ "CONTEXTO.md": "x".repeat(ctx.CAPS.contexto + 5000) });
  const r = ctx.gather({ siteDir: dir, page: "/", extraDirs: [] });
  assert.ok(r.truncated.some(s => s.includes("CONTEXTO.md")));
  assert.ok(r.text.length <= ctx.CAPS.total + 4096);
});

test("RAW files are listed with heads", () => {
  const dir = tmpSite({ "RAW/apuntes.md": "teorema fundamental", "RAW/foto.png": "binary" });
  const r = ctx.gather({ siteDir: dir, page: "/", extraDirs: [] });
  assert.ok(r.text.includes("apuntes.md"));
  assert.ok(r.text.includes("teorema fundamental"));
  assert.ok(r.text.includes("foto.png"));
  assert.ok(!r.text.includes("binary"));
});

test("extraDirs contribute filenames only, never contents", () => {
  const extra = tmpSite({ "secreto.md": "NO-DEBE-APARECER" });
  const dir = tmpSite({ "index.html": "<p>ok</p>" });
  const r = ctx.gather({ siteDir: dir, page: "/", extraDirs: [extra] });
  assert.ok(r.text.includes("secreto.md"));
  assert.ok(!r.text.includes("NO-DEBE-APARECER"));
});

test("total never exceeds the hard cap", () => {
  const big = "y".repeat(30000);
  const dir = tmpSite({ "CONTEXTO.md": big, "index.html": "<p>" + big + "</p>",
                        "RAW/a.md": big, "RAW/b.md": big });
  const r = ctx.gather({ siteDir: dir, page: "/index.html", extraDirs: [] });
  assert.ok(r.text.length <= ctx.CAPS.total + 4096);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test plugins/tutor-ui/test/context.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `lib/context.js`**

`htmlToText`: drop `<script...>...</script>` and `<style...>...</style>` blocks, replace
`<br>`/`</p>`/`</div>`/`</li>`/`</h[1-6]>` with `\n`, strip remaining tags, decode
`&amp; &lt; &gt; &quot; &#39; &nbsp;` plus numeric (`&#\d+;`) and the accented named
entities used in the template (`&iacute;` etc.) via a small map, then collapse runs of
blank lines.

`gather` builds labelled sections in this order and concatenates with `\n\n`:
`## CONTEXTO.md`, `## Página actual: <page>`, `## Carpeta RAW/`, `## Carpetas de contexto
extra`. Each section is sliced to its cap; when sliced, push
`` `<label> truncado a N KB` `` onto `truncated`. `page` is normalised with
`path.normalize`, leading `..` segments stripped, joined onto `siteDir`, and rejected
unless the result `startsWith(siteDir)`. `/` maps to `index.html`. RAW files are read only
when the extension is in `{.md,.txt,.tex,.csv,.json,.html,.rst}`; others are listed by name
only. Non-existent paths are skipped silently. A final overall slice enforces `CAPS.total`.

- [ ] **Step 4: Run tests**

Run: `node --test plugins/tutor-ui/test/context.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/tutor-ui/template/lib/context.js plugins/tutor-ui/test/context.test.js
git commit -m "feat(tutor-ui): site context gathering with per-source caps"
```

---

### Task 3: `lib/providers/cli.js`

**Files:**
- Create: `plugins/tutor-ui/template/lib/providers/cli.js`
- Create: `plugins/tutor-ui/test/provider-cli.test.js`

**Interfaces:**
- Consumes: `config.js` (for `cfg.cli.bin`, `cfg.models`)
- Produces:
  - `create(cfg, { siteDir, tutorName })` → `{ ask, check, checkFast, resolveBin }`
  - `ask({ message, sessionId, model, extraDirs, page })` → `Promise<{reply, sessionId, reset:false}>`
  - `checkFast()` → `Promise<{ok, detail}>` (runs `claude --version`)
  - `check()` → `Promise<{ok, detail, model}>` (real 5-token prompt)
  - `resolveBin(cfg)` → absolute path or `null`

- [ ] **Step 1: Write the failing tests**

```js
// plugins/tutor-ui/test/provider-cli.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cli = require("../template/lib/providers/cli.js");

const IS_WIN = process.platform === "win32";

// Writes a fake `claude` that echoes a CLI-shaped JSON envelope on stdout.
function fakeClaude(body, exitCode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-cli-"));
  const js = path.join(dir, "fake.js");
  fs.writeFileSync(js,
    `process.stdin.resume();
     process.stdin.on("end", () => {
       process.stdout.write(${JSON.stringify(body)});
       process.exit(${exitCode || 0});
     });`);
  const bin = path.join(dir, IS_WIN ? "claude.cmd" : "claude");
  fs.writeFileSync(bin, IS_WIN
    ? `@echo off\r\nnode "${js}" %*\r\n`
    : `#!/bin/sh\nexec node "${js}" "$@"\n`);
  if (!IS_WIN) fs.chmodSync(bin, 0o755);
  return bin;
}

function providerWith(bin, siteDir) {
  return cli.create({ cli: { bin }, models: { default: "sonnet" } },
                    { siteDir: siteDir || os.tmpdir(), tutorName: "Tutor" });
}

test("ask parses the JSON envelope and returns reply + sessionId", async () => {
  const bin = fakeClaude(JSON.stringify({ result: "hola!", session_id: "abc123" }));
  const p = providerWith(bin);
  const r = await p.ask({ message: "hola", sessionId: null, model: "", extraDirs: [], page: "/" });
  assert.equal(r.reply, "hola!");
  assert.equal(r.sessionId, "abc123");
  assert.equal(r.reset, false);
});

test("ask falls back to raw stdout when the envelope is not JSON", async () => {
  const bin = fakeClaude("texto plano sin json");
  const p = providerWith(bin);
  const r = await p.ask({ message: "hola", sessionId: null, model: "", extraDirs: [], page: "/" });
  assert.equal(r.reply, "texto plano sin json");
});

test("a non-zero exit produces an error carrying userMessage", async () => {
  const bin = fakeClaude("", 3);
  const p = providerWith(bin);
  await assert.rejects(
    () => p.ask({ message: "hola", sessionId: null, model: "", extraDirs: [], page: "/" }),
    (e) => typeof e.userMessage === "string" && e.userMessage.length > 0);
});

test("a missing binary makes checkFast fail with an actionable message", async () => {
  const p = providerWith(path.join(os.tmpdir(), "no-existe-claude-xyz"));
  const r = await p.checkFast();
  assert.equal(r.ok, false);
  assert.match(r.detail, /claude/i);
});

test("resolveBin returns the configured bin when it exists", () => {
  const bin = fakeClaude("{}");
  assert.equal(cli.resolveBin({ cli: { bin } }), bin);
});

test("resolveBin returns null when the configured bin is gone and none is found", () => {
  const gone = path.join(os.tmpdir(), "definitivamente-no-existe-claude");
  const found = cli.resolveBin({ cli: { bin: gone } });
  assert.ok(found === null || fs.existsSync(found));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test plugins/tutor-ui/test/provider-cli.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `lib/providers/cli.js`**

`resolveBin(cfg)` tries, in order: `cfg.cli.bin` if `fs.existsSync`; `where claude` /
`which claude` via `execFileSync` (first line, trimmed); then the candidates
`%LOCALAPPDATA%\Programs\claude\claude.exe`, `~/.local/bin/claude`,
`~/.claude/local/claude`; returns `null` if none exist.

`ask` keeps the existing spawn logic from `chat-server.js:58-91` — args
`["-p","--output-format","json","--allowedTools","Read,Grep,Glob"]`, optional
`--model`, `--add-dir` per existing dir, `--resume` when `sessionId` is set, payload on
stdin, 180s kill timer — but spawns the **resolved binary** rather than the bare name, and
rejects with an `Error` whose `.userMessage` is the Spanish explanation. `reset` is always
`false`; CLI sessions persist on disk.

`checkFast()` runs `<bin> --version` with a 15s timeout. Missing binary →
`{ ok:false, detail:"No encontré el CLI `claude`. Instalalo y volvé a correr con --reconfigure." }`.

`check()` runs a real `ask` with message `"ping"` and no session. On a non-zero exit whose
stderr mentions auth/login, returns
`{ ok:false, detail:"El CLI `claude` está instalado pero no logueado. Corré `claude` una vez y hacé login." }`.

- [ ] **Step 4: Run tests**

Run: `node --test plugins/tutor-ui/test/provider-cli.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/tutor-ui/template/lib/providers/cli.js plugins/tutor-ui/test/provider-cli.test.js
git commit -m "feat(tutor-ui): CLI provider with binary resolution and health checks"
```

---

### Task 4: `lib/providers/api.js`

**Files:**
- Create: `plugins/tutor-ui/template/lib/providers/api.js`
- Create: `plugins/tutor-ui/test/provider-api.test.js`

**Interfaces:**
- Consumes: `config.js#apiKeyOf`, `context.js#gather`
- Produces:
  - `create(cfg, { siteDir, tutorName, env })` → `{ ask, check, checkFast }`
  - Same `ask` / `check` shapes as the CLI provider; `ask` may return `reset: true`

- [ ] **Step 1: Write the failing tests**

```js
// plugins/tutor-ui/test/provider-api.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os");
const api = require("../template/lib/providers/api.js");

function stub(handler) {
  return new Promise((res) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => res({ srv: s, url: "http://127.0.0.1:" + s.address().port }));
  });
}
function jsonOf(req) {
  return new Promise((res) => { let b = ""; req.on("data", c => b += c); req.on("end", () => res(JSON.parse(b))); });
}
function providerFor(url, extra) {
  return api.create(
    Object.assign({ api: { baseUrl: url, keyEnv: "K", key: null },
                    models: { sonnet: "claude-sonnet-5", default: "sonnet" } }, extra || {}),
    { siteDir: os.tmpdir(), tutorName: "Tutor", env: { K: "sk-test" } });
}

test("ask posts to /v1/messages with the right headers and returns the reply", async () => {
  let seen = null;
  const { srv, url } = await stub(async (req, res) => {
    seen = { headers: req.headers, body: await jsonOf(req), path: req.url };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: "respuesta!" }] }));
  });
  const p = providerFor(url);
  const r = await p.ask({ message: "hola", sessionId: null, model: "", extraDirs: [], page: "/" });
  assert.equal(r.reply, "respuesta!");
  assert.ok(r.sessionId);
  assert.equal(seen.path, "/v1/messages");
  assert.equal(seen.headers["x-api-key"], "sk-test");
  assert.equal(seen.headers["anthropic-version"], "2023-06-01");
  assert.equal(seen.body.model, "claude-sonnet-5");
  assert.ok(typeof seen.body.system === "string" && seen.body.system.length > 0);
  srv.close();
});

test("a known sessionId replays prior turns", async () => {
  let lastBody = null;
  const { srv, url } = await stub(async (req, res) => {
    lastBody = await jsonOf(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: "ok" }] }));
  });
  const p = providerFor(url);
  const first = await p.ask({ message: "uno", sessionId: null, model: "", extraDirs: [], page: "/" });
  await p.ask({ message: "dos", sessionId: first.sessionId, model: "", extraDirs: [], page: "/" });
  assert.equal(lastBody.messages.length, 3);   // user, assistant, user
  assert.equal(lastBody.messages[0].content, "uno");
  srv.close();
});

test("an unknown sessionId starts fresh and flags reset", async () => {
  const { srv, url } = await stub(async (req, res) => {
    await jsonOf(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: "ok" }] }));
  });
  const p = providerFor(url);
  const r = await p.ask({ message: "hola", sessionId: "no-existe", model: "", extraDirs: [], page: "/" });
  assert.equal(r.reset, true);
  assert.notEqual(r.sessionId, "no-existe");
  srv.close();
});

test("model aliases resolve through cfg.models", async () => {
  let body = null;
  const { srv, url } = await stub(async (req, res) => {
    body = await jsonOf(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: "ok" }] }));
  });
  const p = api.create(
    { api: { baseUrl: url, keyEnv: "K", key: null },
      models: { haiku: "claude-haiku-4-5-20251001", sonnet: "claude-sonnet-5", default: "sonnet" } },
    { siteDir: os.tmpdir(), tutorName: "T", env: { K: "sk" } });
  await p.ask({ message: "x", sessionId: null, model: "haiku", extraDirs: [], page: "/" });
  assert.equal(body.model, "claude-haiku-4-5-20251001");
  srv.close();
});

test("401 maps to an invalid-key message", async () => {
  const { srv, url } = await stub((req, res) => { res.writeHead(401); res.end('{"error":{"message":"bad key"}}'); });
  const p = providerFor(url);
  const r = await p.check();
  assert.equal(r.ok, false);
  assert.match(r.detail, /API key/i);
  srv.close();
});

test("404 maps to a wrong-endpoint message", async () => {
  const { srv, url } = await stub((req, res) => { res.writeHead(404); res.end("{}"); });
  const p = providerFor(url);
  const r = await p.check();
  assert.equal(r.ok, false);
  assert.match(r.detail, /baseUrl|endpoint/i);
  srv.close();
});

test("an unreachable baseUrl maps to a connection message", async () => {
  const p = providerFor("http://127.0.0.1:1");
  const r = await p.check();
  assert.equal(r.ok, false);
  assert.match(r.detail, /conect|alcanz/i);
});

test("a missing key fails check before any request", async () => {
  const p = api.create({ api: { baseUrl: "http://127.0.0.1:1", keyEnv: "NOPE", key: null },
                         models: { default: "sonnet", sonnet: "claude-sonnet-5" } },
                       { siteDir: os.tmpdir(), tutorName: "T", env: {} });
  const r = await p.check();
  assert.equal(r.ok, false);
  assert.match(r.detail, /API key/i);
});

test("check succeeds against a healthy stub", async () => {
  const { srv, url } = await stub(async (req, res) => {
    await jsonOf(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: "pong" }] }));
  });
  const p = providerFor(url);
  const r = await p.check();
  assert.equal(r.ok, true);
  assert.equal(r.model, "claude-sonnet-5");
  srv.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test plugins/tutor-ui/test/provider-api.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `lib/providers/api.js`**

Sessions: `Map<sessionId, { messages: [], lastUsed: number }>`; ids from
`crypto.randomBytes(8).toString("hex")`. On each `ask`, evict entries idle > 2h, then trim
the session to the last 20 messages and to 200KB of serialized content.

`ask` builds `system` = `PREAMBLE(tutorName)` + `"\n\n"` + `context.gather({siteDir, page,
extraDirs}).text`, then POSTs `{ model, max_tokens: 4096, system, messages }` with headers
`x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`. The reply is
the concatenation of `content[].text` for `type === "text"`. Push both the user message and
the assistant reply onto the session before returning. `reset` is `true` when the incoming
`sessionId` was non-null but absent from the map.

`checkFast()` resolves `{ok:true}` immediately when a key is resolvable, otherwise the
missing-key failure. `check()` posts `max_tokens: 5` with `messages:[{role:"user",
content:"ping"}]` and maps failures: no key → ``"Falta la API key. Seteá $<keyEnv> o corré
`node chat-server.js --reconfigure`."``; `401`/`403` → `"La API key fue rechazada (401)."`;
`404` → `"El baseUrl no expone /v1/messages — revisá el endpoint."`; network throw →
`"No pude conectar con <baseUrl>."`; other non-2xx → status plus the first 200 chars of the
body.

The `PREAMBLE` text is lifted verbatim from `chat-server.js:29-42` with `${TUTOR_NAME}`
parameterised, minus the CLI-only sentence about reading files itself.

- [ ] **Step 4: Run tests**

Run: `node --test plugins/tutor-ui/test/provider-api.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/tutor-ui/template/lib/providers/api.js plugins/tutor-ui/test/provider-api.test.js
git commit -m "feat(tutor-ui): Anthropic API provider with context injection and mapped errors"
```

---

### Task 5: `chat-server.js` — routing, startup gate, health

**Files:**
- Modify: `plugins/tutor-ui/template/chat-server.js` (full rewrite, ~180 lines)
- Create: `plugins/tutor-ui/test/server.test.js`

**Interfaces:**
- Consumes: all four `lib/` modules
- Produces:
  - `createServer({ cfg, provider, siteDir })` → `{ server, health, listenWithRetry }`
  - `GET /api/health` → `{ provider, stage, detail, model, port, configPath }`
  - `POST /api/ask` → `{ reply, sessionId, reset }` or `{ error }`
  - `POST /api/open` → unchanged behaviour

- [ ] **Step 1: Write the failing tests**

```js
// plugins/tutor-ui/test/server.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const srvmod = require("../template/chat-server.js");

const stubProvider = {
  ask: async ({ message }) => ({ reply: "eco: " + message, sessionId: "s1", reset: false }),
  check: async () => ({ ok: true, detail: "listo", model: "claude-sonnet-5" }),
  checkFast: async () => ({ ok: true, detail: "" })
};
const baseCfg = { provider: "cli", port: 0, models: { default: "sonnet" }, openBrowser: false };

async function boot(provider) {
  const h = srvmod.createServer({ cfg: baseCfg, provider: provider || stubProvider, siteDir: os.tmpdir() });
  const port = await h.listenWithRetry(0);
  return { h, port, base: "http://127.0.0.1:" + port };
}

test("health starts probing and becomes ok after the deep probe", async () => {
  const { h, base } = await boot();
  let r = await (await fetch(base + "/api/health")).json();
  assert.equal(r.stage, "probing");
  assert.equal(r.provider, "cli");
  await h.health.probe();
  r = await (await fetch(base + "/api/health")).json();
  assert.equal(r.stage, "ok");
  assert.equal(r.model, "claude-sonnet-5");
  h.server.close();
});

test("health reports fail with the provider's detail", async () => {
  const bad = Object.assign({}, stubProvider,
    { check: async () => ({ ok: false, detail: "no logueado", model: "" }) });
  const { h, base } = await boot(bad);
  await h.health.probe();
  const r = await (await fetch(base + "/api/health")).json();
  assert.equal(r.stage, "fail");
  assert.equal(r.detail, "no logueado");
  h.server.close();
});

test("/api/ask round-trips through the provider", async () => {
  const { h, base } = await boot();
  const res = await fetch(base + "/api/ask", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "hola", sessionId: null, model: "", extraDirs: [], page: "/" })
  });
  const j = await res.json();
  assert.equal(j.reply, "eco: hola");
  assert.equal(j.sessionId, "s1");
  h.server.close();
});

test("/api/ask rejects an empty message", async () => {
  const { h, base } = await boot();
  const res = await fetch(base + "/api/ask", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "   " }) });
  assert.equal(res.status, 400);
  h.server.close();
});

test("/api/ask surfaces a provider error as userMessage", async () => {
  const boom = Object.assign({}, stubProvider, {
    ask: async () => { const e = new Error("interno"); e.userMessage = "Fallo legible"; throw e; } });
  const { h, base } = await boot(boom);
  const j = await (await fetch(base + "/api/ask", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "hola" }) })).json();
  assert.equal(j.error, "Fallo legible");
  h.server.close();
});

test("listenWithRetry moves to the next port when one is taken", async () => {
  const a = srvmod.createServer({ cfg: baseCfg, provider: stubProvider, siteDir: os.tmpdir() });
  const portA = await a.listenWithRetry(0);
  const b = srvmod.createServer({ cfg: baseCfg, provider: stubProvider, siteDir: os.tmpdir() });
  const portB = await b.listenWithRetry(portA);
  assert.equal(portB, portA + 1);
  a.server.close(); b.server.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test plugins/tutor-ui/test/server.test.js`
Expected: FAIL — `createServer is not a function`

- [ ] **Step 3: Rewrite `chat-server.js`**

Export `createServer` and guard the boot sequence with
`if (require.main === module) main();` so the module is importable by tests.

`createServer` returns `{ server, health, listenWithRetry }` where `health` is
`{ stage:"probing", detail:"", model:"", probe() }` and `probe()` awaits
`provider.check()` and mutates `stage`/`detail`/`model`. `listenWithRetry(port)` resolves
the bound port, retrying `port+1 … port+10` on `EADDRINUSE`, rejecting after that.
Passing `0` binds an ephemeral port and returns it.

`serveStatic` and `openFolder` move over unchanged from the current file
(`chat-server.js:44-54` and `:94-107`).

`main()`: parse `--port` / `--no-open` / `--reconfigure` from `process.argv`; `config.load`;
`runWizard` when `needsSetup` or `--reconfigure`; build the provider; `await
provider.checkFast()` and on failure print the detail and `process.exit(1)`;
`listenWithRetry(cfg.port)`; fire `health.probe()` without awaiting; print the banner from
the spec; open the browser when `cfg.openBrowser`.

- [ ] **Step 4: Run tests**

Run: `node --test plugins/tutor-ui/test/server.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/tutor-ui/template/chat-server.js plugins/tutor-ui/test/server.test.js
git commit -m "feat(tutor-ui): health-gated startup, port retry and provider-agnostic routing"
```

---

### Task 6: Client — health pill and `file://` guard

**Files:**
- Modify: `plugins/tutor-ui/template/assets/tutor.js` (`build()` at :293, `send()` at :206, `styles()` at :77)

**Interfaces:**
- Consumes: `GET /api/health`
- Produces: no exports (IIFE)

- [ ] **Step 1: Add the `file://` guard**

At the top of `build()`, before anything else:

```js
if (location.protocol === "file:") { buildFileCard(); return; }
```

`buildFileCard()` injects the styles, the FAB and the panel shell, then replaces the panel
body with:

```
⚠️ El tutor necesita el bridge

Abriste el sitio como archivo (file://). El chat no puede funcionar así.

1. Abrí una terminal en la carpeta del sitio
2. Ejecutá:  node chat-server.js
3. Abrí el link que imprime (http://localhost:8770)
```

- [ ] **Step 2: Add the status pill**

New CSS in `styles()`:

```js
+ '.tt-pill{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);'
+ 'font-size:10.5px;border:1px solid var(--line);border-radius:20px;padding:2px 8px;cursor:default;background:var(--bg)}'
+ '.tt-pill.ok{color:var(--good,#3fb950);border-color:currentColor}'
+ '.tt-pill.fail{color:var(--bad,#f85149);border-color:currentColor;cursor:pointer}'
+ '.tt-pill.probing{color:var(--ink-soft)}'
```

Insert `<span class="tt-pill probing" id="tt-pill">⚪ probando…</span>` into `.tt-head`
immediately before the `×` button, and poll:

```js
var pillEl, healthState = { stage: "probing" }, healthPolls = 0;
function renderPill(){
  if (!pillEl) return;
  var s = healthState.stage;
  pillEl.className = "tt-pill " + s;
  pillEl.textContent = s === "ok" ? "🟢 listo" : (s === "fail" ? "🔴 error" : "⚪ probando…");
  pillEl.title = healthState.detail || "";
  if (elSend) elSend.disabled = (s === "fail");
}
function pollHealth(){
  fetch("/api/health").then(function(r){ return r.json(); }).then(function(h){
    healthState = h; renderPill();
    if (h.stage === "probing" && ++healthPolls < 20) setTimeout(pollHealth, 3000);
    if (h.stage === "fail") addMsg("sys", "⚠️ " + h.detail + "\nConfig: " + (h.configPath || ""), false);
  }).catch(function(){});
}
```

Call `pollHealth()` at the end of `build()`. Clicking a `fail` pill re-runs `pollHealth()`.

- [ ] **Step 3: Handle the `reset` flag in `send()`**

In the `.then` at :214, before rendering the reply:

```js
if (data.reset) addMsg("sys", "↻ Se reinició el hilo (el servidor se reinició).", false);
```

- [ ] **Step 4: Verify in a browser**

Start the bridge, open the printed URL, confirm the pill goes ⚪ → 🟢 and one question
round-trips. Then open `index.html` directly from the filesystem and confirm the card
appears instead of a dead chat.

- [ ] **Step 5: Commit**

```bash
git add plugins/tutor-ui/template/assets/tutor.js
git commit -m "feat(tutor-ui): health pill, file:// guard and session-reset notice"
```

---

### Task 7: Launchers, gitignore, manifest

**Files:**
- Modify: `plugins/tutor-ui/template/iniciar-tutor.cmd`
- Modify: `plugins/tutor-ui/template/iniciar-tutor.sh`
- Create: `plugins/tutor-ui/template/.gitignore`
- Modify: `plugins/tutor-ui/.claude-plugin/plugin.json`

- [ ] **Step 1: Strip the hardcoded link from `iniciar-tutor.cmd`**

Remove lines 8-11 (the `http://localhost:8770` echo). The banner now comes from the server.
Keep the `pause` fallback. Mirror the same change in `iniciar-tutor.sh`.

- [ ] **Step 2: Add `template/.gitignore`**

```
tutor.config.json
RAW/*
!RAW/LEEME.md
```

- [ ] **Step 3: Bump the version**

`plugin.json`: `"version": "1.0.0"` → `"2.0.0"`.

- [ ] **Step 4: Verify**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugins/tutor-ui/.claude-plugin/plugin.json'))"`
Expected: no output (valid JSON)

- [ ] **Step 5: Commit**

```bash
git add plugins/tutor-ui/template/iniciar-tutor.cmd plugins/tutor-ui/template/iniciar-tutor.sh plugins/tutor-ui/template/.gitignore plugins/tutor-ui/.claude-plugin/plugin.json
git commit -m "chore(tutor-ui): launchers defer to server banner; v2.0.0"
```

---

### Task 8: `SKILL.md` and `README.md`

**Files:**
- Modify: `plugins/tutor-ui/skills/create-site/SKILL.md`
- Modify: `plugins/tutor-ui/README.md`

- [ ] **Step 1: Rewrite the execution section of `SKILL.md`**

Replace *Cómo se ejecuta* (lines 49-52) with the wizard flow, the `--reconfigure` /
`--port` / `--no-open` flags, and a note that the port may shift when 8770 is taken.

- [ ] **Step 2: Add the mandatory delivery step**

New step 7, *Entregá el link (obligatorio)*:

```
1. Arrancá el bridge en segundo plano:  node chat-server.js
2. Esperá a que GET /api/health devuelva stage distinto de "probing"
   (poll cada 2s, máximo 30s)
3. Reportá el link http://localhost:<port> como link clickeable, junto al estado
4. Si stage === "fail": reportá `detail` y cómo arreglarlo.
   NO declares el sitio terminado.
```

- [ ] **Step 3: Update `README.md`**

Document the two providers, `~/.tutor-ui/config.json` with its full shape, the Node ≥18
requirement, the flags, and the two accepted consequences of API mode (per-message billing,
in-memory sessions that reset on restart).

- [ ] **Step 4: Verify**

Run: `node -e "const m=require('fs').readFileSync('plugins/tutor-ui/skills/create-site/SKILL.md','utf8'); if(!/api\/health/.test(m)) throw new Error('missing health step')"`
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add plugins/tutor-ui/skills/create-site/SKILL.md plugins/tutor-ui/README.md
git commit -m "docs(tutor-ui): wizard, flags and mandatory link-delivery step"
```

---

### Task 9: Propagate to the example, full verification, push

**Files:**
- Modify: `plugins/tutor-ui/examples/espacio-estados/` (mirror `chat-server.js`, `lib/`, `assets/tutor.js`, launchers)

- [ ] **Step 1: Mirror the template into the example**

Copy `chat-server.js`, the whole `lib/` tree, `assets/tutor.js`, and both launchers from
`template/` into `examples/espacio-estados/`. Do **not** overwrite the example's
`index.html`, `CONTEXTO.md`, its module pages, or `assets/plot.js`.

- [ ] **Step 2: Run the whole suite**

Run: `node --test plugins/tutor-ui/test/`
Expected: PASS, 40 tests, 0 failures

- [ ] **Step 3: Live end-to-end check**

Start the example bridge, poll `/api/health` until it leaves `probing`, POST a real
question to `/api/ask`, and confirm a non-empty reply. Then confirm the banner prints the
same port the server actually bound.

- [ ] **Step 4: Commit and push**

```bash
git add plugins/tutor-ui/examples
git commit -m "chore(tutor-ui): propagate v2.0 bridge to the espacio-estados example"
git push -u origin feat/bridge-config-v2
```

---

## Self-Review

**Spec coverage:** Every spec section maps to a task — file layout (1-5), provider interface
(3, 4), config resolution and shape (1), key storage (1), CLI binary resolution (3), wizard
(1), startup sequence (5), health endpoint (5), client behaviour (6), API sessions and
context caps (2, 4), SKILL.md changes (8), testing (1-5, 9), version and migration (7).

**Placeholders:** None. Every code step carries real code or an exact edit target.

**Type consistency:** `ask` returns `{reply, sessionId, reset}` in Tasks 3, 4 and 5, and the
client reads `data.reset` in Task 6. `check` returns `{ok, detail, model}` in Tasks 3, 4 and
is consumed as such by `health.probe()` in Task 5. `CAPS` is defined in Task 2 and only read
by its own tests. `resolveBin` is exported by Task 3 and consumed by Task 1's wizard.
