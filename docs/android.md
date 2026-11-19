# Android app (phone)

The Android app works anywhere, even away from home: requests to the server are made by the app itself
(no CORS blocking) and video uses the native **ExoPlayer** (MPEG-TS, HLS, MP4, MKV).

**Installation**

1. On the phone open **https://github.com/IlGiurgi/HomeTivu/releases/tag/android-latest**
   and download **HomeTivu.apk**.
2. Open it from the notifications or from *Downloads*. Android will ask you to allow installation
   from this source (browser or file manager): allow it and install.
3. Start **HomeTivu** and sign in with server, username and password.

Updates install over the previous version, without losing favorites or login.

**Server with an invalid certificate**: if you get "Impossibile contattare il server" (cannot reach the server) and,
when opening `https://server:port/player_api.php` in the phone's browser, it says "the connection is not secure",
the provider uses an invalid certificate. At login tick **"Accetta il certificato non valido di questo
server"** (Accept this server's invalid certificate): the exception applies only to that server (other sites stay
verified), is removed on logout or if the login fails, and is shown in *Impostazioni* (Settings). On untrusted networks
(public Wi-Fi) your subscription data is less protected. On the Samsung TV this exception is not possible.

**Usage**: tap to open, scroll with your finger; **long-press** a channel, movie or series to add it to or
remove it from favorites; **swipe right or left** on the list to move to the next or previous category
(the Live TV, Movies, Series… sections are chosen by tapping the tabs at the top); the full-screen player
has controls (pause, forward/back, previous/next channel or episode) and, if you enable it in
*Impostazioni*, on live channels **swiping left or right on the video** changes channel. Android's Back button
goes up inside the app; pressed twice on the main screen it closes the app.

**How it is built**: [Capacitor](https://capacitorjs.com) packages the `app/` folder into the `android/`
project; the `NativePlayer` plugin (`android/app/src/main/java/.../PlayerActivity.java`) opens ExoPlayer.
GitHub Actions builds the APK on every push and publishes it in the `android-latest` release.
To build it locally you need Android Studio (or the Android SDK) and Java 21:

```bash
npm ci
npx cap sync android
cd android && ./gradlew assembleRelease   # -> app/build/outputs/apk/release/app-release.apk
```

The APK is signed with a key included in the repository (`android/app/xtreamtv.keystore`), so updates
install over the previous version. This is fine for a personal app installed by hand,
not for publishing on the Play Store.
