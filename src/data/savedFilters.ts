import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { readFilters, saveFilters, type SavedFilters } from '../domain/savedFilters';
import { useClub } from './ClubStore';

/** The member's remembered filters (Rides colours, Members chapter). Read once, saved as they change. */
export function useSavedFilters() {
  const { me } = useClub();
  const memberId = me?.id ?? null;
  // Kept with the member they were read for, so a shared phone never shows one member another's filters.
  const [state, setState] = useState<{ memberId: string | null; filters: SavedFilters }>({ memberId: null, filters: {} });

  useEffect(() => {
    if (!memberId) return undefined;
    let live = true;
    // Anything chosen before the read finished wins over what was stored.
    readFilters(AsyncStorage, memberId).then(
      (stored) => live && setState((s) => ({ memberId, filters: { ...stored, ...(s.memberId === memberId ? s.filters : {}) } })),
    );
    return () => {
      live = false;
    };
  }, [memberId]);

  const save = useCallback(
    (patch: SavedFilters) => {
      if (!memberId) return;
      setState((s) => ({ memberId, filters: { ...(s.memberId === memberId ? s.filters : {}), ...patch } }));
      void saveFilters(AsyncStorage, memberId, patch);
    },
    [memberId],
  );
  return { filters: state.memberId === memberId ? state.filters : {}, save };
}
