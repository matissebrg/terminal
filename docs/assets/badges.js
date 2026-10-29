/* Badges et notifications : cloche, animation de déblocage, vitrine dans Mon compte, admin.
 * Les badges sont attribués par la base (fonctions et déclencheurs), jamais par cette page. */
(function () {
  "use strict";
  const T = window.T, F = T.fmt, M = T.members;
  const B = (T.badges = { catalog: null, byUser: null });
  if (!M || !M.configured) return;

  // ------------------------------------------------------------------ icons (achievements)
  const ICONS = {
    target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    quill: '<path d="M20 4c-6 0-11 4-13 11l-2 5 5-2c7-2 10-8 10-14z"/><path d="M7 17l6-6"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
    bolt: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
    bullseye: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><path d="M15 9l6-6M18 3h3v3"/>',
    crowd: '<circle cx="8" cy="9" r="2.6"/><circle cx="16" cy="9" r="2.6"/><path d="M3.5 19a4.5 4.5 0 0 1 9 0M11.5 19a4.5 4.5 0 0 1 9 0"/><path d="M12 2.5l1 2 2.2.3-1.6 1.5.4 2.2L12 7.4l-2 1.1.4-2.2-1.6-1.5 2.2-.3z" fill="currentColor" stroke="none"/>',
    bank: '<path d="M3 9l9-5 9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4M8.5 14.5l2 2 4-4"/>',
    scale: '<path d="M12 4v16M6 20h12M5 8h14M5 8l-2.5 6a2.5 2.5 0 0 0 5 0zM19 8l-2.5 6a2.5 2.5 0 0 0 5 0z"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    chart: '<path d="M4 19h16"/><path d="M5 16l4.5-5 3.5 3 6-7"/><path d="M15 7h4v4"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5" opacity=".5"/>',
    pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z"/><path d="M5 21h14"/>',
    swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    road: '<path d="M8 3L4 21M16 3l4 18M12 4v3M12 10.5v3M12 17v3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    alpha: '<path d="M18 7c-1 6-2.5 10-6.5 10A4.5 4.5 0 0 1 7 12.5C7 9 9.5 7 12 7c3 0 4 3.5 6 10"/>',
    scalpel: '<path d="M3 21l9-9"/><path d="M12 12l6.5-6.5a2.1 2.1 0 0 1 3 3L15 15z"/>',
    flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.6 1.2 2.5 2 2.5 0-3-1-5 1-8z"/>',
    rocket: '<path d="M14 4c3-1 6-1 6-1s0 3-1 6l-6 6-4-4z"/><path d="M9 11l-4 1-2 3 4 1M13 15l-1 4-3 2-1-4"/><circle cx="15.5" cy="8.5" r="1.3"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9.5 17h5"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/>',
    telescope: '<path d="M3 14l11-6 2 4-11 6z"/><path d="M14 8l4-2 2 4-4 2"/><path d="M9 16l-2 5M11 15l3 6"/>',
    sigma: '<path d="M18 5H6l6 7-6 7h12"/>',
    chip: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
    cart: '<path d="M3 4h2l2.4 11h10.6l2-8H6.2"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>',
    health: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
    coin: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
    drop: '<path d="M12 3c3 4.5 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-6.5 6-11z"/><path d="M10 15.5a2.5 2.5 0 0 0 2.5 2.5"/>',
    factory: '<path d="M3 21V10l5 3V10l5 3V10l5 3V5h3v16z"/><path d="M7 17h2M12 17h2M17 17h1"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  };
  const svg = (name, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.target}</svg>`;

  // silver hexagonal medal (same visual language as the status badges)
  // frame colour by difficulty: 1 bronze, 2 argent, 3 or, 4 platine
  const LEVELS = { 1: ["Bronze", ["#f3c39a", "#a8673a", "#e8b088", "#6e3f22"]], 2: ["Argent", ["#f4f6fa", "#9aa3b2", "#e3e7ee", "#6d7584"]],
    3: ["Or", ["#fff1b8", "#c9971f", "#ffe08a", "#7a5a10"]], 4: ["Platine", ["#e9fbff", "#7fc8de", "#ffffff", "#4f8fa6"]] };
  B.LEVELS = LEVELS;
  B.medal = (b, size = 46, locked = false) => { const lv = LEVELS[b.level] ? b.level : 2, c = LEVELS[lv][1];
    return `<span class="medal lv${lv} ${locked ? "locked" : ""}" style="width:${size}px;height:${size}px" title="${T.esc(b.name || "")}${b.level ? " · " + LEVELS[lv][0] : ""}">
      <svg viewBox="0 0 48 48" width="${size}" height="${size}" class="medal-frame"><defs><linearGradient id="mg${lv}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${c[0]}"/><stop offset=".45" stop-color="${c[1]}"/><stop offset=".7" stop-color="${c[2]}"/><stop offset="1" stop-color="${c[3]}"/></linearGradient></defs>
        <path d="M24 2.5l18.6 10.75v21.5L24 45.5 5.4 34.75v-21.5z" fill="#07090d" stroke="url(#mg${lv})" stroke-width="${lv >= 3 ? 2 : 1.6}"/>
        <path d="M24 6.5l15.2 8.8v17.4L24 41.5 8.8 32.7V15.3z" fill="none" stroke="rgba(255,255,255,.08)"/></svg>
      <span class="medal-icon">${b.icon === "archer" ? `<img src="assets/brand/archer-mark.png" alt="" style="width:${Math.round(size * 0.5)}px;height:auto">` : svg(b.icon, Math.round(size * 0.44))}</span></span>`; };

  B.tierImg = (b, h = 22) => `<img class="tier-img" src="assets/badges/${b.image}" alt="${T.esc(b.name)}" title="${T.esc(b.name)} : ${T.esc(b.description)}" style="height:${h}px">`;

  // compact status label for lists (the full image is unreadable at text size)
  B.tierPill = (b) => `<span class="tier-pill r${b.rank}" title="${T.esc(b.name)} : ${T.esc(b.description)}">${T.esc(b.name.toUpperCase())}<i>${"▰".repeat(b.rank)}</i></span>`;

  B.load = async (force) => {
    if (B.catalog && !force) return B.catalog;
    const { data, error } = await M.sb.from("badges").select("*").order("sort");
    if (error) { B.catalog = []; return B.catalog; }
    B.catalog = data;
    B.byId = Object.fromEntries(data.map((b) => [b.id, b]));
    return data;
  };

  // username -> [badge ids] for every member (the ranking and portfolio pages)
  B.loadAll = async () => {
    await B.load();
    const [ub, pr] = await Promise.all([M.sb.from("user_badges").select("user_id, badge_id, awarded_at"),
      M.sb.from("profiles").select("id, username, title_badge")]);
    const name = Object.fromEntries((pr.data || []).map((p) => [p.id, p.username]));
    B.titleOf = Object.fromEntries((pr.data || []).map((p) => [p.username, p.title_badge]));
    B.memberCount = (pr.data || []).length;
    B.holders = {};
    (ub.data || []).forEach((r) => { B.holders[r.badge_id] = (B.holders[r.badge_id] || 0) + 1; });
    B.byUser = {};
    (ub.data || []).forEach((r) => { const u = name[r.user_id]; if (u) (B.byUser[u] = B.byUser[u] || []).push(r.badge_id); });
    return B.byUser;
  };

  // compact display next to a username: highest status image + achievement medals
  B.inline = (ids, max = 4) => {
    if (!ids || !B.byId) return "";
    const bs = ids.map((i) => B.byId[i]).filter(Boolean);
    const tier = bs.filter((b) => b.kind === "tier").sort((a, b) => b.rank - a.rank)[0];
    const ach = bs.filter((b) => b.kind === "achievement").sort((a, b) => a.sort - b.sort);
    return `<span class="badge-inline">${tier ? B.tierPill(tier) : ""}${ach.slice(0, max).map((b) => B.medal(b, 20)).join("")}${ach.length > max ? `<span class="muted num" style="font-size:11px">+${ach.length - max}</span>` : ""}</span>`;
  };

  // decorate every [data-user] element of a freshly rendered page
  B.decorate = async (root) => {
    const els = T.$$("[data-user]", root);
    if (!els.length) return;
    try { await B.loadAll(); } catch (e) { return; }
    els.forEach((el) => {
      if (el.querySelector(".badge-inline") || !el.dataset.user) return;
      const u = el.dataset.user, t = B.titleOf && B.titleOf[u] && B.byId[B.titleOf[u]];
      el.insertAdjacentHTML("beforeend", (t && t.title ? ` <span class="utitle">${T.esc(t.title)}</span>` : "") + " " + B.inline(B.byUser[u]));
      if (!el.closest("a")) { el.classList.add("ulink"); el.addEventListener("click", (e) => { e.stopPropagation(); T.go(`#/membre/${encodeURIComponent(u)}`); }); }
    });
  };

  // ------------------------------------------------------------------ Mon compte : vitrine + admin
  // badge showcase (Mon compte, and read-only on a member's profile)
  B.showcase = (have, opts = {}) => {
    const tiers = B.catalog.filter((b) => b.kind === "tier");
    const ach = B.catalog.filter((b) => b.kind === "achievement");
    const rare = (b) => (B.memberCount ? `<span class="rarity">${Math.round(100 * (B.holders[b.id] || 0) / B.memberCount)} % des membres</span>` : "");
    const got = ach.filter((b) => have[b.id]).length;
    const shownTiers = opts.ownedOnly ? tiers.filter((b) => have[b.id]) : tiers;
    return `<div class="group-title" style="margin-top:0">Statut</div>
      <div class="tier-grid">${shownTiers.map((b) => `<div class="tier-card ${have[b.id] ? "" : "locked"}">${B.tierImg(b, 54)}
          <div class="tier-meta"><b>${T.esc(b.name)}</b> <span class="bars">${"▰".repeat(b.rank)}</span><div class="muted">${T.esc(b.description)}</div>
          <div class="note" style="margin-top:4px">${have[b.id] ? `Obtenu le ${F.date(have[b.id].awarded_at.slice(0, 10))}${have[b.id].note ? " · " + T.esc(have[b.id].note) : ""}` : b.auto ? "À débloquer" : "Attribué par un administrateur"}${b.title ? ` · titre « ${T.esc(b.title)} »` : ""}</div></div></div>`).join("") || '<div class="muted">Aucun statut.</div>'}</div>
      <div class="group-title">Succès <span class="muted" style="text-transform:none;letter-spacing:0">${got} / ${ach.length}</span></div>
      ${[1, 2, 3, 4].map((lv) => { const list = ach.filter((b) => (b.level || 1) === lv && (!opts.ownedOnly || have[b.id]));
        if (!list.length) return "";
        return `<div class="lv-title lv${lv}">${B.LEVELS[lv][0]} <span class="muted">${list.filter((b) => have[b.id]).length} / ${list.length}</span></div>
        <div class="ach-grid">${list.map((b) => `<div class="ach ${have[b.id] ? "" : "locked"}">${B.medal(b, 46, !have[b.id])}
          <div><b>${T.esc(b.name)}</b><div class="muted">${T.esc(b.description)}</div>
          <div class="note" style="margin-top:2px">${have[b.id] ? `Obtenu le ${F.date(have[b.id].awarded_at.slice(0, 10))} · ` : ""}${rare(b)}${b.title ? ` · titre « ${T.esc(b.title)} »` : ""}</div></div></div>`).join("")}</div>`; }).join("")}`;
  };

  B.renderAccount = async (box, adminBox) => {
    await B.load(true);
    await B.loadAll();
    const { data: mine } = await M.sb.from("user_badges").select("*").eq("user_id", T.member.id);
    const have = Object.fromEntries((mine || []).map((r) => [r.badge_id, r]));
    const titles = B.catalog.filter((b) => b.title && have[b.id]);
    box.innerHTML = `<h3>Mes badges <span class="hint">${Object.keys(have).length} obtenu(s)</span></h3>
      <form id="tform" class="row" style="margin-bottom:14px"><label class="inline">Titre affiché à côté de mon pseudo
        <select name="t" class="sel"><option value="">Aucun</option>${titles.map((b) => `<option value="${b.id}" ${T.member.title_badge === b.id ? "selected" : ""}>${T.esc(b.title)}</option>`).join("")}</select></label>
        <span class="note" id="tmsg" style="margin:0">${titles.length ? "" : "Débloque un succès d'argent ou plus pour obtenir un titre."}</span></form>
      ${B.showcase(have)}`;
    T.$("#tform select").addEventListener("change", async (e) => {
      const r = await M.sb.from("profiles").update({ title_badge: e.target.value || null }).eq("id", T.member.id);
      T.$("#tmsg").className = r.error ? "note warn" : "note up";
      T.$("#tmsg").textContent = r.error ? r.error.message : "Titre mis à jour ✓";
      if (!r.error) T.member.title_badge = e.target.value || null;
    });
    if (!adminBox) return;
    const { data: profs } = await M.sb.from("profiles").select("username").order("username");
    adminBox.innerHTML = `<h3>Attribuer un badge <span class="hint">administrateur</span></h3>
      <form id="bform" class="row">
        <select name="user" class="sel">${(profs || []).map((p) => `<option>${T.esc(p.username)}</option>`).join("")}</select>
        <select name="badge" class="sel">${B.catalog.map((b) => `<option value="${b.id}">${T.esc(b.name)}${b.auto ? "" : " (manuel)"}</option>`).join("")}</select>
        <input name="note" class="sel" placeholder="Note (facultatif, visible par le membre)" maxlength="300" style="min-width:220px">
        <button class="btn primary" name="act" value="award">Attribuer</button><button class="btn" name="act" value="revoke">Retirer</button></form>
      <div class="note" id="bmsg">Supporter et VIP s'attribuent ici. Les autres badges sont automatiques, mais tu peux aussi les attribuer ou les retirer.</div>`;
    let act = "award";
    T.$$("#bform button").forEach((b) => b.addEventListener("click", () => { act = b.value; }));
    T.$("#bform").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target), msg = T.$("#bmsg");
      const r = act === "award"
        ? await M.sb.rpc("award_badge", { p_username: fd.get("user"), p_badge: fd.get("badge"), p_note: fd.get("note") || null })
        : await M.sb.rpc("revoke_badge", { p_username: fd.get("user"), p_badge: fd.get("badge") });
      msg.className = r.error ? "note warn" : "note up";
      msg.textContent = r.error ? r.error.message : act === "award" ? `Badge attribué à ${fd.get("user")} : il recevra une notification.` : "Badge retiré.";
      if (!r.error) { B.renderAccount(box, null); B.refresh(); }
    });
  };

  // ------------------------------------------------------------------ notifications : cloche + toasts
  let notes = [], open = false, timer = null;
  const SHOWN = "archer-toasted";
  const shown = () => { try { return new Set(JSON.parse(localStorage.getItem(SHOWN) || "[]")); } catch (e) { return new Set(); } };
  const remember = (id) => { try { const s = shown(); s.add(id); localStorage.setItem(SHOWN, JSON.stringify([...s].slice(-200))); } catch (e) { /* noop */ } };

  function drawBell() {
    const box = T.$("#notifBtn");
    if (!box) return;
    if (!T.member) { box.innerHTML = ""; return; }
    const unread = notes.filter((n) => !n.read_at).length;
    box.innerHTML = `<button class="icon-btn bell" id="bellBtn" aria-label="Notifications">${svg("bell", 18)}${unread ? `<span class="bell-dot">${unread > 9 ? "9+" : unread}</span>` : ""}</button>
      <div class="notif-panel ${open ? "open" : ""}" id="notifPanel">
        <div class="notif-h"><b>Notifications</b>${unread ? '<button class="btn" id="notifAll">Tout marquer comme lu</button>' : ""}</div>
        <div class="notif-list">${notes.length ? notes.map((n) => `<a class="notif ${n.read_at ? "" : "unread"}" href="${T.esc(n.link || "#/compte")}" data-id="${n.id}">
            <span class="notif-ic">${n.kind === "badge" && n.data && n.data.image ? `<img src="assets/badges/${T.esc(n.data.image)}" alt="">` : n.kind === "badge" && n.data ? B.medal({ name: "", icon: n.data.icon, level: (B.byId && B.byId[n.data.badge_id] || {}).level }, 30) : svg(n.kind === "message" ? "chat" : n.kind === "report" ? "flag" : "bell", 20)}</span>
            <span><b>${T.esc(n.title)}</b><span class="muted">${T.esc(n.body || "")}</span><span class="notif-t">${F.dateTime(n.created_at)}</span></span></a>`).join("")
          : '<div class="empty" style="margin:10px">Aucune notification pour l\'instant.</div>'}</div></div>`;
    T.$("#bellBtn").onclick = (e) => { e.stopPropagation(); open = !open; T.$("#notifPanel").classList.toggle("open", open); if (open) markRead(null); };
    const all = T.$("#notifAll");
    if (all) all.onclick = (e) => { e.stopPropagation(); markRead(null); };
    T.$$(".notif").forEach((a) => a.addEventListener("click", () => { open = false; markRead([+a.dataset.id]); }));
  }
  document.addEventListener("click", (e) => { if (open && !e.target.closest("#notifBtn")) { open = false; const p = T.$("#notifPanel"); if (p) p.classList.remove("open"); } });

  async function markRead(ids) {
    const unread = notes.filter((n) => !n.read_at && (!ids || ids.includes(n.id)));
    if (!unread.length) return;
    await M.sb.rpc("mark_notifications_read", { p_ids: ids });
    const now = new Date().toISOString();
    notes = notes.map((n) => (!ids || ids.includes(n.id) ? { ...n, read_at: n.read_at || now } : n));
    unread.forEach((n) => remember(n.id));
    drawBell();
  }

  // celebratory toast, one at a time
  const queue = [];
  let showing = false;
  function toast(n) {
    queue.push(n);
    if (!showing) next();
  }
  function next() {
    const n = queue.shift();
    if (!n) { showing = false; return; }
    showing = true;
    remember(n.id);
    const d = n.data || {};
    const b = (B.byId && B.byId[d.badge_id]) || { name: n.title.replace("Nouveau badge : ", ""), icon: d.icon, image: d.image };
    const el = document.createElement("div");
    el.className = "badge-toast";
    el.innerHTML = `<div class="bt-glow"></div><div class="bt-art">${d.image ? `<img src="assets/badges/${T.esc(d.image)}" alt="">` : B.medal(b, 64)}</div>
      <div class="bt-body"><div class="bt-k">Badge débloqué</div><div class="bt-n">${T.esc(b.name)}</div><div class="muted">${T.esc(n.body || "")}</div>
        ${d.note ? `<div class="note" style="margin-top:4px">« ${T.esc(d.note)} »</div>` : ""}
        <div class="row" style="margin-top:10px"><a class="btn primary" href="#/compte">Voir mes badges</a><button class="btn bt-close">Fermer</button></div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("in"));
    const close = () => { el.classList.remove("in"); el.classList.add("out"); markRead([n.id]); setTimeout(() => { el.remove(); next(); }, 380); };
    el.querySelector(".bt-close").onclick = close;
    el.querySelector(".btn.primary").onclick = close;
    setTimeout(() => { if (el.isConnected) close(); }, 12000);
  }

  B.refresh = async () => {
    if (!T.member) { notes = []; drawBell(); return; }
    const { data, error } = await M.sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(30);
    if (error) return;
    notes = data;
    drawBell();
    const msgs = notes.filter((n) => n.kind === "message" && !n.read_at).length;
    const nav = T.$('.nav a[data-nav="messages"]');
    if (nav) nav.dataset.unread = msgs ? String(msgs) : "";
    await B.load();
    const s = shown();
    notes.filter((n) => n.kind === "badge" && !n.read_at && !s.has(n.id)).reverse().forEach(toast);
  };

  async function start() {
    await M.ready;
    B.refresh();
    clearInterval(timer);
    timer = setInterval(() => { if (document.visibilityState === "visible") B.refresh(); }, 60000);
  }
  (M.onProfile = M.onProfile || []).push(() => B.refresh());
  start();
})();
