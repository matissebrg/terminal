/* Profils des membres, messagerie privée, liste des membres (administrateurs).
 * Ce que chaque page montre est filtré par la base : un membre ne lit que ses conversations,
 * les prédictions des autres n'apparaissent qu'après leur date limite. */
(function () {
  "use strict";
  const T = window.T, F = T.fmt, M = T.members;
  if (!M || !M.configured) return;
  const err = (e) => (e && (e.message || String(e))) || "Erreur inconnue";
  async function must(p) { const r = await p; if (r.error) throw new Error(err(r.error)); return r.data; }
  const B = () => T.badges;
  function gate(view) {
    if (!T.member) { view.innerHTML = `<div class="panel"><h3>Réservé aux membres</h3><p class="sec">Connecte-toi ou rejoins la bêta avec un code d'invitation.</p><a class="btn primary" href="#/compte">Se connecter</a></div>`; return false; }
    return true;
  }
  const userLink = (u) => `<a href="#/membre/${encodeURIComponent(u)}" data-user="${T.esc(u)}">${T.esc(u)}</a>`;
  let poll = null;
  const stopPoll = () => { clearInterval(poll); poll = null; };
  window.addEventListener("hashchange", stopPoll);

  const applyRole = () => document.body.classList.toggle("is-admin", !!(T.member && T.member.is_admin));
  (M.onProfile = M.onProfile || []).push(applyRole);
  M.ready.then(applyRole);

  // ------------------------------------------------------------------ #/membre/<pseudo>
  T.route(/^\/membre\/([^/]+)$/, async (view, raw) => {
    await M.ready;
    if (!gate(view)) return;
    const u = decodeURIComponent(raw);
    const prof = await must(M.sb.from("profiles").select("id, username, created_at, is_admin, title_badge, show_on_leaderboard").eq("username", u).maybeSingle());
    if (!prof) { view.innerHTML = '<div class="empty">Membre introuvable.</div>'; return; }
    await B().load(); await B().loadAll();
    const [ub, lb, preds, pfs] = await Promise.all([
      must(M.sb.from("user_badges").select("*").eq("user_id", prof.id)),
      must(M.sb.rpc("leaderboard")),
      must(M.sb.from("predictions").select("*").eq("user_id", prof.id).order("period", { ascending: false })),
      must(M.sb.from("portfolios").select("*").eq("user_id", prof.id)),
    ]);
    const have = Object.fromEntries(ub.map((r) => [r.badge_id, r]));
    const tier = B().catalog.filter((b) => b.kind === "tier" && have[b.id]).sort((a, b) => b.rank - a.rank)[0];
    const title = prof.title_badge && B().byId[prof.title_badge];
    const me = prof.id === T.member.id;
    const rank = lb.findIndex((r) => r.username === prof.username);
    const st = rank >= 0 ? lb[rank] : null;
    const results = preds.length ? await must(M.sb.from("prediction_results").select("*").in("prediction_id", preds.map((p) => p.id))) : [];
    const byId = Object.fromEntries(results.map((r) => [r.prediction_id, r]));
    const vals = pfs.length ? await must(M.sb.from("portfolio_values").select("*").in("portfolio_id", pfs.map((p) => p.id)).order("date")) : [];
    const lastVal = {};
    vals.forEach((v) => (lastVal[v.portfolio_id] = v));
    const k = (l, v, s, hl) => `<div class="kpi ${hl ? "hl" : ""}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    view.innerHTML = `<div class="profile-head panel">
        ${tier ? `<img class="tier-img" src="assets/badges/${tier.image}" alt="${T.esc(tier.name)}" style="height:72px">` : ""}
        <div class="ph-id"><h1>${T.esc(prof.username)}</h1>
          ${title && title.title ? `<div class="ph-title">${T.esc(title.title)}</div>` : ""}
          <div class="sub">Membre depuis le ${F.date(prof.created_at.slice(0, 10))}${prof.is_admin ? " · administrateur" : ""}</div></div>
        <span class="spacer"></span>
        ${me ? '<a class="btn" href="#/compte">Modifier mon profil</a>' : `<a class="btn primary" href="#/messages/${encodeURIComponent(prof.username)}">Envoyer un message</a>`}
      </div>
      <div class="kpis" style="margin-top:14px">
        ${k("Classement", st ? `#${rank + 1}` : "-", st ? `sur ${lb.length} prévisionniste(s)` : prof.show_on_leaderboard ? "pas encore de prédiction vérifiée" : "ne figure pas au classement", true)}
        ${k("Prédictions vérifiées", st ? st.n : "-", `${preds.length} visible(s) ici`)}
        ${k("Erreur CA", st && st.rev_n ? F.pct(+st.rev_mae, 1) : "-", "écart moyen avec le chiffre publié")}
        ${k("Intervalles 80 %", st && st.interval_n ? `${st.interval_hit} / ${st.interval_n}` : "-", "cible 80 %")}
        ${k("Brier", st && st.brier_n ? F.n(+st.brier, 3) : "-", "questions oui / non")}
        ${k("Badges", Object.keys(have).length, `sur ${B().catalog.length}`)}
      </div>
      <div class="panel" style="margin-top:14px"><h3>Badges <span class="hint">${me ? "tous, y compris à débloquer" : "obtenus"}</span></h3>${B().showcase(have, { ownedOnly: !me })}</div>
      ${pfs.length ? `<div class="panel" style="margin-top:14px"><h3>Portefeuilles fictifs</h3><div class="tbl-wrap"><table class="t"><thead><tr><th>Portefeuille</th><th class="n">Valeur</th><th class="n">Performance</th><th class="n">Créé le</th></tr></thead><tbody>
        ${pfs.map((p) => { const v = lastVal[p.id] ? +lastVal[p.id].value : +p.cash; const perf = v / +p.initial_cash - 1;
          return `<tr style="cursor:pointer" data-href="#/portefeuilles/${p.id}"><td><b>${T.esc(p.name)}</b>${p.visibility === "private" ? ' <span class="badge">privé</span>' : ""}</td><td class="n">${F.n(v, 0)} $</td><td class="n ${T.cls(perf)}">${F.pct(perf, 2, true)}</td><td class="n">${F.date(p.created_at.slice(0, 10))}</td></tr>`; }).join("")}
        </tbody></table></div></div>` : ""}
      <div class="group-title" style="margin-top:22px">Prédictions ${me ? "" : '<span class="muted" style="text-transform:none;letter-spacing:0">visibles après la date limite de chaque publication</span>'}</div>
      <div class="stack">${preds.length ? preds.map((p) => M.resultCard(p, byId[p.id])).join("") : '<div class="empty">Aucune prédiction visible pour l\'instant.</div>'}</div>`;
    T.$$("tr[data-href]", view).forEach((tr) => tr.addEventListener("click", () => T.go(tr.dataset.href)));
  });

  // ------------------------------------------------------------------ #/messages
  T.route(/^\/messages$/, async (view) => {
    await M.ready;
    if (!gate(view)) return;
    const [conv, profs] = await Promise.all([must(M.sb.rpc("conversations")), must(M.sb.from("profiles").select("username").order("username"))]);
    const others = profs.map((p) => p.username).filter((u) => u !== T.member.username);
    view.innerHTML = `<div class="thead"><div class="id"><h1>Messages</h1><div class="sub">Conversations privées entre membres · visibles uniquement par les deux personnes</div></div></div>
      <div class="grid g-main">
        <div class="panel"><h3>Conversations</h3>
          <div class="conv-list">${conv.length ? conv.map((c) => `<a class="conv ${c.unread ? "unread" : ""}" href="#/messages/${encodeURIComponent(c.username)}">
              <span class="conv-av">${T.esc(c.username.slice(0, 1).toUpperCase())}</span>
              <span class="conv-main"><b data-user="${T.esc(c.username)}">${T.esc(c.username)}</b>${c.blocked ? ' <span class="badge">bloqué</span>' : ""}
                <span class="muted">${c.last_from_me ? "Toi : " : ""}${T.esc(c.last_body.slice(0, 90))}</span></span>
              <span class="conv-side"><span class="notif-t">${F.dateTime(c.last_at)}</span>${c.unread ? `<span class="bell-dot static">${c.unread}</span>` : ""}</span></a>`).join("")
            : '<div class="empty">Aucune conversation. Choisis un membre à droite pour écrire le premier message.</div>'}</div></div>
        <div class="panel"><h3>Nouveau message</h3>
          <form id="newconv" class="aform"><label>À<select name="u" class="sel" style="width:100%">${others.map((u) => `<option>${T.esc(u)}</option>`).join("")}</select></label>
            <button class="btn primary" ${others.length ? "" : "disabled"}>Ouvrir la conversation</button></form>
          <p class="note">Les messages ne sont pas chiffrés de bout en bout : ils sont stockés dans la base de la bêta, mais ni les autres membres ni les administrateurs ne peuvent les lire depuis le site. Seul un message que tu signales est transmis aux administrateurs. 30 messages au plus par tranche de 10 minutes.</p></div>
      </div>`;
    T.$("#newconv").addEventListener("submit", (e) => { e.preventDefault(); T.go(`#/messages/${encodeURIComponent(new FormData(e.target).get("u"))}`); });
    if (B()) B().decorate(view);
  });

  // ------------------------------------------------------------------ #/messages/<pseudo>
  T.route(/^\/messages\/([^/]+)$/, async (view, raw) => {
    await M.ready;
    if (!gate(view)) return;
    const u = decodeURIComponent(raw);
    const other = await must(M.sb.from("profiles").select("id, username").eq("username", u).maybeSingle());
    if (!other || other.id === T.member.id) { view.innerHTML = '<div class="empty">Membre introuvable.</div>'; return; }
    const blocked = (await must(M.sb.from("blocks").select("blocked").eq("blocked", other.id))).length > 0;
    view.innerHTML = `<div class="thead"><div class="id"><h1><a href="#/messages" class="muted" style="font-weight:400">Messages</a> / <span data-user="${T.esc(u)}">${T.esc(u)}</span></h1></div>
        <div class="row"><a class="btn" href="#/membre/${encodeURIComponent(u)}">Voir le profil</a>
          <button class="btn ${blocked ? "" : "danger"}" id="blk">${blocked ? "Débloquer" : "Bloquer"}</button></div></div>
      <div class="panel thread-panel"><div class="thread" id="thread"><div class="loading">Chargement…</div></div>
        <form id="compose" class="compose"><textarea name="b" rows="2" maxlength="2000" placeholder="${blocked ? "Débloque ce membre pour lui écrire" : "Écris un message… (Entrée pour envoyer, Maj + Entrée pour aller à la ligne)"}" ${blocked ? "disabled" : ""}></textarea>
          <button class="btn primary" ${blocked ? "disabled" : ""}>Envoyer</button></form>
        <div class="note" id="cmsg"></div></div>`;
    if (B()) B().decorate(view);
    let lastId = 0;
    async function load(scroll) {
      const rows = await must(M.sb.from("messages").select("*").or(`sender.eq.${other.id},recipient.eq.${other.id}`)
        .order("created_at", { ascending: false }).limit(200));
      rows.reverse();
      const newest = rows.length ? rows[rows.length - 1].id : 0;
      if (newest === lastId && !scroll) return;
      lastId = newest;
      const box = T.$("#thread");
      if (!box) return stopPoll();
      let day = "";
      box.innerHTML = rows.length ? rows.map((m) => {
        const mine = m.sender === T.member.id, d = m.created_at.slice(0, 10);
        const sep = d !== day ? `<div class="msg-day">${F.date(d)}</div>` : "";
        day = d;
        return `${sep}<div class="msg ${mine ? "me" : "them"}"><div class="bubble">${T.esc(m.body).replace(/\n/g, "<br>")}</div>
          <div class="msg-meta">${new Date(m.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}${mine && m.read_at ? " · lu" : ""}${!mine ? ` · <button class="linklike" data-report="${m.id}">signaler</button>` : ""}</div></div>`;
      }).join("") : '<div class="empty">Aucun message. Écris le premier.</div>';
      box.scrollTop = box.scrollHeight;
      T.$$("[data-report]", box).forEach((b) => b.addEventListener("click", async () => {
        const reason = window.prompt("Pourquoi signaler ce message ? (facultatif) Seul ce message sera transmis aux administrateurs.");
        if (reason === null) return;
        const r = await M.sb.rpc("report_message", { p_message: +b.dataset.report, p_reason: reason || null });
        T.$("#cmsg").className = r.error ? "note warn" : "note up";
        T.$("#cmsg").textContent = r.error ? r.error.message : "Message signalé aux administrateurs.";
      }));
      if (rows.some((m) => m.recipient === T.member.id && !m.read_at)) {
        await M.sb.rpc("mark_conversation_read", { p_username: u });
        if (B()) B().refresh();
      }
    }
    await load(true);
    stopPoll();
    poll = setInterval(() => { if (document.visibilityState === "visible") load(false).catch(() => {}); }, 8000);
    const form = T.$("#compose"), ta = form.querySelector("textarea");
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      if (!body) return;
      const r = await M.sb.rpc("send_message", { p_username: u, p_body: body });
      if (r.error) { T.$("#cmsg").className = "note warn"; T.$("#cmsg").textContent = r.error.message; return; }
      ta.value = ""; T.$("#cmsg").textContent = "";
      load(true);
    });
    T.$("#blk").onclick = async () => {
      if (!blocked && !confirm(`Bloquer ${u} ? Il ne pourra plus t'écrire (il n'en est pas averti).`)) return;
      const r = await M.sb.rpc("block_user", { p_username: u, p_block: !blocked });
      if (r.error) alert(r.error.message); else T.render();
    };
  });

  // ------------------------------------------------------------------ #/admin/membres
  T.route(/^\/admin\/membres$/, async (view) => {
    await M.ready;
    if (!gate(view)) return;
    if (!T.member.is_admin) { view.innerHTML = '<div class="empty">Réservé aux administrateurs.</div>'; return; }
    const [rows, reports] = await Promise.all([must(M.sb.rpc("admin_members")), must(M.sb.rpc("admin_reports"))]);
    await B().load();
    view.innerHTML = `<div class="thead"><div class="id"><h1>Membres</h1><div class="sub">${rows.length} membre(s) · vue administrateur (les e-mails ne sont visibles que d'ici)</div></div>
        <a class="btn" href="#/compte">Invitations et badges</a></div>
      <div class="panel"><div class="tbl-wrap"><table class="t"><thead><tr><th>Membre</th><th>E-mail</th><th>Inscrit le</th><th>Dernière connexion</th><th>Code utilisé</th><th class="n">Badges</th><th class="n">Prédictions</th><th class="n">Portefeuilles</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td data-user="${T.esc(r.username)}"><b>${T.esc(r.username)}</b>${r.is_admin ? ' <span class="badge">admin</span>' : ""}</td><td class="muted">${T.esc(r.email || "")}</td>
          <td>${F.date(r.created_at.slice(0, 10))}</td><td>${r.last_sign_in_at ? F.dateTime(r.last_sign_in_at) : "-"}</td><td class="num muted">${T.esc(r.invited_with || "")}</td>
          <td class="n">${r.badges}</td><td class="n">${r.predictions}</td><td class="n">${r.portfolios}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="panel" style="margin-top:14px"><h3>Messages signalés <span class="hint">seuls les messages signalés sont visibles ici</span></h3>
        ${reports.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Date</th><th>Signalé par</th><th>Auteur</th><th>Message</th><th>Motif</th></tr></thead><tbody>
          ${reports.map((r) => `<tr><td>${F.dateTime(r.created_at)}</td><td>${T.esc(r.reporter || "?")}</td><td>${T.esc(r.reported || "?")}</td><td class="wrap">${T.esc(r.body_copy)}</td><td class="wrap muted">${T.esc(r.reason || "")}</td></tr>`).join("")}</tbody></table></div>`
          : '<div class="empty">Aucun signalement.</div>'}</div>`;
    if (B()) B().decorate(view);
  });
})();
