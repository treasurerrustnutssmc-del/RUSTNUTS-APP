// This phone's Expo push token, saved with the club on sign-in so pushes can reach it (once they're
// switched on), and removed on sign-out. It only runs where notifications are already allowed (ride
// reminders ask), and any failure is ignored: Android can't get a token until the app has its
// Firebase project, which comes with launch.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { ensureChannels } from './notificationChannels';
import { supabase } from './supabase';

const KEY = 'push.token';

export async function registerThisDevice(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    // Pushes name their channel; it has to exist on the phone before one arrives.
    await ensureChannels();
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    const { error } = await supabase().rpc('register_push_device', { p_token: token, p_platform: Platform.OS });
    if (!error) await AsyncStorage.setItem(KEY, token);
  } catch {
    // No token yet; try again next time.
  }
}

/** Removes this phone from the club's list. Gives up after 3 seconds so sign-out never hangs; the
 *  token is then kept on the phone and removed next time the app opens signed out. */
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
