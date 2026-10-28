/* Boot: sidebar watchlist, status, command palette entries, router start. */
(function () {
  "use strict";
  const T = window.T, F = T.fmt;

  // GitHub repo the site is served from (owner.github.io/repo) - used for "edit on GitHub" links.
  const repo = (() => {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/);
    const seg = location.pathname.split("/").filter(Boolean)[0];
    return m && seg ? `${m[1]}/${seg}` : "matissebrg/terminal";
  })();
  T.repoUrl = (path) => `https://github.com/${repo}/${path}`;

  async function boot() {
    let u;
    try { u = await T.get("universe.json"); }
    catch (e) {
      T.$("#view").innerHTML = `<div class="panel"><h3>Pas encore de données</h3><p class="sec">Le fichier <code>data/universe.json</code> est introuvable.
        Lance le workflow « update-data » dans l'onglet Actions du repo GitHub.</p></div>`;
      return;
    }
    const gen = new Date(u.meta.generated_at);
    const ageH = (Date.now() - gen.getTime()) / 36e5;
    T.$("#updatedAt").textContent = `Données : ${F.dateTime(u.meta.generated_at)}${u.meta.mode === "fixture" ? " · démo" : ""}`;
    if (ageH > 72 || u.meta.mode === "fixture") T.$("#statusDot .pulse").classList.add("stale");

    T.$("#wlCount").textContent = u.tickers.length;
    T.$("#watchlist").innerHTML = u.tickers.map((t) => `<a class="wl-item" data-tk="${t.ticker}" href="#/t/${t.ticker}">
        <span class="tk">${t.ticker}</span><span class="px">${F.n(t.price)}</span>
        <span class="nm">${T.esc(t.name)}</span><span class="ch ${T.cls(t.chg_1d)}">${F.pct(t.chg_1d, 2, true)}</span>
        ${T.spark(t.spark)}</a>`).join("");
    T.$("#benchlist").innerHTML = Object.entries(u.benchmarks || {}).map(([k, b]) => `<div class="wl-item" style="cursor:default">
        <span class="tk">${k}</span><span class="px">${F.n(b.last)}</span>
        <span class="nm">${T.esc(b.name)}</span><span class="ch ${T.cls(b.chg_1d)}">${F.pct(b.chg_1d, 2, true)}</span>${T.spark(b.spark)}</div>`).join("");

    const tabs = [["synthese", "Synthèse", ""], ["financiers", "États financiers", "bilan compte de résultat"], ["ratios", "Ratios", ""],
      ["valorisation", "Valorisation", "DCF comparables"], ["predictions", "Prédictions", "forecasting prévision"],
      ["options", "Options", "dérivés volatilité"], ["secteur", "Secteur", "pairs"], ["performance", "Performance", "cours"],
      ["depots", "Dépôts SEC", "filings"]];
    T.commands = () => [
      ...u.tickers.map((t) => ({ label: `${t.ticker} ${t.name}`, html: `<b>${t.ticker}</b> ${T.esc(t.name)}`, kind: "valeur", href: `#/t/${t.ticker}`, icon: "◆" })),
      ...u.tickers.flatMap((t) => tabs.map(([k, l, kw]) => ({ label: `${t.ticker} ${l}`, keywords: kw, html: `<b>${t.ticker}</b> · ${l}`, kind: "onglet", href: `#/t/${t.ticker}/${k}`, icon: "›" }))),
      { label: "Tableau de bord accueil home", kind: "page", href: "#/", icon: "⌂" },
      { label: "Feed événements actualités", kind: "page", href: "#/feed", icon: "◉" },
      { label: "Prédictions registre score entraînement forecasting", kind: "page", href: "#/predictions", icon: "◎" },
      { label: "Méthodologie sources documentation", kind: "page", href: "#/methodo", icon: "?" },
    ];
    window.addEventListener("hashchange", T.render);
    T.render();
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
