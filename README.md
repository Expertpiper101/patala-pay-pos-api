# Simple POS Local Web Suite

This folder contains the local API plus helper scripts for running the web admin and storefront in the background on Windows.

## Hosted API testing

The API can be deployed to Vercel for online PayFast/webstore testing.

Set these Vercel environment variables:

```text
PUBLIC_API_URL=https://patala-pay-pos-api.vercel.app
PUBLIC_STORE_URL=https://patala-pay-webstore.vercel.app
SIMPLE_POS_ALLOWED_ORIGINS=https://patala-pay-webstore.vercel.app
PAYFAST_MODE=sandbox
PAYFAST_MERCHANT_ID=10000100
PAYFAST_MERCHANT_KEY=46f0cd694581a
PAYFAST_PASSPHRASE=
PAYFAST_REQUIRE_SIGNATURE=0
```

The hosted Vercel API uses temporary serverless file storage, so it is for integration testing only. Use persistent database storage before taking real customer orders.

## Client install data path

The API now reads POS data from:

- `%APPDATA%\SimplePythonPOS\data\pos.db`

That matches the installed Windows POS app, so another machine does not need hard-coded project paths.

Optional overrides:

- `SIMPLE_POS_DATA_DIR`
- `SIMPLE_POS_DB_PATH`
- `SIMPLE_POS_BACKUP_DIR`

## Background startup

Use these scripts from this folder:

- `build-local-suite.ps1`
  - rebuilds the admin and storefront production files
- `build-web-update-package.ps1`
  - packages a client-safe update zip for the local API, admin, and storefront
- `start-local-suite.ps1`
  - starts the API on `127.0.0.1:8090`
  - starts the admin static site on `127.0.0.1:8083`
  - starts the storefront static site on `127.0.0.1:8084`
  - forces the API to use `%APPDATA%\SimplePythonPOS\data\pos.db`
  - stores logs and pid files in `%APPDATA%\SimplePythonPOS\local-web-suite`
- `start-local-suite-dev.ps1`
  - developer-only helper
  - forces the API to use the project database in `simple-python-pos\data\pos.db`
  - do not use this on a client machine
- `stop-local-suite.ps1`
  - stops the managed local web processes
- `install-local-suite-startup.ps1`
  - installs a Startup-folder launcher so the local web suite starts automatically when the user signs in

## Recommended install flow on another machine

1. Install the desktop POS app first.
2. Confirm the POS opens and creates `%APPDATA%\SimplePythonPOS`.
3. If you are not using the bundled portable Node runtime, install Node.js.
4. Copy the three web folders:
   - `simple-python-pos-api`
   - `simple-python-pos-web`
   - `simple-python-pos-storefront`
5. In `simple-python-pos-api`, run:

```powershell
.\build-local-suite.ps1
.\install-local-suite-startup.ps1
.\start-local-suite.ps1
```

6. Open:
   - `http://127.0.0.1:8083` for admin
   - `http://127.0.0.1:8084` for storefront

If `simple-python-pos-api\runtime\node-x86\node.exe` is present, the local web suite will use it automatically and no system Node.js install is required.

## Notes

- The Startup-folder launcher starts the suite automatically when the Windows user signs in.
- This is the safest option because it runs with the same user profile and `%APPDATA%` location as the installed POS app.
- If the client should never see terminal windows, keep using the startup script instead of `npm run dev`.
- For client installs, always use `start-local-suite.ps1`.
- Use `start-local-suite-dev.ps1` only on your own development machine when you intentionally want the web admin to share the project test database.

## Create a local web suite update package

After refreshing the web builds, create a client update package:

```powershell
cd "C:\Users\Mr C\Desktop\Projects\simple-python-pos-api"
.\build-web-update-package.ps1
```

Expected output:

- `C:\Users\Mr C\Desktop\Projects\simple-python-pos-web-update.zip`

That zip contains `Update-SimplePythonPOS-WebSuite.ps1`, which updates the copied web admin/storefront files on a client machine and restarts the local web suite.
