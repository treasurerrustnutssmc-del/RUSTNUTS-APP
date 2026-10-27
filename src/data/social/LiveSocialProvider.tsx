// Live build: the social extras in Supabase. Row-level security and the database's actions decide
// who reads and does what; the app checks the same rules first only so members get a clear message
// without a round trip.

import type { SupabaseClient } from '@supabase/supabase-js';
import React, { useCallback, useEffect, useState } from 'react';
import { approvalProblem } from '../../domain/chat';
import { birthdayProblem, type Birthday } from '../../domain/social/shoutouts';
import { NotAllowedError, useClub } from '../clubContext';
import { friendlyError, supabase } from '../supabase';
import { toBirthdays, type BirthdayRow } from './liveSocial';
import { SocialContext, type SocialContextValue } from './socialContext';

// The social tables and actions aren't in the generated types, so they go through an untyped client.
const db = () => supabase() as unknown as SupabaseClient;

export function LiveSocialProvider({ children }: { children: React.ReactNode }) {
  const { me } = useClub();
  const [ready, setReady] = useState(false);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);

  const approved = me?.approval === 'approved';
  const load = useCallback(async () => {
    if (!approved) {
      setReady(true);
      return;
    }
    const { data, error } = await db().from('member_birthdays').select('member_id, month, day');
    // A table that isn't live yet (or a dropped connection) leaves the shout-outs empty, not broken.
    if (!error) setBirthdays(toBirthdays((data ?? []) as BirthdayRow[]));
    setReady(true);
  }, [approved]);

  useEffect(() => {
    Promise.resolve()
      .then(load)
      .catch(() => setReady(true));
  }, [load]);

  const value: SocialContextValue = {
    ready,
    birthdays,
    setBirthday: async (month, day) => {
      const problem = approvalProblem(me) ?? birthdayProblem(month, day);
      if (problem) throw new NotAllowedError(problem);
      const { error } = await db().rpc('set_birthday', { p_month: month, p_day: day });
      if (error) throw friendlyError(error);
      await load();
    },
    refresh: load,
  };
  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}
