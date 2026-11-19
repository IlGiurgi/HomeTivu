# Installing on a Samsung TV

Apps that do not come from the store are installed in **developer mode**. You need a PC
(Windows, macOS or Linux) connected to the **same network** as the TV.

### 1. Install Tizen Studio

1. Download and install [Tizen Studio](https://developer.tizen.org/development/tizen-studio/download)
   (the "with IDE" version is the simplest).
2. Open the **Package Manager** and install:
   - *Main SDK* tab: **Tizen SDK tools**
   - *Extension SDK* tab: **TV Extensions** (latest version) and **Samsung Certificate Extension**

### 2. Enable developer mode on the TV

1. On the TV open **Apps**.
2. Type **1 2 3 4 5** with the remote (or the on-screen keypad): the *Developer mode* window appears.
3. Set it to **On** and enter the **IP address of the PC**.
4. Turn the TV off and on again (hold the power button until it restarts).
5. Note the TV's IP address (*Settings → General → Network → Network Status → IP Settings*).

### 3. Connect the TV to Tizen Studio

In Tizen Studio: **Tools → Device Manager → Remote Device Manager → +**, enter a name and the TV's IP
(port 26101) and turn on the connection. From the command line this is equivalent to:

```bash
sdb connect 192.168.1.50   # the TV's IP
sdb devices                # the TV must appear
```

### 4. Create the Samsung certificate

**Tools → Certificate Manager → +** → **Samsung** → **TV** → create a new profile.
Sign in with a Samsung account; when it asks for the device DUID, keep the one of the connected TV
(it is filled in automatically). The certificate only works for the TVs listed in it.

### 5. Build and install

**From Tizen Studio**: *File → Import → Tizen → Tizen Project*, select the `app/` folder of this
repository, then right-click the project → **Run As → Tizen Web Application**.

**With the script** (recommended: it starts from a clean copy of the repository, so nothing stale is left over that
makes the install fail with error 118, and it relaunches the app on the TV at the end):

```powershell
scripts\install-tv.ps1 -Tv 192.168.86.54 -Profile PROFILE_NAME      # Windows
scripts/install-tv.sh 192.168.86.54 PROFILE_NAME                     # macOS / Linux
```

For SitoTV add `-What sitotv` (Windows) or `sitotv` as the third argument (macOS / Linux).

**By hand**: `tizen package -t wgt -s PROFILE_NAME -- app`, then rename the `.wgt` without spaces,
`tizen install -n HomeTivu.wgt -s TV_IP:26101` and `tizen run -p XtrmIPTVtv.XtreamTV -s TV_IP:26101`.
Delete the `app/.buildResult` folder first, if it exists.

### 6. First launch

Enter the details provided by your IPTV provider:

- **Server**: e.g. `http://servername.com:8080`. You can also paste the full M3U playlist link (`…/get.php?username=…&password=…`): username and password are filled in automatically
- **Username** and **Password**

The account is remembered: on later launches you go straight in.


## If the installation fails

- **Error 118 (at about 22%)**: either the Samsung certificate is not accepted by the TV (it happens with some 2017
  models: use a profile with a generic developer certificate), or a stale `.buildResult` folder ended up in the package.
  The `install-tv.sh` / `install-tv.ps1` script avoids the second case.
- **`sdb devices` does not show the TV**: run `sdb connect TV_IP:26101` again (the VS Code Tizen extension restarts sdb).
- **Developer mode not applied**: unplug the TV from the power outlet for about 30 seconds.
