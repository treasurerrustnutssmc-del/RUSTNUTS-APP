// The club's sponsors for the screens: the demo's made-up list held in memory, or the live
// database. One list is kept for the whole app, so the list and the edit screen agree, and it's
// loaded afresh whenever someone else signs in.

import type { SupabaseClient } from '@supabase/supabase-js';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import type { PickedMedia } from '../domain/chat';
import { archiveSponsorProblem, sponsorProblem, sponsorsSeenBy, type Sponsor, type SponsorInput } from '../domain/sponsors';
import type { MediaSource } from './chat/chatContext';
import { uploadName } from './chat/liveChat';
import { NotAllowedError, useClub } from './clubContext';
import { USE_LIVE_DATA } from './config';
import { friendlyError, supabase } from './supabase';
import {
  DEMO_SPONSORS,
  demoArchiveSponsor,
  demoSaveSponsor,
  saveSponsorArgs,
  toSponsors,
  type SponsorCtx,
  type SponsorRow,
} from './sponsorsData';

export interface SponsorsValue {
  /** False until the first load arrives. */
  ready: boolean;
  /** Every sponsor this member can read, taken-off ones too for the board (screens show them with sponsorsFor). */
  sponsors: Sponsor[];
  /** A load that failed, in words, or null. */
  loadError: string | null;
  /** Adds (id null) or changes a sponsor; `logo` is a new one from the phone. Resolves to its id. */
  save: (input: SponsorInput, logo: PickedMedia | null) => Promise<string>;
  archive: (id: string) => Promise<void>;
  /** Something an Image can show for a logo's path. */
  logoUrl: (path: string) => Promise<MediaSource>;
  refresh: () => Promise<void>;
}

const BUCKET = 'sponsor-logos';
const LOGO_SIDE = 600;
// Signed addresses last five minutes; each is reused for four.
const URL_LIFE_S = 300;
const URL_KEEP_MS = 4 * 60_000;

// The sponsor tables aren't in the generated types, so they go through an untyped client.
const db = () => supabase() as unknown as SupabaseClient;

interface State {
  /** Whose list it is (null signed out, undefined not loaded yet): a new person signing in loads their own. */
  forId: string | null | undefined;
  ready: boolean;
  sponsors: Sponsor[];
  loadError: string | null;
}

let state: State = USE_LIVE_DATA
  ? { forId: undefined, ready: false, sponsors: [], loadError: null }
  : { forId: null, ready: true, sponsors: DEMO_SPONSORS, loadError: null };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const urls = new Map<string, { url: string; until: number }>();
// Each load is numbered, so one that finishes after a later one can't put back an older list.
let loads = 0;

async function loadLive(forId: string | null | undefined): Promise<void> {
  const mine = ++loads;
  // Everyone sees the list, signed out too; the database leaves the deals off for non-members.
  const { data, error } = await db().rpc('list_sponsors');
  if (mine !== loads || state.forId !== forId) return; // a later load, or someone else signed in
  if (error) {
    set({ ready: true, loadError: friendlyError(error).message });
    return;
  }
  set({ ready: true, loadError: null, sponsors: toSponsors((data ?? []) as SponsorRow[]) });
}

// A logo goes up as a PNG no wider or taller than 600 px, so a see-through logo stays see-through.
async function uploadLogo(meId: string, logo: PickedMedia): Promise<string> {
  const context = ImageManipulator.manipulate(logo.uri);
  if (Math.max(logo.width, logo.height) > LOGO_SIDE) {
    context.resize(logo.width >= logo.height ? { width: LOGO_SIDE } : { height: LOGO_SIDE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.PNG });
  const bytes = Platform.OS === 'web' ? await (await fetch(saved.uri)).arrayBuffer() : await new File(saved.uri).arrayBuffer();
  const path = uploadName(meId, 'image/png');
  const { error } = await db().storage.from(BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: false });
  if (error) throw friendlyError(error);
  return path;
}

export function useSponsors(): SponsorsValue {
  const { me, data } = useClub();
  const current = useSyncExternalStore(subscribe, () => state);
  const meId = me?.id ?? null;

  const refresh = useCallback(async () => {
    if (!USE_LIVE_DATA) return;
    return loadLive(state.forId);
  }, []);

  useEffect(() => {
    if (!USE_LIVE_DATA || state.forId === meId) return;
    set({ forId: meId, ready: false, sponsors: [], loadError: null });
    urls.clear();
    void refresh();
  }, [meId, refresh]);

  const ctx = (): SponsorCtx => ({ me, positions: data.positions, chapterIds: data.chapters.map((c) => c.id) });

  const save = async (input: SponsorInput, logo: PickedMedia | null): Promise<string> => {
    if (!USE_LIVE_DATA) {
      const result = demoSaveSponsor(state.sponsors, ctx(), { ...input, logoPath: logo ? logo.uri : input.logoPath }, `demo-sponsor-${Date.now()}`);
      set({ sponsors: result.list });
      return result.id;
    }
    const problem = sponsorProblem(me, input, state.sponsors, data.positions, ctx().chapterIds);
    if (problem) throw new NotAllowedError(problem);
    const uploaded = logo ? await uploadLogo((me as { id: string }).id, logo) : null;
    const { data: id, error } = await db().rpc('save_sponsor', saveSponsorArgs(input, uploaded ?? input.logoPath));
    if (error) {
      if (uploaded) db().storage.from(BUCKET).remove([uploaded]).then(() => undefined, () => undefined);
      throw friendlyError(error);
    }
    // It's saved: a reload that fails mustn't make it look as if it wasn't.
    await refresh().catch(() => undefined);
    return id as string;
  };

  const archive = async (id: string): Promise<void> => {
    if (!USE_LIVE_DATA) {
      set({ sponsors: demoArchiveSponsor(state.sponsors, ctx(), id, new Date().toISOString()) });
      return;
    }
    const problem = archiveSponsorProblem(me, id, state.sponsors, data.positions);
    if (problem) throw new NotAllowedError(problem);
    const { error } = await db().rpc('archive_sponsor', { p_id: id });
    if (error) throw friendlyError(error);
    await refresh().catch(() => undefined);
  };

  const logoUrl = useCallback(async (path: string): Promise<MediaSource> => {
    if (!USE_LIVE_DATA) return path;
    const kept = urls.get(path);
    if (kept && kept.until > Date.now()) return kept.url;
    const { data: signed, error } = await db().storage.from(BUCKET).createSignedUrl(path, URL_LIFE_S);
    if (error || !signed) throw friendlyError(error);
    urls.set(path, { url: signed.signedUrl, until: Date.now() + URL_KEEP_MS });
    return signed.signedUrl;
  }, []);

  return {
    ready: current.ready,
    // Like the database: deals only for approved members.
    sponsors: sponsorsSeenBy(current.sponsors, me),
    loadError: current.loadError,
    save,
    archive,
    logoUrl,
    refresh,
  };
}
