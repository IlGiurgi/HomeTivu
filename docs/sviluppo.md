# Development

No build is needed: it is plain HTML/CSS/JavaScript, written in ES2015 compatible with Chromium 47 (Tizen 3.0).

```bash
npm install          # only for lint and tests (eslint, playwright)
npm run dev          # dev server with a fake Xtream server
```

Open <http://localhost:8080> and sign in with server `http://localhost:8080`, username `demo`, password `demo`.
In the browser you navigate with the keyboard: arrows, Enter = OK, Esc/Backspace = BACK, F1 = RED, F3 = YELLOW, F4 = BLUE, PageUp/PageDown = CH+/CH−.
The fake video streams cannot be played in the browser: real playback has to be tested on the TV.

```bash
npm run lint         # also checks for syntax not supported by older TVs
npm test             # unit tests (Xtream client, storage)
npm run test:e2e     # end-to-end tests in Chromium: remote, simulated AVPlay, mouse, web player, simulated Android app
node dev/icon/render.js  # regenerates icons (TV and Android) and splash from dev/icon/hometivu.svg
```

### Structure

```
app/                      Tizen project (this is the folder to import/package)
  config.xml              Tizen manifest (app id, privileges, tv-samsung profile)
  index.html
  css/style.css           1920x1080 layout
  js/xtream.js            Xtream Codes API client (player_api.php)
  js/storage.js           account, favorites, resume positions (localStorage)
  js/keys.js              remote control keys
  js/nav.js               spatial navigation with the arrow keys
  js/player.js            AVPlay on the TV, <video> in the browser
  js/app.js               screen stack, session, cache
  js/platform.js          TV / Android app / browser
  js/pointer.js           mouse and touch support
  js/screens/*.js         login, home, detail, player
android/                  Android project (Capacitor) with the native ExoPlayer player
dev/mock-server.js        fake Xtream server + static server for development
tests/                    unit and end-to-end tests
```
