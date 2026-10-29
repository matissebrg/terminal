/* Prédictions (registre horodaté par Git) et Options. */
(function () {
  "use strict";
  const T = window.T, F = T.fmt, C = () => T.C;

  const STATUS = {
    pending: ["En attente des chiffres", "st-pending"], partial: ["Partiellement vérifiée", "st-partial"],
    resolved: ["Vérifiée", "st-resolved"], late: ["Hors délai (non comptée)", "st-late"],
  };
  const BENCH = { naive: "Modèle naïf", guidance: "Guidance", consensus: "Consensus" };

  // ------------------------------------------------------------------ formatting helpers
  const shown = (m, v) => {               // raw -> unit shown to the user
    if (!T.isNum(v)) return "-";
    if (m.kind === "margin" || m.unit === "%") return F.n(v * 100, 1) + " %";
    if (m.unit === "Md$") return F.n(v / 1e9, 2) + " Md$";
    return F.n(v, 2) + " $";
  };
  const errTxt = (m, x) => {
    if (!x) return "-";
    if (m.kind === "margin") return (x.error_pts > 0 ? "+" : "") + F.n(x.error_pts, 2) + " pt";
    return F.pct(x.error_pct, 1, true);
  };
  const benchErr = (m, v) => (v == null ? "-" : m.kind === "margin" ? (v > 0 ? "+" : "") + F.n(v, 2) + " pt" : F.pct(v, 1, true));
  const fmtDeadline = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
  const daysTo = (iso) => (iso ? Math.ceil((new Date(iso) - Date.now()) / 864e5) : null);
  const ghFile = (id) => T.repoUrl(`blob/main/${id}`);

  // ------------------------------------------------------------------ prediction card (shared)
  function card(r, opts = {}) {
    const [st, cls] = STATUS[r.status] || [r.status, ""];
    const metrics = (r.metrics || []).map((m) => {
      const chips = [];
      if (m.in_interval === true) chips.push('<span class="chip-s ok">dans l\'intervalle</span>');
      if (m.in_interval === false) chips.push('<span class="chip-s ko">hors intervalle</span>');
      Object.entries(m.vs || {}).forEach(([b, v]) => chips.push(`<span class="chip-s ${v.you_win ? "ok" : "ko"}">${v.you_win ? "bat" : "battu par"} ${BENCH[b].toLowerCase()}</span>`));
      if (m.surprise_call) chips.push(`<span class="chip-s ${m.surprise_call.correct ? "ok" : "ko"}">surprise ${m.surprise_call.correct ? "bien anticipée" : "mal anticipée"}</span>`);
      const b = m.benchmarks || {};
      return `<tr><td>${T.esc(m.label)}</td>
        <td class="n"><b>${shown(m, m.value)}</b>${T.isNum(m.low) && T.isNum(m.high) ? `<span class="yoy muted">${shown(m, m.low)} à ${shown(m, m.high)}</span>` : ""}</td>
        <td class="n">${shown(m, m.actual)}</td>
        <td class="n ${m.actual != null && (m.kind === "margin" ? Math.abs(m.error_pts) <= 0.5 : Math.abs(m.error_pct) <= 0.02) ? "up" : ""}">${m.actual != null ? errTxt(m, m) : "-"}</td>
        ${["naive", "guidance", "consensus"].map((k) => `<td class="n">${shown(m, b[k])}${m.vs && m.vs[k] ? `<span class="yoy muted">${benchErr(m, m.vs[k].error)}</span>` : ""}</td>`).join("")}
        <td class="wrap">${chips.join(" ")}${m.consensus_eps_non_gaap ? `<span class="muted" title="Consensus Yahoo, généralement non-GAAP : non comparé au BPA GAAP"> consensus non-GAAP ${F.n(m.consensus_eps_non_gaap, 2)} $</span>` : ""}</td></tr>`;
    }).join("");
    const prices = (r.price || []).map((p) => `<tr><td>Cours ${T.esc(p.ticker)} au ${F.date(p.date)} <span class="muted">(horizon ${p.horizon_days} j)</span></td>
      <td class="n"><b>${F.px(p.value)}</b>${T.isNum(p.low) && T.isNum(p.high) ? `<span class="yoy muted">${F.n(p.low, 0)} à ${F.n(p.high, 0)}</span>` : ""}</td>
      <td class="n">${F.px(p.actual)}</td><td class="n">${p.actual != null ? F.pct(p.error_pct, 1, true) : "-"}</td><td colspan="3"></td>
      <td>${p.in_interval === true ? '<span class="chip-s ok">dans l\'intervalle</span>' : p.in_interval === false ? '<span class="chip-s ko">hors intervalle</span>' : ""}</td></tr>`).join("");
    const events = (r.events || []).map((e) => `<div class="evq"><span>${T.esc(e.question)}</span>
      <span class="num">${F.pct(e.probability, 0)}</span>
      <span>${e.outcome === null ? '<span class="muted">non résolue</span>' : e.outcome ? '<span class="chip-s ok">oui</span>' : '<span class="chip-s ko">non</span>'}</span>
      <span class="num muted">${T.isNum(e.brier) ? "Brier " + F.n(e.brier, 3) : ""}</span></div>`).join("");
    const when = r.release_date ? `publié le ${F.date(r.release_date)}` : r.expected_release ? `publication ${r.expected_estimated ? "estimée" : "prévue"} le ${F.date(r.expected_release)}` : "";
    return `<div class="pcard">
      <div class="pcard-h"><div><b>${T.esc(r.ticker)} ${T.esc(r.period || "")}</b> <span class="badge ${cls}">${st}</span>
        ${r.verified ? '<span class="badge st-git" title="Horodatée par un commit Git">horodatée Git</span>' : '<span class="badge st-late">non commitée</span>'}
        ${r.edited_after_deadline ? '<span class="badge st-partial" title="Des modifications après la date limite existent : elles sont ignorées">modifiée après la limite</span>' : ""}</div>
        <div class="muted num" style="font-size:11.5px">enregistrée ${F.dateTime(r.registered_at)} · ${when}</div></div>
      ${r.status === "late" ? `<p class="note" style="margin-top:0">Enregistrée le ${F.date((r.registered_at || "").slice(0, 10))}, après le début du jour de publication (${F.date(r.release_date)}) : elle reste visible mais n'entre pas dans les scores.</p>` : ""}
      ${metrics || prices ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Indicateur</th><th class="n">Ma prévision</th><th class="n">Réel</th><th class="n">Erreur</th>
        <th class="n">Naïf</th><th class="n">Guidance</th><th class="n">Consensus</th><th>Verdict</th></tr></thead><tbody>${metrics}${prices}</tbody></table></div>` : ""}
      ${events ? `<div class="group-title" style="margin-top:10px">Questions oui / non</div><div class="evqs">${events}</div>` : ""}
      ${r.note ? `<blockquote class="pnote">${T.esc(r.note)}</blockquote>` : ""}
      ${opts.noLink ? "" : `<div class="note"><a href="${ghFile(r.id)}" target="_blank" rel="noopener">Voir le fichier et son historique sur GitHub ↗</a></div>`}
    </div>`;
  }

  // ------------------------------------------------------------------ scoreboard (shared)
  function scoreboard(sum) {
    const rev = (sum.by_metric || {}).revenue;
    const all = Object.values(sum.by_metric || {});
    const agg = (b) => { let n = 0, w = 0; all.forEach((m) => { if (m.vs[b]) { n += m.vs[b].n; w += m.vs[b].wins; } }); return n ? [w, n] : null; };
    const cov = (() => { let n = 0, h = 0; all.forEach((m) => { n += m.interval.n; h += m.interval.hit; }); return n ? [h, n] : null; })();
    const vc = agg("consensus"), vn = agg("naive");
    const k = (l, v, s, hl) => `<div class="kpi ${hl ? "hl" : ""}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    const c = sum.counts || {};
    return `<div class="kpis">
      ${k("Prédictions", `${(c.resolved || 0) + (c.partial || 0)} vérifiée${(c.resolved || 0) + (c.partial || 0) > 1 ? "s" : ""}`, `${c.pending || 0} en attente · ${c.late || 0} hors délai`, true)}
      ${k("Erreur CA", rev ? F.pct(rev.mean_abs_error, 1) : "-", rev ? `moyenne sur ${rev.n} trimestre${rev.n > 1 ? "s" : ""}` : "aucune vérifiée")}
      ${k("Biais CA", rev ? F.pct(rev.bias, 1, true) : "-", rev ? (rev.bias > 0 ? "trop optimiste" : rev.bias < 0 ? "trop pessimiste" : "neutre") : "+ = trop optimiste")}
      ${k("Intervalles 80 %", cov ? F.pct(cov[0] / cov[1], 0) : "-", cov ? `${cov[0]} sur ${cov[1]} (cible 80 %)` : "cible 80 %")}
      ${k("vs consensus", vc ? `${vc[0]} / ${vc[1]}` : "-", "fois plus précis")}
      ${k("vs naïf", vn ? `${vn[0]} / ${vn[1]}` : "-", "fois plus précis")}
      ${k("Oui / non", sum.events ? F.n(sum.events.brier, 3) : "-", sum.events ? `Brier, ${sum.events.n} résolue${sum.events.n > 1 ? "s" : ""} (0,25 = hasard)` : "Brier : plus bas = mieux")}
    </div>`;
  }

  // ------------------------------------------------------------------ global page
  T.route(/^\/predictions$/, async (view) => {
    const P = await T.get("predictions.json");
    const preds = P.predictions || [];
    const MB = T.members;
    if (MB) await MB.ready;
    const db = !!(MB && MB.configured && T.member);
    // every covered stock's next release, soonest first (open windows before closed ones)
    const upcoming = Object.entries(P.next || {}).filter(([, n]) => n && n.date)
      .map(([tk, n]) => ({ tk, ...n, days: daysTo(n.deadline) }))
      .sort((a, b) => ((a.days > 0) === (b.days > 0) ? a.date.localeCompare(b.date) : a.days > 0 ? -1 : 1));
    const nextTk = upcoming.length ? upcoming[0].tk : null;
    const nx = nextTk ? upcoming[0] : null;
    view.innerHTML = `<div class="thead"><div class="id"><h1>Prédictions</h1>
        <div class="sub">Tes prévisions, horodatées avant la publication puis comparées aux chiffres réels</div></div>
        ${nextTk ? `<a class="btn primary" href="#/t/${nextTk}/predictions">Nouvelle prédiction ${T.esc(nextTk)} ${T.esc(nx.period || "")}</a>` : ""}</div>
      ${db ? "" : scoreboard(P.summary || {})}
      ${upcoming.map((u) => `<div class="panel deadline-bar"><div><a href="#/t/${u.tk}/predictions"><b>${T.esc(u.tk)} ${T.esc(u.period || "")}</b></a> · publication ${u.estimated ? "estimée" : "prévue"} le <b>${F.date(u.date)}</b>
        <span class="muted">(${T.esc(u.source || "")})</span></div>
        <div class="row">${u.days != null && u.days > 0 ? `<span>Clôture dans <b class="num">${u.days} j</b> · ${fmtDeadline(u.deadline)}</span> <a class="btn" href="#/t/${u.tk}/predictions">Prédire</a>` : "Fenêtre fermée, en attente des chiffres"}</div></div>`).join("")}
      ${db ? `<div class="group-title" style="margin-top:22px">Mes prédictions <span class="muted" style="text-transform:none;letter-spacing:0">espace membre</span></div><div id="pmine"></div>
        <div class="group-title" style="margin-top:22px">Registre public du fondateur <span class="muted" style="text-transform:none;letter-spacing:0">fichiers horodatés par Git</span></div>${scoreboard(P.summary || {})}` : ""}
      ${MB && MB.configured && !T.member ? `<div class="banner" style="margin-top:14px">◎ <div>Membre de la bêta ? <a href="#/compte">Connecte-toi</a> pour enregistrer tes prédictions dans ton espace et te comparer au groupe. Ci-dessous : le registre public du fondateur.</div></div>` : ""}
      ${preds.length || db ? "" : `<div class="panel" style="margin-top:14px"><h3>Comment ça marche</h3>
        <div class="steps">
          <div><b>1. Prévois</b><p>Dans l'onglet Prédictions d'une valeur, saisis ton CA, tes marges, ton BPA, avec un intervalle de confiance à 80 %.</p></div>
          <div><b>2. Horodate</b><p>Le bouton « Enregistrer sur GitHub » ouvre un fichier pré-rempli : un commit, et ta prévision est datée de façon vérifiable.</p></div>
          <div><b>3. Vérifie</b><p>À la publication, le terminal compare automatiquement au réel, au consensus figé la veille, à la guidance et à un modèle naïf.</p></div>
          <div><b>4. Progresse</b><p>Erreur moyenne, biais (optimiste ou pessimiste), calibration de tes intervalles : tu sais enfin si tu as un avantage.</p></div>
        </div></div>`}
      <div class="grid g2" style="margin-top:14px" id="pcharts"></div>
      ${(P.errors || []).length ? `<div class="banner">⚠ <div><b>Fichiers de prédiction invalides :</b> ${P.errors.map(T.esc).join(" · ")}</div></div>` : ""}
      <div class="stack" style="margin-top:14px">${preds.map((r) => card(r)).join("")}</div>`;
    charts(P);
    if (db) MB.renderMine(T.$("#pmine"));
  });

  function charts(P) {
    const box = T.$("#pcharts");
    const res = (P.predictions || []).filter((r) => r.status !== "late");
    const rows = [];
    res.forEach((r) => (r.metrics || []).forEach((m) => { if (m.key === "revenue" && m.actual != null) rows.push({ r, m }); }));
    const ev = (P.summary || {}).events;
    let html = "";
    if (rows.length) html += `<div class="panel"><h3>Erreur sur le CA <span class="hint">toi vs consensus vs naïf</span></h3><div class="chart" id="pc1"></div></div>`;
    if (ev && ev.calibration && ev.calibration.length) html += `<div class="panel"><h3>Calibration des probabilités</h3><div class="chart" id="pc2"></div></div>`;
    box.innerHTML = html;
    if (!html) { box.remove(); return; }
    if (rows.length) {
      const lab = rows.map((x) => x.r.period);
      const s = (key, name, color) => ({ name, type: "bar", barMaxWidth: 18, itemStyle: { color, borderRadius: [3, 3, 0, 0] },
        data: rows.map((x) => { const v = key === "you" ? x.m.error_pct : x.m.vs && x.m.vs[key] ? x.m.vs[key].error : null; return T.isNum(v) ? +(v * 100).toFixed(2) : null; }) });
      T.ec(T.$("#pc1"), {
        legend: { data: ["Toi", "Consensus", "Naïf"] }, tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "-" : F.n(v, 1) + " %") },
        xAxis: T.axis({ type: "category", data: lab, splitLine: { show: false } }),
        yAxis: T.axis({ type: "value", axisLabel: { color: C().muted, formatter: (v) => v + " %" } }),
        series: [s("you", "Toi", C().series[0]), s("consensus", "Consensus", C().series[1]), s("naive", "Naïf", C().neutral)],
      });
    }
    if (ev && ev.calibration && ev.calibration.length) {
      T.ec(T.$("#pc2"), {
        tooltip: { formatter: (p) => (p.seriesIndex ? `${p.data[2]}<br>probabilité moyenne ${F.pct(p.data[0] / 100, 0)}<br>fréquence réelle ${F.pct(p.data[1] / 100, 0)}` : "") },
        grid: { left: 8, right: 14, top: 30, bottom: 28, containLabel: true },
        xAxis: T.axis({ type: "value", min: 0, max: 100, name: "probabilité annoncée (%)", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: C().muted } }),
        yAxis: T.axis({ type: "value", min: 0, max: 100, name: "réalisé %", nameTextStyle: { color: C().muted } }),
        series: [{ type: "line", data: [[0, 0], [100, 100]], showSymbol: false, lineStyle: { color: C().neutral, width: 1 }, silent: true },
          { type: "scatter", data: ev.calibration.map((b) => [b.mean_prob * 100, b.freq * 100, `${b.bin} (n = ${b.n})`]),
            symbolSize: (d) => 10, itemStyle: { color: C().series[0], borderColor: C().panel, borderWidth: 2 } }],
      });
    }
  }

  // ------------------------------------------------------------------ ticker tab: Prédictions
  T.tabPredictions = async function (el, tk) {
    const [ctx, P] = await Promise.all([T.get(`${tk}/predict.json`), T.get("predictions.json")]);
    const MB = T.members;
    if (MB) await MB.ready;
    const db = !!(MB && MB.configured && T.member);
    const nx = ctx.next || {}, rel = nx.release || {};
    const d = daysTo(rel.deadline);
    const mine = (P.predictions || []).filter((r) => r.ticker === tk);
    const M = ctx.metrics;
    const keys = Object.keys(M);
    const hist = M.revenue.history;
    const lastQ = hist.slice(-4);
    const store = (() => { try { return JSON.parse(localStorage.getItem(`archer-draft-${tk}`) || "null"); } catch (e) { return null; } })();
    const draft = Object.assign({ period: nx.label, metrics: {}, price: [], events: [], questions: {}, note: "", visibility: "group" }, store || {});
    if (draft.period !== nx.label && !(draft.period || "").startsWith("FY")) draft.period = nx.label;
    const fyLabel = nx.label && !db ? "FY" + nx.fy : null;

    // members' space: the prediction lives in the database (rules enforced server side)
    let dbs = null;
    if (db) {
      draft.period = nx.label;
      try { dbs = await MB.loadPrediction(tk, nx.label); } catch (e) { dbs = { error: e.message }; }
      const pr = dbs && dbs.pred;
      if (pr) {
        const str = (v) => (v == null ? "" : String(v).replace(".", ","));
        draft.metrics = Object.fromEntries(Object.entries(pr.metrics || {}).map(([k, v]) => [k, { value: str(v.value), low: str(v.low), high: str(v.high) }]));
        draft.questions = Object.fromEntries((pr.questions || []).map((q) => [q.id, str(q.p)]));
        draft.price = (pr.price_targets || []).map((t) => ({ date: t.date, value: str(t.value), low: str(t.low), high: str(t.high) }));
        draft.note = pr.note || "";
        draft.visibility = pr.visibility;
      }
    }
    const dbDeadline = db && dbs && dbs.period ? dbs.period.deadline : null;
    const dbClosed = db && (!dbs || dbs.error || !dbs.period || (dbDeadline && new Date(dbDeadline) <= new Date()));
    const dbMsg = !db ? "" : dbs && dbs.error ? `Base indisponible : ${dbs.error}`
      : !dbs.period ? `La période ${nx.label} n'est pas encore ouverte dans la base : elle le sera à la prochaine mise à jour du site.`
      : dbClosed ? "Date limite passée : la prédiction ne peut plus être créée ni modifiée." : "";

    el.innerHTML = `
      <div class="panel deadline-bar"><div><b>Prochaine publication : ${T.esc(nx.label || "-")}</b> · ${rel.date ? `${rel.estimated ? "estimée" : "prévue"} le <b>${F.date(rel.date)}</b> <span class="muted">(${T.esc(rel.source || "")})</span>` : "date inconnue"}</div>
        <div>${d != null && d > 0 ? `Enregistre ta prédiction avant le <b>${fmtDeadline(rel.deadline)}</b> · <b class="num">J-${d}</b>` : rel.deadline ? "Fenêtre fermée pour ce trimestre, en attente des chiffres" : ""}</div></div>
      ${db ? `<div class="kpis">
          <div class="kpi hl"><div class="l">Ma prédiction ${T.esc(nx.label || "")}</div><div class="v">${dbs && dbs.pred ? "enregistrée" : "à faire"}</div><div class="s">${dbs && dbs.pred ? `${dbs.versions} version${dbs.versions > 1 ? "s" : ""} · dernière le ${F.dateTime(dbs.pred.updated_at)}` : "modifiable jusqu'à la date limite"}</div></div>
          <div class="kpi"><div class="l">Membres ayant prédit</div><div class="v">${dbs && T.isNum(dbs.count) ? dbs.count : "-"}</div><div class="s">valeurs cachées jusqu'à la date limite</div></div>
          <div class="kpi"><div class="l">Version notée</div><div class="v" style="font-size:15px">la dernière avant la limite</div><div class="s">historique archivé à chaque enregistrement</div></div></div>`
        : scoreboard(summaryFor(mine, P))}
      ${MB && MB.configured && !T.member ? `<div class="banner">◎ <div>Membre de la bêta ? <a href="#/compte">Connecte-toi</a> pour enregistrer ta prédiction dans ton espace (sans passer par GitHub) et te comparer au groupe.</div></div>` : ""}
      <div class="panel"><h3>Contexte pour ${T.esc(nx.label || "")} <span class="hint">ce que tu sais au moment de prévoir</span></h3>
          <div class="tbl-wrap"><table class="t"><thead><tr><th>Indicateur</th>${lastQ.map((h) => `<th class="n">${h.label}</th>`).join("")}
            <th class="n">Naïf</th><th class="n">Guidance</th><th class="n">Consensus</th></tr></thead><tbody>
            ${keys.map((k) => { const m = M[k]; const hv = m.history.slice(-4); const c = m.consensus;
              return `<tr><td>${T.esc(m.label)}</td>${hv.map((h, i) => { const prev = m.history[m.history.length - 4 + i - 4]; const yoy = prev && T.isNum(prev.value) && T.isNum(h.value) && m.kind !== "margin" && prev.value > 0 ? h.value / prev.value - 1 : null;
                return `<td class="n">${shown(m, h.value)}${yoy != null ? `<span class="yoy ${T.cls(yoy)}">${F.pct(yoy, 0, true)} a/a</span>` : ""}</td>`; }).join("")}
                <td class="n">${shown(m, m.naive)}</td><td class="n">${shown(m, m.guidance)}</td>
                <td class="n">${c ? shown(m, c.avg) + `<span class="yoy muted">${shown(m, c.low)} à ${shown(m, c.high)}</span>` + (c.comparable ? "" : '<span class="yoy warn" title="Consensus Yahoo généralement non-GAAP">non-GAAP</span>') : "-"}</td></tr>`; }).join("")}
            </tbody></table></div>
          <p class="note"><b>Naïf</b> = ${T.esc((ctx.naive && ctx.naive.description) || "dernier trimestre × dernière croissance séquentielle (marges : dernière valeur)")}. C'est le minimum à battre${ctx.naive && ctx.naive.backtest_revenue_mape && T.isNum(ctx.naive.backtest_revenue_mape[ctx.naive.method]) ? ` (erreur moyenne sur le CA des 8 derniers trimestres : ${F.pct(ctx.naive.backtest_revenue_mape[ctx.naive.method], 1)})` : ""}.
            ${ctx.guidance_note && ctx.guidance_note.source ? `<b>Guidance</b> : ${T.esc(ctx.guidance_note.source)}.` : "Guidance : à renseigner dans config/assumptions."}
            <b>Consensus</b> : moyenne des analystes (Yahoo), figée automatiquement la veille de la publication.</p></div>

      <div class="grid g-main" style="margin-top:14px">
      <div class="panel"><h3>Ma prédiction <span class="row">
          <select id="pperiod" class="sel">${[nx.label, fyLabel].filter(Boolean).map((p) => `<option ${p === draft.period ? "selected" : ""}>${p}</option>`).join("")}</select>
          <button class="btn" id="preset">Effacer</button></span></h3>
        <div class="pform" id="pform">
          <div class="pf-head"><span>Indicateur</span><span>Ma prévision</span><span>Bas (80 %)</span><span>Haut (80 %)</span></div>
          ${keys.map((k) => { const m = M[k]; const v = draft.metrics[k] || {}; const unit = m.unit === "Md$" ? "Md$" : m.unit === "%" ? "%" : "$";
            const ph = T.isNum(m.naive) ? (m.unit === "Md$" ? (m.naive / 1e9).toFixed(1) : m.unit === "%" ? (m.naive * 100).toFixed(1) : m.naive.toFixed(2)) : "";
            return `<div class="pf-row" data-k="${k}"><label>${T.esc(m.label)} <span class="muted">${unit}</span></label>
              <input inputmode="decimal" data-f="value" placeholder="${ph}" value="${T.esc(v.value ?? "")}">
              <input inputmode="decimal" data-f="low" value="${T.esc(v.low ?? "")}"><input inputmode="decimal" data-f="high" value="${T.esc(v.high ?? "")}"></div>`; }).join("")}
          <div class="group-title">Questions oui / non <span class="muted" style="text-transform:none;letter-spacing:0">probabilité en %, notées au score de Brier${db ? ", résolues automatiquement" : ""}</span></div>
          ${db ? `<div id="pquestions">${MB.QUESTIONS.map(([id, label]) => `<div class="pf-q" data-q="${id}"><span>${T.esc(label)}</span><input inputmode="decimal" placeholder="%" value="${T.esc(draft.questions[id] ?? "")}"></div>`).join("")}</div>` : `<div id="pevents"></div>
          <div class="row" id="pev-presets">
            <button class="chip" data-q="CA au-dessus du haut de la fourchette de guidance ?">+ CA au-dessus du haut de la guidance</button>
            <button class="chip" data-q="CA au-dessus du consensus ?">+ CA au-dessus du consensus</button>
            <button class="chip" data-q="Guidance du trimestre suivant au-dessus du consensus ?">+ Guidance suivante au-dessus du consensus</button>
            <button class="chip" data-q="Le cours monte le lendemain de la publication ?">+ Cours en hausse le lendemain</button>
            <button class="chip" data-q="">+ Question libre</button></div>`}
          <div class="group-title">Objectifs de cours <span class="muted" style="text-transform:none;letter-spacing:0">vérifiés sur la clôture du jour visé</span></div>
          <div id="pprices"></div>
          <div class="row"><button class="chip" id="paddprice">+ Ajouter un objectif de cours</button></div>
          <div class="group-title">Raisonnement</div>
          <textarea id="pnote" rows="4" placeholder="Pourquoi ces chiffres ? Hypothèses clés, ce qui te ferait changer d'avis…">${T.esc(draft.note || "")}</textarea>
        </div>
        <div id="pvalid" class="note"></div>
        ${db ? `<div class="row" style="margin-top:12px">
          <button class="btn primary" id="pdbsave" ${dbClosed ? "disabled" : ""}>${dbs && dbs.pred ? "Mettre à jour ma prédiction" : "Enregistrer ma prédiction"}</button>
          <label class="check"><input type="checkbox" id="pvis" ${draft.visibility !== "private" ? "checked" : ""}> visible par le groupe après la date limite</label>
          <span class="spacer"></span><span class="note" id="pdbmsg" style="margin:0">${T.esc(dbMsg)}</span></div>
          <p class="note">Enregistrée dans ton espace membre, horodatée par la base. Tu peux la modifier autant que tu veux jusqu'à la date limite : chaque version est archivée et c'est la dernière avant la limite qui est notée.</p>`
        : `<div class="row" style="margin-top:12px">
          <a class="btn primary" id="psave" target="_blank" rel="noopener">Enregistrer sur GitHub (horodatage) ↗</a>
          <button class="btn" id="pcopy">Copier le YAML</button><span class="spacer"></span>
          <span class="muted" style="font-size:12px">GitHub s'ouvre avec le fichier pré-rempli : clique « Commit changes ». Le site se met à jour en 1 à 2 min.</span></div>
        <details style="margin-top:10px"><summary class="sec" style="cursor:pointer">Aperçu du fichier</summary><pre class="yaml" id="pyaml"></pre></details>`}
      </div>
      <div class="panel sticky-panel"><h3>CA trimestriel et ta prévision <span class="hint">Md$</span></h3><div class="chart" id="pchart" style="height:260px"></div>
        <div class="group-title">Positionnement ${T.esc(nx.label || "")} <span class="muted" style="text-transform:none;letter-spacing:0">Md$, barres = fourchettes</span></div>
        <div class="chart" id="pstrip" style="height:170px"></div>
        <p class="note">Ta prévision et ton intervalle se mettent à jour pendant la saisie.</p></div>
      </div>

      <div class="group-title" style="margin-top:22px">${db ? "Mes prédictions et celles du groupe" : "Mes prédictions"} ${T.esc(tk)}</div>
      <div class="stack" id="plist">${db ? "" : mine.length ? mine.map((r) => card(r)).join("") : '<div class="empty">Aucune prédiction pour l\'instant. La première compte : remplis le formulaire ci-dessus.</div>'}</div>`;
    if (db) MB.renderTickerPredictions(T.$("#plist"), tk, nx.label);

    // ---------------- dynamic rows
    const evBox = T.$("#pevents"), pxBox = T.$("#pprices");
    const evRow = (e = {}) => { const d = document.createElement("div"); d.className = "pf-ev";
      d.innerHTML = `<input data-f="q" placeholder="Question fermée (oui / non)" value="${T.esc(e.question || "")}"><input data-f="p" inputmode="decimal" placeholder="%" value="${T.esc(e.probability ?? "")}"><button class="icon-btn" title="Retirer">✕</button>`;
      d.querySelector("button").onclick = () => { d.remove(); update(); }; evBox.appendChild(d); };
    const pxRow = (p = {}) => { const d = document.createElement("div"); d.className = "pf-px";
      d.innerHTML = `<input data-f="date" type="date" value="${T.esc(p.date || "")}"><input data-f="value" inputmode="decimal" placeholder="Cours $" value="${T.esc(p.value ?? "")}"><input data-f="low" inputmode="decimal" placeholder="Bas" value="${T.esc(p.low ?? "")}"><input data-f="high" inputmode="decimal" placeholder="Haut" value="${T.esc(p.high ?? "")}"><button class="icon-btn" title="Retirer">✕</button>`;
      d.querySelector("button").onclick = () => { d.remove(); update(); }; pxBox.appendChild(d); };
    if (!db) (draft.events || []).forEach(evRow);
    (draft.price || []).forEach(pxRow);
    if (!db) T.$("#pev-presets").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; evRow({ question: b.dataset.q }); update(); });
    T.$("#paddprice").onclick = () => { const dd = new Date(); dd.setMonth(dd.getMonth() + 3); pxRow({ date: dd.toISOString().slice(0, 10) }); update(); };
    T.$("#preset").onclick = () => { try { localStorage.removeItem(`archer-draft-${tk}`); } catch (e) { /* noop */ } T.render(); };

    // ---------------- chart
    let chart;
    function drawChart(pred) {
      const h = hist.map((x) => ({ l: x.label, v: T.isNum(x.value) ? x.value / 1e9 : null }));
      const labels = h.map((x) => x.l).concat(nx.label);
      const m = M.revenue;
      const mk = (v) => (T.isNum(v) ? +(v / 1e9).toFixed(2) : null);
      const lastIdx = labels.length - 1;
      const pt = (v, color, name, sym) => ({ name, type: "scatter", symbol: sym, symbolSize: 12, z: 5,
        data: v == null ? [] : [[lastIdx, v]], itemStyle: { color, borderColor: C().panel, borderWidth: 2 } });
      const opt = {
        legend: { data: ["Réel", "Toi", "Naïf", "Guidance", "Consensus"] },
        grid: { left: 8, right: 14, top: 30, bottom: 8, containLabel: true },
        tooltip: { trigger: "item", formatter: (p) => `${p.seriesName}<br><b>${F.n(Array.isArray(p.value) ? p.value[1] : p.value, 2)} Md$</b>` },
        xAxis: T.axis({ type: "category", data: labels, splitLine: { show: false }, axisLabel: { color: C().muted, fontSize: 10, rotate: 30 } }),
        yAxis: T.axis({ type: "value", scale: true, axisLabel: { color: C().muted, formatter: (v) => F.n(v, 0) } }),
        series: [
          { name: "Réel", type: "bar", data: h.map((x) => x.v).concat(null), barMaxWidth: 22, itemStyle: { color: "#2b3446", borderRadius: [3, 3, 0, 0] } },
          pt(mk(m.naive), C().neutral, "Naïf", "circle"),
          pt(mk(m.guidance), C().series[2], "Guidance", "diamond"),
          pt(m.consensus ? mk(m.consensus.avg) : null, C().series[1], "Consensus", "triangle"),
          Object.assign(pt(pred && T.isNum(pred.value) ? pred.value : null, C().series[0], "Toi", "circle"), { symbolSize: 16 }),
        ],
      };
      if (pred && T.isNum(pred.low) && T.isNum(pred.high)) opt.series[4].markLine = { symbol: "none", silent: true, lineStyle: { color: C().series[0], width: 6, opacity: 0.35 },
        data: [[{ coord: [lastIdx, pred.low] }, { coord: [lastIdx, pred.high] }]], label: { show: false } };
      if (chart) chart.setOption(opt, { replaceMerge: ["series"] }); else chart = T.ec(T.$("#pchart"), opt);
      drawStrip(pred);
    }

    // zoomed "where do I stand" strip for the next quarter's revenue
    let strip;
    const gn = ctx.guidance_note || {};
    function drawStrip(pred) {
      const m = M.revenue, b = (v) => (T.isNum(v) ? v / 1e9 : null);
      const c = m.consensus || {};
      const rows = [
        { label: "Toi", lo: pred && T.isNum(pred.low) ? pred.low : null, hi: pred && T.isNum(pred.high) ? pred.high : null, mid: pred && T.isNum(pred.value) ? pred.value : null, color: C().series[0] },
        { label: "Consensus", lo: b(c.low), hi: b(c.high), mid: b(c.avg), color: C().series[1] },
        { label: "Guidance", lo: T.isNum(gn.revenue_low) ? gn.revenue_low : null, hi: T.isNum(gn.revenue_high) ? gn.revenue_high : null, mid: b(m.guidance), color: C().series[2] },
        { label: "Naïf", lo: null, hi: null, mid: b(m.naive), color: C().neutral },
      ];
      const vals = rows.flatMap((r) => [r.lo, r.hi, r.mid]).filter(T.isNum);
      if (!vals.length) { T.$("#pstrip").innerHTML = ""; return; }
      const lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max((hi - lo) * 0.12, hi * 0.01);
      const opt = {
        grid: { left: 8, right: 16, top: 8, bottom: 4, containLabel: true },
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => { const r = rows[ps[0].dataIndex];
          return `<b>${r.label}</b>${T.isNum(r.mid) ? `<br>${F.n(r.mid, 2)} Md$` : ""}${T.isNum(r.lo) && T.isNum(r.hi) ? `<br>${F.n(r.lo, 2)} à ${F.n(r.hi, 2)} Md$` : ""}`; } },
        xAxis: T.axis({ type: "value", min: Math.floor((lo - pad) * 2) / 2, max: Math.ceil((hi + pad) * 2) / 2, axisLabel: { color: C().muted, formatter: (v) => F.n(v, 0) } }),
        yAxis: T.axis({ type: "category", data: rows.map((r) => r.label), inverse: true, splitLine: { show: false }, axisLabel: { color: C().text2, fontFamily: "Inter" } }),
        series: [
          { type: "bar", stack: "r", silent: true, barWidth: 10, itemStyle: { color: "transparent" }, data: rows.map((r) => (T.isNum(r.lo) && T.isNum(r.hi) ? r.lo : 0)) },
          { type: "bar", stack: "r", barWidth: 10, data: rows.map((r) => ({ value: T.isNum(r.lo) && T.isNum(r.hi) ? r.hi - r.lo : 0, itemStyle: { color: r.color, opacity: 0.35, borderRadius: 5 } })) },
          { type: "scatter", symbolSize: 11, z: 5, data: rows.map((r, i) => (T.isNum(r.mid) ? { value: [r.mid, i], itemStyle: { color: r.color, borderColor: C().panel, borderWidth: 2 } } : null)).filter(Boolean),
            label: { show: true, position: "top", distance: 6, color: C().text2, fontSize: 10.5, fontFamily: "JetBrains Mono", formatter: (p) => F.n(p.value[0], 1) } },
        ],
      };
      if (strip) strip.setOption(opt, { replaceMerge: ["series"] }); else strip = T.ec(T.$("#pstrip"), opt);
    }

    // ---------------- YAML generation + validation
    const num = (s) => { if (s == null || String(s).trim() === "") return null; const v = parseFloat(String(s).replace(/\s/g, "").replace(",", ".")); return isFinite(v) ? v : NaN; };
    const q = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    function collect() {
      const out = { period: T.$("#pperiod").value, metrics: {}, events: [], questions: {}, price: [], note: T.$("#pnote").value,
        visibility: T.$("#pvis") && !T.$("#pvis").checked ? "private" : "group" };
      T.$$(".pf-q").forEach((r) => { const v = T.$("input", r).value.trim(); if (v) out.questions[r.dataset.q] = v; });
      T.$$(".pf-row").forEach((r) => { const o = {}; T.$$("input", r).forEach((i) => { o[i.dataset.f] = i.value.trim(); }); if (o.value || o.low || o.high) out.metrics[r.dataset.k] = o; });
      T.$$(".pf-ev").forEach((r) => { const [a, b] = T.$$("input", r); if (a.value.trim() || b.value.trim()) out.events.push({ question: a.value.trim(), probability: b.value.trim() }); });
      T.$$(".pf-px").forEach((r) => { const o = {}; T.$$("input", r).forEach((i) => { o[i.dataset.f] = i.value.trim(); }); if (o.value) out.price.push(o); });
      return out;
    }
    function validate(d) {
      const errs = [];
      Object.entries(d.metrics).forEach(([k, o]) => {
        const v = num(o.value), lo = num(o.low), hi = num(o.high), lab = M[k].label;
        if (v === null) errs.push(`${lab} : la prévision est vide`);
        [v, lo, hi].forEach((x) => { if (Number.isNaN(x)) errs.push(`${lab} : nombre invalide`); });
        if (lo != null && hi != null && !(lo <= hi)) errs.push(`${lab} : bas > haut`);
        if (v != null && lo != null && v < lo) errs.push(`${lab} : prévision sous le bas de l'intervalle`);
        if (v != null && hi != null && v > hi) errs.push(`${lab} : prévision au-dessus du haut de l'intervalle`);
        if ((lo == null) !== (hi == null)) errs.push(`${lab} : donne le bas ET le haut de l'intervalle (ou aucun)`);
      });
      d.events.forEach((e) => { const p = num(e.probability); if (!e.question) errs.push("Question oui / non sans texte"); if (p === null || Number.isNaN(p) || p < 0 || p > 100) errs.push(`« ${e.question || "?"} » : probabilité entre 0 et 100`); });
      d.price.forEach((p) => { if (!p.date) errs.push("Objectif de cours sans date"); if (Number.isNaN(num(p.value))) errs.push("Objectif de cours invalide"); });
      Object.entries(d.questions).forEach(([id, v]) => { const p = num(v); if (p === null || Number.isNaN(p) || p < 0 || p > 100) errs.push(`Question « ${(MB && Object.fromEntries(MB.QUESTIONS)[id]) || id} » : probabilité entre 0 et 100`); });
      if (!Object.keys(d.metrics).length && !d.events.length && !d.price.length && !Object.keys(d.questions).length) errs.push("Rien à enregistrer : remplis au moins une prévision");
      return errs;
    }
    function toYaml(d) {
      const now = new Date();
      let y = `# Archer Terminal · prédiction ${tk} ${d.period}\n# Écrite le ${now.toLocaleString("fr-FR")}. L'horodatage qui fait foi est celui du commit Git.\n`;
      y += `ticker: ${tk}\nperiod: ${d.period}\n`;
      if (Object.keys(d.metrics).length) {
        y += "metrics:   # Md$ pour les montants, % pour les marges, $ pour le BPA ; low/high = intervalle à 80 %\n";
        Object.entries(d.metrics).forEach(([k, o]) => {
          const parts = [`value: ${num(o.value)}`];
          if (num(o.low) != null) parts.push(`low: ${num(o.low)}`);
          if (num(o.high) != null) parts.push(`high: ${num(o.high)}`);
          y += `  ${k}: {${parts.join(", ")}}\n`;
        });
      }
      if (d.events.length) {
        y += "events:    # probability en %, outcome à remplir (true / false) après coup\n";
        d.events.forEach((e, i) => { y += `  - {id: q${i + 1}, question: ${q(e.question)}, probability: ${num(e.probability)}, outcome: null}\n`; });
      }
      if (d.price.length) {
        y += "price:\n";
        d.price.forEach((p) => { y += `  - {date: ${p.date}, value: ${num(p.value)}${num(p.low) != null ? `, low: ${num(p.low)}` : ""}${num(p.high) != null ? `, high: ${num(p.high)}` : ""}}\n`; });
      }
      if (d.note && d.note.trim()) y += "note: |\n" + d.note.trim().split("\n").map((l) => "  " + l).join("\n") + "\n";
      return y;
    }
    function update() {
      const d = collect();
      try { localStorage.setItem(`archer-draft-${tk}`, JSON.stringify(d)); } catch (e) { /* noop */ }
      const errs = validate(d);
      T.$("#pvalid").innerHTML = errs.length ? errs.map((e) => `<span class="warn">• ${T.esc(e)}</span>`).join("<br>") : '<span class="up">Prêt à être enregistré.</span>';
      if (db) {
        T.$("#pdbsave").disabled = dbClosed || errs.length > 0;
      } else {
        const y = toYaml(d);
        T.$("#pyaml").textContent = y;
        const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
        const fname = `config/predictions/${tk}/${stamp}-${d.period.toLowerCase().replace(/\s+/g, "-")}.yaml`;
        const btn = T.$("#psave");
        btn.href = T.repoUrl(`new/main?filename=${encodeURIComponent(fname)}&value=${encodeURIComponent(y)}`);
        btn.classList.toggle("disabled", errs.length > 0);
      }
      const r = d.metrics.revenue;
      drawChart(r ? { value: num(r.value), low: num(r.low), high: num(r.high) } : null);
    }
    function toRow(d) {
      const metrics = {};
      Object.entries(d.metrics).forEach(([k, o]) => { const v = { value: num(o.value) }; if (num(o.low) != null) v.low = num(o.low); if (num(o.high) != null) v.high = num(o.high); metrics[k] = v; });
      return { ticker: tk, period: nx.label, metrics,
        questions: Object.entries(d.questions).map(([id, p]) => ({ id, p: num(p) })),
        price_targets: d.price.map((p) => { const t = { date: p.date, value: num(p.value) }; if (num(p.low) != null) t.low = num(p.low); if (num(p.high) != null) t.high = num(p.high); return t; }),
        note: d.note.trim() || null, visibility: d.visibility };
    }
    if (db) {
      T.$("#pdbsave").onclick = async () => {
        const d = collect();
        if (validate(d).length) return;
        const btn = T.$("#pdbsave"), msg = T.$("#pdbmsg");
        btn.disabled = true; msg.className = "note"; msg.textContent = "Enregistrement…";
        try {
          const row = await MB.savePrediction(dbs.pred, toRow(d));
          dbs.pred = row; dbs.versions = (dbs.versions || 0) + 1;
          try { localStorage.removeItem(`archer-draft-${tk}`); } catch (e) { /* noop */ }
          msg.className = "note up"; msg.textContent = `Enregistrée le ${F.dateTime(row.updated_at)} ✓ (version ${dbs.versions})`;
          btn.textContent = "Mettre à jour ma prédiction";
          MB.renderTickerPredictions(T.$("#plist"), tk, nx.label);
          if (T.badges && T.badges.refresh) T.badges.refresh();     // e.g. « Premier tir » unlocked
        } catch (e) { msg.className = "note warn"; msg.textContent = e.message; }
        btn.disabled = false;
      };
    } else {
    T.$("#psave").addEventListener("click", (e) => { if (e.currentTarget.classList.contains("disabled")) e.preventDefault(); });
    T.$("#pcopy").onclick = async () => { const y = T.$("#pyaml").textContent; try { await navigator.clipboard.writeText(y); T.$("#pcopy").textContent = "Copié ✓"; } catch (e) { window.prompt("Copie ce YAML :", y); } setTimeout(() => { T.$("#pcopy").textContent = "Copier le YAML"; }, 1600); };
    }
    el.addEventListener("input", update);
    el.addEventListener("change", update);
    update();
  };

  function summaryFor(mine, P) {
    // per-ticker scoreboard recomputed client-side from the records (same rules as the pipeline)
    const sum = { by_metric: {}, counts: { pending: 0, partial: 0, resolved: 0, late: 0 }, events: null };
    const briers = [];
    mine.forEach((r) => {
      sum.counts[r.status] = (sum.counts[r.status] || 0) + 1;
      if (r.status === "late") return;
      (r.metrics || []).forEach((m) => {
        if (m.actual == null || m.abs == null) return;
        const s = sum.by_metric[m.key] || (sum.by_metric[m.key] = { n: 0, a: 0, b: 0, interval: { n: 0, hit: 0 }, vs: {} });
        s.n++; s.a += m.abs; s.b += m.error_pct ?? m.error_pts;
        if ("in_interval" in m) { s.interval.n++; s.interval.hit += m.in_interval ? 1 : 0; }
        Object.entries(m.vs || {}).forEach(([k, v]) => { const t = s.vs[k] || (s.vs[k] = { n: 0, wins: 0 }); t.n++; t.wins += v.you_win ? 1 : 0; });
      });
      (r.events || []).forEach((e) => { if (T.isNum(e.brier)) briers.push(e.brier); });
    });
    Object.values(sum.by_metric).forEach((s) => { s.mean_abs_error = s.a / s.n; s.bias = s.b / s.n; });
    if (briers.length) sum.events = { n: briers.length, brier: briers.reduce((a, b) => a + b, 0) / briers.length };
    return sum;
  }

  // ------------------------------------------------------------------ ticker tab: Options
  T.tabOptions = async function (el, tk, co) {
    let o;
    try { o = await T.get(`${tk}/options.json`); }
    catch (e) { el.innerHTML = '<div class="empty">Données d\'options pas encore disponibles : elles apparaîtront après la prochaine mise à jour.</div>'; return; }
    const ex = o.expiries.filter((e) => T.isNum(e.atm_iv));
    const er = o.earnings, hist = o.earnings_history || [];
    const avgAbs = hist.length ? hist.slice(0, 8).reduce((a, h) => a + Math.abs(h.move), 0) / Math.min(8, hist.length) : null;
    const k = (l, v, s, hl) => `<div class="kpi ${hl ? "hl" : ""}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    const firstExp = Object.keys(o.chains)[0];
    const defExp = er && o.chains[er.expiry] ? er.expiry : firstExp;
    el.innerHTML = `<div class="kpis">
        ${k("Choc implicite", er && T.isNum(er.shock_expected_abs) ? "±" + F.pct(er.shock_expected_abs, 1) : "-", er ? `publication du ${F.date(er.date)}` : "date inconnue", true)}
        ${k("Réaction passée", avgAbs != null ? "±" + F.pct(avgAbs, 1) : "-", hist.length ? `|variation| sur ${Math.min(8, hist.length)} publications` : "historique indisponible")}
        ${k("Straddle", er && T.isNum(er.straddle_move) ? "±" + F.pct(er.straddle_move, 1) : "-", er ? `échéance ${F.date(er.expiry)}` : "")}
        ${k("IV 30 jours", F.pct(o.iv30, 1), "ATM, maturité constante")}
        ${k("IV 90 jours", F.pct(o.iv90, 1), T.isNum(o.iv30) && T.isNum(o.iv90) ? (o.iv30 > o.iv90 ? "courbe inversée (stress / événement)" : "courbe normale") : "")}
        ${k("Put / call", F.n(o.put_call_oi, 2), `open interest · volume ${F.n(o.put_call_volume, 2)}`)}
      </div>
      ${er && T.isNum(er.shock_expected_abs) && avgAbs != null ? `<div class="panel" style="margin-bottom:14px"><p class="sec" style="margin:0">
        Le marché price un mouvement d'environ <b>±${F.pct(er.shock_expected_abs, 1)}</b> le jour de la publication, contre <b>±${F.pct(avgAbs, 1)}</b> en moyenne lors des dernières publications.
        ${er.shock_expected_abs > avgAbs * 1.15 ? "Les options sont <b>plus chères</b> que l'historique : le marché s'attend à une surprise plus forte que d'habitude." : er.shock_expected_abs < avgAbs * 0.85 ? "Les options sont <b>moins chères</b> que l'historique : le marché sous-estime peut-être la surprise." : "Les options sont <b>en ligne</b> avec l'historique."}
        Pour ta prédiction : si ton CA s'écarte nettement du consensus, c'est le genre de surprise que ce chiffre mesure.</p></div>` : ""}
      <div class="grid g2">
        <div class="panel"><h3>Structure par terme <span class="hint">volatilité implicite ATM par échéance</span></h3><div class="chart" id="oterm"></div></div>
        <div class="panel"><h3>Réactions aux publications <span class="hint">veille → lendemain</span></h3><div class="chart" id="oreact"></div></div>
      </div>
      <div class="panel" style="margin-top:14px"><h3>Échéance <span class="row"><select id="oexp" class="sel">${Object.keys(o.chains).map((e) => `<option value="${e}" ${e === defExp ? "selected" : ""}>${F.date(e)}${er && e === er.expiry ? " · après résultats" : ""}</option>`).join("")}</select></span></h3>
        <div class="grid g2"><div><div class="group-title" style="margin-top:0">Smile de volatilité</div><div class="chart" id="osmile"></div></div>
          <div><div class="group-title" style="margin-top:0">Open interest par strike</div><div class="chart" id="ooi"></div></div></div>
        <div class="group-title">Chaîne d'options <span class="muted" style="text-transform:none;letter-spacing:0">strikes à ±12 % du cours, prix moyens bid/ask</span></div>
        <div class="tbl-wrap" id="ochain"></div></div>
      <p class="note">Source : chaînes d'options Yahoo Finance (différées), relevées ${F.dateTime(o.asof)} avec un cours de ${F.px(o.spot)}. Volatilité implicite recalculée par Black-Scholes sur le milieu bid/ask (sans dividende, exercice européen : approximation standard).
        <b>Choc de résultats</b> = variance de l'échéance post-publication moins celle de l'échéance précédente ; c'est le mouvement que le marché attend pour l'annonce elle-même.</p>`;

    // term structure
    T.ec(T.$("#oterm"), {
      tooltip: { trigger: "axis", formatter: (ps) => { const e = ex[ps[0].dataIndex]; return `${F.date(e.date)} (${F.n(e.dte, 0)} j)<br>IV ATM <b>${F.pct(e.atm_iv, 1)}</b><br>Straddle ±${F.pct(e.implied_move, 1)}`; } },
      xAxis: T.axis({ type: "category", data: ex.map((e) => e.date.slice(5)), splitLine: { show: false } }),
      yAxis: T.axis({ type: "value", scale: true, axisLabel: { color: C().muted, formatter: (v) => v + " %" } }),
      series: [{ type: "line", data: ex.map((e) => ({ value: +(e.atm_iv * 100).toFixed(2), itemStyle: { color: er && e.date === er.expiry ? C().series[1] : C().series[0] }, symbolSize: er && e.date === er.expiry ? 11 : 6 })),
        lineStyle: { color: C().series[0], width: 2 }, symbol: "circle" }],
    });
    // earnings reactions
    const hr = hist.slice(0, 12).reverse();
    if (!hr.length) T.$("#oreact").innerHTML = '<div class="empty" style="margin-top:40px">Pas encore d\'historique de publications.</div>';
    else T.ec(T.$("#oreact"), {
      tooltip: { trigger: "axis", formatter: (ps) => { const h = hr[ps[0].dataIndex]; return `Publication du ${F.date(h.date)}<br>${h.from} → ${h.to}<br><b>${F.pct(h.move, 1, true)}</b>`; } },
      xAxis: T.axis({ type: "category", data: hr.map((h) => h.date.slice(0, 7)), splitLine: { show: false } }),
      yAxis: T.axis({ type: "value", axisLabel: { color: C().muted, formatter: (v) => v + " %" } }),
      series: [{ type: "bar", barMaxWidth: 20, data: hr.map((h) => ({ value: +(h.move * 100).toFixed(2), itemStyle: { color: h.move >= 0 ? C().up : C().down, borderRadius: h.move >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] } })),
        markLine: er && T.isNum(er.shock_expected_abs) ? { symbol: "none", silent: true, lineStyle: { color: C().series[1], width: 1.5, type: "solid" },
          label: { position: "insideEndTop", formatter: (p) => (p.value > 0 ? "implicite +" : "implicite ") + F.n(p.value, 1) + " %", color: C().text2, fontSize: 10.5 },
          data: [{ yAxis: +(er.shock_expected_abs * 100).toFixed(2) }, { yAxis: -(er.shock_expected_abs * 100).toFixed(2) }] } : undefined }],
    });

    let cs, co2;
    function drawExpiry(exp) {
      const rows = o.chains[exp] || [];
      const S = o.spot;
      if (cs) cs.dispose(); if (co2) co2.dispose();
      cs = T.ec(T.$("#osmile"), {
        legend: { data: ["Calls", "Puts"] }, tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "-" : F.n(v, 1) + " %") },
        grid: { left: 8, right: 14, top: 30, bottom: 24, containLabel: true },
        xAxis: T.axis({ type: "value", scale: true, name: "strike", nameLocation: "middle", nameGap: 24, nameTextStyle: { color: C().muted } }),
        yAxis: T.axis({ type: "value", scale: true, axisLabel: { color: C().muted, formatter: (v) => v + " %" } }),
        series: [
          { name: "Calls", type: "line", showSymbol: false, data: rows.filter((r) => T.isNum(r.c_iv)).map((r) => [r.strike, +(r.c_iv * 100).toFixed(2)]), lineStyle: { color: C().series[0], width: 2 }, itemStyle: { color: C().series[0] },
            markLine: { symbol: "none", silent: true, lineStyle: { color: C().text, width: 1 }, label: { formatter: "cours", color: C().text2 }, data: [{ xAxis: S }] } },
          { name: "Puts", type: "line", showSymbol: false, data: rows.filter((r) => T.isNum(r.p_iv)).map((r) => [r.strike, +(r.p_iv * 100).toFixed(2)]), lineStyle: { color: C().series[1], width: 2 }, itemStyle: { color: C().series[1] } },
        ],
      });
      const near = rows.filter((r) => r.strike >= S * 0.75 && r.strike <= S * 1.25);
      co2 = T.ec(T.$("#ooi"), {
        legend: { data: ["Calls", "Puts"] }, tooltip: { trigger: "axis", valueFormatter: (v) => F.n(v, 0) },
        xAxis: T.axis({ type: "category", data: near.map((r) => F.n(r.strike, r.strike % 1 ? 1 : 0)), splitLine: { show: false } }),
        yAxis: T.axis({ type: "value", axisLabel: { color: C().muted, formatter: (v) => (v >= 1000 ? F.n(v / 1000, 0) + " k" : v) } }),
        series: [
          { name: "Calls", type: "bar", data: near.map((r) => r.c_oi || 0), itemStyle: { color: C().series[0] }, barGap: "8%" },
          { name: "Puts", type: "bar", data: near.map((r) => r.p_oi || 0), itemStyle: { color: C().series[1] } },
        ],
      });
      const tb = rows.filter((r) => r.strike >= S * 0.88 && r.strike <= S * 1.12);
      const atmK = tb.length ? tb.reduce((a, r) => (Math.abs(r.strike - S) < Math.abs(a.strike - S) ? r : a)).strike : null;
      const c = (v, d = 2) => (T.isNum(v) ? F.n(v, d) : "-");
      T.$("#ochain").innerHTML = `<table class="t chain"><thead><tr><th class="n">OI</th><th class="n">Delta</th><th class="n">IV</th><th class="n">Bid</th><th class="n">Ask</th>
        <th class="n strike">Strike</th><th class="n">Bid</th><th class="n">Ask</th><th class="n">IV</th><th class="n">Delta</th><th class="n">OI</th></tr>
        <tr class="sub"><th colspan="5" class="n">CALLS</th><th></th><th colspan="5">PUTS</th></tr></thead><tbody>
        ${tb.map((r) => `<tr class="${r.strike === atmK ? "hl" : ""}"><td class="n muted">${c(r.c_oi, 0)}</td><td class="n">${c(r.c_delta)}</td><td class="n">${T.isNum(r.c_iv) ? F.pct(r.c_iv, 1) : "-"}</td><td class="n ${r.strike < S ? "itm" : ""}">${c(r.c_bid)}</td><td class="n ${r.strike < S ? "itm" : ""}">${c(r.c_ask)}</td>
          <td class="n strike"><b>${F.n(r.strike, r.strike % 1 ? 1 : 0)}</b></td>
          <td class="n ${r.strike > S ? "itm" : ""}">${c(r.p_bid)}</td><td class="n ${r.strike > S ? "itm" : ""}">${c(r.p_ask)}</td><td class="n">${T.isNum(r.p_iv) ? F.pct(r.p_iv, 1) : "-"}</td><td class="n">${c(r.p_delta)}</td><td class="n muted">${c(r.p_oi, 0)}</td></tr>`).join("")}
        </tbody></table>`;
    }
    T.$("#oexp").addEventListener("change", (e) => drawExpiry(e.target.value));
    drawExpiry(defExp);
    if (T.OL) T.OL.render(el, tk, o);
  };
})();
