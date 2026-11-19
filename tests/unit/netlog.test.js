'use strict';

var test = require('node:test');
var assert = require('node:assert');
var Netlog = require('../../app/js/netlog.js');

test('describeApi tiene azione e id numerici e scarta le credenziali', function () {
  var url = 'http://s.example:8080/player_api.php?username=SEGRETO&password=PASSWORD&action=get_short_epg&stream_id=42&limit=8';
  var text = Netlog.describeApi(url);
  assert.strictEqual(text, 'get_short_epg stream_id=42');
  assert.doesNotMatch(text, /SEGRETO|PASSWORD/);
  assert.strictEqual(Netlog.describeApi('http://s.example/player_api.php?username=a&password=b'), 'player_api');
});

test('describeStream tiene solo l\'id dello stream', function () {
  var text = Netlog.describeStream('http://s.example:8080/live/SEGRETO/PASSWORD/1234.ts');
  assert.strictEqual(text, 'stream 1234');
});

test('il registro tiene al massimo 200 righe, le ultime, in ordine di tempo', function () {
  Netlog.clear();
  for (var i = 0; i < 250; i++) Netlog.add('riga ' + i, 1000 + i);
  assert.strictEqual(Netlog.entries().length, 200);
  var lines = Netlog.lines(2);
  assert.match(lines[0], / riga 248$/);
  assert.match(lines[1], / riga 249$/);
  Netlog.clear();
});

test('firstRefusal conserva la prima richiesta rifiutata dell\'episodio e resta dopo il primo 200 finché non ne arriva uno nuovo', function () {
  Netlog.clear();
  assert.strictEqual(Netlog.firstRefusal(), '');
  Netlog.add('apertura stream 1', 1000);
  Netlog.add('api get_short_epg stream_id=5 -> 404', 2000);
  Netlog.add('api get_short_epg stream_id=6 -> 404', 3000);
  assert.match(Netlog.firstRefusal(), /stream_id=5 -> 404.*prima: apertura stream 1$/);
  Netlog.add('api get_live_streams -> 200', 4000);
  assert.match(Netlog.firstRefusal(), /stream_id=5 -> 404/, 'il dato serve proprio dopo che il blocco è finito');
  Netlog.add('video risposta del server: HTTP 403', 5000);
  assert.match(Netlog.firstRefusal(), /HTTP 403/, 'un nuovo episodio sostituisce il precedente');
  Netlog.clear();
});
