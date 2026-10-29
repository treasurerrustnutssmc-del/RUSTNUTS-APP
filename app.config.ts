// Adds what app.json can't hold: the Android Google Maps key, read from the EAS environment
// variable GOOGLE_MAPS_ANDROID_KEY at build time so it never sits in the repo. Without it the
// Android build still works, and its ride maps fall back to the drawn route shape.

import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const key = process.env.GOOGLE_MAPS_ANDROID_KEY?.trim();
  const base = config as ExpoConfig;
  if (!key) return { ...base, extra: { ...base.extra, androidMaps: false } };
  return {
    ...base,
    android: { ...base.android, config: { ...base.android?.config, googleMaps: { apiKey: key } } },
    extra: { ...base.extra, androidMaps: true },
  };
};
