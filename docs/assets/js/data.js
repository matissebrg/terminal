/* Mangrove — reads the pipeline's public data (data/*.json, written by GitHub Actions).
   Online, the files sit next to the page. Opened from disk (the private copy, file://), the browser
   cannot read local JSON, so the same public files are read from the live site (config.js, publicSite).
   Only GET requests for public market data: nothing from the private copy is ever sent. */
(function () {
  'use strict';
  var cfg = window.MANGROVE || {};
  var offline = location.protocol === 'file:';
  var base = offline ? String(cfg.publicSite || '').replace(/\/?$/, '/') + 'data/' : 'data/';
  var cache = {};

  function json(path) {
    if (!cache[path]) {
      cache[path] = (typeof fetch === 'function' ? fetch(base + path, { cache: 'no-cache' }) : Promise.reject(new Error('fetch')))
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return cache[path];
  }

  window.MGD = {
    offline: offline,
    base: base,
    json: json,
    /* data every section needs: the tracked universe, the feed, the scored predictions */
    core: function () {
      return Promise.all([json('universe.json'), json('feed.json'), json('predictions.json')]).then(function (r) {
        return { universe: r[0], feed: r[1], predictions: r[2], ok: !!(r[0] || r[1] || r[2]) };
      });
    },
    company: function (t) { return json(t + '/company.json'); },
    prices: function (t) { return json(t + '/prices.json'); },
    predict: function (t) { return json(t + '/predict.json'); },
    peers: function (t) { return json(t + '/peers.json'); },
    /* every price series the pipeline fetched, tracked or not (peers and ETFs included) */
    rawPrices: function (sym) { return json('_prices/' + sym + '.json'); }
  };
})();
