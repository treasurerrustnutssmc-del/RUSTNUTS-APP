import React, { useMemo, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import {
  canManageMember,
  canSeePhone,
  canSeePrivate,
  endTermProblem,
  pendingFor,
  reviewsChapter,
  visibleMembers,
  withHolders,
} from '../domain/access';
import { canSeeAttendance } from '../domain/attendance';
import { compassFor } from '../domain/compass';
import { businessFor } from '../domain/business';
import { describeExpiry, expiryState, formatAuDate, formatLongDate, monthsBetween } from '../domain/dates';
import { clubCounts, positionTitles, seatTitle } from '../domain/home';
import { BOARD_ROLES, CLUB_ROLES, LICENCE_LABEL, NATIONAL_ROLES, ROLE_LABEL, ROLE_SHORT, STATUS_LABEL, STATUS_ORDER } from '../domain/labels';
import { displayName, expiryAlerts, hasEarnedDisc, initials, nextFngReview, phoneNote, profileChecklist } from '../domain/profile';
import type { Member, Position } from '../domain/types';
import type { RootScreen, TabScreen } from '../navigation/types';
import { MemberChatButtons } from './chat';
import { colors, space, type } from '../theme';
// Stage 4
import { canSeeFees } from '../domain/fees';
import { AttendanceSummary, HomeCheckinCard } from './checkin';
import { StandingCard } from './attendance';
import { termEndsOn, termState } from '../domain/terms';
import { HomeFeesCard } from './fees';
import { IntroProgressCard } from './fng';
// Stage 7: social extras
import { ChaptersNationalRow } from './adminRows'; // Stage 5D
import { HomeOnThisDayCard, HomeShoutoutsCard } from './social';
import { WhoCanHelpRow } from './help';
import { SwapRow } from './swap';
import { BuildsRow } from './builds';
import { HistoryRow } from './history';
import { BragRow } from './brag';
import { BadgesCard } from './badges';
import { AskClubHomeRow } from './askClub';
import { HomeRoadRulesRow } from './roadRules';
import { MemberRow, sortedPositions } from '../ui/MemberBits';
import {
  Avatar,
  Body,
  Button,
  Card,
  Chip,
  ConfirmButton,
  Choices,
  Field,
  Flannel,
  H1,
  H2,
  IconBadge,
  Ionicons,
  KeyValue,
  Label,
  ListRow,
  LockNote,
  MemberDisc,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
  StatusChip,
} from '../ui/primitives';

const toneFor = (iso: string | null, today: string) => {
  const s = expiryState(iso, today);
  return s === 'expired' ? 'danger' : s === 'soon' ? 'warn' : s === 'ok' ? 'ok' : undefined;
};

function sortMembers(list: Member[]) {
  return [...list].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      displayName(a).localeCompare(displayName(b)),
  );
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

/** Stage 5: the current instant, for the club business row. */
const nowInstant = () => new Date().toISOString();

export function HomeScreen({ navigation }: TabScreen<'Home'>) {
  const { me, data, level, today, isDemo, refresh } = useClub();
  if (!me) return null;
  const chapter = data.chapters.find((c) => c.id === me.chapterId);
  const positions = sortedPositions(me.id, data);
  const checklist = profileChecklist(me, data);
  const done = checklist.filter((c) => c.done).length;
  const myAlerts = expiryAlerts([me], data, today);
  const isBoard = level === 'board' || level === 'national';
  const pending = isBoard ? pendingFor(me, data) : [];
  const boardScope = isBoard
    ? data.members.filter(
        (m) => m.approval === 'approved' && (level === 'national' || m.chapterId === me.chapterId),
      )
    : [];
  const boardAlerts = isBoard ? expiryAlerts(boardScope, data, today) : [];
  const counts = clubCounts(data.chapters, data.members, data.unclaimedRoster ?? []);
  const business = businessFor(me, data, nowInstant());

  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      <Flannel>
        <Row style={{ gap: space.md, flexWrap: 'nowrap' }}>
          <Avatar text={initials(me)} size={56} />
          <View style={{ flex: 1, gap: 4 }}>
            {/* One line on phones: a longer name shrinks to fit rather than wrapping (the web ignores this). */}
            <Text
              style={type.h1}
              numberOfLines={Platform.OS === 'web' ? undefined : 1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              G’day, {displayName(me)}
            </Text>
            <Small style={{ color: colors.boneDim }}>
              {chapter?.name} chapter
              {positions.length ? ` · ${positionTitles(positions, data.chapters, me.chapterId, ROLE_LABEL).map((t) => t.text).join(', ')}` : ''}
            </Small>
          </View>
          {hasEarnedDisc(me) ? <MemberDisc size={52} compass={compassFor(me, data)} /> : null}
        </Row>
      </Flannel>

      {/* Stage 4: today's check-in and what you owe */}
      <HomeCheckinCard />
      <HomeFeesCard />
      {/* Stage 7: birthdays and patch anniversaries this week */}
      <HomeShoutoutsCard />
      <HomeOnThisDayCard />

      {isBoard && (pending.length > 0 || boardAlerts.length > 0) ? (
        <Card style={{ padding: 0, gap: 0, borderColor: colors.redBright }}>
          <View style={{ padding: space.lg, paddingBottom: space.sm }}>
            <Row style={{ gap: space.sm }}>
              <H2>Board</H2>
              <Chip label={level === 'national' ? 'All chapters' : `${chapter?.name} chapter`} tone="redOutline" />
            </Row>
          </View>
          {pending.length > 0 ? (
            <ListRow
              left={<IconBadge icon="person-add" tone="red" />}
              title={`${pending.length} waiting for approval`}
              subtitle={pending.map((p) => p.fullName).join(', ')}
              onPress={() => navigation.navigate('Board')}
              last={boardAlerts.length === 0}
            />
          ) : null}
          {boardAlerts.length > 0 ? (
            <ListRow
              left={<IconBadge icon="alert-circle" />}
              title={`${boardAlerts.length} ${boardAlerts.length === 1 ? 'renewal needs' : 'renewals need'} attention`}
              subtitle={`${boardAlerts.filter((a) => a.state === 'expired').length} expired, ${boardAlerts.filter((a) => a.state === 'soon').length} due within 30 days`}
              onPress={() => navigation.navigate('Board')}
              last
            />
          ) : null}
        </Card>
      ) : null}

      {/* Stage 5: meetings and votes */}
      {business.summary ? (
        <Card style={{ padding: 0, gap: 0 }}>
          <ListRow
            left={<IconBadge icon="hammer" tone={business.needsMe.length ? 'red' : undefined} />}
            title="Club business"
            subtitle={business.summary}
            onPress={() => navigation.navigate('Business')}
            last
          />
        </Card>
      ) : null}

      {/* Ask the club, the club assistant */}
      <AskClubHomeRow onOpen={() => navigation.navigate('AskClub')} />
      {/* The Road Rules: the illustrated draft until the NEC publishes, then where you stand */}
      <HomeRoadRulesRow onOpen={(to) => navigation.navigate(to)} />

      {myAlerts.map((a) => (
        <Notice key={a.label} tone={a.state === 'expired' ? 'danger' : 'warn'} title={a.label}>
          {`${a.description}. Update it in your profile once it’s renewed.`}
        </Notice>
      ))}

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <H2>Your profile</H2>
          <Small>
            {done} of {checklist.length} done
          </Small>
        </Row>
        <View style={{ height: 6, backgroundColor: colors.steel, borderRadius: 3, overflow: 'hidden' }}>
          <View style={{ width: `${(done / checklist.length) * 100}%`, height: '100%', backgroundColor: colors.redBright }} />
        </View>
        {done === checklist.length ? (
          <Small>All set. Your Road Captain can reach your emergency contact on ride day.</Small>
        ) : (
          <>
            {checklist
              .filter((c) => !c.done)
              .map((c) => (
                <Row key={c.key} style={{ gap: space.sm }}>
                  <Ionicons name="ellipse-outline" size={16} color={colors.boneMute} />
                  <Body>{c.label}</Body>
                </Row>
              ))}
            <Button label="Finish your profile" kind="secondary" onPress={() => navigation.navigate('EditProfile')} />
          </>
        )}
      </Card>

      <Card>
        <H2>The club</H2>
        <Row style={{ gap: space.xl }}>
          {counts.chapters.map((c) => (
            <View key={c.id} style={{ gap: 2 }}>
              <H1 style={{ fontVariant: ['tabular-nums'] }}>{c.count}</H1>
              <Label>{c.name}</Label>
            </View>
          ))}
          <View style={{ gap: 2 }}>
            <H1 style={{ fontVariant: ['tabular-nums'] }}>{counts.patched}</H1>
            <Label>Patched</Label>
          </View>
          <View style={{ gap: 2 }}>
            <H1 style={{ fontVariant: ['tabular-nums'] }}>{counts.fngs}</H1>
            <Label>FNGs</Label>
          </View>
        </Row>
        {counts.onApp < counts.total ? (
          <Small>
            {counts.onApp} of {counts.total} signed in to the app so far.
          </Small>
        ) : null}
      </Card>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Members directory
// ---------------------------------------------------------------------------

export function MembersScreen({ navigation }: TabScreen<'Members'>) {
  const { me, data, isDemo, refresh } = useClub();
  const [query, setQuery] = useState('');
  const [chapterId, setChapterId] = useState<string>('all');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visibleMembers(me, data).filter((m) => {
      if (m.approval !== 'approved') return false;
      if (chapterId !== 'all' && m.chapterId !== chapterId) return false;
      if (!q) return true;
      const bikes = data.bikes.filter((b) => b.memberId === m.id).map((b) => `${b.make} ${b.model} ${b.nickname ?? ''}`);
      return [m.fullName, m.roadName ?? '', ...bikes].join(' ').toLowerCase().includes(q);
    });
  }, [me, data, query, chapterId]);

  const groups = data.chapters
    .filter((c) => chapterId === 'all' || c.id === chapterId)
    .map((c) => ({ chapter: c, members: sortMembers(list.filter((m) => m.chapterId === c.id)) }))
    .filter((g) => g.members.length > 0);

  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow
          left={<IconBadge icon="flag" tone="red" />}
          title="Chapters"
          subtitle="Boards and the National committee"
          onPress={() => navigation.navigate('Chapters')}
        />
        <HistoryRow last />
      </Card>
      {/* Stage 7: social extras */}
      <Card style={{ padding: 0, gap: 0 }}>
        <WhoCanHelpRow />
        <SwapRow />
        <BuildsRow />
        <BragRow last />
      </Card>
      <Field
        label="Search"
        value={query}
        onChangeText={setQuery}
        placeholder="Name, road name or bike"
        autoCapitalize="none"
        returnKeyType="search"
      />
      <Choices
        options={[{ value: 'all', label: 'All chapters' }, ...data.chapters.map((c) => ({ value: c.id, label: c.name }))]}
        value={chapterId}
        onChange={setChapterId}
      />
      {groups.length === 0 ? (
        <Notice title="Nobody matches">Try a road name, a real name or a bike, like “Softail”.</Notice>
      ) : null}
      {groups.map((g) => (
        <Stack key={g.chapter.id} gap={space.sm}>
          <SectionTitle title={g.chapter.name} action={<Small>{g.members.length} members</Small>} />
          <Card style={{ padding: 0, gap: 0 }}>
            {g.members.map((m, i) => (
              <MemberRow
                key={m.id}
                member={m}
                data={data}
                showChapter={false}
                last={i === g.members.length - 1}
                onPress={() => navigation.navigate('MemberDetail', { memberId: m.id })}
              />
            ))}
          </Card>
        </Stack>
      ))}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One member
// ---------------------------------------------------------------------------

/** Stepping down from a role is the holder's own call (9.3): one confirm per role they hold. */
function StepDownButtons({ positions }: { positions: Position[] }) {
  const { me, data, today, endPosition } = useClub();
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const mine = positions.filter((p) => endTermProblem(me, p, data, today) === null);
  if (mine.length === 0) return null;
  return (
    <View style={{ gap: space.sm }}>
      {error ? <Small style={{ color: colors.warn }}>{error}</Small> : null}
      {mine.map((p) => (
        <ConfirmButton
          key={p.id}
          label={`Step down as ${seatTitle(p, data.chapters, ROLE_LABEL)}`}
          confirmLabel="Yes, step down"
          confirmAccessibilityLabel={`Yes, step down as ${seatTitle(p, data.chapters, ROLE_LABEL)}`}
          kind="secondary"
          size="small"
          onConfirm={() => endPosition(p.id).then(() => setError(null), (e: Error) => setError(e.message))}
        />
      ))}
    </View>
  );
}

export function MemberDetailScreen({ route, navigation }: RootScreen<'MemberDetail'>) {
  const { me, data, today } = useClub();
  const member = data.members.find((m) => m.id === route.params.memberId);
  if (!member || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Member not found">They may have been removed.</Notice>
      </Screen>
    );
  }
  const isSelf = member.id === me.id;
  const chapter = data.chapters.find((c) => c.id === member.chapterId);
  const positions = sortedPositions(member.id, data);
  const bikes = data.bikes.filter((b) => b.memberId === member.id);
  const priv = data.privates.find((p) => p.memberId === member.id);
  const contacts = data.emergencyContacts.filter((c) => c.memberId === member.id);
  const showPhone = canSeePhone(me, member, data.positions);
  const showPrivate = canSeePrivate(me, member, data.positions);
  const canManage = canManageMember(me, member, data.positions);

  const fngMonths = member.status === 'fng' && member.fngStartedOn ? monthsBetween(member.fngStartedOn, today) : null;
  const review = member.status === 'fng' && member.fngStartedOn ? nextFngReview(member.fngStartedOn, today) : null;

  return (
    <Screen>
      <Card>
        <Row style={{ gap: space.lg, flexWrap: 'nowrap' }}>
          <Avatar text={initials(member)} size={72} />
          <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
            <H1>{displayName(member)}</H1>
            {member.roadName ? <Small>{member.fullName}</Small> : null}
            <Row style={{ gap: 6 }}>
              <StatusChip status={member.status} />
              {member.onHiatus ? <Chip label="On hiatus" icon="pause" /> : null}
              {positionTitles(positions, data.chapters, member.chapterId, ROLE_SHORT).map((t) => (
                <Chip key={t.key} label={t.text} tone="bone" />
              ))}
            </Row>
          </View>
          {hasEarnedDisc(member) ? <MemberDisc size={60} compass={compassFor(member, data)} /> : null}
        </Row>
        <Stack gap={2}>
          <KeyValue label="Chapter" value={`${chapter?.name} · ${chapter?.area}`} />
          {positions.map((p) => (
            <KeyValue
              key={p.id}
              label={positionTitles([p], data.chapters, member.chapterId, ROLE_LABEL)[0].text}
              value={`Since ${formatLongDate(p.startedOn)}${termEndsOn(p) ? ` · term ${termState(p, today) === 'ended' ? 'ended' : 'ends'} ${formatAuDate(termEndsOn(p))}` : ''}`}
              tone={termState(p, today) === 'ended' ? 'warn' : undefined}
            />
          ))}
          {member.joinedOn ? <KeyValue label="With the club since" value={formatLongDate(member.joinedOn)} /> : null}
          {member.patchedOn ? <KeyValue label="Patched" value={formatLongDate(member.patchedOn)} /> : null}
          {fngMonths !== null ? (
            <KeyValue label="FNG" value={`${fngMonths} months in · ${review?.atMonths}-month review ${formatLongDate(review?.date)}`} />
          ) : null}
        </Stack>
        {member.bio ? <Body>{member.bio}</Body> : null}
        {isSelf ? <StepDownButtons positions={positions} /> : null}
        {isSelf ? (
          <Button label="Edit my profile" kind="secondary" icon="create-outline" onPress={() => navigation.navigate('EditProfile')} />
        ) : null}
        {canManage ? (
          <Button label="Manage member" kind="secondary" icon="shield-outline" onPress={() => navigation.navigate('ManageMember', { memberId: member.id })} />
        ) : null}
        {/* Stage 3 (lane B): private chats and blocking */}
        <MemberChatButtons member={member} onOpenChat={(chatId) => navigation.navigate('Chat', { chatId })} />
      </Card>

      {member.approval === 'pending' ? (
        <Notice tone="warn" title="Waiting for approval">
          Approve or decline from the Board tab.
        </Notice>
      ) : null}

      {/* Stage 4: the way in, turn-up and fees */}
      {member.approval === 'pending' && member.status === 'introduced' && canManage ? <IntroProgressCard member={member} /> : null}
      {member.approval === 'approved' && canSeeAttendance(me, member, data.positions) ? <AttendanceSummary member={member} /> : null}
      {member.approval === 'approved' && me?.approval === 'approved' ? <BadgesCard member={member} /> : null}
      {member.approval === 'approved' && (member.id === me?.id || reviewsChapter(me, member.chapterId, data.positions)) ? <StandingCard member={member} /> : null}
      {!isSelf && member.approval === 'approved' && canSeeFees(me, member.chapterId, data.positions) ? (
        <Button label="Fees" kind="secondary" icon="cash-outline" onPress={() => navigation.navigate('MemberFees', { memberId: member.id })} />
      ) : null}

      <SectionTitle title="Garage" />
      <Card style={{ padding: 0, gap: 0 }}>
        {bikes.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>No bikes added yet.</Small>
          </View>
        ) : (
          bikes.map((b, i) => (
            <ListRow
              key={b.id}
              last={i === bikes.length - 1}
              left={<IconBadge icon="speedometer" tone={b.isProject ? 'steel' : 'red'} />}
              title={b.nickname ?? `${b.make} ${b.model}`}
              subtitle={`${b.year ?? ''} ${b.make} ${b.model}`.trim()}
              right={b.isProject ? <Chip label="Project" tone="bone" /> : undefined}
            />
          ))
        )}
      </Card>

      <SectionTitle title="Contact" />
      <Card>
        {showPhone && priv?.phone ? (
          <Row style={{ justifyContent: 'space-between', gap: space.md }}>
            <View style={{ gap: 2 }}>
              <Label>Mobile</Label>
              <Body strong selectable>{priv.phone}</Body>
            </View>
            {!isSelf ? (
              <Button label="Call" kind="secondary" icon="call-outline" onPress={() => Linking.openURL(`tel:${priv.phone!.replace(/\s/g, '')}`)} />
            ) : null}
          </Row>
        ) : (
          <Small>{phoneNote({ isSelf, canSee: showPhone, hasPhone: !!priv?.phone, name: displayName(member) })}</Small>
        )}
        {showPrivate && priv?.email ? (
          <View style={{ gap: 2 }}>
            <Label>Email</Label>
            <Body selectable>{priv.email}</Body>
          </View>
        ) : null}
      </Card>

      {showPrivate ? (
        <>
          <SectionTitle title="Ride-ready" action={<LockNote text={isSelf ? 'You + board' : 'Board only'} />} />
          <Card>
            <KeyValue
              label="Licence"
              value={priv?.licenceClass ? `${LICENCE_LABEL[priv.licenceClass]} · ${describeExpiry(priv.licenceExpiry, today)}` : 'Not recorded'}
              tone={toneFor(priv?.licenceExpiry ?? null, today)}
            />
            {priv?.firstAidExpiry || positions.some((p) => p.role === 'tail_gunner') ? (
              <KeyValue
                label="First aid"
                value={describeExpiry(priv?.firstAidExpiry ?? null, today)}
                tone={toneFor(priv?.firstAidExpiry ?? null, today)}
              />
            ) : null}
            {bikes
              .filter((b) => !b.isProject)
              .map((b) => {
                const reg = data.registrations.find((r) => r.bikeId === b.id);
                return (
                  <KeyValue
                    key={b.id}
                    label={`Rego · ${b.nickname ?? b.model}`}
                    value={reg?.rego ? `${reg.rego} · ${describeExpiry(reg.regoExpiry, today)}` : 'Not recorded'}
                    tone={toneFor(reg?.regoExpiry ?? null, today)}
                  />
                );
              })}
          </Card>

          <SectionTitle title="Emergency contacts" action={<LockNote text={isSelf ? 'You + board' : 'Board only'} />} />
          <Card style={{ padding: 0, gap: 0 }}>
            {contacts.length === 0 ? (
              <View style={{ padding: space.lg }}>
                <Notice tone="warn" title="None recorded">
                  {isSelf ? 'Add one so the Road Captain can call someone if you go down.' : 'Ask them to add one before the next ride.'}
                </Notice>
              </View>
            ) : (
              contacts.map((c, i) => (
                <ListRow
                  key={c.id}
                  last={i === contacts.length - 1}
                  left={<IconBadge icon="medkit" />}
                  title={c.name}
                  subtitle={`${c.relationship} · ${c.phone}`}
                />
              ))
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

export function ChaptersScreen({ navigation }: RootScreen<'Chapters'>) {
  const { data } = useClub();
  const approved = data.members.filter((m) => m.approval === 'approved');
  const necSeats = data.positions.filter(
    (p) => p.endedOn === null && (NATIONAL_ROLES.includes(p.role) || p.role === 'president'),
  );

  return (
    <Screen>
      {data.chapters.map((c) => {
        const members = approved.filter((m) => m.chapterId === c.id);
        const board = data.positions
          .filter((p) => p.endedOn === null && p.chapterId === c.id && BOARD_ROLES.includes(p.role))
          .sort((a, b) => BOARD_ROLES.indexOf(a.role) - BOARD_ROLES.indexOf(b.role));
        return (
          <Card key={c.id} style={{ padding: 0, gap: 0 }}>
            <ListRow
              left={<IconBadge icon="flag" tone="red" />}
              title={<H2>{c.name}</H2>}
              subtitle={`${c.area} · ${members.length} members`}
              onPress={() => navigation.navigate('ChapterDetail', { chapterId: c.id })}
            />
            <View style={{ padding: space.lg, gap: 4 }}>
              {board.map((p) => {
                const m = data.members.find((x) => x.id === p.memberId);
                return <KeyValue key={p.id} label={ROLE_LABEL[p.role]} value={m ? displayName(m) : '—'} />;
              })}
              {board.length === 0 ? <Small>No board positions recorded.</Small> : null}
            </View>
          </Card>
        );
      })}

      <SectionTitle title="National" />
      <Card>
        <Small>The National Executive Committee is the Chairman, the Secretary and the sitting chapter Presidents. The National Auditor reviews the records from outside it (11.8).</Small>
        {necSeats
          .sort((a, b) => [...NATIONAL_ROLES, 'president'].indexOf(a.role) - [...NATIONAL_ROLES, 'president'].indexOf(b.role))
          .map((p) => {
            const m = data.members.find((x) => x.id === p.memberId);
            const ch = data.chapters.find((x) => x.id === p.chapterId);
            return (
              <KeyValue
                key={p.id}
                label={p.chapterId ? `${ch?.name} ${ROLE_LABEL[p.role]}` : ROLE_LABEL[p.role]}
                value={m ? displayName(m) : '—'}
              />
            );
          })}
      </Card>
      {/* Stage 5D: new chapters and national contributions */}
      <ChaptersNationalRow />
    </Screen>
  );
}

export function ChapterDetailScreen({ route, navigation }: RootScreen<'ChapterDetail'>) {
  const { data, me } = useClub();
  const chapter = data.chapters.find((c) => c.id === route.params.chapterId);
  if (!chapter) return null;
  const members = sortMembers(
    visibleMembers(me, data).filter((m) => m.chapterId === chapter.id && m.approval === 'approved'),
  );
  const seats = data.positions.filter((p) => p.endedOn === null && p.chapterId === chapter.id);
  const board = seats.filter((p) => BOARD_ROLES.includes(p.role)).sort((a, b) => BOARD_ROLES.indexOf(a.role) - BOARD_ROLES.indexOf(b.role));
  const club = seats.filter((p) => CLUB_ROLES.includes(p.role)).sort((a, b) => CLUB_ROLES.indexOf(a.role) - CLUB_ROLES.indexOf(b.role));
  const counts = STATUS_ORDER.map((s) => [s, members.filter((m) => m.status === s).length] as const).filter(([, n]) => n > 0);

  const seatRow = ({ position: p, member: m }: { position: Position; member: Member }, i: number, arr: unknown[]) => (
    <ListRow
      key={p.id}
      last={i === arr.length - 1}
      left={<Avatar text={initials(m)} size={40} />}
      title={displayName(m)}
      subtitle={ROLE_LABEL[p.role]}
      onPress={() => navigation.navigate('MemberDetail', { memberId: m.id })}
    />
  );

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H1>{chapter.name} chapter</H1>
        <Small>{chapter.area}, {chapter.state}</Small>
        <Row style={{ gap: 6 }}>
          {counts.map(([s, n]) => (
            <Chip key={s} label={`${n} ${STATUS_LABEL[s]}`} tone="bone" />
          ))}
        </Row>
      </Stack>
      <SectionTitle title="Board" />
      <Card style={{ padding: 0, gap: 0 }}>{withHolders(board, data.members).map(seatRow)}</Card>
      {club.length > 0 ? (
        <>
          <SectionTitle title="Club positions" />
          <Card style={{ padding: 0, gap: 0 }}>{withHolders(club, data.members).map(seatRow)}</Card>
        </>
      ) : null}
      <SectionTitle title="Members" action={<Small>{members.length}</Small>} />
      <Card style={{ padding: 0, gap: 0 }}>
        {members.map((m, i) => (
          <MemberRow
            key={m.id}
            member={m}
            data={data}
            showChapter={false}
            last={i === members.length - 1}
            onPress={() => navigation.navigate('MemberDetail', { memberId: m.id })}
          />
        ))}
      </Card>
    </Screen>
  );
}

