// Tapping a notification opens what it's about: the chat for a chat message, the ride for ride news
// and reminders, the live ride for a live ride alert. Works when the tap opened the app too.

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { notificationTarget } from '../domain/notifications';
import type { RootParams } from '../navigation/types';

// A tap is opened once, even if the screens are rebuilt (someone signs in again) and ask again.
const opened = new Set<string>();
// When each tap happened (as far as the app knows: from when it started). A tap made while signed
// out is stale by the time someone signs in, so it's dropped after a few minutes.
const tappedAt = new Map<string, number>();
const FRESH_MS = 5 * 60_000;
function noteTap(r: Notifications.NotificationResponse | null) {
  const id = r?.notification.request.identifier;
  if (id && !tappedAt.has(id)) tappedAt.set(id, Date.now());
}
if (Platform.OS !== 'web') {
  noteTap(Notifications.getLastNotificationResponse());
  Notifications.addNotificationResponseReceivedListener(noteTap);
}

function TapListener() {
  const navigation = useNavigation<NativeStackNavigationProp<RootParams>>();
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    if (opened.has(id)) return;
    opened.add(id);
    Notifications.clearLastNotificationResponseAsync().catch(() => {});
    if (Date.now() - (tappedAt.get(id) ?? Date.now()) > FRESH_MS) return;
    const target = notificationTarget(response.notification.request.content.data);
    if (target) navigation.navigate(target.screen, target.params as never);
  }, [response, navigation]);
  return null;
}

/** Renders nothing. Put it inside the signed-in member's screens. */
export function NotificationTaps() {
  return Platform.OS === 'web' ? null : <TapListener />;
}
