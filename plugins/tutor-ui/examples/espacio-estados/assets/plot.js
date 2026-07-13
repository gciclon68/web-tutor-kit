/* ===== Espacio de Estados · motor de gráficos compartido (PP) ===== */
(function(){
  "use strict";
  const PP = window.PP = window.PP || {};
  PP.reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
  PP.css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  // --- repaint registry: canvases only draw when their page is visible ---
  PP.paints = [];
  PP.register = (el, fn) => { PP.paints.push({el, fn}); };
  PP.isVisible = el => !!(el && el.offsetParent !== null && el.clientWidth > 2);
  PP.repaint = scope => {
    PP.paints.forEach(p => {
      if (scope && !(scope === document || scope.contains(p.el) || p.el === scope)) return;
      if (PP.isVisible(p.el)) { try { p.fn(); } catch(e){ console.error(e); } }
    });
  };

  // --- canvas sizing (hiDPI) ---
  PP.fit = (cv, h) => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = cv.clientWidth || (cv.parentElement ? cv.parentElement.clientWidth : 0);
    if (w < 4) return null;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + "px";
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return {ctx, w, h};
  };

  // world <-> screen transform. world: x in [-X,X], y in [-Y,Y]
  PP.makeTf = (w, h, X, Y, pad) => {
    pad = pad || 16;
    return {
      sx: x => pad + (x + X)/(2*X)*(w-2*pad),
      sy: y => h - pad - (y + Y)/(2*Y)*(h-2*pad),
      X, Y, w, h, pad
    };
  };

  PP.axes = (ctx, tf, opts) => {
    opts = opts || {};
    ctx.strokeStyle = PP.css("--grid"); ctx.lineWidth = 1;
    for (let x = Math.ceil(-tf.X); x <= tf.X; x++){ ctx.beginPath(); ctx.moveTo(tf.sx(x), tf.pad); ctx.lineTo(tf.sx(x), tf.h-tf.pad); ctx.stroke(); }
    for (let y = Math.ceil(-tf.Y); y <= tf.Y; y++){ ctx.beginPath(); ctx.moveTo(tf.pad, tf.sy(y)); ctx.lineTo(tf.w-tf.pad, tf.sy(y)); ctx.stroke(); }
    ctx.strokeStyle = PP.css("--ink-soft"); ctx.globalAlpha = .5; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(tf.pad, tf.sy(0)); ctx.lineTo(tf.w-tf.pad, tf.sy(0)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tf.sx(0), tf.pad); ctx.lineTo(tf.sx(0), tf.h-tf.pad); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = PP.css("--ink-soft"); ctx.font = "11px ui-monospace,monospace";
    if (opts.lx !== false) ctx.fillText(opts.lx || "x₁", tf.w-24, tf.sy(0)-6);
    if (opts.ly !== false) ctx.fillText(opts.ly || "x₂", tf.sx(0)+6, tf.pad+10);
  };

  PP.arrow = (ctx, x1, y1, x2, y2, col, wd) => {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = wd || 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const a = Math.atan2(y2-y1, x2-x1), s = 7;
    ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - s*Math.cos(a-.4), y2 - s*Math.sin(a-.4));
    ctx.lineTo(x2 - s*Math.cos(a+.4), y2 - s*Math.sin(a+.4));
    ctx.closePath(); ctx.fill();
  };

  // vector field of A (A can be constant fn or fn of t)
  PP.field = (ctx, tf, Afn, t, col, scale, n) => {
    col = col || PP.css("--ink-soft"); scale = scale || 0.16; n = n || 11;
    ctx.globalAlpha = .48;
    for (let i=0;i<n;i++) for (let j=0;j<n;j++){
      const x = -tf.X + 2*tf.X*i/(n-1);
      const y = -tf.Y + 2*tf.Y*j/(n-1);
      const A = Afn(t);
      let dx = A[0][0]*x + A[0][1]*y, dy = A[1][0]*x + A[1][1]*y;
      const m = Math.hypot(dx,dy) || 1e-9; const L = Math.min(m,6);
      dx = dx/m*L*scale; dy = dy/m*L*scale;
      PP.arrow(ctx, tf.sx(x), tf.sy(y), tf.sx(x+dx), tf.sy(y+dy), col, 1.1);
    }
    ctx.globalAlpha = 1;
  };

  // integrate trajectory with RK4
  PP.traj = (Afn, x0, t0, tEnd, dt) => {
    const pts = []; let x = x0.slice(), t = t0;
    const f = (t,s) => { const A = Afn(t); return [A[0][0]*s[0]+A[0][1]*s[1], A[1][0]*s[0]+A[1][1]*s[1]]; };
    const N = Math.ceil((tEnd-t0)/dt);
    for (let i=0;i<=N;i++){
      pts.push([x[0], x[1], t]);
      const k1 = f(t, x);
      const k2 = f(t+dt/2, [x[0]+dt/2*k1[0], x[1]+dt/2*k1[1]]);
      const k3 = f(t+dt/2, [x[0]+dt/2*k2[0], x[1]+dt/2*k2[1]]);
      const k4 = f(t+dt,   [x[0]+dt*k3[0],   x[1]+dt*k3[1]]);
      x = [x[0]+dt/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]), x[1]+dt/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1])];
      t += dt;
    }
    return pts;
  };

  PP.drawTraj = (ctx, tf, pts, col, w, upto) => {
    upto = (upto == null ? pts.length : upto);
    ctx.strokeStyle = col; ctx.lineWidth = w || 2.4; ctx.beginPath();
    for (let i=0;i<upto;i++){ const p = pts[i]; const px = tf.sx(p[0]), py = tf.sy(p[1]); i ? ctx.lineTo(px,py) : ctx.moveTo(px,py); }
    ctx.stroke();
  };

  PP.dot = (ctx, tf, p, col, r) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(tf.sx(p[0]), tf.sy(p[1]), r || 4.5, 0, 7); ctx.fill(); };

  // animation loop that auto-pauses when the canvas is not visible
  PP.animate = (cv, stepFn) => {
    let raf = null;
    function loop(){
      if (PP.isVisible(cv)) stepFn();
      raf = requestAnimationFrame(loop);
    }
    loop();
    return () => { if (raf) cancelAnimationFrame(raf); };
  };
})();
