/* =====================================================================
   Tutor bridge (genérico) · sirve el sitio y conecta el panel de chat
   con el CLI `claude` ya logueado (misma suscripción, sin API key).

   Uso:
     node chat-server.js
   Luego abrí:  http://localhost:8770

   - Corre en ESTA carpeta, así `claude` lee CONTEXTO.md y los .html directamente.
   - El mensaje del usuario viaja por STDIN (evita problemas de comillas en Windows).
   - Configurable con variables de entorno:  PORT, TUTOR_NAME.
   ===================================================================== */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = parseInt(process.env.PORT, 10) || 8770;
const TUTOR_NAME = process.env.TUTOR_NAME || "Tutor";
const SITE = __dirname;
const IS_WIN = process.platform === "win32";

const MIME = { ".html":"text/html; charset=utf-8", ".css":"text/css", ".js":"text/javascript",
               ".md":"text/markdown; charset=utf-8", ".json":"application/json", ".svg":"image/svg+xml",
               ".png":"image/png", ".jpg":"image/jpeg", ".woff2":"font/woff2" };

// Contexto que se antepone SOLO en el primer turno (después queda en la sesión de claude).
const PREAMBLE =
`Actuás como "${TUTOR_NAME}", un asistente integrado en un sitio local de estudio/referencia.
El material vive en esta carpeta: leé CONTEXTO.md (si existe) y los archivos .html para tener el contexto exacto de lo que el usuario está mirando. Respondé en el mismo idioma que use la persona, claro y conciso.

FORMATO DE RESPUESTA: el panel renderiza Markdown (GitHub-flavored) y LaTeX vía MathJax. Aprovechalo:
- Markdown: encabezados, **negrita**, listas, código, y TABLAS con | pipes | cuando compares o resumas.
- LaTeX para la matemática: inline $...$ y display $$...$$. Matrices reales con \\begin{bmatrix}...\\end{bmatrix} (nunca [[...]] en texto plano).
- Usá algún emoji con moderación para dar tono/claridad (✅ ⚠️ 📌 🔑), sin abusar.

TRANSPARENCIA DE CONTEXTO: cuando uses información de un archivo o página específica, avisalo brevemente (ej.: "📖 según CONTEXTO.md…" o "📄 mirando pagina-X.html…"). Si algo no está en el material, decilo en vez de inventar.
MATERIAL EXTRA: el usuario puede dejar archivos en la carpeta RAW/ (dentro de esta carpeta). Si RAW/ tiene archivos relevantes para la consulta, leelos y mencioná que los usaste.

A continuación viene la consulta del usuario:
`;

function serveStatic(req, res){
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const fp = path.join(SITE, path.normalize(p).replace(/^(\.\.[\/\\])+/, ""));
  if (!fp.startsWith(SITE)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(fp, (e, data) => {
    if (e) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
    res.end(data);
  });
}

function q(s){ return IS_WIN ? ('"' + String(s).replace(/"/g, "") + '"') : s; }  // rutas con espacios en shell:true

function askClaude(message, sessionId, opts, cb){
  opts = opts || {};
  const args = ["-p", "--output-format", "json", "--allowedTools", "Read,Grep,Glob"];
  if (opts.model) args.push("--model", opts.model);
  if (Array.isArray(opts.extraDirs)) {
    opts.extraDirs.forEach(function(d){ try { if (d && fs.existsSync(d)) args.push("--add-dir", q(d)); } catch(e){} });
  }
  if (sessionId) args.push("--resume", sessionId);

  let child;
  try { child = spawn("claude", args, { cwd: SITE, shell: IS_WIN, stdio: ["pipe","pipe","pipe"] }); }
  catch (err) { return cb({ error: "No pude ejecutar `claude`. ¿Está instalado y en el PATH? (" + err.message + ")" }); }

  let out = "", err = "";
  const killer = setTimeout(() => { try { child.kill(); } catch(_){} }, 180000);
  child.on("error", (e) => { clearTimeout(killer);
    cb({ error: "No pude ejecutar `claude` (" + e.message + "). Verificá que el CLI de Claude Code esté instalado y logueado." }); });
  child.stdout.on("data", d => out += d);
  child.stderr.on("data", d => err += d);
  child.on("close", (code) => {
    clearTimeout(killer);
    if (code !== 0) return cb({ error: "El CLI devolvió código " + code + (err ? (": " + err.trim().slice(0,400)) : "") });
    let reply = "", sid = sessionId || null;
    try { const j = JSON.parse(out); reply = (typeof j.result === "string") ? j.result : (j.text || JSON.stringify(j)); sid = j.session_id || j.sessionId || sid; }
    catch (e) { reply = out.trim() || "(sin salida del CLI)"; }
    cb({ reply: reply, sessionId: sid });
  });

  // primer turno: contexto completo. Cada turno: recordatorio de formato.
  const HINT = "\n\n[Formato: respondé en Markdown; usá LaTeX para la matemática ($...$ y $$...$$) y matrices reales con \\begin{bmatrix}...\\end{bmatrix} (nunca [[...]]); algún emoji con moderación.]";
  const payload = (sessionId ? message : (PREAMBLE + message)) + HINT;
  child.stdin.write(payload);
  child.stdin.end();
}

// abrir una carpeta (dentro del sitio) en el explorador del SO
function openFolder(target, cb){
  const safe = path.normalize(String(target || "")).replace(/^(\.\.[\/\\])+/, "");
  const dir = path.join(SITE, safe);
  if (!dir.startsWith(SITE)) return cb({ error: "ruta no permitida" });
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch(e){}
  let cmd = "xdg-open";
  if (IS_WIN) cmd = "explorer.exe"; else if (process.platform === "darwin") cmd = "open";
  try {
    const c = spawn(cmd, [dir], { detached: true, stdio: "ignore" });
    c.on("error", function(e){ cb({ error: e.message }); });
    if (c.unref) c.unref();
    cb({ ok: true, dir: dir });
  } catch (e) { cb({ error: e.message }); }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/ask") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => {
      let msg = "", sid = null, model = "", extraDirs = [];
      try { const j = JSON.parse(body); msg = (j.message||"").toString(); sid = j.sessionId || null;
            model = (j.model||"").toString(); extraDirs = Array.isArray(j.extraDirs) ? j.extraDirs : []; } catch(e){}
      if (!msg.trim()) { res.writeHead(400,{ "Content-Type":"application/json" }); return res.end(JSON.stringify({ error:"mensaje vacío" })); }
      askClaude(msg, sid, { model: model, extraDirs: extraDirs }, (result) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(result)); });
    });
    return;
  }
  if (req.method === "POST" && req.url === "/api/open") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => {
      let target = "RAW";
      try { target = JSON.parse(body).target || "RAW"; } catch(e){}
      openFolder(target, (r) => { res.writeHead(200, { "Content-Type":"application/json" }); res.end(JSON.stringify(r)); });
    });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("\n  " + TUTOR_NAME + " bridge activo.");
  console.log("  Abrí:  http://localhost:" + PORT + "\n");
  console.log("  (usa tu CLI `claude` logueado · misma suscripción · Ctrl+C para salir)\n");
});
