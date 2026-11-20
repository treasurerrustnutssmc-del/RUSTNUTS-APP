// App usage counts: the screens this visit goes through and the kind of each error shown, sent to
// the database in small batches (public.app_usage_record). Nothing about who: the visit id is random,
// made when the app opens (and again when someone else signs in), never stored on the phone. Error
// words are never sent, only their kind. The demo build sends nothing, and anyone can switch it off on
// the Me tab, under Privacy ("Help improve the app"). Rules in src/domain/appUsage.ts.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { USAGE_FLUSH_MS, UsageQueue, focusedRouteName, type NavStateLike } from '../domain/appUsage';
import { newClientRef } from '../domain/shopCart';
import { noticeErrors } from '../ui/noticeHook';
import { USE_LIVE_DATA } from './config';
import { appMode, liveDataOn } from './reviewMode';
import { supabase } from './supabase';

const OFF_KEY = 'rustnuts.usage-off';
const queue = new UsageQueue();
let visitId = newClientRef();
let currentScreen = 'Start';
/** The screen showing right now, read when an error shows (the container hears of a new screen late). */
let screenNow: () => string | null = () => null;
/** False until the member's saved choice has been read: nothing is sent before then. */
let choiceLoaded = false;
let sending = false;
let started = false;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Counting can happen in a live build until the app turns out to be in the review demo. */
const mayRecord = (): boolean => USE_LIVE_DATA && (!appMode.loaded() || liveDataOn());

appMode.subscribe(() => {
  if (appMode.loaded() && !liveDataOn()) queue.clear();
});

AsyncStorage.getItem(OFF_KEY)
  .then((v) => {
    queue.enabled = v !== '1';
    if (!queue.enabled) queue.clear();
  })
  .catch(() => undefined)
  .finally(() => {
    choiceLoaded = true;
    notify();
  });

/** The navigation container tells this how to read the screen showing. */
export function usageScreenReader(read: () => string | null): void {
  screenNow = read;
}

/** Called by the NavigationContainer on every change: counts the screen now showing. */
export function usageScreenChanged(state: NavStateLike | undefined): void {
  const name = focusedRouteName(state);
  if (!name) return;
  currentScreen = name;
  if (mayRecord()) queue.screen(name);
}

/** Called when an error Notice shows: counts its kind against the screen showing. */
export function usageErrorShown(message: string): void {
  if (mayRecord()) queue.error(screenNow() ?? currentScreen, message);
}
noticeErrors.report = usageErrorShown;

async function flush(): Promise<void> {
  if (sending || !choiceLoaded || !liveDataOn()) return;
  const batch = queue.take();
  if (!batch.length) return;
  const visit = visitId;
  sending = true;
  try {
    const db = supabase() as unknown as SupabaseClient;
    // A failed send is dropped: these are a guide for the board, never worth a retry loop or a word to the member.
    await db.rpc('app_usage_record', {
      p_visit: visit,
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

/** Someone else signed in (or out): send what's waiting under the old visit, then start a new one. */
export function usageNewVisit(): void {
  void flush();
  visitId = newClientRef();
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

/** The "Help improve the app" switch. */
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
