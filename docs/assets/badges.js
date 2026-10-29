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
  };
  const svg = (name, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.target}</svg>`;

  // silver hexagonal medal (same visual language as the status badges)
  B.medal = (b, size = 46, locked = false) => `<span class="medal ${locked ? "locked" : ""}" style="width:${size}px;height:${size}px" title="${T.esc(b.name)}">
      <svg viewBox="0 0 48 48" width="${size}" height="${size}" class="medal-frame"><defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f4f6fa"/><stop offset=".45" stop-color="#9aa3b2"/><stop offset=".7" stop-color="#e3e7ee"/><stop offset="1" stop-color="#6d7584"/></linearGradient></defs>
        <path d="M24 2.5l18.6 10.75v21.5L24 45.5 5.4 34.75v-21.5z" fill="#07090d" stroke="url(#mg)" stroke-width="1.6"/>
        <path d="M24 6.5l15.2 8.8v17.4L24 41.5 8.8 32.7V15.3z" fill="none" stroke="rgba(255,255,255,.08)"/></svg>
      <span class="medal-icon">${svg(b.icon, Math.round(size * 0.44))}</span></span>`;

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
      M.sb.from("profiles").select("id, username")]);
    const name = Object.fromEntries((pr.data || []).map((p) => [p.id, p.username]));
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
    els.forEach((el) => { if (!el.querySelector(".badge-inline")) el.insertAdjacentHTML("beforeend", " " + B.inline(B.byUser[el.dataset.user])); });
  };

  // ------------------------------------------------------------------ Mon compte : vitrine + admin
  B.renderAccount = async (box, adminBox) => {
    await B.load(true);
    const { data: mine } = await M.sb.from("user_badges").select("*").eq("user_id", T.member.id);
    const have = Object.fromEntries((mine || []).map((r) => [r.badge_id, r]));
    const tiers = B.catalog.filter((b) => b.kind === "tier");
    const ach = B.catalog.filter((b) => b.kind === "achievement");
    const got = ach.filter((b) => have[b.id]).length;
    box.innerHTML = `<h3>Mes badges <span class="hint">${Object.keys(have).length} obtenu(s)</span></h3>
      <div class="group-title" style="margin-top:0">Statut</div>
      <div class="tier-grid">${tiers.map((b) => `<div class="tier-card ${have[b.id] ? "" : "locked"}">${B.tierImg(b, 54)}
          <div class="tier-meta"><b>${T.esc(b.name)}</b> <span class="bars">${"▰".repeat(b.rank)}</span><div class="muted">${T.esc(b.description)}</div>
          <div class="note" style="margin-top:4px">${have[b.id] ? `Obtenu le ${F.date(have[b.id].awarded_at.slice(0, 10))}${have[b.id].note ? " · " + T.esc(have[b.id].note) : ""}` : b.auto ? "À débloquer" : "Attribué par un administrateur"}</div></div></div>`).join("")}</div>
      <div class="group-title">Succès <span class="muted" style="text-transform:none;letter-spacing:0">${got} / ${ach.length}</span></div>
      <div class="ach-grid">${ach.map((b) => `<div class="ach ${have[b.id] ? "" : "locked"}">${B.medal(b, 46, !have[b.id])}
          <div><b>${T.esc(b.name)}</b><div class="muted">${T.esc(b.description)}</div>
          ${have[b.id] ? `<div class="note" style="margin-top:2px">Obtenu le ${F.date(have[b.id].awarded_at.slice(0, 10))}</div>` : ""}</div></div>`).join("")}</div>`;
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
            <span class="notif-ic">${n.kind === "badge" && n.data && n.data.image ? `<img src="assets/badges/${T.esc(n.data.image)}" alt="">` : n.kind === "badge" && n.data ? B.medal({ name: "", icon: n.data.icon }, 30) : svg("bell", 18)}</span>
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
