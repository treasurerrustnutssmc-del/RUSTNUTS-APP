import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { readFilters, saveFilters, type SavedFilters } from '../domain/savedFilters';
import { useClub } from './ClubStore';

/** The member's remembered filters (Rides colours, Members chapter). Read once, saved as they change. */
export function useSavedFilters() {
  const { me } = useClub();
  const memberId = me?.id ?? null;
  const [filters, setFilters] = useState<SavedFilters>({});

  useEffect(() => {
    if (!memberId) return undefined;
    let live = true;
    readFilters(AsyncStorage, memberId).then((f) => live && setFilters(f));
    return () => {
      live = false;
    };
  }, [memberId]);

  const save = useCallback(
    (patch: SavedFilters) => {
      setFilters((f) => ({ ...f, ...patch }));
      if (memberId) void saveFilters(AsyncStorage, memberId, patch);
    },
    [memberId],
  );
  return { filters, save };
}
