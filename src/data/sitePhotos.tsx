// Club photos for the website: the list (public.list_site_photos: editors see all, everyone their
// own), the crew (public.site_photo_crew), and the actions. The demo's samples held in memory, or
// the live database. One list for the whole app, loaded afresh whenever someone else signs in.
// Built on the club-news store. Spec: docs/superpowers/specs/2026-11-02-website-photos-design.md

import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { PickedMedia } from '../domain/chat';
import {
  answerProblem, BAD_UPLOAD, cleanCaption, crewProblem, editorListOrder, isSitePhotoEditor, managesSitePhotoCrew, myAsks,
  pickProblem, removeProblem, uploadProblem, type PhotoPickInput, type PickablePhoto, type SitePhoto, type SitePhotoCrew,
} from '../domain/sitePhotos';
import { prepareUpload } from './chat/media';
import { uploadName } from './chat/liveChat';
import { NotAllowedError, useClub } from './clubContext';
import { appMode, liveDataOn } from './reviewMode';
import {
  DEMO_SITE_PHOTO_CREW, demoAddPhoto, demoAnswerPhoto, demoRemovePhoto, demoSetCrew, demoSitePhotos, toSitePhotoCrew, toSitePhotos,
  type SitePhotoCrewRow, type SitePhotoRow,
} from './sitePhotosData';
import { friendlyError, supabase } from './supabase';

export const SITE_BUCKET = 'site-media';
const URL_LIFE_S = 300;
const URL_KEEP_MS = 4 * 60_000;

export interface SitePhotosValue {
  /** False until the first load arrives. */
  ready: boolean;
  /** Editors: every photo, live first. Everyone else: the photos that are theirs. */
  photos: SitePhoto[];
  /** The asks waiting for me: photos of mine someone wants on the website. */
  asks: SitePhoto[];
  crew: SitePhotoCrew[];
  editor: boolean;
  crewManager: boolean;
  loadError: string | null;
  /** Puts a chat photo on the list (live if mine, else waiting for the poster). */
  pick: (photo: PickablePhoto, input: PhotoPickInput) => Promise<void>;
  /** Shrinks and uploads a photo from the phone, then puts it on the list. */
  upload: (picked: PickedMedia, input: PhotoPickInput) => Promise<void>;
  answer: (id: string, yes: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setCrew: (memberId: string, on: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

// The photo tables aren't in the generated types, so they go through an untyped client.
const db = () => supabase() as unknown as SupabaseClient;

interface State {
  /** Whose list it is, so a sign-in change reloads. */
  forId: string | null | undefined;
  ready: boolean;
  photos: SitePhoto[];
  crew: SitePhotoCrew[];
  loadError: string | null;
}

const startState = (): State =>
  liveDataOn()
    ? { forId: undefined, ready: false, photos: [], crew: [], loadError: null }
    : { forId: undefined, ready: true, photos: [], crew: DEMO_SITE_PHOTO_CREW, loadError: null };
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
  const [list, crew] = await Promise.all([db().rpc('list_site_photos'), db().from('site_photo_crew').select('member_id, added_by, added_at')]);
  if (mine !== loads || state.forId !== forId) return;
  const error = list.error ?? crew.error;
  if (error) {
    set({ ready: true, loadError: friendlyError(error).message });
    return;
  }
  set({
    ready: true,
    loadError: null,
    photos: toSitePhotos((list.data ?? []) as SitePhotoRow[]),
    crew: toSitePhotoCrew((crew.data ?? []) as SitePhotoCrewRow[]),
  });
}

export function useSitePhotos(): SitePhotosValue {
  const { me, data } = useClub();
  const current = useSyncExternalStore(subscribe, () => state);
  const forId = me?.id ?? null;
  const editor = isSitePhotoEditor(me, data.positions, current.crew);
  const crewManager = managesSitePhotoCrew(me, data.positions);

  const refresh = useCallback(async () => {
    if (!liveDataOn()) return;
    return loadLive(state.forId);
  }, []);

  useEffect(() => {
    if (state.forId === forId) return;
    if (!liveDataOn()) {
      set({ forId, photos: forId ? demoSitePhotos(forId) : [], crew: DEMO_SITE_PHOTO_CREW });
      return;
    }
    if (!forId) {
      set({ forId, ready: true, photos: [], crew: [], loadError: null });
      return;
    }
    set({ forId, ready: false, photos: [], crew: [], loadError: null });
    void refresh();
  }, [forId, refresh]);

  const pick = useCallback(async (photo: PickablePhoto, input: PhotoPickInput) => {
    const problem = pickProblem(me, data.positions, state.crew, photo, state.photos, input);
    if (problem) throw new NotAllowedError(problem);
    const caption = cleanCaption(input.caption);
    if (!liveDataOn()) {
      set({
        photos: demoAddPhoto(
          state.photos,
          { source: 'chat', mediaId: photo.media.id, bucket: 'chat-media', path: photo.media.path, width: photo.media.width, height: photo.media.height, caption, postedBy: photo.authorId },
          me!.id,
          new Date().toISOString(),
        ),
      });
      return;
    }
    const { error } = await db().rpc('pick_site_photo', { p_media: photo.media.id, p_caption: caption ?? '', p_consent: input.consent });
    if (error) throw friendlyError(error);
    await refresh().catch(() => undefined);
  }, [me, data.positions, refresh]);

  const upload = useCallback(async (picked: PickedMedia, input: PhotoPickInput) => {
    const problem = uploadProblem(me, data.positions, state.crew, input);
    if (problem) throw new NotAllowedError(problem);
    const caption = cleanCaption(input.caption);
    if (!liveDataOn()) {
      set({
        photos: demoAddPhoto(
          state.photos,
          { source: 'upload', mediaId: null, bucket: 'site-media', path: picked.uri, width: picked.width, height: picked.height, caption, postedBy: me!.id },
          me!.id,
          new Date().toISOString(),
        ),
      });
      return;
    }
    const { file } = await prepareUpload(picked);
    const path = uploadName(me!.id, file.contentType);
    const up = await db().storage.from(SITE_BUCKET).upload(path, file.bytes, { contentType: file.contentType, upsert: false });
    if (up.error) throw new Error(BAD_UPLOAD);
    const { error } = await db().rpc('upload_site_photo', { p_path: path, p_width: file.width, p_height: file.height, p_caption: caption ?? '', p_consent: input.consent });
    if (error) {
      // The file never made the list: clear it away.
      db().storage.from(SITE_BUCKET).remove([path]).then(() => undefined, () => undefined);
      throw friendlyError(error);
    }
    await refresh().catch(() => undefined);
  }, [me, data.positions, refresh]);

  const answer = useCallback(async (id: string, yes: boolean) => {
    const problem = answerProblem(me, state.photos.find((p) => p.id === id));
    if (problem) throw new NotAllowedError(problem);
    if (!liveDataOn()) {
      set({ photos: demoAnswerPhoto(state.photos, id, yes, new Date().toISOString()) });
      return;
    }
    const { error } = await db().rpc('answer_site_photo', { p_id: id, p_yes: yes });
    if (error) throw friendlyError(error);
    await refresh().catch(() => undefined);
  }, [me, refresh]);

  const remove = useCallback(async (id: string) => {
    const problem = removeProblem(me, data.positions, state.crew, state.photos.find((p) => p.id === id));
    if (problem) throw new NotAllowedError(problem);
    if (!liveDataOn()) {
      set({ photos: demoRemovePhoto(state.photos, id, new Date().toISOString()) });
      return;
    }
    const { error } = await db().rpc('remove_site_photo', { p_id: id });
    if (error) throw friendlyError(error);
    await refresh().catch(() => undefined);
  }, [me, data.positions, refresh]);

  const setCrew = useCallback(async (memberId: string, on: boolean) => {
    const problem = crewProblem(me, data.positions, state.crew, data.members.find((m) => m.id === memberId), on);
    if (problem) throw new NotAllowedError(problem);
    if (!liveDataOn()) {
      set({ crew: demoSetCrew(state.crew, memberId, on, me!.id, new Date().toISOString()) });
      return;
    }
    const { error } = await db().rpc('set_site_photo_crew', { p_member: memberId, p_on: on });
    if (error) throw friendlyError(error);
    await refresh().catch(() => undefined);
  }, [me, data.positions, data.members, refresh]);

  return {
    ready: current.ready,
    photos: editorListOrder(current.photos),
    asks: myAsks(me, current.photos),
    crew: current.crew,
    editor,
    crewManager,
    loadError: current.loadError,
    pick,
    upload,
    answer,
    remove,
    setCrew,
    refresh,
  };
}

// ---- Signed links for the site-media bucket (chat-media ones come from the chat provider).

const siteUrls = new Map<string, { url: Promise<string>; until: number }>();

/** A short-lived link to a file in site-media; in the demo the path is the picture itself. */
export async function siteMediaUrl(path: string): Promise<string> {
  if (!liveDataOn() || path.startsWith('https://') || path.startsWith('file:') || path.startsWith('blob:') || path.startsWith('data:')) return path;
  const kept = siteUrls.get(path);
  if (kept && kept.until > Date.now()) return kept.url;
  const url = db()
    .storage.from(SITE_BUCKET)
    .createSignedUrl(path, URL_LIFE_S)
    .then(({ data, error }) => {
      if (error || !data) throw friendlyError(error);
      return data.signedUrl;
    });
  siteUrls.set(path, { url, until: Date.now() + URL_KEEP_MS });
  url.catch(() => siteUrls.delete(path));
  return url;
}
