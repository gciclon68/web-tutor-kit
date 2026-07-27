/* =====================================================================
   Provider CLI · habla con el `claude` ya logueado (tu suscripción).

   El CLI lee los archivos del sitio solo (Read/Grep/Glob), así que acá NO
   hace falta juntar contexto: alcanza con correr en la carpeta del sitio.
   ===================================================================== */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const IS_WIN = process.platform === "win32";
const TIMEOUT_MS = 180000;

function preamble(tutorName) {
  return 'Actuás como "' + tutorName + '", un asistente integrado en un sitio local de estudio/referencia.\n' +
"El material vive en esta carpeta: leé CONTEXTO.md (si existe) y los archivos .html para tener el contexto exacto de lo que el usuario está mirando. Respondé en el mismo idioma que use la persona, claro y conciso.\n" +
"\n" +
"FORMATO DE RESPUESTA: el panel renderiza Markdown (GitHub-flavored) y LaTeX vía MathJax. Aprovechalo:\n" +
"- Markdown: encabezados, **negrita**, listas, código, y TABLAS con | pipes | cuando compares o resumas.\n" +
"- LaTeX para la matemática: inline $...$ y display $$...$$. Matrices reales con \\begin{bmatrix}...\\end{bmatrix} (nunca [[...]] en texto plano).\n" +
"- Usá algún emoji con moderación para dar tono/claridad (✅ ⚠️ 📌 🔑), sin abusar.\n" +
"\n" +
'TRANSPARENCIA DE CONTEXTO: cuando uses información de un archivo o página específica, avisalo brevemente (ej.: "📖 según CONTEXTO.md…" o "📄 mirando pagina-X.html…"). Si algo no está en el material, decilo en vez de inventar.\n' +
"MATERIAL EXTRA: el usuario puede dejar archivos en la carpeta RAW/ (dentro de esta carpeta). Si RAW/ tiene archivos relevantes para la consulta, leelos y mencioná que los usaste.\n" +
"\n" +
"A continuación viene la consulta del usuario:\n";
}

const HINT = "\n\n[Formato: respondé en Markdown; usá LaTeX para la matemática ($...$ y $$...$$) y matrices reales con \\begin{bmatrix}...\\end{bmatrix} (nunca [[...]]); algún emoji con moderación.]";

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch (e) { return false; }
}

/* Busca el binario una sola vez; el resultado se cachea en cfg.cli.bin para
   no depender del PATH del proceso que nos lanzó (que puede estar viejo). */
function resolveBin(cfg) {
  const configured = cfg && cfg.cli && cfg.cli.bin;
  if (exists(configured)) return configured;

  try {
    const out = execFileSync(IS_WIN ? "where" : "which", ["claude"],
                             { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const first = String(out).split(/\r?\n/).map(function (s) { return s.trim(); })
                             .filter(Boolean)[0];
    if (exists(first)) return first;
  } catch (e) { /* seguimos con los candidatos */ }

  const home = os.homedir();
  const candidates = IS_WIN
    ? [path.join(process.env.LOCALAPPDATA || "", "Programs", "claude", "claude.exe"),
       path.join(home, ".local", "bin", "claude.exe"),
       path.join(home, ".claude", "local", "claude.exe")]
    : [path.join(home, ".local", "bin", "claude"),
       path.join(home, ".claude", "local", "claude"),
       "/usr/local/bin/claude", "/opt/homebrew/bin/claude"];
  for (let i = 0; i < candidates.length; i++) if (exists(candidates[i])) return candidates[i];
  return null;
}

function quoted(s) { return '"' + String(s).replace(/"/g, "") + '"'; }

/* En Windows el `claude` suele ser un .cmd, así que hace falta shell. Pasamos
   UN string ya armado en vez de (cmd, args[]): con shell:true y un array Node
   avisa DEP0190 porque no escapa los argumentos. Acá los escapamos nosotros. */
function winCommand(bin, args) {
  return [quoted(bin)].concat(args.map(function (a) {
    return /[\s"&|<>^()]/.test(String(a)) ? quoted(a) : String(a);
  })).join(" ");
}

function run(bin, args, stdinPayload, timeoutMs, cwd) {
  return new Promise(function (resolve, reject) {
    let child;
    try {
      child = IS_WIN
        ? spawn(winCommand(bin, args), [], { cwd: cwd, shell: true, windowsHide: true,
                                             stdio: ["pipe", "pipe", "pipe"] })
        : spawn(bin, args, { cwd: cwd, stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      const e = new Error(err.message);
      e.userMessage = "No pude ejecutar `claude` (" + err.message + "). ¿Está instalado?";
      return reject(e);
    }
    let out = "", errOut = "", done = false;
    const killer = setTimeout(function () {
      done = true;
      try { child.kill(); } catch (_) {}
      const e = new Error("timeout");
      e.userMessage = "El CLI no respondió en " + Math.round((timeoutMs || TIMEOUT_MS) / 1000) + "s.";
      reject(e);
    }, timeoutMs || TIMEOUT_MS);

    child.on("error", function (err) {
      if (done) return; done = true; clearTimeout(killer);
      const e = new Error(err.message);
      e.userMessage = "No pude ejecutar `claude` (" + err.message +
                      "). Verificá que el CLI esté instalado y logueado.";
      reject(e);
    });
    child.stdout.on("data", function (d) { out += d; });
    child.stderr.on("data", function (d) { errOut += d; });
    child.on("close", function (code) {
      if (done) return; done = true; clearTimeout(killer);
      resolve({ code: code, out: out, err: errOut });
    });
    if (stdinPayload !== null && stdinPayload !== undefined) {
      try { child.stdin.write(stdinPayload); } catch (e) {}
    }
    try { child.stdin.end(); } catch (e) {}
  });
}

function looksLikeAuthError(text) {
  return /log ?in|login|autenticac|authenticat|unauthorized|not logged|credential|api key/i.test(String(text || ""));
}

function create(cfg, o) {
  o = o || {};
  const siteDir = o.siteDir || process.cwd();
  const tutorName = o.tutorName || (cfg && cfg.tutorName) || "Tutor";
  const bin = (cfg && cfg.cli && cfg.cli.bin) || "claude";

  function spawnIn(args, payload, timeoutMs) {
    return run(bin, args, payload, timeoutMs, siteDir);
  }

  async function ask(req) {
    req = req || {};
    const args = ["-p", "--output-format", "json", "--allowedTools", "Read,Grep,Glob"];
    if (req.model) args.push("--model", req.model);
    if (Array.isArray(req.extraDirs)) {
      req.extraDirs.forEach(function (d) {
        try { if (d && fs.existsSync(d)) args.push("--add-dir", d); } catch (e) {}
      });
    }
    if (req.sessionId) args.push("--resume", req.sessionId);

    const payload = (req.sessionId ? req.message : (preamble(tutorName) + req.message)) + HINT;
    const r = await spawnIn(args, payload);

    if (r.code !== 0) {
      const e = new Error("cli exit " + r.code);
      e.userMessage = looksLikeAuthError(r.err)
        ? "El CLI `claude` está instalado pero no logueado. Corré `claude` una vez y hacé login."
        : "El CLI devolvió código " + r.code + (r.err ? (": " + r.err.trim().slice(0, 400)) : "");
      throw e;
    }
    let reply = "", sid = req.sessionId || null;
    try {
      const j = JSON.parse(r.out);
      reply = (typeof j.result === "string") ? j.result : (j.text || JSON.stringify(j));
      sid = j.session_id || j.sessionId || sid;
    } catch (e) {
      reply = r.out.trim() || "(sin salida del CLI)";
    }
    return { reply: reply, sessionId: sid, reset: false };
  }

  async function checkFast() {
    if (!exists(bin) && bin !== "claude") {
      return { ok: false, detail: "No encontré el CLI `claude` en " + bin +
                                  ". Instalalo, o corré `node chat-server.js --reconfigure`." };
    }
    try {
      const r = await spawnIn(["--version"], null, 20000);
      if (r.code !== 0) {
        return { ok: false, detail: "`claude --version` falló: " + (r.err || "").trim().slice(0, 200) };
      }
      return { ok: true, detail: (r.out || "").trim() };
    } catch (e) {
      return { ok: false, detail: e.userMessage ||
        "No encontré el CLI `claude`. Instalalo, o corré `node chat-server.js --reconfigure`." };
    }
  }

  async function check() {
    const fast = await checkFast();
    if (!fast.ok) return { ok: false, detail: fast.detail, model: "" };
    try {
      await ask({ message: "ping", sessionId: null, model: "", extraDirs: [], page: "/" });
      const models = (cfg && cfg.models) || {};
      return { ok: true, detail: "El CLI responde.", model: models[models.default] || models.default || "" };
    } catch (e) {
      return { ok: false, detail: e.userMessage || e.message, model: "" };
    }
  }

  return { ask: ask, check: check, checkFast: checkFast };
}

module.exports = { create, resolveBin };
