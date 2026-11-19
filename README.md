<p align="center">
  <img src="app/hometivu.png" width="110" alt="HomeTivu logo">
</p>

<h1 align="center">HomeTivu</h1>

<p align="center">
  <b>Your Xtream Codes IPTV on Samsung TV, Android phone and browser.</b><br>
  Live TV with guide, movies, series and favorites, with a remote or a finger.
</p>

<p align="center">
  <a href="https://github.com/IlGiurgi/App-tv/actions/workflows/ci-pages.yml"><img src="https://github.com/IlGiurgi/App-tv/actions/workflows/ci-pages.yml/badge.svg" alt="Build"></a>
  <img src="https://img.shields.io/badge/Samsung%20Tizen-3.0%2B-1428A0?logo=samsung&logoColor=white" alt="Tizen 3.0+">
  <img src="https://img.shields.io/badge/Android-APK-3DDC84?logo=android&logoColor=white" alt="Android">
  <a href="https://github.com/IlGiurgi/App-tv/releases"><img src="https://img.shields.io/github/v/release/IlGiurgi/App-tv?include_prereleases&label=release" alt="Release"></a>
</p>

> 🇮🇹 The app's interface is in Italian. This documentation is in English; menu and screen names are
> given as they appear in the app, with a translation where needed.

---

## Why HomeTivu
One codebase, three versions: the same app runs on the **Samsung TV** (native AVPlay player), on the
**Android phone** (ExoPlayer) and in the **PC browser**. Enter the server, username and password of your
**Xtream Codes** subscription and you are done. **No cloud, no account, no ads**: your data stays on your device.

## Features

| | |
|---|---|
| 📺 **Live TV** | Categories, channels with logos, "now / next" EPG, zapping with ▲/▼ or CH+/CH−, direct channel number from the remote. |
| 🗓️ **TV guide** | Grid of the next 3 hours for all channels in a category. OK on a program opens the channel. |
| 🎬 **Movies and series** | Posters, plot and rating, **resume where you left off**, automatic jump to the next episode. |
| ⭐ **Favorites and search** | RED key for favorites, search across channels, movies and series. |
| ⚽ **Your matches** ("Le tue partite") | Type teams, drivers or tournaments: the app looks for them in the guide and warns you 10 minutes before. |
| 🛟 **Channels that don't freeze** | If a stream stops it is reopened automatically, switching to alternative feeds of the same channel (BLUE key to switch by hand). |
| 😴 **Timer and inactivity** | On the TV, ⏯ while watching a channel sets a sleep timer (30-120 min); after hours without key presses it asks "Are you still watching?" ("Stai ancora guardando?") and stops playback. |
| 🏠 **Home Assistant** | On the TV: a "Casa" (Home) tab with scenes, lights, cameras and the channel in a small window, plus a `sensor.hometivu_<model>` sensor for automations, scenes at the start and end of movies and matches, and alert pop-ups for doorbell, door and smoke. |
| 🖼️ **Tile home screen** | Large start screen with a Live TV preview, favorites, guide, movies, series, home and search. |
| 🔒 **Private** | Credentials stay in the device's local storage. |

## Getting started

| Platform | What you need | Guide |
|---|---|---|
| **Samsung TV** (Tizen 3.0+, 2017 onwards) | A PC with Tizen Studio and a TV in developer mode | [docs/tv.md](docs/tv.md) |
| **Android** | Download the APK from the [`android-latest` release](https://github.com/IlGiurgi/App-tv/releases/tag/android-latest) | [docs/android.md](docs/android.md) |
| **Browser** | Nothing to install: <https://ilgiurgi.github.io/App-tv/> | [docs/web.md](docs/web.md) |

Once the TV and the certificate are set up (one time only), every update on the TV is a single command:

```powershell
scripts\install-tv.ps1 -Tv 192.168.86.54 -Profile TiptOld     # Windows
scripts/install-tv.sh 192.168.86.54 TiptOld                    # macOS / Linux
```

On first launch enter the **server** (e.g. `http://servername.com:8080`, or paste the full M3U playlist link),
the **username** and the **password**. The account is remembered.

### Tips
- If a channel does not start: *Impostazioni → Formato canali live* (Settings → Live channel format) and try HLS (m3u8) instead of MPEG-TS, or vice versa.
- "Impossibile contattare il server" (cannot reach the server): check the address, including `http://` and the port, and that the device is online.
- Outdated lists: *Impostazioni → Ricarica liste dal server* (Settings → Reload lists from the server).
- TV and phone together count as two connections on your subscription.
- Install error 118 on the TV: see [docs/tv.md](docs/tv.md#if-the-installation-fails).

## Remote control keys

| Key | Navigation | During playback |
|---|---|---|
| Arrows | move around | Live: ▲/▼ changes channel · Movies: ◀ −10s, ▶ +30s |
| OK | open / select / type in the field | show info · Movies: pause |
| BACK | goes up: list → categories → tabs; twice to exit | closes the player |
| CH+ / CH− | — | change channel |
| 0–9 | — | go to the channel with that number |
| ⏯ ⏩ ⏪ ⏹ | — | pause, ±60s, stop |
| RED | add/remove favorite | add/remove favorite |
| YELLOW | — | reload the stream |
| BLUE | — | Live: switch to another feed of the same channel |

## How it works
It is plain HTML, CSS and JavaScript (ES2015, compatible with the Chromium 47 found in 2017 TVs), with no build step.
The Xtream client talks to `player_api.php`; on the TV the video goes through **AVPlay**, on Android through
**ExoPlayer** via [Capacitor](https://capacitorjs.com), in the browser through
[mpegts.js](https://github.com/xqq/mpegts.js) and [hls.js](https://github.com/video-dev/hls.js).
GitHub Actions runs lint and tests on every push and, from the `main` branch, publishes the APK, the TV source zip
and the website.

## Development
```bash
npm install     # only needed for lint and tests
npm run dev     # dev server with a fake Xtream server at http://localhost:8080 (demo / demo)
npm run lint && npm test && npm run test:e2e
```
Details, folder structure and the Android build are in [docs/sviluppo.md](docs/sviluppo.md).
A second, separate app: [SitoTV](sitotv/README.md), a full-screen website on the TV.

## Contributing
Reports and ideas are welcome in [Issues](https://github.com/IlGiurgi/App-tv/issues): please include the TV or phone
model and what happened.

## Notes
- The app is just a player: use it with legitimate IPTV subscriptions.
- The APK signing key (`android/app/xtreamtv.keystore`) is public in the repository: fine for a personal app installed
  by hand, not for the Play Store.
- Independent project, not affiliated with Samsung, Google, Home Assistant or any IPTV provider.
