// Ride reminders, set on the phone itself: after every load the phone schedules the reminders the
// plan wants and cancels the rest (an answer changed, a ride moved or was cancelled, reminders turned
// off, someone else signed in). The club sends nothing.

import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { DEFAULT_PREFS, reminderDiff, reminderPlan, type Reminder } from '../domain/notifications';
import { mayAskAutomatically } from '../domain/notifyIntro';
import { useClub } from './ClubStore';
import { ensureChannels } from './notificationChannels';
import { introAnswer, useIntroAnswer } from './notifyIntro';
import { registerThisDevice } from './pushDevice';

const KIND = 'ride-reminder';

// One sync at a time, so two loads in a row can't schedule the same reminder twice.
let syncing: Promise<unknown> = Promise.resolve();

export function syncReminders(plan: Reminder[]): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const next = syncing.then(async () => {
    const scheduled = (await Notifications.getAllScheduledNotificationsAsync())
      .filter((n) => n.content.data?.kind === KIND)
      .map((n) => ({
        id: n.identifier,
        at: String(n.content.data?.at ?? ''),
        body: n.content.body ?? '',
        // Missing on reminders set before the Harley rev: those have the plain sound.
        sound: typeof n.content.data?.sound === 'string' ? n.content.data.sound : undefined,
      }));
    const { add, cancel } = reminderDiff(plan, scheduled);
    for (const id of cancel) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    if (add.length === 0) return;
    // Android 13 only shows the permission prompt once a channel exists.
    await ensureChannels();
    // Ask once; after a no, leave it to the phone's settings rather than asking at every launch.
    // Only after "Turn on notifications" on the explainer card: before that, the card asks.
    let permission = await Notifications.getPermissionsAsync().catch(() => null);
    if (!permission?.granted && permission?.canAskAgain && mayAskAutomatically(await introAnswer())) {
      permission = await Notifications.requestPermissionsAsync().catch(() => null);
    }
    if (!permission?.granted) return;
    for (const r of add) {
      await Notifications.scheduleNotificationAsync({
        identifier: r.id,
        // iPhone plays the notification's sound; Android plays the channel's.
        content: { title: r.title, body: r.body, sound: r.sound, data: { kind: KIND, at: r.at, rideId: r.rideId, sound: r.sound } },
        trigger: { type: SchedulableTriggerInputTypes.DATE, date: new Date(r.at), channelId: r.channelId },
      }).catch(() => {});
    }
  });
  syncing = next.catch(() => {});
  return next;
}

/** Keeps the phone's ride reminders in step with the club data. Renders nothing. */
export function ReminderSync() {
  const { data, me, loading, loadError, isDemo } = useClub();
  const registeredFor = useRef<string | null>(null);
  // Answering the explainer card (or turning notifications on under Me) syncs and signs this phone
  // up again, now that notifications may be on.
  const intro = useIntroAnswer();
  // Undefined: the settings couldn't be read, so leave the phone's reminders as they are.
  const unknown = !!me && data.notificationPrefs === undefined;
  const prefs = data.notificationPrefs ?? DEFAULT_PREFS;
  // Recomputed when the data changes; the time only matters for dropping reminders already past.
  const plan = useMemo(
    () => reminderPlan(data.rides, data.rsvps, me?.id ?? null, prefs, new Date().toISOString(), data.rideCalls),
    [data.rides, data.rsvps, me?.id, prefs, data.rideCalls],
  );
  const key = JSON.stringify(plan.map((r) => [r.id, r.at, r.body, r.sound]));
  useEffect(() => {
    // Until a load finishes (or when it failed with nothing on screen) the plan would wrongly be empty.
    // The demo's rides are made up: no real reminders for them.
    if (loading || loadError || unknown || isDemo) return;
    syncReminders(plan)
      .catch(() => {})
      // After the reminders have asked for notifications: save this phone's push token, once per member.
      .then(() => {
        const once = `${me?.id}:${intro}`;
        if (!me?.id || intro === undefined || registeredFor.current === once) return;
        registeredFor.current = once;
        registerThisDevice();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loading, loadError, unknown, isDemo, intro]);
  // Signed out: the next sign-in registers this phone again, for whoever that is.
  const signedOut = !me && !loading && !isDemo;
  useEffect(() => {
    if (signedOut) registeredFor.current = null;
  }, [signedOut]);
  return null;
}
