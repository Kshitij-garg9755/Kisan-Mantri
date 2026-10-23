# Deploy Smart Farm on Render

The Render Blueprint in `render.yaml` creates a Python web service in Singapore, attaches a 1 GB persistent disk at `/var/data`, and stores the app database and uploaded files there. It binds Gunicorn to Render's `$PORT` and disables demo OTP on the public service.

## Before creating the service

1. Put this project in a GitHub repository. `.env`, local databases, farmer records, uploaded media, and Firebase private credentials are excluded from Git.
2. Set up Firebase phone sign-in. Follow `FIREBASE_SETUP.md`; the hosted website domain must be authorized in Firebase.
3. In Render, connect the GitHub repository and create a Blueprint from its `render.yaml`.
4. When prompted, enter the five `FIREBASE_*` web configuration values. In the service's **Secret Files**, add the Firebase Admin service-account JSON as `/etc/secrets/firebase-admin.json`. Keep this key private; do not put it in Git or chat.
5. Deploy and wait for the health check to pass at `/api/marketplace/health`. Render will provide an HTTPS `onrender.com` address; share that address for phone browsers.

The Blueprint sets `GOOGLE_APPLICATION_CREDENTIALS` to the Secret File and sets `KISAN_MANTRI_DEMO_AUTH=false`. Real Firebase phone authentication must be configured before users can log in. The public service will not accept the local demo OTP.

## Cost and storage

The Blueprint uses Render's paid Starter web-service plan plus a 1 GB persistent disk. Render requires a paid web service for a persistent disk; disk storage is currently $0.25 per GB per month, in addition to the service's compute charge. Check Render's [current pricing](https://render.com/pricing) before creating the service. The Singapore region is selected for users in India and cannot be changed after the service is created.

The database and uploaded media are stored under `/var/data`, which survives deploys and restarts. Keep one service instance: Render disks are attached to one instance and cannot be shared when scaling horizontally.

## Android app

The browser app works from the Render HTTPS address. To make the installed Capacitor app use the cloud server, build it with that address:

```powershell
npm run build:auth
$env:CAPACITOR_SERVER_URL = 'https://<your-service>.onrender.com'
npx cap sync android
Push-Location android
.\gradlew.bat assembleDebug
Pop-Location
```

Install `android\app\build\outputs\apk\debug\app-debug.apk` on each phone. A Play Store release also needs a release signing key and its own Firebase signing fingerprints.

## Existing local data

Render starts with a new database and empty uploads folder. The laptop's `smart_farm.db`, `agriverse_uploads`, and other local data are not copied automatically. Back them up and migrate them to `/var/data` before users start creating cloud data if you need to preserve the current records.
