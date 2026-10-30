/* Espace membres : comptes, prédictions en base, communauté, portefeuilles fictifs.
 * Toutes les règles (dates limites, visibilité, argent fictif) sont imposées par la base Supabase ;
 * cette page ne fait qu'afficher et appeler les fonctions autorisées. */
(function () {
  "use strict";
  const T = window.T, F = T.fmt, C = () => T.C;
  const cfg = window.ARCHER_CONFIG || {};
  const M = (T.members = { configured: !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase) });

  M.QUESTIONS = [
    ["rev_above_guidance_high", "CA au-dessus du haut de la fourchette de guidance ?"],
    ["rev_above_analysts", "CA au-dessus du consensus des analystes ?"],
    ["rev_above_crowd", "CA au-dessus du consensus de la communauté ?"],
    ["gm_above_guidance", "Marge brute au-dessus de la guidance ?"],
    ["price_up_after", "Cours en hausse après la publication (veille → lendemain) ?"],
  ];
  const QLABEL = Object.fromEntries(M.QUESTIONS);
  const METRIC = {
    revenue: ["Chiffre d'affaires", "Md$", "money"], gross_margin: ["Marge brute", "%", "margin"],
    operating_income: ["Résultat opérationnel", "Md$", "money"], operating_margin: ["Marge opérationnelle", "%", "margin"],
    net_income: ["Résultat net", "Md$", "money"], eps_diluted: ["BPA dilué (GAAP)", "$", "money"], fcf: ["Free cash flow", "Md$", "money"],
  };
  const BENCH = { naive: "Naïf", guidance: "Guidance", analysts: "Analystes", crowd: "Communauté" };

  // ------------------------------------------------------------------ client & session
  if (M.configured) {
    M.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  T.user = null;
  T.member = null;
  document.body.classList.toggle("no-members", !M.configured);

  async function loadProfile() {
    if (!M.sb) return;
    const { data } = await M.sb.auth.getSession();
    T.user = data.session ? data.session.user : null;
    T.member = null;
    if (T.user) {
      const r = await M.sb.from("profiles").select("*").eq("id", T.user.id).maybeSingle();
      T.member = r.data || null;
    }
    drawAccountButton();
    (M.onProfile || []).forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  }
  M.ready = (async () => {
    if (!M.sb) { drawAccountButton(); return; }
    await loadProfile();
    M.sb.auth.onAuthStateChange((ev) => {
      if (ev === "SIGNED_IN" || ev === "SIGNED_OUT" || ev === "USER_UPDATED") loadProfile().then(() => T.render());
    });
  })();

  function drawAccountButton() {
    const box = T.$("#accountBtn");
    if (!box) return;
    if (!M.configured) { box.innerHTML = ""; return; }
    box.innerHTML = T.member
      ? `<a class="btn" href="#/compte"><span class="avatar">${T.esc(T.member.username.slice(0, 1).toUpperCase())}</span><span class="hide-sm">${T.esc(T.member.username)}</span></a>`
      : `<a class="btn primary" href="#/compte">${T.user ? "Rejoindre" : "Connexion"}</a>`;
  }

  const err = (e) => (e && (e.message || e.error_description || String(e))) || "Erreur inconnue";
  async function must(p) { const r = await p; if (r.error) throw new Error(err(r.error)); return r.data; }
  const notConfigured = `<div class="panel"><h3>Espace membres</h3><p class="sec" style="margin:0">L'espace membres n'est pas encore activé sur ce site (configuration Supabase manquante).</p></div>`;
  function gate(view) {
    if (!M.configured) { view.innerHTML = notConfigured; return false; }
    if (!T.member) { view.innerHTML = `<div class="panel"><h3>Réservé aux membres</h3><p class="sec">Connecte-toi ou rejoins la bêta avec un code d'invitation.</p><a class="btn primary" href="#/compte">Se connecter</a></div>`; return false; }
    return true;
  }
  const shown = (key, v) => {
    const m = METRIC[key] || ["", "", "money"];
    if (!T.isNum(v)) return "-";
    if (m[2] === "margin") return F.n(v * 100, 1) + " %";
    if (m[1] === "Md$") return F.n(v / 1e9, 2) + " Md$";
    return F.n(v, 2) + " $";
  };
  const shownInput = (key, v) => (T.isNum(v) ? shown(key, (METRIC[key][2] === "margin" ? v / 100 : METRIC[key][1] === "Md$" ? v * 1e9 : v)) : "-");

  // ------------------------------------------------------------------ #/compte
  T.route(/^\/compte$/, async (view) => {
    await M.ready;
    if (!M.configured) { view.innerHTML = notConfigured; return; }
    if (!T.user) return authForms(view);
    if (!T.member) return joinForm(view);
    return accountPage(view);
  });

  function authForms(view) {
    view.innerHTML = `<div class="auth-wrap"><div class="panel auth">
      <img src="assets/brand/archer-lockup.png" alt="Archer" class="auth-logo">
      <div class="seg" id="atab"><button data-k="in" class="on">Connexion</button><button data-k="up">Créer un compte</button></div>
      <form id="aform" class="aform" autocomplete="on">
        <label>E-mail<input type="email" name="email" required autocomplete="email"></label>
        <label>Mot de passe<input type="password" name="password" required minlength="8" autocomplete="current-password"></label>
        <div id="upfields" class="hidden">
          <label>Pseudo<input name="username" pattern="[A-Za-z0-9_.\\-]{3,24}" placeholder="3 à 24 caractères"></label>
          <label>Code d'invitation<input name="code" placeholder="ARCHER-XXXXXXXXXX"></label>
        </div>
        <button class="btn primary" type="submit" id="asubmit">Se connecter</button>
        <div class="note" id="amsg"></div>
      </form>
      <p class="note">Bêta fermée : l'inscription demande un code d'invitation donné par un membre administrateur. Portefeuilles fictifs uniquement, aucun argent réel. Pas un conseil en investissement.</p>
    </div></div>`;
    let mode = "in";
    T.$("#atab").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      mode = b.dataset.k;
      T.$$("#atab button").forEach((x) => x.classList.toggle("on", x === b));
      T.$("#upfields").classList.toggle("hidden", mode !== "up");
      T.$("#asubmit").textContent = mode === "up" ? "Créer mon compte" : "Se connecter";
      T.$("#aform [name=password]").setAttribute("autocomplete", mode === "up" ? "new-password" : "current-password");
    });
    T.$("#aform").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      const msg = T.$("#amsg"); msg.className = "note"; msg.textContent = "…";
      try {
        if (mode === "in") {
          await must(M.sb.auth.signInWithPassword({ email: fd.email.trim(), password: fd.password }));
        } else {
          if (!/^[A-Za-z0-9_.-]{3,24}$/.test(fd.username || "")) throw new Error("Pseudo invalide : 3 à 24 caractères (lettres, chiffres, . _ -).");
          const r = await must(M.sb.auth.signUp({ email: fd.email.trim(), password: fd.password }));
          if (!r.session) throw new Error("Compte créé, mais la confirmation par e-mail est activée dans Supabase : l'administrateur doit la désactiver (Authentication > Email).");
          await must(M.sb.rpc("join_with_code", { p_code: fd.code || "", p_username: fd.username }));
        }
        await loadProfile();
        T.go("#/compte");
      } catch (ex) { msg.className = "note warn"; msg.textContent = err(ex); }
    });
  }

  function joinForm(view) {
    view.innerHTML = `<div class="auth-wrap"><div class="panel auth"><h3>Rejoindre la bêta</h3>
      <p class="sec">Connecté en tant que ${T.esc(T.user.email)}. Il te faut un code d'invitation (le fondateur peut laisser le code vide).</p>
      <form id="jform" class="aform"><label>Pseudo<input name="username" required pattern="[A-Za-z0-9_.\\-]{3,24}"></label>
        <label>Code d'invitation<input name="code" placeholder="ARCHER-XXXXXXXXXX"></label>
        <button class="btn primary" type="submit">Rejoindre</button><div class="note" id="jmsg"></div></form>
      <button class="btn" id="logout">Se déconnecter</button></div></div>`;
    T.$("#jform").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      try { await must(M.sb.rpc("join_with_code", { p_code: fd.code || "", p_username: fd.username })); await loadProfile(); T.render(); }
      catch (ex) { T.$("#jmsg").className = "note warn"; T.$("#jmsg").textContent = err(ex); }
    });
    T.$("#logout").onclick = () => M.sb.auth.signOut();
  }

  async function accountPage(view) {
    const me = T.member;
    view.innerHTML = `<div class="thead"><div class="id"><h1>Mon compte</h1><div class="sub">${T.esc(me.username)} · ${T.esc(T.user.email)} · membre depuis le ${F.date(me.created_at.slice(0, 10))}${me.is_admin ? " · administrateur" : ""}</div></div></div>
      <div class="grid g2">
        <div class="panel"><h3>Profil</h3>
          <form id="pform2" class="aform"><label>Pseudo<input name="username" value="${T.esc(me.username)}" pattern="[A-Za-z0-9_.\\-]{3,24}"></label>
            <label class="check"><input type="checkbox" name="lb" ${me.show_on_leaderboard ? "checked" : ""}> Apparaître dans le classement</label>
            <button class="btn primary">Enregistrer</button><div class="note" id="pmsg"></div></form></div>
        <div class="panel"><h3>Sécurité</h3>
          <form id="pwform" class="aform"><label>Nouveau mot de passe<input type="password" name="pw" minlength="8" autocomplete="new-password"></label>
            <button class="btn">Changer le mot de passe</button><div class="note" id="pwmsg"></div></form>
          <div class="row" style="margin-top:12px"><button class="btn" id="logout">Se déconnecter</button><span class="spacer"></span>
            <button class="btn danger" id="delacc">Supprimer mon compte</button></div></div>
        ${me.is_admin ? `<div class="panel span2"><h3>Invitations <span class="hint">administrateur</span></h3>
          <form id="iform" class="row"><label class="inline">Utilisations <input name="uses" type="number" min="1" max="200" value="1" class="sel" style="width:80px"></label>
            <label class="inline">Validité (jours) <input name="days" type="number" min="0" value="30" class="sel" style="width:80px"></label>
            <input name="note" placeholder="Pour qui ? (note)" class="sel" style="min-width:180px">
            <button class="btn primary">Créer un code</button></form>
          <div id="inew"></div><div class="tbl-wrap" id="ilist" style="margin-top:10px"></div></div>` : ""}
        <div class="panel span2" id="mybadges"><div class="loading">Chargement des badges…</div></div>
        ${me.is_admin ? '<div class="panel span2" id="adminbadges"></div>' : ""}
      </div>`;
    if (T.badges && T.badges.renderAccount) T.badges.renderAccount(T.$("#mybadges"), me.is_admin ? T.$("#adminbadges") : null).catch((e) => { T.$("#mybadges").innerHTML = `<p class="note warn">${T.esc(err(e))}</p>`; });
    T.$("#logout").onclick = () => M.sb.auth.signOut();
    T.$("#pform2").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await must(M.sb.from("profiles").update({ username: fd.get("username").trim(), show_on_leaderboard: !!fd.get("lb") }).eq("id", me.id));
        await loadProfile(); T.$("#pmsg").textContent = "Enregistré ✓";
      } catch (ex) { T.$("#pmsg").className = "note warn"; T.$("#pmsg").textContent = /duplicate|unique/i.test(err(ex)) ? "Ce pseudo est déjà pris." : err(ex); }
    });
    T.$("#pwform").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await must(M.sb.auth.updateUser({ password: new FormData(e.target).get("pw") })); T.$("#pwmsg").textContent = "Mot de passe changé ✓"; }
      catch (ex) { T.$("#pwmsg").className = "note warn"; T.$("#pwmsg").textContent = err(ex); }
    });
    T.$("#delacc").onclick = async () => {
      const ok = window.prompt("Supprimer définitivement ton compte, tes prédictions et tes portefeuilles ? Tape SUPPRIMER pour confirmer.");
      if (ok !== "SUPPRIMER") return;
      try { await must(M.sb.rpc("delete_my_account")); await M.sb.auth.signOut(); T.go("#/"); } catch (ex) { alert(err(ex)); }
    };
    if (me.is_admin) {
      const drawInvites = async () => {
        const rows = await must(M.sb.rpc("list_invites"));
        T.$("#ilist").innerHTML = `<table class="t"><thead><tr><th>Code</th><th class="n">Utilisé</th><th>Expire</th><th>Note</th><th>Créé</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td class="num">${T.esc(r.code)}</td><td class="n">${r.uses} / ${r.max_uses}</td><td>${r.expires_at ? F.date(r.expires_at.slice(0, 10)) : "jamais"}</td><td class="muted">${T.esc(r.note || "")}</td><td>${F.date(r.created_at.slice(0, 10))}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">Aucun code.</td></tr>'}</tbody></table>`;
      };
      T.$("#iform").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          const r = await must(M.sb.rpc("create_invite", { p_max_uses: +fd.get("uses") || 1, p_days: +fd.get("days") || 0, p_note: fd.get("note") || null }));
          const link = location.origin + location.pathname + "#/compte";
          const text = `Rejoins Archer Terminal (bêta) : ${link}\nCrée un compte avec le code ${r.code}`;
          T.$("#inew").innerHTML = `<div class="banner ok"><div>Nouveau code : <b class="num">${T.esc(r.code)}</b> <button class="btn" id="icopy">Copier le message d'invitation</button></div></div>`;
          T.$("#icopy").onclick = async () => { try { await navigator.clipboard.writeText(text); T.$("#icopy").textContent = "Copié ✓"; } catch (x) { window.prompt("Copie ce message :", text); } };
          drawInvites();
        } catch (ex) { alert(err(ex)); }
      });
      drawInvites();
    }
  }

  // ------------------------------------------------------------------ predictions (used by the ticker tab)
  M.loadPrediction = async (tk, label) => {
    const [pred, count, period] = await Promise.all([
      must(M.sb.from("predictions").select("*").eq("ticker", tk).eq("period", label).eq("user_id", T.member.id).maybeSingle()),
      must(M.sb.rpc("prediction_count", { p_ticker: tk, p_period: label })),
      must(M.sb.from("periods").select("*").eq("ticker", tk).eq("period", label).maybeSingle()),
    ]);
    let versions = 0;
    if (pred) {
      const h = await M.sb.from("prediction_history").select("id", { count: "exact", head: true }).eq("prediction_id", pred.id);
      versions = h.count || 0;
    }
    return { pred, count, period, versions };
  };

  M.savePrediction = async (existing, row) => {
    if (existing) return must(M.sb.from("predictions").update(row).eq("id", existing.id).select().single());
    return must(M.sb.from("predictions").insert(row).select().single());
  };

  function resultCard(p, r, opts = {}) {
    const res = (r && r.results) || {};
    const status = r ? ({ resolved: ["Vérifiée", "st-resolved"], partial: ["Partielle", "st-partial"], late: ["Hors délai", "st-late"] }[r.status]) : ["En attente", "st-pending"];
    const mrows = r && res.metrics ? res.metrics.map((m) => {
      const chips = [];
      if (m.in_interval === true) chips.push('<span class="chip-s ok">dans l\'intervalle</span>');
      if (m.in_interval === false) chips.push('<span class="chip-s ko">hors intervalle</span>');
      Object.entries(m.vs || {}).forEach(([b, v]) => chips.push(`<span class="chip-s ${v.you_win ? "ok" : "ko"}">${v.you_win ? "bat" : "battu par"} ${BENCH[b].toLowerCase()}</span>`));
      const et = m.kind === "margin" ? (T.isNum(m.error_pts) ? (m.error_pts > 0 ? "+" : "") + F.n(m.error_pts, 2) + " pt" : "-") : F.pct(m.error_pct, 1, true);
      return `<tr><td>${T.esc(m.label)}</td><td class="n"><b>${shown(m.key, m.value)}</b>${T.isNum(m.low) ? `<span class="yoy muted">${shown(m.key, m.low)} à ${shown(m.key, m.high)}</span>` : ""}</td>
        <td class="n">${shown(m.key, m.actual)}</td><td class="n">${m.actual != null ? et : "-"}</td>
        ${["naive", "guidance", "analysts", "crowd"].map((b) => `<td class="n">${shown(m.key, (m.benchmarks || {})[b])}</td>`).join("")}<td class="wrap">${chips.join(" ")}</td></tr>`;
    }).join("") : Object.entries(p.metrics || {}).map(([k, v]) => `<tr><td>${T.esc(METRIC[k] ? METRIC[k][0] : k)}</td><td class="n"><b>${shownInput(k, v.value)}</b>${T.isNum(v.low) ? `<span class="yoy muted">${shownInput(k, v.low)} à ${shownInput(k, v.high)}</span>` : ""}</td><td class="n">-</td><td class="n">-</td><td colspan="4"></td><td></td></tr>`).join("");
    const pts = (r && res.price_targets ? res.price_targets : p.price_targets || []).map((t) => `<tr><td>Cours ${T.esc(p.ticker)} au ${F.date(t.date)}</td>
      <td class="n"><b>${F.px(+t.value)}</b>${T.isNum(t.low) && T.isNum(t.high) ? `<span class="yoy muted">${F.n(t.low, 0)} à ${F.n(t.high, 0)}</span>` : ""}</td>
      <td class="n">${F.px(t.actual)}</td><td class="n">${T.isNum(t.error_pct) ? F.pct(t.error_pct, 1, true) : "-"}</td><td colspan="4"></td>
      <td>${t.in_interval === true ? '<span class="chip-s ok">dans l\'intervalle</span>' : t.in_interval === false ? '<span class="chip-s ko">hors intervalle</span>' : ""}</td></tr>`).join("");
    const qs = (r && res.questions ? res.questions : (p.questions || []).map((q) => ({ id: q.id, p: q.p, outcome: null })))
      .map((q) => `<div class="evq"><span>${T.esc(QLABEL[q.id] || q.id)}</span><span class="num">${F.n(q.p, 0)} %</span>
        <span>${q.outcome == null ? '<span class="muted">non résolue</span>' : q.outcome ? '<span class="chip-s ok">oui</span>' : '<span class="chip-s ko">non</span>'}</span>
        <span class="num muted">${T.isNum(q.brier) ? "Brier " + F.n(q.brier, 3) : ""}</span></div>`).join("");
    return `<div class="pcard"><div class="pcard-h"><div>${opts.who ? `<b data-user="${T.esc(opts.who)}">${T.esc(opts.who)}</b> · ` : ""}<b>${T.esc(p.ticker)} ${T.esc(p.period)}</b> <span class="badge ${status[1]}">${status[0]}</span>
        ${p.visibility === "private" ? '<span class="badge">privée</span>' : ""}</div>
        <div class="muted num" style="font-size:11.5px">modifiée ${F.dateTime(p.updated_at)}${r && r.scored_version_at ? ` · version notée du ${F.dateTime(r.scored_version_at)}` : ""}</div></div>
      ${mrows || pts ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Indicateur</th><th class="n">Prévision</th><th class="n">Réel</th><th class="n">Erreur</th><th class="n">Naïf</th><th class="n">Guidance</th><th class="n">Analystes</th><th class="n">Communauté</th><th>Verdict</th></tr></thead><tbody>${mrows}${pts}</tbody></table></div>` : ""}
      ${qs ? `<div class="group-title" style="margin-top:10px">Questions oui / non</div><div class="evqs">${qs}</div>` : ""}
      ${p.note ? `<blockquote class="pnote">${T.esc(p.note)}</blockquote>` : ""}</div>`;
  }
  M.resultCard = resultCard;

  // all my predictions, every ticker (global Prédictions page)
  M.renderMine = async (box) => {
    box.innerHTML = '<div class="loading">Chargement…</div>';
    try {
      const preds = await must(M.sb.from("predictions").select("*").eq("user_id", T.member.id).order("period", { ascending: false }));
      const results = preds.length ? await must(M.sb.from("prediction_results").select("*").in("prediction_id", preds.map((p) => p.id))) : [];
      const byId = Object.fromEntries(results.map((r) => [r.prediction_id, r]));
      const scored = results.filter((r) => r.status !== "late" && r.score);
      const revs = scored.map((r) => r.score.rev_err).filter(T.isNum);
      const iv = scored.reduce((a, r) => [a[0] + (r.score.interval_hit || 0), a[1] + (r.score.interval_n || 0)], [0, 0]);
      const br = scored.reduce((a, r) => [a[0] + (r.score.brier_sum || 0), a[1] + (r.score.brier_n || 0)], [0, 0]);
      const crowd = scored.filter((r) => "beat_crowd" in r.score);
      const k = (l, v, sub, hl) => `<div class="kpi ${hl ? "hl" : ""}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
      box.innerHTML = `<div class="kpis">
          ${k("Prédictions", `${preds.length}`, `${scored.length} vérifiée${scored.length > 1 ? "s" : ""}`, true)}
          ${k("Erreur CA", revs.length ? F.pct(revs.reduce((a, b) => a + Math.abs(b), 0) / revs.length, 1) : "-", revs.length ? `moyenne sur ${revs.length} trimestre${revs.length > 1 ? "s" : ""}` : "aucune vérifiée")}
          ${k("Biais CA", revs.length ? F.pct(revs.reduce((a, b) => a + b, 0) / revs.length, 1, true) : "-", "+ = trop optimiste")}
          ${k("Intervalles 80 %", iv[1] ? F.pct(iv[0] / iv[1], 0) : "-", iv[1] ? `${iv[0]} sur ${iv[1]} (cible 80 %)` : "cible 80 %")}
          ${k("vs communauté", crowd.length ? `${crowd.filter((r) => r.score.beat_crowd).length} / ${crowd.length}` : "-", "fois plus précis que la médiane des autres")}
          ${k("Oui / non", br[1] ? F.n(br[0] / br[1], 3) : "-", br[1] ? `Brier sur ${br[1]} question${br[1] > 1 ? "s" : ""} (0,25 = hasard)` : "Brier : plus bas = mieux")}</div>
        <div class="stack">${preds.map((p) => resultCard(p, byId[p.id])).join("") || '<div class="empty">Aucune prédiction pour l\'instant : ouvre l\'onglet Prédictions d\'une valeur.</div>'}</div>`;
    } catch (ex) { box.innerHTML = `<div class="banner">⚠ <div>${T.esc(err(ex))}</div></div>`; }
  };

  M.renderTickerPredictions = async (box, tk, label) => {
    box.innerHTML = '<div class="loading">Chargement…</div>';
    try {
      const preds = await must(M.sb.from("predictions").select("*, profiles(username)").eq("ticker", tk).order("period", { ascending: false }));
      const ids = preds.map((p) => p.id);
      const results = ids.length ? await must(M.sb.from("prediction_results").select("*").in("prediction_id", ids)) : [];
      const byId = Object.fromEntries(results.map((r) => [r.prediction_id, r]));
      const crowd = await must(M.sb.from("crowd_consensus").select("*").eq("ticker", tk));
      const mine = preds.filter((p) => p.user_id === T.member.id);
      const others = preds.filter((p) => p.user_id !== T.member.id);
      const crowdBy = {};
      crowd.forEach((c) => (crowdBy[c.period] = crowdBy[c.period] || []).push(c));
      box.innerHTML = `${mine.length ? mine.map((p) => resultCard(p, byId[p.id])).join("") : '<div class="empty">Aucune prédiction enregistrée pour cette valeur.</div>'}
        ${Object.keys(crowdBy).length ? `<div class="group-title" style="margin-top:22px">Consensus de la communauté</div>
          ${Object.entries(crowdBy).map(([per, rows]) => `<div class="panel" style="margin-bottom:10px"><h3>${T.esc(tk)} ${T.esc(per)} <span class="hint">prédictions enregistrées avant la date limite</span></h3>
            <div class="tbl-wrap"><table class="t"><thead><tr><th>Indicateur</th><th class="n">Membres</th><th class="n">Médiane</th><th class="n">Moyenne</th><th class="n">25 % - 75 %</th></tr></thead><tbody>
            ${rows.map((c) => `<tr><td>${T.esc(METRIC[c.metric] ? METRIC[c.metric][0] : c.metric)}</td><td class="n">${c.n}</td><td class="n"><b>${shown(c.metric, +c.median)}</b></td><td class="n">${shown(c.metric, +c.mean)}</td><td class="n muted">${shown(c.metric, +c.p25)} - ${shown(c.metric, +c.p75)}</td></tr>`).join("")}</tbody></table></div></div>`).join("")}` : ""}
        ${others.length ? `<div class="group-title" style="margin-top:22px">Prédictions des autres membres</div>${others.map((p) => resultCard(p, byId[p.id], { who: (p.profiles || {}).username })).join("")}` : ""}`;
      if (T.badges && T.badges.decorate) T.badges.decorate(box);
    } catch (ex) { box.innerHTML = `<div class="banner">⚠ <div>${T.esc(err(ex))}</div></div>`; }
  };

  // ------------------------------------------------------------------ #/communaute
  T.route(/^\/communaute$/, async (view) => {
    await M.ready;
    if (!gate(view)) return;
    view.innerHTML = '<div class="loading">Chargement…</div>';
    const [lb, pfs, vals, profiles] = await Promise.all([
      must(M.sb.rpc("leaderboard")), must(M.sb.from("portfolios").select("*")),
      must(M.sb.from("portfolio_values").select("*").order("date", { ascending: true })), must(M.sb.from("profiles").select("id, username")),
    ]);
    const uname = Object.fromEntries(profiles.map((p) => [p.id, p.username]));
    const lastVal = {};
    vals.forEach((v) => (lastVal[v.portfolio_id] = v));
    const ranking = pfs.map((p) => { const v = lastVal[p.id]; const value = v ? +v.value : +p.cash; return { ...p, value, perf: value / +p.initial_cash - 1 }; })
      .sort((a, b) => b.perf - a.perf);
    view.innerHTML = `<div class="thead"><div class="id"><h1>Communauté</h1><div class="sub">${profiles.length} membre(s) · classement des prédictions et des portefeuilles fictifs</div></div></div>
      <div class="panel"><h3>Classement des prévisionnistes <span class="hint">trié par erreur moyenne sur le CA</span></h3>
        <div class="tbl-wrap"><table class="t"><thead><tr><th>#</th><th>Membre</th><th class="n">Prédictions</th><th class="n">Erreur CA</th><th class="n">Biais CA</th><th class="n">Intervalles</th><th class="n">Bat la communauté</th><th class="n">Brier</th></tr></thead><tbody>
        ${lb.map((r, i) => `<tr class="${r.username === T.member.username ? "hl" : ""}"><td class="n">${i + 1}</td><td data-user="${T.esc(r.username)}"><b>${T.esc(r.username)}</b></td><td class="n">${r.n}</td>
          <td class="n">${r.rev_n ? F.pct(+r.rev_mae, 1) : "-"}</td><td class="n">${r.rev_n ? F.pct(+r.rev_bias, 1, true) : "-"}</td>
          <td class="n">${r.interval_n ? `${r.interval_hit} / ${r.interval_n}` : "-"}</td><td class="n">${r.crowd_n ? `${r.crowd_wins} / ${r.crowd_n}` : "-"}</td>
          <td class="n">${r.brier_n ? F.n(+r.brier, 3) : "-"}</td></tr>`).join("") || '<tr><td colspan="8"><div class="empty">Le classement apparaît après la première publication vérifiée.</div></td></tr>'}
        </tbody></table></div>
        <p class="note">Erreur CA = écart moyen en valeur absolue avec le chiffre publié. Biais : + = trop optimiste. Intervalles : à 80 %, l'objectif est d'avoir raison 8 fois sur 10. Brier : 0 = parfait, 0,25 = hasard.</p></div>
      <div class="panel" style="margin-top:14px"><h3><span>Portefeuilles fictifs <span class="hint">100 000 $ de départ</span></span> <a class="hint" href="#/portefeuilles">mes portefeuilles →</a></h3>
        <div class="tbl-wrap"><table class="t"><thead><tr><th>#</th><th>Portefeuille</th><th>Membre</th><th class="n">Valeur</th><th class="n">Performance</th><th class="n">Créé le</th></tr></thead><tbody>
        ${ranking.map((p, i) => `<tr style="cursor:pointer" data-href="#/portefeuilles/${p.id}"><td class="n">${i + 1}</td><td><b>${T.esc(p.name)}</b></td><td data-user="${T.esc(uname[p.user_id] || "")}">${T.esc(uname[p.user_id] || "?")}</td>
          <td class="n">${F.n(p.value, 0)} $</td><td class="n ${T.cls(p.perf)}"><b>${F.pct(p.perf, 2, true)}</b></td><td class="n">${F.date(p.created_at.slice(0, 10))}</td></tr>`).join("") || '<tr><td colspan="6"><div class="empty">Aucun portefeuille pour l\'instant.</div></td></tr>'}
        </tbody></table></div></div>
      <div class="panel" style="margin-top:14px"><h3>Membres <span class="hint">clique sur un pseudo pour voir son profil</span></h3>
        <div class="member-grid">${profiles.slice().sort((a, b) => a.username.localeCompare(b.username)).map((p) => `<a class="member-card" href="#/membre/${encodeURIComponent(p.username)}">
          <span class="conv-av">${T.esc(p.username.slice(0, 1).toUpperCase())}</span><span data-user="${T.esc(p.username)}"><b>${T.esc(p.username)}</b></span></a>`).join("")}</div></div>`;
    T.$$("tr[data-href]").forEach((tr) => tr.addEventListener("click", () => T.go(tr.dataset.href)));
    if (T.badges && T.badges.decorate) T.badges.decorate(view);
  });

  // ------------------------------------------------------------------ #/portefeuilles
  function positions(trades) {
    const pos = {};
    trades.slice().sort((a, b) => a.id - b.id).forEach((t) => {
      const p = pos[t.ticker] || (pos[t.ticker] = { qty: 0, cost: 0 });
      const q = +t.qty, px = +t.price;
      if (t.side === "buy") { p.cost += q * px; p.qty += q; }
      else { const avg = p.qty ? p.cost / p.qty : 0; p.qty -= q; p.cost -= avg * q; }
    });
    Object.keys(pos).forEach((k) => { if (Math.abs(pos[k].qty) < 1e-9) delete pos[k]; });
    return pos;
  }

  T.route(/^\/portefeuilles$/, async (view) => {
    await M.ready;
    if (!gate(view)) return;
    const pfs = await must(M.sb.from("portfolios").select("*").eq("user_id", T.member.id).order("created_at"));
    view.innerHTML = `<div class="thead"><div class="id"><h1>Mes portefeuilles</h1><div class="sub">Portefeuilles fictifs : 100 000 $ de départ, ordres exécutés à la clôture suivante, pas de vente à découvert</div></div></div>
      <div class="grid g3">${pfs.map((p) => `<a class="panel pf-card" href="#/portefeuilles/${p.id}"><h3>${T.esc(p.name)} <span class="hint">${p.visibility === "group" ? "visible par le groupe" : "privé"}</span></h3>
        <div class="big-val" style="font-size:22px">${F.n(+p.cash, 0)} $</div><div class="muted">liquidités</div></a>`).join("")}
        <form class="panel pf-card" id="newpf"><h3>Nouveau portefeuille</h3><input name="name" class="sel" placeholder="Nom (ex. Semi-conducteurs)" maxlength="40" required style="width:100%">
          <label class="check"><input type="checkbox" name="vis" checked> visible par le groupe</label><button class="btn primary">Créer</button><div class="note" id="pfmsg"></div></form></div>`;
    T.$("#newpf").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try { const p = await must(M.sb.from("portfolios").insert({ name: fd.get("name").trim(), visibility: fd.get("vis") ? "group" : "private" }).select().single()); T.go(`#/portefeuilles/${p.id}`); }
      catch (ex) { T.$("#pfmsg").className = "note warn"; T.$("#pfmsg").textContent = err(ex); }
    });
  });

  T.route(/^\/portefeuilles\/([0-9a-f-]{36})$/, async (view, id) => {
    await M.ready;
    if (!gate(view)) return;
    const [pf, trades, prices, values] = await Promise.all([
      must(M.sb.from("portfolios").select("*, profiles(username)").eq("id", id).maybeSingle()),
      must(M.sb.from("trades").select("*").eq("portfolio_id", id).order("id")),
      must(M.sb.from("latest_prices").select("*").order("ticker")),
      must(M.sb.from("portfolio_values").select("*").eq("portfolio_id", id).order("date")),
    ]);
    if (!pf) { view.innerHTML = '<div class="empty">Portefeuille introuvable ou privé.</div>'; return; }
    const own = pf.user_id === T.member.id;
    const orders = own ? await must(M.sb.from("orders").select("*").eq("portfolio_id", id).order("id", { ascending: false }).limit(50)) : [];
    const px = Object.fromEntries(prices.map((p) => [p.ticker, p]));
    const pos = positions(trades);
    const rows = Object.entries(pos).map(([tk, p]) => { const last = px[tk] ? +px[tk].close : null; const val = last != null ? p.qty * last : null;
      return { tk, qty: p.qty, avg: p.cost / p.qty, last, val, pnl: val != null ? val - p.cost : null, pnlPct: val != null ? val / p.cost - 1 : null }; });
    // options: positions from the trades, marked at the latest quote mid (intrinsic value if none)
    const [otr, oord] = await Promise.all([
      must(M.sb.from("option_trades").select("*").eq("portfolio_id", id).order("id")).catch(() => []),
      own ? must(M.sb.from("option_orders").select("*").eq("portfolio_id", id).order("id", { ascending: false }).limit(50)).catch(() => []) : [],
    ]);
    const okey = (t) => `${t.ticker}|${t.expiry}|${+t.strike}|${t.type}`;
    const opos = {};
    otr.forEach((t) => { const k = okey(t), p = opos[k] || (opos[k] = { ticker: t.ticker, expiry: t.expiry, strike: +t.strike, type: t.type, qty: 0, cost: 0 });
      if (t.side === "buy") { p.cost += t.qty * +t.price * 100; p.qty += t.qty; } else { const avg = p.qty ? p.cost / p.qty : 0; p.qty -= t.qty; p.cost -= avg * t.qty; } });
    const oheld = Object.values(opos).filter((p) => p.qty > 0);
    let oquotes = [];
    if (oheld.length) oquotes = await must(M.sb.from("option_quotes").select("*").in("ticker", [...new Set(oheld.map((p) => p.ticker))])).catch(() => []);
    const oq = Object.fromEntries(oquotes.map((q) => [okey(q), q]));
    const orows = oheld.map((p) => { const q = oq[okey(p)]; const S = px[p.ticker] ? +px[p.ticker].close : null;
      const mark = q && q.mid ? +q.mid : S != null ? Math.max(0, p.type === "C" ? S - p.strike : p.strike - S) : null;
      const val = mark != null ? mark * 100 * p.qty : null;
      return { ...p, mark, val, pnl: val != null ? val - p.cost : null, avg: p.cost / p.qty / 100, dte: Math.ceil((new Date(p.expiry + "T21:00:00Z") - Date.now()) / 864e5) }; });
    const optValue = orows.reduce((a, r) => a + (r.val || 0), 0);
    const invested = rows.reduce((a, r) => a + (r.val || 0), 0) + optValue;
    const total = +pf.cash + invested;
    const perf = total / +pf.initial_cash - 1;
    view.innerHTML = `<div class="thead"><div class="id"><h1>${T.esc(pf.name)}</h1><div class="sub">${own ? "Mon portefeuille" : "Portefeuille de " + `<span data-user="${T.esc((pf.profiles || {}).username || "")}">${T.esc((pf.profiles || {}).username || "?")}</span>`} · fictif · créé le ${F.date(pf.created_at.slice(0, 10))}</div></div>
        <div class="quote"><span class="px">${F.n(total, 0)} $</span><span class="chg ${T.cls(perf)}">${F.pct(perf, 2, true)}</span></div></div>
      <div class="kpis"><div class="kpi"><div class="l">Liquidités</div><div class="v">${F.n(+pf.cash, 0)} $</div><div class="s">${F.pct(+pf.cash / total, 0)} du total</div></div>
        <div class="kpi"><div class="l">Investi</div><div class="v">${F.n(invested, 0)} $</div><div class="s">${rows.length} ligne(s)${orows.length ? ` + ${orows.length} option(s)` : ""}</div></div>
        <div class="kpi"><div class="l">Plus-value latente</div><div class="v ${T.cls(rows.concat(orows).reduce((a, r) => a + (r.pnl || 0), 0))}">${F.n(rows.concat(orows).reduce((a, r) => a + (r.pnl || 0), 0), 0)} $</div><div class="s">actions et options, dernière clôture</div></div>
        <div class="kpi"><div class="l">Départ</div><div class="v">${F.n(+pf.initial_cash, 0)} $</div><div class="s">capital fictif</div></div></div>
      <div id="pfanalytics" style="margin:14px 0"></div>
      <div class="grid g-main">
        <div class="stack">
          <div class="panel"><h3>Positions</h3><div class="tbl-wrap"><table class="t"><thead><tr><th>Valeur</th><th class="n">Quantité</th><th class="n">Prix moyen</th><th class="n">Dernier cours</th><th class="n">Valeur</th><th class="n">+/- value</th><th class="n">Poids</th></tr></thead><tbody>
            ${rows.map((r) => `<tr><td><b>${r.tk}</b> <span class="muted">${T.esc((px[r.tk] || {}).name || "")}</span></td><td class="n">${F.n(r.qty, r.qty % 1 ? 2 : 0)}</td><td class="n">${F.px(r.avg)}</td><td class="n">${F.px(r.last)}</td>
              <td class="n">${F.n(r.val, 0)} $</td><td class="n ${T.cls(r.pnl)}">${F.n(r.pnl, 0)} $ <span class="yoy">${F.pct(r.pnlPct, 1, true)}</span></td><td class="n">${F.pct(r.val / total, 1)}</td></tr>`).join("") || '<tr><td colspan="7" class="muted">Aucune position.</td></tr>'}
            </tbody></table></div></div>
          ${orows.length || otr.length ? `<div class="panel"><h3>Options <span class="hint">1 contrat = 100 actions · marqué au milieu bid / ask</span></h3>
            <div class="tbl-wrap"><table class="t"><thead><tr><th>Contrat</th><th class="n">Qté</th><th class="n">Prime moy.</th><th class="n">Dernier</th><th class="n">Valeur</th><th class="n">+/- value</th><th class="n">Échéance</th>${own ? "<th></th>" : ""}</tr></thead><tbody>
            ${orows.map((r) => `<tr><td><b>${r.ticker}</b> ${F.n(r.strike, r.strike % 1 ? 1 : 0)} ${r.type === "C" ? "call" : "put"} <span class="muted">${F.date(r.expiry)}</span></td><td class="n">${r.qty}</td><td class="n">${F.n(r.avg, 2)}</td><td class="n">${F.n(r.mark, 2)}</td>
              <td class="n">${F.n(r.val, 0)} $</td><td class="n ${T.cls(r.pnl)}">${F.n(r.pnl, 0)} $ <span class="yoy">${F.pct(r.pnl / r.cost, 0, true)}</span></td><td class="n">${r.dte > 0 ? "J-" + r.dte : "aujourd'hui"}</td>
              ${own ? `<td><button class="btn btn-xs" data-osell="${T.esc(okey(r))}" data-max="${r.qty}">Vendre</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="${own ? 8 : 7}" class="muted">Aucune position ouverte.</td></tr>`}
            </tbody></table></div>
            ${otr.length ? `<details style="margin-top:8px"><summary class="sec" style="cursor:pointer">Historique des contrats (${otr.length})</summary><div class="tbl-wrap"><table class="t"><thead><tr><th>Date</th><th>Opération</th><th>Contrat</th><th class="n">Qté</th><th class="n">Prix</th><th class="n">Montant</th></tr></thead><tbody>
              ${otr.slice().sort((a, b) => (b.trade_date || "").localeCompare(a.trade_date || "") || b.id - a.id).map((t) => `<tr><td>${F.date(t.trade_date)}</td><td class="${t.side === "buy" ? "up" : "down"}">${{ buy: "Achat", sell: "Vente", expire: "Échéance" }[t.side]}</td><td>${t.ticker} ${F.n(+t.strike, 0)} ${t.type} ${F.date(t.expiry)}</td><td class="n">${t.qty}</td><td class="n">${F.n(+t.price, 2)}</td><td class="n">${F.n(t.qty * +t.price * 100, 0)} $</td></tr>`).join("")}</tbody></table></div></details>` : ""}</div>` : ""}
          <div class="panel"><h3>Historique des transactions</h3><div class="tbl-wrap"><table class="t"><thead><tr><th>Date</th><th>Sens</th><th>Valeur</th><th class="n">Quantité</th><th class="n">Cours</th><th class="n">Montant</th></tr></thead><tbody>
            ${trades.slice().sort((a, b) => (b.price_date || "").localeCompare(a.price_date || "") || b.id - a.id).map((t) => `<tr><td>${F.date(t.price_date)}</td><td class="${t.side === "buy" ? "up" : "down"}">${t.side === "buy" ? "Achat" : "Vente"}</td><td><b>${t.ticker}</b></td><td class="n">${F.n(+t.qty, +t.qty % 1 ? 2 : 0)}</td><td class="n">${F.px(+t.price)}</td><td class="n">${F.n(+t.qty * +t.price, 0)} $</td></tr>`).join("") || '<tr><td colspan="6" class="muted">Aucune transaction.</td></tr>'}
            </tbody></table></div></div>
        </div>
        ${own ? `<div class="stack"><div class="panel sticky-panel"><h3>Passer un ordre</h3>
            <form id="oform" class="aform">
              <div class="seg" id="oside"><button type="button" data-k="buy" class="on">Achat</button><button type="button" data-k="sell">Vente</button></div>
              <label>Valeur<select name="ticker" class="sel" style="width:100%">${prices.map((p) => `<option value="${p.ticker}">${p.ticker} · ${T.esc(p.name || "")} · ${F.px(+p.close)}</option>`).join("")}</select></label>
              <label>Quantité<input name="qty" inputmode="decimal" required></label>
              <div class="note" id="oest"></div>
              <button class="btn primary" type="submit">Envoyer l'ordre</button><div class="note" id="omsg"></div></form>
            <p class="note">Ordre au marché, exécuté au <b>cours de clôture de la prochaine séance</b> (mise à jour du site à 21h37 UTC les jours ouvrés). Un ordre passé avant 16h00 à New York est exécuté à la clôture du jour même. Rejeté si les liquidités ou la position sont insuffisantes au moment de l'exécution.</p></div>
          <div class="panel"><h3>Ordre sur options <a class="hint" href="#/options">espace Options →</a></h3>
            <form id="xform" class="aform">
              <div class="seg" id="xside"><button type="button" data-k="buy" class="on">Achat</button><button type="button" data-k="sell">Vente</button></div>
              <div class="row"><select name="tk" class="sel"></select><select name="exp" class="sel"></select><select name="type" class="sel"><option value="C">Call</option><option value="P">Put</option></select><select name="k" class="sel"></select></div>
              <label>Contrats<input name="q" type="number" min="1" max="100" value="1"></label>
              <div class="note" id="xest"></div><button class="btn primary">Envoyer l'ordre</button><div class="note" id="xmsg"></div></form>
            <p class="note">Positions acheteuses uniquement : achat, puis revente ou dénouement à l'échéance (valeur intrinsèque). Exécution à la clôture de la prochaine séance, au prix demandé à l'achat et au prix offert à la vente.</p>
            ${oord.length ? `<div class="group-title">Ordres sur options</div>${oord.map((o) => `<div class="order-row"><span class="${o.side === "buy" ? "up" : "down"}">${o.side === "buy" ? "Achat" : "Vente"}</span> <b>${o.qty} ${o.ticker} ${F.n(+o.strike, 0)} ${o.type}</b> <span class="muted">${F.date(o.expiry)}</span>
              <span class="badge ${o.status === "filled" ? "st-resolved" : o.status === "pending" ? "st-pending" : "st-late"}">${{ pending: "en attente", filled: "exécuté", rejected: "rejeté", cancelled: "annulé" }[o.status]}</span>
              <span class="muted num">${o.status === "filled" ? `${F.n(+o.fill_price, 2)} le ${F.date(o.fill_date)}` : o.reason ? T.esc(o.reason) : F.dateTime(o.created_at)}</span>
              ${o.status === "pending" ? `<button class="btn" data-ocancel="${o.id}">Annuler</button>` : ""}</div>`).join("")}` : ""}</div>
          <div class="panel"><h3>Ordres</h3><div id="olist">${orders.map((o) => `<div class="order-row"><span class="${o.side === "buy" ? "up" : "down"}">${o.side === "buy" ? "Achat" : "Vente"}</span> <b>${F.n(+o.qty, +o.qty % 1 ? 2 : 0)} ${o.ticker}</b>
            <span class="badge ${o.status === "filled" ? "st-resolved" : o.status === "pending" ? "st-pending" : "st-late"}">${{ pending: "en attente", filled: "exécuté", rejected: "rejeté", cancelled: "annulé" }[o.status]}</span>
            <span class="muted num">${o.status === "filled" ? `${F.px(+o.fill_price)} le ${F.date(o.fill_date)}` : o.reason ? T.esc(o.reason) : F.dateTime(o.created_at)}</span>
            ${o.status === "pending" ? `<button class="btn" data-cancel="${o.id}">Annuler</button>` : ""}</div>`).join("") || '<div class="muted">Aucun ordre.</div>'}</div></div>
          <div class="panel"><h3>Réglages</h3><form id="rform" class="row"><input name="name" class="sel" value="${T.esc(pf.name)}" maxlength="40"><select name="vis" class="sel"><option value="group" ${pf.visibility === "group" ? "selected" : ""}>visible par le groupe</option><option value="private" ${pf.visibility === "private" ? "selected" : ""}>privé</option></select><button class="btn">Enregistrer</button></form>
            <button class="btn danger" id="pfdel" style="margin-top:10px">Supprimer ce portefeuille</button></div></div>` : ""}
      </div>`;
    if (!own && T.badges && T.badges.decorate) T.badges.decorate(view);
    // analytics (risk / return, allocation, contribution, trading record)
    if (T.PA) {
      const uni = await T.get("universe.json").catch(() => null);
      T.PA.render(T.$("#pfanalytics"), { values, trades, rows, orows, px, total, cash: +pf.cash, universe: uni });
    }
    if (!own) return;
    let side = "buy";
    const est = () => { const f = new FormData(T.$("#oform")); const q = parseFloat(String(f.get("qty") || "").replace(",", ".")); const p = px[f.get("ticker")];
      T.$("#oest").textContent = isFinite(q) && p ? `Montant estimé au dernier cours (${F.date(p.price_date)}) : ${F.n(q * +p.close, 0)} $` : ""; };
    T.$("#oside").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; side = b.dataset.k; T.$$("#oside button").forEach((x) => x.classList.toggle("on", x === b)); });
    T.$("#oform").addEventListener("input", est);
    T.$("#oform").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const q = parseFloat(String(f.get("qty")).replace(",", "."));
      try { await must(M.sb.rpc("place_order", { p_portfolio: id, p_ticker: f.get("ticker"), p_side: side, p_qty: q })); T.render(); if (T.badges && T.badges.refresh) T.badges.refresh(); }
      catch (ex) { T.$("#omsg").className = "note warn"; T.$("#omsg").textContent = err(ex); }
    });
    T.$$("[data-cancel]").forEach((b) => b.addEventListener("click", async () => { try { await must(M.sb.rpc("cancel_order", { p_order: +b.dataset.cancel })); T.render(); } catch (ex) { alert(err(ex)); } }));
    T.$("#rform").addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target);
      try { await must(M.sb.rpc("rename_portfolio", { p_portfolio: id, p_name: f.get("name"), p_visibility: f.get("vis") })); T.render(); } catch (ex) { alert(err(ex)); } });
    // ---- options order form (chains from the published options.json of each covered stock)
    let xside = "buy", chain = null;
    const u = await T.get("universe.json");
    const xf = T.$("#xform");
    const xs = (n) => xf.querySelector(`[name=${n}]`);
    const optTk = [];
    for (const t of u.tickers) { try { await T.get(`${t.ticker}/options.json`); optTk.push(t.ticker); } catch (e) { /* no options */ } }
    xs("tk").innerHTML = optTk.map((t) => `<option>${t}</option>`).join("");
    const fillStrikes = () => { const rows = (chain.chains[xs("exp").value] || []);
      const S = chain.spot, keep = xs("k").value;
      xs("k").innerHTML = rows.map((r) => `<option value="${r.strike}" ${String(r.strike) === keep || (!keep && Math.abs(r.strike - S) === Math.min(...rows.map((x) => Math.abs(x.strike - S)))) ? "selected" : ""}>${F.n(r.strike, r.strike % 1 ? 1 : 0)}${Math.abs(r.strike - S) < S * 0.01 ? " (ATM)" : ""}</option>`).join("");
      xest(); };
    const xest = () => { const r = (chain.chains[xs("exp").value] || []).find((x) => String(x.strike) === xs("k").value) || {};
      const p = xs("type").value === "C" ? "c" : "p", q = +xs("q").value || 0;
      const px_ = xside === "buy" ? (r[p + "_ask"] || r[p + "_mid"]) : (r[p + "_bid"] || r[p + "_mid"]);
      T.$("#xest").textContent = T.isNum(px_) ? `Prime ${F.n(px_, 2)} $ (${xside === "buy" ? "ask" : "bid"} du ${F.dateTime(chain.asof)}) · ${xside === "buy" ? "coût" : "produit"} estimé ${F.n(px_ * 100 * q, 0)} $ · IV ${F.pct(r[p + "_iv"], 1)}` : "Pas de cotation récente pour ce contrat."; };
    const loadTk = async () => { chain = await T.get(`${xs("tk").value}/options.json`);
      xs("exp").innerHTML = chain.expiries.filter((e) => chain.chains[e.date] && e.dte >= 2).map((e) => `<option value="${e.date}">${F.date(e.date)} · ${F.n(e.dte, 0)} j</option>`).join("");
      xs("k").innerHTML = ""; fillStrikes(); };
    if (optTk.length) await loadTk(); else T.$("#xform").innerHTML = '<p class="note">Aucune chaîne d\'options disponible.</p>';
    xs("tk") && xs("tk").addEventListener("change", loadTk);
    xs("exp") && xs("exp").addEventListener("change", fillStrikes);
    ["type", "k", "q"].forEach((n) => xs(n) && xs(n).addEventListener("input", xest));
    T.$("#xside").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; xside = b.dataset.k; T.$$("#xside button").forEach((x) => x.classList.toggle("on", x === b)); xest(); });
    xf.addEventListener("submit", async (e) => { e.preventDefault();
      try { await must(M.sb.rpc("place_option_order", { p_portfolio: id, p_ticker: xs("tk").value, p_expiry: xs("exp").value, p_strike: +xs("k").value, p_type: xs("type").value, p_side: xside, p_qty: +xs("q").value }));
        T.render(); } catch (ex) { T.$("#xmsg").className = "note warn"; T.$("#xmsg").textContent = err(ex); } });
    T.$$("[data-ocancel]").forEach((b) => b.addEventListener("click", async () => { try { await must(M.sb.rpc("cancel_option_order", { p_order: +b.dataset.ocancel })); T.render(); } catch (ex) { alert(err(ex)); } }));
    T.$$("[data-osell]").forEach((b) => b.addEventListener("click", async () => {
      const [tk, exp, k, typ] = b.dataset.osell.split("|");
      const q = parseInt(window.prompt(`Vendre combien de contrats ${tk} ${k} ${typ} ${exp} ? (max ${b.dataset.max})`, b.dataset.max), 10);
      if (!q) return;
      try { await must(M.sb.rpc("place_option_order", { p_portfolio: id, p_ticker: tk, p_expiry: exp, p_strike: +k, p_type: typ, p_side: "sell", p_qty: q })); T.render(); }
      catch (ex) { alert(err(ex)); } }));
    T.$("#pfdel").onclick = async () => { if (!confirm("Supprimer ce portefeuille et son historique ?")) return;
      try { await must(M.sb.from("portfolios").delete().eq("id", id)); T.go("#/portefeuilles"); } catch (ex) { alert(err(ex)); } };
  });
})();
