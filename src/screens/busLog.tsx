// Rusty Bus extras: who has the keys, the odometer, and what the bus costs to run. Full and Nomad
// members, the board and whoever has the keys log them; a mistake is struck out, never deleted.
// The running costs are the board's (every treasurer sits on one), plus each member's own.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { busPersonName, busPurposeLabel, formatDays, managesBus } from '../domain/bus';
import {
  BAD_AMOUNT,
  BAD_KM,
  BAD_LITRES,
  BUS_COST_KINDS,
  KEY_HISTORY,
  LOG_NOTE_TOO_LONG,
  MAX_LOG_NOTE,
  NOT_BUS_HAND,
  busCostKindLabel,
  costHistory,
  costYears,
  formatKm,
  handKeysProblem,
  isBusHand,
  keyHistory,
  keyHolder,
  kmHistory,
  latestReading,
  logCostProblem,
  logKmProblem,
  roundLitres,
  strikeCostProblem,
  strikeKmProblem,
  visibleCosts,
  yearSummary,
  type CostInput,
  type KmInput,
} from '../domain/busLog';
import { charCount } from '../domain/chat';
import { formatAuDate, parseAuDate, typeDate } from '../domain/dates';
import { fyLabel, fyOf, formatCents, parseDollars } from '../domain/fees';
import { displayName } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import type { BusBooking, BusCost, BusCostKind, BusKm, ClubData, Member } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { colors, fonts, radius, space, type } from '../theme';
import {
  Button,
  Card,
  Choices,
  Divider,
  Field,
  Ionicons,
  Label,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
} from '../ui/primitives';

const DATE_HINT = 'Use DD/MM/YYYY, like 08/11/2026.';

/** A DD/MM/YYYY box's state, starting on `initialIso`: what's typed, the ISO date when it's real, and its error. */
function useDay(initialIso: string) {
  const [text, setRaw] = useState(formatAuDate(initialIso));
  const trimmed = text.trim();
  const iso = trimmed ? parseAuDate(trimmed) : null;
  const error = trimmed.length >= 10 && !iso ? DATE_HINT : null;
  return { text, setText: (t: string) => setRaw(typeDate(t)), iso, error, reset: () => setRaw(formatAuDate(initialIso)) };
}

/** A Melbourne date for a stored time: "24/10/2026". */
const dayOf = (at: string) => formatAuDate(melbourneDate(at));

/** Runs one action at a time, keeping its refusal to show. */
function useRun() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (label: string, action: () => Promise<void>): Promise<boolean> => {
    if (busy) return false;
    setError(null);
    setBusy(label);
    try {
      await action();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, setError, run };
}

/** The errors a form shows, read out as they change. */
function LiveError({ error }: { error: string | null }) {
  return (
    <View accessibilityLiveRegion="polite" role="alert">
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </View>
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

/** Booked bookings whose days take in `day`, so an entry can be tied to the trip it was on. */
const bookedOn = (day: string | null, data: ClubData): BusBooking[] =>
  day ? (data.busBookings ?? []).filter((b) => b.status === 'approved' && b.firstDay <= day && day <= b.lastDay) : [];

/** "For a booking?": No booking, or one of the Booked bookings on the day. Hidden when there are none. */
function BookingPick({ day, value, onChange, data }: { day: string | null; value: string | null; onChange: (id: string | null) => void; data: ClubData }) {
  const options = bookedOn(day, data);
  if (options.length === 0) return null;
  return (
    <View style={styles.field}>
      <Label>For a booking?</Label>
      <Card style={{ padding: 0, gap: 0 }}>
        <RadioRow label="No booking" on={value === null} last={false} onPress={() => onChange(null)} />
        {options.map((b, i) => (
          <RadioRow
            key={b.id}
            label={busPurposeLabel(b.purpose)}
            sub={`${formatDays(b.firstDay, b.lastDay)} · ${busPersonName(b.driverId, data)} driving`}
            on={value === b.id}
            last={i === options.length - 1}
            onPress={() => onChange(b.id)}
          />
        ))}
      </Card>
    </View>
  );
}

/**
 * Strike out, in two taps, for whoever logged it or the board. A quiet link on each row, so a list
 * of them doesn't shout; the second step is the usual danger button.
 */
function StrikeButton({ label, busy, disabled, onConfirm }: { label: string; busy: boolean; disabled: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  if (busy) return <Button label="Striking out" kind="quiet" busy onPress={() => {}} style={styles.strikeBusy} />;
  if (armed && !disabled) {
    return (
      <View style={{ gap: space.sm, marginTop: space.xs }}>
        <View accessibilityLiveRegion="polite">
          <Small style={{ color: colors.boneDim }}>It stays on the list, crossed out, and counts for nothing.</Small>
        </View>
        <Row style={{ gap: space.sm }}>
          <Button label="Yes, strike it out" kind="danger" onPress={() => { setArmed(false); onConfirm(); }} style={{ flex: 1 }} />
          <Button label="Cancel" kind="quiet" onPress={() => setArmed(false)} />
        </Row>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Strike out ${label}`}
      accessibilityState={{ disabled }}
      onPress={disabled ? undefined : () => setArmed(true)}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.strike,
        (pressed || hovered) && { backgroundColor: colors.steel },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Ionicons name="remove-circle-outline" size={16} color={colors.boneMute} />
      <Text style={styles.strikeText}>Strike out</Text>
    </Pressable>
  );
}

/** "Struck out by Gravel on 29/10/2026". */
const struckLine = (e: { struckBy: string | null; struckAt: string | null }, data: ClubData) =>
  e.struckAt ? `Struck out by ${busPersonName(e.struckBy, data)} on ${dayOf(e.struckAt)}` : null;

// ---------------------------------------------------------------------------
// Keys and odometer
// ---------------------------------------------------------------------------

export function BusKeysScreen(_props: RootScreen<'BusKeys'>) {
  const { me, data } = useClub();
  if (!me) return null;
  if (me.approval !== 'approved') {
    return (
      <Screen>
        <Notice tone="warn">Only approved members can see the Rusty Bus.</Notice>
      </Screen>
    );
  }
  return (
    <Screen>
      <KeysSection me={me} data={data} />
      <KmSection me={me} data={data} />
    </Screen>
  );
}

function KeysSection({ me, data }: { me: Member; data: ClubData }) {
  const { handBusKeys } = useClub();
  const { busy, error, setError, run } = useRun();
  const [handing, setHanding] = useState(false);
  const [toId, setToId] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const [note, setNote] = useState('');
  const holder = keyHolder(data);
  const history = keyHistory(data).slice(0, KEY_HISTORY);
  const hand = isBusHand(me, data);
  const noteTooLong = charCount(note.trim()) > MAX_LOG_NOTE;
  const people = data.members
    .filter((m) => m.approval === 'approved' && m.id !== holder?.toId)
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const findText = find.trim().toLowerCase();
  const found = findText ? people.filter((m) => displayName(m).toLowerCase().includes(findText) || m.fullName.toLowerCase().includes(findText)) : people;
  const you = (id: string | null) => (id === me.id ? ' (you)' : '');

  const save = async () => {
    const problem = handKeysProblem(me, toId, note, data);
    if (problem) return setError(problem);
    if (await run('keys', () => handBusKeys(toId!, note))) {
      setHanding(false);
      setToId(null);
      setFind('');
      setNote('');
    }
  };

  return (
    <Stack gap={space.sm}>
      <SectionTitle title="Keys" />
      <Card style={styles.hero}>
        <Row style={styles.heroHead}>
          <View style={styles.tile} aria-hidden importantForAccessibility="no-hide-descendants">
            <Ionicons name="key" size={26} color={colors.bone} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={styles.heroLine}>
              {holder ? `With ${busPersonName(holder.toId, data)}${you(holder.toId)}` : 'Nobody’s logged the keys yet'}
            </Text>
            {holder ? <Text style={styles.metaDim}>{`Since ${dayOf(holder.loggedAt)}`}</Text> : null}
          </View>
        </Row>
        {holder?.note ? <Small style={{ color: colors.boneDim }}>{holder.note}</Small> : null}
        {!hand ? (
          <Small>{NOT_BUS_HAND}</Small>
        ) : !handing ? (
          <Button label="Hand over the keys" icon="swap-horizontal" kind="secondary" onPress={() => setHanding(true)} />
        ) : (
          <Stack gap={space.sm}>
            <Divider />
            <Field label="Who has them now?" value={find} onChangeText={setFind} placeholder="Road name or name" autoCapitalize="none" autoCorrect={false} />
            <View style={styles.pickList}>
              {found.length === 0 ? (
                <View style={{ padding: space.md }}>
                  <Small>Nobody by that name.</Small>
                </View>
              ) : (
                found.slice(0, findText ? found.length : 8).map((m, i, shown) => (
                  <RadioRow
                    key={m.id}
                    label={`${displayName(m)}${you(m.id)}`}
                    sub={m.fullName !== displayName(m) ? m.fullName : undefined}
                    on={toId === m.id}
                    last={i === shown.length - 1}
                    onPress={() => {
                      setError(null);
                      setToId(m.id);
                    }}
                  />
                ))
              )}
            </View>
            {!findText && found.length > 8 ? <Small>Type a name to find anyone else.</Small> : null}
            <Field
              label="Note"
              value={note}
              onChangeText={setNote}
              placeholder="e.g. On the hook at the clubhouse"
              autoCapitalize="sentences"
              hint="Optional."
              error={noteTooLong ? LOG_NOTE_TOO_LONG : null}
            />
            <Row style={{ gap: space.sm }}>
              <Button label="Log it" icon="checkmark" busy={busy === 'keys'} disabled={toId === null || noteTooLong} onPress={save} style={{ flex: 1 }} />
              <Button label="Cancel" kind="quiet" onPress={() => setHanding(false)} />
            </Row>
          </Stack>
        )}
        <LiveError error={error} />
      </Card>
      {history.length > 1 ? (
        <Card style={{ padding: 0, gap: 0 }}>
          {history.slice(1).map((k, i, rest) => (
            <View key={k.id} style={[styles.row, i === rest.length - 1 && { borderBottomWidth: 0 }]}>
              <Ionicons name="key-outline" size={16} color={colors.boneMute} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={type.name}>{`${busPersonName(k.toId, data)}${you(k.toId)}`}</Text>
                <Text style={styles.metaDim}>{`From ${dayOf(k.loggedAt)} · logged by ${busPersonName(k.loggedBy, data)}`}</Text>
                {k.note ? <Small style={{ color: colors.boneDim }}>{k.note}</Small> : null}
              </View>
            </View>
          ))}
        </Card>
      ) : null}
    </Stack>
  );
}

function KmSection({ me, data }: { me: Member; data: ClubData }) {
  const { today, logBusKm, strikeBusKm } = useClub();
  const { busy, error, setError, run } = useRun();
  const strikes = useRun();
  const [km, setKm] = useState('');
  const day = useDay(today);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const latest = latestReading(data);
  const readings = kmHistory(data);
  const hand = isBusHand(me, data);
  const kmNumber = km.trim() === '' ? NaN : Number(km.replace(/[,\s]/g, ''));
  const kmError = km.trim() !== '' && (!Number.isInteger(kmNumber) || kmNumber < 1) ? BAD_KM : null;
  const noteTooLong = charCount(note.trim()) > MAX_LOG_NOTE;
  // A booking picked for one day is let go when the day moves off it.
  const booking = bookedOn(day.iso, data).some((b) => b.id === bookingId) ? bookingId : null;

  const save = async () => {
    const input: KmInput = { km: kmNumber, readOn: day.iso ?? '', bookingId: booking, note };
    const problem = logKmProblem(me, input, data, today);
    if (problem) return setError(problem);
    if (await run('km', () => logBusKm(input))) {
      setKm('');
      setNote('');
      setBookingId(null);
      day.reset();
    }
  };

  return (
    <Stack gap={space.sm}>
      <SectionTitle title="Odometer" />
      <Card>
        <Row style={styles.heroHead}>
          <View style={styles.tile} aria-hidden importantForAccessibility="no-hide-descendants">
            <Ionicons name="speedometer" size={26} color={colors.bone} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={styles.heroLine}>{latest ? formatKm(latest.km) : 'No readings yet'}</Text>
            {latest ? <Text style={styles.metaDim}>{`On ${formatAuDate(latest.readOn)}`}</Text> : null}
          </View>
        </Row>
        {hand ? (
          <Stack gap={space.md}>
            <Divider />
            <Row style={styles.two}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Odometer (km)"
                  value={km}
                  onChangeText={(t) => {
                    setError(null);
                    setKm(t);
                  }}
                  placeholder={latest ? String(latest.km) : '124000'}
                  inputMode="numeric"
                  maxLength={9}
                  error={kmError}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Day"
                  value={day.text}
                  onChangeText={(t) => {
                    setError(null);
                    day.setText(t);
                  }}
                  placeholder="DD/MM/YYYY"
                  inputMode="numeric"
                  maxLength={10}
                  error={day.error}
                />
              </View>
            </Row>
            <BookingPick day={day.iso} value={booking} onChange={setBookingId} data={data} />
            <Field
              label="Note"
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Leaving for the charity ride"
              autoCapitalize="sentences"
              hint="Optional."
              error={noteTooLong ? LOG_NOTE_TOO_LONG : null}
            />
            <Button label="Log km" icon="checkmark" busy={busy === 'km'} disabled={!km.trim() || !!kmError || !!day.error || noteTooLong} onPress={save} />
          </Stack>
        ) : null}
        <LiveError error={error} />
      </Card>
      {readings.length > 0 ? (
        <Card style={{ padding: 0, gap: 0 }}>
          {readings.map((r, i) => (
            <KmRow
              key={r.id}
              reading={r}
              data={data}
              last={i === readings.length - 1}
              canStrike={strikeKmProblem(me, r, data) === null}
              busy={strikes.busy === r.id}
              disabled={strikes.busy !== null}
              onStrike={() => strikes.run(r.id, () => strikeBusKm(r.id))}
            />
          ))}
        </Card>
      ) : null}
      <LiveError error={strikes.error} />
    </Stack>
  );
}

function KmRow({ reading: r, data, last, canStrike, busy, disabled, onStrike }: {
  reading: BusKm; data: ClubData; last: boolean; canStrike: boolean; busy: boolean; disabled: boolean; onStrike: () => void;
}) {
  const booking = r.bookingId ? (data.busBookings ?? []).find((b) => b.id === r.bookingId) : undefined;
  const struck = struckLine(r, data);
  return (
    <View style={[styles.entry, last && { borderBottomWidth: 0 }]}>
      <Row style={styles.entryHead}>
        <Text style={[type.name, struck ? styles.struck : null]}>{formatKm(r.km)}</Text>
        <Text style={styles.metaDim}>{formatAuDate(r.readOn)}</Text>
      </Row>
      <Text style={styles.meta}>
        {[`Logged by ${busPersonName(r.loggedBy, data)}`, booking ? `${busPurposeLabel(booking.purpose)} ${formatDays(booking.firstDay, booking.lastDay)}` : null]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {r.note ? <Small style={{ color: colors.boneDim }}>{r.note}</Small> : null}
      {struck ? <Text style={styles.metaDim}>{struck}</Text> : canStrike ? <StrikeButton label={formatKm(r.km)} busy={busy} disabled={disabled} onConfirm={onStrike} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Running costs
// ---------------------------------------------------------------------------

export function BusCostsScreen(_props: RootScreen<'BusCosts'>) {
  const { me, data, today, logBusCost, strikeBusCost } = useClub();
  const { busy, error, setError, run } = useRun();
  const strikes = useRun();
  const years = costYears(data, today, me ? visibleCosts(me, data) : []);
  const [fy, setFy] = useState(years[0]);
  const [kind, setKind] = useState<BusCostKind | null>(null);
  const [amount, setAmount] = useState('');
  const day = useDay(today);
  const [litres, setLitres] = useState('');
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  if (!me) return null;
  const manager = managesBus(me, data);
  const hand = isBusHand(me, data);
  const mine = visibleCosts(me, data);
  if (!manager && !hand && mine.length === 0) {
    return (
      <Screen>
        <Notice tone="warn">{NOT_BUS_HAND}</Notice>
      </Screen>
    );
  }

  const summary = yearSummary(data, fy, mine);
  const costs = costHistory(mine.filter((c) => fyOf(c.spentOn) === fy));
  const cents = amount.trim() === '' ? null : parseDollars(amount);
  const amountError = amount.trim() !== '' && (cents === null || cents < 1) ? BAD_AMOUNT : null;
  const litresNumber = kind === 'fuel' && litres.trim() !== '' ? Number(litres.trim().replace(',', '.')) : null;
  const litresError = litresNumber !== null && !(litresNumber > 0) ? BAD_LITRES : null;
  const noteTooLong = charCount(note.trim()) > MAX_LOG_NOTE;
  const booking = bookedOn(day.iso, data).some((b) => b.id === bookingId) ? bookingId : null;

  const save = async () => {
    const input: CostInput = {
      spentOn: day.iso ?? '', kind, amountCents: cents ?? NaN, litres: roundLitres(litresNumber), bookingId: booking, note,
    };
    const problem = logCostProblem(me, input, data, today);
    if (problem) return setError(problem);
    if (await run('cost', () => logBusCost(input))) {
      setKind(null);
      setAmount('');
      setLitres('');
      setNote('');
      setBookingId(null);
      day.reset();
      setFy(fyOf(input.spentOn));
    }
  };
  const change = <T,>(set: (v: T) => void) => (v: T) => {
    setError(null);
    set(v);
  };

  return (
    <Screen>
      {years.length > 1 ? (
        <Choices<string> label="Financial year" options={years.map((y) => ({ value: String(y), label: fyLabel(y) }))} value={String(fy)} onChange={(v) => setFy(Number(v))} />
      ) : null}

      <Card>
        <Label>{manager ? `${fyLabel(fy)} · the bus` : `${fyLabel(fy)} · what you logged`}</Label>
        <Text style={styles.total}>{formatCents(summary.totalCents)}</Text>
        {summary.byKind.length === 0 ? (
          <Small>Nothing logged this year.</Small>
        ) : (
          <Stack gap={space.xs}>
            {summary.byKind.map((k) => (
              <Row key={k.kind} style={styles.sumRow}>
                <Text style={styles.sumLabel}>{busCostKindLabel(k.kind)}</Text>
                <Text style={styles.sumValue}>{formatCents(k.cents)}</Text>
              </Row>
            ))}
          </Stack>
        )}
        <Divider />
        {/* Km run and cost per km are the whole bus's, so only beside the whole bus's costs. */}
        <Row style={styles.facts}>
          {manager ? <Fact label="Km run" value={summary.kmRun === null ? '—' : formatKm(summary.kmRun)} /> : null}
          {manager ? <Fact label="Per km" value={summary.centsPerKm === null ? '—' : formatCents(summary.centsPerKm)} /> : null}
          <Fact label="Fuel" value={summary.litres > 0 ? `${summary.litres.toLocaleString('en-AU')} L` : '—'} />
        </Row>
        <Small>These aren’t in the books. Pay, or pay people back, through the Treasury as usual.</Small>
      </Card>

      {hand ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Log a cost" />
          <Card>
            <Choices<BusCostKind>
              label="What was it for?"
              options={BUS_COST_KINDS.map((k) => ({ value: k, label: busCostKindLabel(k) }))}
              value={kind}
              onChange={change(setKind)}
            />
            <Row style={styles.two}>
              <View style={{ flex: 1 }}>
                <Field label="Amount ($)" value={amount} onChangeText={change(setAmount)} placeholder="98.50" inputMode="decimal" maxLength={12} error={amountError} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Day" value={day.text} onChangeText={change(day.setText)} placeholder="DD/MM/YYYY" inputMode="numeric" maxLength={10} error={day.error} />
              </View>
            </Row>
            {kind === 'fuel' ? (
              <Field label="Litres" value={litres} onChangeText={change(setLitres)} placeholder="52.4" inputMode="decimal" maxLength={7} hint="Optional." error={litresError} />
            ) : null}
            <BookingPick day={day.iso} value={booking} onChange={setBookingId} data={data} />
            <Field
              label="Note"
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Shell Bacchus Marsh, paid by me"
              autoCapitalize="sentences"
              hint="Optional. Say if someone needs paying back."
              error={noteTooLong ? LOG_NOTE_TOO_LONG : null}
            />
            <Button
              label="Log it"
              icon="checkmark"
              busy={busy === 'cost'}
              disabled={!amount.trim() || !!amountError || !!litresError || !!day.error || noteTooLong}
              onPress={save}
            />
            <LiveError error={error} />
          </Card>
        </Stack>
      ) : null}

      <Stack gap={space.sm}>
        <SectionTitle title={manager ? 'Every cost' : 'Yours'} action={<Text style={styles.count}>{costs.length}</Text>} />
        {costs.length === 0 ? (
          <Notice>{`No costs logged in ${fyLabel(fy)}.`}</Notice>
        ) : (
          <Card style={{ padding: 0, gap: 0 }}>
            {costs.map((c, i) => (
              <CostRow
                key={c.id}
                cost={c}
                data={data}
                last={i === costs.length - 1}
                canStrike={strikeCostProblem(me, c, data) === null}
                busy={strikes.busy === c.id}
                disabled={strikes.busy !== null}
                onStrike={() => strikes.run(c.id, () => strikeBusCost(c.id))}
              />
            ))}
          </Card>
        )}
        <LiveError error={strikes.error} />
      </Stack>
    </Screen>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Label>{label}</Label>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function CostRow({ cost: c, data, last, canStrike, busy, disabled, onStrike }: {
  cost: BusCost; data: ClubData; last: boolean; canStrike: boolean; busy: boolean; disabled: boolean; onStrike: () => void;
}) {
  const booking = c.bookingId ? (data.busBookings ?? []).find((b) => b.id === c.bookingId) : undefined;
  const struck = struckLine(c, data);
  return (
    <View style={[styles.entry, last && { borderBottomWidth: 0 }]}>
      <Row style={styles.entryHead}>
        <Text style={[type.name, struck ? styles.struck : null]}>{busCostKindLabel(c.kind)}</Text>
        <Text style={[styles.amount, struck ? styles.struck : null]}>{formatCents(c.amountCents)}</Text>
      </Row>
      <Text style={styles.meta}>
        {[
          formatAuDate(c.spentOn),
          c.litres !== null ? `${c.litres.toLocaleString('en-AU')} L` : null,
          busPersonName(c.loggedBy, data),
          booking ? `${busPurposeLabel(booking.purpose)} ${formatDays(booking.firstDay, booking.lastDay)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {c.note ? <Small style={{ color: colors.boneDim }}>{c.note}</Small> : null}
      {struck ? (
        <Text style={styles.metaDim}>{struck}</Text>
      ) : canStrike ? (
        <StrikeButton label={`${busCostKindLabel(c.kind)} ${formatCents(c.amountCents)}`} busy={busy} disabled={disabled} onConfirm={onStrike} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.md },
  heroHead: { gap: space.md, flexWrap: 'nowrap' },
  tile: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.steel, alignItems: 'center', justifyContent: 'center' },
  heroLine: { fontFamily: fonts.stencil, fontSize: 21, lineHeight: 27, letterSpacing: 0.6, color: colors.bone },
  meta: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, color: colors.boneDim },
  metaDim: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, color: colors.boneMute },
  count: { fontFamily: fonts.stencil, fontSize: 16, color: colors.boneMute },
  field: { gap: 6 },
  two: { gap: space.md, flexWrap: 'nowrap', alignItems: 'flex-start' },
  pickList: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, overflow: 'hidden' },
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
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  entry: { gap: 4, paddingVertical: space.md, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colors.line },
  entryHead: { justifyContent: 'space-between', gap: space.sm, flexWrap: 'nowrap' },
  struck: { textDecorationLine: 'line-through', color: colors.boneMute },
  strike: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    minHeight: 44,
    marginLeft: -space.sm,
    marginBottom: -space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
  strikeText: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.6, color: colors.boneMute },
  strikeBusy: { alignSelf: 'flex-start', minHeight: 44 },
  amount: { fontFamily: fonts.stencil, fontSize: 16, lineHeight: 22, letterSpacing: 0.4, color: colors.bone },
  total: { fontFamily: fonts.stencil, fontSize: 34, lineHeight: 40, letterSpacing: 1.5, color: colors.bone },
  sumRow: { justifyContent: 'space-between', flexWrap: 'nowrap' },
  sumLabel: { fontFamily: fonts.stencil, fontSize: 15, lineHeight: 21, letterSpacing: 0.4, color: colors.boneDim },
  sumValue: { fontFamily: fonts.stencil, fontSize: 15, lineHeight: 21, letterSpacing: 0.4, color: colors.bone },
  facts: { gap: space.md, flexWrap: 'nowrap' },
  factValue: { fontFamily: fonts.stencil, fontSize: 17, lineHeight: 23, letterSpacing: 0.4, color: colors.bone },
});
