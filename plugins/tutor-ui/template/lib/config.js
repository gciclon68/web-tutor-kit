/* =====================================================================
   Config del Tutor · resolución por capas + wizard de primera vez.

   Orden de precedencia (gana el primero):
     1. flags de línea de comandos   (--port, --no-open)
     2. variables de entorno         (TUTOR_PROVIDER, ANTHROPIC_API_KEY,
                                      ANTHROPIC_BASE_URL, PORT, TUTOR_NAME)
     3. <sitio>/tutor.config.json    (override por sitio)
     4. ~/.tutor-ui/config.json      (la config por máquina)
     5. defaults

   La API key, si se persiste, va SOLO al archivo del home con modo 0600.
   ===================================================================== */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULTS = {
  version: 1,
  provider: null,                 // "cli" | "api"
  tutorName: "Tutor",
  cli: { bin: null },
  api: { baseUrl: "https://api.anthropic.com", keyEnv: "ANTHROPIC_API_KEY", key: null },
  models: {
    opus: "claude-opus-5",
    sonnet: "claude-sonnet-5",
    haiku: "claude-haiku-4-5-20251001",
    default: "sonnet"
  },
  port: 8770,
  openBrowser: true
};

const NESTED = ["cli", "api", "models"];

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// merge superficial con un nivel de anidado para cli/api/models
function mergeInto(base, patch) {
  if (!patch || typeof patch !== "object") return base;
  Object.keys(patch).forEach(function (k) {
    const v = patch[k];
    if (v === undefined || v === null) return;
    if (NESTED.indexOf(k) >= 0 && typeof v === "object") {
      base[k] = Object.assign({}, base[k] || {}, v);
    } else {
      base[k] = v;
    }
  });
  return base;
}

function fromEnv(env) {
  env = env || {};
  const p = {};
  if (env.TUTOR_PROVIDER) p.provider = env.TUTOR_PROVIDER;
  if (env.TUTOR_NAME) p.tutorName = env.TUTOR_NAME;
  if (env.ANTHROPIC_BASE_URL) p.api = Object.assign(p.api || {}, { baseUrl: env.ANTHROPIC_BASE_URL });
  if (env.ANTHROPIC_API_KEY) p.api = Object.assign(p.api || {}, { key: env.ANTHROPIC_API_KEY });
  if (env.PORT) { const n = parseInt(env.PORT, 10); if (!isNaN(n)) p.port = n; }
  return p;
}

function fromFlags(flags) {
  flags = flags || {};
  const p = {};
  if (typeof flags.port === "number" && !isNaN(flags.port)) p.port = flags.port;
  if (flags.noOpen) p.openBrowser = false;
  return p;
}

function resolve(o) {
  o = o || {};
  const cfg = clone(DEFAULTS);
  mergeInto(cfg, o.homeCfg);
  mergeInto(cfg, o.siteCfg);
  mergeInto(cfg, fromEnv(o.env));
  mergeInto(cfg, fromFlags(o.flags));
  return cfg;
}

function configPath() {
  return path.join(os.homedir(), ".tutor-ui", "config.json");
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; }
}

function save(cfg, targetPath) {
  const p = targetPath || configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch (e) { /* no-op en Windows */ }
  return p;
}

function load(o) {
  o = o || {};
  const siteDir = o.siteDir || process.cwd();
  const homeCfg = readJSON(configPath());
  const siteCfg = readJSON(path.join(siteDir, "tutor.config.json"));
  const cfg = resolve({
    env: o.env || process.env,
    flags: o.flags || {},
    siteCfg: siteCfg,
    homeCfg: homeCfg
  });
  return {
    cfg: cfg,
    sources: {
      home: homeCfg ? configPath() : null,
      site: siteCfg ? path.join(siteDir, "tutor.config.json") : null
    }
  };
}

function needsSetup(cfg) {
  return !cfg || !cfg.provider;
}

/* Actualiza SOLO unos campos del config del home, sin arrastrar valores que
   vinieron del entorno o de flags (p.ej. una API key que no queremos en disco). */
function patchHome(patch) {
  const p = configPath();
  const current = readJSON(p) || {};
  mergeInto(current, patch);
  try { return save(current, p); } catch (e) { return null; }
}

function apiKeyOf(cfg, env) {
  env = env || process.env;
  const api = (cfg && cfg.api) || {};
  if (api.keyEnv && env[api.keyEnv]) return env[api.keyEnv];
  return api.key || null;
}

/* ---------------------------------------------------------------- wizard */

function ask(rl, question, fallback) {
  return rl.question(question).then(function (a) {
    a = String(a || "").trim();
    return a || fallback || "";
  });
}

async function runWizard(o) {
  o = o || {};
  const readline = require("readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const cfg = resolve({ env: o.env || process.env, flags: o.flags || {}, siteCfg: null,
                        homeCfg: readJSON(configPath()) });

  const out = console.log;
  out("");
  out("  ──────────────────────────────────────────────");
  out("   Configuración del Tutor (primera vez)");
  out("  ──────────────────────────────────────────────");
  out("");
  out("   ¿Cómo hablo con Claude?");
  out("     1) CLI `claude` ya logueado  (tu suscripción, sin API key)   [recomendado]");
  out("     2) API key de Anthropic      (se cobra por mensaje)");
  out("");

  const choice = await ask(rl, "   Opción [1]: ", "1");
  let provider;

  if (choice === "2") {
    provider = "api";
    cfg.provider = "api";
    const base = await ask(rl, "   Base URL [" + cfg.api.baseUrl + "]: ", cfg.api.baseUrl);
    cfg.api.baseUrl = base;

    const envName = cfg.api.keyEnv || "ANTHROPIC_API_KEY";
    const hasEnv = !!(process.env[envName]);
    out("");
    if (hasEnv) {
      out("   ✅ Encontré la variable de entorno " + envName + " — la voy a usar.");
      out("      (no guardo la key en disco)");
      cfg.api.key = null;
    } else {
      out("   No encontré la variable de entorno " + envName + ".");
      const paste = await ask(rl, "   Pegá la API key (Enter para dejarlo en la variable de entorno): ", "");
      if (paste) {
        cfg.api.key = paste;
        out("");
        out("   ⚠️  La key queda guardada en " + configPath() + " (permisos 0600).");
        out("      Si preferís no tenerla en disco, borrá el campo `api.key` y seteá " + envName + ".");
      } else {
        cfg.api.key = null;
        out("   Dejo la key en la variable de entorno " + envName + " — seteala antes de arrancar.");
      }
    }
  } else {
    provider = "cli";
    cfg.provider = "cli";
    out("");
    process.stdout.write("   Buscando `claude`... ");
    const cliProvider = require("./providers/cli.js");
    const bin = cliProvider.resolveBin(cfg);
    if (bin) { cfg.cli.bin = bin; out("✅ " + bin); }
    else { out("❌ no lo encontré en el PATH ni en las rutas conocidas."); }
  }

  out("");
  const portAns = await ask(rl, "   Puerto [" + cfg.port + "]: ", String(cfg.port));
  const portNum = parseInt(portAns, 10);
  if (!isNaN(portNum)) cfg.port = portNum;

  const openAns = await ask(rl, "   ¿Abrir el navegador solo? [S/n]: ", "s");
  cfg.openBrowser = !/^n/i.test(openAns);

  rl.close();

  // probamos antes de guardar, pero guardamos igual: nunca te vuelve a preguntar
  out("");
  process.stdout.write("   Probando la conexión... ");
  try {
    const mod = provider === "api" ? require("./providers/api.js") : require("./providers/cli.js");
    const p = mod.create(cfg, { siteDir: o.siteDir || process.cwd(), tutorName: cfg.tutorName,
                                env: o.env || process.env });
    const r = await p.check();
    out(r.ok ? ("✅ " + (r.model || "ok")) : ("❌ " + r.detail));
  } catch (e) {
    out("❌ " + e.message);
  }

  const saved = save(cfg);
  out("");
  out("   ✅ Guardado en " + saved);
  out("      (editalo, o corré con --reconfigure para volver a empezar)");
  out("");
  return cfg;
}

module.exports = { DEFAULTS, resolve, load, save, patchHome, configPath, needsSetup, apiKeyOf, runWizard };
