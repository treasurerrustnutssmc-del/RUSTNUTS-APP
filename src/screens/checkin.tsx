// Check-ins at rides and meetings: I'm here (a leader confirms it), the code as a backup, running a
// check-in (confirming, who's here, ticking people off), opening one for a meeting, and the bits
// other screens show.

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useEffect, useRef, useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import {
  askCheckInProblem,
  attendanceCount,
  attendeesOf,
  canCheckIn,
  canConfirmCheckin,
  canRunCheckin,
  type CheckInAt,
  exemptionProblem,
  markProblem,
  meetingTypeOf,
  MEETING_TYPES,
  normalizeCode,
  openCheckinProblem,
  qrPayload,
  rideChapterId,
  waitingFor,
} from '../domain/attendance';
import { formatAuDate, parseAuDate, typeDate } from '../domain/dates';
import { agmOn, clubYearLabel, clubYearOf } from '../domain/clubYear';
import { displayName, initials } from '../domain/profile';
import { melbourneDate, melbourneTime } from '../domain/rides';
import type { CheckinSession, MeetingType, Member, Ride } from '../domain/types';
import type { RootParams, RootScreen } from '../navigation/types';
import { colors, fonts, radius, space, type } from '../theme';
import { QrCode } from '../ui/QrCode';
import {
  Avatar,
  Body,
  Button,
  Card,
  Chip,
  Choices,
  ConfirmButton,
  Field,
  H1,
  IconBadge,
  ListRow,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
} from '../ui/primitives';

const KIND_LABEL = { ride: 'Ride', meeting: 'Meeting' } as const;
const MEETING_TYPE_HINT: Record<MeetingType, string> = {
  ordinary: 'Counts towards the 80% Full Members need, and the 50% FNGs need. An Annual Chapter Meeting held with it counts once, as this.',
  special: 'Counts towards the two-of-three before a Big 4, not the 80%.',
  event: 'Recorded for the club. It doesn’t count towards anyone’s attendance.',
};
export const MEETING_TYPE_LABEL: Record<MeetingType, string> = { ordinary: 'Monthly meeting', special: 'Special or annual', event: 'Other event' };

const sessionsOf = (sessions: CheckinSession[] | undefined) => sessions ?? [];

// ---------------------------------------------------------------------------
// I'm here
// ---------------------------------------------------------------------------

/** The check-in an I'm here goes to, if it's open yet. */
function sessionAt(at: CheckInAt, sessions: CheckinSession[]) {
  return 'rideId' in at ? sessions.find((s) => s.rideId === at.rideId) : sessions.find((s) => s.id === at.sessionId);
}

/** Today's rides and open check-ins `me` can still say they're here at, and the ones they're in or waiting at. */
function checkInsToday(me: Member, data: ReturnType<typeof useClub>['data'], today: string): { at: CheckInAt; title: string; key: string }[] {
  const sessions = sessionsOf(data.checkinSessions);
  const rides = data.rides
    .filter((r) => !r.cancelledAt && melbourneDate(r.startsAt) === today)
    .map((r) => ({ at: { rideId: r.id } as CheckInAt, title: r.title, key: `r-${r.id}` }));
  const meetings = sessions
    .filter((s) => s.kind === 'meeting' && !s.closedAt && s.heldOn === today)
    .map((s) => ({ at: { sessionId: s.id } as CheckInAt, title: s.title, key: `s-${s.id}` }));
  return [...rides, ...meetings].filter(({ at }) => {
    const s = sessionAt(at, sessions);
    const mine = !!s && ((data.attendance ?? []).some((a) => a.sessionId === s.id && a.memberId === me.id)
      || (data.checkinRequests ?? []).some((r) => r.sessionId === s.id && r.memberId === me.id));
    return mine || askCheckInProblem(me, at, data, today) === null;
  });
}

/** The I'm here button, then "Waiting for a ride leader", then "You're checked in". */
export function ImHere({ at }: { at: CheckInAt }) {
  const { me, data, today, askCheckIn } = useClub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const session = sessionAt(at, sessionsOf(data.checkinSessions));
  const meeting = session?.kind === 'meeting';
  const inNow = !!session && (data.attendance ?? []).some((a) => a.sessionId === session.id && a.memberId === me.id);
  const waiting = !!session && (data.checkinRequests ?? []).some((r) => r.sessionId === session.id && r.memberId === me.id);

  if (inNow) {
    return <ListRow left={<IconBadge icon="checkmark" tone="red" />} title="You’re checked in" subtitle={`${attendeesOf(session!.id, data).length} here so far`} last />;
  }
  if (waiting) {
    return (
      <ListRow
        left={<IconBadge icon="time-outline" />}
        title={meeting ? 'Waiting for the board' : 'Waiting for a ride leader'}
        subtitle="They’ve been told you’re here. Pull down to see when they confirm."
        lines="all"
        last
      />
    );
  }
  if (askCheckInProblem(me, at, data, today)) return null;
  const tap = async () => {
    setBusy(true);
    setError(null);
    try {
      await askCheckIn(at);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ padding: space.lg, gap: space.sm }}>
      <Button label="I’m here" icon="hand-right-outline" busy={busy} onPress={tap} />
      <Small>{meeting ? 'The board confirms you’re here.' : 'A ride leader gets a notice to confirm you’re here.'}</Small>
      <View accessibilityLiveRegion="polite" role="alert">
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Checking in
// ---------------------------------------------------------------------------

export function CheckInScreen({ navigation }: RootScreen<'CheckIn'>) {
  const { me, data, today, checkIn, isDemo, refresh } = useClub();
  const [withCode, setWithCode] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const handled = useRef(false); // a held-up code fires many scans; act on the first
  const [slow, setSlow] = useState(false);
  const { width } = useWindowDimensions();
  const camSize = Math.min(width - space.lg * 2 - space.lg * 2, 320);

  const submit = async (raw: string) => {
    if (busy) return;
    const typed = normalizeCode(raw);
    if (!typed) {
      setError('Type the code from the board’s screen.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sessionId = await checkIn(typed);
      setScanning(false);
      setDone(sessionId);
    } catch (e) {
      // Stop the camera, or it would send the same bad code again on every frame.
      setScanning(false);
      setError((e as Error).message);
      handled.current = false;
    } finally {
      setBusy(false);
    }
  };

  const startScan = async () => {
    setError(null);
    setCameraError(null);
    const p = permission?.granted ? permission : await requestPermission();
    if (!p.granted) {
      setCameraError('The camera’s turned off for the app. Type the code instead, or allow the camera in your phone’s settings.');
      return;
    }
    handled.current = false;
    setScanning(true);
  };

  if (done) {
    const session = sessionsOf(data.checkinSessions).find((s) => s.id === done);
    return (
      <Screen>
        <Card style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xxl }}>
          <IconBadge icon="checkmark" tone="red" />
          <H1 style={{ textAlign: 'center' }}>You’re checked in</H1>
          {session ? (
            <Text style={[type.name, { textAlign: 'center', color: colors.boneDim }]}>
              {session.title} · {formatAuDate(session.heldOn)}
            </Text>
          ) : null}
        </Card>
        <Button label="Done" onPress={() => navigation.goBack()} />
      </Screen>
    );
  }

  const todays = me ? checkInsToday(me, data, today) : [];
  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      <Stack gap={space.sm}>
        <H1>Check in</H1>
        <Body>Tap I’m here when you arrive. A ride leader or the board confirms it.</Body>
      </Stack>

      {todays.length === 0 ? (
        <Notice tone="info" title="Nothing on today">There’s no ride or open check-in to check in to today.</Notice>
      ) : (
        todays.map((t) => (
          <Card key={t.key} style={{ padding: 0, gap: 0 }}>
            <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg }}>
              <Text style={[type.name, { color: colors.bone }]}>{t.title}</Text>
            </View>
            <ImHere at={t.at} />
          </Card>
        ))
      )}

      {!withCode ? (
        <Button label="Got a code instead?" kind="quiet" icon="qr-code-outline" onPress={() => setWithCode(true)} />
      ) : (
      <>
      <SectionTitle title="With a code" />
      <Card>
        {scanning ? (
          <Stack gap={space.md} style={{ alignItems: 'center' }}>
            <View style={{ width: camSize, height: camSize, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.steel }}>
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onCameraReady={() => {
                  // If the code reader can't load (it's fetched separately on the web, and the
                  // one-file preview leaves it out), the camera shows but never scans. Offer the
                  // typed code after a while instead of leaving them waiting.
                  setSlow(false);
                  setTimeout(() => setSlow(true), 10000);
                }}
                onMountError={() => {
                  setScanning(false);
                  setCameraError('The camera wouldn’t start here. Type the code instead.');
                }}
                onBarcodeScanned={({ data: scanned }) => {
                  if (handled.current || busy) return;
                  handled.current = true;
                  if (!scanned.toUpperCase().startsWith(qrPayload(''))) {
                    setScanning(false);
                    setError('That’s not a club check-in code.');
                    return;
                  }
                  submit(scanned);
                }}
              />
            </View>
            <Small style={{ textAlign: 'center' }}>
              {slow ? 'Not picking it up? Type the code below instead.' : 'Hold the code inside the square.'}
            </Small>
            <Button label="Stop scanning" kind="quiet" onPress={() => setScanning(false)} />
          </Stack>
        ) : (
          <Button label="Scan the code" icon="qr-code-outline" onPress={startScan} />
        )}
        {cameraError ? <Notice tone="warn">{cameraError}</Notice> : null}
      </Card>

      <Card>
        <Field
          label="Or type the code"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          maxLength={12}
          placeholder="RN2026"
          returnKeyType="go"
          onSubmitEditing={() => submit(code)}
          style={{ fontFamily: fonts.stencil, fontSize: 22, letterSpacing: 4 }}
        />
        <Button label="Check in" kind="secondary" busy={busy} onPress={() => submit(code)} />
      </Card>
      </>
      )}

      <View accessibilityLiveRegion="polite" role="alert">
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Running a check-in
// ---------------------------------------------------------------------------

export function RunCheckinScreen({ route }: RootScreen<'RunCheckin'>) {
  const { me, data, today, checkinCode, markAttendance, answerCheckin, closeCheckin, setExemption, isDemo, refresh } = useClub();
  const session = sessionsOf(data.checkinSessions).find((s) => s.id === route.params.sessionId);
  const [code, setCode] = useState<string | null>(session?.code ?? null);
  // The code is a backup now: shown only when asked for.
  const [showCode, setShowCode] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Excusing someone (4.12, 5.3): whose reason is being typed.
  const [excusing, setExcusing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [choice, setChoice] = useState<'tick' | 'excuse'>('tick');
  const { width } = useWindowDimensions();
  const qrSize = Math.min(width - space.lg * 4, 300);

  const sessionId = session?.id;
  const closed = !!session?.closedAt;
  const runner = !!session && canRunCheckin(me, session.chapterId, data.positions);
  const confirmer = !!session && canConfirmCheckin(me, session, data);
  const liveToday = !!session && !session.closedAt && session.heldOn === today;
  // Riders tap I'm here on their own phones: look again every 20 seconds while it's open, so they
  // show up here without pulling down.
  // (Kept from when the screen opened, like the code fetch below: the provider's actions aren't memoised.)
  const refreshRef = useRef(refresh);
  useEffect(() => {
    if (isDemo || !confirmer || !liveToday) return;
    refreshRef.current().catch(() => undefined);
    const t = setInterval(() => refreshRef.current().catch(() => undefined), 20000);
    return () => clearInterval(t);
  }, [isDemo, confirmer, liveToday]);
  // The provider's actions aren't memoised, so keep the one from when the screen opened: the code
  // is fetched once per session, not again on every refresh.
  const fetchCode = useRef(checkinCode);
  useEffect(() => {
    if (!sessionId || closed || !showCode || !runner) return;
    let live = true;
    fetchCode.current(sessionId)
      .then((c) => live && setCode(c))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [sessionId, closed, showCode, runner]);

  if (!session || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Check-in not found">It may have been for another chapter.</Notice>
      </Screen>
    );
  }

  const here = attendeesOf(session.id, data);
  const byName = (id: string) => {
    const m = data.members.find((x) => x.id === id);
    return m ? displayName(m) : 'the board';
  };
  const waiting = confirmer ? waitingFor(session.id, data) : [];
  const answer = async (memberId: string, isHere: boolean) => {
    setError(null);
    setBusyId(memberId);
    try {
      await answerCheckin(session.id, memberId, isHere);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };
  const marks = new Map((data.attendance ?? []).filter((a) => a.sessionId === session.id).map((a) => [a.memberId, a]));
  const live = !session.closedAt && session.heldOn === today;
  const q = search.trim().toLowerCase();
  const excused = (data.exemptions ?? []).filter((e) => e.sessionId === session.id);
  const excusedIds = new Set(excused.map((e) => e.memberId));
  const canExcuse = (m: Member) => exemptionProblem(me, session.id, m.id, 'x', data) === null;
  const canExcuseAny = data.members.some((m) => !marks.has(m.id) && !excusedIds.has(m.id) && canExcuse(m));
  const canTick = (m: Member) => runner && session.heldOn <= today && markProblem(me, session, m, data, today) === null;
  // Before the day there's nothing to tick, only apologies to take.
  const mode = session.heldOn > today ? 'excuse' : choice;
  // Someone excused who turns up can still be ticked: turning up always counts.
  const tickable = data.members
    .filter((m) => !marks.has(m.id) && (mode === 'excuse' ? !excusedIds.has(m.id) && canExcuse(m) : canTick(m)))
    .filter((m) => session.chapterId === null || m.chapterId === session.chapterId || q)
    .filter((m) => !q || `${m.fullName} ${m.roadName ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));

  const mark = async (memberId: string, present: boolean) => {
    setError(null);
    setBusyId(memberId);
    try {
      await markAttendance(session.id, memberId, present);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const excuse = async (memberId: string, why: string | null) => {
    setError(null);
    setBusyId(memberId);
    try {
      await setExemption(session.id, memberId, why);
      setExcusing(null);
      setReason('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };
  const type_ = meetingTypeOf(session);

  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      <Card>
        <Row style={{ gap: 6 }}>
          <Chip label={type_ ? MEETING_TYPE_LABEL[type_] : KIND_LABEL[session.kind]} tone="bone" />
          {session.closedAt ? <Chip label="Closed" tone="steel" /> : live ? <Chip label="Open now" tone="ok" /> : null}
        </Row>
        <H1>{session.title}</H1>
        <Text style={[type.name, { color: colors.boneDim }]}>{formatAuDate(session.heldOn)}</Text>
      </Card>

      {confirmer && (live || waiting.length > 0) ? (
        <>
          <SectionTitle title="Waiting to be confirmed" action={<Text style={[type.name, { color: colors.boneMute }]}>{waiting.length}</Text>} />
          <Card style={{ padding: 0, gap: 0 }}>
            {waiting.length === 0 ? (
              <View style={{ padding: space.lg }}>
                <Small>Nobody waiting. When someone taps I’m here, they show up here and you get a notice.</Small>
              </View>
            ) : (
              waiting.map((m, i) => {
                const asked = (data.checkinRequests ?? []).find((r) => r.sessionId === session.id && r.memberId === m.id);
                return (
                  <View key={m.id}>
                    <ListRow
                      last
                      left={<Avatar text={initials(m)} size={40} />}
                      title={displayName(m)}
                      subtitle={asked ? `Says they’re here · ${melbourneTime(asked.askedAt)}` : 'Says they’re here'}
                    />
                    <Row style={{ gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.lg, borderBottomWidth: i === waiting.length - 1 ? 0 : 1, borderColor: colors.line }}>
                      <Button
                        label="Confirm"
                        icon="checkmark"
                        busy={busyId === m.id}
                        accessibilityLabel={`Confirm ${displayName(m)} is here`}
                        onPress={() => answer(m.id, true)}
                        style={{ flex: 1 }}
                      />
                      <Button
                        label="Not here"
                        kind="quiet"
                        disabled={busyId === m.id}
                        accessibilityLabel={`${displayName(m)} isn’t here`}
                        onPress={() => answer(m.id, false)}
                      />
                    </Row>
                  </View>
                );
              })
            )}
          </Card>
        </>
      ) : null}

      {live && runner && !showCode ? (
        <Button label="Show a code to scan" kind="quiet" icon="qr-code-outline" onPress={() => setShowCode(true)} />
      ) : null}
      {live && runner && showCode ? (
        <Card style={{ alignItems: 'center', gap: space.md }}>
          {code ? (
            <>
              <QrCode value={qrPayload(code)} size={qrSize} label={`Check-in code ${code.split('').join(' ')}`} />
              <Text
                selectable
                accessibilityLabel={`Code ${code.split('').join(' ')}`}
                style={{ fontFamily: fonts.stencil, fontSize: 40, letterSpacing: 8, color: colors.bone }}
              >
                {code}
              </Text>
              <Small style={{ textAlign: 'center' }}>
                A backup, for anyone who can’t tap I’m here: they scan it from Check in on Home, or type the code.
              </Small>
              <Button label="Hide the code" kind="quiet" onPress={() => setShowCode(false)} />
            </>
          ) : (
            <Small>Getting the code…</Small>
          )}
        </Card>
      ) : session.heldOn > today ? (
        <Notice tone="info" title="Not today yet">
          {`Check-in opens on ${formatAuDate(session.heldOn)}.`}
        </Notice>
      ) : null}

      <View accessibilityLiveRegion="polite" role="alert">
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </View>

      <SectionTitle title="Here" action={<Text style={[type.name, { color: colors.boneMute }]}>{here.length}</Text>} />
      <Card style={{ padding: 0, gap: 0 }}>
        {here.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>Nobody yet.</Small>
          </View>
        ) : (
          here.map((m, i) => {
            const a = marks.get(m.id)!;
            return (
              <ListRow
                key={m.id}
                last={i === here.length - 1}
                left={<Avatar text={initials(m)} size={40} />}
                title={displayName(m)}
                subtitle={a.markedBy ? `Confirmed by ${byName(a.markedBy)} · ${melbourneTime(a.checkedInAt)}` : `Checked in ${melbourneTime(a.checkedInAt)}`}
 right={
                  runner && session.heldOn <= today ? (
                    <Button label="Untick" kind="quiet" busy={busyId === m.id} onPress={() => mark(m.id, false)} />
                  ) : undefined
                }
              />
            );
          })
        )}
      </Card>

      {excused.length > 0 ? (
        <>
          <SectionTitle title="Excused" action={<Text style={[type.name, { color: colors.boneMute }]}>{excused.length}</Text>} />
          <Card style={{ padding: 0, gap: 0 }}>
            {excused.map((e, i) => {
              const m = data.members.find((x) => x.id === e.memberId);
              if (!m) return null;
              return (
                <ListRow
                  key={e.memberId}
                  last={i === excused.length - 1}
                  left={<Avatar text={initials(m)} size={40} />}
                  title={displayName(m)}
                  lines="all"
                  subtitle={e.reason}
                  right={canExcuse(m) ? <Button label="Clear" kind="quiet" busy={busyId === m.id} onPress={() => excuse(m.id, null)} /> : undefined}
                />
              );
            })}
          </Card>
        </>
      ) : null}

      {!runner ? null : tickable.length > 0 || q || canExcuseAny ? (
        <>
          <SectionTitle title={session.heldOn > today ? 'Apologies' : canExcuseAny ? 'Tick off or excuse' : 'Tick someone off'} />
          <Field
            label="Find a member"
            value={search}
            onChangeText={setSearch}
            placeholder="Name or road name"
            autoCorrect={false}
          />
          {canExcuseAny && session.heldOn <= today ? (
            <Choices<'tick' | 'excuse'>
              options={[{ value: 'tick', label: 'Tick off' }, { value: 'excuse', label: 'Excuse' }]}
              value={mode}
              onChange={(v) => { setChoice(v); setExcusing(null); }}
            />
          ) : null}
          {mode === 'excuse' ? (
            <Small>Excuse anyone away for work, family, health, injury or distance (4.12). It won’t count against them.</Small>
          ) : null}
          <Card style={{ padding: 0, gap: 0 }}>
            {tickable.length === 0 ? (
              <View style={{ padding: space.lg }}>
                <Small>{q ? 'Nobody by that name.' : mode === 'excuse' ? 'Nobody left to excuse.' : 'Everyone’s ticked off.'}</Small>
              </View>
            ) : (
              tickable.slice(0, 40).map((m, i, list) => (
                <View key={m.id}>
                  <ListRow
                    last={i === list.length - 1 && excusing !== m.id}
                    left={<Avatar text={initials(m)} size={40} />}
                    title={displayName(m)}
                    subtitle={m.approval === 'pending' ? 'Applicant' : m.fullName !== displayName(m) ? m.fullName : undefined}
                    right={
                      mode === 'excuse' ? (
                        canExcuse(m) ? (
                          <Button
                            label="Excuse"
                            kind="secondary"
                            accessibilityLabel={`Excuse ${displayName(m)}`}
                            onPress={() => { setExcusing(excusing === m.id ? null : m.id); setReason(''); }}
                          />
                        ) : undefined
                      ) : canTick(m) ? (
                        <Button label="Tick" kind="secondary" icon="checkmark" busy={busyId === m.id} onPress={() => mark(m.id, true)} />
                      ) : undefined
                    }
                  />
                  {excusing === m.id ? (
                    <View style={{ padding: space.lg, paddingTop: 0, gap: space.sm }}>
                      <Field label={`Why ${displayName(m)} is excused`} value={reason} onChangeText={setReason} maxLength={200} placeholder="Working away" />
                      <Row style={{ gap: space.sm }}>
                        <Button label="Excuse" busy={busyId === m.id} disabled={!reason.trim()} onPress={() => excuse(m.id, reason)} style={{ flex: 1 }} />
                        <Button label="Cancel" kind="quiet" onPress={() => setExcusing(null)} />
                      </Row>
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </Card>
        </>
      ) : session.heldOn <= today ? (
        <Small>Everyone’s ticked off.</Small>
      ) : null}

      {!runner ? null : !session.closedAt ? (
        <ConfirmButton
          label="Close check-in"
          confirmLabel="Close it: no more check-ins"
          kind="secondary"
          onConfirm={() => closeCheckin(session.id).catch((e) => setError((e as Error).message))}
        />
      ) : (
        <Small>Closed. You can still tick people off or untick them.</Small>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Opening a meeting check-in
// ---------------------------------------------------------------------------

export function OpenMeetingScreen({ navigation }: RootScreen<'OpenMeeting'>) {
  const { me, data, today, openCheckin } = useClub();
  const chapters = data.chapters.filter((c) => canRunCheckin(me, c.id, data.positions));
  const [chapterId, setChapterId] = useState<string | null>(
    chapters.find((c) => c.id === me?.chapterId)?.id ?? chapters[0]?.id ?? null,
  );
  const [title, setTitle] = useState('Chapter meeting');
  const [meetingType, setMeetingType] = useState<MeetingType>('ordinary');
  const [dateText, setDateText] = useState(formatAuDate(today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heldOn = parseAuDate(dateText.trim());

  const open = async () => {
    setError(null);
    if (!heldOn) {
      setError('Use DD/MM/YYYY, like 08/11/2026.');
      return;
    }
    const input = { kind: 'meeting' as const, rideId: null, chapterId, title, heldOn, meetingType };
    const problem = openCheckinProblem(me, input, data, today);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const sessionId = await openCheckin(input);
      navigation.replace('RunCheckin', { sessionId });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H1>Meeting check-in</H1>
        <Body>Open it, then hold your phone up so people can scan in. Meetings count towards an applicant’s two.</Body>
      </Stack>
      <Card>
        {chapters.length > 1 ? (
          <Choices<string>
            label="Chapter"
            options={chapters.map((c) => ({ value: c.id, label: c.name }))}
            value={chapterId}
            onChange={setChapterId}
          />
        ) : null}
        <Field label="What it is" value={title} onChangeText={setTitle} maxLength={60} />
        <Choices<MeetingType>
          label="Counts as"
          options={MEETING_TYPES.map((t) => ({ value: t, label: MEETING_TYPE_LABEL[t] }))}
          value={meetingType}
          onChange={setMeetingType}
        />
        <Small>{MEETING_TYPE_HINT[meetingType]}</Small>
        <Field
          label="Date"
          value={dateText}
          onChangeText={(t) => setDateText(typeDate(t))}
          keyboardType="number-pad"
          placeholder="DD/MM/YYYY"
          error={dateText.trim() && !heldOn ? 'Use DD/MM/YYYY, like 08/11/2026.' : null}
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button label="Open check-in" icon="qr-code-outline" busy={busy} onPress={open} />
      </Card>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Bits for other screens
// ---------------------------------------------------------------------------

type Nav = NavigationProp<RootParams>;

/** On a ride: I'm here for riders on the day; for the crew and the board, who's waiting to be
 *  confirmed and who's here (or, after the day, recording who came). */
export function RideCheckinCard({ ride }: { ride: Ride }) {
  const { me, data, today, openCheckin } = useClub();
  const navigation = useNavigation<Nav>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me || ride.cancelledAt) return null;
  const session = sessionsOf(data.checkinSessions).find((s) => s.rideId === ride.id);
  const runner = canRunCheckin(me, rideChapterId(ride, data.chapters), data.positions);
  const rideDay = melbourneDate(ride.startsAt);
  const at = { rideId: ride.id };
  const asking =
    !!session &&
    ((data.attendance ?? []).some((a) => a.sessionId === session.id && a.memberId === me.id) ||
      (data.checkinRequests ?? []).some((r) => r.sessionId === session.id && r.memberId === me.id));
  const rider = canCheckIn(me) && (asking || askCheckInProblem(me, at, data, today) === null);

  if (!session) {
    // Nobody has said they're here yet. The board can still open it to tick people off, or record
    // who came after the day.
    const input = { kind: 'ride' as const, rideId: ride.id, chapterId: null, title: ride.title, heldOn: rideDay };
    const canOpen = runner && rideDay <= today && openCheckinProblem(me, input, data, today) === null;
    if (!rider && !canOpen) return null;
    const open = async () => {
      setBusy(true);
      setError(null);
      try {
        const sessionId = await openCheckin(input);
        navigation.navigate('RunCheckin', { sessionId });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    };
    return (
      <Stack gap={space.sm}>
        <SectionTitle title="Check-in" />
        <Card style={{ padding: 0, gap: 0 }}>
          {rider ? <ImHere at={at} /> : null}
          {canOpen && rideDay < today ? (
            <View style={{ padding: space.lg, gap: space.sm }}>
              <Small>No check-in was run. Record who came to tick them off.</Small>
              <Button label="Record who came" kind="secondary" icon="checkmark-done-outline" busy={busy} onPress={open} />
              {error ? <Notice tone="danger">{error}</Notice> : null}
            </View>
          ) : null}
        </Card>
      </Stack>
    );
  }

  const count = attendeesOf(session.id, data).length;
  const confirmer = canConfirmCheckin(me, session, data);
  const waiting = confirmer ? waitingFor(session.id, data).length : 0;
  return (
    <Stack gap={space.sm}>
      <SectionTitle title="Check-in" />
      <Card style={{ padding: 0, gap: 0 }}>
        {confirmer ? (
          <ListRow
            left={<IconBadge icon={waiting > 0 ? 'hand-right' : 'people'} tone={waiting > 0 ? 'red' : 'steel'} />}
            title={waiting > 0 ? `Confirm ${waiting} waiting` : session.closedAt ? 'Check-in closed' : 'Who’s here'}
            subtitle={`${count} checked in`}
            onPress={() => navigation.navigate('RunCheckin', { sessionId: session.id })}
            last={!rider}
          />
        ) : null}
        {rider ? (
          <ImHere at={at} />
        ) : !confirmer ? (
          <ListRow left={<IconBadge icon="people" />} title={`${count} checked in`} last />
        ) : null}
      </Card>
    </Stack>
  );
}

/** Home, on the day: what you can say you're here at, and check-ins with people waiting for you to confirm them. */
export function HomeCheckinCard() {
  const { me, data, today } = useClub();
  const navigation = useNavigation<Nav>();
  if (!me || !canCheckIn(me)) return null;
  const sessions = sessionsOf(data.checkinSessions);
  const running = sessions.filter((s) => !s.closedAt && s.heldOn === today && canConfirmCheckin(me, s, data));
  const going = (rideId: string) => data.rsvps.some((r) => r.rideId === rideId && r.memberId === me.id && r.answer === 'going');
  // Today's rides you're going to (and open meetings), unless you run them: you're straight in from the ride.
  const toJoin = checkInsToday(me, data, today).filter(({ at }) => {
    const s = sessionAt(at, sessions);
    if (s && (running.includes(s) || (data.attendance ?? []).some((a) => a.sessionId === s.id && a.memberId === me.id))) return false;
    return 'rideId' in at ? going(at.rideId) : true;
  });
  if (running.length === 0 && toJoin.length === 0) return null;
  const rows = [
    ...running.map((s) => {
      const waiting = waitingFor(s.id, data).length;
      return {
        key: s.id,
        icon: waiting > 0 ? ('hand-right' as const) : ('people' as const),
        title: waiting > 0 ? `Confirm ${waiting} waiting · ${s.title}` : `Who’s here · ${s.title}`,
        subtitle: `${attendeesOf(s.id, data).length} checked in`,
        onPress: () => navigation.navigate('RunCheckin', { sessionId: s.id }),
      };
    }),
    ...toJoin.map((t) => {
      const s = sessionAt(t.at, sessions);
      const waiting = !!s && (data.checkinRequests ?? []).some((r) => r.sessionId === s.id && r.memberId === me.id);
      return {
        key: t.key,
        icon: waiting ? ('time-outline' as const) : ('hand-right-outline' as const),
        title: `Check in · ${t.title}`,
        subtitle: waiting ? 'Waiting to be confirmed' : 'Tap I’m here when you arrive',
        onPress: () => navigation.navigate('CheckIn'),
      };
    }),
  ];
  return (
    <Card style={{ padding: 0, gap: 0, borderColor: colors.redBright }}>
      {rows.map((r, i) => (
        <ListRow
          key={r.key}
          left={<IconBadge icon={r.icon} tone="red" />}
          title={r.title}
          lines="all"
          subtitle={r.subtitle}
          onPress={r.onPress}
          last={i === rows.length - 1}
        />
      ))}
    </Card>
  );
}

/** A member's rides and meetings this club year (AGM to AGM). */
export function AttendanceSummary({ member }: { member: Member }) {
  const { data, today } = useClub();
  const year = clubYearOf(today, data.agms);
  const { rides, meetings } = attendanceCount(member.id, data, agmOn(year, data.agms));
  return (
    <>
      <SectionTitle title="Turned up" action={<Text style={[type.name, { color: colors.boneMute }]}>{clubYearLabel(year)}</Text>} />
      <Card>
        <Row style={{ gap: space.xxl }}>
          <View style={{ gap: 2 }}>
            <H1 style={{ fontVariant: ['tabular-nums'] }}>{meetings}</H1>
            <Small>{meetings === 1 ? 'meeting' : 'meetings'}</Small>
          </View>
          <View style={{ gap: 2 }}>
            <H1 style={{ fontVariant: ['tabular-nums'] }}>{rides}</H1>
            <Small>{rides === 1 ? 'ride' : 'rides'}</Small>
          </View>
        </Row>
      </Card>
    </>
  );
}

/** The board's list of recent check-ins, with a way to open a meeting one. */
export function BoardCheckins({ chapterId }: { chapterId: string | null }) {
  const { me, data, today } = useClub();
  const navigation = useNavigation<Nav>();
  const mine = sessionsOf(data.checkinSessions)
    .filter((s) => canRunCheckin(me, s.chapterId, data.positions) && (chapterId === null || s.chapterId === chapterId || s.chapterId === null))
    .sort((a, b) => b.heldOn.localeCompare(a.heldOn))
    .slice(0, 5);
  return (
    <>
      <SectionTitle title="Check-ins" />
      <Card style={{ padding: 0, gap: 0 }}>
        {mine.map((s) => (
          <ListRow
            key={s.id}
            left={<IconBadge icon={s.kind === 'ride' ? 'speedometer' : 'people'} />}
            title={s.title}
            subtitle={`${formatAuDate(s.heldOn)} · ${attendeesOf(s.id, data).length} came`}
            right={!s.closedAt && s.heldOn === today ? <Chip label="Open" tone="ok" /> : undefined}
            onPress={() => navigation.navigate('RunCheckin', { sessionId: s.id })}
          />
        ))}
        <ListRow
          last
          left={<IconBadge icon="add" tone="red" />}
          title="Open a meeting check-in"
          subtitle="Ride check-ins open from the ride"
          onPress={() => navigation.navigate('OpenMeeting')}
        />
      </Card>
    </>
  );
}
