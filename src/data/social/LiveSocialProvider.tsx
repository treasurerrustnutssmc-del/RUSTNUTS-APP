// Live build: the social extras in Supabase. Row-level security and the database's actions decide
// who reads and does what; the app checks the same rules first only so members get a clear message
// without a round trip.

import type { SupabaseClient } from '@supabase/supabase-js';
import React, { useCallback, useEffect, useState } from 'react';
import { approvalProblem } from '../../domain/chat';
import {
  archiveProblem,
  mechanicProblem,
  skillsProblem,
  vouchProblem,
  type Mechanic,
  type MechanicVouch,
  type MemberSkills,
} from '../../domain/social/help';
import { birthdayProblem, type Birthday } from '../../domain/social/shoutouts';
import { NotAllowedError, useClub } from '../clubContext';
import { friendlyError, supabase } from '../supabase';
import { toFeedItem, type FeedJson } from '../chat/liveChat';
import {
  saveMechanicArgs,
  toBirthdays,
  toMechanics,
  toSkills,
  toVouches,
  type BirthdayRow,
  type MechanicRow,
  type SkillsRow,
  type VouchRow,
} from './liveSocial';
import { SocialContext, type SocialContextValue } from './socialContext';

// The social tables and actions aren't in the generated types, so they go through an untyped client.
const db = () => supabase() as unknown as SupabaseClient;

const refuse = (problem: string | null) => {
  if (problem) throw new NotAllowedError(problem);
};

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw friendlyError(error);
  return data;
}

export function LiveSocialProvider({ children }: { children: React.ReactNode }) {
  const { me, data: club } = useClub();
  const [ready, setReady] = useState(false);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [skills, setSkillsList] = useState<MemberSkills[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [vouches, setVouches] = useState<MechanicVouch[]>([]);

  const approved = me?.approval === 'approved';
  const load = useCallback(async () => {
    if (!approved) {
      setReady(true);
      return;
    }
    // Each table on its own: one that isn't live yet (or a dropped connection) leaves that part
    // empty, not the rest broken.
    const [b, s, m, v] = await Promise.all([
      db().from('member_birthdays').select('member_id, month, day'),
      db().from('member_skills').select('member_id, skills'),
      db().from('mechanics').select('id, name, suburb, phone, website, speciality, notes, added_by, added_at, archived_at'),
      db().from('mechanic_vouches').select('mechanic_id, member_id, vouched'),
    ]);
    if (!b.error) setBirthdays(toBirthdays((b.data ?? []) as BirthdayRow[]));
    if (!s.error) setSkillsList(toSkills((s.data ?? []) as SkillsRow[]));
    if (!m.error) setMechanics(toMechanics((m.data ?? []) as MechanicRow[]));
    if (!v.error) setVouches(toVouches((v.data ?? []) as VouchRow[]));
    setReady(true);
  }, [approved]);

  // Kept the same between renders, so a screen that loads on change doesn't load forever.
  const photosOnThisDay = useCallback(async () => {
    if (!approved) return [];
    const { data, error } = await db().rpc('photos_on_this_day');
    if (error) throw friendlyError(error);
    return ((data ?? []) as FeedJson[]).map(toFeedItem);
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
      refuse(approvalProblem(me) ?? birthdayProblem(month, day));
      await call('set_birthday', { p_month: month, p_day: day });
      await load();
    },
    photosOnThisDay,
    skills,
    setSkills: async (list) => {
      refuse(skillsProblem(me, list));
      await call('set_skills', { p_skills: list });
      await load();
    },
    mechanics,
    vouches,
    saveMechanic: async (input) => {
      refuse(mechanicProblem(me, input, mechanics, club.positions));
      const id = (await call('save_mechanic', saveMechanicArgs(input))) as string;
      await load();
      return id;
    },
    archiveMechanic: async (id) => {
      refuse(archiveProblem(me, id, mechanics, club.positions));
      await call('archive_mechanic', { p_id: id });
      await load();
    },
    vouchMechanic: async (id, on) => {
      refuse(vouchProblem(me, id, mechanics));
      await call('vouch_mechanic', { p_id: id, p_on: on });
      await load();
    },
    refresh: load,
  };
  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}
