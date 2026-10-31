// The app's data. A build with the club's Supabase details in .env talks to the live
// database; without them (or with EXPO_PUBLIC_FORCE_DEMO=1) it runs on made-up demo members.

import React from 'react';
import { liveDataOn } from './reviewMode';
import { DemoClubProvider } from './DemoClubProvider';
import { LiveClubProvider } from './LiveClubProvider';

export function ClubProvider({ children }: { children: React.ReactNode }) {
  return liveDataOn() ? <LiveClubProvider>{children}</LiveClubProvider> : <DemoClubProvider>{children}</DemoClubProvider>;
}

export { useClub, NotAllowedError } from './clubContext';
export type { ApplicationInput, PrivateInput, ProfileInput } from './clubContext';
