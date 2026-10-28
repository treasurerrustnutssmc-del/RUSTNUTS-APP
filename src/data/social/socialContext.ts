// What every social screen can ask of the social extras, whichever source is behind them: the
// demo's made-up data in memory, or the live database.

import { createContext, useContext } from 'react';
import type { HelpSkill, Mechanic, MechanicInput, MechanicVouch, MemberSkills } from '../../domain/social/help';
import type { Birthday } from '../../domain/social/shoutouts';
import type { Listing, ListingInput } from '../../domain/social/swap';
import type { PickedMedia } from '../../domain/chat';
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
  refresh: () => Promise<void>;
}

export const SocialContext = createContext<SocialContextValue | null>(null);

export function useSocial(): SocialContextValue {
  const value = useContext(SocialContext);
  if (!value) throw new Error('useSocial needs a SocialProvider above it.');
  return value;
}
