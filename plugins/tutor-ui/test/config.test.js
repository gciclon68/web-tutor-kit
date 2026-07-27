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

test("an invalid PORT in the environment is ignored", () => {
  const c = cfgmod.resolve({ env: { PORT: "no-es-un-numero" }, flags: {},
                             siteCfg: null, homeCfg: { port: 9000 } });
  assert.equal(c.port, 9000);
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

test("resolve never mutates DEFAULTS", () => {
  cfgmod.resolve({ env: {}, flags: {}, siteCfg: { port: 1234 },
                   homeCfg: { models: { opus: "otro" } } });
  const c = cfgmod.resolve({ env: {}, flags: {}, siteCfg: null, homeCfg: null });
  assert.equal(c.port, 8770);
  assert.equal(c.models.opus, "claude-opus-5");
});

test("save writes 0600 JSON that load can read back", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-home-"));
  const p = path.join(home, ".tutor-ui", "config.json");
  cfgmod.save({ provider: "api", port: 4321 }, p);
  const back = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(back.provider, "api");
  assert.equal(back.port, 4321);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(p).mode & 0o777, 0o600);
  }
});
