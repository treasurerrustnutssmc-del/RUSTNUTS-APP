// Live build: the social extras in Supabase. Row-level security and the database's actions decide
// who reads and does what; the app checks the same rules first only so members get a clear message
// without a round trip.

import type { SupabaseClient } from '@supabase/supabase-js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { listingProblem, soldProblem, takeDownProblem, type Listing, type ListingPhoto } from '../../domain/social/swap';
import type { MediaSource } from '../chat/chatContext';
import { prepareUpload } from '../chat/media';
import { NotAllowedError, useClub } from '../clubContext';
import { friendlyError, supabase } from '../supabase';
import { toFeedItem, uploadName, type FeedJson } from '../chat/liveChat';
import {
  saveListingArgs,
  saveMechanicArgs,
  toListings,
  toBirthdays,
  toMechanics,
  toSkills,
  toVouches,
  type BirthdayRow,
  type ListingRow,
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

const BUCKET = 'swap-media';
// Signed addresses last five minutes; each is reused for four.
const URL_LIFE_S = 300;
const URL_KEEP_MS = 4 * 60_000;

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
  const [listings, setListings] = useState<Listing[]>([]);
  const urls = useRef(new Map<string, { url: Promise<string>; until: number }>());

  const approved = me?.approval === 'approved';
  const load = useCallback(async () => {
    if (!approved) {
      setReady(true);
      return;
    }
    // Each table on its own: one that isn't live yet (or a dropped connection) leaves that part
    // empty, not the rest broken.
    const [b, s, m, v, l] = await Promise.all([
      db().from('member_birthdays').select('member_id, month, day'),
      db().from('member_skills').select('member_id, skills'),
      db().from('mechanics').select('id, name, suburb, phone, website, speciality, notes, added_by, added_at, archived_at'),
      db().from('mechanic_vouches').select('mechanic_id, member_id, vouched'),
      db().from('listings').select('id, seller_id, kind, title, price_dollars, details, photos, listed_at, sold_at, taken_down_at'),
    ]);
    if (!b.error) setBirthdays(toBirthdays((b.data ?? []) as BirthdayRow[]));
    if (!s.error) setSkillsList(toSkills((s.data ?? []) as SkillsRow[]));
    if (!m.error) setMechanics(toMechanics((m.data ?? []) as MechanicRow[]));
    if (!v.error) setVouches(toVouches((v.data ?? []) as VouchRow[]));
    if (!l.error) setListings(toListings((l.data ?? []) as ListingRow[]));
    setReady(true);
  }, [approved]);

  // Kept the same between renders, so a screen that loads on change doesn't load forever.
  const photosOnThisDay = useCallback(async () => {
    if (!approved) return [];
    const { data, error } = await db().rpc('photos_on_this_day');
    if (error) throw friendlyError(error);
    return ((data ?? []) as FeedJson[]).map(toFeedItem);
  }, [approved]);

  // One request per photo however many tiles ask at once.
  const listingPhotoUrl = useCallback(async (path: string): Promise<MediaSource> => {
    const kept = urls.current.get(path);
    if (kept && kept.until > Date.now()) return kept.url;
    const url = db()
      .storage.from(BUCKET)
      .createSignedUrl(path, URL_LIFE_S)
      .then(({ data, error }) => {
        if (error || !data) throw friendlyError(error);
        return data.signedUrl;
      });
    urls.current.set(path, { url, until: Date.now() + URL_KEEP_MS });
    url.catch(() => urls.current.delete(path));
    return url;
  }, []);

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
    listings,
    saveListing: async (input, added) => {
      // The same checks first, with stand-ins for the photos still to go up.
      const standIns = added.map((p, i) => ({ path: `${me?.id ?? ''}/new-${i}`, width: p.width, height: p.height }));
      refuse(listingProblem(me, { ...input, photos: [...input.photos, ...standIns] }, listings));
      const uploaded: string[] = [];
      try {
        const photos: ListingPhoto[] = [...input.photos];
        for (const p of added) {
          const { file } = await prepareUpload(p);
          const path = uploadName((me as { id: string }).id, file.contentType);
          const { error } = await db().storage.from(BUCKET).upload(path, file.bytes, { contentType: file.contentType, upsert: false });
          if (error) throw friendlyError(error);
          uploaded.push(path);
          photos.push({ path, width: Math.round(file.width), height: Math.round(file.height) });
        }
        const id = (await call('save_listing', saveListingArgs(input, photos))) as string;
        await load();
        return id;
      } catch (e) {
        // Nothing half-saved: photos that went up for a listing that didn't are taken down again.
        if (uploaded.length) db().storage.from(BUCKET).remove(uploaded).then(() => undefined, () => undefined);
        throw e;
      }
    },
    markListingSold: async (id, sold) => {
      refuse(soldProblem(me, id, listings));
      await call('mark_listing_sold', { p_id: id, p_sold: sold });
      await load();
    },
    takeDownListing: async (id) => {
      refuse(takeDownProblem(me, id, listings, club.positions));
      await call('take_down_listing', { p_id: id });
      await load();
    },
    listingPhotoUrl,
    refresh: load,
  };
  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}
