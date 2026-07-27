/* ===== Tutor · panel de chat que habla con el CLI `claude` vía chat-server.js ===== */
(function(){
  "use strict";
  var ENDPOINT = "/api/ask";
  var CKEY = "ee-tutor-chats";     // localStorage: { chats:[{id,title,sessionId,msgs}], activeId }
  var GREETING = "Hola 👋 Soy Claude Code corriendo en la carpeta del proyecto, con el contexto de esta guía. Te aviso qué archivo o página consulto en cada respuesta. ¿Querés material extra? Dejá archivos en la carpeta RAW/ (en la carpeta del sitio) y los leo. Usá «+ Nuevo» (panel izquierdo) para abrir otro chat y manejar el contexto.";

  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }

  // título tipo "cheat sheet": keywords, sin stopwords, máximo 5 palabras
  var STOP = {"el":1,"la":1,"los":1,"las":1,"un":1,"una":1,"unos":1,"unas":1,"de":1,"del":1,"que":1,"qué":1,"y":1,"o":1,"a":1,"en":1,"es":1,"son":1,"cual":1,"cuál":1,"cuales":1,"como":1,"cómo":1,"para":1,"por":1,"con":1,"se":1,"su":1,"sus":1,"lo":1,"me":1,"mi":1,"al":1,"e":1,"si":1,"no":1,"the":1,"an":1,"of":1,"to":1,"in":1,"is":1,"are":1,"what":1,"how":1,"why":1,"and":1,"or":1,"for":1,"with":1,"dame":1,"decime":1,"explicame":1,"explícame":1,"mostrame":1,"muéstrame":1,"quiero":1,"puedo":1,"podés":1,"podrias":1,"sobre":1,"cuando":1,"cuándo":1,"donde":1,"dónde":1,"hacé":1,"hace":1,"haceme":1};
  function titleFrom(text){
    var words = String(text).toLowerCase().replace(/[¿?¡!.,;:()\[\]{}"'`*_>#]/g,"").replace(/\s+/g," ").trim().split(" ");
    var kept = [];
    for (var i=0;i<words.length && kept.length<5;i++){ var w=words[i]; if(!w || STOP[w]) continue; kept.push(w); }
    if (!kept.length) kept = words.slice(0,5);
    var t = kept.join(" ");
    return t ? t.charAt(0).toUpperCase()+t.slice(1) : "Chat";
  }
  function loadDirs(){ try{ var a=JSON.parse(localStorage.getItem("ee-tutor-dirs")); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
  function saveDirs(){ try{ localStorage.setItem("ee-tutor-dirs", JSON.stringify(ctxDirs)); }catch(e){} }
  // Markdown (marked) + LaTeX (MathJax). La matemática se "esconde" antes de
  // parsear Markdown para que no se corrompan los backslash / _ / *.
  function md(src){
    src = String(src);
    var math = [];
    function stash(tex, disp){ math.push({ tex: tex, disp: disp }); return "@@M" + (math.length - 1) + "@@"; }
    var s = src
      .replace(/\$\$([\s\S]+?)\$\$/g, function(_, x){ return stash(x, true); })
      .replace(/\\\[([\s\S]+?)\\\]/g, function(_, x){ return stash(x, true); })
      .replace(/\\\(([\s\S]+?)\\\)/g, function(_, x){ return stash(x, false); })
      .replace(/(^|[^\\$])\$([^\$\n]+?)\$/g, function(m, pre, x){ return pre + stash(x, false); });
    var html;
    if (window.marked && marked.parse) {
      try { html = marked.parse(s, { gfm: true, breaks: true }); } catch(e){ html = basicMd(s); }
    } else { html = basicMd(s); }
    html = html.replace(/@@M(\d+)@@/g, function(_, i){
      var o = math[+i]; if (!o) return "";
      return o.disp ? ("\\[" + o.tex + "\\]") : ("\\(" + o.tex + "\\)");
    });
    return html;
  }
  function basicMd(s){
    var e = esc(s);
    e = e.replace(/```([\s\S]*?)```/g, function(_,c){ return '<pre>'+c.replace(/^\n/,"")+'</pre>'; });
    e = e.replace(/`([^`]+)`/g, '<code>$1</code>');
    e = e.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    e = e.replace(/\n/g, "<br>");
    return e;
  }

  // ---- carga diferida de marked + MathJax (offline, desde assets/vendor) ----
  var mjReady = false, pendingTypeset = [];
  function loadDeps(){
    if (window.__ttDeps) return; window.__ttDeps = true;
    var m = document.createElement("script"); m.src = "assets/vendor/marked.min.js"; document.head.appendChild(m);
    window.MathJax = {
      tex: { inlineMath: [["\\(", "\\)"]], displayMath: [["\\[", "\\]"]] },
      svg: { fontCache: "global" },
      options: { enableMenu: false },
      startup: { typeset: false, ready: function(){ window.MathJax.startup.defaultReady(); mjReady = true; flushTypeset(); } }
    };
    var j = document.createElement("script"); j.src = "assets/vendor/tex-svg.js"; j.async = true; document.head.appendChild(j);
  }
  function flushTypeset(){ var q = pendingTypeset.slice(); pendingTypeset.length = 0; q.forEach(typeset); }
  function typeset(node){
    if (mjReady && window.MathJax && MathJax.typesetPromise) {
      MathJax.typesetPromise([node]).then(function(){ if (elMsgs) elMsgs.scrollTop = elMsgs.scrollHeight; }).catch(function(){});
    } else { pendingTypeset.push(node); }
  }
  function loadChats(){ try{ var d=JSON.parse(localStorage.getItem(CKEY)); if(d && d.chats && d.chats.length) return d; }catch(e){} return null; }
  function saveChats(){ try{ localStorage.setItem(CKEY, JSON.stringify(chatState)); }catch(e){} }
  function uid(){ return "c" + Date.now().toString(36) + Math.floor(Math.random()*1e5).toString(36); }
  function newChatObj(){ return { id: uid(), title: "Nuevo chat", sessionId: null, msgs: [], model: "" }; }
  function active(){ for (var i=0;i<chatState.chats.length;i++){ if (chatState.chats[i].id===chatState.activeId) return chatState.chats[i]; } return chatState.chats[0]; }

  function styles(){
    var css = ''
    + '.tt-fab{position:fixed;right:20px;bottom:20px;z-index:50;display:flex;align-items:center;gap:9px;'
    + 'font-family:var(--sans);font-size:14px;font-weight:600;color:#fff;background:var(--phi);border:none;'
    + 'padding:12px 17px;border-radius:26px;cursor:pointer;box-shadow:0 6px 22px var(--shadow);transition:.15s}'
    + '.tt-fab:hover{transform:translateY(-2px)}'
    + '.tt-fab .dot{width:8px;height:8px;border-radius:50%;background:#fff;opacity:.85}'
    + '.tt-panel{position:fixed;top:0;right:0;z-index:60;width:var(--tt-w,30vw);height:100vh;'
    + 'display:none;flex-direction:column;background:var(--surface);border-left:1px solid var(--line);'
    + 'box-shadow:-14px 0 44px var(--shadow)}'
    + '.tt-panel.open{display:flex}'
    + '.tt-resizer{position:absolute;left:-4px;top:0;bottom:0;width:11px;cursor:col-resize;z-index:62;touch-action:none}'
    + '.tt-resizer::before{content:"";position:absolute;left:3px;top:50%;transform:translateY(-50%);height:48px;width:4px;border-radius:3px;background:var(--line);opacity:.55;transition:.14s}'
    + '.tt-resizer:hover::before,.tt-resizer.dragging::before{opacity:1;background:var(--phi);height:84px}'
    + '.app{transition:margin-right .18s ease}'
    + 'body.tt-resizing{cursor:col-resize;user-select:none}'
    + 'body.tt-resizing .app{transition:none}'
    + 'body.tt-open .app{margin-right:var(--tt-w,30vw)}'
    + '.tt-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);background:var(--surface-2)}'
    + '.tt-head . av{width:30px;height:30px;border-radius:8px;background:var(--phi);color:#fff;display:grid;place-items:center;font-weight:700;font-family:var(--mono)}'
    + '.tt-head b{font-size:14.5px;line-height:1.1}.tt-head small{display:block;color:var(--ink-soft);font-family:var(--mono);font-size:10.5px}'
    + '.tt-head .x{margin-left:auto;background:none;border:none;color:var(--ink-soft);font-size:20px;cursor:pointer;line-height:1;padding:4px}'
    + '.tt-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;position:relative}'
    + '.tt-m{max-width:88%;padding:10px 13px;border-radius:12px;font-size:14px;line-height:1.5;white-space:normal}'
    + '.tt-m.user{align-self:flex-end;background:var(--phi);color:#fff;border-bottom-right-radius:4px}'
    + '.tt-m.bot{align-self:flex-start;background:var(--surface-2);color:var(--ink);border:1px solid var(--line);border-bottom-left-radius:4px}'
    + '.tt-m.sys{align-self:center;background:transparent;color:var(--ink-soft);font-size:12.5px;text-align:center;font-family:var(--mono)}'
    + '.tt-m pre{background:rgba(127,127,127,.15);padding:9px 11px;border-radius:8px;overflow-x:auto;font-family:var(--mono);font-size:12.5px;margin:6px 0}'
    + '.tt-m code{font-family:var(--mono);font-size:.9em;background:rgba(127,127,127,.18);padding:1px 5px;border-radius:4px}'
    + '.tt-m.user code,.tt-m.user pre{background:rgba(255,255,255,.22)}'
    + '.tt-typing{align-self:flex-start;color:var(--ink-soft);font-family:var(--mono);font-size:12.5px;padding:4px 2px}'
    + '.tt-form{display:flex;gap:8px;padding:12px;border-top:1px solid var(--line);background:var(--surface)}'
    + '.tt-form textarea{flex:1;resize:none;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);'
    + 'font-family:var(--sans);font-size:14px;padding:9px 11px;max-height:120px;line-height:1.4}'
    + '.tt-form textarea:focus{outline:2px solid var(--phi);outline-offset:1px}'
    + '.tt-form button{border:none;background:var(--phi);color:#fff;border-radius:10px;padding:0 15px;font-weight:600;cursor:pointer;font-size:14px}'
    + '.tt-form button:disabled{opacity:.5;cursor:default}'
    // --- markdown enriquecido dentro de los mensajes ---
    + '.tt-m h1,.tt-m h2,.tt-m h3,.tt-m h4{margin:.55em 0 .3em;line-height:1.2;font-weight:700}'
    + '.tt-m h1{font-size:1.3em}.tt-m h2{font-size:1.17em}.tt-m h3{font-size:1.05em}.tt-m h4{font-size:1em}'
    + '.tt-m p{margin:.5em 0}.tt-m>:first-child{margin-top:0}.tt-m>:last-child{margin-bottom:0}'
    + '.tt-m ul,.tt-m ol{margin:.45em 0;padding-left:1.35em}.tt-m li{margin:.18em 0}'
    + '.tt-m blockquote{margin:.5em 0;padding:.15em .8em;border-left:3px solid var(--phi);color:var(--ink-soft)}'
    + '.tt-m hr{border:none;border-top:1px solid var(--line);margin:.7em 0}'
    + '.tt-m a{color:var(--phi);text-decoration:underline}'
    + '.tt-m table{border-collapse:collapse;width:100%;margin:.6em 0;font-size:.9em;display:block;overflow-x:auto}'
    + '.tt-m th,.tt-m td{border:1px solid var(--line);padding:5px 9px;text-align:left;white-space:nowrap}'
    + '.tt-m th{background:var(--surface-2);font-weight:700}'
    + '.tt-m tr:nth-child(2n) td{background:color-mix(in srgb,var(--surface-2) 50%,transparent)}'
    + '.tt-m mjx-container{overflow-x:auto;overflow-y:hidden;max-width:100%}'
    + '.tt-m mjx-container[display="true"]{margin:.5em 0;text-align:center}'
    + '.tt-m.user b,.tt-m.user a{color:#fff}'
    // --- riel de dots para saltar entre preguntas ---
    + '.tt-dots{position:absolute;right:7px;top:102px;bottom:66px;display:none;flex-direction:column;justify-content:center;align-items:center;gap:7px;z-index:63;pointer-events:none}'
    + '.tt-dot{pointer-events:auto;width:8px;height:8px;border-radius:50%;border:none;background:var(--ink-soft);opacity:.45;cursor:pointer;padding:0;transition:transform .15s,opacity .15s,background .15s}'
    + '.tt-dot:hover{opacity:.9;transform:scale(1.35)}'
    + '.tt-dot.active{background:var(--phi);opacity:1;transform:scale(1.4)}'
    // --- lista de chats en el panel izquierdo ---
    + '.tt-chats-head{display:flex;justify-content:space-between;align-items:center}'
    + '.tt-newchat{font-family:var(--sans);font-size:11px;font-weight:600;color:var(--phi);background:none;border:1px solid var(--line);border-radius:20px;padding:2px 9px;cursor:pointer;text-transform:none;letter-spacing:0}'
    + '.tt-newchat:hover{border-color:var(--phi)}'
    + '.tt-chatlist{display:flex;flex-direction:column;gap:2px;padding:2px 12px 10px;max-height:26vh;overflow-y:auto}'
    + '.tt-chat{display:flex;align-items:center;gap:6px;border-radius:9px;padding:6px 8px;transition:background .12s}'
    + '.tt-chat:hover{background:var(--surface-2)}'
    + '.tt-chat.active{background:color-mix(in srgb,var(--phi) 13%,var(--surface))}'
    + '.tt-chat-name{flex:1;min-width:0;text-align:left;background:none;border:none;color:var(--ink);font-family:var(--sans);font-size:13px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0}'
    + '.tt-chat.active .tt-chat-name{color:var(--phi);font-weight:600}'
    + '.tt-chat-del{background:none;border:none;color:var(--ink-soft);font-size:15px;line-height:1;cursor:pointer;opacity:0;padding:0 2px}'
    + '.tt-chat:hover .tt-chat-del{opacity:.7}'
    + '.tt-chat-del:hover{opacity:1;color:var(--bad)}'
    // --- pill de estado del bridge ---
    + '.tt-pill{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);'
    + 'font-size:10.5px;border:1px solid var(--line);border-radius:20px;padding:2px 8px;cursor:default;background:var(--bg);white-space:nowrap}'
    + '.tt-pill.ok{color:#3fb950;border-color:currentColor}'
    + '.tt-pill.fail{color:var(--bad,#f85149);border-color:currentColor;cursor:pointer}'
    + '.tt-pill.probing{color:var(--ink-soft)}'
    + '.tt-head .x{margin-left:8px}'
    // --- tarjeta de "arrancá el bridge" cuando se abre como file:// ---
    + '.tt-filecard{padding:20px 18px;font-size:13.5px;line-height:1.6;color:var(--ink);overflow-y:auto}'
    + '.tt-filecard h4{margin:0 0 10px;font-size:15px;color:var(--bad,#f85149)}'
    + '.tt-filecard ol{margin:10px 0;padding-left:1.3em}.tt-filecard li{margin:6px 0}'
    + '.tt-filecard code{font-family:var(--mono);font-size:12.5px;background:rgba(127,127,127,.18);padding:2px 6px;border-radius:5px;display:inline-block}'
    + '.tt-filecard .why{color:var(--ink-soft);font-size:12.5px;margin-top:14px;border-top:1px solid var(--line);padding-top:12px}'
    // --- toolbar del encabezado: modelo + carpetas ---
    + '.tt-head-t{min-width:0}'
    + '.tt-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid var(--line);background:var(--surface)}'
    + '.tt-model{font-family:var(--mono);font-size:11.5px;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:4px 6px;cursor:pointer;max-width:160px}'
    + '.tt-tool{font-family:var(--sans);font-size:11.5px;color:var(--ink-soft);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:4px 9px;cursor:pointer;white-space:nowrap}'
    + '.tt-tool:hover{border-color:var(--phi);color:var(--phi)}'
    + '.tt-ctxdirs{display:none;flex-wrap:wrap;gap:6px;padding:8px 12px 0}'
    + '.tt-ctxchip{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:11px;color:var(--ink);background:var(--surface-2);border:1px solid var(--line);border-radius:20px;padding:3px 4px 3px 9px;max-width:100%}'
    + '.tt-ctxchip span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}'
    + '.tt-ctxchip button{background:none;border:none;color:var(--ink-soft);cursor:pointer;font-size:14px;line-height:1;padding:0 3px;flex:0 0 auto}'
    + '.tt-ctxchip button:hover{color:var(--bad)}'
    + '@media(max-width:960px){.tt-panel{top:auto;bottom:0;left:0;right:0;width:auto;height:80vh;border-left:none;border-top:1px solid var(--line);border-radius:16px 16px 0 0}body.tt-open .app{margin-right:0}.tt-fab{right:12px;bottom:12px}.tt-resizer{display:none}}';
    var s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
  }

  var elMsgs, elText, elSend, panel, typingEl, dotsEl, dots = [], fab, chatListEl, chatState, modelEl, dirsEl, ctxDirs = [];
  var pillEl, healthState = { stage: "probing", detail: "" }, healthPolls = 0;

  // ---- estado del bridge: ⚪ probando → 🟢 listo / 🔴 error --------------
  function renderPill(){
    if (!pillEl) return;
    var s = healthState.stage || "probing";
    pillEl.className = "tt-pill " + s;
    pillEl.textContent = s === "ok" ? "🟢 listo" : (s === "fail" ? "🔴 error" : "⚪ probando…");
    pillEl.title = healthState.detail || (s === "ok" ? "El tutor puede responder." : "Chequeando el tutor…");
    if (elSend) elSend.disabled = (s === "fail");
  }
  function pollHealth(){
    fetch("/api/health").then(function(r){ return r.json(); }).then(function(h){
      var was = healthState.stage;
      healthState = h || healthState;
      renderPill();
      if (healthState.stage === "probing" && ++healthPolls < 20){ setTimeout(pollHealth, 3000); return; }
      if (healthState.stage === "fail" && was !== "fail"){
        addMsg("sys", "⚠️ " + (healthState.detail || "el tutor no está disponible")
                    + (healthState.configPath ? ("\nConfig: " + healthState.configPath) : ""), false);
      }
    }).catch(function(){
      healthState = { stage: "fail", detail: "No hay conexión con el bridge. ¿Está corriendo `node chat-server.js`?" };
      renderPill();
    });
  }

  // ---- abierto como archivo (file://): el chat no puede funcionar --------
  function buildFileCard(){
    styles();
    fab = document.createElement("button");
    fab.className = "tt-fab"; fab.setAttribute("aria-label","Abrir tutor");
    fab.innerHTML = '<span class="dot"></span>Tutor Claude Code';
    document.body.appendChild(fab);

    panel = document.createElement("div"); panel.className = "tt-panel";
    panel.setAttribute("role","dialog"); panel.setAttribute("aria-label","Tutor");
    panel.innerHTML =
      '<div class="tt-head"><div class="av">✦</div><div class="tt-head-t"><b>Tutor · Claude Code</b>'
    + '<small>necesita el bridge</small></div><button class="x" aria-label="Cerrar">×</button></div>'
    + '<div class="tt-filecard">'
    +   '<h4>⚠️ El tutor necesita el bridge</h4>'
    +   '<div>Abriste el sitio como archivo (<code>file://</code>). El chat no puede funcionar así.</div>'
    +   '<ol>'
    +     '<li>Abrí una terminal en la carpeta del sitio</li>'
    +     '<li>Ejecutá <code>node chat-server.js</code></li>'
    +     '<li>Abrí el link que imprime (ej. <code>http://localhost:8770</code>)</li>'
    +   '</ol>'
    +   '<div>En Windows también podés hacer doble clic en <code>iniciar-tutor.cmd</code>.</div>'
    +   '<div class="why">El resto del sitio (páginas, gráficos, navegación) funciona igual sin el bridge — '
    +   'lo único que necesita el server es el chat.</div>'
    + '</div>';
    document.body.appendChild(panel);

    fab.addEventListener("click", function(){ openPanel(true); });
    panel.querySelector(".x").addEventListener("click", function(){ openPanel(false); });
  }

  function addDot(msgEl){
    if (!dotsEl) return;
    var b = document.createElement("button");
    b.type = "button"; b.className = "tt-dot"; b.setAttribute("aria-label", "Ir a esta pregunta");
    b.addEventListener("click", function(){
      elMsgs.scrollTo({ top: Math.max(0, msgEl.offsetTop - 8), behavior: "smooth" });
      setTimeout(highlightDots, 360);
    });
    dotsEl.appendChild(b);
    dots.push({ msg: msgEl, dot: b });
    dotsEl.style.display = dots.length >= 2 ? "flex" : "none";
  }
  function highlightDots(){
    if (!dots.length || !elMsgs) return;
    var base = elMsgs.getBoundingClientRect().top, best = 0, bestD = Infinity;
    for (var i = 0; i < dots.length; i++){
      var d = Math.abs(dots[i].msg.getBoundingClientRect().top - base - 6);
      if (d < bestD){ bestD = d; best = i; }
    }
    for (var j = 0; j < dots.length; j++) dots[j].dot.classList.toggle("active", j === best);
  }

  function addMsg(role, text, persist){
    var d = document.createElement("div");
    d.className = "tt-m " + role;
    d.innerHTML = (role === "bot") ? md(text) : esc(text).replace(/\n/g,"<br>");
    elMsgs.appendChild(d);
    elMsgs.scrollTop = elMsgs.scrollHeight;
    if (role === "bot") typeset(d);
    if (role === "user") addDot(d);
    if (persist !== false && role !== "sys"){
      var a = active(); a.msgs.push({ role: role, text: text });
      if (role === "user" && (!a.title || a.title === "Nuevo chat")){ a.title = titleFrom(text); renderChatList(); }
      saveChats();
    }
    return d;
  }
  function showTyping(on){
    if (on){ typingEl = document.createElement("div"); typingEl.className="tt-typing"; typingEl.textContent="el tutor está pensando…"; elMsgs.appendChild(typingEl); elMsgs.scrollTop=elMsgs.scrollHeight; }
    else if (typingEl){ typingEl.remove(); typingEl=null; }
  }

  function send(){
    var msg = elText.value.trim(); if (!msg) return;
    elText.value=""; elText.style.height="auto";
    addMsg("user", msg);
    elSend.disabled = true; showTyping(true);
    fetch(ENDPOINT, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ message: msg, sessionId: active().sessionId, model: (modelEl && modelEl.value) || "", extraDirs: ctxDirs, page: location.pathname })
    }).then(function(r){ return r.json(); }).then(function(data){
      showTyping(false); elSend.disabled=false;
      if (data.error){ addMsg("bot", "⚠️ " + data.error); pollHealth(); return; }
      if (data.reset) addMsg("sys", "↻ Se reinició el hilo (el servidor se reinició).", false);
      if (data.sessionId){ active().sessionId = data.sessionId; saveChats(); }
      addMsg("bot", data.reply || "(sin respuesta)");
    }).catch(function(){
      showTyping(false); elSend.disabled=false;
      addMsg("sys", "No hay conexión con el tutor. Arrancá el bridge:\nnode chat-server.js\ny abrí el link que imprime.");
      pollHealth();
    });
  }

  function openPanel(o){
    panel.classList.toggle("open", o);
    document.body.classList.toggle("tt-open", o);
    if (fab) fab.style.display = o ? "none" : "flex";
    if (o && elText) elText.focus();
    setTimeout(function(){ try{ window.dispatchEvent(new Event("resize")); }catch(e){} }, 220);
  }
  function renderActive(){
    if (!elMsgs) return;
    elMsgs.innerHTML = ""; dots = [];
    if (dotsEl){ dotsEl.innerHTML = ""; dotsEl.style.display = "none"; }
    var a = active();
    if (modelEl) modelEl.value = (a && a.model) || "";   // el modelo es por chat
    if (a && a.msgs.length){ a.msgs.forEach(function(m){ addMsg(m.role, m.text, false); }); }
    else { addMsg("sys", GREETING, false); }
  }
  function renderChatList(){
    if (!chatListEl) return;
    chatListEl.innerHTML = "";
    chatState.chats.forEach(function(c){
      var row = document.createElement("div");
      row.className = "tt-chat" + (c.id === chatState.activeId ? " active" : "");
      var name = document.createElement("button");
      name.type = "button"; name.className = "tt-chat-name"; name.textContent = c.title || "Chat"; name.title = c.title || "Chat";
      name.addEventListener("click", function(){ switchChat(c.id); });
      var del = document.createElement("button");
      del.type = "button"; del.className = "tt-chat-del"; del.textContent = "×"; del.setAttribute("aria-label", "Borrar chat");
      del.addEventListener("click", function(e){ e.stopPropagation(); deleteChat(c.id); });
      row.appendChild(name); row.appendChild(del);
      chatListEl.appendChild(row);
    });
  }
  function switchChat(id){ if (id === chatState.activeId){ openPanel(true); return; } chatState.activeId = id; saveChats(); renderChatList(); renderActive(); openPanel(true); }
  function newChat(){ var c = newChatObj(); chatState.chats.unshift(c); chatState.activeId = c.id; saveChats(); renderChatList(); renderActive(); openPanel(true); }
  function deleteChat(id){
    chatState.chats = chatState.chats.filter(function(c){ return c.id !== id; });
    if (!chatState.chats.length) chatState.chats.push(newChatObj());
    if (chatState.activeId === id) chatState.activeId = chatState.chats[0].id;
    saveChats(); renderChatList(); renderActive();
  }
  function renderDirs(){
    if (!dirsEl) return;
    dirsEl.innerHTML = "";
    dirsEl.style.display = ctxDirs.length ? "flex" : "none";
    ctxDirs.forEach(function(d, idx){
      var chip = document.createElement("span"); chip.className = "tt-ctxchip"; chip.title = d;
      var base = d.replace(/[\\\/]+$/, "").split(/[\\\/]/).pop() || d;
      var label = document.createElement("span"); label.textContent = "📁 " + base;
      var x = document.createElement("button"); x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", "Quitar carpeta");
      x.addEventListener("click", function(){ ctxDirs.splice(idx, 1); saveDirs(); renderDirs(); });
      chip.appendChild(label); chip.appendChild(x); dirsEl.appendChild(chip);
    });
  }
  function buildChatsUI(){
    var sidenav = document.querySelector(".sidenav");
    if (!sidenav) return;
    var block = document.createElement("div");
    block.className = "sideblock tt-chats-block";
    block.innerHTML =
      '<div class="pnhead tt-chats-head">Chats<button type="button" class="tt-newchat" title="Nuevo chat">+ Nuevo</button></div>'
      + '<div class="tt-chatlist" id="tt-chatlist"></div>';
    var foot = sidenav.querySelector(".sidefoot");
    if (foot) sidenav.insertBefore(block, foot); else sidenav.appendChild(block);
    chatListEl = block.querySelector("#tt-chatlist");
    block.querySelector(".tt-newchat").addEventListener("click", newChat);
    renderChatList();
  }

  function build(){
    // sin bridge no hay chat: mostramos cómo arrancarlo en vez de fallar callados
    if (location.protocol === "file:") { buildFileCard(); return; }
    styles();
    loadDeps();
    fab = document.createElement("button");
    fab.className="tt-fab"; fab.setAttribute("aria-label","Abrir tutor de Claude Code");
    fab.innerHTML='<span class="dot"></span>Tutor Claude Code';
    document.body.appendChild(fab);

    panel = document.createElement("div"); panel.className="tt-panel"; panel.setAttribute("role","dialog"); panel.setAttribute("aria-label","Tutor");
    panel.innerHTML =
      '<div class="tt-head"><div class="av">✦</div><div class="tt-head-t"><b>Tutor · Claude Code</b><small>carpeta del proyecto · CONTEXTO.md + RAW/</small></div>'
    + '<span class="tt-pill probing" id="tt-pill" title="Chequeando el tutor…">⚪ probando…</span>'
    + '<button class="x" aria-label="Cerrar">×</button></div>'
    + '<div class="tt-toolbar">'
    +   '<select id="tt-model" class="tt-model" title="Modelo de Claude a usar">'
    +     '<option value="">Modelo: por defecto</option>'
    +     '<option value="opus">Opus · máx. calidad</option>'
    +     '<option value="sonnet">Sonnet · equilibrado</option>'
    +     '<option value="haiku">Haiku · rápido</option>'
    +   '</select>'
    +   '<button type="button" class="tt-tool" id="tt-addctx" title="Agregar una carpeta de contexto (además de RAW)">➕ Carpeta</button>'
    +   '<button type="button" class="tt-tool" id="tt-openraw" title="Abrir la carpeta RAW en el explorador">📂 RAW</button>'
    + '</div>'
    + '<div class="tt-ctxdirs" id="tt-ctxdirs"></div>'
    + '<div class="tt-msgs" id="tt-msgs"></div>'
    + '<form class="tt-form"><textarea id="tt-text" rows="1" placeholder="Preguntá sobre Ψ, Φ, el Ejercicio 3…"></textarea><button type="submit" id="tt-send">Enviar</button></form>';
    document.body.appendChild(panel);

    elMsgs = panel.querySelector("#tt-msgs");
    elText = panel.querySelector("#tt-text");
    elSend = panel.querySelector("#tt-send");

    // riel de dots (uno por pregunta) para saltar rápido entre prompts
    dotsEl = document.createElement("div"); dotsEl.className = "tt-dots";
    panel.appendChild(dotsEl);
    var dscroll = false;
    elMsgs.addEventListener("scroll", function(){ if (dscroll) return; dscroll = true; requestAnimationFrame(function(){ dscroll = false; highlightDots(); }); });

    // ---- borde izquierdo del tutor: arrastrable (centro <-> tutor) ----
    var TKEY = "ee-tutorw";
    function setTW(px){ document.documentElement.style.setProperty("--tt-w", px + "px"); }
    function clearTW(){ document.documentElement.style.removeProperty("--tt-w"); }
    function clampTW(px){ return Math.max(300, Math.min(px, Math.round(window.innerWidth * 0.6))); }
    try { var savedTW = parseInt(localStorage.getItem(TKEY), 10); if (savedTW) setTW(clampTW(savedTW)); } catch(e){}
    var rz = document.createElement("div");
    rz.className = "tt-resizer";
    rz.title = "Arrastrá para ajustar el ancho del tutor · doble clic para volver al 30%";
    panel.appendChild(rz);
    var tdrag = false, traf = false;
    function trepaint(){ if (traf) return; traf = true; requestAnimationFrame(function(){ traf = false; if (window.PP && PP.repaint) PP.repaint(document); }); }
    rz.addEventListener("pointerdown", function(e){
      if (window.innerWidth <= 960) return;
      tdrag = true; rz.classList.add("dragging"); document.body.classList.add("tt-resizing");
      try { rz.setPointerCapture(e.pointerId); } catch(_){}
      e.preventDefault();
    });
    rz.addEventListener("pointermove", function(e){
      if (!tdrag) return;
      setTW(clampTW(window.innerWidth - e.clientX)); trepaint();
    });
    function tend(){
      if (!tdrag) return;
      tdrag = false; rz.classList.remove("dragging"); document.body.classList.remove("tt-resizing");
      try { localStorage.setItem(TKEY, parseInt(getComputedStyle(panel).width, 10)); } catch(_){}
      trepaint();
    }
    rz.addEventListener("pointerup", tend);
    rz.addEventListener("pointercancel", tend);
    rz.addEventListener("dblclick", function(){ clearTW(); try { localStorage.removeItem(TKEY); } catch(_){} trepaint(); });

    // toolbar: modelo, carpeta de contexto extra, abrir RAW
    modelEl = panel.querySelector("#tt-model");
    modelEl.addEventListener("change", function(){ var a = active(); if (a){ a.model = modelEl.value; saveChats(); } });
    dirsEl = panel.querySelector("#tt-ctxdirs");
    ctxDirs = loadDirs(); renderDirs();
    panel.querySelector("#tt-addctx").addEventListener("click", function(){
      var p = prompt("Pegá la ruta ABSOLUTA de una carpeta de contexto extra (además de RAW):\nej.  D:\\Docs\\apuntes", "");
      if (p && p.trim()){ ctxDirs.push(p.trim()); saveDirs(); renderDirs(); }
    });
    panel.querySelector("#tt-openraw").addEventListener("click", function(){
      fetch("/api/open", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ target: "RAW" }) })
        .then(function(r){ return r.json(); })
        .then(function(d){ if (d && d.error) addMsg("sys", "No pude abrir RAW: " + d.error); })
        .catch(function(){ addMsg("sys", "No pude abrir RAW (¿está corriendo el bridge?)."); });
    });

    // inicializar chats + lista en el panel izquierdo, y renderizar el chat activo
    chatState = loadChats();
    if (!chatState){ chatState = { chats: [ newChatObj() ], activeId: null }; chatState.activeId = chatState.chats[0].id; saveChats(); }
    buildChatsUI();
    renderActive();

    fab.addEventListener("click", function(){ openPanel(true); });
    panel.querySelector(".x").addEventListener("click", function(){ openPanel(false); });
    panel.querySelector(".tt-form").addEventListener("submit", function(e){ e.preventDefault(); send(); });
    elText.addEventListener("input", function(){ elText.style.height="auto"; elText.style.height=Math.min(elText.scrollHeight,120)+"px"; });
    elText.addEventListener("keydown", function(e){ if (e.key==="Enter" && !e.shiftKey){ e.preventDefault(); send(); } });

    // estado del bridge: se chequea al cargar, sin esperar a la primera pregunta
    pillEl = panel.querySelector("#tt-pill");
    pillEl.addEventListener("click", function(){ if (healthState.stage === "fail"){ healthPolls = 0; pollHealth(); } });
    pollHealth();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
