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

function TapListener() {
  const navigation = useNavigation<NativeStackNavigationProp<RootParams>>();
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    if (opened.has(id)) return;
    opened.add(id);
    Notifications.clearLastNotificationResponseAsync().catch(() => {});
    const target = notificationTarget(response.notification.request.content.data);
    if (target) navigation.navigate(target.screen, target.params as never);
  }, [response, navigation]);
  return null;
}

/** Renders nothing. Put it inside the signed-in member's screens. */
export function NotificationTaps() {
  return Platform.OS === 'web' ? null : <TapListener />;
}
