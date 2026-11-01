// Website visitor counts for the Board screen: the demo's made-up numbers, or the live database
// (public.site_visit_summary, board only). Loaded afresh whenever someone else signs in.

import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useSyncExternalStore } from 'react';
import type { VisitRow } from '../domain/siteVisits';
import { isAnyBoard } from '../domain/social/help';
import { useClub } from './clubContext';
import { appMode, liveDataOn } from './reviewMode';
import { friendlyError, supabase } from './supabase';

export interface SiteVisitsValue {
  ready: boolean;
  rows: VisitRow[];
  loadError: string | null;
}

const db = () => supabase() as unknown as SupabaseClient;

/** Made-up numbers so the demo Board screen shows what the card looks like (today = the demo's today). */
export function demoVisits(today: string): VisitRow[] {
  const day = (back: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - back);
    return d.toISOString().slice(0, 10);
  };
  const rows: VisitRow[] = [];
  for (let back = 0; back < 30; back++) {
    rows.push({ day: day(back), page: '/', hits: 14 + ((back * 7) % 11) });
    if (back % 2 === 0) rows.push({ day: day(back), page: '/charity.html', hits: 3 + (back % 4) });
    if (back % 3 === 0) rows.push({ day: day(back), page: '/shop.html', hits: 2 + (back % 3) });
    if (back % 5 === 0) rows.push({ day: day(back), page: '/constitution.html', hits: 1 });
  }
  return rows;
}

interface State {
  forId: string | null | undefined;
  ready: boolean;
  rows: VisitRow[];
  loadError: string | null;
}
const startState = (): State => ({ forId: undefined, ready: !liveDataOn(), rows: [], loadError: null });
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
  const { data, error } = await db().rpc('site_visit_summary');
  if (mine !== loads || state.forId !== forId) return;
  if (error) {
    set({ ready: true, loadError: friendlyError(error).message });
    return;
  }
  set({ ready: true, loadError: null, rows: (data ?? []) as VisitRow[] });
}

export function useSiteVisits(): SiteVisitsValue {
  const { me, data, today } = useClub();
  const current = useSyncExternalStore(subscribe, () => state);
  const board = isAnyBoard(me, data.positions);
  const forId = me ? `${me.id}:${board ? 'board' : 'member'}` : null;

  useEffect(() => {
    if (!liveDataOn() || state.forId === forId) return;
    if (!board) {
      set({ forId, ready: true, rows: [], loadError: null });
      return;
    }
    set({ forId, ready: false, rows: [], loadError: null });
    void loadLive(forId);
  }, [forId, board]);

  if (!liveDataOn()) return { ready: true, rows: board ? demoVisits(today) : [], loadError: null };
  return { ready: current.ready, rows: current.rows, loadError: current.loadError };
}
