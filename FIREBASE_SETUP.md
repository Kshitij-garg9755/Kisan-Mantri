# Firebase phone OTP and Android publishing

The native Android app can use Firebase phone authentication. The production browser app now uses Gmail/password authentication through Netlify Functions; Firebase phone login is not enabled in that backend. The older Flask local-development server still contains its Firebase phone flow.

## Firebase project

1. In Firebase Console, enable **Authentication → Sign-in method → Phone** and allow SMS to India in the SMS region policy.
2. Register Android package `com.kisanmantri.app` and add these debug signing fingerprints:

   - SHA-1: `8A:A4:2D:17:E8:9A:05:E5:99:E2:A9:7C:58:A5:9F:E9:5D:FE:5A:EA`
   - SHA-256: `30:02:3C:FB:8E:93:E4:D3:A0:63:6A:56:C9:5E:D0:02:4E:E0:BE:5C:08:30:41:36:AF:E5:D0:6E:68:E0:EE:81`

   Download `google-services.json` to `android/app/google-services.json`. These fingerprints are for this PC's debug key. A release key and the Play App Signing certificate need their own fingerprints added before store release.
3. Register a Web app in the same Firebase project. Put its `apiKey`, `authDomain`, `projectId`, `messagingSenderId`, and `appId` into matching `FIREBASE_*` fields in local `.env`.
4. Create a Firebase Admin service-account key and store it privately at `.local-dev/firebase-admin.json`. Set `GOOGLE_APPLICATION_CREDENTIALS=.local-dev/firebase-admin.json` and keep its project ID equal to `FIREBASE_PROJECT_ID`. Never commit or send this file in chat.
5. For browser OTP, add the public website hostname to Firebase Authentication's authorized domains and serve it over HTTPS.

## Phone app and release

For the browser app, use the Netlify site's public HTTPS URL. Netlify serves the static frontend and runs its API Functions, so the laptop does not need to stay on. Set `CAPACITOR_SERVER_URL` to the Netlify site's HTTPS URL before building the store version. A PC LAN address is only for local Flask development and requires that PC to remain running and reachable.

```powershell
pip install -r requirements.txt
npm install
npm run build:auth
$env:CAPACITOR_SERVER_URL = 'https://<your-app-domain>'
npx cap sync android
Push-Location android
.\gradlew.bat signingReport
.\gradlew.bat bundleRelease
Pop-Location
```

`bundleRelease` requires a release signing key configured in Gradle. Do not use the debug key for a Play Store release. Keep the signing key and passwords backed up privately.

For an on-device debug build over a PC LAN, set `CAPACITOR_SERVER_URL` to the PC's reachable LAN IP and keep Flask running; the phone and PC must be on the same network. Configured Firebase test phone numbers can test the flow without sending SMS.
