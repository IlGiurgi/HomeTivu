/*
 * Motore di riproduzione.
 * Sulla TV usa Samsung AVPlay (supporta MPEG-TS, HLS, MKV, ecc.).
 * Nel browser usa <video> HTML5; per MPEG-TS e HLS, che i browser non leggono da soli,
 * carica da CDN mpegts.js o hls.js solo al primo utilizzo (sulla TV non vengono mai scaricati).
 *
 * Eventi (Player.onEvent(type, data)): 'buffering', 'playing', 'paused', 'ended', 'error',
 * 'retrying' ({attempt, max, label, switched}).
 *
 * Recupero automatico: uno stream che dà errore, resta in caricamento o ha l'immagine ferma viene riaperto
 * con pause crescenti; dal secondo tentativo si passa ai feed alternativi (setAlternates), se ce ne sono.
 * 'error' arriva solo quando tutti i tentativi sono falliti.
 */
(function (root) {
  'use strict';

  var avplay = Platform.isTV ? root.webapis.avplay : null;

  // Togliamo la superficie non usata: sulla TV il <video> nero a tutto schermo coprirebbe il piano di AVPlay.
  var unused = root.document.getElementById(avplay ? 'html5-player' : 'av-player');
  if (unused) unused.parentNode.removeChild(unused);

  var LIBRARIES = {
    hls: { url: 'https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js', global: 'Hls' },
    mpegts: { url: 'https://cdn.jsdelivr.net/npm/mpegts.js@1.8.2/dist/mpegts.js', global: 'mpegts' }
  };
  var libraryPromises = {};
  var windowRect = null; // [x, y, larghezza, altezza] nel layout 1920x1080; null = schermo intero
  var engine = null; // istanza hls.js / mpegts.js attiva nel browser
  var WEB_ERROR = 'Impossibile riprodurre nel browser: il server potrebbe bloccare le richieste dal web ' +
    'o lo stream non è compatibile. Sulla TV dovrebbe funzionare.';

  var CODEC_ERROR = 'Questo canale ha un audio (E-AC3 / Dolby Digital Plus) che questo browser non riproduce. ' +
    'Prova un altro canale, un altro browser (Edge con l\'estensione Dolby) oppure usa la TV o il telefono.';

  var OPEN_MS = 12000; // apertura dello stream
  var BUFFERING_MS = 8000; // caricamento a metà visione che non finisce (dirette)
  var STALL_MS = 5000; // immagine ferma: il tempo non avanza e il player non dice nulla (dirette)
  // Film e serie pesano di più: aprirli e riempire il buffer richiede molto più che per un canale, e riaprire
  // lo stream azzera il buffer e peggiora l'attesa. Si riavvia solo dopo tempi molto lunghi, avvisando a schermo.
  var VOD_OPEN_MS = 120000;
  var VOD_BUFFERING_MS = 180000;
  var VOD_STALL_MS = 60000;
  var VOD_SLOW_MS = 10000; // dopo tanto di attesa compare l'avviso "sta caricando"
  var STABLE_MS = 30000; // dopo tanto di visione regolare i tentativi ripartono da zero
  var JANK_GAP_MS = 2500; // buco tra due controlli: il browser era occupato (liste enormi, immagini), non lo stream
  var SLEEP_GAP_MS = 20000; // buco molto più lungo: la TV era in standby
  var SHORT_HIDE_MS = 20000; // app nascosta meno di così (barra volume, notifiche): lo stream si riprende com'è
  // Prima pausa di 2 s: riaprire subito lo stesso canale lascia la connessione di prima ancora aperta per il provider,
  // che con un limite di 1-2 connessioni risponde 403.
  var RETRY_DELAYS = [2000, 2500, 4000, 8000, 15000, 15000];
  var LIMIT_PAUSE_MS = 6000; // dopo un 403/429 si lascia al provider il tempo di chiudere la connessione precedente
  var USER_AGENTS = { vlc: 'VLC/3.0.20 LibVLC/3.0.20', smarters: 'IPTVSmartersPro' };
  var userAgent = ''; // '' = quello del sistema
  var lastStatus = 0; // ultimo codice HTTP letto sullo stream dopo un errore (0 = sconosciuto)
  var probedUrl = ''; // stream di cui si è già letto il codice HTTP in questo episodio d'errore: non si richiede di nuovo

  var sources = []; // [{url, label}]: il contenuto scelto e i suoi feed alternativi
  var sourceIndex = 0;
  var attempt = 0;
  var session = 0; // cresce a ogni apertura: le risposte di un'apertura precedente vengono ignorate
  var retryTimer = null;
  var suspended = false;
  var isLive = false;
  var parked = false; // diretta in pausa da tempo: stream chiuso per non occupare una connessione del provider
  var parkTimer = null;
  var PARK_MS = 60000;
  // Cambio canale: il provider tiene ancora aperta per un attimo la connessione appena chiusa e, con un limite di
  // 1-2 connessioni, risponde 403 o blocca l'IP se se ne apre subito un'altra. Si chiude il vecchio flusso e si
  // aspetta prima di aprire il nuovo; con lo zapping veloce parte solo l'ultimo canale scelto.
  var SWITCH_GAP_MS = 1500;
  var openTimer = null;
  var lastCloseAt = 0; // quando è stato chiuso per ultimo uno stream che era aperto
  var watch = {};
  var suspendedAt = 0;
  var history = []; // ultimi riavvii dello stream e il loro motivo (Impostazioni > diagnosi)

  function note(text) {
    history.push({ at: Date.now(), text: text });
    if (root.Netlog) root.Netlog.add('video ' + text);
    if (history.length > 30) history.shift();
    try { root.console.log('[player] ' + text); } catch (e) { /* console assente */ }
  }

  var Player = {
    onEvent: function () {},
    history: function () { return history.slice(); },

    /** 'default' (UA del sistema), 'vlc' o 'smarters': l'identità con cui il lettore si presenta al provider. */
    setUserAgent: function (name) { userAgent = USER_AGENTS[name] || ''; },
    userAgent: function () { return userAgent || 'predefinito del sistema'; },

    /** Chiede lo stream e legge solo il codice HTTP (poi chiude): serve a capire se un errore è un 403 del provider. */
    probe: function (url) { return probeStatus(url); },
    url: null,
    paused: false,

    /**
     * @param {number} [startAt] secondi da cui partire
     * @param {boolean} [live] diretta: si riapre dal vivo e la fine dello stream è un'interruzione da recuperare
     */
    play: function (url, startAt, live) {
      var hadStream = !!this.url;
      this.stop();
      sources = [{ url: url, label: '' }];
      isLive = !!live;
      if (!hadStream) {
        openSource(startAt || 0);
        return;
      }
      // Stream precedente appena chiuso: pausa prima di aprire il nuovo (vedi SWITCH_GAP_MS).
      var id = ++session;
      var now = Date.now();
      this.url = url;
      this.paused = false;
      watch = { openedAt: now, prepared: false, bufferingSince: 0, lastTime: null, lastProgress: now, advanced: false, startAt: startAt || 0, warned: false };
      emit('buffering');
      openTimer = setTimeout(function () {
        openTimer = null;
        if (id === session && sources.length) openSource(startAt || 0);
      }, SWITCH_GAP_MS);
    },

    /** Feed alternativi del contenuto appena avviato ([{url, label}]), usati se lo stream si blocca. */
    setAlternates: function (list) {
      if (sources.length && sourceIndex === 0) sources = sources.slice(0, 1).concat(list);
    },

    /** Nome del feed alternativo in uso ('' se è quello scelto dall'utente). */
    sourceLabel: function () {
      return sourceIndex > 0 && sources[sourceIndex] ? sources[sourceIndex].label : '';
    },

    alternateCount: function () {
      return Math.max(0, sources.length - 1);
    },

    /** Riapre subito lo stream (tasto di ricarica o dopo che i tentativi sono finiti). */
    reload: function () {
      if (!sources.length) return;
      note('ricarica manuale');
      attempt = 0;
      openSource(resumePoint());
    },

    /** Passa al feed successivo; restituisce la sua etichetta, o null se non ci sono alternative. */
    nextSource: function () {
      if (sources.length < 2) return null;
      sourceIndex = (sourceIndex + 1) % sources.length;
      attempt = 0;
      openSource(resumePoint());
      return sources[sourceIndex].label;
    },

    stop: function () {
      clearTimeout(openTimer);
      openTimer = null;
      clearTimeout(parkTimer);
      parked = false;
      this.url = null;
      sources = [];
      sourceIndex = 0;
      attempt = 0;
      session++;
      clearTimeout(retryTimer);
      retryTimer = null;
      closeEngine();
    },

    togglePause: function () {
      if (!this.url) return;
      if (this.paused) this.resume();
      else this.pause();
    },

    pause: function () {
      try {
        if (avplay) avplay.pause();
        else html5().pause();
        this.paused = true;
        emit('paused');
        // Una diretta in pausa continua a tenere aperta la connessione col provider (che ne ammette 1-2): dopo
        // un minuto si chiude, e al "play" si riparte dal vivo.
        clearTimeout(parkTimer);
        if (isLive) parkTimer = setTimeout(park, PARK_MS);
      } catch (e) { /* non in riproduzione */ }
    },

    resume: function () {
      clearTimeout(parkTimer);
      if (parked) {
        parked = false;
        note('riapro la diretta dopo la pausa');
        attempt = 0;
        openSource(0);
        return;
      }
      try {
        if (avplay) avplay.play();
        else html5().play();
        this.paused = false;
        watch.lastProgress = Date.now();
        emit('playing');
      } catch (e) { /* non in pausa */ }
    },

    /** Spostamento relativo in secondi (positivo = avanti). */
    seek: function (deltaSeconds) {
      var duration = this.duration();
      if (!duration) return;
      var target = Math.max(0, Math.min(duration - 1, this.currentTime() + deltaSeconds));
      if (avplay) {
        try { avplay.seekTo(Math.floor(target * 1000)); } catch (e) { /* seek non supportato */ }
      } else {
        html5().currentTime = target;
      }
    },

    /** Secondi trascorsi. */
    currentTime: function () {
      try {
        return avplay ? avplay.getCurrentTime() / 1000 : html5().currentTime || 0;
      } catch (e) {
        return 0;
      }
    },

    /** Durata in secondi (0 per le dirette). */
    duration: function () {
      try {
        var d = avplay ? avplay.getDuration() / 1000 : html5().duration;
        return isFinite(d) && d > 0 ? d : 0;
      } catch (e) {
        return 0;
      }
    },

    /** Riduce il video a un riquadro ([x, y, larghezza, altezza] nel layout 1920x1080) o, con null, a tutto schermo. */
    setWindow: function (rect) {
      windowRect = rect;
      if (avplay) {
        try { applyAvplayWindow(); } catch (e) { /* player non aperto: vale dal prossimo open */ }
        return;
      }
      // Nel browser il layout è scalato e centrato: il <video> va posizionato in pixel della pagina.
      var style = html5().style;
      if (!rect) {
        style.left = style.top = style.width = style.height = '';
        return;
      }
      var app = root.document.getElementById('app').getBoundingClientRect();
      var scale = Nav.scale || 1;
      style.left = (app.left + rect[0] * scale) + 'px';
      style.top = (app.top + rect[1] * scale) + 'px';
      style.width = (rect[2] * scale) + 'px';
      style.height = (rect[3] * scale) + 'px';
    },

    /** Da chiamare quando l'app va in background / torna in primo piano. */
    suspend: function () {
      if (!suspended) suspendedAt = Date.now();
      suspended = true;
      if (avplay && this.url) {
        try { avplay.suspend(); } catch (e) { /* ignorato */ }
      } else if (!avplay) {
        html5().pause();
        // Scheda nascosta: una diretta non va lasciata scaricare in sottofondo, occupa la connessione del provider.
        if (isLive && this.url) {
          session++;
          closeEngine();
          parked = true;
        }
      }
    },

    restore: function () {
      var hiddenFor = Date.now() - suspendedAt;
      suspended = false;
      if (!this.url || !sources.length) return;
      if (parked && !this.paused) {
        parked = false;
        attempt = 0;
        openSource(0);
        return;
      }
      if (isLive && hiddenFor > SHORT_HIDE_MS) {
        // Dopo standby o una lunga sospensione lo stream ripreso è vecchio o bloccato: la diretta si riapre dal vivo.
        note('riapro la diretta dopo ' + Math.round(hiddenFor / 1000) + ' s in background');
        attempt = 0;
        openSource(0);
        return;
      }
      // Sospensione breve (barra del volume, notifica): niente riapertura, se ne occupa il controllo di salute.
      watch.lastProgress = Date.now();
      if (watch.bufferingSince) watch.bufferingSince = Date.now();
      if (avplay) {
        try {
          avplay.restore();
        } catch (e) {
          note('restore non riuscito, riapro');
          openSource(resumePoint());
        }
      } else if (!this.paused) {
        html5().play();
      }
    }
  };

  function emit(type, data) {
    Player.onEvent(type, data);
  }

  /** Diretta in pausa da troppo: si chiude lo stream (resume() la riapre dal vivo). */
  function park() {
    if (!Player.paused || !isLive || !Player.url || parked) return;
    note('diretta in pausa da tempo: chiudo lo stream');
    parked = true;
    session++;
    clearTimeout(retryTimer);
    retryTimer = null;
    closeEngine();
  }

  function closeEngine() {
    if (avplay) {
      // stop e close separati: se stop() rifiuta (player non in riproduzione) close() deve comunque liberare la connessione.
      try {
        if (avplay.getState() !== 'NONE') {
          lastCloseAt = Date.now();
          try { avplay.stop(); } catch (e) { /* non in riproduzione */ }
          avplay.close();
        }
      } catch (e) { /* già chiuso */ }
    } else {
      var video = html5();
      if (engine || video.getAttribute('src')) lastCloseAt = Date.now();
      destroyEngine();
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }

  function probeStatus(url) {
    return new Promise(function (resolve) {
      var xhr;
      var done = false;
      function finish(status) {
        if (done) return;
        done = true;
        try { xhr.abort(); } catch (e) { /* già chiusa */ }
        resolve(status);
      }
      try {
        xhr = new root.XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.onreadystatechange = function () { if (xhr.readyState >= 2) finish(xhr.status); };
        xhr.onerror = function () { finish(0); };
        xhr.send();
        setTimeout(function () { finish(0); }, 8000);
      } catch (e) {
        resolve(0);
      }
    });
  }

  /** Apre il feed corrente (sources[sourceIndex]) da capo. */
  function openSource(startAt, gapDone) {
    clearTimeout(retryTimer);
    retryTimer = null;
    closeEngine();
    var id = ++session;
    var url = sources[sourceIndex].url;
    var now = Date.now();
    // Tetto globale di aperture (vedi openlimit.js): oltre, si aspetta invece di rischiare il blocco dell'IP.
    // Pausa minima dopo la chiusura di uno stream: il provider tiene ancora per un attimo la connessione appena
    // chiusa e vedrebbe due connessioni insieme (vale per ogni via: zapping, riavvio, ricarica, riquadro).
    var gapWait = gapDone ? 0 : Math.min(SWITCH_GAP_MS, SWITCH_GAP_MS - (now - lastCloseAt));
    var limitWait = Math.max(root.OpenLimit.wait(now), gapWait);
    if (limitWait > 0) {
      if (limitWait > SWITCH_GAP_MS) note('troppe aperture ravvicinate: attendo ' + Math.ceil(limitWait / 1000) + ' s per non farmi bloccare dal provider');
      Player.url = url;
      Player.paused = false;
      emit('buffering');
      retryTimer = setTimeout(function () {
        retryTimer = null;
        if (sources.length && session === id) openSource(startAt, true);
      }, limitWait);
      return;
    }
    root.OpenLimit.record(now);
    if (root.Netlog) root.Netlog.add('apertura ' + root.Netlog.describeStream(url) + (sourceIndex ? ' (feed alternativo)' : ''));
    Player.url = url;
    Player.paused = false;
    watch = { openedAt: now, prepared: false, bufferingSince: 0, lastTime: null, lastProgress: now, advanced: false, startAt: startAt, warned: false };
    emit('buffering');
    if (avplay) playAvplay(url, startAt, id);
    else playHtml5(url, startAt, id);
  }

  /** Per film ed episodi si riparte dal punto raggiunto; le dirette ripartono dal vivo. */
  function resumePoint() {
    return isLive ? 0 : watch.lastTime || watch.startAt || 0;
  }

  function onPrepared() {
    lastStatus = 0;
    probedUrl = '';
    watch.prepared = true;
    watch.bufferingSince = 0;
    watch.lastProgress = Date.now();
  }

  function onBuffering(start) {
    if (start) {
      watch.bufferingSince = watch.bufferingSince || Date.now();
    } else {
      watch.bufferingSince = 0;
      watch.lastProgress = Date.now();
    }
  }

  /** Lo stream non va: si riprova dopo una pausa crescente, poi si passa ai feed alternativi, infine ci si arrende. */
  function fail(message, waitedMs) {
    if (!sources.length || retryTimer || watch.failed) return;
    if (waitedMs) message += ' (dopo ' + Math.round(waitedMs / 1000) + ' s' + (isLive ? '' : ', film/serie') + ')';
    session++; // le risposte in arrivo dall'apertura fallita non contano più
    // Un 404 sullo stream non passa da solo: si prova ancora una volta per ogni feed (il canale può avere varianti), poi ci si ferma.
    if (attempt >= RETRY_DELAYS.length || (lastStatus === 404 && attempt >= 1 + sources.length)) {
      giveUp(message);
      return;
    }
    note('stream riavviato (tentativo ' + (attempt + 1) + '): ' + message);
    var resumeAt = resumePoint();
    var failedAt = Date.now();
    var delay = RETRY_DELAYS[attempt];
    attempt++;
    // Se il server ha già risposto 403/429 (limite di connessioni), cambiare feed aprirebbe altre connessioni: si resta.
    var switched = attempt > 1 && sources.length > 1 && lastStatus !== 403 && lastStatus !== 429;
    if (switched) sourceIndex = (sourceIndex + 1) % sources.length;
    var failedUrl = sources[sourceIndex].url;
    closeEngine(); // prima si chiude la connessione, poi si interroga il server: mai due connessioni insieme
    var mine = session;
    // Il codice HTTP del provider si legge a parte e finisce nella cronologia; con 403/429 si aspetta di più.
    // Una sola volta per stream e per episodio d'errore: ogni lettura è una connessione in più verso il provider.
    var probed = Promise.resolve();
    if (probedUrl !== failedUrl) {
      probedUrl = failedUrl;
      probed = probeStatus(failedUrl).then(function (status) {
        lastStatus = status;
        if (status) note('risposta del server: HTTP ' + status + (status === 403 ? ' (accesso negato o limite di connessioni)' : ''));
      });
    }
    emit('retrying', { attempt: attempt, max: RETRY_DELAYS.length, label: sources[sourceIndex].label, switched: switched });
    retryTimer = setTimeout(function () {
      probed.then(function () {
        if (!sources.length || session !== mine) return; // nel frattempo è stato scelto altro
        var limited = lastStatus === 403 || lastStatus === 429;
        var wait = limited ? Math.max(0, LIMIT_PAUSE_MS - (Date.now() - failedAt)) : 0;
        retryTimer = setTimeout(function () {
          retryTimer = null;
          if (sources.length && session === mine) openSource(resumeAt);
        }, wait);
      });
    }, delay);
  }

  /** Fine dei tentativi: resta il messaggio d'errore; reload() riparte da capo. */
  function giveUp(message) {
    session++;
    watch.failed = true;
    closeEngine();
    emit('error', message);
  }

  /** Controllo ogni secondo: si accorge degli stream bloccati anche quando il player non segnala errori. */
  var lastTick = Date.now();

  function checkHealth() {
    var tick = Date.now();
    var gap = tick - lastTick;
    lastTick = tick;
    // Il timer si ferma con la TV in standby anche senza visibilitychange: al risveglio si ricarica la diretta.
    if (gap > SLEEP_GAP_MS && Player.url && isLive && !suspended && !Player.paused) {
      suspendedAt = tick - gap;
      Player.restore();
      return;
    }
    // Il browser non ha girato per qualche secondo (elenchi grandi da leggere, immagini): lo stream non c'entra,
    // i tempi di attesa ripartono invece di scambiare il rallentamento per un blocco.
    if (gap > JANK_GAP_MS) {
      note('pausa del browser di ' + Math.round(gap / 100) / 10 + ' s: attese azzerate');
      watch.lastProgress = tick;
      if (watch.bufferingSince) watch.bufferingSince = tick;
    }
    if (!sources.length || retryTimer || watch.failed || Player.paused || suspended) return;
    var now = Date.now();
    var time = Player.currentTime();
    if (time > 0 && time !== watch.lastTime) {
      if (watch.lastTime !== null) watch.advanced = true;
      watch.lastTime = time;
      watch.lastProgress = now;
      // Il video avanza: un 'caricamento' rimasto aperto (evento di fine perso) non è un blocco.
      if (watch.prepared) watch.bufferingSince = 0;
    }
    var bufferingMs = isLive ? BUFFERING_MS : VOD_BUFFERING_MS;
    var stallMs = isLive ? STALL_MS : VOD_STALL_MS;
    if (watch.advanced && attempt && now - watch.openedAt > STABLE_MS) attempt = 0;
    var openMs = isLive ? OPEN_MS : VOD_OPEN_MS;
    var waitingSince = !watch.prepared ? watch.openedAt : watch.bufferingSince;
    if (!isLive) warnIfSlow(now, waitingSince);
    if (!watch.prepared) {
      if (now - watch.openedAt > openMs) fail(isLive ? 'Il canale non risponde' : 'Il contenuto non si apre', now - watch.openedAt);
    } else if (watch.bufferingSince) {
      if (now - watch.bufferingSince > bufferingMs) fail('Il server non manda più il video', now - watch.bufferingSince);
    } else if (watch.advanced && now - watch.lastProgress > stallMs) {
      // Solo se il tempo è già avanzato una volta: alcuni firmware non lo aggiornano per le dirette.
      fail('Il server non manda più il video', now - watch.lastProgress);
    }
  }

  /** Film e serie: se l'attesa si allunga non si riavvia nulla, ma lo si dice (e resta nella cronologia). */
  function warnIfSlow(now, waitingSince) {
    if (!waitingSince) {
      watch.warned = false;
      return;
    }
    if (watch.warned || now - waitingSince < VOD_SLOW_MS) return;
    watch.warned = true;
    note('film/serie lento a caricare (' + Math.round((now - waitingSince) / 1000) + ' s): attendo senza riavviare');
    emit('slow', { seconds: Math.round((now - waitingSince) / 1000) });
  }
  setInterval(checkHealth, 1000);

  /** Fine dello stream: per i film è la fine vera, per una diretta vuol dire che il server l'ha chiusa. */
  function onEnded() {
    if (!isLive) {
      session++;
      sources = [];
      emit('ended');
    } else {
      fail('La diretta si è interrotta');
    }
  }

  function html5() {
    return root.document.getElementById('html5-player');
  }

  // Nel browser la scala del layout cambia con la finestra: il riquadro va ricalcolato (dopo fitToWindow).
  root.addEventListener('resize', function () {
    if (!avplay && windowRect) setTimeout(function () { Player.setWindow(windowRect); }, 0);
  });

  /**
   * Sulle TV UHD con Tizen 3.0 (2017) setDisplayRect raddoppia la posizione ma non le dimensioni:
   * (480, 270, 960, 540) finisce in basso a destra invece che al centro. Lì la posizione va dimezzata.
   */
  var avplayPositionFactor = (function () {
    if (!/Tizen 3\./.test(root.navigator.userAgent)) return 1;
    var uhd = true; // se l'API non risponde si assume UHD (caso verificato: UE49MU6500)
    try { uhd = root.webapis.productinfo.isUdPanelSupported() !== false; } catch (e) { /* API assente */ }
    return uhd ? 0.5 : 1;
  })();

  function applyAvplayWindow() {
    var r = windowRect || [0, 0, 1920, 1080];
    avplay.setDisplayRect(Math.round(r[0] * avplayPositionFactor), Math.round(r[1] * avplayPositionFactor), r[2], r[3]);
  }

  function playAvplay(url, startAt, id) {
    function current() { return id === session; } // false se nel frattempo si è riaperto o scelto altro
    try {
      avplay.open(url);
      if (userAgent) {
        try { avplay.setStreamingProperty('USER_AGENT', userAgent); } catch (e) { /* firmware senza questa proprietà */ }
      }
      applyAvplayWindow();
      try { avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) { /* firmware vecchi */ }
      avplay.setListener({
        onbufferingstart: function () {
          if (!current()) return;
          onBuffering(true);
          emit('buffering');
        },
        onbufferingcomplete: function () {
          if (!current()) return;
          onBuffering(false);
          if (!Player.paused) emit('playing');
        },
        onstreamcompleted: function () { if (current()) onEnded(); },
        onerror: function (error) { if (current()) fail('Errore di riproduzione (' + error + ')'); }
      });
      avplay.prepareAsync(function () {
        if (!current()) return;
        if (startAt) {
          try { avplay.seekTo(Math.floor(startAt * 1000)); } catch (e) { /* stream non ricercabile */ }
        }
        avplay.play();
        onPrepared();
        emit('playing');
      }, function (error) {
        if (current()) fail('Impossibile aprire lo stream (' + error + ')');
      });
    } catch (e) {
      fail('Impossibile avviare il player: ' + e.message);
    }
  }

  function loadLibrary(name) {
    var lib = LIBRARIES[name];
    if (root[lib.global]) return Promise.resolve(root[lib.global]);
    if (!libraryPromises[name]) {
      libraryPromises[name] = new Promise(function (resolve, reject) {
        var script = root.document.createElement('script');
        script.src = lib.url;
        script.onload = function () { resolve(root[lib.global]); };
        script.onerror = function () {
          delete libraryPromises[name];
          reject(new Error('Impossibile scaricare il lettore video (' + name + ')'));
        };
        root.document.head.appendChild(script);
      });
    }
    return libraryPromises[name];
  }

  function destroyEngine() {
    if (!engine) return;
    try { engine.destroy(); } catch (e) { /* già distrutto */ }
    engine = null;
  }

  function extensionOf(url) {
    var match = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url);
    return match ? match[1].toLowerCase() : '';
  }

  function playHtml5(url, startAt, id) {
    function current() { return id === session; }
    var video = html5();
    video.onwaiting = function () {
      if (!current()) return;
      onBuffering(true);
      emit('buffering');
    };
    video.onplaying = function () {
      if (!current()) return;
      if (watch.prepared) onBuffering(false);
      else onPrepared();
      emit('playing');
    };
    video.onended = function () { if (current()) onEnded(); };
    video.onerror = function () { if (current()) fail(WEB_ERROR); };
    video.onloadedmetadata = function () {
      if (startAt) video.currentTime = startAt;
    };

    var ext = extensionOf(url);
    var needsHls = ext === 'm3u8' && !video.canPlayType('application/vnd.apple.mpegurl');
    if (ext !== 'ts' && !needsHls) {
      video.src = url;
      startVideo(video);
      return;
    }
    loadLibrary(ext === 'ts' ? 'mpegts' : 'hls').then(function (lib) {
      if (!current()) return; // nel frattempo è stato scelto un altro contenuto
      if (ext === 'ts') playWithMpegts(lib, video, url, current);
      else playWithHls(lib, video, url, current);
    }, function (err) {
      if (current()) fail(err.message);
    });
  }

  function playWithMpegts(mpegts, video, url, current) {
    if (!mpegts.isSupported()) {
      giveUp('Questo browser non supporta MPEG-TS: prova il formato HLS nelle impostazioni');
      return;
    }
    // Niente inseguimento forzato della diretta: con buffer spento mandava il video avanti a scatti, con un 'waiting' (rotellina di caricamento) ogni pochi secondi. Un piccolo buffer di sicurezza tiene la riproduzione fluida.
    engine = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: url }, {
      enableStashBuffer: true, liveBufferLatencyChasing: false
    });
    engine.on(mpegts.Events.ERROR, function (type, detail, info) {
      if (!current()) return;
      var text = (info && info.msg ? String(info.msg) : '') + ' ' + (detail || '');
      // Codec non supportato dal browser (tipico l'audio E-AC3 / Dolby Digital Plus): riaprire lo stream non serve a
      // nulla e carica solo il provider con connessioni inutili, quindi niente tentativi.
      if (/addSourceBuffer|unsupported|MediaSource/i.test(text) && /ec-3|ac-3|eac3|unsupported/i.test(text)) {
        note('codec non supportato dal browser: ' + text.trim().slice(0, 160));
        giveUp(CODEC_ERROR);
        return;
      }
      fail(WEB_ERROR);
    });
    engine.attachMediaElement(video);
    engine.load();
    startVideo(video);
  }

  function playWithHls(Hls, video, url, current) {
    if (!Hls.isSupported()) {
      giveUp('Questo browser non supporta HLS');
      return;
    }
    engine = new Hls();
    engine.on(Hls.Events.ERROR, function (event, data) {
      if (data && data.fatal && current()) fail(WEB_ERROR);
    });
    engine.loadSource(url);
    engine.attachMedia(video);
    startVideo(video);
  }

  function startVideo(video) {
    var started = video.play();
    if (started && started.catch) started.catch(function () { /* errore gestito da onerror / engine */ });
  }

  root.Player = Player;
})(this);
