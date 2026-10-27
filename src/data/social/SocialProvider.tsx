// The social extras (Stage 7): the live database in a live build, made-up data in the demo. Sits
// inside ClubProvider and ChatProvider, since it needs to know who's signed in and who's who.

import React from 'react';
import { useClub } from '../clubContext';
import { USE_LIVE_DATA } from '../config';
import { DemoSocialProvider } from './DemoSocialProvider';
import { LiveSocialProvider } from './LiveSocialProvider';

export function SocialProvider({ children }: { children: React.ReactNode }) {
  return USE_LIVE_DATA ? <LiveSocial>{children}</LiveSocial> : <DemoSocialProvider>{children}</DemoSocialProvider>;
}

// A fresh load for each person who signs in, so nothing of the last person's lingers.
function LiveSocial({ children }: { children: React.ReactNode }) {
  const { me } = useClub();
  return <LiveSocialProvider key={me?.id ?? 'nobody'}>{children}</LiveSocialProvider>;
}

export { useSocial } from './socialContext';
