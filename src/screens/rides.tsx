// The ride calendar: the club website's rides by month, filtered by colour, and one ride with
// Going / Maybe / Can't make it. Rides come from the calendar sync; nobody edits them here.

import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { formatAuDate } from '../domain/dates';
import { RIDE_CATEGORIES, RIDE_CATEGORY_LABEL, RSVP_LABEL } from '../domain/labels';
import { displayName, initials } from '../domain/profile';
import {
  calendarFreshness,
  defaultCategories,
  lastDay,
  melbourneDate,
  melbourneTime,
  rsvpCounts,
  rsvpProblem,
  upcomingByMonth,
} from '../domain/rides';
import type { Member, Ride, RideCategory, RsvpAnswer } from '../domain/types';
import type { RootScreen, TabScreen } from '../navigation/types';
import { RideChatRows } from './chat';
import { colors, fonts, radius, rideColors, space, type } from '../theme';
import {
  Avatar,
  Body,
  Card,
  Chip,
  H1,
  Ionicons,
  ListRow,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
  type IconName,
} from '../ui/primitives';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The weekday of a YYYY-MM-DD calendar date. */
function weekday(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** "7:30 am", "All day", or "All day, to 31/01/2027". */
function startLabel(ride: Ride): string {
  if (!ride.allDay) return melbourneTime(ride.startsAt);
  const last = lastDay(ride);
  return last > melbourneDate(ride.startsAt) ? `All day, to ${formatAuDate(last)}` : 'All day';
}

/** "7:30 am – 12:00 pm", or the end's date too when it finishes on another day. */
function timeRange(ride: Ride): string {
  if (ride.allDay || !ride.endsAt) return startLabel(ride);
  const sameDay = melbourneDate(ride.endsAt) === melbourneDate(ride.startsAt);
  const end = sameDay ? melbourneTime(ride.endsAt) : `${formatAuDate(melbourneDate(ride.endsAt))} ${melbourneTime(ride.endsAt)}`;
  return `${melbourneTime(ride.startsAt)} – ${end}`;
}

const ANSWER_ICON: Record<RsvpAnswer, IconName> = { going: 'checkmark-circle', maybe: 'help-circle', no: 'close-circle' };
const ANSWER_TONE = { going: 'ok', maybe: 'warn', no: 'steel' } as const;

/** A category colour chip, in the website's colours. */
function RideChip({ category }: { category: RideCategory }) {
  const c = rideColors[category];
  return (
    <View style={[styles.rideChip, { backgroundColor: c.bg, borderColor: c.bg }]}>
      <Text style={[styles.chipText, { color: c.fg }]}>{RIDE_CATEGORY_LABEL[category]}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Rides tab
// ---------------------------------------------------------------------------

export function RidesScreen({ navigation }: TabScreen<'Rides'>) {
  const { me, data, today, isDemo, refresh } = useClub();
  const [shown, setShown] = useState<RideCategory[] | null>(null);
  if (!me) return null;
  const categories = shown ?? defaultCategories(me, data.chapters);
  const months = upcomingByMonth(data.rides, categories, today);
  const anyComing = upcomingByMonth(data.rides, RIDE_CATEGORIES, today).length > 0;
  const freshness = isDemo ? null : calendarFreshness(data.ridesSyncedAt ?? null, data.rides.length > 0, new Date().toISOString());
  const toggle = (c: RideCategory) =>
    setShown(categories.includes(c) ? categories.filter((x) => x !== c) : [...categories, c]);

  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      <View style={styles.filters} accessibilityLabel="Show rides by colour">
        {RIDE_CATEGORIES.map((c) => {
          const on = categories.includes(c);
          const col = rideColors[c];
          return (
            <Pressable
              key={c}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              accessibilityLabel={`${RIDE_CATEGORY_LABEL[c]} rides`}
              onPress={() => toggle(c)}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.filter,
                on ? { backgroundColor: col.bg, borderColor: col.bg } : (pressed || hovered) && { backgroundColor: colors.steel },
              ]}
            >
              {on ? (
                <Ionicons name="checkmark" size={14} color={col.fg} />
              ) : (
                <View style={[styles.swatch, { backgroundColor: col.bg }]} />
              )}
              <Text style={[styles.filterText, { color: on ? col.fg : colors.boneDim }]}>{RIDE_CATEGORY_LABEL[c]}</Text>
            </Pressable>
          );
        })}
      </View>

      {freshness?.stale ? <Notice tone="warn">{freshness.text}</Notice> : null}

      {months.length === 0 ? (
        <Notice title="No rides coming up.">
          {anyComing ? 'Turn on more colours above to see other rides.' : 'New rides show up here once they’re on the club calendar.'}
        </Notice>
      ) : null}

      {months.map((g) => (
        <Stack key={g.month} gap={space.sm}>
          <SectionTitle title={g.month} />
          <Card style={{ padding: 0, gap: 0 }}>
            {g.rides.map((ride, i) => (
              <RideRow
                key={ride.id}
                ride={ride}
                going={rsvpCounts(ride.id, data.rsvps).going}
                mine={data.rsvps.find((r) => r.rideId === ride.id && r.memberId === me.id)?.answer ?? null}
                last={i === g.rides.length - 1}
                onPress={() => navigation.navigate('RideDetail', { rideId: ride.id })}
              />
            ))}
          </Card>
        </Stack>
      ))}

      {freshness && !freshness.stale ? <Small style={{ textAlign: 'center' }}>{freshness.text}</Small> : null}
    </Screen>
  );
}

function RideRow({
  ride,
  going,
  mine,
  last,
  onPress,
}: {
  ride: Ride;
  going: number;
  mine: RsvpAnswer | null;
  last: boolean;
  onPress: () => void;
}) {
  const date = melbourneDate(ride.startsAt);
  const cancelled = !!ride.cancelledAt;
  const label = [
    ride.title,
    cancelled ? 'cancelled' : null,
    `${weekday(date)} ${formatAuDate(date)}`,
    startLabel(ride),
    ride.location,
    RIDE_CATEGORY_LABEL[ride.category],
    !cancelled && going > 0 ? `${going} going` : null,
    !cancelled && mine ? `you: ${RSVP_LABEL[mine]}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.rideRow,
        last && { borderBottomWidth: 0 },
        (pressed || hovered) && { backgroundColor: colors.steel },
      ]}
    >
      <View style={[styles.dateBlock, { borderTopColor: rideColors[ride.category].bg }, cancelled && styles.faded]}>
        <Text style={styles.dateDay}>{Number(date.slice(8, 10))}</Text>
        <Text style={styles.dateWeekday}>{weekday(date)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text numberOfLines={2} style={[type.name, cancelled && styles.struck]}>
          {ride.title}
        </Text>
        <Text numberOfLines={1} style={[styles.meta, cancelled && styles.faded]}>
          <Text style={styles.metaTime}>{startLabel(ride)}</Text>
          {ride.location ? ` · ${ride.location}` : ''}
        </Text>
        <Row style={{ gap: 6, marginTop: 2 }}>
          <RideChip category={ride.category} />
          {cancelled ? (
            <Chip label="Cancelled" tone="danger" />
          ) : (
            <>
              {going > 0 ? <Chip label={`${going} going`} tone="bone" /> : null}
              {mine ? <Chip label={`You: ${RSVP_LABEL[mine]}`} tone={ANSWER_TONE[mine]} icon={ANSWER_ICON[mine]} /> : null}
            </>
          )}
        </Row>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.boneMute} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// One ride
// ---------------------------------------------------------------------------

const ANSWERS: RsvpAnswer[] = ['going', 'maybe', 'no'];

export function RideDetailScreen({ route, navigation }: RootScreen<'RideDetail'>) {
  const { me, data, setRsvp } = useClub();
  const [busy, setBusy] = useState<RsvpAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ride = data.rides.find((r) => r.id === route.params.rideId);

  if (!ride || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Ride not found">It may have come off the club calendar.</Notice>
      </Screen>
    );
  }

  const date = melbourneDate(ride.startsAt);
  const cancelled = !!ride.cancelledAt;
  const problem = rsvpProblem(me, ride, new Date().toISOString());
  const mine = data.rsvps.find((r) => r.rideId === ride.id && r.memberId === me.id)?.answer ?? null;
  const counts = rsvpCounts(ride.id, data.rsvps);
  const people = (answer: RsvpAnswer) =>
    data.rsvps
      .filter((r) => r.rideId === ride.id && r.answer === answer)
      .map((r) => data.members.find((m) => m.id === r.memberId))
      .filter((m): m is Member => !!m)
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));

  const going = people('going');
  const maybe = people('maybe');

  const answer = async (a: RsvpAnswer) => {
    setError(null);
    setBusy(a);
    try {
      await setRsvp(ride.id, a);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const location = ride.location;
  const openMap = () => {
    if (location) Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(location)}`).catch(() => {});
  };

  const list = (title: string, members: Member[]) => (
    <Stack gap={space.sm}>
      <SectionTitle title={title} action={<Text style={styles.count}>{members.length}</Text>} />
      <Card style={{ padding: 0, gap: 0 }}>
        {members.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>Nobody yet.</Small>
          </View>
        ) : (
          members.map((m, i) => (
            <ListRow
              key={m.id}
              last={i === members.length - 1}
              left={<Avatar text={initials(m)} size={40} />}
              title={displayName(m)}
              subtitle={m.fullName !== displayName(m) ? m.fullName : undefined}
              onPress={() => navigation.navigate('MemberDetail', { memberId: m.id })}
            />
          ))
        )}
      </Card>
    </Stack>
  );

  return (
    <Screen>
      <Card>
        <Row style={{ gap: 6 }}>
          <RideChip category={ride.category} />
          {cancelled ? <Chip label="Cancelled" tone="danger" /> : null}
        </Row>
        <H1 style={cancelled ? styles.struck : undefined}>{ride.title}</H1>
        <Stack gap={space.sm}>
          <Row style={styles.fact}>
            <Ionicons name="calendar-outline" size={18} color={colors.boneMute} />
            <Text style={styles.factText}>{`${weekday(date)} ${formatAuDate(date)}`}</Text>
          </Row>
          <Row style={styles.fact}>
            <Ionicons name="time-outline" size={18} color={colors.boneMute} />
            <Text style={styles.factText}>{timeRange(ride)}</Text>
          </Row>
          {location ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`${location}, open in maps`}
              onPress={openMap}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.place,
                (pressed || hovered) && { backgroundColor: colors.steel },
              ]}
            >
              <Ionicons name="location-outline" size={18} color={colors.redText} />
              <Text style={[styles.factText, { flex: 1, color: colors.bone }]}>{location}</Text>
              <Ionicons name="open-outline" size={16} color={colors.boneMute} />
            </Pressable>
          ) : null}
        </Stack>
        {ride.notes ? <Body selectable>{ride.notes}</Body> : null}
      </Card>

      <Stack gap={space.sm}>
        <SectionTitle title="Your answer" />
        {problem ? <Notice tone={cancelled ? 'danger' : 'info'}>{problem}</Notice> : null}
        <View style={styles.answers}>
          {ANSWERS.map((a) => {
            // While an answer saves, it shows as chosen with a spinner and the others dim.
            const saving = busy === a;
            const selected = busy ? saving : mine === a;
            const disabled = !!problem || busy !== null;
            return (
              <Pressable
                key={a}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled, busy: saving }}
                aria-checked={selected}
                aria-disabled={disabled}
                aria-busy={saving}
                accessibilityLabel={RSVP_LABEL[a]}
                disabled={disabled}
                onPress={() => answer(a)}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.answer,
                  selected && styles.answerSelected,
                  !selected && !disabled && (pressed || hovered) && { backgroundColor: colors.steelHi },
                  (!!problem || (busy !== null && !saving)) && styles.disabled,
                ]}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.bone} style={{ height: 22 }} />
                ) : (
                  <Ionicons
                    name={selected ? ANSWER_ICON[a] : (`${ANSWER_ICON[a]}-outline` as IconName)}
                    size={22}
                    color={selected ? colors.bone : colors.boneDim}
                  />
                )}
                <Text numberOfLines={2} style={[styles.answerText, selected && { color: colors.bone }]}>
                  {RSVP_LABEL[a]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View accessibilityLiveRegion="polite" role="alert">
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </View>
        {counts.no > 0 ? <Small>{`${counts.no} can’t make it.`}</Small> : null}
      </Stack>

      {/* Stage 3 (lane B): the ride's chat and photo wall */}
      <RideChatRows
        rideId={ride.id}
        onOpenChat={(chatId) => navigation.navigate('Chat', { chatId })}
        onOpenWall={() => navigation.navigate('RideWall', { rideId: ride.id })}
      />

      {/* On a cancelled ride, only show who had said yes, so they can be told. */}
      {!cancelled || going.length > 0 ? list('Going', going) : null}
      {!cancelled || maybe.length > 0 ? list('Maybe', maybe) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  filter: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  swatch: { width: 12, height: 12, borderRadius: 2 },
  filterText: { fontFamily: fonts.stencil, fontSize: 14, letterSpacing: 0.6, textTransform: 'uppercase' },
  rideChip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  chipText: { fontFamily: fonts.stencil, fontSize: 11.5, letterSpacing: 1, textTransform: 'uppercase' },
  rideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    minHeight: 44,
  },
  dateBlock: {
    width: 52,
    paddingVertical: 6,
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.steel,
    borderRadius: radius.sm,
    borderTopWidth: 4,
  },
  dateDay: { fontFamily: fonts.stencil, fontSize: 24, lineHeight: 28, color: colors.bone, fontVariant: ['tabular-nums'] },
  dateWeekday: { fontFamily: fonts.stencil, fontSize: 12, letterSpacing: 1, color: colors.boneDim, textTransform: 'uppercase' },
  meta: { ...type.small },
  metaTime: { fontFamily: fonts.stencil, fontSize: 13, letterSpacing: 0.3, color: colors.boneDim },
  struck: { textDecorationLine: 'line-through', color: colors.boneMute },
  faded: { opacity: 0.55 },
  fact: { gap: space.sm, flexWrap: 'nowrap' },
  factText: { fontFamily: fonts.stencil, fontSize: 16, lineHeight: 22, letterSpacing: 0.4, color: colors.boneDim, flexShrink: 1 },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    marginHorizontal: -space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
  count: { fontFamily: fonts.stencil, fontSize: 16, color: colors.boneMute },
  answers: { flexDirection: 'row', gap: space.sm },
  answer: {
    flex: 1,
    minHeight: 72,
    paddingVertical: space.sm,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.steel,
  },
  answerSelected: { backgroundColor: colors.red, borderColor: colors.redBright },
  answerText: { fontFamily: fonts.stencil, fontSize: 14, lineHeight: 18, letterSpacing: 0, color: colors.boneDim, textAlign: 'center' },
  disabled: { opacity: 0.45 },
});
