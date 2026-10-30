// Charity ride sign-ups on screen: the Charity ride card on the ride screen, the sign-up sheet
// (your sign-up, who's coming and who's helping), and running the sign-ups. No payments yet.

import React, { useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import {
  charityCounts, charityFor, charityListText, countsLine, DONATIONS_LATER, MAX_ABOUT, MAX_CAUSE, MAX_GUEST_NAMES, MAX_GUESTS, MAX_JOBS,
  MAX_SIGNUP_NOTES, mySignup, placesLeft, ridingNotGoing, runsCharity, saveCharityProblem, signupExtras, signupProblem, signupsClosed,
  visibleSignups, withdrawCharityProblem, type SignupInput,
} from '../domain/charity';
import { formatAuDate, parseAuDate, typeDate } from '../domain/dates';
import { displayName, initials, memberName } from '../domain/profile';
import { endOfFirstDay } from '../domain/rides';
import type { CharitySignup, ClubData, Member, Ride } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { colors, fonts, radius, space, type } from '../theme';
import {
  Avatar, Body, Button, Card, Chip, Choices, ConfirmButton, Field, H2, IconBadge, Ionicons, Label, ListRow, Notice, Row, Screen, SectionTitle,
  Small, Stack, Toggle,
} from '../ui/primitives';

const nowIso = () => new Date().toISOString();
/** The job choice's value for "not helping". */
const NO_JOB = '';

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

/** "53 places left", "1 place left" or "Full". */
const placesText = (left: number) => (left === 0 ? 'Full' : `${left} place${left === 1 ? '' : 's'} left`);

// ---------------------------------------------------------------------------
// On the ride screen
// ---------------------------------------------------------------------------

/** The Charity ride card: the cause, the counts and your sign-up; an offer to the people who run them. */
export function CharitySection({ ride, me, data, today, onOpen, onEdit }: {
  ride: Ride; me: Member; data: ClubData; today: string; onOpen: () => void; onEdit: () => void;
}) {
  if (me.approval !== 'approved') return null;
  const charity = charityFor(ride.id, data);
  if (!charity) {
    // Only for the people who run sign-ups, while the ride can still change.
    if (ride.cancelledAt || Date.parse(nowIso()) >= endOfFirstDay(ride) || !runsCharity(me, ride, data)) return null;
    return <Button label="Take charity sign-ups" icon="heart-outline" kind="quiet" onPress={onEdit} />;
  }
  const counts = charityCounts(ride.id, data);
  const mine = mySignup(ride.id, me.id, data);
  const closed = ride.cancelledAt !== null || signupsClosed(ride, charity, nowIso(), today);
  const left = placesLeft(ride.id, data);
  return (
    <Stack gap={space.sm}>
      <SectionTitle title="Charity ride" />
      <Card>
        <Row style={{ gap: space.md, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <IconBadge icon="heart" />
          <View style={{ flex: 1, gap: 2 }}>
            <Label>Raising money for</Label>
            <Text style={type.name}>{charity.cause}</Text>
          </View>
        </Row>
        <Text style={styles.countsLine}>{countsLine(counts)}</Text>
        <Row style={{ gap: 6 }}>
          {mine ? <Chip label={mine.riding ? 'You’re riding' : `You’re on ${mine.job}`} tone="ok" icon="checkmark" /> : null}
          {closed ? <Chip label="Closed" tone="steel" /> : charity.closesOn ? <Chip label={`Closes ${formatAuDate(charity.closesOn)}`} tone="warn" /> : null}
          {left !== null && !closed ? <Chip label={placesText(left)} tone={left === 0 ? 'warn' : 'steel'} /> : null}
        </Row>
        <Button
          label={mine || closed ? 'Open sign-ups' : 'Sign up'}
          icon="heart-outline"
          kind="secondary"
          onPress={onOpen}
        />
      </Card>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// The sign-up sheet
// ---------------------------------------------------------------------------

/** − 2 + for guests: big targets, no typing. */
function Stepper({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (n: number) => void }) {
  const step = (by: number, name: string) => {
    const next = value + by;
    const off = next < 0 || next > max;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${label}`}
        accessibilityState={{ disabled: off }}
        disabled={off}
        onPress={() => onChange(next)}
        style={({ pressed }) => [styles.stepButton, pressed && { backgroundColor: colors.steelHi }, off && { opacity: 0.45 }]}
      >
        <Ionicons name={by < 0 ? 'remove' : 'add'} size={22} color={colors.bone} />
      </Pressable>
    );
  };
  return (
    <View style={{ gap: space.xs }}>
      <Label>{label}</Label>
      <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
        {step(-1, 'Fewer')}
        <Text style={styles.stepValue} accessibilityLiveRegion="polite">{value}</Text>
        {step(1, 'More')}
      </Row>
    </View>
  );
}

const subtitleOf = (s: CharitySignup) =>
  [s.riding ? `Riding${signupExtras(s)}` : `Helping${signupExtras(s)}`, s.riding && s.job ? `also ${s.job}` : null].filter(Boolean).join(' · ');

/** The sheet starts again from your saved sign-up whenever it changes (here or on another phone). */
export function CharityScreen(props: RootScreen<'Charity'>) {
  const { me, data } = useClub();
  const saved = me ? mySignup(props.route.params.rideId, me.id, data) : undefined;
  return <CharitySheet key={saved?.signedAt ?? 'none'} {...props} />;
}

function CharitySheet({ route: nav, navigation }: RootScreen<'Charity'>) {
  const { me, data, today, signUpCharity, withdrawCharity } = useClub();
  const ride = data.rides.find((r) => r.id === nav.params.rideId);
  const charity = ride ? charityFor(ride.id, data) : undefined;
  const mine = ride && me ? mySignup(ride.id, me.id, data) : undefined;
  // On a full ride a newcomer starts as a helper, since helpers still fit.
  const [riding, setRiding] = useState(mine?.riding ?? (ride ? placesLeft(ride.id, data) !== 0 : true));
  const [pillion, setPillion] = useState(mine?.pillion ?? false);
  const [guests, setGuests] = useState(mine?.guests ?? 0);
  const [guestNames, setGuestNames] = useState(mine?.guestNames ?? '');
  const [job, setJob] = useState<string>(mine?.job ?? NO_JOB);
  const [notes, setNotes] = useState(mine?.notes ?? '');
  const { busy, error, setError, run } = useAction();
  const withdrawing = useAction();
  const [shareError, setShareError] = useState<string | null>(null);

  if (!ride || !me || !charity) {
    return (
      <Screen>
        <Notice tone="warn" title="No sign-ups">This ride doesn’t take sign-ups.</Notice>
      </Screen>
    );
  }
  const input: SignupInput = {
    riding, pillion: riding && pillion, guests, guestNames: guests > 0 ? guestNames : '', job: job === NO_JOB ? null : job, notes,
  };
  const runs = runsCharity(me, ride, data);
  const closed = ride.cancelledAt !== null || signupsClosed(ride, charity, nowIso(), today);
  const counts = charityCounts(ride.id, data);
  const left = placesLeft(ride.id, data);
  const signups = visibleSignups(me, ride.id, data);
  const riders = signups.filter((s) => s.riding);
  const canWithdraw = withdrawCharityProblem(me, ride, data, nowIso()) === null;
  // A reason the form can't help with at all: neither riding alone nor helping alone would go in.
  // (A full ride with jobs still takes helpers; a bad choice shows on save.)
  const plain: SignupInput = { riding: true, pillion: false, guests: 0, guestNames: '', job: null, notes: '' };
  const toRide = signupProblem(me, ride, plain, data, nowIso(), today);
  const toHelp = charity.jobs.length > 0 ? signupProblem(me, ride, { ...plain, riding: false, job: charity.jobs[0] }, data, nowIso(), today) : toRide;
  const blocked = toRide && toHelp ? toRide : null;
  const set = <T,>(fn: (v: T) => void) => (v: T) => { setError(null); fn(v); };
  const signUp = () =>
    run(async () => {
      const problem = signupProblem(me, ride, input, data, nowIso(), today);
      if (problem) throw new Error(problem);
      await signUpCharity(ride.id, input);
    });
  const share = async () => {
    setShareError(null);
    try {
      await Share.share({ message: charityListText(me, ride, data) });
    } catch {
      setShareError('Couldn’t open sharing on this device.');
    }
  };
  const row = (s: CharitySignup, i: number, list: CharitySignup[], subtitle: string) => {
    const m = data.members.find((x) => x.id === s.memberId);
    return (
      <ListRow
        key={s.memberId}
        last={i === list.length - 1}
        left={<Avatar text={m ? initials(m) : '?'} size={40} />}
        title={m ? displayName(m) : memberName(s.memberId, data.members)}
        subtitle={subtitle}
        onPress={m ? () => navigation.navigate('MemberDetail', { memberId: m.id }) : undefined}
      />
    );
  };

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H2>{ride.title}</H2>
        <Row style={{ gap: space.md, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <IconBadge icon="heart" />
          <View style={{ flex: 1, gap: 2 }}>
            <Label>Raising money for</Label>
            <Text style={styles.cause}>{charity.cause}</Text>
          </View>
        </Row>
        <Row style={{ gap: 6 }}>
          {closed ? <Chip label="Closed" tone="steel" /> : charity.closesOn ? <Chip label={`Closes ${formatAuDate(charity.closesOn)}`} tone="warn" /> : null}
          {left !== null ? <Chip label={placesText(left)} tone={left === 0 ? 'warn' : 'steel'} /> : null}
          <Chip label="Open to all members" tone="steel" />
        </Row>
      </Stack>

      {charity.about ? (
        <Card>
          <Body selectable>{charity.about}</Body>
        </Card>
      ) : null}
      <Row style={{ gap: space.sm, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <Ionicons name="cash-outline" size={16} color={colors.boneMute} style={{ marginTop: 1 }} />
        <Small style={{ flex: 1 }}>{DONATIONS_LATER}</Small>
      </Row>

      <Stack gap={space.sm}>
        <SectionTitle title={mine ? 'Your sign-up' : 'Sign up'} />
        {mine && ridingNotGoing(ride.id, me, data) ? (
          <Notice tone="warn">You’re signed up to ride, but your ride answer isn’t Going. Say Going on the ride too.</Notice>
        ) : null}
        {closed || blocked ? (
          <Notice>{closed ? 'Sign-ups have closed.' : blocked}</Notice>
        ) : (
          <Card>
            <Toggle label="I’m riding" value={riding} onChange={set(setRiding)} />
            {riding ? <Toggle label="Bringing a pillion" value={pillion} onChange={set(setPillion)} /> : null}
            <Stepper label="Guests" value={guests} max={MAX_GUESTS} onChange={set(setGuests)} />
            <Small>Friends coming along who aren’t in the app. They count towards the places.</Small>
            {guests > 0 ? (
              <Field label="Guests’ names" value={guestNames} onChangeText={set(setGuestNames)} placeholder="So the organisers have them" hint={`Optional. ${MAX_GUEST_NAMES} characters at most.`} />
            ) : null}
            {charity.jobs.length > 0 ? (
              <Choices<string>
                label="Helping with"
                options={[{ value: NO_JOB, label: 'Not helping' }, ...charity.jobs.map((j) => ({ value: j, label: j }))]}
                value={job}
                onChange={set(setJob)}
              />
            ) : null}
            <Field label="Notes" value={notes} onChangeText={set(setNotes)} placeholder="Arriving late, bringing the trailer" multiline hint={`Optional. ${MAX_SIGNUP_NOTES} characters at most.`} />
            <ErrorLine error={error} />
            <Button label={mine ? 'Save changes' : 'Sign up'} icon="checkmark" busy={busy} onPress={signUp} />
          </Card>
        )}
        {mine && canWithdraw ? (
          <ConfirmButton label="Withdraw" confirmLabel="Yes, withdraw" kind="secondary" onConfirm={() => withdrawing.run(() => withdrawCharity(ride.id))} />
        ) : null}
        <ErrorLine error={withdrawing.error} />
      </Stack>

      <Stack gap={space.sm}>
        <SectionTitle title="Riding" action={<Text style={styles.count}>{counts.riding}</Text>} />
        {counts.riding + counts.helping > 0 ? <Small>{`${countsLine(counts)}. ${counts.people} on bikes.`}</Small> : null}
        {!runs ? <Small>The organisers and the boards see who’s coming; the numbers are everyone’s.</Small> : null}
        {riders.length === 0 ? (
          runs ? <Small>Nobody yet.</Small> : null
        ) : (
          <Card style={{ padding: 0, gap: 0 }}>{riders.map((s, i, list) => row(s, i, list, subtitleOf(s)))}</Card>
        )}
      </Stack>

      {/* Helpers by job: the whole list for whoever runs the sign-ups; otherwise only the rows the
          viewer can see (their own, or their chapter's as a board member), with no count to mislead. */}
      {charity.jobs.map((j) => {
        const helpers = signups.filter((s) => s.job === j);
        if (!runs && helpers.length === 0) return null;
        return (
          <Stack key={j} gap={space.sm}>
            <SectionTitle title={j} action={runs ? <Text style={styles.count}>{helpers.length}</Text> : undefined} />
            {helpers.length === 0 ? (
              <Small>Nobody yet.</Small>
            ) : (
              <Card style={{ padding: 0, gap: 0 }}>
                {helpers.map((s, i, list) => row(s, i, list, [s.riding ? 'Riding too' : 'Helping only', s.notes || null].filter(Boolean).join(' · ')))}
              </Card>
            )}
          </Stack>
        );
      })}

      {runs ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Run it" />
          <Button label="Share the list" icon="share-outline" kind="secondary" onPress={share} />
          {shareError ? <Notice tone="danger">{shareError}</Notice> : null}
          {saveCharityProblem(me, ride, { cause: charity.cause, about: '', closesOn: charity.closesOn, places: null, jobs: charity.jobs }, data, nowIso()) === null ? (
            <Button label="Edit sign-ups" icon="create-outline" kind="secondary" onPress={() => navigation.navigate('EditCharity', { rideId: ride.id })} />
          ) : null}
        </Stack>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Running the sign-ups
// ---------------------------------------------------------------------------

export function EditCharityScreen({ route: nav, navigation }: RootScreen<'EditCharity'>) {
  const { me, data, saveCharity } = useClub();
  const ride = data.rides.find((r) => r.id === nav.params.rideId);
  const charity = ride ? charityFor(ride.id, data) : undefined;
  const [cause, setCause] = useState(charity?.cause ?? '');
  const [about, setAbout] = useState(charity?.about ?? '');
  const [closesText, setClosesText] = useState(formatAuDate(charity?.closesOn ?? null));
  const [places, setPlaces] = useState(charity?.places ? String(charity.places) : '');
  const [jobsText, setJobsText] = useState((charity?.jobs ?? []).join('\n'));
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
  const placesTyped = places.trim();
  const placesNumber = placesTyped ? (/^\d+$/.test(placesTyped) ? Number(placesTyped) : Number.NaN) : null;
  const input = { cause, about, closesOn, places: placesNumber, jobs: jobsText.split('\n') };
  const set = <T,>(fn: (v: T) => void) => (v: T) => { setError(null); fn(v); };
  const save = () =>
    run(async () => {
      // A half-typed day is refused, never saved as no closing day.
      if (closesTyped && !closesOn) throw new Error('Use DD/MM/YYYY, like 01/03/2027.');
      const problem = saveCharityProblem(me, ride, input, data, nowIso());
      if (problem) throw new Error(problem);
      await saveCharity(ride.id, input);
    }, () => (charity ? navigation.goBack() : navigation.replace('Charity', { rideId: ride.id })));

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H2>{ride.title}</H2>
        <Small>Members sign up to ride, bring a pillion or friends, or help on the day. You get the list to send the organisers.</Small>
      </Stack>
      <Card>
        <Field label="Raising money for" value={cause} onChangeText={set(setCause)} placeholder="Royal Children’s Hospital" maxLength={MAX_CAUSE + 20} hint={`${MAX_CAUSE} characters at most.`} />
        <Field label="About" value={about} onChangeText={set(setAbout)} multiline placeholder="What to bring, where the money goes, who’s running it" hint={`Optional. ${MAX_ABOUT} characters at most.`} />
        <Field
          label="Sign-ups close"
          value={closesText}
          onChangeText={(t) => { setError(null); setClosesText(typeDate(t)); }}
          placeholder="DD/MM/YYYY"
          inputMode="numeric"
          maxLength={10}
          error={closesError}
          hint="Optional. Open until the end of that day, and never past the ride’s start."
        />
        <Field label="Places" value={places} onChangeText={set(setPlaces)} inputMode="numeric" keyboardType="number-pad" maxLength={4} placeholder="60" hint="Optional. People on bikes, counting pillions and guests." />
        <Field
          label="Helper jobs"
          value={jobsText}
          onChangeText={set(setJobsText)}
          multiline
          placeholder={'BBQ\nMarshal\nCollection bucket'}
          hint={`Optional. One per line, up to ${MAX_JOBS}. A job stays while someone’s on it.`}
        />
      </Card>
      <ErrorLine error={error} />
      <Button label={charity ? 'Save sign-ups' : 'Take sign-ups'} icon="checkmark" busy={busy} onPress={save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  count: { fontFamily: fonts.stencil, fontSize: 16, color: colors.boneMute },
  countsLine: { fontFamily: fonts.stencil, fontSize: 14, letterSpacing: 0.4, color: colors.boneDim },
  cause: { fontFamily: fonts.stencil, fontSize: 19, lineHeight: 26, letterSpacing: 0.6, color: colors.bone },
  stepButton: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { fontFamily: fonts.stencil, fontSize: 22, minWidth: 36, textAlign: 'center', color: colors.bone },
});
