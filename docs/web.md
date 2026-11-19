# Web version (browser on the PC)

The same app is published on GitHub Pages: **https://ilgiurgi.github.io/HomeTivu/**

- Sign in with the same details as on the TV. Credentials stay **only in your browser** (localStorage):
  the public page contains no personal data.
- Use it with the mouse (click, wheel, "← Indietro" (Back) button; double-click on the video = full screen)
  or with the keyboard (arrows, Enter, Esc).
- MPEG-TS channels are played with [mpegts.js](https://github.com/xqq/mpegts.js), HLS ones with
  [hls.js](https://github.com/video-dev/hls.js): they are downloaded from the jsDelivr CDN only in the browser, never on the TV.

Browser limitations that do not exist on the TV:

- the IPTV server must allow requests from other sites (**CORS**). If you see the error
  "il server blocca le richieste dal browser" (the server blocks requests from the browser), the provider does not allow it: use the app on the TV;
- an https page cannot load http content: if the server or the video streams are `http://`, the browser blocks them;
- some MKV movies or ones with AC3/EAC3 audio cannot be played by Chrome;
- if a channel does not start try *Impostazioni → Formato canali live → HLS* (Settings → Live channel format → HLS);
- PC and TV together count as two connections on your subscription.

**Publishing**: the `.github/workflows/ci-pages.yml` workflow runs lint and tests on every push and, on the
default branch, publishes the `app/` folder. The first time, GitHub Pages must be enabled:
*Settings → Pages → Build and deployment → Source: **GitHub Actions***.
