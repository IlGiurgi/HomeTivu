/*
 * Limitatore globale delle aperture di stream. Il provider blocca l'IP quando vede troppe connessioni in poco
 * tempo (zapping, riavvii, ricarica manuale, telecomando): qui si conta ogni apertura e, superato il tetto
 * nella finestra, si dice quanto aspettare prima della prossima.
 */
(function (root) {
  'use strict';

  var MAX_OPENS = 6; // aperture ammesse...
  var WINDOW_MS = 30000; // ...in questa finestra

  var opens = []; // istanti delle aperture recenti

  var OpenLimit = {
    MAX_OPENS: MAX_OPENS,
    WINDOW_MS: WINDOW_MS,

    /** Millisecondi da aspettare prima di poter aprire un altro stream (0 = subito). */
    wait: function (now) {
      opens = opens.filter(function (t) { return now - t < WINDOW_MS; });
      return opens.length < MAX_OPENS ? 0 : opens[opens.length - MAX_OPENS] + WINDOW_MS - now;
    },

    /** Registra un'apertura appena fatta. */
    record: function (now) { opens.push(now); },

    reset: function () { opens = []; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = OpenLimit;
  else root.OpenLimit = OpenLimit;
})(this);
