// This phone's Expo push token, saved with the club on sign-in so pushes can reach it (once they're
// switched on), and removed on sign-out. It only runs where notifications are already allowed (ride
// reminders ask), and any failure is ignored: Android can't get a token until the app has its
// Firebase project, which comes with launch.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const KEY = 'push.token';

export async function registerThisDevice(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    const { error } = await supabase().rpc('register_push_device', { p_token: token, p_platform: Platform.OS });
    if (!error) await AsyncStorage.setItem(KEY, token);
  } catch {
    // No token yet; try again next time.
  }
}

export async function forgetThisDevice(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(KEY);
    if (!token) return;
    await supabase().rpc('forget_push_device', { p_token: token });
    await AsyncStorage.removeItem(KEY);
  } catch {
    // With no signal the token stays with the club; the next person to sign in here takes it over.
  }
}
