// Club news for the website, for the Board screen: the demo's two samples held in memory, or the
// live database (public.list_site_news, board only). One list for the whole app, loaded afresh
// whenever someone else signs in. Built on the website-enquiries store.

import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { boardNewsOrder, cleanNews, newsProblem, removeNewsProblem, type NewsInput, type SiteNews } from '../domain/siteNews';
import { isAnyBoard } from '../domain/social/help';
import { NotAllowedError, useClub } from './clubContext';
import { appMode, liveDataOn } from './reviewMode';
import { DEMO_SITE_NEWS, demoPostNews, demoRemoveNews, toSiteNews, type SiteNewsRow } from './siteNewsData';
import { friendlyError, supabase } from './supabase';

export interface SiteNewsValue {
  /** False until the first load arrives. */
  ready: boolean;
  /** Live notices newest first, then the ones taken down. Empty for anyone off the board. */
  news: SiteNews[];
  loadError: string | null;
  /** Posts a notice to the website. */
  post: (input: NewsInput) => Promise<void>;
  /** Takes one off the website. */
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

// The news table isn't in the generated types, so it goes through an untyped client.
const db = () => supabase() as unknown as SupabaseClient;

interface State {
  /** Whose list it is and whether they were board when it loaded, so a seat change reloads. */
  forId: string | null | undefined;
  ready: boolean;
  news: SiteNews[];
  loadError: string | null;
}

const startState = (): State =>
  liveDataOn()
    ? { forId: undefined, ready: false, news: [], loadError: null }
    : { forId: null, ready: true, news: DEMO_SITE_NEWS, loadError: null };
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
  const { data, error } = await db().rpc('list_site_news');
  if (mine !== loads || state.forId !== forId) return;
  if (error) {
    set({ ready: true, loadError: friendlyError(error).message });
    return;
  }
  set({ ready: true, loadError: null, news: toSiteNews((data ?? []) as SiteNewsRow[]) });
}

export function useSiteNews(): SiteNewsValue {
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
      set({ forId, ready: true, news: [], loadError: null });
      return;
    }
    set({ forId, ready: false, news: [], loadError: null });
    void refresh();
  }, [forId, board, refresh]);

  const post = useCallback(async (input: NewsInput) => {
    const problem = newsProblem(me, data.positions, input);
    if (problem) throw new NotAllowedError(problem);
    const clean = cleanNews(input);
    if (!liveDataOn()) {
      set({ news: demoPostNews(state.news, clean, me!.id, new Date().toISOString()) });
      return;
    }
    const { error } = await db().rpc('post_site_news', { p_title: clean.title, p_body: clean.body, p_link: clean.link ?? '' });
    if (error) throw friendlyError(error);
    await refresh().catch(() => undefined);
  }, [me, data.positions, refresh]);

  const remove = useCallback(async (id: string) => {
    const notice = state.news.find((n) => n.id === id) ?? null;
    const problem = removeNewsProblem(me, data.positions, notice);
    if (problem) throw new NotAllowedError(problem);
    if (!liveDataOn()) {
      set({ news: demoRemoveNews(state.news, id, new Date().toISOString()) });
      return;
    }
    const { error } = await db().rpc('remove_site_news', { p_id: id });
    if (error) throw friendlyError(error);
    await refresh().catch(() => undefined);
  }, [me, data.positions, refresh]);

  return {
    ready: current.ready,
    news: board ? boardNewsOrder(current.news) : [],
    loadError: current.loadError,
    post,
    remove,
    refresh,
  };
}
