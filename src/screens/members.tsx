import React, { useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import {
  canManageMember,
  canSeePhone,
  canSeePrivate,
  pendingFor,
  visibleMembers,
  withHolders,
} from '../domain/access';
import { describeExpiry, expiryState, formatLongDate, monthsBetween } from '../domain/dates';
import { BOARD_ROLES, CLUB_ROLES, LICENCE_LABEL, NATIONAL_ROLES, ROLE_LABEL, STATUS_LABEL, STATUS_ORDER } from '../domain/labels';
import { displayName, expiryAlerts, initials, nextFngReview, phoneNote, profileChecklist } from '../domain/profile';
import type { Member, Position } from '../domain/types';
import type { RootScreen, TabScreen } from '../navigation/types';
import { colors, space } from '../theme';
import { MemberRow, sortedPositions } from '../ui/MemberBits';
import {
  Avatar,
  Body,
  Button,
  Card,
  Chip,
  Choices,
  Field,
  H1,
  H2,
  IconBadge,
  Ionicons,
  KeyValue,
  Label,
  ListRow,
  LockNote,
  Notice,
  RoleChip,
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
  const approved = data.members.filter((m) => m.approval === 'approved');

  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      <Row style={{ gap: space.md, flexWrap: 'nowrap' }}>
        <Avatar text={initials(me)} size={56} />
        <View style={{ flex: 1, gap: 4 }}>
          <H1>G’day, {displayName(me)}</H1>
          <Small>
            {chapter?.name} chapter
            {positions.length ? ` · ${positions.map((p) => ROLE_LABEL[p.role]).join(', ')}` : ''}
          </Small>
        </View>
      </Row>

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
          {data.chapters.map((c) => {
            const n = approved.filter((m) => m.chapterId === c.id).length;
            return (
              <View key={c.id} style={{ gap: 2 }}>
                <H1 style={{ fontVariant: ['tabular-nums'] }}>{n}</H1>
                <Label>{c.name}</Label>
              </View>
            );
          })}
          <View style={{ gap: 2 }}>
            <H1>{approved.filter((m) => m.status === 'full' || m.status === 'nomad').length}</H1>
            <Label>Patched</Label>
          </View>
          <View style={{ gap: 2 }}>
            <H1>{approved.filter((m) => m.status === 'fng').length}</H1>
            <Label>FNGs</Label>
          </View>
        </Row>
      </Card>

      <Card>
        <Label>On the way</Label>
        {[
          ['calendar', 'Ride calendar, RSVPs and locked routes', 'Stage 2'],
          ['chatbubbles', 'Chat, photos and the ride wall', 'Stage 3'],
          ['card', 'Fees, check-ins and the FNG tracker', 'Stage 4'],
        ].map(([icon, text, stage]) => (
          <Row key={text} style={{ gap: space.md, flexWrap: 'nowrap' }}>
            <Ionicons name={icon as 'calendar'} size={18} color={colors.boneMute} />
            <Body style={{ flex: 1 }}>{text}</Body>
            <Small>{stage}</Small>
          </Row>
        ))}
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
              {positions.map((p) => (
                <RoleChip key={p.id} role={p.role} />
              ))}
            </Row>
          </View>
        </Row>
        <Stack gap={2}>
          <KeyValue label="Chapter" value={`${chapter?.name} · ${chapter?.area}`} />
          {positions.map((p) => (
            <KeyValue
              key={p.id}
              label={ROLE_LABEL[p.role]}
              value={`Since ${formatLongDate(p.startedOn)}`}
            />
          ))}
          {member.joinedOn ? <KeyValue label="With the club since" value={formatLongDate(member.joinedOn)} /> : null}
          {member.patchedOn ? <KeyValue label="Patched" value={formatLongDate(member.patchedOn)} /> : null}
          {fngMonths !== null ? (
            <KeyValue label="FNG" value={`${fngMonths} months in · ${review?.atMonths}-month review ${formatLongDate(review?.date)}`} />
          ) : null}
        </Stack>
        {member.bio ? <Body>{member.bio}</Body> : null}
        {isSelf ? (
          <Button label="Edit my profile" kind="secondary" icon="create-outline" onPress={() => navigation.navigate('EditProfile')} />
        ) : null}
        {canManage ? (
          <Button label="Manage member" kind="secondary" icon="shield-outline" onPress={() => navigation.navigate('ManageMember', { memberId: member.id })} />
        ) : null}
      </Card>

      {member.approval === 'pending' ? (
        <Notice tone="warn" title="Waiting for approval">
          Approve or decline from the Board tab.
        </Notice>
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

export function ChaptersScreen({ navigation }: TabScreen<'Chapters'>) {
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
        <Small>The National Executive Committee: sitting chapter Presidents plus the national roles.</Small>
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

