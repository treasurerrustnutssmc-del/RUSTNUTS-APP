// Ask the club: where the answers come from. Live builds ask the ask-club Edge Function (which
// checks the member, the switch, the daily limit and the budget, then asks Claude); the demo uses
// the scripted assistant and never touches the network.
// Spec: docs/superpowers/specs/2026-10-31-club-assistant-design.md

import { useMemo } from 'react';
import { CANT_ANSWER, type ApiMessage, type AskReply } from '../../supabase/functions/_shared/askClub';
import type { ClubData, Member } from '../domain/types';
import { demoReply } from './assistantDemo';
import { useClub } from './clubContext';
import { supabase } from './supabase';

export const NEEDS_SIGNAL = 'Ask the club needs signal.';
const DEMO_LIMIT = 15;

export interface AssistantStatus {
  on: boolean;
  leftToday: number;
  dailyLimit: number;
  /** DD/MM/YYYY when this month's budget is used, else null. */
  restingUntil: string | null;
}

export interface AssistantApi {
  status(): Promise<AssistantStatus>;
  ask(messages: ApiMessage[]): Promise<AskReply>;
}

/** The words to show for a failed call: the function's own, the gateway's, or no signal. */
async function wordsFor(error: unknown): Promise<string> {
  if ((error as { name?: string })?.name === 'FunctionsFetchError') return NEEDS_SIGNAL;
  const context = (error as { context?: Response })?.context;
  const said = (await context?.json?.().catch(() => null)) as { error?: string; message?: string } | null;
  return said?.error ?? said?.message ?? (context ? CANT_ANSWER : NEEDS_SIGNAL);
}

export function liveAssistant(): AssistantApi {
  return {
    async status() {
      const { data, error } = await supabase().rpc('assistant_status');
      if (error || !data) throw new Error(error ? NEEDS_SIGNAL : CANT_ANSWER);
      return { on: data.on, leftToday: data.left_today, dailyLimit: data.daily_limit, restingUntil: data.resting_until };
    },
    async ask(messages) {
      let result: Awaited<ReturnType<ReturnType<typeof supabase>['functions']['invoke']>>;
      try {
        result = await supabase().functions.invoke('ask-club', { body: { messages } });
      } catch {
        throw new Error(NEEDS_SIGNAL);
      }
      if (result.error) throw new Error(await wordsFor(result.error));
      return result.data as AskReply;
    },
  };
}

/** How many demo questions this run of the app has asked, so the demo counts down like the real thing. */
let demoAsked = 0;

/** The demo's assistant: answers after a short pause, so "Thinking…" shows, and counts down the day. */
export function demoAssistant(who: { me: Member | null; data: ClubData }): AssistantApi {
  return {
    async status() {
      return { on: true, leftToday: Math.max(0, DEMO_LIMIT - demoAsked), dailyLimit: DEMO_LIMIT, restingUntil: null };
    },
    async ask(messages) {
      if (!who.me) throw new Error('Only approved members can ask the club.');
      if (demoAsked >= DEMO_LIMIT) throw new Error(`You’ve asked ${DEMO_LIMIT} today. More tomorrow.`);
      demoAsked += 1;
      await new Promise((resolve) => setTimeout(resolve, 700));
      return demoReply(messages, { me: who.me, data: who.data, now: new Date().toISOString() });
    },
  };
}

/** The assistant for this build: the scripted one in the demo, the club's in a live build. */
export function useAssistantApi(): AssistantApi {
  const { isDemo, me, data } = useClub();
  // The live one never changes, so its status isn't fetched again each time the club data reloads.
  const live = useMemo(() => liveAssistant(), []);
  const demo = useMemo(() => demoAssistant({ me, data }), [me, data]);
  return isDemo ? demo : live;
}
