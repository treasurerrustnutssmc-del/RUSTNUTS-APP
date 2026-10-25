// Sets up the phone's Android notification channels (src/domain/notifications.ts, ANDROID_CHANNELS).
// Android fixes a channel's sound once it's made, so the Harley rev and the plain sound each have
// their own channel, and the setting picks which one a notification uses. iPhone has no channels: the
// sound goes on each notification instead.

import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { ANDROID_CHANNELS } from '../domain/notifications';

let made: Promise<void> | null = null;

/** Safe to call often: the channels are made once per app start. */
export function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  made ??= (async () => {
    for (const c of ANDROID_CHANNELS) {
      await Notifications.setNotificationChannelAsync(c.id, {
        name: c.name,
        importance: c.urgent ? AndroidImportance.MAX : AndroidImportance.DEFAULT,
        sound: c.sound,
        ...(c.urgent ? { vibrationPattern: [0, 400, 200, 400] } : {}),
      }).catch(() => {});
    }
  })();
  return made;
}
