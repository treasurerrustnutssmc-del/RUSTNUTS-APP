// The real expo-updates behind the "Check for updates" row (src/domain/appUpdate.ts has the steps).

import * as Updates from 'expo-updates';
import type { RunningUpdate, UpdateApi } from '../domain/appUpdate';

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
