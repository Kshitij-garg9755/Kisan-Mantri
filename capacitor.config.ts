import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: 'com.kisanmantri.app',
  appName: 'Kisan Mantri',
  webDir: 'frontend',
  server: {
    ...(serverUrl ? { url: serverUrl } : {}),
    cleartext: true,
    androidScheme: 'http',
  },
  plugins: {
    FirebaseAuthentication: {
      providers: ['phone'],
      skipNativeAuth: false,
    },
  },
};

export default config;
