// Capacitor configuration for compiling Senda into an Android .apk / Google Play .aab
// After installing Capacitor locally (`npm i @capacitor/core @capacitor/cli @capacitor/android`),
// update `server.url` below to your published Senda backend URL.

const config = {
  appId: 'app.senda.transfer',
  appName: 'Senda',
  webDir: 'dist',
  server: {
    // Point the Android app to your live Senda backend so WebSocket signaling & accounts sync across devices
    url: 'https://ais-pre-4y2jiuwmta4pj6mpnsngwt-646622080348.asia-southeast1.run.app',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
