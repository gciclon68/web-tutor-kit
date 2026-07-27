/* =====================================================================
   Provider API · habla directo con la Messages API de Anthropic.

   A diferencia del CLI, acá no hay herramientas de lectura: el contexto del
   sitio lo junta lib/context.js y viaja como system prompt.

   OJO: este modo se COBRA por mensaje, y las sesiones viven en memoria
   (se pierden si reiniciás el server).
   ===================================================================== */
"use strict";
const crypto = require("crypto");
const cfgmod = require("../config.js");
const context = require("../context.js");

const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 4096;
const MAX_TURNS = 20;
const MAX_SESSION_CHARS = 200000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function preamble(tutorName) {
  return 'Actuás como "' + tutorName + '", un asistente integrado en un sitio local de estudio/referencia.\n' +
"Abajo tenés el material del sitio (CONTEXTO.md, la página que el usuario está mirando y la carpeta RAW/). Respondé en el mismo idioma que use la persona, claro y conciso.\n" +
"\n" +
"FORMATO DE RESPUESTA: el panel renderiza Markdown (GitHub-flavored) y LaTeX vía MathJax. Aprovechalo:\n" +
"- Markdown: encabezados, **negrita**, listas, código, y TABLAS con | pipes | cuando compares o resumas.\n" +
"- LaTeX para la matemática: inline $...$ y display $$...$$. Matrices reales con \\begin{bmatrix}...\\end{bmatrix} (nunca [[...]] en texto plano).\n" +
"- Usá algún emoji con moderación para dar tono/claridad (✅ ⚠️ 📌 🔑), sin abusar.\n" +
"\n" +
'TRANSPARENCIA DE CONTEXTO: cuando uses información de una sección específica del material, avisalo brevemente (ej.: "📖 según CONTEXTO.md…"). Si algo no está en el material, decilo en vez de inventar.\n' +
"\n" +
"=== MATERIAL DEL SITIO ===\n";
}

function newId() { return crypto.randomBytes(8).toString("hex"); }

function sizeOf(messages) {
  let n = 0;
  for (let i = 0; i < messages.length; i++) n += String(messages[i].content || "").length;
  return n;
}

function trim(messages) {
  while (messages.length > MAX_TURNS) messages.shift();
  while (messages.length > 2 && sizeOf(messages) > MAX_SESSION_CHARS) messages.shift();
  return messages;
}

function errMessageFrom(body) {
  try {
    const j = JSON.parse(body);
    if (j && j.error && j.error.message) return String(j.error.message);
  } catch (e) {}
  return String(body || "").slice(0, 200);
}

function create(cfg, o) {
  o = o || {};
  const siteDir = o.siteDir || process.cwd();
  const tutorName = o.tutorName || (cfg && cfg.tutorName) || "Tutor";
  const env = o.env || process.env;
  const baseUrl = String(((cfg && cfg.api && cfg.api.baseUrl) || "https://api.anthropic.com"))
                    .replace(/\/+$/, "");
  const models = (cfg && cfg.models) || {};
  const sessions = new Map();

  function modelFor(alias) {
    const key = alias || models.default || "sonnet";
    return models[key] || key;
  }

  function evict() {
    const now = Date.now();
    sessions.forEach(function (v, k) {
      if (now - v.lastUsed > SESSION_TTL_MS) sessions.delete(k);
    });
  }

  function keyOrNull() { return cfgmod.apiKeyOf(cfg, env); }

  function missingKeyDetail() {
    const name = (cfg && cfg.api && cfg.api.keyEnv) || "ANTHROPIC_API_KEY";
    return "Falta la API key. Seteá $" + name + " o corré `node chat-server.js --reconfigure`.";
  }

  async function post(payload, key) {
    let res;
    try {
      res = await fetch(baseUrl + "/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": ANTHROPIC_VERSION
        },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      const err = new Error(e.message);
      err.userMessage = "No pude conectar con " + baseUrl + " (" + e.message + ").";
      err.kind = "network";
      throw err;
    }
    const text = await res.text();
    if (!res.ok) {
      const err = new Error("http " + res.status);
      err.status = res.status;
      if (res.status === 401 || res.status === 403) {
        err.userMessage = "La API key fue rechazada (" + res.status + "). Revisala y corré --reconfigure.";
      } else if (res.status === 404) {
        err.userMessage = "El baseUrl no expone /v1/messages — revisá el endpoint (" + baseUrl + ").";
      } else {
        err.userMessage = "La API devolvió " + res.status + ": " + errMessageFrom(text);
      }
      throw err;
    }
    try { return JSON.parse(text); } catch (e) {
      const err = new Error("bad json");
      err.userMessage = "La API devolvió una respuesta que no pude parsear.";
      throw err;
    }
  }

  function textOf(json) {
    const content = (json && json.content) || [];
    return content.filter(function (b) { return b && b.type === "text"; })
                  .map(function (b) { return b.text; })
                  .join("")
                  .trim();
  }

  async function ask(req) {
    req = req || {};
    const key = keyOrNull();
    if (!key) { const e = new Error("no key"); e.userMessage = missingKeyDetail(); throw e; }

    evict();
    let reset = false;
    let sid = req.sessionId;
    let session = sid ? sessions.get(sid) : null;
    if (sid && !session) reset = true;
    if (!session) {
      sid = newId();
      session = { messages: [], lastUsed: Date.now() };
      sessions.set(sid, session);
    }

    const gathered = context.gather({ siteDir: siteDir, page: req.page, extraDirs: req.extraDirs });
    if (gathered.truncated.length) {
      console.log("  [contexto] " + gathered.truncated.join(" · "));
    }
    const system = preamble(tutorName) + gathered.text;

    const messages = session.messages.concat([{ role: "user", content: String(req.message || "") }]);
    const json = await post({
      model: modelFor(req.model),
      max_tokens: MAX_TOKENS,
      system: system,
      messages: messages
    }, key);

    const reply = textOf(json) || "(sin respuesta)";
    session.messages = trim(messages.concat([{ role: "assistant", content: reply }]));
    session.lastUsed = Date.now();
    return { reply: reply, sessionId: sid, reset: reset };
  }

  async function checkFast() {
    return keyOrNull() ? { ok: true, detail: "" } : { ok: false, detail: missingKeyDetail() };
  }

  async function check() {
    const key = keyOrNull();
    if (!key) return { ok: false, detail: missingKeyDetail(), model: "" };
    const model = modelFor("");
    try {
      await post({ model: model, max_tokens: 5,
                   messages: [{ role: "user", content: "ping" }] }, key);
      return { ok: true, detail: "La API responde.", model: model };
    } catch (e) {
      return { ok: false, detail: e.userMessage || e.message, model: "" };
    }
  }

  return { ask: ask, check: check, checkFast: checkFast };
}

module.exports = { create };
