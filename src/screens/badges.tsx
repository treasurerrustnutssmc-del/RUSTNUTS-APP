// Stage 7: badges. What a member has ridden, from their check-ins: rides, Big 4s, kilometres and
// the states their rides went through. Shown on Me and on a member's page; nothing is posted.

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { useSocial } from '../data/social/SocialProvider';
import { badgeCount, badgesFor, STATE_NAME, toGoLine, type BadgeTrack } from '../domain/social/badges';
import type { Member } from '../domain/types';
import { colors, fonts, radius, space, type } from '../theme';
import { Card, Chip, IconBadge, SectionTitle, Small, type IconName } from '../ui/primitives';

const TRACK: Record<BadgeTrack, { icon: IconName; what: string }> = {
  rides: { icon: 'speedometer', what: 'Club rides checked in to' },
  big4: { icon: 'trophy', what: 'The club’s principal rides of the year' },
  km: { icon: 'navigate', what: 'On the routes of those rides' },
  states: { icon: 'map', what: 'States and territories ridden' },
};

/** The Badges card, for an approved member, seen by approved members. */
export function BadgesCard({ member }: { member: Member }) {
  const { data } = useClub();
  const { allRideRoutes } = useSocial();
  const badges = useMemo(() => badgesFor(member, data, allRideRoutes), [member, data, allRideRoutes]);
  return (
    <>
      <SectionTitle title="Badges" />
      <Card style={{ padding: 0, gap: 0 }}>
        {badges.tracks.map((t, i) => {
          return (
            <View
              key={t.track}
              style={[styles.row, i < badges.tracks.length - 1 && styles.rule]}
              accessible
              accessibilityLabel={[
                badgeCount(t.track, t.value),
                t.earned ? `badge: ${t.earned}` : 'no badge yet',
                toGoLine(t),
                t.track === 'states' && badges.states.length ? badges.states.map((s) => STATE_NAME[s]).join(', ') : '',
              ].filter(Boolean).join('. ')}
            >
              <IconBadge icon={TRACK[t.track].icon} />
              <View style={{ flex: 1, gap: 6 }}>
                <View style={styles.head}>
                  <Text style={styles.count}>{badgeCount(t.track, t.value)}</Text>
                  {t.earned ? <Chip label={t.earned} tone="bone" /> : null}
                </View>
                <Small>{TRACK[t.track].what}</Small>
                {t.track === 'states' && badges.states.length ? (
                  <View style={styles.states}>
                    {badges.states.map((s) => (
                      <Chip key={s} label={s} />
                    ))}
                  </View>
                ) : null}
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.round(t.progress * 100)}%` }]} />
                </View>
                <Text style={styles.next}>{toGoLine(t)}</Text>
              </View>
            </View>
          );
        })}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, padding: space.lg, alignItems: 'flex-start' },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.line },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  count: { ...type.name, fontSize: 18, fontVariant: ['tabular-nums'] },
  states: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  track: { height: 4, borderRadius: radius.sm, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.bone },
  next: { fontFamily: fonts.stencil, fontSize: 13, color: colors.boneMute },
});
