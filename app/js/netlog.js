/*
 * Registro delle richieste verso il provider (API, guida, aperture di stream) e dei riavvii del video.
 * Serve a capire dopo un blocco cosa è partito, a che ritmo e quale richiesta ha ricevuto 403/429.
 * Resta in memoria e in localStorage (ultime 200 righe) e viene mandato a Home Assistant (watching.js).
 * Mai username, password o URL completi: solo il tipo di richiesta e gli id numerici.
 */
(function (root) {
  'use strict';

  var MAX = 200;
  var KEY = 'hometivu_netlog';
  var entries = [];
  var saveTimer = null;
  var pushTimer = null;

  try {
    var saved = JSON.parse(root.localStorage.getItem(KEY) || '[]');
    if (Array.isArray(saved)) entries = saved.slice(-MAX);
  } catch (e) { /* registro assente o rovinato: si riparte vuoto */ }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function clock(at) {
    var d = new Date(at);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function persist() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try { root.localStorage.setItem(KEY, JSON.stringify(entries)); } catch (e) { /* spazio finito o storage bloccato */ }
    }, 2000);
  }

  var Netlog = {
    /** Descrizione senza dati sensibili di un URL player_api: azione e id numerici. */
    describeApi: function (url) {
      var out = [];
      String(url).split('?')[1] && String(url).split('?')[1].split('&').forEach(function (pair) {
        var kv = pair.split('=');
        if (kv[0] === 'action' || (/_id$/.test(kv[0]) && /^\d+$/.test(kv[1] || ''))) out.push(kv[1] === undefined ? kv[0] : (kv[0] === 'action' ? kv[1] : kv[0] + '=' + kv[1]));
      });
      return out.join(' ') || 'player_api';
    },

    /** Id numerico di uno stream (ultimo pezzo del percorso, senza estensione): l'URL contiene le credenziali. */
    describeStream: function (url) {
      var last = String(url).split('?')[0].split('/').pop() || '';
      return 'stream ' + last.replace(/\.[a-z0-9]+$/i, '');
    },

    add: function (text, at) {
      entries.push({ at: at || Date.now(), text: String(text).slice(0, 120) });
      if (entries.length > MAX) entries.shift();
      persist();
      // Un rifiuto del provider va subito a Home Assistant (una volta ogni 20 s al massimo): è il momento che interessa.
      if (!pushTimer && /\b(403|429)\b|sospesa/.test(text) && root.Watching && root.Watching.touch) {
        pushTimer = setTimeout(function () {
          pushTimer = null;
          try { root.Watching.touch(); } catch (e) { /* diagnosi: non deve mai rompere l'app */ }
        }, 3000);
        setTimeout(function () { pushTimer = null; }, 20000);
      }
    },

    /** Ultime `count` righe, dalla più vecchia alla più recente: "HH:MM:SS testo". */
    lines: function (count) {
      return entries.slice(-(count || MAX)).map(function (e) { return clock(e.at) + ' ' + e.text; });
    },

    entries: function (count) { return entries.slice(-(count || MAX)); },

    clear: function () { entries = []; persist(); }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Netlog;
  else root.Netlog = Netlog;
})(this);
