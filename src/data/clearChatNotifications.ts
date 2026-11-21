// Clears a chat's notification from the phone once it's been read in the app, as Messenger does.
// Best effort: a phone that can't list what it's showing just keeps it until it's swiped or tapped.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { chatNotificationsToClear } from '../domain/notifications';

export async function clearChatNotifications(chatId: string): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    const ids = chatNotificationsToClear(
      shown.map((n) => ({ id: n.request.identifier, data: n.request.content.data as Record<string, unknown> | null })),
      chatId,
    );
    await Promise.all(ids.map((id) => Notifications.dismissNotificationAsync(id)));
  } catch {
    // Nothing to do: the notification stays.
  }
}
