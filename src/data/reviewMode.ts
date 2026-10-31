// This phone's live-or-review-demo switch (see appMode.ts), kept in the phone's storage.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { createAppMode } from './appMode';
import { USE_LIVE_DATA } from './config';

export const appMode = createAppMode(AsyncStorage, USE_LIVE_DATA);

/** Whether the app may use the live club database right now: a live build, not in the review demo. */
export const liveDataOn = (): boolean => appMode.liveDataOn();

export type AppModeName = 'loading' | 'live' | 'demo' | 'review';

const snapshot = (): AppModeName =>
  !appMode.loaded() ? 'loading' : appMode.reviewing() ? 'review' : appMode.liveDataOn() ? 'live' : 'demo';

export function useAppMode(): AppModeName {
  return useSyncExternalStore(appMode.subscribe, snapshot, snapshot);
}
