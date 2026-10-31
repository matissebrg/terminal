/* Biotech: rNPV of the pipeline (with simulator), catalysts with market-implied odds and options-implied
   moves, ClinicalTrials.gov tracker. Ticker tab (T.tabBiotech) and cross-ticker page (#/biotech). */
(function () {
  "use strict";
  const T = window.T, F = T.fmt, C = () => T.C;
  const STAGES = { phase1: "Phase 1", phase2: "Phase 2", phase3: "Phase 3", filed: "Déposé", marketed: "Commercialisé" };
  const md = (v) => (T.isNum(v) ? F.n(v / 1e6, 0) + " M$" : "-");
  const mdd = (v) => (T.isNum(v) ? F.n(v / 1e9, 2) + " Md$" : "-");
  const pc = (v, d = 0) => (T.isNum(v) ? F.pct(v, d) : "-");
  const days = (n) => (n > 0 ? `J-${n}` : n === 0 ? "aujourd'hui" : `il y a ${-n} j`);

  T.getBio = (tk) => T.get(`${tk}/biotech.json`).catch(() => null);

  // ------------------------------------------------------------------ helpers shared by both views
  function implied(p) {
    if (!T.isNum(p)) return '<span class="muted">-</span>';
    if (p > 1) return `<span class="down" title="Même un succès certain ne suffit pas à justifier le cours avec tes autres hypothèses : le marché est plus optimiste ailleurs, ou tes pics de ventes sont trop bas.">&gt; 100 %</span>`;
    if (p < 0) return `<span class="up" title="Le cours est sous ta valeur même si ce programme échoue : le marché est plus pessimiste ailleurs, ou tes hypothèses sont trop hautes.">&lt; 0 %</span>`;
    return F.pct(p, 0);
  }
  function optMove(c) {
    const o = c.options; if (!o) return '<span class="muted">-</span>';
    if (o.reliable === false) return `<span class="muted" title="Écarts acheteur-vendeur trop larges sur les options à la monnaie : le prix des options ne dit rien de fiable.">cotations trop larges</span>`;
    const ev = T.isNum(o.event_move) ? `±${F.pct(o.event_move, 1)}` : null;
    return `${ev ? `<b>${ev}</b> <span class="muted">événement</span><br>` : ""}<span class="muted">straddle ${F.date(o.expiry)} ±${F.pct(o.straddle_move, 1)}</span>`;
  }
  function volVerdict(c) {
    if (!T.isNum(c.vol_edge) || (c.options && c.options.reliable === false)) return "";
    const ref = c.options && T.isNum(c.options.event_move) ? c.options.event_move : c.options && c.options.straddle_move;
    if (!T.isNum(ref) || !ref) return "";
    const r = c.expected_abs_move / ref;
    if (r < 0.7) return `<span class="tag" title="Les options anticipent un mouvement plus grand que ton modèle : la volatilité est chère si tu as raison (vendre de la volatilité, en couvrant le risque binaire).">options chères ×${F.n(1 / r, 1)}</span>`;
    if (r > 1.4) return `<span class="tag" title="Ton modèle attend un mouvement plus grand que ce que les options anticipent : la volatilité est bon marché si tu as raison (acheter un straddle).">options bon marché ×${F.n(r, 1)}</span>`;
    return '<span class="tag">options alignées</span>';
  }

  // ------------------------------------------------------------------ members: probability on a catalyst
  const memberOk = () => T.members && T.members.configured && T.member;
  async function myCatalystPreds(ids) {
    if (!memberOk() || !ids.length) return {};
    const r = await T.members.sb.from("catalyst_predictions").select("catalyst_id, p, note, user_id").eq("user_id", T.member.id).in("catalyst_id", ids);
    return Object.fromEntries((r.data || []).map((x) => [x.catalyst_id, x]));
  }
  function predCell(dbid, c, mine) {
    if (!memberOk()) return '<span class="muted" title="Réservé aux membres connectés">-</span>';
    const open = !c.outcome && c.days >= 1;
    if (!open) return mine ? `<b>${F.pct(+mine.p, 0)}</b>` : '<span class="muted">clos</span>';
    return `<form class="cpf row" data-id="${T.esc(dbid)}" style="gap:4px;flex-wrap:nowrap;justify-content:flex-end">
      <input class="sel num" name="p" type="number" min="1" max="99" step="1" value="${mine ? Math.round(+mine.p * 100) : ""}" placeholder="%" style="width:58px">
      <button class="btn btn-xs">${mine ? "Modifier" : "Parier"}</button></form><div class="cpc muted" data-crowd="${T.esc(dbid)}" style="font-size:11px;text-align:right"></div>`;
  }
  async function wirePredictions(root, rows) {
    if (!memberOk()) return;
    const crowd = async (id) => {
      const r = await T.members.sb.rpc("catalyst_crowd", { p_catalyst: id });
      const x = (r.data || [])[0]; const el = root.querySelector(`[data-crowd="${CSS.escape(id)}"]`);
      if (el && x) el.textContent = x.visible ? `groupe ${F.pct(+x.mean, 0)} (n=${x.n})` : x.n ? `${x.n} membre(s) · donne ta probabilité pour voir le groupe` : "";
    };
    rows.forEach((id) => crowd(id).catch(() => {}));
    root.querySelectorAll("form.cpf").forEach((f) => f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = +f.querySelector("input").value;
      if (!(v >= 1 && v <= 99)) { f.querySelector("input").focus(); return; }
      const r = await T.members.sb.rpc("predict_catalyst", { p_catalyst: f.dataset.id, p_prob: v / 100 });
      const btn = f.querySelector("button");
      if (r.error) { btn.textContent = "Erreur"; btn.title = r.error.message; return; }
      btn.textContent = "Enregistré ✓"; crowd(f.dataset.id);
      if (T.badges && T.badges.refresh) T.badges.refresh();
    }));
  }

  // ------------------------------------------------------------------ YAML export of the simulator
  function yamlBlock(cfg) {
    const q = (s) => (/^[\w .,()'/+-]+$/.test(String(s)) && !/^\d/.test(String(s)) ? String(s) : JSON.stringify(String(s)));
    const L = ["rnpv:", `  primary: ${cfg.primary !== false}`, `  discount_rate: ${cfg.discount_rate}`, `  tax_rate: ${cfg.tax_rate}`,
      `  horizon: ${cfg.horizon}`, `  net_cash: ${cfg.net_cash ?? "auto"}`, "  corporate:", `    annual_cost: ${Math.round((cfg.corporate || {}).annual_cost || 0)}`,
      `    years: ${(cfg.corporate || {}).years ?? 10}`, "  assets:"];
    (cfg.assets || []).forEach((a) => {
      L.push(`    - name: ${q(a.name)}`);
      ["indication", "stage", "area", "pos", "launch_year", "peak_sales", "years_to_peak", "loe_year", "royalty_rate", "share", "dev_cost", "cogs_pct", "opex_pct", "post_loe_decline"]
        .forEach((k) => { if (a[k] != null && a[k] !== "" && !(k === "pos" && a[k] === "auto")) L.push(`      ${k}: ${typeof a[k] === "number" ? +a[k].toFixed(4) : q(a[k])}`); });
    });
    return L.join("\n");
  }

  // ================================================================== ticker tab
  T.tabBiotech = async (el, tk, co) => {
    if (T.members && T.members.configured) await T.members.ready;
    const bio = await T.getBio(tk);
    if (!bio) { el.innerHTML = '<div class="empty">Pas de module biotech pour cette valeur. Ajoute un bloc <code>rnpv:</code>, <code>catalysts:</code> ou <code>trials:</code> dans <code>config/assumptions/' + tk + '.yaml</code>.</div>'; return; }
    const r = bio.rnpv, cats = bio.catalysts || [], tr = bio.trials || {}, rw = bio.runway;
    const next = cats.find((c) => c.days >= 0 && !c.outcome);
    el.innerHTML = `
      ${r ? `<div class="kpis kpis-5" id="bk"></div>` : '<p class="note">Pas encore de modèle rNPV : ajoute un bloc <code>rnpv:</code> au fichier d\'hypothèses (modèle : BBIO).</p>'}
      ${r ? `<div class="grid g2" style="margin-top:14px">
        <div class="panel"><h3>Somme des parties <span class="hint">$ par action</span></h3><div class="chart" id="bsotp" style="height:300px"></div></div>
        <div class="panel"><h3>Flux de trésorerie pondérés par le risque <span class="hint">Md$ par an, par programme</span></h3><div class="chart" id="bcf" style="height:300px"></div></div>
      </div>
      <div class="panel" style="margin-top:14px"><h3>Programmes <span class="hint">modifie les cases : le modèle se recalcule (rien n'est enregistré)</span></h3>
        <div class="row" style="margin-bottom:8px;gap:14px">
          <label class="inl">Taux d'actualisation <input id="bdr" type="number" step="0.5" min="4" max="25" value="${+(r.discount_rate * 100).toFixed(2)}" class="sel" style="width:72px"> %</label>
          <label class="inl">Trésorerie nette <b>${mdd(r.net_cash)}</b> <span class="muted">(${T.esc(r.net_cash_source || "")})</span></label>
          <span class="spacer"></span><button class="btn btn-xs" id="breset">Réinitialiser</button><button class="btn btn-xs" id="byaml">Copier le YAML</button></div>
        <div class="tbl-wrap" id="btbl"></div>
        <p class="note">PoS = probabilité d'arriver sur le marché depuis le stade actuel. « auto » : produit des taux historiques restants (BIO 2011-2020) pour l'aire thérapeutique. Pic en M$ (part économique de la société). Une valeur si succès = le programme après réussite de son prochain événement.</p>
        <pre class="yaml" id="byout" hidden></pre></div>` : ""}
      <div class="panel" style="margin-top:14px"><h3>Catalyseurs <span class="hint">probabilités et mouvements attendus</span></h3><div class="tbl-wrap" id="bcat"></div>
        <p class="note"><b>Base</b> : taux historique de l'étape. <b>Modèle</b> : ta probabilité (PoS du programme hors étapes suivantes). <b>Marché</b> : probabilité qui égalise ton modèle et le cours, toutes tes autres hypothèses tenues (lecture : au-dessus de 100 %, le cours demande plus que ce succès). <b>Si succès / échec</b> : saut du cours selon ton modèle. <b>Options</b> : mouvement anticipé par les options ; « événement » isole le catalyseur en retirant la volatilité ordinaire mesurée sur l'échéance précédente.</p></div>
      <div class="grid g2" style="margin-top:14px">
        <div class="panel"><h3>Lectures d'essais attendues <span class="hint">ClinicalTrials.gov · phases 2-3 · 18 mois</span></h3><div id="bread"></div></div>
        <div class="panel"><h3>Essais <span class="hint">${tr.count || 0} enregistrés · source ${T.esc(tr.source || "-")}</span></h3><div id="btr"></div></div>
      </div>
      ${r ? `<div class="panel" style="margin-top:14px"><h3>Taux de succès historiques utilisés <span class="hint">${T.esc(r.base_rates.source)}</span></h3><div class="tbl-wrap" id="brates"></div></div>` : ""}`;

    // ---- catalysts
    const dbid = (c) => `${tk}:${c.id}`;
    const mine = await myCatalystPreds(cats.map(dbid)).catch(() => ({}));
    T.$("#bcat").innerHTML = cats.length ? `<table class="t"><thead><tr><th>Date</th><th>Événement</th><th>Programme</th><th class="n">Base</th><th class="n">Modèle</th><th class="n">Marché</th><th class="n">Si succès</th><th class="n">Si échec</th><th class="n">Attendu (modèle)</th><th class="n">Options</th><th></th><th class="n">Ta probabilité</th></tr></thead><tbody>
      ${cats.map((c) => `<tr><td>${F.date(c.date)}<br><span class="muted">${c.outcome ? T.esc(c.status) : days(c.days)}${c.confirmed ? "" : " · date estimée"}</span></td>
        <td>${T.esc(c.kind_label)}${c.source ? ` <a href="${T.esc(c.source)}" target="_blank" rel="noopener">↗</a>` : ""}<br><span class="muted">${T.esc(c.title || "")}</span></td>
        <td>${T.esc(c.asset || "-")}<br><span class="muted">${T.esc(c.stage_label || "")}</span></td>
        <td class="n">${pc(c.p_base)}</td><td class="n"><b>${pc(c.p_model)}</b></td><td class="n">${implied(c.p_market)}</td>
        <td class="n up">${T.isNum(c.move_up) ? F.pct(c.move_up, 1, true) : "-"}</td><td class="n down">${T.isNum(c.move_down) ? F.pct(c.move_down, 1, true) : "-"}</td>
        <td class="n">${T.isNum(c.expected_abs_move) ? "±" + F.pct(c.expected_abs_move, 1) : "-"}</td><td class="n">${optMove(c)}</td><td>${volVerdict(c)}</td>
        <td class="n">${predCell(dbid(c), c, mine[dbid(c)])}</td></tr>`).join("")}</tbody></table>`
      : '<div class="muted">Aucun catalyseur saisi (bloc <code>catalysts:</code> du fichier d\'hypothèses).</div>';
    wirePredictions(T.$("#bcat"), cats.filter((c) => !c.outcome).map(dbid));
    const past = cats.filter((c) => c.reaction);
    if (past.length) {
      T.$("#bcat").insertAdjacentHTML("afterend", `<div class="group-title" style="margin-top:12px">Bilan des catalyseurs passés <span class="hint">ce que le modèle et les options attendaient la veille, et ce qui s'est passé</span></div>
        <div class="tbl-wrap"><table class="t"><thead><tr><th>Date</th><th>Événement</th><th>Issue</th><th class="n">Probabilité (base / modèle)</th><th class="n">Attendu si succès / échec</th><th class="n">Options</th><th class="n">Réaction réelle</th></tr></thead><tbody>
        ${past.map((c) => { const p = c.pre_event || {}, rx = c.reaction;
          return `<tr><td>${F.date(c.date)}</td><td>${T.esc(c.kind_label)} · ${T.esc(c.asset || "")}</td><td>${c.outcome ? `<b class="${c.outcome === "success" ? "up" : c.outcome === "failure" ? "down" : ""}">${T.esc(c.status)}</b>` : '<span class="muted">non renseignée</span>'}</td>
            <td class="n">${pc(p.p_base)} / ${pc(p.p_model)}</td>
            <td class="n">${T.isNum(p.move_up) ? `<span class="up">${F.pct(p.move_up, 1, true)}</span> / <span class="down">${F.pct(p.move_down, 1, true)}</span>` : "-"}</td>
            <td class="n">${p.options && T.isNum(p.options.event_move) ? "±" + F.pct(p.options.event_move, 1) : p.options ? "±" + F.pct(p.options.straddle_move, 1) : "-"}</td>
            <td class="n"><b class="${T.cls(rx.move)}">${F.pct(rx.move, 1, true)}</b><br><span class="muted">${F.date(rx.from_date)} → ${F.date(rx.to_date)}</span></td></tr>`; }).join("")}</tbody></table></div>
        <p class="note">Une fois l'événement passé, renseigne <code>outcome: success</code> (ou <code>failure</code>, <code>mixed</code>) dans le bloc <code>catalysts</code> : les prédictions des membres sont notées, puis fais évoluer le programme (stade, probabilité) dans le bloc <code>rnpv</code>.</p>`);
    }

    // ---- trials
    const rd = tr.expected_readouts || [];
    T.$("#bread").innerHTML = rd.length ? rd.slice(0, 12).map((s) => `<div class="order-row"><span class="num">${F.date(s.primary_completion_date)}</span>
      <b>${T.esc(s.acronym || s.nct)}</b> <span class="tag">${T.esc(s.phase)}</span> <span class="muted">${T.esc((s.interventions || []).join(", "))} · ${T.esc((s.conditions || []).join(", "))}${s.primary_completion_type === "ESTIMATED" ? " · estimée" : ""}</span>
      <a href="https://clinicaltrials.gov/study/${s.nct}" target="_blank" rel="noopener">↗</a></div>`).join("")
      : `<div class="muted">${tr.source === "cache" && !tr.count ? "Pas encore de données (récupérées à la prochaine mise à jour)." : "Aucune fin principale d'essai de phase 2-3 dans les 18 mois."}</div>`;
    const act = tr.active_phase23 || [], stop = tr.stopped_recent || [];
    T.$("#btr").innerHTML = `${Object.keys(tr.by_status || {}).length ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">${Object.entries(tr.by_status).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="tag">${T.esc(k.toLowerCase().replace(/_/g, " "))} : ${n}</span>`).join("")}</div>` : ""}
      ${act.length ? `<div class="group-title">En cours, phases 2-3</div>${act.slice(0, 10).map((s) => `<div class="order-row"><b>${T.esc(s.acronym || s.nct)}</b> <span class="tag">${T.esc(s.phase)}</span> <span class="muted">${T.esc(s.title)}</span> <a href="https://clinicaltrials.gov/study/${s.nct}" target="_blank" rel="noopener">↗</a></div>`).join("")}` : ""}
      ${stop.length ? `<div class="group-title">Arrêtés, suspendus ou retirés</div>${stop.slice(0, 6).map((s) => `<div class="order-row"><b>${T.esc(s.acronym || s.nct)}</b> <span class="tag">${T.esc(s.phase)}</span> <span class="down">${T.esc((s.status || "").toLowerCase())}</span> <span class="muted">${T.esc(s.why_stopped || s.title)}</span></div>`).join("")}` : ""}`;

    if (!r) return;
    // ---- base rates table (only areas used)
    const used = [...new Set(r.assets.map((a) => (a.area || "all").toLowerCase()))];
    T.$("#brates").innerHTML = `<table class="t"><thead><tr><th>Aire</th><th class="n">Ph. 1 → 2</th><th class="n">Ph. 2 → 3</th><th class="n">Ph. 3 → dépôt</th><th class="n">Dépôt → approbation</th><th class="n">Phase 1 → marché</th></tr></thead><tbody>
      ${["all", ...used.filter((u) => u !== "all")].map((k) => { const a = r.base_rates.areas[k]; if (!a) return ""; const v = a.rates;
        return `<tr><td>${T.esc(a.label)}</td>${v.map((x) => `<td class="n">${F.pct(x, 1)}</td>`).join("")}<td class="n"><b>${F.pct(v.reduce((p, x) => p * x, 1), 1)}</b></td></tr>`; }).join("")}</tbody></table>`;

    // ---- simulator
    const orig = JSON.parse(JSON.stringify((await T.get(`${tk}/valuation.json`)).assumptions_raw.rnpv || {}));
    let cfg = JSON.parse(JSON.stringify(orig));
    const ctx = { net_cash: r.net_cash, shares: r.shares, price: bio.price, valuation_date: r.valuation_date };
    let sotp = null, cfc = null;
    const draw = () => {
      const res = window.RNPV.value(cfg, ctx);
      const tot = res.assets.reduce((s, a) => s + Math.max(0, a.rnpv), 0) || 1;
      T.$("#bk").innerHTML = [
        ["Valeur rNPV", F.px(res.value_per_share), `<span class="${T.cls(res.upside)}">${F.pct(res.upside, 1, true)}</span> vs cours ${F.px(bio.price)}`, "hl"],
        ["Valeur du pipeline", mdd(res.pipeline_value), `${res.assets.length} programme(s), pondérée du risque`],
        ["Frais centraux (VA)", mdd(res.overhead_pv), `${md((cfg.corporate || {}).annual_cost)}/an sur ${(cfg.corporate || {}).years || 10} ans, après impôt`],
        ["Autonomie financière", rw ? (rw.quarters == null ? "positive" : `${F.n(rw.quarters, 0)} trim.`) : "-",
          rw ? (rw.quarters == null ? `flux opérationnels positifs (${md(rw.cfo_q)}/trim.)` : `${mdd(rw.cash)} de trésorerie, ${md(rw.burn_q)} brûlés/trim.`) : "flux de trésorerie indisponibles", rw && rw.quarters != null && rw.quarters < 6 ? "warn" : ""],
        ["Prochain catalyseur", next ? days(next.days) : "-", next ? `${T.esc(next.kind_label)} · ${T.esc(next.asset || "")}` : "aucun saisi"],
      ].map(([l, v, s, c]) => `<div class="kpi ${c || ""}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");
      T.$("#btbl").innerHTML = `<table class="t"><thead><tr><th class="lbl">Programme</th><th>Stade</th><th class="n">PoS (base)</th><th class="n">PoS</th><th class="n">Pic M$</th><th class="n">Lancement</th><th class="n">Exclusivité</th><th class="n">rNPV $/action</th><th class="n">Si succès</th><th class="n">Part</th></tr></thead><tbody>
        ${res.assets.map((a, i) => `<tr><td class="lbl"><b>${T.esc(a.name)}</b><br><span class="muted">${T.esc(a.indication || "")}</span>${a.note ? `<br><span class="hint" style="color:var(--warn)">${T.esc(a.note)}</span>` : ""}</td>
          <td>${STAGES[a.stage] || a.stage}<br><span class="muted">${T.esc(((r.base_rates.areas[(a.area || "all").toLowerCase()] || {}).label) || a.area || "")}</span></td>
          <td class="n">${F.pct(a.pos_base, 1)}</td>
          <td class="n"><input class="sel num" data-i="${i}" data-k="pos" type="number" min="0" max="100" step="1" value="${+(a.pos * 100).toFixed(1)}" style="width:66px"${a.stage === "marketed" ? " disabled" : ""}> %</td>
          <td class="n"><input class="sel num" data-i="${i}" data-k="peak_sales" type="number" min="0" step="50" value="${Math.round(a.peak_sales / 1e6)}" style="width:82px"></td>
          <td class="n"><input class="sel num" data-i="${i}" data-k="launch_year" type="number" min="2000" max="2060" step="1" value="${a.launch_year}" style="width:70px"></td>
          <td class="n">${a.loe_year || "-"}</td>
          <td class="n"><b>${F.n(a.per_share, 2)}</b></td><td class="n">${T.isNum(a.value_if_success) ? F.n(a.value_if_success / res.shares, 2) : "-"}</td>
          <td class="n">${F.pct(Math.max(0, a.rnpv) / tot, 0)}</td></tr>`).join("")}
        <tr class="total"><td class="lbl">Trésorerie nette</td><td colspan="6"></td><td class="n">${F.n(res.net_cash / res.shares, 2)}</td><td colspan="2"></td></tr>
        <tr class="total"><td class="lbl">Frais centraux</td><td colspan="6"></td><td class="n">${F.n(res.overhead_pv / res.shares, 2)}</td><td colspan="2"></td></tr>
        <tr class="total"><td class="lbl">Valeur par action</td><td colspan="6"></td><td class="n"><b>${F.px(res.value_per_share)}</b></td><td colspan="2"></td></tr></tbody></table>`;
      // waterfall (sum of the parts)
      const parts = [...res.assets.map((a) => [a.name, a.per_share]), ["Trésorerie nette", res.net_cash / res.shares], ["Frais centraux", res.overhead_pv / res.shares]];
      if (res.other_value) parts.push(["Autres", res.other_value / res.shares]);
      let run = 0; const base = [], val = [];
      parts.forEach(([, v]) => { const lo = v >= 0 ? run : run + v; base.push(+lo.toFixed(4)); val.push({ value: +Math.abs(v).toFixed(4), itemStyle: { color: v >= 0 ? C().series[0] : C().down } }); run += v; });
      const names = [...parts.map(([n]) => n.length > 22 ? n.slice(0, 21) + "…" : n), "Valeur"];
      base.push(0); val.push({ value: +run.toFixed(4), itemStyle: { color: C().accent } });
      if (sotp) sotp.dispose();
      sotp = T.ec(T.$("#bsotp"), { grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true }, legend: { show: false },
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => { const p = ps[1]; const v = parts[p.dataIndex]; return `${T.esc(v ? v[0] : "Valeur par action")} : ${F.n(v ? v[1] : run, 2)} $`; } },
        xAxis: T.axis({ type: "value", position: "top" }),
        yAxis: T.axis({ type: "category", inverse: true, data: names, splitLine: { show: false }, axisLabel: { color: C().text2, fontSize: 11 } }),
        series: [{ type: "bar", stack: "w", data: base, itemStyle: { color: "transparent" }, emphasis: { disabled: true } },
          { type: "bar", stack: "w", data: val, barMaxWidth: 18, label: { show: true, position: "right", color: C().text2, fontSize: 10, formatter: (p) => F.n(p.dataIndex < parts.length ? parts[p.dataIndex][1] : run, 1) } },
          { type: "line", data: names.map(() => bio.price), symbol: "none", lineStyle: { color: C().warn, type: "dashed", width: 1 }, markLine: undefined }] });
      // risked cash flows
      const years = [...new Set(res.assets.flatMap((a) => a.series.map((s) => s.year)))].sort();
      if (cfc) cfc.dispose();
      cfc = T.ec(T.$("#bcf"), { grid: { left: 8, right: 8, top: 34, bottom: 8, containLabel: true },
        legend: { type: "scroll", top: 0, textStyle: { color: C().text2, fontSize: 10 } },
        tooltip: { trigger: "axis", valueFormatter: (v) => F.n(v, 2) + " Md$" },
        xAxis: T.axis({ type: "category", data: years, splitLine: { show: false } }), yAxis: T.axis({ type: "value" }),
        series: res.assets.map((a, i) => ({ name: a.name, type: "bar", stack: "cf", data: years.map((y) => { const s = a.series.find((x) => x.year === y); return s ? +(s.risked_cf / 1e9).toFixed(3) : 0; }),
          itemStyle: { color: C().series[i % C().series.length] } })) });
      T.$$("#btbl input").forEach((inp) => inp.addEventListener("change", () => {
        const a = cfg.assets[+inp.dataset.i], k = inp.dataset.k, v = +inp.value;
        if (!isFinite(v)) return;
        a[k] = k === "pos" ? v / 100 : k === "peak_sales" ? v * 1e6 : Math.round(v);
        draw();
      }));
    };
    draw();
    T.$("#bdr").addEventListener("change", (e) => { const v = +e.target.value; if (isFinite(v) && v > 0) { cfg.discount_rate = v / 100; draw(); } });
    T.$("#breset").addEventListener("click", () => { cfg = JSON.parse(JSON.stringify(orig)); T.$("#bdr").value = +(cfg.discount_rate * 100).toFixed(2); T.$("#byout").hidden = true; draw(); });
    T.$("#byaml").addEventListener("click", async () => {
      const y = yamlBlock(cfg); const out = T.$("#byout"); out.textContent = y; out.hidden = false;
      try { await navigator.clipboard.writeText(y); T.$("#byaml").textContent = "YAML copié ✓"; } catch (e) { T.$("#byaml").textContent = "Sélectionne le YAML ci-dessous"; }
    });
  };

  // ================================================================== cross-ticker page
  T.route(/^\/biotech$/, async (view) => {
    if (T.members && T.members.configured) await T.members.ready;
    const b = await T.get("biotech.json").catch(() => null);
    if (!b) { view.innerHTML = '<div class="empty">Le module biotech sera disponible après la prochaine mise à jour.</div>'; return; }
    const cal = b.calendar || [];
    const today = new Date().toISOString().slice(0, 10);
    const up = cal.filter((c) => c.date >= today || (!c.outcome && c.kind !== "trial"));
    const soon = up.filter((c) => (new Date(c.date) - new Date(today)) / 864e5 <= 90 && c.kind !== "trial").length;
    const st = { kind: null, tk: null, past: false };
    view.innerHTML = `<div class="thead"><div class="id"><h1>Biotech</h1><div class="sub">Catalyseurs, probabilités de succès et ce que le marché en pense · ${Object.keys(b.tickers || {}).length} valeur(s) suivie(s)</div></div></div>
      <div class="kpis kpis-4">
        <div class="kpi"><div class="l">Valeurs santé suivies</div><div class="v">${Object.keys(b.tickers || {}).length}</div><div class="s">${Object.values(b.tickers || {}).filter((x) => T.isNum(x.rnpv)).length} avec modèle rNPV</div></div>
        <div class="kpi hl"><div class="l">Catalyseurs à 90 jours</div><div class="v">${soon}</div><div class="s">décisions FDA, résultats d'essais, comités</div></div>
        <div class="kpi"><div class="l">Fins d'essais attendues</div><div class="v">${cal.filter((c) => c.kind === "trial" && c.date >= today).length}</div><div class="s">phases 2-3, 18 mois, ClinicalTrials.gov</div></div>
        <div class="kpi"><div class="l">Taux de succès phase 1 → marché</div><div class="v">${F.pct(b.base_rates.areas.all.rates.reduce((p, x) => p * x, 1), 1)}</div><div class="s">toutes aires · maladies rares ${F.pct(b.base_rates.areas.rare.rates.reduce((p, x) => p * x, 1), 1)}</div></div></div>
      <div class="panel" style="margin-top:14px"><h3>Calendrier des catalyseurs</h3>
        <div class="row" id="bf" style="margin-bottom:8px;gap:6px;flex-wrap:wrap">
          ${[["pdufa", "Décisions FDA"], ["readout", "Résultats d'essais"], ["adcom", "Comités"], ["trial", "Fins d'essais (CT.gov)"]].map(([k, l]) => `<button class="chip" data-kind="${k}">${l}</button>`).join("")}
          <span class="spacer"></span>${Object.keys(b.tickers || {}).map((t) => `<button class="chip" data-tk="${t}">${t}</button>`).join("")}
          <button class="chip" data-past="1">passés</button></div>
        <div class="tbl-wrap" id="bcal"></div></div>
      <div class="grid g2" style="margin-top:14px">
        <div class="panel"><h3>Couverture santé</h3><div class="tbl-wrap"><table class="t"><thead><tr><th>Valeur</th><th class="n">Cours</th><th class="n">rNPV</th><th class="n">Potentiel</th><th class="n">Essais</th><th>Prochain catalyseur</th></tr></thead><tbody>
          ${Object.entries(b.tickers || {}).map(([t, x]) => `<tr><td><a href="#/t/${t}/biotech"><b>${t}</b></a></td><td class="n">${F.px(x.price)}</td><td class="n">${F.px(x.rnpv)}</td><td class="n ${T.cls(x.upside)}">${F.pct(x.upside, 1, true)}</td><td class="n">${x.trials ?? "-"}</td>
            <td>${x.next ? `${F.date(x.next.date)} · ${T.esc(x.next.kind_label)} <span class="muted">${T.esc(x.next.asset || "")}</span>` : '<span class="muted">-</span>'}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="panel"><h3>Taux de succès historiques <span class="hint">${T.esc(b.base_rates.source)}</span></h3><div class="tbl-wrap"><table class="t"><thead><tr><th>Aire</th><th class="n">1→2</th><th class="n">2→3</th><th class="n">3→dépôt</th><th class="n">→ approb.</th><th class="n">Ph.1 → marché</th></tr></thead><tbody>
          ${Object.entries(b.base_rates.areas).sort((x, y) => y[1].rates.reduce((p, v) => p * v, 1) - x[1].rates.reduce((p, v) => p * v, 1)).map(([, a]) => `<tr><td>${T.esc(a.label)}</td>${a.rates.map((v) => `<td class="n">${F.pct(v, 0)}</td>`).join("")}<td class="n"><b>${F.pct(a.rates.reduce((p, v) => p * v, 1), 1)}</b></td></tr>`).join("")}</tbody></table></div></div>
      </div>
      <div class="panel members-only" style="margin-top:14px"><h3>Classement des prévisionnistes <span class="hint">score de Brier sur les catalyseurs résolus · plus bas = meilleur</span></h3><div class="tbl-wrap" id="bscore"></div></div>
      <div class="panel" style="margin-top:14px"><h3>Lire un catalyseur</h3><div class="sec">
        <p><b>1. La probabilité de base.</b> Une décision de la FDA sur un dossier déposé réussit ~91 % du temps (94 % dans les maladies rares) ; une phase 3 mène à un dépôt ~58 % du temps ; une phase 2, ~29 %. C'est le point de départ, à ajuster : biomarqueur de sélection, résultats de phase 2, examen prioritaire, historique de l'équipe.</p>
        <p><b>2. Ce que le marché price.</b> Avec la rNPV, on cherche la probabilité qui égalise le modèle et le cours. Si le marché demande 70 % là où la base dit 58 % et que tu n'as pas d'argument spécifique, l'action est chère sur ce catalyseur ; si le cours tient même avec un échec, le risque est faible.</p>
        <p><b>3. Le mouvement attendu.</b> Succès et échec ne sont pas symétriques : une approbation largement attendue fait peu monter le titre, un refus le fait chuter. Les options donnent le mouvement que le marché anticipe ; s'il est très au-dessus de ton mouvement attendu, la volatilité est chère (et inversement).</p>
        <p class="muted">Modèle simplifié et hypothèses de départ à retravailler : pas un conseil en investissement.</p></div></div>`;
    const ids = cal.filter((c) => c.kind !== "trial").map((c) => `${c.ticker}:${c.id}`);
    const mine = await myCatalystPreds(ids).catch(() => ({}));
    if (memberOk()) {
      T.members.sb.rpc("catalyst_scores").then((r) => {
        const rows = r.data || [];
        T.$("#bscore").innerHTML = rows.length ? `<table class="t"><thead><tr><th>Membre</th><th class="n">Catalyseurs</th><th class="n">Brier</th><th class="n">Brier des taux historiques</th><th class="n">Gain vs base</th></tr></thead><tbody>
          ${rows.map((x) => `<tr><td><span data-user="${T.esc(x.username)}">${T.esc(x.username)}</span></td><td class="n">${x.n}</td><td class="n"><b>${F.n(+x.brier, 3)}</b></td><td class="n">${F.n(+x.base_brier, 3)}</td><td class="n ${T.cls(+x.skill)}">${T.isNum(+x.skill) ? F.pct(+x.skill, 0, true) : "-"}</td></tr>`).join("")}</tbody></table>`
          : '<div class="muted">Aucun catalyseur résolu pour l\'instant. Donne ta probabilité avant chaque événement : le score se calcule quand l\'issue est connue.</div>';
        if (T.badges && T.badges.decorate) T.badges.decorate(T.$("#bscore"));
      });
    }
    const draw = () => {
      const list = cal.filter((c) => (st.past || c.date >= today || (!c.outcome && c.kind !== "trial")) && (!st.kind || c.kind === st.kind) && (!st.tk || c.ticker === st.tk));
      const t0 = new Date(today);
      T.$("#bcal").innerHTML = list.length ? `<table class="t"><thead><tr><th>Date</th><th>Valeur</th><th>Événement</th><th>Programme / essai</th><th class="n">Base</th><th class="n">Modèle</th><th class="n">Marché</th><th class="n">Si succès / échec</th><th class="n">Options</th><th class="n">Ta probabilité</th></tr></thead><tbody>
        ${list.map((c) => { const d = Math.round((new Date(c.date) - t0) / 864e5);
          return `<tr><td>${F.date(c.date)}<br><span class="muted">${c.outcome ? T.esc(c.status) : days(d)}${c.confirmed ? "" : " · estimée"}</span></td>
          <td><a href="#/t/${c.ticker}/biotech"><b>${c.ticker}</b></a></td>
          <td>${T.esc(c.kind_label)}${c.phase ? ` <span class="tag">${T.esc(c.phase)}</span>` : ""}</td>
          <td>${T.esc(c.asset || "")}<br><span class="muted">${T.esc((c.title || "").slice(0, 110))}</span>${c.nct ? ` <a href="https://clinicaltrials.gov/study/${c.nct}" target="_blank" rel="noopener">${c.nct} ↗</a>` : ""}</td>
          <td class="n">${pc(c.p_base)}</td><td class="n">${pc(c.p_model)}</td><td class="n">${implied(c.p_market)}</td>
          <td class="n">${T.isNum(c.move_up) ? `<span class="up">${F.pct(c.move_up, 1, true)}</span> / <span class="down">${F.pct(c.move_down, 1, true)}</span>` : "-"}</td>
          <td class="n">${optMove(c)} ${volVerdict(c)}</td>
          <td class="n">${c.kind === "trial" ? '<span class="muted">-</span>' : predCell(`${c.ticker}:${c.id}`, { ...c, days: d }, mine[`${c.ticker}:${c.id}`])}</td></tr>`; }).join("")}</tbody></table>` : '<div class="muted">Rien avec ces filtres.</div>';
      wirePredictions(T.$("#bcal"), list.filter((c) => c.kind !== "trial" && !c.outcome).map((c) => `${c.ticker}:${c.id}`));
      T.$$("#bf .chip").forEach((x) => x.classList.toggle("on", x.dataset.kind === st.kind || x.dataset.tk === st.tk || (x.dataset.past && st.past)));
    };
    T.$("#bf").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return;
      if (c.dataset.kind) st.kind = st.kind === c.dataset.kind ? null : c.dataset.kind;
      if (c.dataset.tk) st.tk = st.tk === c.dataset.tk ? null : c.dataset.tk;
      if (c.dataset.past) st.past = !st.past; draw(); });
    draw();
  });
})();
