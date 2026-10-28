// Demo build: made-up social data held in memory. Every action goes through demoSocialActions,
// which applies the same rules the database enforces (checked by src/data/parity.test.ts).

import React, { useCallback, useState } from 'react';
import { approvalProblem } from '../../domain/chat';
import { useChat } from '../chat/ChatProvider';
import { DEMO_MEDIA } from '../chat/demoChatData';
import { useClub } from '../clubContext';
import * as act from './demoSocialActions';
import { demoSocialData } from './demoSocialData';
import { SocialContext, type SocialContextValue } from './socialContext';

export function DemoSocialProvider({ children }: { children: React.ReactNode }) {
  const { data, me, today } = useClub();
  const [social, setSocial] = useState<act.SocialData>(() => demoSocialData(today));
  const ctx = (): act.SocialCtx => ({ social, club: data, me, today });
  // Kept the same between renders, so a screen that loads on change doesn't load forever.
  // Like the database: nothing from anyone you've blocked.
  const notApproved = approvalProblem(me) !== null;
  const { blocks } = useChat();
  const photosOnThisDay = useCallback(async () => {
    if (notApproved) return [];
    const blocked = new Set(blocks.map((b) => b.blockedId));
    return social.pastPhotos.filter((p) => !blocked.has(p.authorId)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [notApproved, social.pastPhotos, blocks]);

  const listingPhotoUrl = useCallback(async (path: string) => {
    const rest = path.slice(path.indexOf('/') + 1);
    return DEMO_MEDIA[rest] ?? rest;
  }, []);

  const value: SocialContextValue = {
    ready: true,
    birthdays: social.birthdays,
    setBirthday: async (month, day) => setSocial(act.setBirthday(ctx(), month, day)),
    photosOnThisDay,
    skills: social.skills,
    setSkills: async (skills) => setSocial(act.setSkills(ctx(), skills)),
    mechanics: social.mechanics,
    vouches: social.vouches,
    saveMechanic: async (input) => {
      const result = act.saveMechanic(ctx(), input);
      setSocial(result.social);
      return result.id;
    },
    archiveMechanic: async (id) => setSocial(act.archiveMechanic(ctx(), id)),
    vouchMechanic: async (id, on) => setSocial(act.vouchMechanic(ctx(), id, on)),
    listings: social.listings,
    // New photos stay on the phone: the path is the seller's folder and then the picture's own address.
    saveListing: async (input, added) => {
      const folder = me?.id ?? 'nobody';
      const photos = [...input.photos, ...added.map((p) => ({ path: `${folder}/${p.uri}`, width: p.width, height: p.height }))];
      const result = act.saveListing(ctx(), { ...input, photos });
      setSocial(result.social);
      return result.id;
    },
    markListingSold: async (id, sold) => setSocial(act.markListingSold(ctx(), id, sold)),
    takeDownListing: async (id) => setSocial(act.takeDownListing(ctx(), id)),
    listingPhotoUrl,
    buildUpdates: social.buildUpdates,
    postBuildUpdate: async (post, added) => {
      const folder = me?.id ?? 'nobody';
      const photos = [...post.photos, ...added.map((p) => ({ path: `${folder}/${p.uri}`, width: p.width, height: p.height }))];
      const result = act.postBuildUpdate(ctx(), { ...post, photos });
      setSocial(result.social);
      return result.id;
    },
    takeDownBuildUpdate: async (id) => setSocial(act.takeDownBuildUpdate(ctx(), id)),
    buildPhotoUrl: listingPhotoUrl,
    refresh: async () => {},
  };
  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}
