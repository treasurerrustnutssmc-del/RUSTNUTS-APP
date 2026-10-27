// Demo build: made-up social data held in memory. Every action goes through demoSocialActions,
// which applies the same rules the database enforces (checked by src/data/parity.test.ts).

import React, { useState } from 'react';
import { useClub } from '../clubContext';
import * as act from './demoSocialActions';
import { demoSocialData } from './demoSocialData';
import { SocialContext, type SocialContextValue } from './socialContext';

export function DemoSocialProvider({ children }: { children: React.ReactNode }) {
  const { data, me, today } = useClub();
  const [social, setSocial] = useState<act.SocialData>(() => demoSocialData(today));
  const ctx = (): act.SocialCtx => ({ social, club: data, me, today });

  const value: SocialContextValue = {
    ready: true,
    birthdays: social.birthdays,
    setBirthday: async (month, day) => setSocial(act.setBirthday(ctx(), month, day)),
    refresh: async () => {},
  };
  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}
