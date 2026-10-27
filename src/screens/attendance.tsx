// Attendance rules (constitution v4): where a member stands this club year, the board's view of its
// chapter, and the Big 4 card on a ride (the NEC designates it; members see whether they're eligible).

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { SUPPORTERS_NO_BIG4, big4Eligibility, big4Of, canDesignateBig4, designateBig4Problem, undesignateBig4Problem } from '../domain/big4';
import { clubYearLabel, clubYearOf } from '../domain/clubYear';
import { formatAuDate } from '../domain/dates';
import { isBoardOf } from '../domain/access';
import { displayName, initials } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import { standingOf, type Standing, type StandingLine } from '../domain/standing';
import type { Member, Ride } from '../domain/types';
import type { RootParams, RootScreen } from '../navigation/types';
import { ROLE_LABEL } from '../domain/labels';
import { termEndsOn, termState } from '../domain/terms';
import { colors, space, type } from '../theme';
import {
  Avatar,
  Body,
  Button,
  Card,
  Chip,
  Choices,
  ConfirmButton,
  H1,
  IconBadge,
  ListRow,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
  StatusChip,
} from '../ui/primitives';

const CHIP: Record<StandingLine['state'], { label: string; tone: 'ok' | 'warn' | 'bone' } | null> = {
  met: { label: 'On track', tone: 'ok' },
  to_go: { label: 'To go', tone: 'bone' },
  behind: { label: 'Behind', tone: 'warn' },
  none: null,
};

function detail(line: StandingLine): string {
  if (line.key === 'big4') {
    if (line.state === 'none') return 'None on the calendar yet';
    const more = line.upcoming > 0 ? ` · ${line.upcoming} more on the calendar` : '';
    return `${line.attended} of ${line.needed} ridden${more}`;
  }
  if (line.state === 'none') return 'None held yet';
  return `${line.attended} of ${line.held} · needs ${line.needed}`;
}

/** The requirement lines, each with its count and a chip. */
export function StandingLines({ standing }: { standing: Standing }) {
  if (standing.onHiatus) return <Small>On hiatus: attendance isn’t counted while you’re away.</Small>;
  return (
    <Stack gap={space.md}>
      {standing.lines.map((l) => {
        const chip = CHIP[l.state];
        return (
          <Row key={l.key} style={{ gap: space.md, flexWrap: 'nowrap' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.name}>{l.label}</Text>
              <Small style={{ fontVariant: ['tabular-nums'] }}>{detail(l)}</Small>
            </View>
            {chip ? <Chip label={chip.label} tone={chip.tone} /> : null}
          </Row>
        );
      })}
    </Stack>
  );
}

/** A member's standing as a card, with the period it covers. Nothing for statuses with no requirement. */
export function StandingCard({ member }: { member: Member }) {
  const { data, today } = useClub();
  const standing = standingOf(member, data, today);
  if (!standing) return null;
  const period = standing.kind === 'fng' ? `Since ${formatAuDate(standing.from)}` : clubYearLabel(clubYearOf(today, data.agms));
  return (
    <>
      <SectionTitle title={standing.kind === 'fng' ? 'Trial attendance' : 'Attendance rules'} action={<Text style={[type.name, { color: colors.boneMute }]}>{period}</Text>} />
      <Card>
        <StandingLines standing={standing} />
        <Small>Counts meetings and rides that had a check-in. The board can excuse you from one (4.12).</Small>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// The board's view: every Full, Nomad and FNG member of the chapter, Behind first
// ---------------------------------------------------------------------------

const behindFirst = (s: Standing | null) => (s?.lines.some((l) => l.state === 'behind') ? 0 : 1);

export function AttendanceScreen({ route }: RootScreen<'Attendance'>) {
  const { me, data, today } = useClub();
  const chapters = data.chapters.filter((c) => isBoardOf(me, c.id, data.positions));
  const [chapterId, setChapterId] = useState(route.params?.chapterId ?? me?.chapterId ?? chapters[0]?.id ?? null);
  if (!me || !chapterId || !isBoardOf(me, chapterId, data.positions)) {
    return (
      <Screen>
        <Notice tone="warn" title="Board only">Attendance records are for the chapter’s board (5.5).</Notice>
      </Screen>
    );
  }
  const rows = data.members
    .filter((m) => m.chapterId === chapterId && m.approval === 'approved')
    .map((m) => ({ m, s: standingOf(m, data, today) }))
    .filter((r) => r.s !== null)
    .sort((a, b) => behindFirst(a.s) - behindFirst(b.s) || displayName(a.m).localeCompare(displayName(b.m)));
  const behind = rows.filter((r) => behindFirst(r.s) === 0).length;

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H1>Attendance</H1>
        <Body>
          {`Where each member stands for ${clubYearLabel(clubYearOf(today, data.agms))}. A shortfall is a record, not a decision: before any status change the member gets the record and 14 days to respond (5.5).`}
        </Body>
      </Stack>
      {chapters.length > 1 ? (
        <Choices<string> label="Chapter" options={chapters.map((c) => ({ value: c.id, label: c.name }))} value={chapterId} onChange={setChapterId} />
      ) : null}
      <SectionTitle title={behind > 0 ? `${behind} behind` : 'Nobody behind'} action={<Text style={[type.name, { color: colors.boneMute }]}>{rows.length}</Text>} />
      {rows.length === 0 ? <Small>No Full, Nomad or FNG members here yet.</Small> : null}
      {rows.map(({ m, s }) => (
        <Card key={m.id}>
          <Row style={{ gap: space.md, flexWrap: 'nowrap' }}>
            <Avatar text={initials(m)} size={40} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={type.name}>{displayName(m)}</Text>
              <Row style={{ gap: 6 }}>
                <StatusChip status={m.status} />
              </Row>
            </View>
          </Row>
          <StandingLines standing={s!} />
        </Card>
      ))}
    </Screen>
  );
}

/** On the Board screen: who's behind, and terms that have ended or end soon (9.2, 17.6). */
export function BoardAttendance({ chapterId }: { chapterId: string | null }) {
  const { me, data, today } = useClub();
  const navigation = useNavigation<NavigationProp<RootParams>>();
  if (!me) return null;
  const inScope = (c: string | null) => chapterId === null || c === chapterId;
  const behind = data.members.filter(
    (m) => m.approval === 'approved' && inScope(m.chapterId) && isBoardOf(me, m.chapterId, data.positions) &&
      (standingOf(m, data, today)?.lines.some((l) => l.state === 'behind') ?? false),
  ).length;
  const terms = data.positions
    .filter((p) => inScope(p.chapterId) && termState(p, today) !== null && termState(p, today) !== 'running')
    .sort((a, b) => (termEndsOn(a) ?? '').localeCompare(termEndsOn(b) ?? ''));
  return (
    <>
      <SectionTitle title="Attendance and terms" />
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow
          left={<IconBadge icon="stats-chart" tone={behind > 0 ? 'red' : 'steel'} />}
          title="Attendance"
          subtitle={behind > 0 ? `${behind} behind this club year` : 'Nobody behind this club year'}
          onPress={() => navigation.navigate('Attendance', chapterId ? { chapterId } : undefined)}
          last={terms.length === 0}
        />
        {terms.map((p, i) => {
          const m = data.members.find((x) => x.id === p.memberId);
          const ended = termState(p, today) === 'ended';
          return (
            <ListRow
              key={p.id}
              left={<IconBadge icon="hourglass-outline" />}
              title={`${m ? displayName(m) : 'Someone'} · ${ROLE_LABEL[p.role]}`}
              subtitle={`Term ${ended ? 'ended' : 'ends'} ${formatAuDate(termEndsOn(p))}. Re-elected? End it and appoint again.`}
              right={<Chip label={ended ? 'Ended' : 'Ending'} tone="warn" />}
              onPress={m ? () => navigation.navigate('ManageMember', { memberId: m.id }) : undefined}
              last={i === terms.length - 1}
            />
          );
        })}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// On a ride: Big 4 (5.4, 5.8, 5.11)
// ---------------------------------------------------------------------------

export function Big4Card({ ride }: { ride: Ride }) {
  const { me, data, today, designateBig4, undesignateBig4 } = useClub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState('all');
  if (!me) return null;
  const big4 = big4Of(ride.id, data);
  const nec = canDesignateBig4(me, data.positions);
  if (!big4 && !nec) return null;
  const rideDate = melbourneDate(ride.startsAt);
  const forChapter = big4?.chapterId ? data.chapters.find((c) => c.id === big4.chapterId)?.name : null;
  const run = async (f: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // The NEC, before the ride: make it a Big 4 for the whole club or one chapter, or take it off.
  const canChange = nec && (big4 ? undesignateBig4Problem(me, ride.id, data, today) : designateBig4Problem(me, ride.id, null, data, today)) === null;
  const chapterChoices = [{ value: 'all', label: 'Whole club' }, ...data.chapters.map((c) => ({ value: c.id, label: c.name }))];

  const applies = big4 && (big4.chapterId === null || big4.chapterId === me.chapterId);
  const eligibility = applies && ['full', 'nomad', 'fng'].includes(me.status) && me.approval === 'approved' ? big4Eligibility(me, rideDate, data) : null;

  if (!big4 && !canChange) return null;
  return (
    <Stack gap={space.sm}>
      <SectionTitle title="Big 4" />
      <Card>
        {big4 ? (
          <Body>{`A principal annual Club-only ride${forChapter ? ` for ${forChapter}` : ' for every chapter'}. Full Members need two Big 4s a year, Nomads one (5.2, 5.7).`}</Body>
        ) : (
          <Body>Make this one of the year’s Big 4 rides. Designate it ahead of time; it can’t be changed once the ride’s on (5.11).</Body>
        )}
        {applies && me.status === 'supporter' ? <Notice tone="warn">{SUPPORTERS_NO_BIG4}</Notice> : null}
        {eligibility ? (
          eligibility.ok ? (
            <Row style={{ gap: space.sm }}>
              <Chip label="Eligible" tone="ok" icon="checkmark" />
              <Small>{eligibility.of === 0 ? 'No meetings to count yet.' : `${eligibility.attended} of the last ${eligibility.of} meetings (5.4).`}</Small>
            </Row>
          ) : (
            <Notice tone="warn" title={`Needs ${eligibility.needed} of the last ${eligibility.of} meetings`}>
              {`You’ve made ${eligibility.attended} (5.4). The board can excuse work, family, health, injury or distance.`}
            </Notice>
          )
        ) : null}
        {canChange && !big4 ? (
          <Stack gap={space.sm}>
            <Choices<string> label="For" options={chapterChoices} value={scope} onChange={setScope} />
            <Button
              label="Make it a Big 4"
              icon="trophy-outline"
              busy={busy}
              onPress={() => run(() => designateBig4(ride.id, scope === 'all' ? null : scope))}
            />
          </Stack>
        ) : null}
        {canChange && big4 ? (
          <ConfirmButton
            label="Not a Big 4"
            confirmLabel="Take it off the Big 4s"
            kind="secondary"
            disabled={busy}
            onConfirm={() => run(() => undesignateBig4(ride.id))}
          />
        ) : null}
        {big4 && !canChange && nec ? <Small>{`Designated ${formatAuDate(melbourneDate(big4.designatedAt))}. It can’t change now the ride’s on.`}</Small> : null}
        <View accessibilityLiveRegion="polite" role="alert">
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </View>
      </Card>
    </Stack>
  );
}

