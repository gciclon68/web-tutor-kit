/* =====================================================================
   Contexto del sitio para el modo API.

   En modo CLI el `claude` lee los archivos solo (Read/Grep/Glob). En modo
   API no hay herramientas, así que el bridge junta el contexto acá y lo
   manda como system prompt. Cada fuente tiene su tope y el total también.
   ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

const CAPS = { contexto: 20480, page: 15360, raw: 20480, extra: 5120, total: 61440 };

const TEXTY = [".md", ".txt", ".tex", ".csv", ".json", ".html", ".rst"];
const RAW_HEAD = 2048;

const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'",
  "&nbsp;": " ", "&aacute;": "á", "&eacute;": "é", "&iacute;": "í", "&oacute;": "ó",
  "&uacute;": "ú", "&ntilde;": "ñ", "&Aacute;": "Á", "&Eacute;": "É", "&Iacute;": "Í",
  "&Oacute;": "Ó", "&Uacute;": "Ú", "&Ntilde;": "Ñ", "&uuml;": "ü", "&hellip;": "…",
  "&mdash;": "—", "&ndash;": "–", "&deg;": "°"
};

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&[a-zA-Z]+[0-9]*;/g, function (m) { return ENTITIES[m] !== undefined ? ENTITIES[m] : m; });
}

function htmlToText(html) {
  let s = String(html || "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|article|section)\s*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t ]+/g, " ");
  s = s.replace(/\n\s*\n\s*\n+/g, "\n\n");
  return s.trim();
}

// recorta y avisa
function cap(text, limit, label, truncated) {
  if (text.length <= limit) return text;
  truncated.push(label + " truncado a " + Math.round(limit / 1024) + " KB");
  return text.slice(0, limit) + "\n…(truncado)";
}

// resuelve una ruta del sitio sin dejar escapar del directorio
function safeJoin(siteDir, rel) {
  const clean = path.normalize(String(rel || "")).replace(/^([\\/]|\.\.[\\/])+/, "");
  const fp = path.resolve(siteDir, clean);
  const root = path.resolve(siteDir);
  if (fp !== root && !fp.startsWith(root + path.sep)) return null;
  return fp;
}

function readIfExists(fp) {
  try {
    if (!fp || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) return null;
    return fs.readFileSync(fp, "utf8");
  } catch (e) { return null; }
}

function gather(o) {
  o = o || {};
  const siteDir = o.siteDir || process.cwd();
  const truncated = [];
  const parts = [];

  // 1. CONTEXTO.md
  const ctxRaw = readIfExists(path.join(siteDir, "CONTEXTO.md"));
  if (ctxRaw) {
    parts.push("## CONTEXTO.md\n\n" + cap(ctxRaw, CAPS.contexto, "CONTEXTO.md", truncated));
  }

  // 2. página actual
  let pageRel = String(o.page || "/").split("?")[0];
  if (pageRel === "/" || pageRel === "") pageRel = "index.html";
  const pageFp = safeJoin(siteDir, decodeURIComponent(pageRel));
  const pageRaw = readIfExists(pageFp);
  if (pageRaw) {
    const asText = /\.html?$/i.test(pageFp) ? htmlToText(pageRaw) : pageRaw;
    parts.push("## Página actual: " + path.basename(pageFp) + "\n\n" +
               cap(asText, CAPS.page, "la página actual", truncated));
  }

  // 3. RAW/
  const rawDir = path.join(siteDir, "RAW");
  try {
    if (fs.existsSync(rawDir) && fs.statSync(rawDir).isDirectory()) {
      const names = fs.readdirSync(rawDir);
      const chunks = [];
      names.forEach(function (n) {
        const fp = path.join(rawDir, n);
        let isFile = false;
        try { isFile = fs.statSync(fp).isFile(); } catch (e) { return; }
        if (!isFile) { chunks.push("- " + n + "/ (carpeta)"); return; }
        if (TEXTY.indexOf(path.extname(n).toLowerCase()) < 0) {
          chunks.push("- " + n + " (binario o formato no textual — no lo leí)");
          return;
        }
        const body = readIfExists(fp);
        if (body === null) { chunks.push("- " + n + " (no pude leerlo)"); return; }
        const head = body.length > RAW_HEAD ? body.slice(0, RAW_HEAD) + "\n…(recortado)" : body;
        chunks.push("- " + n + ":\n" + head);
      });
      if (chunks.length) {
        parts.push("## Carpeta RAW/ (material extra del usuario)\n\n" +
                   cap(chunks.join("\n\n"), CAPS.raw, "RAW/", truncated));
      }
    }
  } catch (e) { /* RAW opcional */ }

  // 4. carpetas de contexto extra — SOLO nombres, nunca contenido
  const extraDirs = Array.isArray(o.extraDirs) ? o.extraDirs : [];
  if (extraDirs.length) {
    const lines = [];
    extraDirs.forEach(function (d) {
      try {
        if (!d || !fs.existsSync(d) || !fs.statSync(d).isDirectory()) return;
        const names = fs.readdirSync(d).slice(0, 200);
        lines.push("### " + d + "\n" + names.map(function (n) { return "- " + n; }).join("\n"));
      } catch (e) { /* saltar */ }
    });
    if (lines.length) {
      parts.push("## Carpetas de contexto extra (solo listado de archivos)\n\n" +
                 cap(lines.join("\n\n"), CAPS.extra, "las carpetas extra", truncated));
    }
  }

  let text = parts.join("\n\n");
  if (text.length > CAPS.total) {
    truncated.push("contexto total truncado a " + Math.round(CAPS.total / 1024) + " KB");
    text = text.slice(0, CAPS.total) + "\n…(truncado)";
  }
  return { text: text, truncated: truncated };
}

module.exports = { CAPS, htmlToText, gather };
