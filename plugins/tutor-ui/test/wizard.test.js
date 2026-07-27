const { test } = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cfgmod = require("../template/lib/config.js");

// readline falso: devuelve las respuestas en orden. Si se acaban, emite "close"
// (que es exactamente lo que pasa con stdin redirigido y EOF).
function fakeRl(answers) {
  const rl = new EventEmitter();
  let i = 0;
  rl.asked = [];
  rl.question = function (q) {
    rl.asked.push(q);
    if (i < answers.length) return Promise.resolve(answers[i++]);
    setImmediate(function () { rl.emit("close"); });
    return new Promise(function () {});   // nunca resuelve, igual que el real
  };
  rl.close = function () { rl.emit("close"); };
  return rl;
}

function tmpCfgPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tt-wz-")), "config.json");
}

test("CLI path saves provider, port and openBrowser", async () => {
  const p = tmpCfgPath();
  const cfg = await cfgmod.runWizard({
    rl: fakeRl(["1", "9123", "n"]), configPath: p, skipCheck: true, env: {} });
  assert.equal(cfg.provider, "cli");
  assert.equal(cfg.port, 9123);
  assert.equal(cfg.openBrowser, false);
  const saved = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(saved.provider, "cli");
  assert.equal(saved.port, 9123);
});

test("empty answers fall back to defaults", async () => {
  const p = tmpCfgPath();
  const cfg = await cfgmod.runWizard({
    rl: fakeRl(["", "", ""]), configPath: p, skipCheck: true, env: {} });
  assert.equal(cfg.provider, "cli");
  assert.equal(cfg.port, 8770);
  assert.equal(cfg.openBrowser, true);
});

test("API path stores baseUrl and the pasted key", async () => {
  const p = tmpCfgPath();
  const cfg = await cfgmod.runWizard({
    rl: fakeRl(["2", "http://localhost:4000", "sk-pegada", "8770", "s"]),
    configPath: p, skipCheck: true, env: {} });
  assert.equal(cfg.provider, "api");
  assert.equal(cfg.api.baseUrl, "http://localhost:4000");
  assert.equal(cfg.api.key, "sk-pegada");
  const saved = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(saved.api.key, "sk-pegada");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(p).mode & 0o777, 0o600);
  }
});

test("API path does NOT store a key that is already in the environment", async () => {
  const p = tmpCfgPath();
  const cfg = await cfgmod.runWizard({
    rl: fakeRl(["2", "https://api.anthropic.com", "8770", "s"]),
    configPath: p, skipCheck: true, env: { ANTHROPIC_API_KEY: "sk-del-entorno" } });
  assert.equal(cfg.provider, "api");
  assert.equal(cfg.api.key, null);
  const saved = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(saved.api.key, null);
});

// Regresión: con stdin redirigido el readline cierra a mitad y las preguntas
// pendientes no resolvían nunca -> el proceso moría en silencio con código 0.
test("a readline that closes mid-wizard still completes and saves", async () => {
  const p = tmpCfgPath();
  const cfg = await cfgmod.runWizard({
    rl: fakeRl(["1"]), configPath: p, skipCheck: true, env: {} });
  assert.equal(cfg.provider, "cli");
  assert.ok(fs.existsSync(p), "tiene que haber guardado igual");
});

test("runWizard refuses to run without a TTY instead of hanging", async () => {
  const original = process.stdin.isTTY;
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  try {
    await assert.rejects(
      () => cfgmod.runWizard({ configPath: tmpCfgPath(), skipCheck: true, env: {} }),
      (e) => /TUTOR_PROVIDER/.test(e.userMessage || ""));
  } finally {
    Object.defineProperty(process.stdin, "isTTY", { value: original, configurable: true });
  }
});
