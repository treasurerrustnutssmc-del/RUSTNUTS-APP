// Ride planning extras on screen: the call banner (ride's off or postponed), the plan of stops
// with its fuel check, the event hub, and crew swap asks, on the ride screen; and their own
// screens: Plan the ride, Call the ride, the hub, running the hub, and asking for a swap.

import React, { useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { writesBriefing } from '../domain/briefings';
import { pickGroups, spotOf } from '../domain/crew';
import { formatAuDate, parseAuDate, typeDate } from '../domain/dates';
import { bikeRange, fuelCheck, kmAlong, type FuelCheck } from '../domain/fuel';
import {
  hubCounts, hubFor, hubListText, MAX_HUB_TEXT, MAX_REG_NOTES, MAX_SHARE_WITH, myRegistration, registeredNotGoing, registerProblem,
  registrationsClosed, registrationsFor, saveHubProblem, STAYING, STAYING_LABEL, withdrawHubProblem, type RegisterInput,
} from '../domain/hubs';
import { ROLE_LABEL } from '../domain/labels';
import { displayName, initials, memberName } from '../domain/profile';
import { MAX_COMMENT, rateProblem, ratingsFor, routeScore, starsLine } from '../domain/ratings';
import { activeCall, callProblem, callTitle, MAX_REASON, QUICK_REASONS } from '../domain/rideCalls';
import { editPlanProblem, MAX_STOPS, savePlanProblem, STOP_KINDS, STOP_LABEL } from '../domain/ridePlan';
import { endOfFirstDay, lastDay, melbourneDate, melbourneTime } from '../domain/rides';
import { routeOf } from '../domain/routes';
import { askSwapProblem, myOpenAsk, openAsksFor } from '../domain/swaps';
import type { ClubData, CrewSwap, HubStaying, Member, PlanStop, Ride, RideCallState, Route, StopKind } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { colors, fonts, radius, space, type } from '../theme';
import {
  Avatar, Body, Button, Card, Chip, Choices, ConfirmButton, Field, H2, Ionicons, Label, ListRow, Notice, Row, Screen, SectionTitle, Small,
  Stack, Toggle, type IconName,
} from '../ui/primitives';

const STOP_ICON: Record<StopKind, IconName> = {
  fuel: 'speedometer-outline',
  coffee: 'cafe-outline',
  lunch: 'restaurant-outline',
  regroup: 'people-outline',
  other: 'flag-outline',
};

const nowIso = () => new Date().toISOString();
const km = (n: number) => `${Math.round(n)} km`;
const kmText = (n: number | null) => (n === null ? '' : String(Math.round(n * 10) / 10));

function ErrorLine({ error }: { error: string | null }) {
  return (
    <View accessibilityLiveRegion="polite" role="alert">
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </View>
  );
}

/** Runs a save with a busy flag and its refusal on screen. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>, after?: () => void) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await action();
      setBusy(false);
      after?.();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

// ---------------------------------------------------------------------------
// On the ride screen
// ---------------------------------------------------------------------------

/** "Ride’s off" (red) or "Postponed" (amber), with the reason and who called it; Back on for its writers. */
export function RideCallBanner({ ride, me, data }: { ride: Ride; me: Member; data: ClubData }) {
  const { callRide } = useClub();
  const { busy, error, run } = useAction();
  const call = activeCall(ride.id, data);
  if (!call || ride.cancelledAt) return null;
  const canCall = callProblem(me, ride, 'on', '', null, data, nowIso()) === null;
  const who = call.calledBy ? memberName(call.calledBy, data.members) : null;
  const when = `${formatAuDate(melbourneDate(call.calledAt))} ${melbourneTime(call.calledAt)}`;
  return (
    <Stack gap={space.sm}>
      <Notice tone={call.state === 'off' ? 'danger' : 'warn'} title={callTitle(call)}>
        {[call.reason && !/[.!?]$/.test(call.reason) ? `${call.reason}.` : call.reason, who ? `Called by ${who}, ${when}.` : `Called ${when}.`].filter(Boolean).join(' ')}
      </Notice>
      {canCall && call.state === 'postponed' ? (
        <Small>Move it in the club calendar too, so the date changes on the website and here.</Small>
      ) : null}
      {canCall ? (
        busy ? (
          <Button label="Back on" kind="secondary" busy onPress={() => {}} />
        ) : (
          <ConfirmButton
            label="It’s back on"
            confirmLabel="Yes, it’s back on"
            kind="secondary"
            icon="refresh"
            confirmNote="Everyone sees it’s on again, and the ride chat gets a line."
            onConfirm={() => run(() => callRide(ride.id, 'on', '', null))}
          />
        )
      ) : null}
      <ErrorLine error={error} />
    </Stack>
  );
}

/** One line of the fuel check: the pack's smallest tank, then each long leg. */
function FuelLines({ check, data }: { check: FuelCheck; data: ClubData }) {
  const limit = check.limit;
  if (!limit) {
    return <Small>No tank ranges on file for this pack yet. Riders add theirs on their bike, under Me.</Small>;
  }
  const holder = data.members.find((m) => m.id === limit.memberId);
  const bike = data.bikes.find((b) => b.id === limit.bikeId);
  const long = (check.legs ?? []).filter((l) => l.tooLong);
  return (
    <Stack gap={space.xs}>
      <Row style={styles.fuelHead}>
        <Ionicons name="speedometer-outline" size={18} color={check.ok ? colors.ok : colors.warn} />
        <Text style={[type.name, { flex: 1 }]}>{`Smallest tank ${km(limit.rangeKm)}`}</Text>
      </Row>
      <Small>
        {`${holder ? displayName(holder) : 'A rider'}’s ${bike?.nickname ?? bike?.model ?? 'bike'}. Legs are kept to ${km(check.safeKm ?? 0)}, with a 10% margin.`}
      </Small>
      {check.legs === null ? <Small>Choose a route to check the fuel stops.</Small> : null}
      {check.legs !== null && long.length === 0 ? <Chip label="Fuel stops fit the smallest tank" tone="ok" icon="checkmark" /> : null}
      {long.map((l) => (
        <View key={`${l.from}-${l.to}`} style={styles.legWarn}>
          <Ionicons name="warning" size={18} color={colors.warn} style={{ marginTop: 1 }} />
          <Text style={[type.body, { flex: 1, color: colors.bone }]}>
            {`${l.from} to ${l.to} is ${km(l.km)}. Fuel by km ${Math.floor(l.fuelByKm ?? 0)}${l.suggest ? `, at ${l.suggest} or before` : ''}.`}
          </Text>
        </View>
      ))}
      {check.unknown.length > 0 ? (
        <Small>{`No range on file: ${check.unknown.map((id) => memberName(id, data.members)).join(', ')}.`}</Small>
      ) : null}
    </Stack>
  );
}

/** The stops, numbered by km, with their kind, km and time. */
function StopRows({ stops }: { stops: PlanStop[] }) {
  return (
    <View>
      {stops.map((s, i) => (
        <View key={`${i}-${s.name}`} style={[styles.stopRow, i === stops.length - 1 && { borderBottomWidth: 0 }]}>
          <View style={styles.stopIcon}>
            <Ionicons name={STOP_ICON[s.kind]} size={18} color={s.kind === 'fuel' ? colors.warn : colors.boneDim} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={type.name} numberOfLines={2}>{s.name}</Text>
            <Text style={styles.stopMeta}>{[STOP_LABEL[s.kind], s.km !== null ? `km ${kmText(s.km)}` : null, s.time].filter(Boolean).join(' · ')}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** The plan on the ride screen: the stops, the fuel check, and Plan the ride / call it for its writers. */
export function RidePlanSection({ ride, me, data, onPlan, onCall }: { ride: Ride; me: Member; data: ClubData; onPlan: () => void; onCall: () => void }) {
  if (me.approval !== 'approved') return null;
  const stops = (data.ridePlans ?? []).find((p) => p.rideId === ride.id)?.stops ?? [];
  const check = fuelCheck(ride.id, data);
  const canPlan = editPlanProblem(me, ride, data, nowIso()) === null;
  const canCall = callProblem(me, ride, 'off', '', null, data, nowIso()) === null && !activeCall(ride.id, data);
  if (stops.length === 0 && !check.limit && !canPlan) return null;
  return (
    <Stack gap={space.sm}>
      <SectionTitle title="Stops and fuel" />
      <Card>
        {stops.length > 0 ? <StopRows stops={stops} /> : <Body>No stops planned yet.</Body>}
        <FuelLines check={check} data={data} />
        {canPlan ? <Button label="Plan the ride" icon="map-outline" kind="secondary" onPress={onPlan} /> : null}
        {canCall ? <Button label="Call it off or postpone" icon="rainy-outline" kind="quiet" onPress={onCall} /> : null}
      </Card>
    </Stack>
  );
}

/** The hub on the ride screen: the counts and your registration, or Open registrations for managers. */
export function HubSection({ ride, me, data, today, onOpen, onEdit }: {
  ride: Ride; me: Member; data: ClubData; today: string; onOpen: () => void; onEdit: () => void;
}) {
  if (me.approval !== 'approved') return null;
  const hub = hubFor(ride.id, data);
  const canRun = saveHubProblem(me, ride, { membersOnly: true, closesOn: null, beds: null, accommodation: '', notes: '' }, data, nowIso()) === null;
  if (!hub) {
    // Offered on club rides and anything over more than one day (the Big 4 and the like), not every breakfast run.
    const bigRide = ride.category === 'club' || lastDay(ride) !== melbourneDate(ride.startsAt);
    if (!canRun || !bigRide) return null;
    return (
      <Stack gap={space.sm}>
        <SectionTitle title="Registrations" />
        <Card>
          <Small>For a run with beds to sort: members register, say where they’re staying, and you get the list to send the venue.</Small>
          <Button label="Open registrations" icon="bed-outline" kind="secondary" onPress={onEdit} />
        </Card>
      </Stack>
    );
  }
  const counts = hubCounts(ride.id, data);
  const mine = myRegistration(ride.id, me.id, data);
  const closed = registrationsClosed(ride, hub, nowIso(), today);
  return (
    <Stack gap={space.sm}>
      <SectionTitle title="Registrations" action={<Text style={styles.count}>{counts.riders}</Text>} />
      <Card>
        <Text style={type.name}>
          {`${counts.riders} rider${counts.riders === 1 ? '' : 's'} · ${counts.pillions} pillion${counts.pillions === 1 ? '' : 's'}`}
        </Text>
        {hub.accommodation ? <Body numberOfLines={2}>{hub.accommodation}</Body> : null}
        <Row style={{ gap: 6 }}>
          {mine ? <Chip label={`You’re in: ${STAYING_LABEL[mine.staying]}`} tone="ok" icon="checkmark" /> : null}
          {closed ? <Chip label="Closed" tone="steel" /> : hub.closesOn ? <Chip label={`Closes ${formatAuDate(hub.closesOn)}`} tone="warn" /> : null}
          {hub.membersOnly ? <Chip label="FNG, Full and Nomad" tone="steel" /> : null}
        </Row>
        <Button label={mine || closed ? 'Open the hub' : 'Register'} icon="bed-outline" kind={mine || closed ? 'secondary' : 'primary'} onPress={onOpen} />
      </Card>
    </Stack>
  );
}

/** One open ask on this ride, for the person asked: Take it or No thanks. */
function AskForMe({ swap, data }: { swap: CrewSwap; data: ClubData }) {
  const { answerSwap } = useClub();
  const { busy, error, run } = useAction();
  const asker = memberName(swap.askedBy, data.members);
  const lead = swap.theirRole
    ? `${asker} asked to trade: you’d be ${ROLE_LABEL[swap.role]}, and they’d take your ${ROLE_LABEL[swap.theirRole]} spot.`
    : `${asker} asked you to take their ${ROLE_LABEL[swap.role]} spot. You’d be Going.`;
  return (
    <Card>
      <Text style={type.name}>Swap asked</Text>
      <Body>{lead}</Body>
      {swap.note ? <Body style={{ color: colors.bone }}>{`“${swap.note}”`}</Body> : null}
      <Row style={{ gap: space.sm }}>
        <Button label="Take it" icon="checkmark" busy={busy} onPress={() => run(() => answerSwap(swap.id, true))} style={{ flex: 1 }} />
        <Button label="No thanks" kind="secondary" disabled={busy} onPress={() => run(() => answerSwap(swap.id, false))} />
      </Row>
      <ErrorLine error={error} />
    </Card>
  );
}

/** Your own open ask on this ride, with Withdraw; or Ask someone to swap when you hold a spot. */
function MyAsk({ ride, me, data, onAsk }: { ride: Ride; me: Member; data: ClubData; onAsk: () => void }) {
  const { withdrawSwap } = useClub();
  const { busy, error, run } = useAction();
  const mySpot = spotOf(ride.id, me.id, data.crew);
  const open = myOpenAsk(ride.id, me.id, data);
  if (!mySpot || ride.cancelledAt || Date.parse(nowIso()) >= endOfFirstDay(ride)) return null;
  if (!open) {
    return <Button label="Ask someone to swap" icon="swap-horizontal" kind="quiet" onPress={onAsk} />;
  }
  return (
    <Stack gap={space.sm}>
      <Notice title="Swap asked">{`You asked ${memberName(open.askedTo, data.members)} to take your ${ROLE_LABEL[open.role]} spot. You stay on the crew until they say yes.`}</Notice>
      {busy ? (
        <Button label="Withdraw" kind="secondary" busy onPress={() => {}} />
      ) : (
        <ConfirmButton label="Withdraw the ask" confirmLabel="Yes, withdraw" kind="secondary" onConfirm={() => run(() => withdrawSwap(open.id))} />
      )}
      <ErrorLine error={error} />
    </Stack>
  );
}

/** Swap asks for you on this ride, and your own. */
export function SwapSection({ ride, me, data, onAsk }: { ride: Ride; me: Member; data: ClubData; onAsk: () => void }) {
  const forMe = openAsksFor(me.id, data, nowIso()).filter((s) => s.rideId === ride.id);
  return (
    <>
      {forMe.map((s) => <AskForMe key={s.id} swap={s} data={data} />)}
      <MyAsk ride={ride} me={me} data={data} onAsk={onAsk} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Plan the ride
// ---------------------------------------------------------------------------

type StopDraft = { kind: StopKind; name: string; km: string; time: string };

const toDraft = (s: PlanStop): StopDraft => ({ kind: s.kind, name: s.name, km: kmText(s.km), time: s.time ?? '' });

/** A typed km ("40.5"), as a number; blank is none, and anything unreadable is NaN (refused as a bad km). */
function readKm(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

const fromDraft = (d: StopDraft): PlanStop => ({ kind: d.kind, name: d.name, km: readKm(d.km), time: d.time.trim() || null });

export function PlanRideScreen({ route: nav, navigation }: RootScreen<'PlanRide'>) {
  const { me, data, saveRidePlan } = useClub();
  const ride = data.rides.find((r) => r.id === nav.params.rideId);
  const plan = (data.ridePlans ?? []).find((p) => p.rideId === nav.params.rideId);
  const [seen] = useState<string | null>(plan?.updatedAt ?? null);
  const [drafts, setDrafts] = useState<StopDraft[]>((plan?.stops ?? []).map(toDraft));
  const { busy, error, setError, run } = useAction();

  if (!ride || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Ride not found">It may have come off the club calendar.</Notice>
      </Screen>
    );
  }
  const closed = editPlanProblem(me, ride, data, nowIso());
  if (closed) {
    return (
      <Screen>
        <Notice tone="warn">{closed}</Notice>
      </Screen>
    );
  }

  const route = routeOf(ride.id, data);
  const stops = drafts.map(fromDraft);
  // The fuel check as the plan stands on screen.
  const check = fuelCheck(ride.id, { ...data, ridePlans: [{ rideId: ride.id, stops, updatedAt: '', updatedBy: null }] });
  const change = (i: number, patch: Partial<StopDraft>) => {
    setError(null);
    setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  };
  const add = (d: StopDraft) => {
    setError(null);
    setDrafts([...drafts, d]);
  };
  const waypoints = (route?.stops ?? []).filter((w) => !drafts.some((d) => d.name.trim() === w.name));
  const save = () =>
    run(async () => {
      const problem = savePlanProblem(me, ride, stops, seen, data, nowIso());
      if (problem) throw new Error(problem);
      await saveRidePlan(ride.id, stops, seen);
    }, () => navigation.goBack());

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H2>{ride.title}</H2>
        <Small>Fuel, coffee, lunch and regroup stops, in order along the route. Riders see them on the ride and its briefing card.</Small>
      </Stack>

      {!route ? (
        <Notice title="No route yet">
          Stops still work without one, but the fuel check needs the route’s distance.
        </Notice>
      ) : null}

      {drafts.map((d, i) => (
        <Card key={i}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{`Stop ${i + 1}`}</Label>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove stop ${i + 1}`}
              hitSlop={12}
              onPress={() => setDrafts(drafts.filter((_, j) => j !== i))}
            >
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          </Row>
          <Choices<StopKind> options={STOP_KINDS.map((k) => ({ value: k, label: STOP_LABEL[k] }))} value={d.kind} onChange={(kind) => change(i, { kind })} />
          <Field label="Name" value={d.name} onChangeText={(name) => change(i, { name })} placeholder="Kinglake servo" maxLength={80} />
          <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Field label="Km along" value={d.km} onChangeText={(t) => change(i, { km: t })} inputMode="decimal" keyboardType="decimal-pad" placeholder="40" maxLength={7} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Time" value={d.time} onChangeText={(t) => change(i, { time: t })} inputMode="numeric" placeholder="10:30" maxLength={5} />
            </View>
          </Row>
        </Card>
      ))}

      {drafts.length < MAX_STOPS ? (
        <Button label="Add a stop" icon="add" kind="secondary" onPress={() => add({ kind: 'fuel', name: '', km: '', time: '' })} />
      ) : (
        <Small>That’s 15 stops, the most a plan holds.</Small>
      )}

      {route && waypoints.length > 0 && drafts.length < MAX_STOPS ? (
        <Stack gap={space.sm}>
          <SectionTitle title="From the route" />
          <Card style={{ padding: 0, gap: 0 }}>
            {waypoints.map((w, i) => {
              const at = kmAlong(route, [w.lat, w.lng]);
              return (
                <ListRow
                  key={`${i}-${w.name}`}
                  last={i === waypoints.length - 1}
                  title={w.name}
                  subtitle={`km ${kmText(at)}`}
                  right={<Ionicons name="add-circle-outline" size={22} color={colors.boneDim} />}
                  onPress={() => add({ kind: 'other', name: w.name, km: kmText(at), time: '' })}
                />
              );
            })}
          </Card>
        </Stack>
      ) : null}

      <Stack gap={space.sm}>
        <SectionTitle title="Fuel check" />
        <Card>
          <FuelLines check={check} data={data} />
        </Card>
      </Stack>

      <ErrorLine error={error} />
      <Button label="Save the plan" icon="checkmark" busy={busy} onPress={save} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Call the ride: off or postponed
// ---------------------------------------------------------------------------

export function CallRideScreen({ route: nav, navigation }: RootScreen<'CallRide'>) {
  const { me, data, callRide } = useClub();
  const ride = data.rides.find((r) => r.id === nav.params.rideId);
  const [state, setState] = useState<Exclude<RideCallState, 'on'>>('off');
  const [reason, setReason] = useState('');
  const [dayText, setDayText] = useState('');
  const { busy, error, setError, run } = useAction();
  if (!ride || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Ride not found">It may have come off the club calendar.</Notice>
      </Screen>
    );
  }
  const typed = dayText.trim();
  const newDay = state === 'postponed' && typed ? parseAuDate(typed) : null;
  const dayError = state === 'postponed' && typed.length >= 10 && !newDay ? 'Use DD/MM/YYYY, like 15/11/2026.' : null;
  const problem = callProblem(me, ride, state, reason, newDay, data, nowIso());
  const go = () =>
    run(async () => {
      if (dayError) throw new Error(dayError);
      if (problem) throw new Error(problem);
      await callRide(ride.id, state, reason, newDay);
    }, () => navigation.goBack());

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H2>{ride.title}</H2>
        <Small>Everyone sees it on the ride straight away, and the ride chat gets a line from you.</Small>
      </Stack>
      <Choices<Exclude<RideCallState, 'on'>>
        label="What’s happening?"
        options={[{ value: 'off', label: 'Ride’s off' }, { value: 'postponed', label: 'Postponed' }]}
        value={state}
        onChange={(s) => { setError(null); setState(s); }}
      />
      <View style={styles.quick}>
        {QUICK_REASONS.map((q) => (
          <Pressable
            key={q}
            accessibilityRole="button"
            accessibilityLabel={`Reason: ${q}`}
            onPress={() => { setError(null); setReason(q); }}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.quickChip, (pressed || hovered) && { backgroundColor: colors.steelHi }]}
          >
            <Text style={styles.quickText}>{q}</Text>
          </Pressable>
        ))}
      </View>
      <Field
        label="Reason"
        value={reason}
        onChangeText={(t) => { setError(null); setReason(t); }}
        placeholder="Rain and 90 km/h winds"
        hint={`Optional. ${MAX_REASON} characters at most.`}
        multiline
      />
      {state === 'postponed' ? (
        <Field
          label="New day"
          value={dayText}
          onChangeText={(t) => { setError(null); setDayText(typeDate(t)); }}
          placeholder="DD/MM/YYYY"
          inputMode="numeric"
          maxLength={10}
          error={dayError}
          hint="Optional. Move it in the club calendar too, so the website matches."
        />
      ) : null}
      <ErrorLine error={error} />
      {busy ? (
        <Button label="Saving" busy onPress={() => {}} />
      ) : (
        <ConfirmButton
          label={state === 'off' ? 'Call it off' : 'Postpone it'}
          confirmLabel={state === 'off' ? 'Yes, it’s off' : 'Yes, postpone'}
          kind="primary"
          icon={state === 'off' ? 'close-circle-outline' : 'time-outline'}
          onConfirm={go}
        />
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------

export function HubScreen({ route: nav, navigation }: RootScreen<'Hub'>) {
  const { me, data, today, registerHub, withdrawHub } = useClub();
  const ride = data.rides.find((r) => r.id === nav.params.rideId);
  const hub = ride ? hubFor(ride.id, data) : undefined;
  const mine = ride && me ? myRegistration(ride.id, me.id, data) : undefined;
  const [staying, setStaying] = useState<HubStaying>(mine?.staying ?? 'group');
  const [pillion, setPillion] = useState(mine?.pillion ?? false);
  const [shareWith, setShareWith] = useState(mine?.shareWith ?? '');
  const [notes, setNotes] = useState(mine?.notes ?? '');
  const { busy, error, setError, run } = useAction();
  const [shareError, setShareError] = useState<string | null>(null);

  if (!ride || !me || !hub) {
    return (
      <Screen>
        <Notice tone="warn" title="No registrations">This ride doesn’t take registrations.</Notice>
      </Screen>
    );
  }
  const input: RegisterInput = { staying, pillion, shareWith, notes };
  const canRun = saveHubProblem(me, ride, { membersOnly: hub.membersOnly, closesOn: hub.closesOn, beds: hub.beds, accommodation: '', notes: '' }, data, nowIso()) === null;
  const closed = registrationsClosed(ride, hub, nowIso(), today);
  const counts = hubCounts(ride.id, data);
  const regs = registrationsFor(ride.id, data);
  const canWithdraw = withdrawHubProblem(me, ride, data, nowIso()) === null;
  const blocked = registerProblem(me, ride, { ...input, staying: 'own' }, data, nowIso(), today);
  const set = <T,>(fn: (v: T) => void) => (v: T) => { setError(null); fn(v); };
  const register = () =>
    run(async () => {
      const problem = registerProblem(me, ride, input, data, nowIso(), today);
      if (problem) throw new Error(problem);
      await registerHub(ride.id, input);
    });
  const share = async () => {
    setShareError(null);
    try {
      await Share.share({ message: hubListText(ride, data) });
    } catch {
      setShareError('Couldn’t open sharing on this device.');
    }
  };

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H2>{ride.title}</H2>
        <Row style={{ gap: 6 }}>
          {hub.membersOnly ? <Chip label="FNG, Full and Nomad" tone="steel" /> : <Chip label="Open to all members" tone="steel" />}
          {closed ? <Chip label="Closed" tone="steel" /> : hub.closesOn ? <Chip label={`Closes ${formatAuDate(hub.closesOn)}`} tone="warn" /> : null}
        </Row>
      </Stack>

      {hub.accommodation || hub.notes ? (
        <Card>
          {hub.accommodation ? (
            <Stack gap={space.xs}>
              <Label>Accommodation</Label>
              <Body selectable>{hub.accommodation}</Body>
            </Stack>
          ) : null}
          {hub.notes ? (
            <Stack gap={space.xs}>
              <Label>Notes</Label>
              <Body selectable>{hub.notes}</Body>
            </Stack>
          ) : null}
        </Card>
      ) : null}

      <Stack gap={space.sm}>
        <SectionTitle title={mine ? 'Your registration' : 'Register'} />
        {mine && registeredNotGoing(ride.id, me, data) ? (
          <Notice tone="warn">You’re registered, but your ride answer isn’t Going. Say Going on the ride too.</Notice>
        ) : null}
        {closed || (blocked && blocked !== 'The group booking is full.') ? (
          <Notice>{closed ? 'Registrations have closed.' : blocked}</Notice>
        ) : (
          <Card>
            <Choices<HubStaying>
              label="Staying"
              options={STAYING.map((s) => ({ value: s, label: STAYING_LABEL[s] }))}
              value={staying}
              onChange={set(setStaying)}
            />
            {hub.beds && staying === 'group' ? <Small>{`${counts.group > 0 ? `${regsPlaces(regs)} of ${hub.beds}` : `0 of ${hub.beds}`} group beds taken.`}</Small> : null}
            <Toggle label="Bringing a pillion" value={pillion} onChange={set(setPillion)} />
            <Field label="Sharing with" value={shareWith} onChangeText={set(setShareWith)} placeholder="Who you’d bunk with" maxLength={MAX_SHARE_WITH + 20} hint="Optional." />
            <Field label="Notes" value={notes} onChangeText={set(setNotes)} placeholder="Dietary needs, arriving late" multiline hint={`Optional. ${MAX_REG_NOTES} characters at most.`} />
            <ErrorLine error={error} />
            <Button label={mine ? 'Save changes' : 'Register'} icon="checkmark" busy={busy} onPress={register} />
          </Card>
        )}
        {mine && canWithdraw ? (
          <ConfirmButton label="Withdraw" confirmLabel="Yes, withdraw" kind="secondary" onConfirm={() => run(() => withdrawHub(ride.id))} />
        ) : null}
      </Stack>

      <Stack gap={space.sm}>
        <SectionTitle title="Who’s coming" action={<Text style={styles.count}>{counts.riders}</Text>} />
        <Small>{`${counts.pillions} pillion${counts.pillions === 1 ? '' : 's'} · ${STAYING.map((s) => `${counts[s]} ${STAYING_LABEL[s].toLowerCase()}`).join(' · ')}`}</Small>
        {regs.length === 0 ? (
          <Small>Nobody yet.</Small>
        ) : (
          <Card style={{ padding: 0, gap: 0 }}>
            {regs.map((r, i) => {
              const m = data.members.find((x) => x.id === r.memberId);
              return (
                <ListRow
                  key={r.memberId}
                  last={i === regs.length - 1}
                  left={<Avatar text={m ? initials(m) : '?'} size={40} />}
                  title={m ? displayName(m) : memberName(r.memberId, data.members)}
                  subtitle={[STAYING_LABEL[r.staying], r.pillion ? '+ pillion' : null, r.shareWith ? `with ${r.shareWith}` : null].filter(Boolean).join(' · ')}
                  onPress={m ? () => navigation.navigate('MemberDetail', { memberId: m.id }) : undefined}
                />
              );
            })}
          </Card>
        )}
      </Stack>

      {canRun ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Run it" />
          <Button label="Share the list" icon="share-outline" kind="secondary" onPress={share} />
          {shareError ? <Notice tone="danger">{shareError}</Notice> : null}
          <Button label="Edit the hub" icon="create-outline" kind="secondary" onPress={() => navigation.navigate('EditHub', { rideId: ride.id })} />
        </Stack>
      ) : null}
    </Screen>
  );
}

/** Group places taken: riders with the group and their pillions. */
const regsPlaces = (regs: ReturnType<typeof registrationsFor>) =>
  regs.filter((r) => r.staying === 'group').reduce((n, r) => n + 1 + (r.pillion ? 1 : 0), 0);

export function EditHubScreen({ route: nav, navigation }: RootScreen<'EditHub'>) {
  const { me, data, saveHub } = useClub();
  const ride = data.rides.find((r) => r.id === nav.params.rideId);
  const hub = ride ? hubFor(ride.id, data) : undefined;
  const [membersOnly, setMembersOnly] = useState(hub?.membersOnly ?? true);
  const [closesText, setClosesText] = useState(formatAuDate(hub?.closesOn ?? null));
  const [beds, setBeds] = useState(hub?.beds ? String(hub.beds) : '');
  const [accommodation, setAccommodation] = useState(hub?.accommodation ?? '');
  const [notes, setNotes] = useState(hub?.notes ?? '');
  const { busy, error, setError, run } = useAction();
  if (!ride || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Ride not found">It may have come off the club calendar.</Notice>
      </Screen>
    );
  }
  const closesTyped = closesText.trim();
  const closesOn = closesTyped ? parseAuDate(closesTyped) : null;
  const closesError = closesTyped.length >= 10 && !closesOn ? 'Use DD/MM/YYYY, like 01/03/2027.' : null;
  const bedsTyped = beds.trim();
  const bedsNumber = bedsTyped ? (/^\d+$/.test(bedsTyped) ? Number(bedsTyped) : Number.NaN) : null;
  const input = { membersOnly, closesOn, beds: bedsNumber, accommodation, notes };
  const set = <T,>(fn: (v: T) => void) => (v: T) => { setError(null); fn(v); };
  const save = () =>
    run(async () => {
      if (closesError) throw new Error(closesError);
      const problem = saveHubProblem(me, ride, input, data, nowIso());
      if (problem) throw new Error(problem);
      await saveHub(ride.id, input);
    }, () => (hub ? navigation.goBack() : navigation.replace('Hub', { rideId: ride.id })));

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H2>{ride.title}</H2>
        <Small>Registrations and accommodation for the ride. No payments here yet: sort those the usual way.</Small>
      </Stack>
      <Card>
        <Toggle
          label="Members only"
          description="FNG, Full and Nomad members. Supporters can’t join Club-only rides like the Big 4."
          value={membersOnly}
          onChange={set(setMembersOnly)}
        />
        <Field
          label="Registrations close"
          value={closesText}
          onChangeText={(t) => { setError(null); setClosesText(typeDate(t)); }}
          placeholder="DD/MM/YYYY"
          inputMode="numeric"
          maxLength={10}
          error={closesError}
          hint="Optional. Open until the end of that day, and never past the ride’s start."
        />
        <Field label="Group beds" value={beds} onChangeText={set(setBeds)} inputMode="numeric" keyboardType="number-pad" maxLength={3} placeholder="40" hint="Optional. Places in the group booking, counting pillions." />
        <Field label="Accommodation" value={accommodation} onChangeText={set(setAccommodation)} multiline placeholder="Where we’re staying, how to book, check-in times" hint={`${MAX_HUB_TEXT} characters at most.`} />
        <Field label="Notes" value={notes} onChangeText={set(setNotes)} multiline placeholder="Dinner plans, what to bring" />
      </Card>
      <ErrorLine error={error} />
      <Button label={hub ? 'Save the hub' : 'Open registrations'} icon="checkmark" busy={busy} onPress={save} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Ask someone to swap
// ---------------------------------------------------------------------------

export function AskSwapScreen({ route: nav, navigation }: RootScreen<'AskSwap'>) {
  const { me, data, askSwap } = useClub();
  const ride = data.rides.find((r) => r.id === nav.params.rideId);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const { busy, error, setError, run } = useAction();
  const mySpot = ride && me ? spotOf(ride.id, me.id, data.crew) : null;
  if (!ride || !me || !mySpot) {
    return (
      <Screen>
        <Notice tone="warn">You’re not on this ride’s crew.</Notice>
      </Screen>
    );
  }
  const now = nowIso();
  const { going, holders, rest } = pickGroups(ride, mySpot, me, data);
  // Anyone who could take the spot, crew included (a trade), leaving out yourself.
  const people = [...going, ...holders, ...rest].filter((m) => m.id !== me.id && askSwapProblem(me, ride, m.id, '', data, now) === null);
  const target = people.find((m) => m.id === picked);
  const theirSpot = target ? spotOf(ride.id, target.id, data.crew) : null;
  const ask = () =>
    run(async () => {
      if (!picked) throw new Error('Pick who to ask.');
      const problem = askSwapProblem(me, ride, picked, note, data, now);
      if (problem) throw new Error(problem);
      await askSwap(ride.id, picked, note);
    }, () => navigation.goBack());

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H2>{`Your ${ROLE_LABEL[mySpot]} spot`}</H2>
        <Small>They get the ask on the ride and on their phone. You stay on the crew until they say yes.</Small>
      </Stack>
      {people.length === 0 ? (
        <Notice>Nobody else can take this spot right now.</Notice>
      ) : (
        <Card style={{ padding: 0, gap: 0 }}>
          {people.map((m, i) => {
            const on = m.id === picked;
            const spot = spotOf(ride.id, m.id, data.crew);
            const answer = data.rsvps.find((r) => r.rideId === ride.id && r.memberId === m.id)?.answer;
            const sub = spot ? `Trade: they’re ${ROLE_LABEL[spot]}` : answer === 'going' ? 'Going' : answer === 'maybe' ? 'Maybe' : null;
            return (
              <Pressable
                key={m.id}
                accessibilityRole="radio"
                accessibilityLabel={[displayName(m), sub].filter(Boolean).join(', ')}
                accessibilityState={{ checked: on }}
                aria-checked={on}
                onPress={() => { setError(null); setPicked(m.id); }}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.pickRow,
                  i === people.length - 1 && { borderBottomWidth: 0 },
                  (pressed || hovered) && { backgroundColor: colors.steel },
                ]}
              >
                <Avatar text={initials(m)} size={40} />
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Text numberOfLines={1} style={type.name}>{displayName(m)}</Text>
                  {sub ? <Small>{sub}</Small> : null}
                </View>
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.redText : colors.boneMute} />
              </Pressable>
            );
          })}
        </Card>
      )}
      {target && theirSpot ? <Notice>{`A trade: you’d take ${displayName(target)}’s ${ROLE_LABEL[theirSpot]} spot.`}</Notice> : null}
      <Field label="Note" value={note} onChangeText={(t) => { setError(null); setNote(t); }} placeholder="Work came up" hint="Optional. 200 characters at most." multiline />
      <ErrorLine error={error} />
      <Button label="Ask" icon="paper-plane-outline" busy={busy} disabled={!picked} onPress={ask} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Route ratings (on the route screen)
// ---------------------------------------------------------------------------

/** The route's stars: your own pick and comment, then everyone's, newest first. */
export function RouteRatings({ route, me, data }: { route: Route; me: Member; data: ClubData }) {
  const { rateRoute } = useClub();
  const mine = (data.routeRatings ?? []).find((r) => r.routeId === route.id && r.memberId === me.id);
  const [stars, setStars] = useState(mine?.stars ?? 0);
  const [comment, setComment] = useState(mine?.comment ?? '');
  const [saved, setSaved] = useState(false);
  const { busy, error, setError, run } = useAction();
  const all = ratingsFor(route.id, data);
  const score = routeScore(route.id, data.routeRatings);
  const canRate = me.approval === 'approved' && !route.archivedAt;
  const save = () => {
    setSaved(false);
    const problem = rateProblem(me, route, stars, comment);
    if (problem) return setError(problem);
    run(() => rateRoute(route.id, stars, comment), () => setSaved(true));
  };
  return (
    <Stack gap={space.sm}>
      <SectionTitle title="Ratings" action={<Text style={styles.count}>{starsLine(score)}</Text>} />
      {canRate ? (
        <Card>
          <Label>{mine ? 'Your rating' : 'Rate this route'}</Label>
          <View accessibilityRole="radiogroup" style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                accessibilityRole="radio"
                accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`}
                accessibilityState={{ checked: stars === n }}
                aria-checked={stars === n}
                hitSlop={4}
                onPress={() => { setError(null); setSaved(false); setStars(n); }}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.star,
                  (pressed || hovered) && { backgroundColor: colors.steel },
                ]}
              >
                <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={28} color={n <= stars ? colors.warn : colors.boneMute} />
              </Pressable>
            ))}
          </View>
          <Field
            label="Comment"
            value={comment}
            onChangeText={(t) => { setError(null); setSaved(false); setComment(t); }}
            placeholder="Great twisties, rough patch after the dam"
            hint={`Optional. ${MAX_COMMENT} characters at most.`}
            multiline
            maxLength={MAX_COMMENT + 20}
          />
          <ErrorLine error={error} />
          {saved && !error ? <Small>Saved.</Small> : null}
          <Button label={mine ? 'Change my rating' : 'Save rating'} icon="star" kind="secondary" busy={busy} disabled={stars === 0} onPress={save} />
        </Card>
      ) : null}
      {all.length > 0 ? (
        <Card style={{ padding: 0, gap: 0 }}>
          {all.map((r, i) => (
            <View key={r.memberId} style={[styles.ratingRow, i === all.length - 1 && { borderBottomWidth: 0 }]}>
              <Row style={{ gap: space.sm, alignItems: 'center' }}>
                <Text style={[type.name, { flex: 1 }]} numberOfLines={1}>{memberName(r.memberId, data.members)}</Text>
                <Text style={styles.ratingStars} accessibilityLabel={`${r.stars} of 5 stars`}>{'★'.repeat(r.stars) + '☆'.repeat(5 - r.stars)}</Text>
              </Row>
              {r.comment ? <Body selectable>{r.comment}</Body> : null}
              <Text style={styles.stopMeta}>{formatAuDate(melbourneDate(r.ratedAt))}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </Stack>
  );
}

/** The bike's range, for the bike editor: the field's text and what it reads as. */
export function readRange(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

/** A member's limiting bike line for their profile, e.g. "Sportster: 180 km to the fuel light". */
export function rangeLine(memberId: string, data: ClubData): string | null {
  const r = bikeRange(memberId, data);
  return r ? `${r.bike.nickname ?? r.bike.model}: ${km(r.rangeKm)} to the fuel light` : null;
}

export const writesRide = writesBriefing;

const styles = StyleSheet.create({
  count: { fontFamily: fonts.stencil, fontSize: 16, color: colors.boneMute },
  fuelHead: { gap: space.sm, alignItems: 'center' },
  legWarn: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.warnBg,
    borderRadius: radius.sm,
    padding: space.md,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  stopIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.steel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopMeta: { fontFamily: fonts.stencil, fontSize: 13, letterSpacing: 0.4, color: colors.boneMute, marginTop: 2 },
  removeText: { fontFamily: fonts.stencil, fontSize: 14, letterSpacing: 0.4, color: colors.redText },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  quickChip: {
    minHeight: 44,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 64,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  starRow: { flexDirection: 'row', gap: space.xs },
  star: { width: 48, height: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  ratingRow: { padding: space.lg, gap: space.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  ratingStars: { fontSize: 16, letterSpacing: 2, color: colors.warn },
  quickText: { fontFamily: fonts.stencil, fontSize: 15, letterSpacing: 0.4, color: colors.bone },
});
