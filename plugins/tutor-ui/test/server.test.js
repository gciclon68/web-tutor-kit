const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const srvmod = require("../template/chat-server.js");

const stubProvider = {
  ask: async ({ message }) => ({ reply: "eco: " + message, sessionId: "s1", reset: false }),
  check: async () => ({ ok: true, detail: "listo", model: "claude-sonnet-5" }),
  checkFast: async () => ({ ok: true, detail: "" })
};
const baseCfg = { provider: "cli", port: 0, models: { default: "sonnet" }, openBrowser: false };

async function boot(provider, siteDir) {
  const h = srvmod.createServer({ cfg: baseCfg, provider: provider || stubProvider,
                                  siteDir: siteDir || os.tmpdir() });
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
  assert.ok(r.port > 0);
  assert.ok(typeof r.configPath === "string");
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
  assert.equal(j.reset, false);
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

test("static files are served from the site directory", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-srv-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<h1>hola tutor</h1>");
  const { h, base } = await boot(null, dir);
  const body = await (await fetch(base + "/")).text();
  assert.ok(body.includes("hola tutor"));
  h.server.close();
});

test("static serving refuses to escape the site directory", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-srv-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<h1>ok</h1>");
  const { h, base } = await boot(null, dir);
  const res = await fetch(base + "/../../../../../../etc/passwd");
  assert.ok(res.status === 403 || res.status === 404);
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
