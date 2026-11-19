#!/usr/bin/env node
/*
 * Test E2E del riordino dei preferiti: TV (GIALLO + frecce) e telefono (pulsante Riordina con ▲ ▼).
 *
 *   node tests/e2e/reorder.js
 */
'use strict';

var assert = require('assert');
var chromium = require('playwright').chromium;
var server = require('../../dev/mock-server.js');

var FAVORITES = [1, 2, 3].map(function (n) { return { type: 'live', id: String(n), name: 'Canale ' + n, at: n }; });

function installTv(config) {
  localStorage.setItem('xtreamtv.account', JSON.stringify(config.account));
  localStorage.setItem('xtreamtv.settings', JSON.stringify({ startSection: 'favorites' }));
  localStorage.setItem('xtreamtv.favorites', JSON.stringify(config.favorites));
  var fake = {
    state: 'NONE',
    open: function () { fake.state = 'IDLE'; }, setDisplayRect: function () {}, setDisplayMethod: function () {},
    setListener: function () {}, prepareAsync: function (ok) { fake.state = 'READY'; setTimeout(ok, 10); },
    play: function () { fake.state = 'PLAYING'; }, pause: function () {}, stop: function () { fake.state = 'IDLE'; },
    close: function () { fake.state = 'NONE'; }, seekTo: function () {}, getState: function () { return fake.state; },
    getDuration: function () { return 0; }, getCurrentTime: function () { return 0; }, suspend: function () {}, restore: function () {}
  };
  window.webapis = { avplay: fake };
}

function installPhone(config) {
  localStorage.setItem('xtreamtv.account', JSON.stringify(config.account));
  localStorage.setItem('xtreamtv.settings', JSON.stringify({ startSection: 'favorites' }));
  localStorage.setItem('xtreamtv.favorites', JSON.stringify(config.favorites));
}

async function main() {
  await new Promise(function (resolve) { server.listen(0, resolve); });
  var base = 'http://localhost:' + server.address().port;
  var config = { account: { server: base, username: 'demo', password: 'demo' }, favorites: FAVORITES };
  var browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  var errors = [];
  function stored(page) {
    return page.evaluate(function () {
      return JSON.parse(localStorage.getItem('xtreamtv.favorites')).map(function (f) { return f.id; }).join(',');
    });
  }
  function shown(page) {
    return page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll('.items .row .row-name'), function (n) { return n.textContent; }).join(',');
    });
  }

  // TV
  var tv = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  tv.on('pageerror', function (err) { errors.push(err.message); });
  await tv.addInitScript(installTv, config);
  await tv.goto(base);
  await tv.waitForSelector('.items .row');
  await tv.evaluate(function () { Nav.focus(document.querySelector('.items .row')); });
  await tv.keyboard.press('F3'); // GIALLO: prende il primo canale
  await tv.waitForSelector('.items .row.is-moving');
  await tv.keyboard.press('ArrowDown');
  await tv.keyboard.press('ArrowDown');
  await tv.waitForTimeout(100);
  assert.strictEqual(await stored(tv), '2,3,1');
  assert.strictEqual(await shown(tv), 'Canale 2,Canale 3,Canale 1');
  assert.strictEqual(await tv.locator('.items .row.is-moving .row-name').textContent(), 'Canale 1', 'il canale spostato resta evidenziato e a fuoco');
  await tv.keyboard.press('Enter');
  assert.strictEqual(await tv.locator('.items .row.is-moving').count(), 0);
  await tv.keyboard.press('ArrowDown'); // ora le frecce si muovono e basta
  assert.strictEqual(await stored(tv), '2,3,1');
  console.log('ok - TV: GIALLO prende il canale, ▲▼ lo spostano, OK lo fissa, ordine salvato');

  // Telefono
  var phone = await browser.newContext({ viewport: { width: 400, height: 800 }, isMobile: true, hasTouch: true });
  var mobile = await phone.newPage();
  mobile.on('pageerror', function (err) { errors.push(err.message); });
  await mobile.addInitScript(installPhone, config);
  await mobile.goto(base);
  await mobile.waitForSelector('.items .row');
  assert.strictEqual(await mobile.locator('.reorder-top').isVisible(), true, 'pulsante Riordina visibile nei preferiti');
  assert.strictEqual(await mobile.locator('.reorder-ctl').first().isVisible(), false, 'frecce nascoste finché non si preme Riordina');
  await mobile.locator('.reorder-top').click();
  await mobile.waitForSelector('.items .row .reorder-btn');
  await mobile.locator('.items .row').nth(2).locator('.reorder-btn').first().click(); // ▲ sul terzo
  await mobile.waitForTimeout(100);
  assert.strictEqual(await stored(mobile), '1,3,2');
  assert.strictEqual(await mobile.locator('.reorder-top').textContent(), 'Fatto');
  await mobile.locator('.reorder-top').click();
  assert.strictEqual(await mobile.locator('.reorder-ctl').first().isVisible(), false);
  console.log('ok - telefono: Riordina mostra ▲▼, un tocco sposta e salva, Fatto li nasconde');

  await browser.close();
  server.close();
  assert.deepStrictEqual(errors, []);
  console.log('Test riordino superati.');
}

main().catch(function (err) { console.error(err); process.exit(1); });
