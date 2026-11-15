// This phone's Expo push token, saved with the club on sign-in so pushes can reach it, and removed on
// sign-out. Notifications are on by default: the first sign-in on a phone brings up the phone's own
// prompt, once. Any failure is ignored and tried again at the next sign-in or app start.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { mayAskAutomatically } from '../domain/notifyIntro';
import { ensureChannels } from './notificationChannels';
import { introAnswer, setIntroAnswer } from './notifyIntro';
import { supabase } from './supabase';

const KEY = 'push.token';
const ASKED = 'push.asked';

let asking: Promise<Notifications.NotificationPermissionsStatus | null> | null = null;

/** Brings up the phone's notifications prompt and keeps the answer, so a no isn't asked again by
 *  itself. The push sign-up and the ride reminders share one prompt: a second ask while it's up waits
 *  for the same answer. Null when the prompt couldn't come up. */
export function askForNotifications(): Promise<Notifications.NotificationPermissionsStatus | null> {
  asking ??= Notifications.requestPermissionsAsync()
    .catch(() => null)
    .then(async (p) => {
      // A yes syncs the ride reminders again (they were skipped while the answer was open).
      if (p) await setIntroAnswer(p.granted ? 'on' : 'later');
      return p;
    })
    .finally(() => {
      asking = null;
    });
  return asking;
}

export async function registerThisDevice(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  try {
    // Pushes name their channel, so it has to exist before one arrives (and Android 13 only asks for
    // notifications once a channel exists).
    await ensureChannels();
    let permission = await Notifications.getPermissionsAsync();
    // Ask once, so chat can reach every member, not just those going to a ride. After a no it's up to
    // Me, Notifications or the phone's settings (on Android a second no is final).
    if (!permission.granted && permission.canAskAgain && mayAskAutomatically(await introAnswer()) && !(await AsyncStorage.getItem(ASKED))) {
      await AsyncStorage.setItem(ASKED, '1');
      const answer = await askForNotifications();
      if (!answer) return;
      permission = answer;
    }
    if (!permission.granted) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    const { error } = await supabase().rpc('register_push_device', { p_token: token, p_platform: Platform.OS });
    if (!error) await AsyncStorage.setItem(KEY, token);
  } catch {
    // No token yet; try again next time.
  }
}

/** Removes this phone from the club's list, while still signed in (only the owner may). Gives up
 *  after 3 seconds so sign-out never hangs; the phone then stays listed until the next sign-in
 *  on it registers it again, for whoever that is. */
export async function forgetThisDevice(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(KEY);
    if (!token) return;
    const timeout = new Promise<{ error: Error }>((resolve) => setTimeout(() => resolve({ error: new Error('Timed out') }), 3_000));
    const { error } = await Promise.race([supabase().rpc('forget_push_device', { p_token: token }), timeout]);
    if (!error) await AsyncStorage.removeItem(KEY);
  } catch {
    // Kept for next time.
  }
}
