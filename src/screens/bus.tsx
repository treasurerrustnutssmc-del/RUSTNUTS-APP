// The Rusty Bus (the club van, for charity rides and vehicle recovery): when it's free, what's
// coming up, and asking for it. The board and NEC say yes or no to what's waiting; whoever
// booked it, its driver or the board can call it off.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import {
  BUS_CLASH,
  BUS_NOTES_TOO_LONG,
  BUS_PURPOSES,
  BUS_REASON_TOO_LONG,
  MAX_BUS_NOTES,
  MAX_BUS_REASON,
  NOT_BUS_BOOKER,
  NO_YES_IN_TIME,
  RIDE_CALLED_OFF,
  RIDE_CALLED_OFF_HINT,
  bookProblem,
  bookedStraightAway,
  busDrivers,
  busMonthLabel,
  busPersonName,
  busPurposeLabel,
  busRide,
  busShownStatus,
  busToday,
  busTodayLine,
  canBookBus,
  cancelProblem,
  clashLine,
  clashesWith,
  decideProblem,
  formatDays,
  managesBus,
  myRecentOff,
  notAnswered,
  rideCalledOff,
  ridesInDays,
  upcomingBus,
  waitingForYes,
  type BusInput,
} from '../domain/bus';
import { charCount } from '../domain/chat';
import { daysBetween, formatAuDate, parseAuDate, typeDate, weekday } from '../domain/dates';
import { displayName } from '../domain/profile';
import { lastDay, melbourneDate } from '../domain/rides';
import type { BusBooking, BusPurpose, BusStatus, ClubData, Member } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { colors, fonts, radius, space, type } from '../theme';
import {
  Body,
  Button,
  Card,
  Chip,
  Choices,
  ConfirmButton,
  Divider,
  Field,
  H1,
  Ionicons,
  Label,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
  type IconName,
} from '../ui/primitives';

type ChipLook = { tone: 'ok' | 'warn' | 'danger' | 'steel'; icon: IconName };
const STATUS_CHIP: Record<BusStatus, ChipLook> = {
  approved: { tone: 'ok', icon: 'checkmark' },
  requested: { tone: 'warn', icon: 'time-outline' },
  declined: { tone: 'danger', icon: 'close' },
  cancelled: { tone: 'steel', icon: 'remove' },
};
const NOT_ANSWERED_CHIP: ChipLook = { tone: 'steel', icon: 'hourglass-outline' };

/** Booked in green, Waiting in amber, Declined in the danger colour, Cancelled and Not answered in steel. */
function StatusChip({ booking, today }: { booking: BusBooking; today: string }) {
  const s = notAnswered(booking, today) ? NOT_ANSWERED_CHIP : STATUS_CHIP[booking.status];
  return <Chip label={busShownStatus(booking, today)} tone={s.tone} icon={s.icon} />;
}

/** A Melbourne date for a stored time: "24/10/2026". */
const dayOf = (at: string) => formatAuDate(melbourneDate(at));

/** "Sat 16/01/2027" for a calendar ride. */
const rideDay = (startsAt: string) => {
  const d = melbourneDate(startsAt);
  return `${weekday(d)} ${formatAuDate(d)}`;
};

/**
 * One booking as a row: its days and status, what it's for and who, a linked ride's title (and
 * whether that ride was called off), and anything extra such as a clash or a reason.
 */
function BookingRow({
  booking,
  data,
  today,
  meta,
  extra,
  extraLabel,
  showStatus = true,
  last,
  onPress,
}: {
  booking: BusBooking;
  data: ClubData;
  today: string;
  /** The line under the days, such as "Charity ride · Gravel driving". */
  meta: string;
  /** Anything under that, such as a clash or a reason. */
  extra?: React.ReactNode;
  /** What `extra` says, for screen readers (the row's label replaces what's in it). */
  extraLabel?: string | null;
  /** Off on the managers' list, where every row is Waiting. */
  showStatus?: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const ride = busRide(booking, data);
  const calledOff = rideCalledOff(booking, data);
  const days = formatDays(booking.firstDay, booking.lastDay);
  const label = [days, showStatus ? busShownStatus(booking, today) : null, meta, ride?.title, calledOff ? RIDE_CALLED_OFF : null, extraLabel];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label.filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        last && { borderBottomWidth: 0 },
        (pressed || hovered) && { backgroundColor: colors.steel },
      ]}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={type.name}>{days}</Text>
        <Text style={styles.meta}>{meta}</Text>
        {ride ? (
          <Row style={styles.rideLine}>
            <Ionicons name="calendar-outline" size={14} color={colors.boneMute} />
            <Text numberOfLines={1} style={[styles.meta, { flexShrink: 1 }]}>
              {ride.title}
            </Text>
          </Row>
        ) : null}
        {calledOff ? <ClashText line={RIDE_CALLED_OFF} /> : null}
        {extra}
        {showStatus ? (
          <Row style={{ gap: 6, marginTop: 2 }}>
            <StatusChip booking={booking} today={today} />
          </Row>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.boneMute} />
    </Pressable>
  );
}

/** An amber line beside an alert: "Clashes with Recovery 03/11/2026", or the ride being called off. */
function ClashText({ line }: { line: string }) {
  return (
    <Row style={styles.clash}>
      <Ionicons name="alert-circle" size={16} color={colors.warn} style={{ marginTop: 1 }} />
      <Text style={styles.clashText}>{line}</Text>
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Rusty Bus
// ---------------------------------------------------------------------------

export function BusScreen({ navigation }: RootScreen<'Bus'>) {
  const { me, data, today } = useClub();
  if (!me) return null;
  if (me.approval !== 'approved') {
    return (
      <Screen>
        <Notice tone="warn">Only approved members can see the Rusty Bus.</Notice>
      </Screen>
    );
  }
  const out = busToday(data, today);
  const canBook = canBookBus(me, data);
  const manager = managesBus(me, data);
  const waiting = manager ? waitingForYes(data, today) : [];
  const months = upcomingBus(data, today);
  const off = myRecentOff(me, data, today);
  const open = (bookingId: string) => navigation.navigate('BusBooking', { bookingId });

  const head = (
    <Row style={styles.heroHead}>
      <View style={styles.busTile} aria-hidden importantForAccessibility="no-hide-descendants">
        <Ionicons name="bus" size={28} color={colors.bone} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={styles.todayLine}>{busTodayLine(data, today)}</Text>
        {out ? (
          <Text style={styles.meta}>{out.firstDay === out.lastDay ? 'Just today' : `Until ${formatAuDate(out.lastDay)}`}</Text>
        ) : null}
      </View>
      {out ? <Ionicons name="chevron-forward" size={18} color={colors.boneMute} /> : null}
    </Row>
  );

  return (
    <Screen>
      <Card style={styles.hero}>
        {out ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${busTodayLine(data, today)}. See the booking`}
            onPress={() => open(out.id)}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.heroPress,
              (pressed || hovered) && { backgroundColor: colors.steel },
            ]}
          >
            {head}
          </Pressable>
        ) : (
          head
        )}
        {canBook ? (
          <Button label="Book the Rusty Bus" icon="add" style={styles.bigButton} onPress={() => navigation.navigate('BookBus', {})} />
        ) : (
          <Small>{NOT_BUS_BOOKER}</Small>
        )}
      </Card>

      {manager ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Waiting for a yes" action={<Text style={styles.count}>{waiting.length}</Text>} />
          <Card style={{ padding: 0, gap: 0 }}>
            {waiting.length === 0 ? (
              <View style={{ padding: space.lg }}>
                <Small>Nothing waiting.</Small>
              </View>
            ) : (
              waiting.map((b, i) => {
                const clash = clashLine(clashesWith({ first: b.firstDay, last: b.lastDay }, data, b.id));
                return (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    data={data}
                    today={today}
                    meta={`${busPurposeLabel(b.purpose)} · asked by ${busPersonName(b.bookedBy, data)}`}
                    extra={clash ? <ClashText line={clash} /> : undefined}
                    extraLabel={clash}
                    showStatus={false}
                    last={i === waiting.length - 1}
                    onPress={() => open(b.id)}
                  />
                );
              })
            )}
          </Card>
        </Stack>
      ) : null}

      <Stack gap={space.sm}>
        <SectionTitle title="Coming up" />
        {months.length === 0 ? (
          <Notice title="Nothing booked">The bus is free for every day ahead.</Notice>
        ) : (
          <Stack gap={space.lg}>
            {months.map((g) => (
              <Stack key={g.month} gap={space.sm}>
                <Text style={styles.month}>{busMonthLabel(g.month)}</Text>
                <Card style={{ padding: 0, gap: 0 }}>
                  {g.bookings.map((b, i) => (
                    <BookingRow
                      key={b.id}
                      booking={b}
                      data={data}
                      today={today}
                      meta={`${busPurposeLabel(b.purpose)} · ${busPersonName(b.driverId, data)} driving`}
                      last={i === g.bookings.length - 1}
                      onPress={() => open(b.id)}
                    />
                  ))}
                </Card>
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>

      {off.length > 0 ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Yours" />
          <Small>Your bookings from the last 30 days that came off or went unanswered.</Small>
          <Card style={{ padding: 0, gap: 0 }}>
            {off.map((b, i) => (
              <BookingRow
                key={b.id}
                booking={b}
                data={data}
                today={today}
                meta={
                  b.status === 'declined'
                    ? `${busPurposeLabel(b.purpose)} · no from ${busPersonName(b.decidedBy, data)}`
                    : b.status === 'cancelled'
                      ? `${busPurposeLabel(b.purpose)} · cancelled by ${busPersonName(b.cancelledBy, data)}`
                      : `${busPurposeLabel(b.purpose)} · asked for on ${dayOf(b.bookedAt)}`
                }
                extra={
                  b.status === 'declined' && b.declineReason ? (
                    <Small numberOfLines={2} style={{ color: colors.boneDim }}>
                      {b.declineReason}
                    </Small>
                  ) : undefined
                }
                extraLabel={b.status === 'declined' ? b.declineReason : null}
                last={i === off.length - 1}
                onPress={() => open(b.id)}
              />
            ))}
          </Card>
        </Stack>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export function BusBookingScreen({ route, navigation }: RootScreen<'BusBooking'>) {
  const { me, data, today, decideBus, cancelBus } = useClub();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const booking = (data.busBookings ?? []).find((b) => b.id === route.params.bookingId);
  if (!me) return null;
  if (me.approval !== 'approved') {
    return (
      <Screen>
        <Notice tone="warn">Only approved members can see the Rusty Bus.</Notice>
      </Screen>
    );
  }
  if (!booking) {
    return (
      <Screen>
        <Notice tone="warn" title="Booking not found">{'It may have been removed. The Rusty Bus screen has what’s coming up.'}</Notice>
      </Screen>
    );
  }

  const ride = busRide(booking, data);
  const calledOff = rideCalledOff(booking, data);
  const name = (id: string | null) => busPersonName(id, data);
  const length = daysBetween(booking.firstDay, booking.lastDay) + 1;
  const waiting = booking.status === 'requested';
  const unanswered = notAnswered(booking, today);
  // Only a booking that was ever Booked (a yes, or straight away) was booked; the rest were asked for.
  const everBooked = booking.status === 'approved' || (booking.status === 'cancelled' && booking.decidedAt !== null);
  const deciding = waiting && managesBus(me, data) && decideProblem(me, booking, false, '', data, today) === null;
  const yesProblem = deciding ? decideProblem(me, booking, true, '', data, today) : null;
  // The Booked booking a Waiting one clashes with: the board's reason for Say yes being off, and
  // for anyone else (its booker, say) the reason no yes can come yet.
  const clash = waiting && !unanswered ? clashLine(clashesWith({ first: booking.firstDay, last: booking.lastDay }, data, booking.id)) : null;
  const reasonTooLong = charCount(reason.trim()) > MAX_BUS_REASON;
  const cancellable = cancelProblem(me, booking, data, today) === null;

  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setError(null);
    setBusy(label);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      {booking.status === 'declined' ? (
        <Notice tone="danger" title={`No from ${name(booking.decidedBy)}`}>
          <Stack gap={space.xs}>
            {booking.declineReason ? (
              <Body selectable style={{ color: colors.bone }}>
                {booking.declineReason}
              </Body>
            ) : null}
            {booking.decidedAt ? <Text style={styles.metaDim}>{`Said no on ${dayOf(booking.decidedAt)}`}</Text> : null}
          </Stack>
        </Notice>
      ) : booking.status === 'cancelled' ? (
        <Notice title={`Cancelled by ${name(booking.cancelledBy)}`}>
          <Stack gap={space.xs}>
            {everBooked ? <Small style={{ color: colors.boneDim }}>The bus is free for these days again.</Small> : null}
            {booking.cancelledAt ? <Text style={styles.metaDim}>{`Cancelled on ${dayOf(booking.cancelledAt)}`}</Text> : null}
          </Stack>
        </Notice>
      ) : null}

      <Card>
        <Row style={{ gap: 6 }}>
          <StatusChip booking={booking} today={today} />
        </Row>
        <H1>{busPurposeLabel(booking.purpose)}</H1>
        <Stack gap={space.sm}>
          <Row style={styles.fact}>
            <Ionicons name="calendar-outline" size={18} color={colors.boneMute} />
            <Text style={styles.factText}>
              {formatDays(booking.firstDay, booking.lastDay)}
              {length > 1 ? <Text style={styles.factMute}>{`  ${length} days`}</Text> : null}
            </Text>
          </Row>
          <Row style={styles.fact}>
            <Ionicons name="person-outline" size={18} color={colors.boneMute} />
            <Text style={styles.factText}>{`${name(booking.driverId)} driving`}</Text>
          </Row>
          {ride ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`${ride.title}, ${rideDay(ride.startsAt)}, see the ride`}
              onPress={() => navigation.navigate('RideDetail', { rideId: ride.id })}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.link,
                (pressed || hovered) && { backgroundColor: colors.steel },
              ]}
            >
              <Ionicons name="flag-outline" size={18} color={colors.redText} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.factText, { color: colors.bone }]}>{ride.title}</Text>
                <Text style={styles.metaDim}>{rideDay(ride.startsAt)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.boneMute} />
            </Pressable>
          ) : null}
          {calledOff ? (
            <Stack gap={space.xs}>
              <ClashText line={RIDE_CALLED_OFF} />
              {cancellable ? <Small style={{ color: colors.boneDim }}>{RIDE_CALLED_OFF_HINT}</Small> : null}
            </Stack>
          ) : null}
        </Stack>
        {booking.notes ? <Body selectable>{booking.notes}</Body> : null}
        <Divider />
        <Stack gap={space.xs}>
          <Text style={styles.metaDim}>
            {`${everBooked ? 'Booked' : 'Asked for'} by ${name(booking.bookedBy)} on ${dayOf(booking.bookedAt)}`}
          </Text>
          {everBooked && booking.decidedAt && booking.decidedBy !== booking.bookedBy ? (
            <Text style={styles.metaDim}>{`Yes from ${name(booking.decidedBy)} on ${dayOf(booking.decidedAt)}`}</Text>
          ) : null}
          {unanswered ? (
            <Text style={styles.metaDim}>{NO_YES_IN_TIME}</Text>
          ) : waiting && !deciding ? (
            <Text style={styles.metaDim}>Waiting for a yes from the board or NEC</Text>
          ) : null}
        </Stack>
        {clash && !deciding ? (
          <Stack gap={space.xs}>
            <ClashText line={clash} />
            <Small style={{ color: colors.boneDim }}>The board can only say yes once that booking comes off.</Small>
          </Stack>
        ) : null}
      </Card>

      {deciding ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Your call" />
          <Card>
            {clash ? (
              <Stack gap={space.xs}>
                <ClashText line={clash} />
                <Small style={{ color: colors.boneDim }}>Say yes once that booking comes off, or say no.</Small>
              </Stack>
            ) : null}
            <Button
              label="Say yes"
              icon="checkmark"
              busy={busy === 'yes'}
              disabled={yesProblem !== null || (busy !== null && busy !== 'yes')}
              onPress={() => run('yes', () => decideBus(booking.id, true, ''))}
            />
            <Divider />
            <Field
              label="Reason, if it’s a no"
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. The bus is at the charity ride that weekend"
              multiline
              autoCapitalize="sentences"
              hint="Optional. Whoever booked it sees this."
              error={reasonTooLong ? BUS_REASON_TOO_LONG : null}
            />
            {busy === 'no' ? (
              <Button label="Say no" kind="secondary" busy onPress={() => {}} />
            ) : (
              <ConfirmButton
                label="Say no"
                confirmLabel="Yes, say no"
                kind="secondary"
                icon="close"
                disabled={reasonTooLong || busy !== null}
                onConfirm={() => run('no', () => decideBus(booking.id, false, reason))}
              />
            )}
          </Card>
        </Stack>
      ) : null}

      {cancellable ? (
        busy === 'cancel' ? (
          <Button label="Cancel booking" kind="secondary" busy onPress={() => {}} />
        ) : (
          <ConfirmButton
            label="Cancel booking"
            confirmLabel="Yes, cancel it"
            kind="secondary"
            icon="close-circle-outline"
            confirmNote={waiting ? 'It comes off the board’s list.' : 'The bus goes back to free for these days.'}
            disabled={busy !== null}
            onConfirm={() => run('cancel', () => cancelBus(booking.id))}
          />
        )
      ) : null}

      <View accessibilityLiveRegion="polite" role="alert">
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Book the Rusty Bus
// ---------------------------------------------------------------------------

const DATE_HINT = 'Use DD/MM/YYYY, like 08/11/2026.';

/** A DD/MM/YYYY box's state: what's typed, the ISO date when it's a real one, and its error. */
function useDay(initialIso: string) {
  const [text, setRaw] = useState(formatAuDate(initialIso));
  const trimmed = text.trim();
  const iso = trimmed ? parseAuDate(trimmed) : null;
  // Only once it's fully typed, so it doesn't complain halfway through a date.
  const error = trimmed.length >= 10 && !iso ? DATE_HINT : null;
  return { text, setText: (t: string) => setRaw(typeDate(t)), iso, error };
}

export function BookBusScreen({ route, navigation }: RootScreen<'BookBus'>) {
  const { me, data, today, bookBus } = useClub();
  // Opened from a ride: its days and the ride to start with.
  const fromRide = route.params?.rideId ? data.rides.find((r) => r.id === route.params?.rideId) : undefined;
  const rideStart = fromRide ? melbourneDate(fromRide.startsAt) : '';
  const first = useDay(fromRide ? (rideStart < today ? today : rideStart) : '');
  const last = useDay(fromRide ? lastDay(fromRide) : '');
  // The last day follows the first until it's typed in itself, so one day needs typing once.
  const [lastTyped, setLastTyped] = useState(!!fromRide);
  const [purpose, setPurpose] = useState<BusPurpose | null>(null);
  const [rideId, setRideId] = useState<string | null>(fromRide?.id ?? null);
  const [driverId, setDriverId] = useState<string | null>(me?.id ?? null);
  const [picking, setPicking] = useState(false);
  const [find, setFind] = useState('');
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!me) return null;
  if (!canBookBus(me, data)) {
    return (
      <Screen>
        <Notice tone="warn">{NOT_BUS_BOOKER}</Notice>
      </Screen>
    );
  }

  const firstDay = first.iso ?? '';
  const lastDayIso = (lastTyped ? last.iso : first.iso) ?? '';
  const input: BusInput = { firstDay, lastDay: lastDayIso, purpose, rideId, driverId, notes };
  const straightAway = bookedStraightAway(me, input, today, data);
  const range = firstDay && lastDayIso && lastDayIso >= firstDay ? { first: firstDay, last: lastDayIso } : null;
  const clashes = range ? clashesWith(range, data) : [];
  const clash = clashLine(clashes);
  const manager = managesBus(me, data);
  // Booked straight away onto Booked days can only be refused, so Book it is off and the clash says why.
  const blocked = straightAway && clashes.length > 0;
  const problem = bookProblem(me, input, data, today);
  const notesTooLong = charCount(notes.trim()) > MAX_BUS_NOTES;
  // Refusals show from the first tap on, and follow the form as it's fixed. A clash already has
  // its own line, and the notes their own error, so they aren't said twice.
  const shownProblem = tried && problem !== BUS_CLASH && problem !== BUS_NOTES_TOO_LONG ? problem : null;
  const shownError = saveError ?? shownProblem;

  const onRides = range ? ridesInDays(range, data) : [];
  const picked = rideId ? data.rides.find((r) => r.id === rideId) : undefined;
  // A ride already picked stays on the list when the days move off it, so it never vanishes unseen.
  const rideOptions = picked && !onRides.some((r) => r.id === picked.id) ? [picked, ...onRides] : onRides;

  const drivers = busDrivers(data);
  const findText = find.trim().toLowerCase();
  const found = findText
    ? drivers.filter((m) => displayName(m).toLowerCase().includes(findText) || m.fullName.toLowerCase().includes(findText))
    : drivers;
  const driver = drivers.find((m) => m.id === driverId);

  const save = async () => {
    if (saving) return;
    setTried(true);
    setSaveError(null);
    if (problem) {
      if (problem === BUS_CLASH || problem === BUS_NOTES_TOO_LONG) setSaveError(problem);
      return;
    }
    setSaving(true);
    try {
      const id = await bookBus(input);
      // The new booking takes the form's place, so Back goes to where Book was opened from.
      navigation.replace('BusBooking', { bookingId: id });
    } catch (e) {
      setSaveError((e as Error).message);
      setSaving(false);
    }
  };
  const change = <T,>(set: (v: T) => void) => (v: T) => {
    setSaveError(null);
    set(v);
  };

  return (
    <Screen>
      <Stack gap={space.sm}>
        <Row style={styles.days2}>
          <View style={{ flex: 1 }}>
            <Field
              label="First day"
              value={first.text}
              onChangeText={change(first.setText)}
              placeholder="DD/MM/YYYY"
              inputMode="numeric"
              maxLength={10}
              error={first.error}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Last day"
              value={lastTyped ? last.text : first.text}
              onChangeText={change((t: string) => {
                setLastTyped(true);
                last.setText(t);
              })}
              placeholder="DD/MM/YYYY"
              inputMode="numeric"
              maxLength={10}
              error={lastTyped ? last.error : null}
            />
          </View>
        </Row>
        <Small>Whole days, up to 14 in a row, and no more than 12 months ahead.</Small>
      </Stack>

      {/* The Booked booking these days hit, as the days are typed. */}
      <View accessibilityLiveRegion="polite" role="alert" style={clash ? null : styles.emptyRegion}>
        {clash ? (
          <View style={styles.clashBlock}>
            <ClashText line={clash} />
            <Small style={{ color: colors.boneDim }}>
              {!straightAway
                ? 'You can still ask, but the board can only say yes if that booking comes off.'
                : manager
                  ? 'It can’t be booked twice, so Book it is off. Pick other days, or cancel that booking first.'
                  : 'It can’t be booked twice, so Book it is off. Pick other days, or ask the board about that booking.'}
            </Small>
          </View>
        ) : null}
      </View>

      <Choices<BusPurpose>
        label="What’s it for?"
        options={BUS_PURPOSES.map((p) => ({ value: p, label: busPurposeLabel(p) }))}
        value={purpose}
        onChange={change(setPurpose)}
      />

      <View style={styles.field}>
        <Label>For a ride?</Label>
        <Card style={{ padding: 0, gap: 0 }}>
          <RadioRow label="No ride" on={rideId === null} last={rideOptions.length === 0} onPress={() => change(setRideId)(null)} />
          {rideOptions.map((r, i) => (
            <RadioRow
              key={r.id}
              label={r.title}
              sub={rideDay(r.startsAt)}
              on={rideId === r.id}
              last={i === rideOptions.length - 1}
              onPress={() => change(setRideId)(r.id)}
            />
          ))}
        </Card>
        <Small>
          {range
            ? onRides.length === 0
              ? 'No calendar rides on those days.'
              : 'Calendar rides on those days.'
            : 'Type the days to see the calendar rides on them.'}
        </Small>
      </View>

      <View style={styles.field}>
        <Label>Driver</Label>
        <Card style={styles.driverCard}>
          <Row style={styles.driverHead}>
            <Ionicons name="person-outline" size={18} color={colors.boneMute} />
            <Text style={[type.name, { flex: 1 }]}>
              {driver ? `${displayName(driver)}${driver.id === me.id ? ' (you)' : ''}` : 'Nobody picked'}
            </Text>
          </Row>
          {picking ? null : (
            <Button label="Pick someone else" kind="secondary" icon="people-outline" onPress={() => setPicking(true)} />
          )}
          {picking ? (
            <Stack gap={space.sm}>
              <Field label="Find a member" value={find} onChangeText={setFind} placeholder="Road name or name" autoCapitalize="none" autoCorrect={false} />
              <View style={styles.pickList}>
                {found.length === 0 ? (
                  <View style={{ padding: space.md }}>
                    <Small>Nobody by that name.</Small>
                  </View>
                ) : (
                  found.map((m: Member, i) => (
                    <RadioRow
                      key={m.id}
                      label={`${displayName(m)}${m.id === me.id ? ' (you)' : ''}`}
                      sub={m.fullName !== displayName(m) ? m.fullName : undefined}
                      on={driverId === m.id}
                      last={i === found.length - 1}
                      onPress={() => {
                        change(setDriverId)(m.id);
                        setPicking(false);
                        setFind('');
                      }}
                    />
                  ))
                )}
              </View>
              <Button label="Keep this driver" kind="quiet" onPress={() => setPicking(false)} style={{ alignSelf: 'flex-start' }} />
            </Stack>
          ) : null}
        </Card>
      </View>

      <Field
        label="Notes"
        value={notes}
        onChangeText={change(setNotes)}
        placeholder="Where it’s going, what it’s carrying"
        multiline
        autoCapitalize="sentences"
        hint="Optional. Everyone in the club can see these."
        error={notesTooLong ? BUS_NOTES_TOO_LONG : null}
      />

      <Stack gap={space.sm}>
        <Small style={{ color: colors.boneDim }}>
          {straightAway
            ? manager
              ? 'You’re on the board or NEC, so it’s booked straight away.'
              : 'A recovery for today or tomorrow is booked straight away when the bus is free.'
            : 'The board or NEC says yes or no.'}
        </Small>
        <Button
          label={straightAway ? 'Book it' : 'Ask for it'}
          icon={straightAway ? 'checkmark' : 'paper-plane-outline'}
          busy={saving}
          disabled={first.error !== null || (lastTyped && last.error !== null) || notesTooLong || blocked}
          onPress={save}
          style={styles.bigButton}
        />
        <View accessibilityLiveRegion="polite" role="alert">
          {shownError ? <Notice tone="danger">{shownError}</Notice> : null}
        </View>
      </Stack>
    </Screen>
  );
}

/** A pick-one row: a radio mark, a stencil label and an optional line under it. */
function RadioRow({ label, sub, on, last, onPress }: { label: string; sub?: string; on: boolean; last: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      aria-checked={on}
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.radio,
        last && { borderBottomWidth: 0 },
        (pressed || hovered) && { backgroundColor: colors.steel },
      ]}
    >
      <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.bone : colors.boneMute} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={2} style={[type.name, !on && { color: colors.boneDim }]}>
          {label}
        </Text>
        {sub ? <Text style={styles.metaDim}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.lg, paddingVertical: space.xl },
  heroPress: { marginHorizontal: -space.sm, marginVertical: -space.sm, padding: space.sm, borderRadius: radius.sm },
  heroHead: { gap: space.md, flexWrap: 'nowrap' },
  busTile: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.steel, alignItems: 'center', justifyContent: 'center' },
  todayLine: { fontFamily: fonts.stencil, fontSize: 22, lineHeight: 28, letterSpacing: 0.6, color: colors.bone },
  bigButton: { minHeight: 64 },
  count: { fontFamily: fonts.stencil, fontSize: 16, color: colors.boneMute },
  month: { fontFamily: fonts.stencil, fontSize: 15, lineHeight: 20, letterSpacing: 1, color: colors.boneDim, textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    minHeight: 44,
  },
  meta: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, color: colors.boneDim },
  metaDim: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, color: colors.boneMute },
  rideLine: { gap: 6, flexWrap: 'nowrap' },
  clash: { gap: 6, flexWrap: 'nowrap', alignItems: 'flex-start' },
  clashText: { fontFamily: fonts.stencil, fontSize: 14, lineHeight: 19, letterSpacing: 0.3, color: colors.warn, flexShrink: 1 },
  clashBlock: { gap: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: colors.warnBg },
  emptyRegion: { marginBottom: -space.lg },
  fact: { gap: space.sm, flexWrap: 'nowrap' },
  factText: { fontFamily: fonts.stencil, fontSize: 16, lineHeight: 22, letterSpacing: 0.4, color: colors.boneDim, flexShrink: 1 },
  factMute: { fontFamily: fonts.stencil, fontSize: 14, color: colors.boneMute },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    marginHorizontal: -space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
  },
  days2: { gap: space.md, flexWrap: 'nowrap', alignItems: 'flex-start' },
  field: { gap: 6 },
  radio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  driverCard: { gap: space.md, padding: space.md },
  driverHead: { gap: space.sm, flexWrap: 'nowrap' },
  pickList: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, overflow: 'hidden' },
});
