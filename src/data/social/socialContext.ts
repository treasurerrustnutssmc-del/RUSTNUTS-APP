// What every social screen can ask of the social extras, whichever source is behind them: the
// demo's made-up data in memory, or the live database.

import { createContext, useContext } from 'react';
import type { Birthday } from '../../domain/social/shoutouts';

export interface SocialContextValue {
  /** False until the first load arrives. */
  ready: boolean;
  /** Every shared birthday (day and month only). */
  birthdays: Birthday[];
  /** Shares or changes my birthday; two nulls take it off. */
  setBirthday: (month: number | null, day: number | null) => Promise<void>;
  refresh: () => Promise<void>;
}

export const SocialContext = createContext<SocialContextValue | null>(null);

export function useSocial(): SocialContextValue {
  const value = useContext(SocialContext);
  if (!value) throw new Error('useSocial needs a SocialProvider above it.');
  return value;
}
