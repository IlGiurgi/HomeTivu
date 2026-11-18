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
