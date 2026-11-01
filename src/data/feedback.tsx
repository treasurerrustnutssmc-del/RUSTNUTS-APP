// App feedback: the demo's two samples held in memory, or the live database (public.list_app_feedback,
// scoped by row-level security). One list for the whole app, loaded afresh whenever someone else
// signs in. Screenshots go up to the feedback-media bucket, into the sender's own folder.

import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import type { PickedMedia } from '../domain/chat';
import { answerFeedbackProblem, feedbackSeenBy, isFeedbackKeeper, sendFeedbackProblem, type Feedback } from '../domain/feedback';
import { displayName } from '../domain/profile';
import { prepareUpload } from './chat/media';
import { uploadName } from './chat/liveChat';
import { NotAllowedError, useClub } from './clubContext';
import { DEMO_FEEDBACK, demoAnswerFeedback, demoSendFeedback, toFeedback, type AppDetails, type FeedbackDraft, type FeedbackRow } from './feedbackData';
import { appMode, liveDataOn } from './reviewMode';
import { friendlyError, supabase } from './supabase';

const BUCKET = 'feedback-media';
/** Shown until the database part is switched on. */
export const NOT_ON_YET = 'Feedback isn’t switched on yet. Try again after the next update.';
const URL_LIFE_S = 60 * 60;

export interface FeedbackValue {
  /** False until the first load arrives. */
  ready: boolean;
  /** What this member may see: their own, or the lot for a keeper, in Board order. */
  feedback: Feedback[];
  loadError: string | null;
  /** What the app attaches to every report. */
  details: AppDetails;
  /** Sends a report; the screenshot (if any) goes up first. */
  send: (draft: Omit<FeedbackDraft, 'screenshotPath'>, screenshot: PickedMedia | null) => Promise<void>;
  /** A keeper sets the status and, with words, the reply. */
  answer: (id: string, status: string, reply: string) => Promise<void>;
  /** A short-lived link to a screenshot (null in the demo, which has none). */
  screenshotUrl: (path: string) => Promise<string>;
  refresh: () => Promise<void>;
}

// The feedback table isn't in the generated types, so it goes through an untyped client.
const db = () => supabase() as unknown as SupabaseClient;

/** "Android 15 · SM-S938B", "iOS 19.1 · iPhone", or "web · Chrome…": enough to chase a bug. */
function deviceOf(): string {
  if (Platform.OS === 'web') {
    // "web · Chrome 153": the browser and its version, not the whole user agent string.
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    const browser = /(Edg|Firefox|Chrome|Safari)\/(\d+)/.exec(ua);
    return browser ? `web · ${browser[1] === 'Edg' ? 'Edge' : browser[1]} ${browser[2]}` : 'web';
  }
  const c = Platform.constants as { Model?: string; Brand?: string; systemName?: string; osVersion?: string; interfaceIdiom?: string };
  const os = Platform.OS === 'ios' ? `iOS ${Platform.Version}` : `Android ${Platform.Version}`;
  const model = Platform.OS === 'android' ? c.Model : c.interfaceIdiom === 'pad' ? 'iPad' : 'iPhone';
  return [os, model].filter(Boolean).join(' · ');
}

/** Read once: the version, the update (or "embedded" for the build's own code) and the phone. */
let details: AppDetails | null = null;
export function appDetails(): AppDetails {
  details ??= {
    appVersion: Constants.expoConfig?.version ?? '',
    build: Updates.updateId ?? (Updates.isEmbeddedLaunch ? 'embedded' : ''),
    device: deviceOf(),
  };
  return details;
}

interface State {
  /** Whose list it is and whether they were a keeper when it loaded, so a seat change reloads. */
  forId: string | null | undefined;
  ready: boolean;
  feedback: Feedback[];
  loadError: string | null;
}

const startState = (): State =>
  liveDataOn()
    ? { forId: undefined, ready: false, feedback: [], loadError: null }
    : { forId: null, ready: true, feedback: DEMO_FEEDBACK, loadError: null };
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
  const { data, error } = await db().rpc('list_app_feedback');
  if (mine !== loads || state.forId !== forId) return;
  if (error) {
    // Before item 53 of the paste queue is live the function isn't there: say so gently.
    const missing = (error as { code?: string }).code === 'PGRST202' || /does not exist|Could not find the function/i.test(error.message ?? '');
    set({ ready: true, loadError: missing ? NOT_ON_YET : friendlyError(error).message });
    return;
  }
  set({ ready: true, loadError: null, feedback: toFeedback((data ?? []) as FeedbackRow[]) });
}

export function useFeedback(): FeedbackValue {
  const { me, data } = useClub();
  const current = useSyncExternalStore(subscribe, () => state);
  const positions = data.positions;
  const keeper = isFeedbackKeeper(me, positions);
  const forId = me ? `${me.id}:${keeper ? 'keeper' : 'member'}` : null;

  const refresh = useCallback(async () => {
    if (!liveDataOn()) return;
    return loadLive(state.forId);
  }, []);

  useEffect(() => {
    if (!liveDataOn() || state.forId === forId) return;
    if (forId === null) {
      set({ forId, ready: true, feedback: [], loadError: null });
      return;
    }
    set({ forId, ready: false, feedback: [], loadError: null });
    void refresh();
  }, [forId, refresh]);

  const send = useCallback<FeedbackValue['send']>(async (draft, screenshot) => {
    const sentToday = state.feedback.filter((f) => f.memberId === me?.id && Date.parse(f.createdAt) > Date.now() - 86_400_000).length;
    const problem = sendFeedbackProblem(me, { ...draft, sentToday });
    if (problem) throw new NotAllowedError(problem);
    const now = new Date().toISOString();
    if (!liveDataOn()) {
      set({ feedback: demoSendFeedback(state.feedback, { id: me!.id, name: displayName(me!) }, { ...draft, screenshotPath: null }, appDetails(), now) });
      return;
    }
    let screenshotPath: string | null = null;
    if (screenshot) {
      const { file } = await prepareUpload(screenshot);
      screenshotPath = uploadName(me!.id, file.contentType);
      const { error } = await db().storage.from(BUCKET).upload(screenshotPath, file.bytes, { contentType: file.contentType, upsert: false });
      if (error) throw friendlyError(error);
    }
    const { error } = await db().rpc('send_app_feedback', {
      p_kind: draft.kind,
      p_body: draft.body.trim(),
      p_where: draft.whereInApp.trim(),
      p_screenshot_path: screenshotPath,
      p_app_version: appDetails().appVersion,
      p_build: appDetails().build,
      p_device: appDetails().device,
    });
    if (error) {
      if (screenshotPath) db().storage.from(BUCKET).remove([screenshotPath]).then(() => undefined, () => undefined);
      throw friendlyError(error);
    }
    await refresh().catch(() => undefined);
  }, [me, refresh]);

  const answer = useCallback<FeedbackValue['answer']>(async (id, status, reply) => {
    const report = feedbackSeenBy(me, positions, state.feedback).find((f) => f.id === id) ?? null;
    const problem = answerFeedbackProblem(me, positions, report, status, reply);
    if (problem) throw new NotAllowedError(problem);
    if (!liveDataOn()) {
      set({ feedback: demoAnswerFeedback(state.feedback, id, status, reply, new Date().toISOString()) });
      return;
    }
    const { error } = await db().rpc('answer_app_feedback', { p_id: id, p_status: status, p_reply: reply.trim() });
    if (error) throw friendlyError(error);
    await refresh().catch(() => undefined);
  }, [me, positions, refresh]);

  const screenshotUrl = useCallback(async (path: string) => {
    const { data: signed, error } = await db().storage.from(BUCKET).createSignedUrl(path, URL_LIFE_S);
    if (error) throw friendlyError(error);
    if (!signed) throw new Error('The screenshot couldn’t be loaded.');
    return signed.signedUrl;
  }, []);

  return {
    ready: current.ready,
    feedback: feedbackSeenBy(me, positions, current.feedback),
    loadError: current.loadError,
    details: appDetails(),
    send,
    answer,
    screenshotUrl,
    refresh,
  };
}
