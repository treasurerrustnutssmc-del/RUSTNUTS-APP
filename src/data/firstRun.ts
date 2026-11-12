import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { hasSeenFirstRun, markFirstRunSeen, resetFirstRun } from '../domain/firstRun';
import { useClub } from './ClubStore';

// Home and Me are both mounted at once, so a change made in one (Help bringing the guide back)
// has to reach the other straight away.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Whether to show the first-run guide for this member, and how to dismiss or bring it back. */
export function useFirstRun() {
  const { me } = useClub();
  const memberId = me?.id ?? null;
  const [seen, setSeen] = useState<boolean | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  useEffect(() => {
    if (!memberId) return undefined;
    let live = true;
    hasSeenFirstRun(AsyncStorage, memberId).then((s) => live && setSeen(s));
    return () => {
      live = false;
    };
  }, [memberId, tick]);

  const dismiss = useCallback(async () => {
    if (!memberId) return;
    await markFirstRunSeen(AsyncStorage, memberId);
    notify();
  }, [memberId]);

  const replay = useCallback(async () => {
    if (!memberId) return;
    await resetFirstRun(AsyncStorage, memberId);
    notify();
  }, [memberId]);

  return { show: !!memberId && seen === false, dismiss, replay };
}
