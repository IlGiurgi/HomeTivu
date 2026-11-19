'use strict';

var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var FavSync = require('../../app/js/favsync.js');

var NOW = Date.parse('2026-11-19T12:00:00Z');
function fav(id, at, extra) { return Object.assign({ type: 'live', id: id, name: 'Canale ' + id, at: at }, extra || {}); }
function ids(state) { return JSON.parse(JSON.stringify(state.items.map(function (f) { return f.id; }))); }

test('unione: i preferiti di entrambi i lati restano, senza doppioni, in ordine di aggiunta', function () {
  var merged = FavSync.merge({ items: [fav('1', 100), fav('2', 300)], gone: {} }, { items: [fav('2', 300), fav('3', 200)], gone: {} }, NOW);
  assert.deepStrictEqual(ids(merged), ['1', '3', '2']);
});

test('unione: preferiti vecchi senza ora si sommano (locali per primi)', function () {
  var merged = FavSync.merge({ items: [{ type: 'live', id: 'a' }, { type: 'live', id: 'b' }], gone: {} }, { items: [{ type: 'live', id: 'c' }, { type: 'live', id: 'a' }], gone: {} }, NOW);
  assert.deepStrictEqual(ids(merged), ['a', 'b', 'c']);
});

test('unione: una rimozione più recente vince, una nuova aggiunta più recente vince sulla rimozione', function () {
  var removed = FavSync.merge({ items: [], gone: { 'live:1': NOW - 1000 } }, { items: [fav('1', 100)], gone: {} }, NOW);
  assert.deepStrictEqual(ids(removed), []);
  assert.strictEqual(removed.gone['live:1'], NOW - 1000, 'la traccia resta per l\'altro dispositivo');
  var readded = FavSync.merge({ items: [fav('1', NOW)], gone: {} }, { items: [], gone: { 'live:1': NOW - 1000 } }, NOW);
  assert.deepStrictEqual(ids(readded), ['1']);
  assert.strictEqual(readded.gone['live:1'], undefined);
});

test('unione: film e canali con lo stesso id sono distinti, rimozioni vecchie dimenticate, dati sporchi scartati', function () {
  var old = NOW - 91 * 86400000;
  var merged = FavSync.merge(
    { items: [fav('1', 1), { type: 'vod', id: '1', name: 'Film', at: 2 }], gone: { 'live:9': old } },
    { items: [null, { name: 'senza id' }, { type: 'live', id: 7, name: 'x', evil: { a: 1 } }], gone: 'boh' }, NOW);
  assert.deepStrictEqual(merged.items.map(function (f) { return f.type + ':' + f.id; }), ['live:7', 'live:1', 'vod:1']);
  assert.strictEqual(merged.items[2].evil, undefined);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(merged.gone)), {});
});

test('toggleFavorite mette l\'ora e lascia la traccia della rimozione', function () {
  var data = {};
  var context = { localStorage: { getItem: function (k) { return k in data ? data[k] : null; }, setItem: function (k, v) { data[k] = String(v); }, removeItem: function (k) { delete data[k]; } }, Date: Date };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../app/js/storage.js'), 'utf8'), context);
  var Storage = context.Storage;
  var calls = 0;
  Storage.onFavoritesChange = function () { calls++; };
  Storage.toggleFavorite({ type: 'live', id: '5', name: 'Rai 5' });
  assert.ok(Storage.getFavorites()[0].at > 0);
  Storage.toggleFavorite({ type: 'live', id: '5', name: 'Rai 5' });
  assert.strictEqual(Storage.getFavorites().length, 0);
  assert.ok(Storage.getFavoritesGone()['live:5'] > 0);
  assert.strictEqual(calls, 2);
});

test('sync: legge da HA, unisce, aggiorna il locale e riscrive; 404 = lista ancora vuota; HA spento non lancia', function () {
  var written = null;
  var remote = { state: '1', attributes: { items: [fav('2', 200)], gone: {} } };
  var local = { items: [fav('1', 100)], gone: {} };
  var down = false;
  var root = {
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: global.setInterval,
    Home: {
      configured: function () { return true; },
      request: function (p, body) {
        if (down) return Promise.reject(new Error('Home Assistant non risponde'));
        if (body === undefined) return remote ? Promise.resolve(remote) : Promise.reject(new Error('Errore HTTP 404'));
        written = body; remote = body; return Promise.resolve({});
      }
    },
    Storage: {
      getFavorites: function () { return local.items; }, getFavoritesGone: function () { return local.gone; },
      replaceFavorites: function (items, gone) { local = { items: items, gone: gone }; }
    }
  };
  var source = fs.readFileSync(path.join(__dirname, '../../app/js/favsync.js'), 'utf8');
  var ctx = vm.createContext(root); root.window = root;
  vm.runInContext(source, ctx);
  var Sync = root.FavSync;
  return Sync.sync().then(function () {
    assert.deepStrictEqual(ids(local), ['1', '2']);
    assert.deepStrictEqual(ids({ items: written.attributes.items }), ['1', '2']);
    assert.strictEqual(written.state, '2');
    written = null;
    return Sync.sync();
  }).then(function () {
    assert.strictEqual(written, null, 'niente da scrivere se è già uguale');
    remote = null; // 404
    return Sync.sync();
  }).then(function () {
    assert.deepStrictEqual(ids(written.attributes), ['1', '2']);
    down = true;
    return Sync.sync().then(function (ok) { assert.strictEqual(ok, false); assert.match(Sync.status, /errore/); });
  });
});
