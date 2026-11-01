// Draft from Otter: where the draft comes from. Live builds send the transcript to the ask-club Edge
// Function (mode 'minutes'), which checks who may, asks Claude and records the cost; the demo builds
// a scripted draft from the demo club and never touches the network.
// Spec: docs/superpowers/specs/2026-11-01-otter-minutes-design.md

import { useMemo } from 'react';
import type { MinutesPerson } from '../../supabase/functions/_shared/minutesDraft';
import type { DraftResult } from './minutesDemo';
import { cleanDraft, transcriptProblem } from '../domain/otterMinutes';
import type { ClubData, Meeting, Member } from '../domain/types';
import { useClub } from './ClubStore';
import { demoDraft } from './minutesDemo';
import { supabase } from './supabase';

export const DRAFT_NEEDS_SIGNAL = 'Drafting the minutes needs signal.';
const CANT_DRAFT = 'The minutes can’t be drafted right now. Try again in a minute.';

export type { DraftResult } from './minutesDemo';

export interface MinutesApi {
  draft(meeting: Meeting, transcript: string): Promise<DraftResult>;
}

/** The words to show for a failed call: the function's own, the gateway's, or no signal. */
async function wordsFor(error: unknown): Promise<string> {
  if ((error as { name?: string })?.name === 'FunctionsFetchError') return DRAFT_NEEDS_SIGNAL;
  const context = (error as { context?: Response })?.context;
  const said = (await context?.json?.().catch(() => null)) as { error?: string; message?: string } | null;
  const words = said?.error ?? said?.message ?? (context ? CANT_DRAFT : DRAFT_NEEDS_SIGNAL);
  // Before the SQL is in, the database doesn't know the function yet.
  return /minutes_draft_start/.test(words) ? 'Draft from Otter isn’t switched on yet.' : words;
}

export function liveMinutesApi(): MinutesApi {
  return {
    async draft(meeting, transcript) {
      const problem = transcriptProblem(transcript);
      if (problem) throw new Error(problem);
      let result: Awaited<ReturnType<ReturnType<typeof supabase>['functions']['invoke']>>;
      try {
        result = await supabase().functions.invoke('ask-club', { body: { mode: 'minutes', meetingId: meeting.id, transcript: transcript.trim() } });
      } catch {
        throw new Error(DRAFT_NEEDS_SIGNAL);
      }
      if (result.error) throw new Error(await wordsFor(result.error));
      const body = result.data as { draft?: unknown; people?: MinutesPerson[] };
      const people = Array.isArray(body?.people) ? body.people : [];
      const draft = cleanDraft(body?.draft, new Set(people.map((p) => p.id)));
      if (typeof draft === 'string') throw new Error(draft);
      return { draft, people };
    },
  };
}

export function demoMinutesApi(who: { me: Member | null; data: ClubData }): MinutesApi {
  return {
    async draft(meeting, transcript) {
      if (!who.me) throw new Error('Sign in first.');
      const problem = transcriptProblem(transcript);
      if (problem) throw new Error(problem);
      await new Promise((resolve) => setTimeout(resolve, 900));
      return demoDraft(meeting, who.data);
    },
  };
}

/** The demo's scripted drafts in the demo, the club's AI in a live build. */
export function useMinutesApi(): MinutesApi {
  const { isDemo, me, data } = useClub();
  const live = useMemo(() => liveMinutesApi(), []);
  const demo = useMemo(() => demoMinutesApi({ me, data }), [me, data]);
  return isDemo ? demo : live;
}
