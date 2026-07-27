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
function providerFor(url) {
  return api.create(
    { api: { baseUrl: url, keyEnv: "K", key: null },
      models: { sonnet: "claude-sonnet-5", default: "sonnet" } },
    { siteDir: os.tmpdir(), tutorName: "Tutor", env: { K: "sk-test" } });
}
function okHandler(text) {
  return async (req, res) => {
    await jsonOf(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: text || "ok" }] }));
  };
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
  const { srv, url } = await stub(okHandler());
  const p = providerFor(url);
  const r = await p.ask({ message: "hola", sessionId: "no-existe", model: "", extraDirs: [], page: "/" });
  assert.equal(r.reset, true);
  assert.notEqual(r.sessionId, "no-existe");
  srv.close();
});

test("a fresh conversation does not flag reset", async () => {
  const { srv, url } = await stub(okHandler());
  const p = providerFor(url);
  const r = await p.ask({ message: "hola", sessionId: null, model: "", extraDirs: [], page: "/" });
  assert.equal(r.reset, false);
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
  const { srv, url } = await stub(okHandler("pong"));
  const p = providerFor(url);
  const r = await p.check();
  assert.equal(r.ok, true);
  assert.equal(r.model, "claude-sonnet-5");
  srv.close();
});

test("ask surfaces a non-2xx as an error with userMessage", async () => {
  const { srv, url } = await stub((req, res) => { res.writeHead(500); res.end('{"error":{"message":"boom"}}'); });
  const p = providerFor(url);
  await assert.rejects(
    () => p.ask({ message: "hola", sessionId: null, model: "", extraDirs: [], page: "/" }),
    (e) => typeof e.userMessage === "string" && e.userMessage.length > 0);
  srv.close();
});
