'use strict';

var test = require('node:test');
var assert = require('node:assert');
var OpenLimit = require('../../app/js/openlimit.js');

test('il limitatore lascia passare fino al tetto, poi dice quanto aspettare', function () {
  OpenLimit.reset();
  for (var i = 0; i < OpenLimit.MAX_OPENS; i++) {
    assert.strictEqual(OpenLimit.wait(1000 + i * 100), 0);
    OpenLimit.record(1000 + i * 100);
  }
  // la prima apertura (t=1000) esce dalla finestra a 1000 + WINDOW_MS
  assert.strictEqual(OpenLimit.wait(2000), 1000 + OpenLimit.WINDOW_MS - 2000);
  assert.strictEqual(OpenLimit.wait(1000 + OpenLimit.WINDOW_MS), 0);
});

test('le aperture vecchie non contano più', function () {
  OpenLimit.reset();
  for (var i = 0; i < OpenLimit.MAX_OPENS; i++) OpenLimit.record(0);
  assert.strictEqual(OpenLimit.wait(OpenLimit.WINDOW_MS + 1), 0);
});
