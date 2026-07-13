/* ===== Espacio de Estados · navegación de páginas + tema ===== */
(function(){
  "use strict";
  const PP = window.PP = window.PP || {};

  document.addEventListener("DOMContentLoaded", () => {
    // ---- theme (default dark, choice persists across pages) ----
    try { const stored = localStorage.getItem("ee-theme"); if (stored) document.documentElement.setAttribute("data-theme", stored); } catch(e){}
    const tb = document.getElementById("themebtn");
    if (tb) tb.addEventListener("click", () => {
      const now = document.documentElement.getAttribute("data-theme") || "dark";
      const next = now === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("ee-theme", next); } catch(e){}
      setTimeout(() => PP.repaint(document), 30);
    });

    // ---- paging (only on module pages) ----
    const pages = Array.prototype.slice.call(document.querySelectorAll(".page"));
    if (!pages.length) return;

    const rightList = document.getElementById("pagelist");
    pages.forEach((pg, i) => {
      const a = document.createElement("a");
      a.href = "#" + pg.id; a.className = "pglink"; a.dataset.target = pg.id;
      a.innerHTML = '<span class="pgn">' + (pg.dataset.label || (i+1)) + '</span><span class="pgt">' + (pg.dataset.title || pg.id) + '</span>';
      if (rightList) rightList.appendChild(a);
    });
    const links = Array.prototype.slice.call(document.querySelectorAll(".pglink"));
    const prevBtn = document.getElementById("prevpg");
    const nextBtn = document.getElementById("nextpg");
    const posEl = document.getElementById("pgpos");
    let idx = 0;

    function show(i, push){
      i = Math.max(0, Math.min(pages.length-1, i));
      idx = i;
      pages.forEach((p, k) => p.classList.toggle("active", k === i));
      links.forEach((l, k) => l.classList.toggle("active", k === i));
      if (posEl) posEl.textContent = (i+1) + " / " + pages.length;
      if (prevBtn){ prevBtn.disabled = (i === 0);
        const s = prevBtn.querySelector("small"); if (s) s.textContent = i>0 ? (pages[i-1].dataset.title || "") : "—"; }
      if (nextBtn){ nextBtn.disabled = (i === pages.length-1);
        const s = nextBtn.querySelector("small"); if (s) s.textContent = i<pages.length-1 ? (pages[i+1].dataset.title || "") : "Fin"; }
      if (push) history.replaceState(null, "", "#" + pages[i].id);
      const content = document.querySelector(".content");
      if (content) content.scrollTop = 0;
      PP.repaint(pages[i]);                                   // síncrono: dibuja aunque rAF esté pausado
      requestAnimationFrame(() => PP.repaint(pages[i]));       // reintento tras layout, por las dudas
      document.dispatchEvent(new CustomEvent("pp:show", {detail:{id: pages[i].id, el: pages[i]}}));
    }

    links.forEach(l => l.addEventListener("click", e => {
      e.preventDefault();
      const t = pages.findIndex(p => p.id === l.dataset.target);
      if (t >= 0) show(t, true);
    }));
    if (prevBtn) prevBtn.addEventListener("click", () => show(idx-1, true));
    if (nextBtn) nextBtn.addEventListener("click", () => show(idx+1, true));

    document.addEventListener("keydown", e => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "ArrowLeft") { show(idx-1, true); }
      else if (e.key === "ArrowRight") { show(idx+1, true); }
    });

    const h = location.hash.replace("#", "");
    const start = pages.findIndex(p => p.id === h);
    show(start >= 0 ? start : 0, false);

    addEventListener("resize", () => { clearTimeout(window._rz); window._rz = setTimeout(() => PP.repaint(pages[idx]), 120); });
  });
})();

/* ===== divisor arrastrable: ancho del panel izquierdo (todas las páginas) ===== */
(function(){
  "use strict";
  var KEY = "ee-sidew";
  document.addEventListener("DOMContentLoaded", function(){
    var app = document.querySelector(".app");
    var side = document.querySelector(".sidenav");
    if (!app || !side) return;
    var root = document.documentElement;

    function setW(px){ root.style.setProperty("--side-w", px + "px"); root.style.setProperty("--side-max", "none"); }
    function clearW(){ root.style.removeProperty("--side-w"); root.style.removeProperty("--side-max"); }
    function clamp(x){ return Math.max(190, Math.min(x, Math.min(600, window.innerWidth * 0.5))); }

    try { var s = parseInt(localStorage.getItem(KEY), 10); if (s) setW(clamp(s)); } catch(e){}

    var dv = document.createElement("div");
    dv.className = "side-resizer";
    dv.setAttribute("role", "separator");
    dv.setAttribute("aria-orientation", "vertical");
    dv.title = "Arrastrá para ajustar el ancho · doble clic para restablecer";
    side.insertAdjacentElement("afterend", dv);

    var dragging = false, rafPending = false;
    function scheduleRepaint(){ if (rafPending) return; rafPending = true; requestAnimationFrame(function(){ rafPending = false; if (window.PP && PP.repaint) PP.repaint(document); }); }

    dv.addEventListener("pointerdown", function(e){
      if (window.innerWidth <= 960) return;
      dragging = true; dv.classList.add("dragging");
      try { dv.setPointerCapture(e.pointerId); } catch(_){}
      document.body.style.userSelect = "none"; document.body.style.cursor = "col-resize";
      e.preventDefault();
    });
    dv.addEventListener("pointermove", function(e){
      if (!dragging) return;
      var w = clamp(e.clientX - app.getBoundingClientRect().left);
      setW(w); scheduleRepaint();
    });
    function end(){
      if (!dragging) return;
      dragging = false; dv.classList.remove("dragging");
      document.body.style.userSelect = ""; document.body.style.cursor = "";
      var cur = parseInt(getComputedStyle(side).width, 10);
      try { localStorage.setItem(KEY, cur); } catch(_){}
      scheduleRepaint();
    }
    dv.addEventListener("pointerup", end);
    dv.addEventListener("pointercancel", end);
    dv.addEventListener("dblclick", function(){ clearW(); try { localStorage.removeItem(KEY); } catch(_){} scheduleRepaint(); });
  });
})();
