/* =====================================================================
   Tutor bridge · sirve el sitio y conecta el panel de chat con el CLI `claude`.

   Uso:
     node chat-server.js
   Luego abrí:  http://localhost:8770

   - Corre en ESTA carpeta (subcarpeta del proyecto), así `claude` lee
     CONTEXTO.md y los .html directamente.
   - Usa tu CLI `claude` ya logueado → misma suscripción, sin API key.
   - El mensaje del usuario viaja por STDIN (evita problemas de comillas en Windows).
   ===================================================================== */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = 8770;
const SITE = __dirname;                       // carpeta espacio-estados
const IS_WIN = process.platform === "win32";

const MIME = { ".html":"text/html; charset=utf-8", ".css":"text/css", ".js":"text/javascript",
               ".md":"text/markdown; charset=utf-8", ".json":"application/json", ".svg":"image/svg+xml" };

// Contexto que se antepone SOLO en el primer turno (después queda en la sesión de claude).
const PREAMBLE =
`Actuás como "Tutor Claude Code", integrado en un sitio de estudio local sobre matriz fundamental (Ψ) y matriz de transición de estados (Φ) en sistemas lineales, con foco en el paso LTI→LTV y el Ejercicio 3, sistema masa-resorte-amortiguador. Respondé SIEMPRE en español, claro, conciso y orientado a examen. Podés leer los archivos de esta carpeta (CONTEXTO.md, 1-conceptual.html, 2-fundamental.html, 3-transicion.html) si necesitás detalle.

FORMATO DE RESPUESTA: el panel renderiza Markdown (GitHub-flavored) y LaTeX vía MathJax. Aprovechalo bien:
- Markdown: encabezados, **negrita**, listas, código, y TABLAS con | pipes | cuando compares casos o resumas.
- LaTeX para TODA la matemática: inline con $...$ y display con $$...$$. Las MATRICES en formato matriz real con bmatrix, por ejemplo: $$\\Phi(t,0)=\\begin{bmatrix} e^{2t} & \\frac{e^{2t}-1}{2} \\\\ 0 & e^{t} \\end{bmatrix}$$. NUNCA escribas matrices como [[...],[...]] en texto plano.
- Usá algún emoji con moderación para dar tono/claridad (✅ ⚠️ 📌 🔑 🎯), sin abusar.

Datos verificados del material (usalos como fuente de verdad):
- Masa-resorte LTI: A=[[0,1],[-k/m,-c/m]]; autovalores λ=(T±√(T²−4D))/2 con T=−c/m, D=k/m.
- Ejercicio 3 (LTV): A(t)=[[2, e^(−t)],[0,1]] (triangular). Ψ(t)=[[e^(2t), −1/2],[0, e^t]], Wronskiano=e^(3t).
- Φ(t,0)=[[e^(2t), (e^(2t)−1)/2],[0, e^t]]; cumple Φ(0)=I y Φ'=AΦ.
- PVI x(0)=[0,1]ᵀ → x(t)=[(e^(2t)−1)/2, e^t]ᵀ.
- e^(∫A) FALLA acá porque A no conmuta en tiempos distintos: [A(t1),A(t2)]₁₂ = e^(−t2) − e^(−t1) ≠ 0. Método general: serie de Peano–Baker.

TRANSPARENCIA DE CONTEXTO: cuando uses información de un archivo o página específica, avisalo brevemente al pasar (ej.: "📖 según CONTEXTO.md…" o "📄 mirando 3-transicion.html…"). Si algo no está en el material, decilo en vez de inventar.
MATERIAL EXTRA: el usuario puede dejar archivos en la carpeta RAW/ (dentro de esta carpeta). Antes de responder, si RAW/ tiene archivos relevantes, leelos y mencioná que los usaste.

A continuación viene la consulta del estudiante:
`;

// ---------- static file serving ----------
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

// ---------- claude bridge ----------
function q(s){ return IS_WIN ? ('"' + String(s).replace(/"/g, "") + '"') : s; }  // rutas con espacios en shell:true

function askClaude(message, sessionId, opts, cb){
  opts = opts || {};
  const args = ["-p", "--output-format", "json", "--allowedTools", "Read,Grep,Glob"];
  if (opts.model) args.push("--model", opts.model);
  if (Array.isArray(opts.extraDirs)) {
    opts.extraDirs.forEach(function(d){ try { if (d && fs.existsSync(d)) args.push("--add-dir", q(d)); } catch(e){} });
  }
  if (sessionId) args.push("--resume", sessionId);   // continuar la conversación

  let child;
  try {
    child = spawn("claude", args, { cwd: SITE, shell: IS_WIN, stdio: ["pipe","pipe","pipe"] });
  } catch (err) {
    return cb({ error: "No pude ejecutar `claude`. ¿Está instalado y en el PATH? (" + err.message + ")" });
  }

  let out = "", err = "";
  const killer = setTimeout(() => { try { child.kill(); } catch(_){} }, 180000);

  child.on("error", (e) => {
    clearTimeout(killer);
    cb({ error: "No pude ejecutar `claude` (" + e.message + "). Verificá que el CLI de Claude Code esté instalado y logueado." });
  });
  child.stdout.on("data", d => out += d);
  child.stderr.on("data", d => err += d);
  child.on("close", (code) => {
    clearTimeout(killer);
    if (code !== 0) {
      return cb({ error: "El CLI devolvió código " + code + (err ? (": " + err.trim().slice(0,400)) : "") });
    }
    let reply = "", sid = sessionId || null;
    try {
      const j = JSON.parse(out);
      reply = (typeof j.result === "string") ? j.result : (j.text || JSON.stringify(j));
      sid = j.session_id || j.sessionId || sid;
    } catch (e) {
      reply = out.trim() || "(sin salida del CLI)";
    }
    cb({ reply: reply, sessionId: sid });
  });

  // el mensaje va por stdin. Primer turno: contexto completo. Cada turno (incluido
  // resume): recordatorio de formato, para que SIEMPRE renderice Markdown+LaTeX.
  const HINT = "\n\n[Formato: respondé en Markdown; usá LaTeX para la matemática ($...$ inline, $$...$$ display) y matrices reales con \\begin{bmatrix}...\\end{bmatrix} (nunca [[...]]); algún emoji con moderación.]";
  const payload = (sessionId ? message : (PREAMBLE + message)) + HINT;
  child.stdin.write(payload);
  child.stdin.end();
}

// ---------- routing ----------
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
      askClaude(msg, sid, { model: model, extraDirs: extraDirs }, (result) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      });
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
  console.log("\n  Tutor bridge activo.");
  console.log("  Abrí:  http://localhost:" + PORT + "\n");
  console.log("  (usa tu CLI `claude` logueado · misma suscripción · Ctrl+C para salir)\n");
});
