/*
 * Sincronizzazione dei preferiti tra telefono e TV tramite Home Assistant.
 *
 * La lista condivisa sta nello stato di sensor.preferiti_hometivu (attributi `items` e `gone`).
 * Ogni dispositivo la legge, la unisce con la propria e, se serve, la riscrive: nessuna richiesta al provider IPTV.
 *
 * Unione: per ogni canale/film/serie vince la modifica più recente. Aggiungere porta `at` (ora dell'aggiunta),
 * togliere lascia una traccia in `gone` (ora della rimozione), così una rimozione non viene "resuscitata" dall'altro
 * dispositivo. Preferiti vecchi, senza ora, valgono 0: si aggiungono da entrambe le parti e perdono solo contro una rimozione.
 * Codice ES2015 senza async/await (Tizen 3.0).
 */
(function (root) {
  'use strict';

  var ENTITY = 'sensor.preferiti_hometivu';
  var GONE_TTL_MS = 90 * 86400000; // le rimozioni più vecchie si dimenticano
  var DEBOUNCE_MS = 3000;
  var POLL_MS = 5 * 60000;
  var QUICK_MS = 5000;
  var BACKOFF_MS = 60000;

  function keyOf(item) {
    return item.type + ':' + item.id;
  }

  /** Solo valori semplici e corti: ciò che arriva da Home Assistant non si fida mai. */
  function clean(item) {
    if (!item || typeof item !== 'object' || !item.type || item.id === undefined || item.id === null) return null;
    var out = {};
    Object.keys(item).forEach(function (k) {
      var v = item[k];
      if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'string') out[k] = v.slice(0, 500);
    });
    out.id = String(out.id);
    out.type = String(out.type);
    return out;
  }

  function cleanGone(gone) {
    var out = {};
    if (gone && typeof gone === 'object') {
      Object.keys(gone).forEach(function (k) { if (typeof gone[k] === 'number') out[k] = gone[k]; });
    }
    return out;
  }

  /**
   * Unisce due stati {items, gone}; l'ordine segue l'ora di aggiunta (i vecchi, senza ora, restano all'inizio
   * nell'ordine di arrivo: prima quelli locali).
   */
  function merge(local, remote, now) {
    var items = {};
    var order = [];
    var gone = {};
    [local, remote].forEach(function (side) {
      (side.items || []).forEach(function (raw) {
        var item = clean(raw);
        if (!item) return;
        var k = keyOf(item);
        if (!items[k]) { items[k] = item; order.push(k); }
        else if ((item.at || 0) > (items[k].at || 0)) items[k] = item;
      });
      var g = cleanGone(side.gone);
      Object.keys(g).forEach(function (k) { gone[k] = Math.max(gone[k] || 0, g[k]); });
    });
    var result = [];
    order.forEach(function (k) {
      if (gone[k] !== undefined && gone[k] > (items[k].at || 0)) return; // tolto dopo l'ultima aggiunta
      delete gone[k];
      result.push(items[k]);
    });
    Object.keys(gone).forEach(function (k) { if (now - gone[k] > GONE_TTL_MS) delete gone[k]; });
    // sort stabile a mano: Array.sort di Chromium 47 non lo garantisce
    var indexed = result.map(function (item, i) { return { item: item, i: i }; });
    indexed.sort(function (a, b) { return ((a.item.at || 0) - (b.item.at || 0)) || (a.i - b.i); });
    return { items: indexed.map(function (x) { return x.item; }), gone: gone };
  }

  function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  var busy = false;
  var again = false;
  var timer = null;
  var poller = null;
  var downUntil = 0;

  function enabled() {
    return !!(root.Home && root.Home.configured() && root.Storage);
  }

  function readRemote() {
    return root.Home.request('/api/states/' + ENTITY, undefined, QUICK_MS).then(function (s) {
      var attrs = (s && s.attributes) || {};
      return { items: Array.isArray(attrs.items) ? attrs.items : [], gone: attrs.gone || {} };
    }, function (err) {
      if (/404/.test(err.message)) return { items: [], gone: {} }; // ancora mai scritta
      throw err;
    });
  }

  var FavSync = {
    ENTITY: ENTITY,
    merge: merge,
    status: '',

    /** Una passata: legge da Home Assistant, unisce, aggiorna questo dispositivo e (se serve) la lista condivisa. */
    sync: function () {
      if (!enabled() || Date.now() < downUntil) return Promise.resolve(false);
      if (busy) { again = true; return Promise.resolve(false); }
      busy = true;
      return readRemote().then(function (remote) {
        var local = { items: root.Storage.getFavorites(), gone: root.Storage.getFavoritesGone() };
        var merged = merge(local, remote, Date.now());
        if (!same(merged.items, local.items) || !same(merged.gone, local.gone)) {
          root.Storage.replaceFavorites(merged.items, merged.gone);
        }
        if (same(merged.items, remote.items) && same(merged.gone, remote.gone)) return true;
        return root.Home.request('/api/states/' + ENTITY, {
          state: String(merged.items.length),
          attributes: { friendly_name: 'Preferiti HomeTivu', icon: 'mdi:star', items: merged.items, gone: merged.gone }
        }, QUICK_MS).then(function () { return true; });
      }).then(function (ok) {
        FavSync.status = 'ok ' + new Date().toISOString().slice(11, 19);
        return ok;
      }, function (err) {
        FavSync.status = 'errore: ' + err.message;
        // Solo la rete mette in pausa: Home Assistant spento o fuori casa non deve rallentare nulla.
        if (/non risponde|Impossibile contattare/.test(err.message)) downUntil = Date.now() + BACKOFF_MS;
        return false;
      }).then(function (ok) {
        busy = false;
        if (again) { again = false; FavSync.schedule(); }
        return ok;
      });
    },

    /** Dopo una modifica: attende qualche secondo (più tocchi = una sola scrittura) e sincronizza. */
    schedule: function () {
      if (timer) root.clearTimeout(timer);
      timer = root.setTimeout(function () { timer = null; FavSync.sync(); }, DEBOUNCE_MS);
    },

    /** Avvio: subito, a ogni modifica, ogni 5 minuti e quando l'app torna in primo piano. */
    start: function () {
      if (poller) return;
      root.Storage.onFavoritesChange = function () { FavSync.schedule(); };
      FavSync.sync();
      poller = root.setInterval(function () { FavSync.sync(); }, POLL_MS);
      if (root.document) {
        root.document.addEventListener('visibilitychange', function () { if (!root.document.hidden) FavSync.sync(); });
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = FavSync;
  else root.FavSync = FavSync;
})(this);
