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
import { buildPostProblem, buildTakeDownProblem, type BuildPhoto, type BuildUpdate } from '../../domain/social/builds';
import {
  archiveEntryProblem,
  archiveHonourProblem,
  historyProblem,
  honourProblem,
  type HistoryEntry,
  type Honour,
} from '../../domain/social/history';
import {
  archiveAwardProblem,
  nominationProblem,
  openAwardProblem,
  voteProblem,
  withdrawProblem,
  type Award,
  type Nomination,
  type Tally,
  type Vote,
} from '../../domain/social/brag';
import type { MediaSource } from '../chat/chatContext';
import type { Ride } from '../../domain/types';
import type { PickedMedia } from '../../domain/chat';
import { prepareUpload } from '../chat/media';
import { NotAllowedError, useClub } from '../clubContext';
import { friendlyError, supabase } from '../supabase';
import { toFeedItem, uploadName, type FeedJson } from '../chat/liveChat';
import {
  bragRideWindow,
  nominateArgs,
  openAwardArgs,
  toBragRides,
  type BragRideRow,
  toAwards,
  toNominations,
  toTallies,
  toVotes,
  type AwardRow,
  type BragVoteRow,
  type NominationRow,
  saveHistoryArgs,
  saveHonourArgs,
  saveListingArgs,
  saveMechanicArgs,
  toBuildUpdates,
  toHistory,
  toHonours,
  toListings,
  toBirthdays,
  toMechanics,
  toSkills,
  toVouches,
  type BirthdayRow,
  type BuildUpdateRow,
  type HistoryRow,
  type HonourRow,
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
const BUILD_BUCKET = 'build-media';
const BRAG_BUCKET = 'brag-media';
// Signed addresses last five minutes; each is reused for four.
const URL_LIFE_S = 300;
const URL_KEEP_MS = 4 * 60_000;

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw friendlyError(error);
  return data;
}

export function LiveSocialProvider({ children }: { children: React.ReactNode }) {
  const { me, data: club, today } = useClub();
  const [ready, setReady] = useState(false);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [skills, setSkillsList] = useState<MemberSkills[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [vouches, setVouches] = useState<MechanicVouch[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [buildUpdates, setBuildUpdates] = useState<BuildUpdate[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [honours, setHonours] = useState<Honour[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [nominations, setNominations] = useState<Nomination[]>([]);
  const [myVotes, setMyVotes] = useState<Vote[]>([]);
  const [tallies, setTallies] = useState<Tally[]>([]);
  const [bragRides, setBragRides] = useState<Ride[]>([]);
  // Signed addresses, by bucket and path.
  const urls = useRef(new Map<string, { url: Promise<string>; until: number }>());

  const approved = me?.approval === 'approved';
  const load = useCallback(async () => {
    if (!approved) {
      setReady(true);
      return;
    }
    // Each table on its own: one that isn't live yet (or a dropped connection) leaves that part
    // empty, not the rest broken.
    const [b, s, m, v, l, u, hy, ho, aw, no, bv, bt] = await Promise.all([
      db().from('member_birthdays').select('member_id, month, day'),
      db().from('member_skills').select('member_id, skills'),
      db().from('mechanics').select('id, name, suburb, phone, website, speciality, notes, added_by, added_at, archived_at'),
      db().from('mechanic_vouches').select('mechanic_id, member_id, vouched'),
      db().from('listings').select('id, seller_id, kind, title, price_dollars, details, photos, listed_at, sold_at, taken_down_at'),
      db().from('build_updates').select('id, bike_id, author_id, body, photos, posted_at, taken_down_at'),
      db().from('club_history').select('id, happened_on, precision, title, story, added_by, archived_at'),
      db().from('club_honours').select('id, member_id, name, honour, year, note, added_by, archived_at'),
      db().from('brag_awards').select('id, kind, title, year, nominations_close, voting_close, opened_by, archived_at'),
      db().from('brag_nominations').select('id, award_id, nominated_by, ride_id, title, photo, story, reason, nominated_at, withdrawn_at'),
      db().from('brag_votes').select('award_id, member_id, nomination_id'),
      db().rpc('brag_tallies'),
    ]);
    if (!b.error) setBirthdays(toBirthdays((b.data ?? []) as BirthdayRow[]));
    if (!s.error) setSkillsList(toSkills((s.data ?? []) as SkillsRow[]));
    if (!m.error) setMechanics(toMechanics((m.data ?? []) as MechanicRow[]));
    if (!v.error) setVouches(toVouches((v.data ?? []) as VouchRow[]));
    if (!l.error) setListings(toListings((l.data ?? []) as ListingRow[]));
    if (!u.error) setBuildUpdates(toBuildUpdates((u.data ?? []) as BuildUpdateRow[]));
    if (!hy.error) setHistory(toHistory((hy.data ?? []) as HistoryRow[]));
    if (!ho.error) setHonours(toHonours((ho.data ?? []) as HonourRow[]));
    if (!aw.error) {
      const list = toAwards((aw.data ?? []) as AwardRow[]);
      setAwards(list);
      // The calendar only has rides from today on; ride awards need the past ones of their years.
      const window = bragRideWindow(list);
      if (window) {
        const rides = await db()
          .from('rides')
          .select('id, title, starts_at, ends_at, all_day, location, notes, category, cancelled_at')
          .gte('starts_at', window.from)
          .lt('starts_at', window.to);
        if (!rides.error) setBragRides(toBragRides((rides.data ?? []) as BragRideRow[]));
      } else {
        setBragRides([]);
      }
    }
    if (!no.error) setNominations(toNominations((no.data ?? []) as NominationRow[]));
    if (!bv.error) setMyVotes(toVotes((bv.data ?? []) as BragVoteRow[]));
    if (!bt.error) setTallies(toTallies((bt.data ?? []) as { nomination_id: string; votes: number }[]));
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
  const signed = useCallback(async (bucket: string, path: string): Promise<MediaSource> => {
    const key = `${bucket}/${path}`;
    const kept = urls.current.get(key);
    if (kept && kept.until > Date.now()) return kept.url;
    const url = db()
      .storage.from(bucket)
      .createSignedUrl(path, URL_LIFE_S)
      .then(({ data, error }) => {
        if (error || !data) throw friendlyError(error);
        return data.signedUrl;
      });
    urls.current.set(key, { url, until: Date.now() + URL_KEEP_MS });
    url.catch(() => urls.current.delete(key));
    return url;
  }, []);
  const listingPhotoUrl = useCallback((path: string) => signed(BUCKET, path), [signed]);
  const buildPhotoUrl = useCallback((path: string) => signed(BUILD_BUCKET, path), [signed]);
  const bragPhotoUrl = useCallback((path: string) => signed(BRAG_BUCKET, path), [signed]);

  // Shrinks and uploads the phone's photos into my folder of a bucket. The paths that went up are
  // added to `uploaded` as they go, so a failure later can take them down again.
  const uploadPhotos = async (bucket: string, added: PickedMedia[], uploaded: string[]): Promise<BuildPhoto[]> => {
    const photos: BuildPhoto[] = [];
    for (const p of added) {
      const { file } = await prepareUpload(p);
      const path = uploadName((me as { id: string }).id, file.contentType);
      const { error } = await db().storage.from(bucket).upload(path, file.bytes, { contentType: file.contentType, upsert: false });
      if (error) throw friendlyError(error);
      uploaded.push(path);
      photos.push({ path, width: Math.round(file.width), height: Math.round(file.height) });
    }
    return photos;
  };

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
      let id: string;
      try {
        const photos: ListingPhoto[] = [...input.photos, ...(await uploadPhotos(BUCKET, added, uploaded))];
        id = (await call('save_listing', saveListingArgs(input, photos))) as string;
      } catch (e) {
        // Nothing half-saved: photos that went up for a listing that didn't are taken down again.
        if (uploaded.length) db().storage.from(BUCKET).remove(uploaded).then(() => undefined, () => undefined);
        throw e;
      }
      // It's saved: a reload that fails mustn't make it look as if it wasn't.
      await load().catch(() => undefined);
      return id;
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
    buildUpdates,
    postBuildUpdate: async (post, added) => {
      const standIns = added.map((p, i) => ({ path: `${me?.id ?? ''}/new-${i}`, width: p.width, height: p.height }));
      refuse(buildPostProblem(me, { ...post, photos: [...post.photos, ...standIns] }, club.bikes, buildUpdates));
      const uploaded: string[] = [];
      let id: string;
      try {
        const photos = [...post.photos, ...(await uploadPhotos(BUILD_BUCKET, added, uploaded))];
        id = (await call('post_build_update', { p_bike: post.bikeId, p_body: post.body, p_photos: photos })) as string;
      } catch (e) {
        if (uploaded.length) db().storage.from(BUILD_BUCKET).remove(uploaded).then(() => undefined, () => undefined);
        throw e;
      }
      await load().catch(() => undefined);
      return id;
    },
    takeDownBuildUpdate: async (id) => {
      refuse(buildTakeDownProblem(me, id, buildUpdates, club.positions));
      await call('take_down_build_update', { p_id: id });
      await load();
    },
    buildPhotoUrl,
    history,
    honours,
    saveHistoryEntry: async (input) => {
      refuse(historyProblem(me, input, history, club.positions, today));
      const id = (await call('save_history_entry', saveHistoryArgs(input))) as string;
      await load().catch(() => undefined);
      return id;
    },
    archiveHistoryEntry: async (id) => {
      refuse(archiveEntryProblem(me, id, history, club.positions));
      await call('archive_history_entry', { p_id: id });
      await load().catch(() => undefined);
    },
    saveHonour: async (input) => {
      refuse(honourProblem(me, input, honours, club.members, club.positions, today));
      const id = (await call('save_honour', saveHonourArgs(input))) as string;
      await load().catch(() => undefined);
      return id;
    },
    archiveHonour: async (id) => {
      refuse(archiveHonourProblem(me, id, honours, club.positions));
      await call('archive_honour', { p_id: id });
      await load().catch(() => undefined);
    },
    awards,
    nominations,
    myVotes,
    tallies,
    bragRides,
    openAward: async (input) => {
      refuse(openAwardProblem(me, input, club.positions, today));
      const id = (await call('open_award', openAwardArgs(input))) as string;
      await load().catch(() => undefined);
      return id;
    },
    archiveAward: async (id) => {
      refuse(archiveAwardProblem(me, id, awards, club.positions));
      await call('archive_award', { p_id: id });
      await load().catch(() => undefined);
    },
    nominate: async (input, added) => {
      // The same checks first, with a stand-in for a photo still to go up.
      const standIn = added ? { path: `${me?.id ?? ''}/new-0`, width: added.width, height: added.height } : input.photo;
      refuse(nominationProblem(me, { ...input, photo: standIn }, awards, nominations, bragRides, today));
      const uploaded: string[] = [];
      let id: string;
      try {
        const photo = added ? (await uploadPhotos(BRAG_BUCKET, [added], uploaded))[0] : input.photo;
        id = (await call('nominate', nominateArgs({ ...input, photo }))) as string;
      } catch (e) {
        if (uploaded.length) db().storage.from(BRAG_BUCKET).remove(uploaded).then(() => undefined, () => undefined);
        throw e;
      }
      await load().catch(() => undefined);
      return id;
    },
    withdrawNomination: async (id) => {
      refuse(withdrawProblem(me, id, nominations, awards, club.positions, today));
      await call('withdraw_nomination', { p_id: id });
      await load().catch(() => undefined);
    },
    castBragVote: async (id) => {
      refuse(voteProblem(me, id, nominations, awards, today));
      await call('cast_brag_vote', { p_nomination: id });
      await load().catch(() => undefined);
    },
    bragPhotoUrl,
    refresh: load,
  };
  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}
