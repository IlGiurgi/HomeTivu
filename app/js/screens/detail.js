/*
 * Dettaglio di un film o di una serie: locandina, trama, pulsanti, stagioni ed episodi.
 */
(function (root) {
  'use strict';

  var h = UI.h;
  var el = root.document.getElementById('screen-detail');
  var posterEl = el.querySelector('.detail-poster');
  var titleEl = el.querySelector('.detail-title');
  var metaEl = el.querySelector('.detail-meta');
  var plotEl = el.querySelector('.detail-plot');
  var actionsEl = el.querySelector('.detail-actions');
  var seasonsEl = el.querySelector('.detail-seasons');
  var episodesEl = el.querySelector('.detail-episodes');

  var CHUNK = 25; // stagioni più lunghe si dividono in blocchi ("1–25", "26–50"...)
  var rangesEl = h('div.detail-ranges.scroll');
  episodesEl.parentNode.insertBefore(rangesEl, episodesEl);

  var state = { item: null, info: null, episodes: {}, season: null, range: 0, token: 0 };

  // Sfondo: la locandina su un canvas di 32x18 px allargato a tutto schermo, quindi già sfocato.
  var backdropEl = h('div.detail-backdrop', {}, [h('canvas', { width: '32', height: '18' })]);
  el.insertBefore(backdropEl, el.firstChild);
  var backdropSrc = null;

  function paintBackdrop(src) {
    if (src === backdropSrc) return;
    backdropSrc = src;
    backdropEl.classList.remove('visible');
    if (!src) return;
    var image = new root.Image();
    image.onload = function () {
      if (src !== backdropSrc || !image.width || !image.height) return;
      var canvas = backdropEl.firstChild;
      // Fascia centrale 16:9 dell'immagine (le locandine sono verticali).
      var w = image.width;
      var hgt = Math.min(image.height, w * 9 / 16);
      if (hgt < w * 9 / 16) w = hgt * 16 / 9;
      canvas.getContext('2d').drawImage(image, (image.width - w) / 2, (image.height - hgt) / 2, w, hgt, 0, 0, canvas.width, canvas.height);
      backdropEl.classList.add('visible');
    };
    image.src = src;
  }

  /** Xtream: backdrop_path è un elenco di immagini orizzontali; se manca si usa la locandina. */
  function backdropOf(info, item) {
    var backdrop = info.backdrop_path;
    if (backdrop && typeof backdrop !== 'string') backdrop = backdrop[0];
    return backdrop || info.cover_big || info.movie_image || info.cover || item.icon || null;
  }

  function resumeKey(type, id) {
    return type + ':' + id;
  }

  function button(key, label, onSelect) {
    var b = h('div.button.focusable', { 'data-zone': 'detail-actions', 'data-key': key, text: label });
    b.onSelect = onSelect;
    return b;
  }

  function favoriteLabel() {
    return Storage.isFavorite(state.item.type, state.item.id) ? '★ Rimuovi dai preferiti' : '☆ Aggiungi ai preferiti';
  }

  function renderActions() {
    var item = state.item;
    UI.clear(actionsEl);
    if (item.type === 'vod' && state.info) {
      var movie = state.info.movie_data || {};
      var playable = {
        type: 'vod', id: String(movie.stream_id || item.id), name: item.name, icon: item.icon,
        ext: movie.container_extension || item.ext
      };
      var position = Storage.getResume(resumeKey('vod', playable.id));
      if (position) {
        actionsEl.appendChild(button('resume', '▶ Riprendi da ' + UI.formatDuration(position), function () {
          if (Remote.active()) Remote.sendItem(playable);
          else App.show('player', { playlist: [playable], index: 0, startAt: position });
        }));
      }
      actionsEl.appendChild(button('play', position ? '↺ Dall\'inizio' : '▶ Riproduci', function () {
        if (Remote.active()) Remote.sendItem(playable);
        else App.show('player', { playlist: [playable], index: 0, startAt: 0 });
      }));
    }
    if (item.type === 'series') {
      var next = nextEpisode();
      if (next) {
        actionsEl.appendChild(button('play-series', next.position
          ? '▶ Riprendi S' + next.season + ' E' + next.episode.episode_num + ' da ' + UI.formatDuration(next.position)
          : '▶ Riproduci S' + next.season + ' E' + next.episode.episode_num, function () {
          playEpisode(next.season, next.index, next.position);
        }));
      }
    }
    var fav = button('fav', favoriteLabel(), function () {
      var added = Storage.toggleFavorite(item);
      fav.textContent = favoriteLabel();
      UI.toast(added ? 'Aggiunto ai preferiti' : 'Rimosso dai preferiti');
    });
    actionsEl.appendChild(fav);
  }

  function renderInfo() {
    var item = state.item;
    var info = (state.info && state.info.info) || {};
    UI.clear(posterEl);
    posterEl.appendChild(UI.img(info.cover_big || info.movie_image || info.cover || item.icon, 'detail-poster-img'));
    paintBackdrop(backdropOf(info, item));
    titleEl.textContent = info.name || item.name;
    var year = (info.releasedate || info.releaseDate || info.release_date || '').slice(0, 4);
    var meta = [
      year,
      info.genre,
      info.duration,
      (info.rating || item.rating) ? '★ ' + (info.rating || item.rating) : ''
    ].filter(function (part) { return part && String(part).trim(); });
    metaEl.textContent = meta.join('  ·  ');
    plotEl.textContent = info.plot || info.description || '';
  }

  // ---------- Serie: stagioni ed episodi ----------

  function renderSeasons() {
    UI.clear(seasonsEl);
    var seasons = Xtream.sortedSeasonNumbers(state.episodes);
    seasons.forEach(function (season) {
      var seasonEl = h('div.season.focusable', {
        'data-zone': 'detail-seasons', 'data-key': 'season-' + season, text: 'Stagione ' + season
      });
      seasonEl.onFocusIn = function () { selectSeason(season); };
      seasonEl.onSelect = function () { Nav.focusZone('detail-episodes'); };
      seasonsEl.appendChild(seasonEl);
    });
    if (seasons.length) selectSeason(state.season && state.episodes[state.season] ? state.season : seasons[0]);
    else episodesEl.appendChild(h('p.empty', { text: 'Nessun episodio disponibile' }));
  }

  function selectSeason(season, range) {
    state.season = season;
    state.range = range || 0;
    Array.prototype.forEach.call(seasonsEl.children, function (s) {
      s.classList.toggle('selected', s.getAttribute('data-key') === 'season-' + season);
    });
    renderRanges();
    renderEpisodes();
  }

  /** Blocchi di episodi per le stagioni lunghe: ▲ dagli episodi ci arriva, ◀▶ li cambia. */
  function renderRanges() {
    var total = (state.episodes[state.season] || []).length;
    Nav.forgetZone('detail-ranges');
    UI.clear(rangesEl);
    el.classList.toggle('has-ranges', total > CHUNK);
    if (total <= CHUNK) return;
    for (var start = 0; start < total; start += CHUNK) {
      (function (index, from) {
        var label = (from + 1) + '–' + Math.min(total, from + CHUNK);
        var rangeEl = h('div.season.range.focusable', {
          'data-zone': 'detail-ranges', 'data-key': 'range-' + index, text: label
        });
        rangeEl.onFocusIn = function () {
          if (state.range === index) return;
          state.range = index;
          markRange();
          renderEpisodes();
        };
        rangeEl.onSelect = function () { Nav.focusZone('detail-episodes'); };
        rangesEl.appendChild(rangeEl);
      })(start / CHUNK, start);
    }
    markRange();
  }

  function markRange() {
    Array.prototype.forEach.call(rangesEl.children, function (r) {
      r.classList.toggle('selected', r.getAttribute('data-key') === 'range-' + state.range);
    });
  }

  function playlistFor(season) {
    var seriesName = state.item.name;
    return (state.episodes[season] || []).map(function (ep) {
      var info = ep.info || {};
      return {
        type: 'episode', id: String(ep.id), ext: ep.container_extension, icon: state.item.icon,
        name: seriesName + ' – S' + season + 'E' + ep.episode_num + (ep.title ? ' · ' + stripPrefix(ep.title, seriesName) : ''),
        duration: info.duration_secs || 0,
        label: ep.episode_num + '. ' + stripPrefix(ep.title || 'Episodio ' + ep.episode_num, seriesName),
        durationText: info.duration || '',
        thumb: info.movie_image || '',
        plot: info.plot || ''
      };
    });
  }

  function playEpisode(season, index, position) {
    var playlist = playlistFor(season);
    Storage.setSeriesLast(String(state.item.id), playlist[index].id);
    var episode = playlist[index];
    if (Remote.active()) Remote.sendItem(episode);
    else App.show('player', { playlist: playlist, index: index, startAt: position || 0 });
  }

  /**
   * Cosa proporre con il pulsante principale: l'episodio lasciato a metà (il più recente), altrimenti
   * quello dopo l'ultimo avviato, altrimenti il primo. {season, index, episode, position}
   */
  function nextEpisode() {
    var flat = [];
    Xtream.sortedSeasonNumbers(state.episodes).forEach(function (season) {
      (state.episodes[season] || []).forEach(function (ep, index) {
        flat.push({ season: season, index: index, episode: ep, position: 0 });
      });
    });
    if (!flat.length) return null;
    var best = null;
    var bestAt = 0;
    var lastId = Storage.getSeriesLast(String(state.item.id));
    var lastPos = -1;
    flat.forEach(function (entry, i) {
      var saved = Storage.getResumeEntry(resumeKey('episode', entry.episode.id));
      if (saved && saved.at > bestAt) { bestAt = saved.at; best = entry; best.position = saved.position; }
      if (lastId !== null && String(entry.episode.id) === lastId) lastPos = i;
    });
    if (best) return best;
    if (lastPos >= 0) return flat[lastPos + 1] || flat[0];
    return flat[0];
  }

  function renderEpisodes() {
    var season = state.season;
    var playlist = playlistFor(season);
    var from = state.range * CHUNK;
    var to = playlist.length > CHUNK ? from + CHUNK : playlist.length;
    Nav.forgetZone('detail-episodes');
    UI.clear(episodesEl);
    episodesEl.scrollTop = 0;
    playlist.slice(from, to).forEach(function (episode, offset) {
      var index = from + offset;
      var position = Storage.getResume(resumeKey('episode', episode.id));
      var progress = position && episode.duration ? Math.min(100, position / episode.duration * 100) : 0;
      var epEl = h('div.episode.focusable', { 'data-zone': 'detail-episodes', 'data-key': 'episode-' + episode.id }, [
        episode.thumb ? UI.img(episode.thumb, 'episode-thumb') : null,
        h('span.episode-text', {}, [
          h('span.episode-title', { text: episode.label }),
          episode.plot ? h('span.episode-plot', { text: episode.plot }) : null
        ]),
        h('span.episode-duration', { text: position ? 'ripresa da ' + UI.formatDuration(position) : episode.durationText }),
        progress ? h('span.episode-progress', { style: 'width:' + progress.toFixed(1) + '%' }) : null
      ]);
      epEl.onSelect = function () { playEpisode(season, index, position); };
      episodesEl.appendChild(epEl);
    });
  }

  /** Molti provider ripetono il nome della serie nel titolo dell'episodio. */
  function stripPrefix(title, seriesName) {
    var t = String(title || '');
    return t.indexOf(seriesName) === 0 ? t.slice(seriesName.length).replace(/^[\s\-–:|]+/, '') || t : t;
  }

  // ---------- Caricamento ----------

  function load() {
    var item = state.item;
    var token = ++state.token;
    var request = item.type === 'vod' ? App.client.getVodInfo(item.id) : App.client.getSeriesInfo(item.id);
    UI.withLoader(request).then(function (info) {
      if (token !== state.token) return;
      state.info = info || {};
      state.episodes = (info && info.episodes) || {};
      renderInfo();
      renderActions();
      if (item.type === 'series') renderSeasons();
      Nav.focusFirst();
    }, function (err) {
      if (token !== state.token) return;
      UI.toast('Errore: ' + err.message);
      renderActions();
      Nav.focusFirst();
    });
  }

  /** Dopo un re-render, rimette il focus sull'elemento equivalente (stesso data-key). */
  function refocus(key) {
    var target = key && el.querySelector('[data-key="' + key + '"]');
    if (target) Nav.focus(target);
    else Nav.focusFirst();
  }

  App.register('detail', {
    el: el,
    enter: function (params) {
      state.item = params.item;
      state.info = null;
      state.episodes = {};
      state.season = null;
      el.classList.toggle('is-series', state.item.type === 'series');
      UI.clear(seasonsEl);
      UI.clear(rangesEl);
      UI.clear(episodesEl);
      el.classList.remove('has-ranges');
      renderInfo();
      renderActions();
      Nav.focusFirst();
      load();
    },
    resume: function () {
      // Aggiorna le posizioni di ripresa dopo la visione.
      var key = this.lastFocus && this.lastFocus.getAttribute('data-key');
      renderActions();
      // Dopo aver visto parte del film, il pulsante più utile è "Riprendi".
      if (key === 'play' && actionsEl.querySelector('[data-key="resume"]')) key = 'resume';
      if (state.item.type === 'series' && state.season) renderEpisodes();
      this.lastFocus = null;
      refocus(key);
    },
    handleKey: function (action) {
      if (action === 'red') {
        var fav = actionsEl.querySelector('[data-key="fav"]');
        if (fav) fav.onSelect();
        return true;
      }
      return false;
    }
  });
})(this);
