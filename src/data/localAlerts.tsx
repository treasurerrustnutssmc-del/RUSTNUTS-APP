// Ride change alerts the phone shows itself (src/domain/localAlerts.ts): after every load, any alert
// this phone hasn't shown yet goes up straight away, and its id is kept so it never shows twice.
// It doesn't ask for notifications (the ride reminders do that); without permission it does nothing.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { localAlerts, type LocalAlert } from '../domain/localAlerts';
import { DEFAULT_PREFS } from '../domain/notifications';
import { useClub } from './ClubStore';

const KIND = 'ride-change';
/** Enough to cover a day's alerts; the oldest ids drop off. */
const KEEP = 200;
const seenKey = (memberId: string) => `rustnuts.localAlerts.${memberId}`;

let showing: Promise<unknown> = Promise.resolve();

export function showNewAlerts(memberId: string, alerts: LocalAlert[]): Promise<void> {
  if (Platform.OS === 'web' || alerts.length === 0) return Promise.resolve();
  const next = showing.then(async () => {
    const raw = await AsyncStorage.getItem(seenKey(memberId)).catch(() => null);
    let seen: string[] = [];
    try {
      seen = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      seen = [];
    }
    const fresh = alerts.filter((a) => !seen.includes(a.id));
    if (fresh.length === 0) return;
    const permission = await Notifications.getPermissionsAsync().catch(() => null);
    if (!permission?.granted) return;
    for (const a of fresh) {
      await Notifications.scheduleNotificationAsync({
        content: { title: a.title, body: a.body, data: { kind: KIND, rideId: a.rideId } },
        trigger: null,
      }).catch(() => {});
    }
    await AsyncStorage.setItem(seenKey(memberId), JSON.stringify([...seen, ...fresh.map((a) => a.id)].slice(-KEEP))).catch(() => {});
  });
  showing = next.catch(() => {});
  return next;
}

/** Shows new swap asks, swap answers and ride calls as phone alerts. Renders nothing. */
export function LocalAlertSync() {
  const { data, me, loading, loadError, isDemo } = useClub();
  const prefs = data.notificationPrefs ?? DEFAULT_PREFS;
  const alerts = useMemo(
    () => localAlerts(data, me?.id ?? null, prefs, new Date().toISOString()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.crewSwaps, data.rideCalls, data.rsvps, data.rides, me?.id, prefs],
  );
  const key = alerts.map((a) => a.id).join('|');
  useEffect(() => {
    // The demo's club is made up: no real alerts for it.
    if (loading || loadError || isDemo || !me) return;
    showNewAlerts(me.id, alerts).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loading, loadError, isDemo, me?.id]);
  return null;
}
