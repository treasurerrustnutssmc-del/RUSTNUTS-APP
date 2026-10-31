// Sets up the phone's Android notification channels (src/domain/notifications.ts, ANDROID_CHANNELS).
// Android fixes a channel's sound once it's made, so the Harley rev and the plain sound each have
// their own channel, and the setting picks which one a notification uses. iPhone has no channels: the
// sound goes on each notification instead.

import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { ANDROID_CHANNELS, RETIRED_ANDROID_CHANNELS } from '../domain/notifications';

let made: Promise<void> | null = null;

/** Safe to call often: the channels are made once per app start. */
export function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  made ??= (async () => {
    let failed = false;
    for (const c of ANDROID_CHANNELS) {
      await Notifications.setNotificationChannelAsync(c.id, {
        name: c.name,
        importance: c.urgent ? AndroidImportance.MAX : AndroidImportance.DEFAULT,
        // Left out for the phone's own sound: a name is looked up as a bundled file.
        ...(c.sound === 'default' ? {} : { sound: c.sound }),
        ...(c.urgent ? { vibrationPattern: [0, 400, 200, 400] } : {}),
      }).catch(() => {
        failed = true;
      });
    }
    // The first rev's channels (once the new ones exist): gone from the phone's settings, so nobody picks the old sound there.
    if (!failed) for (const id of RETIRED_ANDROID_CHANNELS) await Notifications.deleteNotificationChannelAsync(id).catch(() => {});
    if (failed) made = null; // try again next time
  })();
  return made;
}
