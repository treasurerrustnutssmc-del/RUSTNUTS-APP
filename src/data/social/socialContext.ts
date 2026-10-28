// What every social screen can ask of the social extras, whichever source is behind them: the
// demo's made-up data in memory, or the live database.

import { createContext, useContext } from 'react';
import type { HelpSkill, Mechanic, MechanicInput, MechanicVouch, MemberSkills } from '../../domain/social/help';
import type { Birthday } from '../../domain/social/shoutouts';
import type { Listing, ListingInput } from '../../domain/social/swap';
import type { BuildPost, BuildUpdate } from '../../domain/social/builds';
import type { HistoryEntry, HistoryInput, Honour, HonourInput } from '../../domain/social/history';
import type { Award, AwardInput, Nomination, NominationInput, Tally, Vote } from '../../domain/social/brag';
import type { PickedMedia } from '../../domain/chat';
import type { Ride, RideRoute } from '../../domain/types';
import type { FeedItem, MediaSource } from '../chat/chatContext';

export interface SocialContextValue {
  /** False until the first load arrives. */
  ready: boolean;
  /** Every shared birthday (day and month only). */
  birthdays: Birthday[];
  /** Shares or changes my birthday; two nulls take it off. */
  setBirthday: (month: number | null, day: number | null) => Promise<void>;
  /** Photos and videos from today's date in earlier years, newest first (club_photos' rules). */
  photosOnThisDay: () => Promise<FeedItem[]>;
  // Who can help
  skills: MemberSkills[];
  setSkills: (skills: HelpSkill[]) => Promise<void>;
  /** Every workshop, archived ones included. */
  mechanics: Mechanic[];
  vouches: MechanicVouch[];
  /** Adds (id null) or changes a workshop; resolves to its id. */
  saveMechanic: (input: MechanicInput) => Promise<string>;
  archiveMechanic: (id: string) => Promise<void>;
  vouchMechanic: (id: string, on: boolean) => Promise<void>;
  // Swap and sell
  /** Listings this member can read (screens pick what to show with listingsFor). */
  listings: Listing[];
  /**
   * Lists something (id null) or changes a listing; resolves to its id. `input.photos` are the
   * photos it keeps; `added` are new ones from the phone, uploaded and put after them.
   */
  saveListing: (input: ListingInput, added: PickedMedia[]) => Promise<string>;
  markListingSold: (id: string, sold: boolean) => Promise<void>;
  takeDownListing: (id: string) => Promise<void>;
  /** Something an Image can show for a listing photo's path. */
  listingPhotoUrl: (path: string) => Promise<MediaSource>;
  // Garage build threads
  /** Build updates this member can read (screens pick what to show with buildsFor). */
  buildUpdates: BuildUpdate[];
  /** Posts an update on my project bike; `post.photos` is empty and `added` are the phone's photos. */
  postBuildUpdate: (post: BuildPost, added: PickedMedia[]) => Promise<string>;
  takeDownBuildUpdate: (id: string) => Promise<void>;
  buildPhotoUrl: (path: string) => Promise<MediaSource>;
  // History and hall of fame
  /** Timeline entries this member can read (screens show them with timeline). */
  history: HistoryEntry[];
  honours: Honour[];
  /** Adds (id null) or changes a timeline entry; resolves to its id. The board only. */
  saveHistoryEntry: (input: HistoryInput) => Promise<string>;
  archiveHistoryEntry: (id: string) => Promise<void>;
  saveHonour: (input: HonourInput) => Promise<string>;
  archiveHonour: (id: string) => Promise<void>;
  // Bragging rights
  /** Awards that are up, and the nominations that stand. */
  awards: Award[];
  nominations: Nomination[];
  /** My own votes only: nobody sees anyone else's. */
  myVotes: Vote[];
  /** Vote counts for awards that have closed. */
  tallies: Tally[];
  /** Club rides a ride award can show and take: past ones included, which the calendar leaves out. */
  bragRides: Ride[];
  // Badges
  /** Which route every ride used, past rides included (the calendar only has rides from today on). */
  allRideRoutes: RideRoute[];
  openAward: (input: AwardInput) => Promise<string>;
  archiveAward: (id: string) => Promise<void>;
  /** Nominates something; for a photo award, `added` is the phone's photo (input.photo is null). */
  nominate: (input: NominationInput, added: PickedMedia | null) => Promise<string>;
  withdrawNomination: (id: string) => Promise<void>;
  castBragVote: (nominationId: string) => Promise<void>;
  bragPhotoUrl: (path: string) => Promise<MediaSource>;
  refresh: () => Promise<void>;
}

export const SocialContext = createContext<SocialContextValue | null>(null);

export function useSocial(): SocialContextValue {
  const value = useContext(SocialContext);
  if (!value) throw new Error('useSocial needs a SocialProvider above it.');
  return value;
}
