# SitoTV — a full-screen website

The `sitotv/` folder contains a second app, separate from HomeTivu (id `SitoTVview.SitoTV`), that opens
a website of your choice full screen.

- On first launch type the address (OK on the field opens the keyboard, OK again to open the site).
- On later launches the site opens by itself after 4 seconds; during that time OK or RED
  lets you change the address.
- The site fills the whole app window, so arrows, OK and BACK go straight to the page.
  How they behave depends on the site. EXIT or HOME always close the app.

It is installed like HomeTivu, starting from the `sitotv` folder:

```bash
cd sitotv
tizen package -t wgt -s TiptOld
tizen install -n SitoTV.wgt -t <device-name>
tizen run -p SitoTVview.SitoTV -t <device-name>
```
