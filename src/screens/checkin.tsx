// Check-ins at rides and meetings: scanning or typing the code, running a check-in (the big QR,
// who's here, ticking people off), opening one for a meeting, and the bits other screens show.

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useEffect, useRef, useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import {
  attendanceCount,
  attendeesOf,
  canCheckIn,
  canRunCheckin,
  markProblem,
  normalizeCode,
  openCheckinProblem,
  qrPayload,
  rideChapterId,
} from '../domain/attendance';
import { formatAuDate, parseAuDate, typeDate } from '../domain/dates';
import { fyLabel, fyOf } from '../domain/fees';
import { displayName, initials } from '../domain/profile';
import { melbourneDate, melbourneTime } from '../domain/rides';
import type { CheckinSession, Member, Ride } from '../domain/types';
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

const sessionsOf = (sessions: CheckinSession[] | undefined) => sessions ?? [];

/** Sessions open today that `me` hasn't checked in to yet. */
function openToday(me: Member, sessions: CheckinSession[], attendance: { sessionId: string; memberId: string }[], today: string) {
  return sessions.filter(
    (s) => !s.closedAt && s.heldOn === today && !attendance.some((a) => a.sessionId === s.id && a.memberId === me.id),
  );
}

// ---------------------------------------------------------------------------
// Checking in
// ---------------------------------------------------------------------------

export function CheckInScreen({ navigation }: RootScreen<'CheckIn'>) {
  const { data, checkIn } = useClub();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const handled = useRef(false); // a held-up code fires many scans; act on the first
  const { width } = useWindowDimensions();
  const camSize = Math.min(width - space.lg * 2 - space.lg * 2, 320);

  const submit = async (raw: string) => {
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

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H1>Check in</H1>
        <Body>Scan the code on the board member’s phone, or type the six letters and numbers under it.</Body>
      </Stack>

      <Card>
        {scanning ? (
          <Stack gap={space.md} style={{ alignItems: 'center' }}>
            <View style={{ width: camSize, height: camSize, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.steel }}>
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onMountError={() => {
                  setScanning(false);
                  setCameraError('The camera wouldn’t start here. Type the code instead.');
                }}
                onBarcodeScanned={({ data: scanned }) => {
                  if (handled.current || busy) return;
                  handled.current = true;
                  submit(scanned);
                }}
              />
            </View>
            <Small style={{ textAlign: 'center' }}>Hold the code inside the square.</Small>
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
  const { me, data, today, checkinCode, markAttendance, closeCheckin } = useClub();
  const session = sessionsOf(data.checkinSessions).find((s) => s.id === route.params.sessionId);
  const [code, setCode] = useState<string | null>(session?.code ?? null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const qrSize = Math.min(width - space.lg * 4, 300);

  const sessionId = session?.id;
  const closed = !!session?.closedAt;
  useEffect(() => {
    if (!sessionId || closed) return;
    let live = true;
    checkinCode(sessionId)
      .then((c) => live && setCode(c))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [sessionId, closed, checkinCode]);

  if (!session || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Check-in not found">It may have been for another chapter.</Notice>
      </Screen>
    );
  }

  const here = attendeesOf(session.id, data);
  const marks = new Map((data.attendance ?? []).filter((a) => a.sessionId === session.id).map((a) => [a.memberId, a]));
  const live = !session.closedAt && session.heldOn === today;
  const q = search.trim().toLowerCase();
  const tickable = data.members
    .filter((m) => !marks.has(m.id) && markProblem(me, session, m, data, today) === null)
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

  return (
    <Screen>
      <Card>
        <Row style={{ gap: 6 }}>
          <Chip label={KIND_LABEL[session.kind]} tone="bone" />
          {session.closedAt ? <Chip label="Closed" tone="steel" /> : live ? <Chip label="Open now" tone="ok" /> : null}
        </Row>
        <H1>{session.title}</H1>
        <Text style={[type.name, { color: colors.boneDim }]}>{formatAuDate(session.heldOn)}</Text>
      </Card>

      {live ? (
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
                Members scan this from Check in on their Home screen, or type the code.
              </Small>
            </>
          ) : (
            <Small>Getting the code…</Small>
          )}
        </Card>
      ) : session.heldOn > today ? (
        <Notice tone="info" title="Not today yet">
          {`The code shows here on ${formatAuDate(session.heldOn)}.`}
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
                subtitle={a.markedBy ? 'Ticked off by the board' : `Checked in ${melbourneTime(a.checkedInAt)}`}
                right={
                  session.heldOn <= today ? (
                    <Button label="Untick" kind="quiet" busy={busyId === m.id} onPress={() => mark(m.id, false)} />
                  ) : undefined
                }
              />
            );
          })
        )}
      </Card>

      {session.heldOn <= today ? (
        <>
          <SectionTitle title="Tick someone off" />
          <Field
            label="Find a member"
            value={search}
            onChangeText={setSearch}
            placeholder="Name or road name"
            autoCorrect={false}
          />
          <Card style={{ padding: 0, gap: 0 }}>
            {tickable.length === 0 ? (
              <View style={{ padding: space.lg }}>
                <Small>{q ? 'Nobody by that name to tick off.' : 'Everyone’s ticked off.'}</Small>
              </View>
            ) : (
              tickable.slice(0, 40).map((m, i, list) => (
                <ListRow
                  key={m.id}
                  last={i === list.length - 1}
                  left={<Avatar text={initials(m)} size={40} />}
                  title={displayName(m)}
                  subtitle={m.approval === 'pending' ? 'Applicant' : m.fullName !== displayName(m) ? m.fullName : undefined}
                  right={<Button label="Tick" kind="secondary" icon="checkmark" busy={busyId === m.id} onPress={() => mark(m.id, true)} />}
                />
              ))
            )}
          </Card>
        </>
      ) : null}

      {!session.closedAt ? (
        <ConfirmButton
          label="Close check-in"
          confirmLabel="Close it: no more scanning"
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
    const input = { kind: 'meeting' as const, rideId: null, chapterId, title, heldOn };
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

/** On a ride: open or run its check-in (board), or check in (everyone else). */
export function RideCheckinCard({ ride }: { ride: Ride }) {
  const { me, data, today, openCheckin } = useClub();
  const navigation = useNavigation<Nav>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me || ride.cancelledAt) return null;
  const session = sessionsOf(data.checkinSessions).find((s) => s.rideId === ride.id);
  const runner = canRunCheckin(me, rideChapterId(ride, data.chapters), data.positions);
  const rideDay = melbourneDate(ride.startsAt);
  const mine = session && (data.attendance ?? []).some((a) => a.sessionId === session.id && a.memberId === me.id);

  if (!session) {
    if (!runner || rideDay > today) return null;
    const input = { kind: 'ride' as const, rideId: ride.id, chapterId: null, title: ride.title, heldOn: rideDay };
    if (openCheckinProblem(me, input, data, today)) return null;
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
        <Card>
          <Small>
            {rideDay === today
              ? 'Open the check-in and hold your phone up at the meeting point.'
              : 'No check-in was run. Open one to tick off who came.'}
          </Small>
          <Button
            label={rideDay === today ? 'Open check-in' : 'Record who came'}
            kind="secondary"
            icon="qr-code-outline"
            busy={busy}
            onPress={open}
          />
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </Card>
      </Stack>
    );
  }

  const count = attendeesOf(session.id, data).length;
  return (
    <Stack gap={space.sm}>
      <SectionTitle title="Check-in" />
      <Card style={{ padding: 0, gap: 0 }}>
        {runner ? (
          <ListRow
            left={<IconBadge icon="qr-code" tone={session.closedAt ? 'steel' : 'red'} />}
            title={session.closedAt ? 'Check-in closed' : 'Show the code'}
            subtitle={`${count} checked in`}
            onPress={() => navigation.navigate('RunCheckin', { sessionId: session.id })}
            last={!(!mine && canCheckIn(me) && !session.closedAt && session.heldOn === today)}
          />
        ) : null}
        {mine ? (
          <ListRow left={<IconBadge icon="checkmark" />} title="You’re checked in" subtitle={`${count} here so far`} last />
        ) : canCheckIn(me) && !session.closedAt && session.heldOn === today ? (
          <ListRow
            left={<IconBadge icon="scan" tone={runner ? 'steel' : 'red'} />}
            title="Check in"
            subtitle="Scan the code at the meeting point"
            onPress={() => navigation.navigate('CheckIn')}
            last
          />
        ) : !runner ? (
          <ListRow left={<IconBadge icon="people" />} title={`${count} checked in`} last />
        ) : null}
      </Card>
    </Stack>
  );
}

/** Home: a check-in that's open today, for you to scan into or to run. */
export function HomeCheckinCard() {
  const { me, data, today } = useClub();
  const navigation = useNavigation<Nav>();
  if (!me || !canCheckIn(me)) return null;
  const sessions = sessionsOf(data.checkinSessions);
  const running = sessions.filter((s) => !s.closedAt && s.heldOn === today && canRunCheckin(me, s.chapterId, data.positions));
  const toJoin = openToday(me, sessions, data.attendance ?? [], today).filter((s) => !running.includes(s));
  if (running.length === 0 && toJoin.length === 0) return null;
  const rows = [
    ...running.map((s) => ({
      key: s.id,
      icon: 'qr-code' as const,
      title: `Show the code · ${s.title}`,
      subtitle: `${attendeesOf(s.id, data).length} checked in`,
      onPress: () => navigation.navigate('RunCheckin', { sessionId: s.id }),
    })),
    ...toJoin.map((s) => ({
      key: s.id,
      icon: 'scan' as const,
      title: `Check in · ${s.title}`,
      subtitle: `${KIND_LABEL[s.kind]} today`,
      onPress: () => navigation.navigate('CheckIn'),
    })),
  ];
  return (
    <Card style={{ padding: 0, gap: 0, borderColor: colors.redBright }}>
      {rows.map((r, i) => (
        <ListRow
          key={r.key}
          left={<IconBadge icon={r.icon} tone="red" />}
          title={r.title}
          subtitle={r.subtitle}
          onPress={r.onPress}
          last={i === rows.length - 1}
        />
      ))}
    </Card>
  );
}

/** A member's rides and meetings this financial year. */
export function AttendanceSummary({ member }: { member: Member }) {
  const { data, today } = useClub();
  const fy = fyOf(today);
  const { rides, meetings } = attendanceCount(member.id, data, `${fy}-07-01`);
  return (
    <>
      <SectionTitle title="Turned up" action={<Small>{fyLabel(fy)}</Small>} />
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
