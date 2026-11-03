// The real expo-updates behind the "Check for updates" row (src/domain/appUpdate.ts has the steps).

import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { fetchQuietly, shouldCheckOnResume, type RunningUpdate, type UpdateApi } from '../domain/appUpdate';

export const runningUpdate = (): RunningUpdate => ({
  isEnabled: Updates.isEnabled,
  updateId: Updates.updateId,
  isEmbeddedLaunch: Updates.isEmbeddedLaunch,
  createdAt: Updates.createdAt,
});

export const updateApi: UpdateApi = {
  isEnabled: Updates.isEnabled,
  check: () => Updates.checkForUpdateAsync(),
  fetch: () => Updates.fetchUpdateAsync(),
  reload: () => Updates.reloadAsync(),
};

/** True once an update has downloaded and is waiting for a restart (fetched when the app opened, by
 *  "Check for updates", or here when the app comes back to the front). Never on the web. */
export function useUpdateReady(): boolean {
  const { isUpdatePending } = Updates.useUpdates();
  // The app's own launch check has just run, so the first return to the front waits the full gap.
  const lastChecked = useRef<number | null>(null);
  const pending = useRef(isUpdatePending);
  useEffect(() => {
    pending.current = isUpdatePending;
  }, [isUpdatePending]);
  useEffect(() => {
    if (Platform.OS === 'web' || !Updates.isEnabled) return;
    lastChecked.current = Date.now();
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || pending.current || !shouldCheckOnResume(lastChecked.current, Date.now())) return;
      lastChecked.current = Date.now();
      void fetchQuietly(updateApi);
    });
    return () => sub.remove();
  }, []);
  return Platform.OS !== 'web' && Updates.isEnabled && isUpdatePending;
}
