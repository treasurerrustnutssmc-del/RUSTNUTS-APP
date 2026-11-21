/**
 * Home's new top and bottom (Jeff, 21 Nov 2026: "Approvals top regos bottom").
 * HomeNeedsYouCard: everything waiting on you, approvals first, right under the greeting.
 * HomeQuickActions: the everyday jobs that aren't already a tab, one tap each.
 * HomeReminders: your own rego, licence and first aid boxes, and the board's renewals row, last.
 * Spec: docs/superpowers/specs/2026-11-21-home-needs-you-design.md
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useClub } from '../data/ClubStore';
import { seesEveryChapter } from '../domain/access';
import { homeNeedsYou } from '../domain/homeNeedsYou';
import { alertFix, expiryAlerts, type ExpiryAlert } from '../domain/profile';
import { colors, radius, space, type } from '../theme';
import { Card, H2, IconBadge, Ionicons, ListRow, Notice, type IconName } from '../ui/primitives';

const nowInstant = () => new Date().toISOString();

type Nav = { navigate: (screen: any, params?: any) => void };

/** Approvals, then what's waiting on you personally. Hidden when there's nothing. */
export function HomeNeedsYouCard() {
  const { me, data, today } = useClub();
  const navigation = useNavigation<Nav>();
  // Worked out again only when the club data, the person or the day changes, not on every render.
  const items = useMemo(() => homeNeedsYou(me, data, today, nowInstant()), [me, data, today]);
  if (!items.length) return null;
  return (
    <Card style={{ padding: 0, gap: 0, borderColor: colors.redBright }}>
      <View style={styles.head}>
        <H2>Needs you</H2>
        <Text
          accessibilityLabel={`${items.length} ${items.length === 1 ? 'thing' : 'things'} waiting`}
          style={[type.name, { color: colors.boneDim, fontVariant: ['tabular-nums'] }]}
        >
          {items.length}
        </Text>
      </View>
      {items.map((i, n) => (
        <ListRow
          key={i.key}
          left={<IconBadge icon={i.icon as IconName} tone={i.group === 'approve' ? 'red' : undefined} />}
          title={i.title}
          subtitle={i.subtitle}
          onPress={() => navigation.navigate(i.to.screen, i.to.params)}
          last={n === items.length - 1}
        />
      ))}
    </Card>
  );
}

const QUICK: { key: string; icon: IconName; label: string; screen: string; mine?: boolean }[] = [
  { key: 'fees', icon: 'wallet-outline', label: 'My fees', screen: 'MemberFees', mine: true },
  { key: 'bus', icon: 'bus-outline', label: 'Rusty Bus', screen: 'Bus' },
  { key: 'docs', icon: 'folder-open-outline', label: 'Documents', screen: 'Documents' },
  { key: 'feedback', icon: 'megaphone-outline', label: 'Tell us', screen: 'Feedback' },
];

/** The everyday jobs that aren't a tab already: one tap from Home. */
export function HomeQuickActions() {
  const { me } = useClub();
  const navigation = useNavigation<Nav>();
  if (!me || me.approval !== 'approved') return null;
  return (
    <View style={styles.grid} accessibilityRole="toolbar" accessibilityLabel="Quick buttons">
      {QUICK.map((q) => (
        <Pressable
          key={q.key}
          accessibilityRole="button"
          accessibilityLabel={q.label}
          onPress={() => navigation.navigate(q.screen, q.mine ? { memberId: me.id } : undefined)}
          style={({ pressed }) => [styles.tile, pressed && { backgroundColor: colors.steel }]}
        >
          <Ionicons name={q.icon} size={22} color={colors.bone} />
          <Text style={type.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {q.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Rego, licence and first aid: your own boxes, then the board's renewals row. At the bottom of Home. */
export function HomeReminders() {
  const { me, data, level, today } = useClub();
  const navigation = useNavigation<Nav>();
  if (!me) return null;
  const myAlerts = expiryAlerts([me], data, today);
  const isBoard = level === 'board' || level === 'national';
  const everyChapter = seesEveryChapter(me, data.positions);
  const scope = isBoard
    ? data.members.filter((m) => m.approval === 'approved' && (everyChapter || m.chapterId === me.chapterId))
    : [];
  const board = isBoard ? expiryAlerts(scope, data, today) : [];
  if (!myAlerts.length && !board.length) return null;
  const openFix = (a: ExpiryAlert) => {
    const fix = alertFix(a);
    if (fix.screen === 'EditBike') navigation.navigate('EditBike', { bikeId: fix.bikeId });
    else navigation.navigate('EditProfile');
  };
  return (
    <View style={{ gap: space.md }}>
      <H2 style={{ marginTop: space.sm }}>Reminders</H2>
      {myAlerts.map((a) => (
        <Notice key={`${a.kind}-${a.bikeId ?? ''}-${a.label}`} tone={a.state === 'expired' ? 'danger' : 'warn'} title={a.label} onPress={() => openFix(a)}>
          {`${a.description}. Tap to update it once it’s renewed.`}
        </Notice>
      ))}
      {board.length ? (
        <Card style={{ padding: 0, gap: 0 }}>
          <ListRow
            left={<IconBadge icon="alert-circle" />}
            title={`${board.length} ${board.length === 1 ? 'rego, licence or first aid renewal needs' : 'rego, licence or first aid renewals need'} attention`}
            subtitle={`${board.filter((a) => a.state === 'expired').length} expired, ${board.filter((a) => a.state === 'soon').length} due within 30 days`}
            onPress={() => navigation.navigate('Board', { focus: 'alerts' })}
            last
            lines="all"
          />
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.lg, paddingBottom: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: colors.ink2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
});
