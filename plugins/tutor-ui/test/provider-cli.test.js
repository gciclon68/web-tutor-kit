const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cli = require("../template/lib/providers/cli.js");

const IS_WIN = process.platform === "win32";

// Escribe un `claude` falso que devuelve un envelope JSON por stdout.
function fakeClaude(body, exitCode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-cli-"));
  const js = path.join(dir, "fake.js");
  fs.writeFileSync(js,
    `let seen = "";
     process.stdin.on("data", c => seen += c);
     process.stdin.on("end", () => {
       if (process.argv.includes("--version")) { process.stdout.write("1.0.0 (fake)\\n"); process.exit(0); }
       process.stdout.write(${JSON.stringify(body)});
       process.exit(${exitCode || 0});
     });
     if (process.argv.includes("--version")) { process.stdout.write("1.0.0 (fake)\\n"); process.exit(0); }`);
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

test("checkFast succeeds against a fake binary", async () => {
  const p = providerWith(fakeClaude("{}"));
  const r = await p.checkFast();
  assert.equal(r.ok, true);
});

test("check runs a real prompt and reports ok", async () => {
  const bin = fakeClaude(JSON.stringify({ result: "pong", session_id: "s" }));
  const p = providerWith(bin);
  const r = await p.check();
  assert.equal(r.ok, true);
});

test("resolveBin returns the configured bin when it exists", () => {
  const bin = fakeClaude("{}");
  assert.equal(cli.resolveBin({ cli: { bin } }), bin);
});

test("resolveBin returns null or an existing path when the configured bin is gone", () => {
  const gone = path.join(os.tmpdir(), "definitivamente-no-existe-claude");
  const found = cli.resolveBin({ cli: { bin: gone } });
  assert.ok(found === null || fs.existsSync(found));
});
