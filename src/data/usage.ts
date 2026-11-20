// App usage counts: the screens this visit goes through and the error messages shown, sent to the
// database in small batches (public.app_usage_record). Nothing about who: the visit id is random,
// made when the app opens and kept only in memory. The demo build sends nothing, and the member can
// switch it off in Me › Notifications and privacy ("Help improve the app"). Rules in src/domain/appUsage.ts.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { USAGE_FLUSH_MS, UsageQueue, focusedRouteName, type NavStateLike } from '../domain/appUsage';
import { newClientRef } from '../domain/shopCart';
import { noticeErrors } from '../ui/primitives';
import { liveDataOn } from './reviewMode';
import { supabase } from './supabase';

const OFF_KEY = 'rustnuts.usage-off';
const visitId = newClientRef();
const queue = new UsageQueue();
let currentScreen = 'Start';
let sending = false;
let started = false;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Read the member's saved choice once, as the app opens (on unless they switched it off). */
AsyncStorage.getItem(OFF_KEY)
  .then((v) => {
    queue.enabled = v !== '1';
    notify();
  })
  .catch(() => undefined);

/** Called by the NavigationContainer on every change: counts the screen now showing. */
export function usageScreenChanged(state: NavStateLike | undefined): void {
  const name = focusedRouteName(state);
  if (!name) return;
  currentScreen = name;
  if (liveDataOn()) queue.screen(name);
}

/** Called when an error message is shown (Notice tone "danger"): counts it against this screen. */
export function usageErrorShown(message: string): void {
  if (liveDataOn()) queue.error(currentScreen, message);
}
noticeErrors.report = usageErrorShown;

async function flush(): Promise<void> {
  if (sending || !liveDataOn()) return;
  const batch = queue.take();
  if (!batch.length) return;
  sending = true;
  try {
    const db = supabase() as unknown as SupabaseClient;
    // A failed send is dropped: these are a guide for the board, never worth a retry loop or a word to the member.
    await db.rpc('app_usage_record', {
      p_visit: visitId,
      p_platform: Platform.OS,
      p_version: Constants.expoConfig?.version ?? '',
      p_events: batch,
    });
  } catch {
    // dropped
  } finally {
    sending = false;
  }
}

/** Starts the 30-second send and the send on going to the background. Once per app run. */
export function useUsageSender(): void {
  useEffect(() => {
    if (started) return;
    started = true;
    const timer = setInterval(() => void flush(), USAGE_FLUSH_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') void flush();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
      started = false;
    };
  }, []);
}

/** The member's "Help improve the app" switch. */
export function useUsageSharing(): { on: boolean; set(on: boolean): void } {
  const on = useSyncExternalStore(subscribe, () => queue.enabled);
  return {
    on,
    set(next: boolean) {
      queue.enabled = next;
      if (!next) queue.clear();
      notify();
      AsyncStorage.setItem(OFF_KEY, next ? '0' : '1').catch(() => undefined);
    },
  };
}
