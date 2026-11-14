// This phone's live-or-review-demo switch (see appMode.ts), kept in the phone's storage.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { createAppMode } from './appMode';
import { USE_LIVE_DATA } from './config';
import { createDemoSession } from './demoSession';

export const appMode = createAppMode(AsyncStorage, USE_LIVE_DATA);

/**
 * The demo's one instant: every demo seed is built for it. Made straight after `appMode`, so it is the
 * first to hear a mode change and the stores that reseed in the same notification see the new session.
 */
export const demoSession = createDemoSession(appMode.subscribe);

/** Whether the app may use the live club database right now: a live build, not in the review demo. */
export const liveDataOn = (): boolean => appMode.liveDataOn();

export type AppModeName = 'loading' | 'live' | 'demo' | 'review';

const snapshot = (): AppModeName =>
  !appMode.loaded() ? 'loading' : appMode.reviewing() ? 'review' : appMode.liveDataOn() ? 'live' : 'demo';

export function useAppMode(): AppModeName {
  return useSyncExternalStore(appMode.subscribe, snapshot, snapshot);
}
