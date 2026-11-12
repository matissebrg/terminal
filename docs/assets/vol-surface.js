/* Implied-volatility surface in 3D (WebGL, no library): strike on one axis, expiry on the other, height = implied vol.
   Built from out-of-the-money quotes only (puts below spot, calls above), wide or empty quotes dropped.
   T.volSurface.build(o) is pure (tested under node); T.volSurface.mount(el, o) draws it and adds the table view. */
(function () {
  "use strict";
  const T = window.T, F = T.fmt || {};
  const VS = (T.volSurface = {});
  const DAY = 864e5;

  // ------------------------------------------------------------------ data -> regular grid
  VS.build = (o, now = Date.now()) => {
    const S = o && o.spot;
    if (!S || !o.chains) return null;
    const rows = [];
    Object.keys(o.chains).sort().forEach((date) => {
      const days = (new Date(date + "T21:00:00Z").getTime() - now) / DAY;       // 16:00 New York
      if (days < 3) return;                                                      // the last days before expiry: wings are noise
      const pts = [];
      (o.chains[date] || []).forEach((r) => {
        const k = r.strike, side = k < S ? "p" : "c", iv = r[side + "_iv"], bid = r[side + "_bid"], ask = r[side + "_ask"];
        if (!(iv >= 0.05 && iv <= 3) || !(bid > 0) || !(ask > bid)) return;
        if ((ask - bid) / ((ask + bid) / 2) > 0.6) return;                       // quote too wide to mean anything
        pts.push([k / S, iv]);
      });
      pts.sort((a, b) => a[0] - b[0]);
      if (pts.length >= 4 && pts[0][0] <= 0.97 && pts[pts.length - 1][0] >= 1.03) rows.push({ date, days, pts, lo: pts[0][0], hi: pts[pts.length - 1][0] });
    });
    if (rows.length < 3) return null;
    // Strike range: everything quoted between 70 % and 135 % of spot. Each expiry only fills the part it really
    // quotes (ok[] marks it): the surface is ragged rather than extrapolated.
    const lo = Math.max(0.7, Math.min(...rows.map((r) => r.lo))), hi = Math.min(1.35, Math.max(...rows.map((r) => r.hi)));
    const NX = 31, xs = Array.from({ length: NX }, (_, i) => lo + ((hi - lo) * i) / (NX - 1));
    const at = (pts, m) => {                                                    // linear interpolation along strikes
      let j = 1; while (j < pts.length - 1 && pts[j][0] < m) j++;
      const a = pts[j - 1], b = pts[j], t = Math.min(1, Math.max(0, (m - a[0]) / (b[0] - a[0] || 1)));
      return a[1] + (b[1] - a[1]) * t;
    };
    const pad = ((hi - lo) / (NX - 1)) * 0.5;
    rows.forEach((r) => {
      const raw = xs.map((m) => at(r.pts, m));
      r.ok = xs.map((m) => m >= r.lo - pad && m <= r.hi + pad);
      r.iv = raw.map((v, i) => (i === 0 || i === NX - 1 || !r.ok[i - 1] || !r.ok[i + 1] ? v : 0.25 * raw[i - 1] + 0.5 * v + 0.25 * raw[i + 1]));   // light smoothing of quote noise
    });
    // between two expiries: total variance (iv² × time) is interpolated linearly, the usual convention
    const SUB = 3, grid = [];
    for (let e = 0; e < rows.length; e++) {
      grid.push({ days: rows[e].days, date: rows[e].date, iv: rows[e].iv, ok: rows[e].ok, real: true });
      if (e === rows.length - 1) break;
      const a = rows[e], b = rows[e + 1];
      for (let s = 1; s < SUB; s++) {
        const d = a.days + ((b.days - a.days) * s) / SUB;
        // the quoted range also slides from one expiry's to the next's, so the edge is a slope and not a staircase
        const f = (d - a.days) / (b.days - a.days), sl = a.lo + (b.lo - a.lo) * f, sh = a.hi + (b.hi - a.hi) * f;
        grid.push({ days: d, date: null, real: false, ok: xs.map((m) => m >= sl - pad && m <= sh + pad), iv: xs.map((_, i) => {
          const wa = a.iv[i] * a.iv[i] * a.days, wb = b.iv[i] * b.iv[i] * b.days;
          return Math.sqrt(Math.max(1e-8, (wa + ((wb - wa) * (d - a.days)) / (b.days - a.days)) / d));
        }) });
      }
    }
    let mn = Infinity, mx = -Infinity;
    grid.forEach((g) => g.iv.forEach((v, i) => { if (!g.ok[i]) return; if (v < mn) mn = v; if (v > mx) mx = v; }));
    const atmI = xs.reduce((b, m, i) => (Math.abs(m - 1) < Math.abs(xs[b] - 1) ? i : b), 0);
    return { spot: S, xs, grid, rows, lo, hi, min: mn, max: mx, atmI, asof: o.asof };
  };

  // ------------------------------------------------------------------ tiny matrix kit (column-major, like WebGL)
  const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
  const persp = (fovy, asp, n, f) => { const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = (2 * f * n) / (n - f); return o; };
  const look = (eye, c) => {
    let z = [eye[0] - c[0], eye[1] - c[1], eye[2] - c[2]]; const zl = Math.hypot(...z); z = z.map((v) => v / zl);
    let x = [z[2], 0, -z[0]]; const xl = Math.hypot(...x); x = x.map((v) => v / xl);            // up = +y
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const d = (a) => -(a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2]);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, d(x), d(y), d(z), 1]);
  };
  const ramp = (t) => {                                                         // one hue, dark -> light (sequential)
    const stops = [[0.07, 0.11, 0.24], [0.16, 0.33, 0.72], [0.42, 0.62, 0.98], [0.90, 0.94, 1.0]];
    const u = Math.min(0.9999, Math.max(0, t)) * 3, i = Math.floor(u), f = u - i;
    return stops[i].map((v, k) => v + (stops[i + 1][k] - v) * f);
  };

  // ------------------------------------------------------------------ view
  VS.mount = (el, o) => {
    const D = VS.build(o);
    if (!D) {
      el.innerHTML = '<div class="empty">Pas assez de cotations exploitables pour tracer une surface (il faut au moins trois échéances cotées de part et d\'autre du cours).</div>';
      return null;
    }
    const pctS = (v, d = 1) => F.pct(v, d), NX = D.xs.length, NZ = D.grid.length;
    const zmax = Math.sqrt(D.grid[NZ - 1].days), zmin = Math.sqrt(D.grid[0].days);
    const step = (D.max - D.min) > 0.4 ? 0.2 : (D.max - D.min) > 0.16 ? 0.1 : 0.05;
    const y0 = Math.floor(D.min / step) * step, y1 = Math.ceil(D.max / step) * step;
    const X = (m) => -1 + (2 * (m - D.lo)) / (D.hi - D.lo), Z = (days) => -1 + (2 * (Math.sqrt(days) - zmin)) / (zmax - zmin || 1), Y = (iv) => ((iv - y0) / (y1 - y0 || 1)) * 1.05;   // nearest expiry at the back: its tall smile hides nothing
    const narrow = window.innerWidth < 640;                                      // phone: fewer labels, they would collide
    const mTicks = (narrow ? [0.8, 1, 1.2] : [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3]).filter((m) => m >= D.lo - 1e-9 && m <= D.hi + 1e-9);
    const real = D.grid.filter((g) => g.real);
    // expiry labels: short expiries crowd together on a square-root time axis, so keep only those far enough apart
    const eTicks = []; for (let i = real.length - 1; i >= 0; i--) { const g = real[i]; if (!eTicks.length || Z(eTicks[eTicks.length - 1].days) - Z(g.days) >= (narrow ? 0.5 : 0.2)) eTicks.push(g); }
    const yTicks = []; for (let v = y0; v <= y1 + 1e-9; v += step) yTicks.push(+v.toFixed(4));
    const cols = [0.8, 0.9, 0.95, 1, 1.05, 1.1, 1.2].filter((m) => m >= D.lo - 1e-9 && m <= D.hi + 1e-9);
    const ivAt = (g, m) => { const u = ((m - D.lo) / (D.hi - D.lo)) * (NX - 1), i = Math.min(NX - 2, Math.floor(u)); return g.ok[i] && g.ok[i + 1] ? g.iv[i] + (g.iv[i + 1] - g.iv[i]) * (u - i) : null; };
    const atm = real.map((g) => g.iv[D.atmI]);
    el.innerHTML = `<div class="vs">
      <div class="vs-stage" tabindex="0" role="img" aria-label="Surface de volatilité implicite : à la monnaie, ${pctS(atm[0])} à ${Math.round(real[0].days)} jours et ${pctS(atm[atm.length - 1])} à ${Math.round(real[real.length - 1].days)} jours. Le tableau en dessous donne toutes les valeurs.">
        <canvas></canvas><div class="vs-labels" aria-hidden="true"></div><i class="vs-dot" hidden></i><div class="vs-tip" hidden></div>
        <div class="vs-hint">Glisser pour tourner · flèches du clavier</div></div>
      <div class="vs-legend"><span class="num">${pctS(D.min, 0)}</span><i></i><span class="num">${pctS(D.max, 0)}</span><span class="muted">volatilité implicite · ligne blanche = à la monnaie · cotations du ${F.dateTime(D.asof)}</span></div>
      <details class="vs-table"><summary class="sec">Voir les valeurs en tableau</summary><div class="tbl-wrap"><table class="t"><thead><tr><th>Échéance</th><th class="n">Jours</th>
        ${cols.map((m) => `<th class="n">${m === 1 ? "Au cours" : F.n(m * 100, 0) + " %"}<span class="yoy muted">${F.n(m * D.spot, 0)} $</span></th>`).join("")}</tr></thead><tbody>
        ${real.map((g) => `<tr><td>${F.date(g.date)}</td><td class="n">${F.n(g.days, 0)}</td>${cols.map((m) => { const v = ivAt(g, m); return `<td class="n">${v == null ? '<span class="muted">-</span>' : pctS(v)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div></details>
      <p class="note">Options hors de la monnaie uniquement (puts sous le cours, calls au-dessus) ; les cotations vides ou à écart trop large sont écartées. Entre deux échéances, la variance totale est interpolée linéairement. Strike en % du cours (${F.px(D.spot)}).</p></div>`;
    const stage = el.querySelector(".vs-stage"), cv = el.querySelector("canvas"), tip = el.querySelector(".vs-tip"), dot = el.querySelector(".vs-dot"), labels = el.querySelector(".vs-labels");
    const gl = cv.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) { stage.remove(); el.querySelector(".vs-legend").remove(); el.querySelector("details").open = true; return null; }

    // geometry: surface triangles, mesh lines, at-the-money ridge, floor grid
    const P = [], C = [], idx = [], lineP = [], lineC = [], pos = (i, j) => [X(D.xs[i]), Y(D.grid[j].iv[i]), Z(D.grid[j].days)];
    const ok = (i, j) => i >= 0 && j >= 0 && i < NX && j < NZ && D.grid[j].ok[i], nb = (i, j, i0, j0) => (ok(i, j) ? pos(i, j) : pos(i0, j0));
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const p = pos(i, j), a = nb(i + 1, j, i, j), b = nb(i - 1, j, i, j), c = nb(i, j + 1, i, j), d = nb(i, j - 1, i, j);
      const ux = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], uz = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
      let n = [ux[1] * uz[2] - ux[2] * uz[1], ux[2] * uz[0] - ux[0] * uz[2], ux[0] * uz[1] - ux[1] * uz[0]]; const nl = Math.hypot(...n) || 1; n = n.map((v) => Math.abs(v / nl));
      const shade = 0.62 + 0.38 * Math.min(1, n[1] * 0.9 + n[0] * 0.35), col = ramp((D.grid[j].iv[i] - D.min) / (D.max - D.min || 1));
      P.push(...p); C.push(col[0] * shade, col[1] * shade, col[2] * shade);
    }
    for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) { if (!(ok(i, j) && ok(i + 1, j) && ok(i, j + 1) && ok(i + 1, j + 1))) continue; const a = j * NX + i; idx.push(a, a + 1, a + NX, a + 1, a + NX + 1, a + NX); }
    const seg = (a, b, c) => { lineP.push(...a, ...b); lineC.push(...c, ...c); };
    const meshC = [0.72, 0.80, 1.0], floorC = [0.16, 0.20, 0.30], ridgeC = [1, 1, 1];
    for (let j = 0; j < NZ; j++) if (D.grid[j].real) for (let i = 0; i < NX - 1; i++) if (ok(i, j) && ok(i + 1, j)) seg(pos(i, j), pos(i + 1, j), meshC);          // one line per real expiry
    for (let i = 0; i < NX; i += 3) for (let j = 0; j < NZ - 1; j++) if (ok(i, j) && ok(i, j + 1)) seg(pos(i, j), pos(i, j + 1), meshC.map((v) => v * 0.6));
    const ridgeStart = lineP.length / 3, ridgeCount = 0;
    // at-the-money term structure: a thin white ribbon laid on the surface (WebGL lines cannot be made thicker)
    const ribP = [], ribC = [], hw = 0.014, lift = 0.006;
    for (let j = 0; j < NZ - 1; j++) { const a = pos(D.atmI, j), b = pos(D.atmI, j + 1);
      const q = [[a[0] - hw, a[1] + lift, a[2]], [a[0] + hw, a[1] + lift, a[2]], [b[0] - hw, b[1] + lift, b[2]], [b[0] + hw, b[1] + lift, b[2]]];
      [0, 1, 2, 1, 3, 2].forEach((k) => { ribP.push(...q[k]); ribC.push(...ridgeC); }); }
    mTicks.forEach((m) => seg([X(m), 0, -1], [X(m), 0, 1], floorC));
    eTicks.forEach((g) => seg([-1, 0, Z(g.days)], [1, 0, Z(g.days)], floorC));
    yTicks.forEach((v) => { seg([-1, Y(v), -1], [1, Y(v), -1], floorC); seg([-1, Y(v), -1], [-1, Y(v), 1], floorC); });
    seg([-1, 0, -1], [-1, Y(y1), -1], floorC);

    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, "attribute vec3 p; attribute vec3 c; uniform mat4 m; varying vec3 v; void main(){ v = c; gl_Position = m * vec4(p, 1.0); }"));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, "precision mediump float; varying vec3 v; uniform float a; void main(){ gl_FragColor = vec4(v, a); }"));
    gl.linkProgram(pr); gl.useProgram(pr);
    const buf = (data, type) => { const b = gl.createBuffer(); gl.bindBuffer(type, b); gl.bufferData(type, data, gl.STATIC_DRAW); return b; };
    const bP = buf(new Float32Array(P), gl.ARRAY_BUFFER), bC = buf(new Float32Array(C), gl.ARRAY_BUFFER), bI = buf(new Uint16Array(idx), gl.ELEMENT_ARRAY_BUFFER);
    const bLP = buf(new Float32Array(lineP), gl.ARRAY_BUFFER), bLC = buf(new Float32Array(lineC), gl.ARRAY_BUFFER);
    const bRP = buf(new Float32Array(ribP), gl.ARRAY_BUFFER), bRC = buf(new Float32Array(ribC), gl.ARRAY_BUFFER);
    const aP = gl.getAttribLocation(pr, "p"), aC = gl.getAttribLocation(pr, "c"), uM = gl.getUniformLocation(pr, "m"), uA = gl.getUniformLocation(pr, "a");
    gl.enableVertexAttribArray(aP); gl.enableVertexAttribArray(aC);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // labels follow their 3D anchors
    const lab = [];
    const addLab = (p, text, cls) => { const s = document.createElement("span"); s.textContent = text; s.className = cls || ""; labels.appendChild(s); lab.push([p, s]); };
    mTicks.forEach((m) => addLab([X(m), 0, 1.14], m === 1 && !narrow ? `${F.n(D.spot, 0)} $ · au cours` : `${F.n(m * D.spot, 0)} $`, m === 1 ? "on" : ""));
    eTicks.forEach((g) => addLab([1.1, 0, Z(g.days)], `${new Date(g.date + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}${narrow ? "" : ` · ${F.n(g.days, 0)} j`}`, "l"));
    yTicks.forEach((v) => addLab([-1.07, Y(v), -1], pctS(v, 0), "r"));

    const cam = { yaw: -0.58, pitch: 0.44, dist: 4.25 }, base = { yaw: cam.yaw };
    let mvp = null, W = 0, H = 0, dirty = true, touched = false, raf = 0, hover = null, onScreen = true;
    const project = (p) => { const x = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12], y = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13], w = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
      return [(x / w * 0.5 + 0.5) * W, (1 - (y / w * 0.5 + 0.5)) * H]; };
    const size = () => { const r = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2); W = r.width; H = r.height;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); } dirty = true; };
    const draw = () => {
      if (!W || !H) return;
      const dist = cam.dist * Math.pow(Math.max(1, 1.75 / (W / H)), 0.85);       // a narrow stage (phone) steps back so nothing is cut
      const cy = Math.cos(cam.pitch), eye = [Math.sin(cam.yaw) * cy * dist, Math.sin(cam.pitch) * dist + 0.3, Math.cos(cam.yaw) * cy * dist];
      mvp = mul(persp(0.62, W / H, 0.1, 20), look(eye, [0, 0.3, 0]));
      gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(uM, false, mvp);
      gl.bindBuffer(gl.ARRAY_BUFFER, bP); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bC); gl.vertexAttribPointer(aC, 3, gl.FLOAT, false, 0, 0);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);                 // lines drawn after sit on top of the surface
      gl.uniform1f(uA, 0.93); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bI); gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindBuffer(gl.ARRAY_BUFFER, bLP); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bLC); gl.vertexAttribPointer(aC, 3, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uA, 0.5); gl.drawArrays(gl.LINES, 0, ridgeStart);
      gl.uniform1f(uA, 0.9); gl.drawArrays(gl.LINES, ridgeStart + ridgeCount, lineP.length / 3 - ridgeStart - ridgeCount);
      gl.bindBuffer(gl.ARRAY_BUFFER, bRP); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bRC); gl.vertexAttribPointer(aC, 3, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uA, 1); gl.drawArrays(gl.TRIANGLES, 0, ribP.length / 3);
      lab.forEach(([p, s]) => { const q = project(p); s.style.transform = `translate(${q[0].toFixed(1)}px, ${q[1].toFixed(1)}px)`; });
      if (hover) { const q = project(pos(hover.i, hover.j)); dot.style.transform = `translate(${q[0]}px, ${q[1]}px)`; }
    };
    const fxOn = () => !!(window.FX && window.FX.on());
    const loop = (t) => {
      raf = 0;
      if (!cv.isConnected) return;                                               // the page was left: stop
      if (!touched && fxOn() && !document.hidden) { cam.yaw = base.yaw + 0.2 * Math.sin(t / 5200); dirty = true; }
      if (dirty) { dirty = false; draw(); }
      if (!touched && fxOn() && W && onScreen) raf = requestAnimationFrame(loop);   // idle rotation only while it can be seen
    };
    const kick = () => { dirty = true; if (!raf) raf = requestAnimationFrame(loop); };
    const clamp = () => { cam.yaw = Math.max(-1.15, Math.min(0.05, cam.yaw)); cam.pitch = Math.max(0.2, Math.min(1.1, cam.pitch)); };

    let drag = null;
    stage.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: false }; });
    stage.addEventListener("pointermove", (e) => {
      const r = stage.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        if (!drag.moved) { if (e.pointerType === "touch" && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }   // a vertical swipe scrolls the page
          drag.moved = true; touched = true; try { stage.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } stage.classList.add("grab"); }
        cam.yaw = drag.yaw - dx * 0.008; cam.pitch = drag.pitch + dy * 0.006; clamp(); kick(); return;
      }
      if (!mvp) return;
      let best = null, bd = 26 * 26;
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { if (!ok(i, j)) continue; const q = project(pos(i, j)), d = (q[0] - mx) ** 2 + (q[1] - my) ** 2; if (d < bd) { bd = d; best = { i, j }; } }
      hover = best;
      if (!best) { tip.hidden = dot.hidden = true; return; }
      const g = D.grid[best.j], m = D.xs[best.i];
      tip.innerHTML = `<b class="num">${pctS(g.iv[best.i])}</b><span>${g.date ? F.date(g.date) : "entre deux échéances"} · ${F.n(g.days, 0)} j</span><span>strike ${F.n(m * D.spot, m * D.spot < 20 ? 2 : 0)} $ (${F.n(m * 100, 0)} % du cours)</span>`;
      tip.hidden = dot.hidden = false;
      const q = project(pos(best.i, best.j)); dot.style.transform = `translate(${q[0]}px, ${q[1]}px)`;
      tip.style.transform = `translate(${Math.min(W - 200, Math.max(4, q[0] + 14))}px, ${Math.max(4, q[1] - 66)}px)`;
    });
    const up = () => { drag = null; stage.classList.remove("grab"); };
    stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
    stage.addEventListener("pointerleave", () => { if (!drag) { hover = null; tip.hidden = dot.hidden = true; } });
    stage.addEventListener("keydown", (e) => {
      const k = { ArrowLeft: [0.09, 0], ArrowRight: [-0.09, 0], ArrowUp: [0, 0.07], ArrowDown: [0, -0.07] }[e.key];
      if (!k) return; e.preventDefault(); touched = true; cam.yaw += k[0]; cam.pitch += k[1]; clamp(); kick();
    });
    if (window.ResizeObserver) new ResizeObserver(() => { size(); kick(); }).observe(stage); else window.addEventListener("resize", () => { size(); kick(); });
    if (window.IntersectionObserver) new IntersectionObserver((en) => { onScreen = en[0].isIntersecting; if (onScreen) kick(); }).observe(stage);
    size(); kick();
    return { data: D };
  };
})();
