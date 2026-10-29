// Invites to and from other clubs. Members pass on invites from other clubs; the board or Ride
// Committee answers for the club and links the event once it's on the club calendar. From the
// club's own rides they invite other clubs. The app sends nothing: invitations and replies are text
// the member shares themselves, from the phone's share sheet (or a copy box on the web).

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { useSocial } from '../data/social/SocialProvider';
import { managesRide } from '../domain/crew';
import { formatAuDate, parseAuDate, typeDate, weekday } from '../domain/dates';
import {
  answerLabel,
  answerProblem,
  CALENDAR_LABEL_NAME,
  CALENDAR_LABELS,
  calendarState,
  canAnswer,
  canChangeInvite,
  canEditClub,
  chapterLabel,
  clubProblem,
  inviteInProblem,
  inviteOutProblem,
  invitationText,
  invitesForRide,
  invitesIn,
  invitesOutByRide,
  MAX_CLUB_NAME,
  MAX_CONTACT,
  MAX_DETAILS,
  MAX_EVENT_TITLE,
  MAX_NOTE,
  MAX_PLACE,
  MAX_TOWN,
  replyText,
  waitingCount,
  type CalendarLabel,
  type ClubInvite,
  type InviteAnswer,
  type OtherClub,
} from '../domain/invites';
import { RIDE_CATEGORY_LABEL } from '../domain/labels';
import { displayName } from '../domain/profile';
import { lastDay, melbourneDate, melbourneTime } from '../domain/rides';
import type { ClubData, Member, Ride } from '../domain/types';
import type { RootParams, RootScreen } from '../navigation/types';
import { colors, fonts, radius, rideColors, space, type } from '../theme';
import {
  Body,
  Button,
  Card,
  Chip,
  Choices,
  ConfirmButton,
  Field,
  IconBadge,
  Ionicons,
  ListRow,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
} from '../ui/primitives';

type Nav = NavigationProp<RootParams>;

const ANSWER_TONE: Record<InviteAnswer, 'warn' | 'ok' | 'bone'> = { waiting: 'warn', yes: 'ok', no: 'bone' };

function Loading() {
  return (
    <Screen>
      <ActivityIndicator color={colors.redText} />
    </Screen>
  );
}

function NotFound({ text }: { text: string }) {
  return (
    <Screen>
      <Notice title="Not found">{text}</Notice>
    </Screen>
  );
}

const clubName = (id: string, clubs: OtherClub[]) => clubs.find((c) => c.id === id)?.name ?? 'A club off the list';
const whoName = (id: string | null, data: ClubData) => {
  const m = id ? data.members.find((x) => x.id === id) : undefined;
  return m ? displayName(m) : 'A former member';
};

/** The day an invite is for: its event's, or its ride's. */
function inviteDay(invite: ClubInvite, rides: Ride[]): string | null {
  if (invite.direction === 'in') return invite.eventOn;
  const ride = rides.find((r) => r.id === invite.rideId);
  return ride ? melbourneDate(ride.startsAt) : null;
}

/** What an invite is for: the event's name, or the ride's. */
function inviteTitle(invite: ClubInvite, rides: Ride[]): string {
  if (invite.direction === 'in') return invite.title ?? 'An event';
  return rides.find((r) => r.id === invite.rideId)?.title ?? 'A club ride';
}

/** The date in stencil, like the ride list: the day of the month over its weekday. */
function DateBlock({ date, tone }: { date: string | null; tone: string }) {
  return (
    <View style={[styles.dateBlock, { borderTopColor: tone }]}>
      <Text style={styles.dateDay}>{date ? Number(date.slice(8, 10)) : '?'}</Text>
      <Text style={styles.dateWeekday}>{date ? weekday(date) : ''}</Text>
    </View>
  );
}

/** Shares a message from the phone, or shows it to copy where there's no share sheet. */
function ShareTextButton({ label, message, kind = 'secondary' }: { label: string; message: string; kind?: 'primary' | 'secondary' }) {
  const [copy, setCopy] = useState<string | null>(null);
  const share = async () => {
    try {
      await Share.share({ message });
    } catch (e) {
      // Closing the browser's share sheet isn't a failure.
      if ((e as Error)?.name !== 'AbortError') setCopy(message);
    }
  };
  return (
    <Stack gap={space.sm}>
      <Button label={label} icon="share-outline" kind={kind} onPress={share} />
      {copy ? (
        <Notice title="Copy this">
          <Body selectable>{copy}</Body>
        </Notice>
      ) : null}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Rides tab: the way in
// ---------------------------------------------------------------------------

export function OtherClubsRow({ last = false }: { last?: boolean }) {
  const navigation = useNavigation<Nav>();
  const { me, data, today } = useClub();
  const { invites } = useSocial();
  const waiting = waitingCount(me, invites, data, today);
  return (
    <ListRow
      left={<IconBadge icon="people-outline" tone={waiting > 0 ? 'red' : 'steel'} />}
      title="Other clubs"
      subtitle={
        <Text style={styles.metaTime}>
          {waiting > 0
            ? `${waiting} ${waiting === 1 ? 'invite' : 'invites'} waiting for an answer`
            : 'Invites to and from other clubs'}
        </Text>
      }
      onPress={() => navigation.navigate('OtherClubs')}
      last={last}
    />
  );
}

// ---------------------------------------------------------------------------
// Other clubs: invites in, invites out, the clubs
// ---------------------------------------------------------------------------

type View_ = 'in' | 'out' | 'clubs';

/**
 * One invite in a list: its day in stencil, what it's for and the club, and its answer. `byClub`
 * is for a list under its ride's heading, where the club leads and the day would repeat.
 */
function InviteRow({
  invite,
  data,
  clubs,
  last,
  byClub = false,
}: {
  invite: ClubInvite;
  data: ClubData;
  clubs: OtherClub[];
  last: boolean;
  byClub?: boolean;
}) {
  const navigation = useNavigation<Nav>();
  const day = inviteDay(invite, data.rides);
  const title = inviteTitle(invite, data.rides);
  const club = clubName(invite.clubId, clubs);
  const answer = answerLabel(invite.direction, invite.answer);
  const when = day ? `${weekday(day)} ${formatAuDate(day)}` : null;
  const tone = invite.direction === 'in' ? rideColors[invite.calendarLabel ?? 'non_nuts'].bg : colors.redBright;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={(byClub ? [club, answer] : [title, invite.direction === 'in' ? `from ${club}` : `to ${club}`, when, answer])
        .filter(Boolean)
        .join(', ')}
      onPress={() => navigation.navigate('Invite', { inviteId: invite.id })}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.inviteRow,
        last && { borderBottomWidth: 0 },
        (pressed || hovered) && { backgroundColor: colors.steel },
      ]}
    >
      {byClub ? <IconBadge icon="people-outline" /> : <DateBlock date={day} tone={tone} />}
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text numberOfLines={2} style={type.name}>
          {byClub ? club : title}
        </Text>
        {byClub ? null : (
          <>
            {when ? <Text style={styles.metaTime}>{when}</Text> : null}
            <Small numberOfLines={1}>{invite.direction === 'in' ? `From ${club}` : `To ${club}`}</Small>
          </>
        )}
        <Row style={{ gap: 6, marginTop: 2 }}>
          <Chip label={answer} tone={ANSWER_TONE[invite.answer]} />
          {invite.calendarLabel ? <Chip label={invite.calendarLabel === 'supported' ? 'Supported' : 'Non-Nuts'} tone="bone" /> : null}
          {invite.bikes ? <Chip label={`${invite.bikes} bikes`} tone="bone" /> : null}
        </Row>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.boneMute} />
    </Pressable>
  );
}

export function OtherClubsScreen({ navigation }: RootScreen<'OtherClubs'>) {
  const { data, today, isDemo } = useClub();
  const { ready, invites, otherClubs, refresh } = useSocial();
  const [view, setView] = useState<View_>('in');
  if (!ready) return <Loading />;
  const incoming = invitesIn(invites, today);
  const outgoing = invitesOutByRide(invites, data.rides, today);
  const clubs = [...otherClubs].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      <Choices<View_>
        options={[
          { value: 'in', label: 'Invites in' },
          { value: 'out', label: 'Invites out' },
          { value: 'clubs', label: 'Clubs' },
        ]}
        value={view}
        onChange={setView}
      />

      {view === 'in' ? (
        <>
          <Button label="Pass on an invite" icon="add" onPress={() => navigation.navigate('EditInvite')} />
          <Small>Another club asked us to their ride or event? Pass it on here and the board answers for the club.</Small>
          {incoming.upcoming.length === 0 ? (
            <Card>
              <Body>No invites coming up. When another club asks us along, it shows here.</Body>
            </Card>
          ) : (
            <Card style={{ padding: 0, gap: 0 }}>
              {incoming.upcoming.map((i, n) => (
                <InviteRow key={i.id} invite={i} data={data} clubs={otherClubs} last={n === incoming.upcoming.length - 1} />
              ))}
            </Card>
          )}
          {incoming.earlier.length > 0 ? (
            <Stack gap={space.sm}>
              <SectionTitle title="Gone by" />
              <Card style={{ padding: 0, gap: 0 }}>
                {incoming.earlier.map((i, n) => (
                  <InviteRow key={i.id} invite={i} data={data} clubs={otherClubs} last={n === incoming.earlier.length - 1} />
                ))}
              </Card>
            </Stack>
          ) : null}
        </>
      ) : null}

      {view === 'out' ? (
        <>
          <Small>The board or Ride Committee invites other clubs from one of our rides: open the ride and tap Invite a club.</Small>
          {outgoing.length === 0 ? (
            <Card>
              <Body>No other clubs asked to a ride coming up.</Body>
            </Card>
          ) : (
            outgoing.map((g) => (
              <Stack key={g.ride.id} gap={space.sm}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${g.ride.title}, open the ride`}
                  onPress={() => navigation.navigate('RideDetail', { rideId: g.ride.id })}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.rideHead,
                    (pressed || hovered) && { backgroundColor: colors.steel },
                  ]}
                >
                  <Text style={[type.h2, { flex: 1 }]} numberOfLines={2}>
                    {g.ride.title}
                  </Text>
                  <Text style={styles.metaTime}>{formatAuDate(melbourneDate(g.ride.startsAt))}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.boneMute} />
                </Pressable>
                <Card style={{ padding: 0, gap: 0 }}>
                  {g.invites.map((i, n) => (
                    <InviteRow key={i.id} invite={i} data={data} clubs={otherClubs} last={n === g.invites.length - 1} byClub />
                  ))}
                </Card>
              </Stack>
            ))
          )}
        </>
      ) : null}

      {view === 'clubs' ? (
        <>
          <Button label="Add a club" icon="add" kind="secondary" onPress={() => navigation.navigate('EditOtherClub')} />
          {clubs.length === 0 ? (
            <Card>
              <Body>No clubs on the list yet.</Body>
            </Card>
          ) : (
            <Card style={{ padding: 0, gap: 0 }}>
              {clubs.map((c, n) => (
                <ListRow
                  key={c.id}
                  left={<IconBadge icon="people-outline" />}
                  title={c.name}
                  subtitle={c.town ?? undefined}
                  onPress={() => navigation.navigate('OtherClub', { clubId: c.id })}
                  last={n === clubs.length - 1}
                />
              ))}
            </Card>
          )}
        </>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One invite
// ---------------------------------------------------------------------------

export function InviteScreen({ route, navigation }: RootScreen<'Invite'>) {
  const { me, data } = useClub();
  const { ready, invites, otherClubs } = useSocial();
  if (!ready) return <Loading />;
  const invite = invites.find((i) => i.id === route.params.inviteId);
  if (!invite || !me) return <NotFound text="That invite has been taken off." />;
  const club = otherClubs.find((c) => c.id === invite.clubId);
  const ride = data.rides.find((r) => r.id === invite.rideId);
  const day = inviteDay(invite, data.rides);
  const manager = canAnswer(me, invite, data);
  const incoming = invite.direction === 'in';

  return (
    <Screen>
      <Card>
        <Row style={{ gap: space.md, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <DateBlock date={day} tone={incoming ? rideColors[invite.calendarLabel ?? 'non_nuts'].bg : colors.redBright} />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text style={type.h2}>{inviteTitle(invite, data.rides)}</Text>
            <Text style={styles.metaTime}>
              {day ? `${weekday(day)} ${formatAuDate(day)}` : ''}
              {!incoming && ride && !ride.allDay ? ` · ${melbourneTime(ride.startsAt)}` : ''}
            </Text>
            <Row style={{ gap: 6, marginTop: 2 }}>
              <Chip label={answerLabel(invite.direction, invite.answer)} tone={ANSWER_TONE[invite.answer]} />
              {invite.bikes ? <Chip label={`${invite.bikes} bikes`} tone="bone" /> : null}
              <Chip label={chapterLabel(invite.chapterId, data.chapters)} tone="steel" />
            </Row>
          </View>
        </Row>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${club?.name ?? 'The club'}, see the club`}
          disabled={!club}
          onPress={() => club && navigation.navigate('OtherClub', { clubId: club.id })}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.clubLine,
            (pressed || hovered) && club && { backgroundColor: colors.steel },
          ]}
        >
          <Ionicons name="people" size={18} color={colors.boneDim} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={type.name}>{incoming ? `From ${club?.name ?? 'a club off the list'}` : `To ${club?.name ?? 'a club off the list'}`}</Text>
            {club?.contact ? <Small selectable>{club.contact}</Small> : null}
          </View>
          {club ? <Ionicons name="chevron-forward" size={18} color={colors.boneMute} /> : null}
        </Pressable>
        {incoming && invite.place ? <Body selectable>{invite.place}</Body> : null}
        {incoming && invite.details ? <Body selectable>{invite.details}</Body> : null}
        {invite.note ? <Small selectable>Note: {invite.note}</Small> : null}
        <Small>
          {incoming ? 'Passed on' : 'Invited'} by {whoName(invite.addedBy, data)}
          {invite.answeredAt ? `. Answered by ${whoName(invite.answeredBy, data)} on ${formatAuDate(melbourneDate(invite.answeredAt))}.` : '.'}
        </Small>
      </Card>

      {incoming ? <CalendarSection invite={invite} me={me} /> : null}
      {!incoming && ride ? (
        <ListRow
          left={<IconBadge icon="calendar-outline" />}
          title={ride.title}
          subtitle="Open the ride"
          onPress={() => navigation.navigate('RideDetail', { rideId: ride.id })}
        />
      ) : null}

      {manager ? <AnswerForm key={`${invite.id}-${invite.answer}`} invite={invite} /> : null}

      {club && manager && incoming ? <ShareTextButton label="Share our reply" message={replyText(invite, club, data.chapters)} /> : null}
      {club && manager && ride && !incoming ? (
        <ShareTextButton label="Share the invitation again" message={invitationText(ride, club, data.chapters)} />
      ) : null}
      {manager ? (
        <Small>The app doesn’t send anything to other clubs. Sharing opens your phone’s share sheet, and you send it yourself.</Small>
      ) : null}

      <InviteActions invite={invite} me={me} />
    </Screen>
  );
}

/** Where an incoming invite stands on the club calendar, and linking it to its ride. */
function CalendarSection({ invite, me }: { invite: ClubInvite; me: Member }) {
  const navigation = useNavigation<Nav>();
  const { data, today } = useClub();
  const { invites, otherClubs, saveInviteIn } = useSocial();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = calendarState(invite, invites, data.rides);
  if (state.kind === 'none') return null;
  const canLink = canChangeInvite(me, invite, data);

  const link = (rideId: string | null) => {
    const input = {
      id: invite.id, clubId: invite.clubId, chapterId: invite.chapterId, title: invite.title ?? '', eventOn: invite.eventOn ?? '',
      place: invite.place ?? '', details: invite.details ?? '', rideId,
    };
    const problem = inviteInProblem(me, input, otherClubs, invites, data, today);
    if (problem) return setError(problem);
    setError(null);
    setBusy(rideId ?? 'unlink');
    saveInviteIn(input)
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(null));
  };

  if (state.kind === 'linked') {
    const ride = data.rides.find((r) => r.id === state.rideId);
    return (
      <Stack gap={space.sm}>
        <SectionTitle title="On the club calendar" />
        <Card style={{ padding: 0, gap: 0 }}>
          {ride ? (
            <ListRow
              left={<IconBadge icon="calendar" tone="red" />}
              title={ride.title}
              subtitle={`${RIDE_CATEGORY_LABEL[ride.category]} · ${formatAuDate(melbourneDate(ride.startsAt))}. Members answer on the ride.`}
              onPress={() => navigation.navigate('RideDetail', { rideId: ride.id })}
              last
            />
          ) : (
            <ListRow left={<IconBadge icon="calendar" />} title="On the calendar" subtitle="The ride has been and gone." last />
          )}
        </Card>
        {canLink ? (
          <Button label="Unlink the ride" kind="quiet" icon="unlink-outline" busy={busy === 'unlink'} onPress={() => link(null)} />
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </Stack>
    );
  }

  return (
    <Stack gap={space.sm}>
      <SectionTitle title="Club calendar" />
      <Notice tone="warn" title={`Put it on as ${state.label}`}>
        <Small style={{ color: colors.boneDim }}>
          Add it to the club’s Google calendar with the {state.label} label. It shows in Rides within 15 minutes, then link it here
          so members answer on the ride.
        </Small>
      </Notice>
      {state.suggestions.length > 0 ? (
        <Card style={{ padding: 0, gap: 0 }}>
          {state.suggestions.map((r, n) => (
            <ListRow
              key={r.id}
              left={<IconBadge icon="calendar-outline" />}
              title={r.title}
              subtitle={`${RIDE_CATEGORY_LABEL[r.category]} · ${formatAuDate(melbourneDate(r.startsAt))}`}
              right={
                canLink ? (
                  <Button
                    label="Link"
                    kind="secondary"
                    accessibilityLabel={`Link ${r.title}`}
                    busy={busy === r.id}
                    onPress={() => link(r.id)}
                  />
                ) : undefined
              }
              last={n === state.suggestions.length - 1}
            />
          ))}
        </Card>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Stack>
  );
}

type LabelChoice = CalendarLabel;

/** The board's answer: going or not (and the calendar label), or the other club's reply. */
function AnswerForm({ invite }: { invite: ClubInvite }) {
  const { me, data } = useClub();
  const { invites, answerInvite } = useSocial();
  const [answer, setAnswer] = useState<InviteAnswer>(invite.answer);
  const [label, setLabel] = useState<LabelChoice | null>(invite.calendarLabel);
  const [bikes, setBikes] = useState(invite.bikes ? String(invite.bikes) : '');
  const [note, setNote] = useState(invite.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const incoming = invite.direction === 'in';

  const save = () => {
    if (busy) return;
    setError(null);
    setSaved(false);
    const typed = bikes.trim();
    const input = {
      id: invite.id, answer, label: incoming ? label : null,
      bikes: incoming || typed === '' ? null : /^\d+$/.test(typed) ? Number(typed) : Number.NaN, note,
    };
    const problem = answerProblem(me, input, invites, data);
    if (problem) return setError(problem);
    setBusy(true);
    answerInvite(input)
      .then(() => setSaved(true))
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <Stack gap={space.sm}>
      <SectionTitle title={incoming ? 'Answer for the club' : 'Their reply'} />
      <Card>
        <Choices<InviteAnswer>
          options={(['waiting', 'yes', 'no'] as InviteAnswer[]).map((a) => ({ value: a, label: answerLabel(invite.direction, a) }))}
          value={answer}
          onChange={setAnswer}
        />
        {incoming && answer === 'yes' ? (
          <Choices<LabelChoice>
            label="On the club calendar as"
            options={CALENDAR_LABELS.map((l) => ({ value: l, label: CALENDAR_LABEL_NAME[l] }))}
            value={label}
            onChange={setLabel}
          />
        ) : null}
        {incoming && answer === 'yes' ? (
          <Small>Supported Club Rides are ones the club backs and rides to together. Non-Nuts Events are just for members to know about.</Small>
        ) : null}
        {!incoming && answer === 'yes' ? (
          <Field label="Bikes they’re bringing" value={bikes} onChangeText={setBikes} keyboardType="number-pad" maxLength={3} hint="Optional." />
        ) : null}
        <Field label="Note" value={note} onChangeText={setNote} multiline placeholder="Who you spoke to, what was agreed" hint="Optional. Members can read it." maxLength={MAX_NOTE * 2} />
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {saved ? <Notice tone="ok">Saved.</Notice> : null}
      <Button label="Save the answer" icon="checkmark" busy={busy} onPress={save} />
    </Stack>
  );
}

function InviteActions({ invite, me }: { invite: ClubInvite; me: Member }) {
  const navigation = useNavigation<Nav>();
  const { data } = useClub();
  const { archiveInvite } = useSocial();
  const [error, setError] = useState<string | null>(null);
  if (!canChangeInvite(me, invite, data)) return null;
  return (
    <Stack gap={space.sm}>
      {invite.direction === 'in' ? (
        <Button label="Change the details" kind="secondary" icon="create-outline" onPress={() => navigation.navigate('EditInvite', { inviteId: invite.id })} />
      ) : null}
      <ConfirmButton
        label="Take the invite off"
        confirmLabel="Take it off"
        kind="quiet"
        icon="archive-outline"
        confirmNote="It’s kept, but members won’t see it any more."
        onConfirm={() =>
          archiveInvite(invite.id)
            .then(() => navigation.goBack())
            .catch((e) => setError((e as Error).message))
        }
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Pass on or change an incoming invite
// ---------------------------------------------------------------------------

const WHOLE_CLUB = 'whole-club';

export function EditInviteScreen({ route, navigation }: RootScreen<'EditInvite'>) {
  const { ready, invites } = useSocial();
  if (!ready) return <Loading />;
  const id = route.params?.inviteId;
  const existing = id ? invites.find((i) => i.id === id && i.direction === 'in') : undefined;
  if (id && !existing) return <NotFound text="That invite has been taken off." />;
  return <InviteForm key={existing?.id ?? 'new'} existing={existing} navigation={navigation} />;
}

function InviteForm({ existing, navigation }: { existing: ClubInvite | undefined; navigation: RootScreen<'EditInvite'>['navigation'] }) {
  const { me, data, today } = useClub();
  const { invites, otherClubs, saveInviteIn } = useSocial();
  const [clubId, setClubId] = useState<string | null>(existing?.clubId ?? null);
  const [find, setFind] = useState('');
  const [chapter, setChapter] = useState<string>(existing ? existing.chapterId ?? WHOLE_CLUB : me?.chapterId ?? WHOLE_CLUB);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [dateText, setDateText] = useState(existing?.eventOn ? formatAuDate(existing.eventOn) : '');
  const [place, setPlace] = useState(existing?.place ?? '');
  const [details, setDetails] = useState(existing?.details ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clubs = [...otherClubs].sort((a, b) => a.name.localeCompare(b.name));
  const q = find.trim().toLowerCase();
  const shown = (q ? clubs.filter((c) => c.name.toLowerCase().includes(q) || (c.town ?? '').toLowerCase().includes(q)) : clubs).slice(0, 8);

  const save = () => {
    if (busy) return;
    setError(null);
    const input = {
      id: existing?.id ?? null, clubId: clubId ?? '', chapterId: chapter === WHOLE_CLUB ? null : chapter, title,
      eventOn: parseAuDate(dateText) ?? '', place, details, rideId: existing?.rideId ?? null,
    };
    const problem = inviteInProblem(me, input, otherClubs, invites, data, today);
    if (problem) return setError(problem === 'No such club.' ? 'Pick the club that asked us.' : problem);
    setBusy(true);
    saveInviteIn(input)
      .then((id) => (existing ? navigation.goBack() : navigation.replace('Invite', { inviteId: id })))
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <Screen>
      <Stack gap={space.sm}>
        <SectionTitle title="Which club" />
        <Card>
          {clubs.length > 8 || q ? (
            <Field label="Find a club" value={find} onChangeText={setFind} placeholder="Club name or town" autoCorrect={false} />
          ) : null}
          {shown.map((c) => {
            const on = c.id === clubId;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                aria-checked={on}
                accessibilityLabel={c.town ? `${c.name}, ${c.town}` : c.name}
                onPress={() => setClubId(c.id)}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.pick,
                  on && styles.pickOn,
                  (pressed || hovered) && !on && { backgroundColor: colors.steel },
                ]}
              >
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.redText : colors.boneMute} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={type.name}>{c.name}</Text>
                  {c.town ? <Small>{c.town}</Small> : null}
                </View>
              </Pressable>
            );
          })}
          {q && shown.length === 0 ? <Small>No club by that name on the list.</Small> : null}
          <Button label="Add a club to the list" kind="quiet" icon="add" onPress={() => navigation.navigate('EditOtherClub')} style={{ alignSelf: 'flex-start' }} />
        </Card>
      </Stack>
      <Card>
        <Field label="What’s on" value={title} onChangeText={setTitle} placeholder="Toy run, show and shine, poker run" maxLength={MAX_EVENT_TITLE * 2} />
        <Field
          label="When"
          value={dateText}
          onChangeText={(t) => setDateText(typeDate(t))}
          placeholder="DD/MM/YYYY"
          keyboardType="number-pad"
          maxLength={10}
          hint="Use DD/MM/YYYY, like 29/11/2026."
        />
        <Field label="Where" value={place} onChangeText={setPlace} placeholder="Where it starts" hint="Optional." maxLength={MAX_PLACE * 2} />
        <Field
          label="Details"
          value={details}
          onChangeText={setDetails}
          multiline
          placeholder="Times, cost, what to bring, who asked"
          hint="Optional. Every approved member can read it."
          maxLength={MAX_DETAILS * 2}
        />
        <Choices<string>
          label="Who it’s for"
          options={[...data.chapters.map((c) => ({ value: c.id, label: c.name })), { value: WHOLE_CLUB, label: 'Whole club' }]}
          value={chapter}
          onChange={setChapter}
        />
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={existing ? 'Save changes' : 'Pass it on'} icon="checkmark" busy={busy} onPress={save} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Invite a club to one of the club's rides
// ---------------------------------------------------------------------------

export function InviteClubScreen({ route, navigation }: RootScreen<'InviteClub'>) {
  const { me, data, today } = useClub();
  const { ready, invites, otherClubs, inviteClub } = useSocial();
  const [clubId, setClubId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ inviteId: string; message: string } | null>(null);
  if (!ready) return <Loading />;
  const ride = data.rides.find((r) => r.id === route.params.rideId);
  if (!ride || !me) return <NotFound text="That ride isn’t on the calendar." />;
  const asked = new Set(invitesForRide(ride.id, invites).filter((i) => i.direction === 'out').map((i) => i.clubId));
  const clubs = [...otherClubs].filter((c) => !asked.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  const club = otherClubs.find((c) => c.id === clubId);

  if (sent) {
    return (
      <Screen>
        <Notice tone="ok" title="Recorded">
          <Small style={{ color: colors.boneDim }}>
            If the share sheet didn’t open, share it again below. When they reply, record it on the invite.
          </Small>
        </Notice>
        <ShareTextButton label="Share the invitation" message={sent.message} kind="primary" />
        <Button label="See the invite" kind="secondary" onPress={() => navigation.replace('Invite', { inviteId: sent.inviteId })} />
      </Screen>
    );
  }

  const go = async () => {
    if (busy || !club) return setError(club ? null : 'Pick a club to invite.');
    setError(null);
    const input = { rideId: ride.id, clubId: club.id, note };
    const problem = inviteOutProblem(me, input, otherClubs, invites, data, today);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const inviteId = await inviteClub(input);
      const message = invitationText(ride, club, data.chapters);
      setSent({ inviteId, message });
      try {
        await Share.share({ message });
      } catch {
        // The next screen shows it to share or copy.
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Text style={type.h2}>{ride.title}</Text>
        <Text style={styles.metaTime}>
          {`${weekday(melbourneDate(ride.startsAt))} ${formatAuDate(melbourneDate(ride.startsAt))}`}
          {ride.location ? ` · ${ride.location}` : ''}
        </Text>
      </Card>
      <Stack gap={space.sm}>
        <SectionTitle title="Which club" />
        <Card>
          {clubs.length === 0 ? <Body>Every club on the list has been asked to this ride. Add another club first.</Body> : null}
          {clubs.map((c) => {
            const on = c.id === clubId;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                aria-checked={on}
                accessibilityLabel={c.town ? `${c.name}, ${c.town}` : c.name}
                onPress={() => setClubId(c.id)}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.pick,
                  on && styles.pickOn,
                  (pressed || hovered) && !on && { backgroundColor: colors.steel },
                ]}
              >
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.redText : colors.boneMute} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={type.name}>{c.name}</Text>
                  {c.contact ? <Small>{c.contact}</Small> : c.town ? <Small>{c.town}</Small> : null}
                </View>
              </Pressable>
            );
          })}
          <Button label="Add a club to the list" kind="quiet" icon="add" onPress={() => navigation.navigate('EditOtherClub')} style={{ alignSelf: 'flex-start' }} />
        </Card>
      </Stack>
      {club ? (
        <Stack gap={space.sm}>
          <SectionTitle title="What they’ll get" />
          <Card>
            <Body selectable>{invitationText(ride, club, data.chapters)}</Body>
          </Card>
        </Stack>
      ) : null}
      <Field label="Note for the club’s records" value={note} onChangeText={setNote} multiline placeholder="Who you’re sending it to" hint="Optional. Not part of the invitation." maxLength={MAX_NOTE * 2} />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Record and share" icon="share-outline" busy={busy} onPress={go} disabled={clubs.length === 0} />
      <Small>The app doesn’t send it. Your phone’s share sheet opens and you send it to the club yourself, by Messenger, text or email.</Small>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One club, and adding or changing one
// ---------------------------------------------------------------------------

export function OtherClubScreen({ route, navigation }: RootScreen<'OtherClub'>) {
  const { me, data } = useClub();
  const { ready, otherClubs, invites } = useSocial();
  if (!ready) return <Loading />;
  const club = otherClubs.find((c) => c.id === route.params.clubId);
  if (!club) return <NotFound text="That club is off the list." />;
  const theirs = invites
    .filter((i) => i.clubId === club.id)
    .sort((a, b) => (inviteDay(b, data.rides) ?? '').localeCompare(inviteDay(a, data.rides) ?? ''));
  return (
    <Screen>
      <Card>
        <Text style={type.h1}>{club.name}</Text>
        {club.town ? <Text style={styles.metaTime}>{club.town}</Text> : null}
        {club.contact ? (
          <Stack gap={2}>
            <Small>How to reach them</Small>
            <Body selectable>{club.contact}</Body>
          </Stack>
        ) : null}
        {club.note ? <Body selectable>{club.note}</Body> : null}
        <Small>Added by {whoName(club.addedBy, data)}.</Small>
      </Card>
      {canEditClub(me, club, data) ? (
        <Button label="Change" kind="secondary" icon="create-outline" onPress={() => navigation.navigate('EditOtherClub', { clubId: club.id })} />
      ) : null}
      <Stack gap={space.sm}>
        <SectionTitle title="Invites" />
        {theirs.length === 0 ? (
          <Card>
            <Body>No invites to or from them yet.</Body>
          </Card>
        ) : (
          <Card style={{ padding: 0, gap: 0 }}>
            {theirs.map((i, n) => (
              <InviteRow key={i.id} invite={i} data={data} clubs={otherClubs} last={n === theirs.length - 1} />
            ))}
          </Card>
        )}
      </Stack>
    </Screen>
  );
}

export function EditOtherClubScreen({ route, navigation }: RootScreen<'EditOtherClub'>) {
  const { ready, otherClubs } = useSocial();
  if (!ready) return <Loading />;
  const id = route.params?.clubId;
  const existing = id ? otherClubs.find((c) => c.id === id) : undefined;
  if (id && !existing) return <NotFound text="That club is off the list." />;
  return <ClubForm key={existing?.id ?? 'new'} existing={existing} navigation={navigation} />;
}

function ClubForm({ existing, navigation }: { existing: OtherClub | undefined; navigation: RootScreen<'EditOtherClub'>['navigation'] }) {
  const { me, data } = useClub();
  const { otherClubs, saveOtherClub, archiveOtherClub } = useSocial();
  const [name, setName] = useState(existing?.name ?? '');
  const [town, setTown] = useState(existing?.town ?? '');
  const [contact, setContact] = useState(existing?.contact ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (busy) return;
    setError(null);
    const input = { id: existing?.id ?? null, name, town, contact, note };
    const problem = clubProblem(me, input, otherClubs, data);
    if (problem) return setError(problem);
    setBusy(true);
    saveOtherClub(input)
      .then(() => navigation.goBack())
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <Screen>
      <Card>
        <Field label="Club name" value={name} onChangeText={setName} placeholder="As they write it" maxLength={MAX_CLUB_NAME * 2} />
        <Field label="Town" value={town} onChangeText={setTown} placeholder="Where they’re based" hint="Optional." maxLength={MAX_TOWN * 2} />
        <Field
          label="How to reach them"
          value={contact}
          onChangeText={setContact}
          multiline
          placeholder="Who to talk to, a phone number, their Facebook page"
          hint="Optional. Every approved member can read it, so only put what they’re happy for the club to have."
          maxLength={MAX_CONTACT * 2}
        />
        <Field label="Note" value={note} onChangeText={setNote} multiline placeholder="How we know them" hint="Optional." maxLength={MAX_NOTE * 2} />
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={existing ? 'Save changes' : 'Add the club'} icon="checkmark" busy={busy} onPress={save} />
      {existing ? (
        <ConfirmButton
          label="Take it off the list"
          confirmLabel="Take it off"
          kind="quiet"
          icon="archive-outline"
          confirmNote="Its invites stay, but it can’t be picked for new ones."
          onConfirm={() =>
            archiveOtherClub(existing.id)
              .then(() => navigation.pop(2))
              .catch((e) => setError((e as Error).message))
          }
        />
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// On a ride
// ---------------------------------------------------------------------------

/**
 * On one of the club's rides: the clubs asked and their replies, and Invite a club for its
 * managers. On another club's ride: the invite it came from. Hidden when there's nothing to show.
 */
export function RideInvitesSection({ ride, onInvite, onOpen }: { ride: Ride; onInvite: () => void; onOpen: (inviteId: string) => void }) {
  const { me, data, today } = useClub();
  const { invites, otherClubs } = useSocial();
  if (!me || me.approval !== 'approved') return null;
  const here = invitesForRide(ride.id, invites);
  const ours = ride.category === 'north' || ride.category === 'west' || ride.category === 'club';
  const canInvite = ours && managesRide(me, ride, data) && !ride.cancelledAt && lastDay(ride) >= today;
  if (here.length === 0 && !canInvite) return null;
  return (
    <Stack gap={space.sm}>
      <SectionTitle title={ours ? 'Other clubs invited' : 'Invited by'} />
      {here.length > 0 ? (
        <Card style={{ padding: 0, gap: 0 }}>
          {here.map((i, n) => (
            <ListRow
              key={i.id}
              left={<IconBadge icon="people-outline" />}
              title={clubName(i.clubId, otherClubs)}
              subtitle={
                <Row style={{ gap: 6 }}>
                  <Chip label={answerLabel(i.direction, i.answer)} tone={ANSWER_TONE[i.answer]} />
                  {i.bikes ? <Chip label={`${i.bikes} bikes`} tone="bone" /> : null}
                </Row>
              }
              onPress={() => onOpen(i.id)}
              last={n === here.length - 1}
            />
          ))}
        </Card>
      ) : null}
      {canInvite ? <Button label="Invite a club" kind="secondary" icon="people-outline" onPress={onInvite} /> : null}
    </Stack>
  );
}

const styles = StyleSheet.create({
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    minHeight: 64,
  },
  dateBlock: {
    width: 52,
    paddingVertical: 6,
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.steel,
    borderRadius: radius.sm,
    borderTopWidth: 4,
  },
  dateDay: { fontFamily: fonts.stencil, fontSize: 24, lineHeight: 28, color: colors.bone, fontVariant: ['tabular-nums'] },
  dateWeekday: { fontFamily: fonts.stencil, fontSize: 12, letterSpacing: 1, color: colors.boneDim, textTransform: 'uppercase' },
  metaTime: { fontFamily: fonts.stencil, fontSize: 13, letterSpacing: 0.3, color: colors.boneDim },
  rideHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: space.xs,
    borderRadius: radius.sm,
  },
  clubLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingVertical: space.xs,
    paddingHorizontal: space.xs,
    borderRadius: radius.sm,
  },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pickOn: { borderColor: colors.redBright, backgroundColor: colors.steel },
});
