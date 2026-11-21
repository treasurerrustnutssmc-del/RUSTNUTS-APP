import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import {
  canManageMember,
  canSeePhone,
  canSeePrivate,
  endTermProblem,
  reviewsChapter,
  visibleMembers,
  withHolders,
} from '../domain/access';
import { heldRows, isActing } from '../domain/acting';
import { canSeeAttendance } from '../domain/attendance';
import { compassFor } from '../domain/compass';
import { businessFor } from '../domain/business';
import { describeExpiry, expiryState, formatAuDate, formatLongDate, monthsBetween } from '../domain/dates';
import { clubCounts, longSeatTitle, longTitle, necRows, positionTitles, seatTitle, type StatusSplit } from '../domain/home';
import { BOARD_ROLES, CLUB_ROLES, LICENCE_LABEL, NATIONAL_ROLES, ROLE_LABEL, STATUS_LABEL, STATUS_ORDER } from '../domain/labels';
import { displayName, hasEarnedDisc, initials, nextFngReview, phoneNote, profileChecklist } from '../domain/profile';
import type { Member, Position } from '../domain/types';
import type { MemberFocus, RootScreen, TabScreen } from '../navigation/types';
import { MemberChatButtons } from './chat';
import { CoverPanels } from './coverBits';
import { useSocial } from '../data/social/SocialProvider'; // Member content rules
import { reportedByMe } from '../domain/reports';
import { ReportBox } from '../ui/ReportBox';
import { colors, space, type } from '../theme';
// Stage 4
import { canSeeFees } from '../domain/fees';
import { AttendanceSummary, HomeCheckinCard } from './checkin';
import { StandingCard } from './attendance';
import { termEndsOn, termState } from '../domain/terms';
import { HomeNeedsYouCard, HomeQuickActions, HomeReminders } from './homeCards';
import { IntroProgressCard } from './fng';
// Stage 7: social extras
import { ChaptersNationalRow } from './adminRows'; // Stage 5D
import { HomeOnThisDayCard, HomeShoutoutsCard } from './social';
import { HomeNewsCard } from './siteNews'; // club news, as on the website
import { WhoCanHelpRow } from './help';
import { SwapRow } from './swap';
import { BuildsRow } from './builds';
import { HistoryRow } from './history';
import { BragRow } from './brag';
import { BadgesCard } from './badges';
import { AskClubHomeRow } from './askClub';
import { HomeRoadRulesRow } from './roadRules';
import { mustSignFirst } from '../domain/roadRules';
import { HomeNextRideCard } from './rides';
import { MORE_FROM_CLUB } from '../domain/membersLayout';
import { homeCoverPanels } from '../domain/meLayout';
import { FirstRunCard } from '../ui/FirstRunCard';
import { useSavedFilters } from '../data/savedFilters';
import { CLUB_NUMBERS, showProfileCard } from '../domain/homeLayout';
import { MemberRow, RoleChips, sortedPositions, StepDownButton } from '../ui/MemberBits';
import { memberGroups } from '../domain/memberGroups';
import { useJump } from '../ui/useJump';
import {
  Avatar,
  Body,
  Button,
  Card,
  Chip,
  Disclosure,
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

const SPLIT_COLUMNS = [
  { key: 'patched', label: 'Full' },
  { key: 'nomads', label: 'Nomads' },
  { key: 'fngs', label: 'FNGs' },
  { key: 'legacy', label: 'Legacy' },
] as const;

/** Home's club numbers: one row per chapter and a club row, by Patched, Nomads, FNGs and Legacy. */
function ClubSplitTable({ rows }: { rows: ({ id: string; name: string } & StatusSplit)[] }) {
  const cell = { flex: 1, textAlign: 'center' as const };
  return (
    <View>
      {/* The heads are for the eye; each row already says its numbers to a screen reader. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', paddingBottom: 6 }}>
        <View style={{ flex: 1.1 }} />
        {SPLIT_COLUMNS.map((c) => (
          <Label key={c.key} style={[cell, { letterSpacing: 0.6 }]}>{c.label}</Label>
        ))}
      </View>
      {rows.map((r, i) => (
        <View
          key={r.id}
          accessible
          accessibilityLabel={`${r.name}: ${SPLIT_COLUMNS.map((c) => `${r[c.key]} ${c.label}`).join(', ')}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 8,
            borderTopWidth: 1,
            borderTopColor: i === rows.length - 1 ? colors.lineStrong : colors.line,
          }}
        >
          <Text style={[type.name, { flex: 1.1 }]}>{r.name}</Text>
          {SPLIT_COLUMNS.map((c) => (
            <Text key={c.key} style={[type.name, cell, { fontVariant: ['tabular-nums'] }, r[c.key] === 0 ? { color: colors.boneMute } : null]}>
              {r[c.key]}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/** A chapter's members split into Patched, Nomads, FNGs, Hang Arounds, Supporters, Family and Legacy. */
function GroupedMembers({ members, onOpen }: { members: Member[]; onOpen: (memberId: string) => void }) {
  const { data } = useClub();
  return (
    <Stack gap={space.sm}>
      {memberGroups(members).map((g) => (
        <Stack key={g.status} gap={6}>
          <Label>{`${g.title} · ${g.members.length}`}</Label>
          <Card style={{ padding: 0, gap: 0 }}>
            {g.members.map((m, i) => (
              <MemberRow
                key={m.id}
                member={m}
                data={data}
                showChapter={false}
                last={i === g.members.length - 1}
                onPress={() => onOpen(m.id)}
              />
            ))}
          </Card>
        </Stack>
      ))}
    </Stack>
  );
}

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
  const { me, data, today, isDemo, refresh } = useClub();
  const [numbersOpen, setNumbersOpen] = useState(false);
  if (!me) return null;
  const chapter = data.chapters.find((c) => c.id === me.chapterId);
  const positions = sortedPositions(me.id, data);
  const checklist = profileChecklist(me, data);
  const done = checklist.filter((c) => c.done).length;
  const counts = clubCounts(data.chapters, data.members, data.unclaimedRoster ?? []);
  const business = businessFor(me, data, nowInstant());
  // The header names the home chapter first, so a seat there doesn't repeat it ("North chapter · Road Captain,
  // Acting Treasurer"). A stint's title goes last and its until date on a line of its own, so the header
  // never wraps to three lines at 390 wide. Each title wraps as one piece, so on a narrower phone a line
  // breaks between titles, never inside one.
  const atHome = ` (${chapter?.name})`;
  const titles = positionTitles(positions, data.chapters, me.chapterId, ROLE_LABEL)
    .map((t) => (chapter && t.text.endsWith(atHome) ? { ...t, text: t.text.slice(0, -atHome.length) } : t))
    .sort((a, b) => Number(!!a.until) - Number(!!b.until));
  const until = titles.find((t) => t.until)?.until;

  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      <Flannel>
        <Row style={{ gap: space.md, flexWrap: 'nowrap' }}>
          <Avatar text={initials(me)} size={56} />
          <View style={{ flex: 1, gap: 4 }}>
            {/* One line on phones: a longer name shrinks to fit rather than wrapping (the web ignores this). */}
            <Text
              accessibilityRole="header"
              aria-level={1}
              style={type.h1}
              numberOfLines={Platform.OS === 'web' ? undefined : 1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              G’day, {displayName(me)}
            </Text>
            <View style={styles.titleLine}>
              <Small style={styles.titlePiece}>{`${chapter?.name} chapter${titles.length ? ' ·' : ''}`}</Small>
              {titles.map((t, i) => (
                <Small key={t.key} style={styles.titlePiece}>{`${t.text}${i < titles.length - 1 ? ',' : ''}`}</Small>
              ))}
            </View>
            {until ? <Small style={{ color: colors.boneDim }}>{`until ${until}`}</Small> : null}
          </View>
          {hasEarnedDisc(me) ? <MemberDisc size={52} compass={compassFor(me, data)} /> : null}
        </Row>
      </Flannel>

      {/* Anything waiting on you, approvals first: the first thing you see */}
      <HomeNeedsYouCard />
      {/* A covered holder: who is acting for them, and I'm back */}
      <CoverPanels panels={homeCoverPanels(me, data, today)} />
      {/* New here? Where things are, once */}
      <FirstRunCard />
      {/* On the day: I'm here, and riders waiting for a leader to confirm them, at the top */}
      <HomeCheckinCard />
      {/* The next ride, so it is one tap from opening the app */}
      <HomeNextRideCard onOpen={(rideId) => navigation.navigate('RideDetail', { rideId })} />
      {/* The everyday jobs that aren't a tab */}
      <HomeQuickActions />
      {/* The Road Rules: the illustrated draft until the NEC publishes, then where you stand */}
      {/* Hidden while you still have to sign: that's a Needs you row */}
      {mustSignFirst(me, data, today) ? null : <HomeRoadRulesRow onOpen={(to) => navigation.navigate(to)} />}

      {/* Stage 5: meetings and votes */}
      {business.summary ? (
        <Card style={{ padding: 0, gap: 0 }}>
          <ListRow
            left={<IconBadge icon="hammer" />}
            title="Club business"
            subtitle={business.summary}
            onPress={() => navigation.navigate('Business')}
            last
            lines="all"
          />
        </Card>
      ) : null}

      {/* Stage 7: birthdays and patch anniversaries this week */}
      <HomeShoutoutsCard />
      <HomeOnThisDayCard />
      <HomeNewsCard />
      {/* Ask the club, the club assistant */}
      <AskClubHomeRow onOpen={() => navigation.navigate('AskClub')} />

      {showProfileCard(done, checklist.length) ? (
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
  
      ) : null}

      <Disclosure title={CLUB_NUMBERS.title} summary={CLUB_NUMBERS.summary} open={numbersOpen} onToggle={() => setNumbersOpen((o) => !o)}>
        <Card>
          <ClubSplitTable rows={[...counts.split, { id: 'club-total', name: 'Club', ...counts.club }]} />
          {counts.onApp < counts.total ? (
            <Small>
              {counts.onApp} of {counts.total} signed in to the app so far.
            </Small>
          ) : null}
        </Card>
      </Disclosure>

      {/* Rego, licence and first aid reminders last ("approvals top, regos bottom") */}
      <HomeReminders />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Members directory
// ---------------------------------------------------------------------------

export function MembersScreen({ navigation }: TabScreen<'Members'>) {
  const { me, data, isDemo, refresh } = useClub();
  const [query, setQuery] = useState('');
  const [chosenChapter, setChosenChapter] = useState<string | null>(null);
  const saved = useSavedFilters();
  // What was chosen this visit, else what was remembered, else everyone.
  const chapterId = chosenChapter ?? saved.filters.memberChapter ?? 'all';
  const setChapterId = (id: string) => {
    setChosenChapter(id);
    saved.save({ memberChapter: id });
  };
  const [moreOpen, setMoreOpen] = useState(false);

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
      {/* Chapters, history and the social extras: folded away so the member list comes first */}
      <Disclosure title={MORE_FROM_CLUB.title} summary={MORE_FROM_CLUB.summary} open={moreOpen} onToggle={() => setMoreOpen((o) => !o)}>
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
      </Disclosure>
      <Button label="What do SAA, RC and the other short names mean?" kind="quiet" onPress={() => navigation.navigate('ClubWords')} />
      {groups.length === 0 ? (
        <Notice title="Nobody matches">Try a road name, a real name or a bike, like “Softail”.</Notice>
      ) : null}
      {groups.map((g) => (
        <Stack key={g.chapter.id} gap={space.sm}>
          <SectionTitle title={g.chapter.name} action={<Small>{g.members.length} members</Small>} />
          <GroupedMembers members={g.members} onOpen={(id) => navigation.navigate('MemberDetail', { memberId: id })} />
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
      {error ? <Small style={{ color: colors.danger }}>{error}</Small> : null}
      {mine.map((p) => (
        <StepDownButton
          key={p.id}
          position={p}
          data={data}
          onConfirm={() => endPosition(p.id).then(() => setError(null), (e: Error) => setError(e.message))}
        />
      ))}
    </View>
  );
}

export function MemberDetailScreen({ route, navigation }: RootScreen<'MemberDetail'>) {
  const { me, data, today } = useClub();
  const { myOpenReports } = useSocial();
  const member = data.members.find((m) => m.id === route.params.memberId);
  // The Board's Needs-you rows open a member at the part that needs fixing.
  const { scroller, mark: focusRef, jump } = useJump<MemberFocus>();
  const focus = route.params.focus;
  useEffect(() => {
    if (!focus) return;
    jump(focus);
    navigation.setParams({ focus: undefined });
  }, [focus, jump, navigation]);
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
    <Screen scroller={scroller}>
      <Card>
        <Row style={{ gap: space.lg, flexWrap: 'nowrap' }}>
          <Avatar text={initials(member)} size={72} />
          <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
            <H1>{displayName(member)}</H1>
            {member.roadName ? <Small>{member.fullName}</Small> : null}
          </View>
          {hasEarnedDisc(member) ? <MemberDisc size={60} compass={compassFor(member, data)} /> : null}
        </Row>
        {/* The chips take the card's full width, so a stint's chip (ACTING TREASURER (NORTH)) stays on one line. */}
        <Row style={{ gap: 6 }}>
          <StatusChip status={member.status} />
          {member.onHiatus ? <Chip label="On hiatus" icon="pause" /> : null}
          <RoleChips positions={positions} data={data} />
        </Row>
        <Stack gap={2}>
          <KeyValue label="Chapter" value={`${chapter?.name} · ${chapter?.area}`} />
          {/* Each seat in the long form ("Acting Treasurer (North) until 13/12/2026"), with its dates under it. */}
          {positions.map((p) => {
            const ended = !isActing(p) && termState(p, today) === 'ended';
            const term = !isActing(p) && termEndsOn(p) ? ` · term ${ended ? 'ended' : 'ends'} ${formatAuDate(termEndsOn(p))}` : '';
            return (
              <View key={p.id} style={{ gap: 2, paddingVertical: 4 }}>
                <Text style={type.name}>{longSeatTitle(p, data.chapters)}</Text>
                <Small style={ended ? { color: colors.warn } : undefined}>{`Since ${formatLongDate(p.startedOn)}${term}`}</Small>
              </View>
            );
          })}
          {member.joinedOn ? <KeyValue label="With the club since" value={formatLongDate(member.joinedOn)} /> : null}
          {member.patchedOn ? <KeyValue label="Patched" value={formatLongDate(member.patchedOn)} /> : null}
          {fngMonths !== null ? (
            <KeyValue label="FNG" value={`${fngMonths} months in · ${review?.atMonths}-month review ${formatLongDate(review?.date)}`} />
          ) : null}
        </Stack>
        {/* Member content rules: a profile you've reported hides its bio from you until the board deals with it */}
        {member.bio && !reportedByMe('profile', member.id, myOpenReports) ? <Body>{member.bio}</Body> : null}
        {isSelf ? <StepDownButtons positions={positions} /> : null}
        {isSelf ? (
          <Button label="Edit profile" kind="secondary" icon="create-outline" onPress={() => navigation.navigate('EditProfile')} />
        ) : null}
        {canManage ? (
          <Button label="Manage member" kind="secondary" icon="shield-outline" onPress={() => navigation.navigate('ManageMember', { memberId: member.id })} />
        ) : null}
        {/* Stage 3 (lane B): private chats and blocking */}
        <MemberChatButtons member={member} onOpenChat={(chatId) => navigation.navigate('Chat', { chatId })} />
        {!isSelf && member.approval === 'approved' ? <ReportBox kind="profile" targetId={member.id} authorId={member.id} /> : null}
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
          <View ref={focusRef('ride-ready')} collapsable={false}>
            <SectionTitle title="Ride-ready" action={<LockNote text={isSelf ? 'You + board' : 'Board only'} />} />
          </View>
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

          <View ref={focusRef('contacts')} collapsable={false}>
            <SectionTitle title="Emergency contacts" action={<LockNote text={isSelf ? 'You + board' : 'Board only'} />} />
          </View>
          <Card style={{ padding: 0, gap: 0 }}>
            {contacts.length === 0 ? (
              <View style={{ padding: space.lg }}>
                <Notice tone="warn" title="Not recorded">
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
  const held = heldRows(data.positions);
  const national = (role: (typeof NATIONAL_ROLES)[number]) => held.filter((p) => p.role === role);
  const nameOf = (memberId: string) => {
    const m = data.members.find((x) => x.id === memberId);
    return m ? displayName(m) : '—';
  };
  // The National card reads as a roll, in the order its first line names them: the Chairman, the
  // Secretary, one row per chapter for whoever casts its NEC vote (11.2), then the Auditor (11.8).
  const roll = [
    ...[...national('nec_chair'), ...national('nec_secretary')].map((p) => ({ key: p.id, text: `${nameOf(p.memberId)}, ${ROLE_LABEL[p.role]}` })),
    ...necRows(data).map((r) => ({ key: r.chapterId, text: r.text })),
    ...national('nec_auditor').map((p) => ({ key: p.id, text: `${nameOf(p.memberId)}, ${ROLE_LABEL[p.role]}` })),
  ];

  return (
    <Screen>
      {data.chapters.map((c) => {
        const members = approved.filter((m) => m.chapterId === c.id);
        // A seat's holder, then anyone acting in it (a cover or an empty-seat stint).
        const board = held
          .filter((p) => p.chapterId === c.id && BOARD_ROLES.includes(p.role))
          .sort((a, b) => BOARD_ROLES.indexOf(a.role) - BOARD_ROLES.indexOf(b.role) || Number(isActing(a)) - Number(isActing(b)));
        return (
          <Card key={c.id} style={{ padding: 0, gap: 0 }}>
            <ListRow
              left={<IconBadge icon="flag" tone="red" />}
              title={<H2>{c.name}</H2>}
              subtitle={`${c.area} · ${members.length} members`}
              onPress={() => navigation.navigate('ChapterDetail', { chapterId: c.id })}
            />
            <View style={{ padding: space.lg, gap: 4 }}>
              {/* No chapters passed: the card is the chapter, so "Treasurer" or "Acting Treasurer". */}
              {board.map((p) => (
                <KeyValue key={p.id} label={seatTitle(p, [], ROLE_LABEL)} value={nameOf(p.memberId)} />
              ))}
              {board.length === 0 ? <Small>No board positions recorded.</Small> : null}
            </View>
          </Card>
        );
      })}

      <SectionTitle title="National" />
      <Card>
        <Small>The National Executive Committee is the Chairman, the Secretary and the sitting chapter Presidents. The National Auditor reviews the records from outside it (11.8).</Small>
        {/* "Rusty, National Chairman", "Jet, Acting President (North), for Smokey until 13/12/2026" */}
        <Stack gap={space.xs}>
          {roll.map((r) => (
            <Text key={r.key} style={type.name}>
              {r.text}
            </Text>
          ))}
        </Stack>
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
  const seats = heldRows(data.positions).filter((p) => p.chapterId === chapter.id);
  // A seat's holder comes before anyone acting in it.
  const inOrder = (roles: typeof BOARD_ROLES) => (a: Position, b: Position) => roles.indexOf(a.role) - roles.indexOf(b.role) || Number(isActing(a)) - Number(isActing(b));
  const board = seats.filter((p) => BOARD_ROLES.includes(p.role)).sort(inOrder(BOARD_ROLES));
  const club = seats.filter((p) => CLUB_ROLES.includes(p.role)).sort(inOrder(CLUB_ROLES));
  const counts = STATUS_ORDER.map((s) => [s, members.filter((m) => m.status === s).length] as const).filter(([, n]) => n > 0);

  // No chapters passed: the chapter goes without saying here, so "Treasurer" or "Acting Treasurer until 13/12/2026".
  const seatRow = ({ position: p, member: m }: { position: Position; member: Member }, i: number, arr: unknown[]) => (
    <ListRow
      key={p.id}
      last={i === arr.length - 1}
      left={<Avatar text={initials(m)} size={40} />}
      title={displayName(m)}
      subtitle={longTitle(positionTitles([p], [], '', ROLE_LABEL)[0])}
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
      <GroupedMembers members={members} onOpen={(id) => navigation.navigate('MemberDetail', { memberId: id })} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The Home header's chapter and titles: one piece each, a space's width apart.
  titleLine: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 4 },
  titlePiece: { color: colors.boneDim, flexShrink: 1 },
});
