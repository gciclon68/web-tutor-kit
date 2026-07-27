/* =====================================================================
   Tutor bridge · sirve el sitio y conecta el panel de chat con Claude.

   Uso:
     node chat-server.js                  arranca (pregunta la primera vez)
     node chat-server.js --reconfigure    vuelve a preguntar
     node chat-server.js --port 9000      fuerza un puerto
     node chat-server.js --no-open        no abre el navegador

   La primera vez pregunta cómo hablar con Claude (CLI logueado o API key)
   y lo guarda en ~/.tutor-ui/config.json. Después no vuelve a preguntar.

   El link real se imprime al arrancar: si 8770 está ocupado, sube solo.
   ===================================================================== */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const cfgmod = require("./lib/config.js");

const IS_WIN = process.platform === "win32";
const PORT_RETRIES = 10;

const MIME = { ".html":"text/html; charset=utf-8", ".css":"text/css", ".js":"text/javascript",
               ".md":"text/markdown; charset=utf-8", ".json":"application/json", ".svg":"image/svg+xml",
               ".png":"image/png", ".jpg":"image/jpeg", ".woff2":"font/woff2" };

/* ------------------------------------------------------------ estáticos */

function serveStatic(siteDir, req, res) {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const clean = path.normalize(p).replace(/^([\\/]|\.\.[\\/])+/, "");
  const fp = path.resolve(siteDir, clean);
  const root = path.resolve(siteDir);
  if (fp !== root && !fp.startsWith(root + path.sep)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(fp, function (e, data) {
    if (e) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
    res.end(data);
  });
}

/* --------------------------------------------------- abrir carpeta en SO */

function openFolder(siteDir, target, cb) {
  const safe = path.normalize(String(target || "")).replace(/^([\\/]|\.\.[\\/])+/, "");
  const dir = path.resolve(siteDir, safe);
  const root = path.resolve(siteDir);
  if (dir !== root && !dir.startsWith(root + path.sep)) return cb({ error: "ruta no permitida" });
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  let cmd = "xdg-open";
  if (IS_WIN) cmd = "explorer.exe"; else if (process.platform === "darwin") cmd = "open";
  try {
    const c = spawn(cmd, [dir], { detached: true, stdio: "ignore" });
    c.on("error", function (e) { cb({ error: e.message }); });
    if (c.unref) c.unref();
    cb({ ok: true, dir: dir });
  } catch (e) { cb({ error: e.message }); }
}

function openBrowser(url) {
  try {
    if (IS_WIN) spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch (e) { /* no pasa nada si no se puede */ }
}

/* ---------------------------------------------------------------- server */

function readBody(req, limit) {
  return new Promise(function (resolve) {
    let body = "";
    req.on("data", function (c) { body += c; if (body.length > limit) req.destroy(); });
    req.on("end", function () { resolve(body); });
  });
}

function createServer(o) {
  o = o || {};
  const cfg = o.cfg || {};
  const provider = o.provider;
  const siteDir = o.siteDir || process.cwd();

  const health = {
    provider: cfg.provider || "?",
    stage: "probing",
    detail: "",
    model: "",
    port: 0,
    configPath: cfgmod.configPath(),
    probe: async function () {
      try {
        const r = await provider.check();
        health.stage = r.ok ? "ok" : "fail";
        health.detail = r.detail || "";
        health.model = r.model || "";
      } catch (e) {
        health.stage = "fail";
        health.detail = e.userMessage || e.message || "falló el chequeo";
      }
      return health;
    }
  };

  const server = http.createServer(async function (req, res) {
    if (req.method === "GET" && req.url.split("?")[0] === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        provider: health.provider, stage: health.stage, detail: health.detail,
        model: health.model, port: health.port, configPath: health.configPath
      }));
    }

    if (req.method === "POST" && req.url === "/api/ask") {
      const body = await readBody(req, 1e6);
      let msg = "", sid = null, model = "", extraDirs = [], page = "/";
      try {
        const j = JSON.parse(body);
        msg = (j.message || "").toString();
        sid = j.sessionId || null;
        model = (j.model || "").toString();
        extraDirs = Array.isArray(j.extraDirs) ? j.extraDirs : [];
        page = (j.page || "/").toString();
      } catch (e) {}
      if (!msg.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "mensaje vacío" }));
      }
      try {
        const r = await provider.ask({ message: msg, sessionId: sid, model: model,
                                       extraDirs: extraDirs, page: page });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(r));
      } catch (e) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.userMessage || e.message || "error desconocido" }));
      }
      return;
    }

    if (req.method === "POST" && req.url === "/api/open") {
      const body = await readBody(req, 1e5);
      let target = "RAW";
      try { target = JSON.parse(body).target || "RAW"; } catch (e) {}
      return openFolder(siteDir, target, function (r) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(r));
      });
    }

    serveStatic(siteDir, req, res);
  });

  function listenWithRetry(startPort) {
    let attempt = 0;
    const first = typeof startPort === "number" ? startPort : (cfg.port || 8770);
    return new Promise(function (resolve, reject) {
      function tryPort(p) {
        function onError(err) {
          if (err && err.code === "EADDRINUSE" && attempt < PORT_RETRIES && p !== 0) {
            attempt++;
            console.log("  (puerto " + p + " ocupado, probando " + (p + 1) + ")");
            server.removeListener("error", onError);
            setImmediate(function () { tryPort(p + 1); });
            return;
          }
          server.removeListener("error", onError);
          reject(err);
        }
        server.once("error", onError);
        server.listen(p, "127.0.0.1", function () {
          server.removeListener("error", onError);
          health.port = server.address().port;
          resolve(health.port);
        });
      }
      tryPort(first);
    });
  }

  return { server: server, health: health, listenWithRetry: listenWithRetry };
}

/* ------------------------------------------------------------------ main */

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" && argv[i + 1]) { const n = parseInt(argv[++i], 10); if (!isNaN(n)) flags.port = n; }
    else if (a.startsWith("--port=")) { const n = parseInt(a.slice(7), 10); if (!isNaN(n)) flags.port = n; }
    else if (a === "--no-open") flags.noOpen = true;
    else if (a === "--reconfigure") flags.reconfigure = true;
  }
  return flags;
}

function buildProvider(cfg, siteDir) {
  const mod = cfg.provider === "api"
    ? require("./lib/providers/api.js")
    : require("./lib/providers/cli.js");
  return mod.create(cfg, { siteDir: siteDir, tutorName: cfg.tutorName || "Tutor", env: process.env });
}

async function main() {
  const siteDir = __dirname;
  const flags = parseFlags(process.argv.slice(2));

  let cfg = cfgmod.load({ siteDir: siteDir, flags: flags }).cfg;
  if (flags.reconfigure || cfgmod.needsSetup(cfg)) {
    await cfgmod.runWizard({ siteDir: siteDir, flags: flags });
    cfg = cfgmod.load({ siteDir: siteDir, flags: flags }).cfg;
  }

  // resolvemos el binario una vez y lo cacheamos: así no dependemos del PATH
  // del proceso que nos lanzó (que en Windows suele estar viejo)
  if (cfg.provider === "cli" && !(cfg.cli && cfg.cli.bin)) {
    const resolved = require("./lib/providers/cli.js").resolveBin(cfg);
    if (resolved) {
      cfg.cli = Object.assign({}, cfg.cli, { bin: resolved });
      cfgmod.patchHome({ cli: { bin: resolved } });
    }
  }

  const provider = buildProvider(cfg, siteDir);

  // chequeo rápido: si esto falla, no tiene sentido levantar nada
  const fast = await provider.checkFast();
  if (!fast.ok) {
    console.log("");
    console.log("  ❌ El tutor no puede arrancar:");
    console.log("     " + fast.detail);
    console.log("");
    console.log("     Config: " + cfgmod.configPath());
    console.log("     Reconfigurar: node chat-server.js --reconfigure");
    console.log("");
    process.exit(1);
  }

  const h = createServer({ cfg: cfg, provider: provider, siteDir: siteDir });
  let port;
  try {
    port = await h.listenWithRetry(cfg.port);
  } catch (e) {
    console.log("");
    console.log("  ❌ No pude abrir ningún puerto entre " + cfg.port + " y " + (cfg.port + PORT_RETRIES) + ".");
    console.log("     Probá:  node chat-server.js --port 9100");
    console.log("");
    process.exit(1);
  }

  const url = "http://localhost:" + port;

  // el chequeo profundo (¿está logueado? ¿la key sirve?) corre de fondo
  h.health.probe().then(function (st) {
    if (st.stage === "fail") {
      console.log("");
      console.log("  ⚠️  El chat no va a responder: " + st.detail);
      console.log("     El sitio igual se ve en " + url);
      console.log("");
    }
  });

  const label = cfg.provider === "api" ? "API" : "CLI";
  console.log("");
  console.log("  ✅ Tutor listo · " + label + " · " + (cfg.models && cfg.models[cfg.models.default] || ""));
  console.log("");
  console.log("     👉  " + url);
  console.log("");
  console.log("  (Ctrl+C para salir · config: " + cfgmod.configPath() + ")");
  console.log("");

  if (cfg.openBrowser) openBrowser(url);
}

if (require.main === module) {
  main().catch(function (e) {
    console.error("");
    console.error("  ❌ " + (e && (e.userMessage || e.message) || e));
    console.error("");
    process.exit(1);
  });
}

module.exports = { createServer, parseFlags, serveStatic, openFolder };
