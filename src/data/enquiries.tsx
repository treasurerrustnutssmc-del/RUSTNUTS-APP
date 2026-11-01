// Website join enquiries for the Board screen: the demo's two samples held in memory, or the live
// database (public.list_site_enquiries, scoped by row-level security). One list for the whole app,
// loaded afresh whenever someone else signs in.

import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { enquiriesSeenBy, handleEnquiryProblem, type Enquiry } from '../domain/enquiries';
import { isAnyBoard } from '../domain/social/help';
import { NotAllowedError, useClub } from './clubContext';
import { DEMO_ENQUIRIES, demoHandleEnquiry, toEnquiries, type EnquiryRow } from './enquiriesData';
import { appMode, liveDataOn } from './reviewMode';
import { friendlyError, supabase } from './supabase';

export interface EnquiriesValue {
  /** False until the first load arrives. */
  ready: boolean;
  /** What this member may see, open ones first. */
  enquiries: Enquiry[];
  loadError: string | null;
  /** Marks one handled by this member, with an optional note. */
  handle: (id: string, note: string) => Promise<void>;
  refresh: () => Promise<void>;
}

// The enquiry table isn't in the generated types, so it goes through an untyped client.
const db = () => supabase() as unknown as SupabaseClient;

interface State {
  /** Whose list it is and whether they were board when it loaded (`<id>:board`), so a seat change reloads. */
  forId: string | null | undefined;
  ready: boolean;
  enquiries: Enquiry[];
  loadError: string | null;
}

const startState = (): State =>
  liveDataOn()
    ? { forId: undefined, ready: false, enquiries: [], loadError: null }
    : { forId: null, ready: true, enquiries: DEMO_ENQUIRIES, loadError: null };
let state: State = startState();
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
let loads = 0;
appMode.subscribe(() => {
  loads++;
  set(startState());
});

async function loadLive(forId: string | null | undefined): Promise<void> {
  const mine = ++loads;
  const { data, error } = await db().rpc('list_site_enquiries');
  if (mine !== loads || state.forId !== forId) return;
  if (error) {
    set({ ready: true, loadError: friendlyError(error).message });
    return;
  }
  set({ ready: true, loadError: null, enquiries: toEnquiries((data ?? []) as EnquiryRow[]) });
}

export function useEnquiries(): EnquiriesValue {
  const { me, data } = useClub();
  const current = useSyncExternalStore(subscribe, () => state);
  const meId = me?.id ?? null;
  const board = isAnyBoard(me, data.positions);
  const forId = meId === null ? null : `${meId}:${board ? 'board' : 'member'}`;

  const refresh = useCallback(async () => {
    if (!liveDataOn()) return;
    return loadLive(state.forId);
  }, []);

  useEffect(() => {
    if (!liveDataOn() || state.forId === forId) return;
    // Only the board may list them; anyone else gets an empty, ready list without asking.
    if (!board) {
      set({ forId, ready: true, enquiries: [], loadError: null });
      return;
    }
    set({ forId, ready: false, enquiries: [], loadError: null });
    void refresh();
  }, [forId, board, refresh]);

  const handle = useCallback(async (id: string, note: string) => {
    const enquiry = enquiriesSeenBy(me, data.positions, data.chapters, state.enquiries).find((e) => e.id === id) ?? null;
    const problem = handleEnquiryProblem(me, data.positions, enquiry, note);
    if (problem) throw new NotAllowedError(problem);
    if (!liveDataOn()) {
      set({ enquiries: demoHandleEnquiry(state.enquiries, id, me!.id, note, new Date().toISOString()) });
      return;
    }
    const { error } = await db().rpc('handle_site_enquiry', { p_id: id, p_note: note.trim() });
    if (error) throw friendlyError(error);
    await refresh().catch(() => undefined);
  }, [me, data.positions, data.chapters, refresh]);

  return {
    ready: current.ready,
    enquiries: enquiriesSeenBy(me, data.positions, data.chapters, current.enquiries),
    loadError: current.loadError,
    handle,
    refresh,
  };
}
