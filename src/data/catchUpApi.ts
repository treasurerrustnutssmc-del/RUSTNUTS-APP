// Catch me up: where the summary comes from. Live builds ask the ask-club Edge Function
// (mode 'catchup'); the demo makes one from the chat already on the phone.
// Spec: docs/superpowers/specs/2026-11-01-catch-me-up-design.md

import { useMemo } from 'react';
import type { Message } from '../domain/chat';
import { demoCatchUp } from './catchUpDemo';
import { useClub } from './ClubStore';
import { supabase } from './supabase';

export const CATCHUP_NEEDS_SIGNAL = 'Catch me up needs signal.';
const CANT = 'Catch me up can’t answer right now. Try again in a minute.';

export interface CatchUpApi {
  catchUp(chatId: string, count: number, messages: Message[]): Promise<{ summary: string; count: number }>;
}

async function wordsFor(error: unknown): Promise<string> {
  if ((error as { name?: string })?.name === 'FunctionsFetchError') return CATCHUP_NEEDS_SIGNAL;
  const context = (error as { context?: Response })?.context;
  const said = (await context?.json?.().catch(() => null)) as { error?: string; message?: string } | null;
  const words = said?.error ?? said?.message ?? (context ? CANT : CATCHUP_NEEDS_SIGNAL);
  // Before the SQL is in, the database doesn't know the function yet.
  return /catchup_start/.test(words) ? 'Catch me up isn’t switched on yet.' : words;
}

export function liveCatchUpApi(): CatchUpApi {
  return {
    async catchUp(chatId, count) {
      let result: Awaited<ReturnType<ReturnType<typeof supabase>['functions']['invoke']>>;
      try {
        result = await supabase().functions.invoke('ask-club', { body: { mode: 'catchup', chatId, count } });
      } catch {
        throw new Error(CATCHUP_NEEDS_SIGNAL);
      }
      if (result.error) throw new Error(await wordsFor(result.error));
      const body = result.data as { summary?: unknown; count?: unknown };
      if (typeof body?.summary !== 'string' || !body.summary.trim()) throw new Error(CANT);
      return { summary: body.summary.trim(), count: typeof body.count === 'number' ? body.count : count };
    },
  };
}

export function useCatchUpApi(): CatchUpApi {
  const { isDemo, me, data } = useClub();
  const live = useMemo(() => liveCatchUpApi(), []);
  const demo = useMemo<CatchUpApi>(
    () => ({
      async catchUp(_chatId, count, messages) {
        if (!me) throw new Error('Sign in first.');
        await new Promise((resolve) => setTimeout(resolve, 700));
        return demoCatchUp(messages, data.members, me, count);
      },
    }),
    [me, data.members],
  );
  return isDemo ? demo : live;
}
