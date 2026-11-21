// Website and app, on its own page (Jeff, 21 Nov 2026: simplify the Board page). The Board shows one
// row with how many website enquiries are waiting; this page has the enquiries, the news for the
// website, page visits, app feedback and app usage, as they were in the Board's Website and app group.

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { useClub } from '../data/ClubStore';
import { useEnquiries } from '../data/enquiries';
import { isAnyBoard } from '../domain/social/help';
import type { RootParams } from '../navigation/types';
import { IconBadge, ListRow, Notice, Screen } from '../ui/primitives';
import { AppUsage } from './appUsage'; // app screens reached, anonymous
import { WebsiteEnquiries } from './enquiries';
import { AppFeedbackSection } from './feedback'; // Feedback and issues
import { WebsiteNews } from './siteNews'; // club news for the website
import { WebsiteVisits } from './siteVisits'; // website page views

export function WebsiteAppScreen() {
  const { isDemo, refresh } = useClub();
  const [done, setDone] = useState<string | null>(null);
  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      {done ? (
        <Notice tone="ok" title="Done">
          {done}
        </Notice>
      ) : null}
      {/* People who asked through the club website's Ride With Us form */}
      <WebsiteEnquiries onDone={setDone} />
      <WebsiteNews onDone={setDone} />
      <WebsiteVisits />
      <AppFeedbackSection onDone={setDone} />
      <AppUsage />
    </Screen>
  );
}

/** The Board's way in: how many website enquiries are waiting, red while any are. */
export function WebsiteAppRow({ last }: { last?: boolean }) {
  const { me, data } = useClub();
  const navigation = useNavigation<NavigationProp<RootParams>>();
  const { enquiries } = useEnquiries();
  const waiting = isAnyBoard(me, data.positions) ? enquiries.filter((e) => e.handledAt === null).length : 0;
  return (
    <ListRow
      last={last}
      left={<IconBadge icon="globe-outline" tone={waiting > 0 ? 'red' : 'steel'} />}
      title="Website and app"
      subtitle={waiting > 0 ? `${waiting} website ${waiting === 1 ? 'enquiry' : 'enquiries'} waiting` : 'Enquiries, news, visits, app feedback and usage'}
      onPress={() => navigation.navigate('WebsiteApp')}
    />
  );
}
