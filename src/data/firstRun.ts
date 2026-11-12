import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { hasSeenFirstRun, isRecentMember, markFirstRunSeen, resetFirstRun } from '../domain/firstRun';
import { useClub } from './ClubStore';

// Home and Me are both mounted at once, so a change made in one (Help bringing the guide back)
// has to reach the other straight away.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Whether to show the first-run guide for this member, and how to dismiss or bring it back. */
export function useFirstRun() {
  const { me, today } = useClub();
  const memberId = me?.id ?? null;
  const recent = isRecentMember(me?.joinedOn ?? null, today);
  // Kept with the member it was read for, so on a shared phone the next member never briefly inherits it.
  const [state, setState] = useState<{ memberId: string | null; seen: boolean | null }>({ memberId: null, seen: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  useEffect(() => {
    if (!memberId) return undefined;
    let live = true;
    hasSeenFirstRun(AsyncStorage, memberId, recent).then((seen) => live && setState({ memberId, seen }));
    return () => {
      live = false;
    };
  }, [memberId, recent, tick]);

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

  const seen = state.memberId === memberId ? state.seen : null;
  return { show: !!memberId && seen === false, dismiss, replay };
}
