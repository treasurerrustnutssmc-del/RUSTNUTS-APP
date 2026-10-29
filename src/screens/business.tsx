// Club business: meetings (agenda, minutes, action items) and votes. Members see the votes they're
// on, the general meetings and their own action items; whoever runs a chapter (its board) or the
// whole club (the NEC) also calls meetings, writes and approves minutes, and opens and closes votes.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { businessFor, melbourneHhmm, melbourneInstant, parseTime, shortDay } from '../domain/business';
import { formatAuDate, parseAuDate, typeDate } from '../domain/dates';
import {
  BALLOT_LABEL,
  ELECTORATE_LABEL,
  meetingKindLabel,
  RESULT_LABEL,
  THRESHOLD_LABEL,
  electoratesFor,
  kindsFor,
} from '../domain/labels';
import {
  approveMinutesProblem,
  canOwnAction,
  canSeeMinutes,
  minutesDueOn,
  minutesState,
  noticeLine,
  noticeWarning,
  runsScope,
  setDoneProblem,
} from '../domain/meetings';
import { displayName, initials } from '../domain/profile';
import { melbourneDate, melbourneTime } from '../domain/rides';
import type {
  ActionItem,
  AgendaItem,
  BallotChoice,
  ClubData,
  Electorate,
  Meeting,
  MeetingKind,
  Member,
  Threshold,
  Vote,
} from '../domain/types';
import { auditorSeat } from '../domain/access';
import { castProblem, chairOf, defaultQuorum, electorsFor, REINSTATABLE, ruleLine, TIE } from '../domain/votes';
import type { RootScreen } from '../navigation/types';
import { colors, fonts, radius, space, type } from '../theme';
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
  Ionicons,
  KeyValue,
  ListRow,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
  Toggle,
} from '../ui/primitives';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
const nowIso = () => new Date().toISOString();

/** "Wed 04/11/2026, 7:30 pm" */
function when(iso: string): string {
  const date = melbourneDate(iso);
  return `${weekday(date)} ${formatAuDate(date)}, ${melbourneTime(iso)}`;
}

function scopeLabel(chapterId: string | null, data: ClubData): string {
  if (chapterId === null) return 'Whole club';
  return `${data.chapters.find((c) => c.id === chapterId)?.name ?? ''} chapter`;
}

/** The chapters (and the whole club, as null) this person runs. */
function scopesRun(me: Member | null, data: ClubData): (string | null)[] {
  const scopes: (string | null)[] = data.chapters.filter((c) => runsScope(me, c.id, data.positions)).map((c) => c.id);
  if (runsScope(me, null, data.positions)) scopes.push(null);
  // Your own chapter first.
  return scopes.sort((a, b) => Number(b === me?.chapterId) - Number(a === me?.chapterId));
}

const memberName = (id: string | null, data: ClubData) => {
  const m = data.members.find((x) => x.id === id);
  return m ? displayName(m) : 'Someone';
};

const useAction = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
};

function ErrorNotice({ error }: { error: string | null }) {
  return (
    <View accessibilityLiveRegion="polite" role="alert">
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function DateBlock({ iso, muted }: { iso: string; muted?: boolean }) {
  const date = melbourneDate(iso);
  return (
    <View style={[styles.dateBlock, muted && styles.faded]}>
      <Text style={styles.dateDay}>{Number(date.slice(8, 10))}</Text>
      <Text style={styles.dateWeekday}>{weekday(date)}</Text>
    </View>
  );
}

const MINUTES_CHIP = {
  approved: { label: 'Minutes confirmed', tone: 'ok' },
  draft: { label: 'Draft minutes', tone: 'steel' },
  due: { label: 'Minutes due', tone: 'warn' },
  overdue: { label: 'Minutes overdue', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  upcoming: null,
} as const;

function MeetingRow({ meeting, last, onPress }: { meeting: Meeting; last: boolean; onPress: () => void }) {
  const { me, data } = useClub();
  const state = minutesState(meeting, nowIso());
  // Minutes due or overdue is a job for whoever runs the meeting, not news for members.
  const owed = state === 'due' || state === 'overdue';
  const chip = owed && !runsScope(me, meeting.chapterId, data.positions) ? null : MINUTES_CHIP[state];
  const date = melbourneDate(meeting.startsAt);
  const label = [
    meeting.title,
    `${weekday(date)} ${formatAuDate(date)}`,
    melbourneTime(meeting.startsAt),
    meeting.location,
    meetingKindLabel(meeting.kind, meeting.chapterId),
    chip?.label,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        last && { borderBottomWidth: 0 },
        (pressed || hovered) && { backgroundColor: colors.steel },
      ]}
    >
      <DateBlock iso={meeting.startsAt} muted={!!meeting.cancelledAt} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text numberOfLines={2} style={[type.name, meeting.cancelledAt && styles.struck]}>
          {meeting.title}
        </Text>
        <Text numberOfLines={1} style={type.small}>
          <Text style={styles.metaTime}>{melbourneTime(meeting.startsAt)}</Text>
          {` · ${meeting.chapterId === null ? 'Whole club' : data.chapters.find((c) => c.id === meeting.chapterId)?.name ?? ''}`}
          {meeting.location ? ` · ${meeting.location}` : ''}
        </Text>
        <Row style={{ gap: 6, marginTop: 2 }}>
          <Chip label={meetingKindLabel(meeting.kind, meeting.chapterId)} tone="bone" />
          {chip ? <Chip label={chip.label} tone={chip.tone} /> : null}
        </Row>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.boneMute} />
    </Pressable>
  );
}

function VoteRow({ vote, needsMe, last, onPress }: { vote: Vote; needsMe: boolean; last: boolean; onPress: () => void }) {
  const { me } = useClub();
  const voted = !!me && vote.votedIds.includes(me.id);
  const closed = vote.closedAt !== null;
  const status = closed
    ? `Closed ${formatAuDate(melbourneDate(vote.closedAt!))}`
    : `${vote.votedIds.length} of ${vote.electorIds.length} voted · closes ${shortDay(vote.closesAt)}`;
  return (
    <ListRow
      last={last}
      left={<View style={[styles.voteBadge, needsMe && styles.voteBadgeOn]}>
        <Ionicons name={closed ? 'checkmark-done' : 'hand-left'} size={18} color={colors.bone} />
      </View>}
      title={<Text numberOfLines={3} style={type.name}>{vote.question}</Text>}
      subtitle={status}
      right={
        // A vote waiting on you already wears the red badge and sits under "Your vote".
        needsMe ? undefined : closed ? (
          <Chip label={RESULT_LABEL[vote.result!]} tone={vote.result === 'carried' ? 'ok' : 'steel'} />
        ) : voted ? (
          <Chip label="Voted" tone="ok" icon="checkmark" />
        ) : undefined
      }
      onPress={onPress}
    />
  );
}

function ActionRow({ item, last, showOwner }: { item: ActionItem; last: boolean; showOwner: boolean }) {
  const { me, data, today, setActionDone } = useClub();
  const [error, setError] = useState<string | null>(null);
  const done = item.doneOn !== null;
  const canTick = setDoneProblem(me, item, data) === null;
  const late = !done && item.dueOn !== null && item.dueOn < today;
  const meta = [
    showOwner ? memberName(item.ownerId, data) : null,
    done ? `Done ${formatAuDate(item.doneOn)}` : item.dueOn ? `Due ${formatAuDate(item.dueOn)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const toggle = async () => {
    setError(null);
    try {
      await setActionDone(item.id, !done);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <View style={[styles.actionRow, last && { borderBottomWidth: 0 }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done, disabled: !canTick }}
        aria-checked={done}
        accessibilityLabel={`${item.title}${meta ? `, ${meta}` : ''}`}
        disabled={!canTick}
        onPress={toggle}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.actionHit,
          canTick && (pressed || hovered) && { backgroundColor: colors.steel },
        ]}
      >
        <Ionicons
          name={done ? 'checkbox' : 'square-outline'}
          size={24}
          color={done ? colors.ok : canTick ? colors.boneDim : colors.boneMute}
        />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[type.name, done && styles.struck]}>{item.title}</Text>
          {meta ? <Text style={[styles.metaTime, late && { color: colors.warn }]}>{meta}</Text> : null}
        </View>
        {late ? <Chip label="Late" tone="warn" /> : null}
      </Pressable>
      {error ? <Small style={{ color: colors.danger, paddingHorizontal: space.md }}>{error}</Small> : null}
    </View>
  );
}

function ListCard<T>({ items, render }: { items: T[]; render: (item: T, last: boolean) => React.ReactNode }) {
  return <Card style={{ padding: 0, gap: 0 }}>{items.map((x, i) => render(x, i === items.length - 1))}</Card>;
}

// ---------------------------------------------------------------------------
// Meetings and votes
// ---------------------------------------------------------------------------

export function BusinessScreen({ navigation }: RootScreen<'Business'>) {
  const { me, data, isDemo, refresh } = useClub();
  if (!me) return null;
  const b = businessFor(me, data, nowIso());
  const openVote = (v: Vote) => navigation.navigate('Vote', { voteId: v.id });
  const openMeeting = (m: Meeting) => navigation.navigate('Meeting', { meetingId: m.id });
  const nothing =
    b.needsMe.length + b.openVotes.length + b.myActions.length + b.otherActions.length + b.upcoming.length + b.past.length + b.closedVotes.length === 0;

  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      {b.runsAny ? (
        <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
          <Button label="Meeting" icon="add" kind="secondary" style={{ flex: 1 }} onPress={() => navigation.navigate('EditMeeting', {})} />
          <Button label="Vote" icon="add" kind="secondary" style={{ flex: 1 }} onPress={() => navigation.navigate('NewVote', {})} />
        </Row>
      ) : null}

      {nothing ? (
        <Notice title="Nothing on right now.">
          {b.runsAny
            ? 'Call a meeting or open a vote above. Members see the ones that concern them.'
            : 'Votes you’re on, members’ meetings and anything the board asks of you show up here.'}
        </Notice>
      ) : null}

      {b.needsMe.length ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Your vote" action={<Text style={styles.count}>{b.needsMe.length}</Text>} />
          <ListCard items={b.needsMe} render={(v, last) => <VoteRow key={v.id} vote={v} needsMe last={last} onPress={() => openVote(v)} />} />
        </Stack>
      ) : null}

      {b.openVotes.length ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Open votes" />
          <ListCard items={b.openVotes} render={(v, last) => <VoteRow key={v.id} vote={v} needsMe={false} last={last} onPress={() => openVote(v)} />} />
        </Stack>
      ) : null}

      {b.myActions.length ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Your action items" />
          <ListCard items={b.myActions} render={(a, last) => <ActionRow key={a.id} item={a} last={last} showOwner={false} />} />
        </Stack>
      ) : null}

      {b.otherActions.length ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Action items" action={<Text style={styles.count}>{b.otherActions.length}</Text>} />
          <ListCard items={b.otherActions} render={(a, last) => <ActionRow key={a.id} item={a} last={last} showOwner />} />
        </Stack>
      ) : null}

      {b.upcoming.length ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Coming up" />
          <ListCard items={b.upcoming} render={(m, last) => <MeetingRow key={m.id} meeting={m} last={last} onPress={() => openMeeting(m)} />} />
        </Stack>
      ) : null}

      {b.past.length ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Past meetings" />
          <ListCard items={b.past} render={(p, last) => <MeetingRow key={p.meeting.id} meeting={p.meeting} last={last} onPress={() => openMeeting(p.meeting)} />} />
        </Stack>
      ) : null}

      {b.closedVotes.length ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Closed votes" />
          <ListCard items={b.closedVotes} render={(v, last) => <VoteRow key={v.id} vote={v} needsMe={false} last={last} onPress={() => openVote(v)} />} />
        </Stack>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One meeting
// ---------------------------------------------------------------------------

function Fact({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  return (
    <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
      <Ionicons name={icon} size={18} color={colors.boneMute} />
      <Text style={styles.factText}>{text}</Text>
    </Row>
  );
}

export function MeetingScreen({ route, navigation }: RootScreen<'Meeting'>) {
  const { me, data, saveMinutes, shareMinutes, approveMinutes, cancelMeeting } = useClub();
  const meeting = (data.meetings ?? []).find((m) => m.id === route.params.meetingId);
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const minutesAction = useAction();
  const cancelAction = useAction();
  if (!meeting || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Meeting not found">It may have been removed, or it’s for the board only.</Notice>
      </Screen>
    );
  }
  const now = nowIso();
  const runs = runsScope(me, meeting.chapterId, data.positions);
  const state = minutesState(meeting, now);
  const started = new Date(meeting.startsAt).getTime() <= new Date(now).getTime();
  const cancelled = !!meeting.cancelledAt;
  const editingMinutes = runs && !cancelled && !meeting.minutesApprovedAt;
  const text = draft ?? meeting.minutes ?? '';
  const items = (data.actionItems ?? []).filter((a) => a.meetingId === meeting.id);
  const votes = (data.votes ?? []).filter((v) => v.meetingId === meeting.id);

  const save = () =>
    minutesAction.run(async () => {
      await saveMinutes(meeting.id, text);
      setDraft(null);
      setSaved(true);
    });
  const approve = () =>
    minutesAction.run(async () => {
      // Save what's on screen first, so what gets approved is what was read.
      if (draft !== null && draft !== (meeting.minutes ?? '')) await saveMinutes(meeting.id, draft);
      await approveMinutes(meeting.id);
      setDraft(null);
    });
  const share = () =>
    minutesAction.run(async () => {
      // Save what's on screen first, so members get what the board read.
      if (draft !== null && draft !== (meeting.minutes ?? '')) await saveMinutes(meeting.id, draft);
      await shareMinutes(meeting.id);
      setDraft(null);
    });
  const approveBlock = approveMinutesProblem(me, { ...meeting, minutes: text }, data, now);
  const shared = meeting.minutesSharedAt ?? null;

  return (
    <Screen>
      <Card>
        <Row style={{ gap: 6 }}>
          <Chip label={meetingKindLabel(meeting.kind, meeting.chapterId)} tone="bone" />
          <Chip label={scopeLabel(meeting.chapterId, data)} tone="steel" />
          {cancelled ? <Chip label="Cancelled" tone="danger" /> : null}
        </Row>
        <H1 style={cancelled ? styles.struck : undefined}>{meeting.title}</H1>
        <Stack gap={space.sm}>
          <Fact icon="calendar-outline" text={`${weekday(melbourneDate(meeting.startsAt))} ${formatAuDate(melbourneDate(meeting.startsAt))}`} />
          <Fact icon="time-outline" text={melbourneTime(meeting.startsAt)} />
          {meeting.location ? <Fact icon="location-outline" text={meeting.location} /> : null}
        </Stack>
        {runs && !cancelled ? (
          <Button label="Edit meeting" icon="create-outline" kind="secondary" onPress={() => navigation.navigate('EditMeeting', { meetingId: meeting.id })} />
        ) : null}
      </Card>

      <Stack gap={space.sm}>
        <SectionTitle title="Agenda" />
        <Card style={{ gap: 0, padding: 0 }}>
          {meeting.agenda.length === 0 ? (
            <View style={{ padding: space.lg }}>
              <Small>No agenda yet.</Small>
            </View>
          ) : (
            meeting.agenda.map((a, i) => (
              <View key={i} style={[styles.agendaRow, i === meeting.agenda.length - 1 && { borderBottomWidth: 0 }]}>
                <Text style={styles.agendaNumber}>{i + 1}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={type.name}>{a.title}</Text>
                  {a.notes ? <Small>{a.notes}</Small> : null}
                </View>
              </View>
            ))
          )}
        </Card>
      </Stack>

      <Stack gap={space.sm}>
        <SectionTitle
          title="Minutes"
          action={MINUTES_CHIP[state] && state !== 'cancelled' && (runs || state === 'approved' || state === 'draft') ? <Chip label={MINUTES_CHIP[state]!.label} tone={MINUTES_CHIP[state]!.tone} /> : undefined}
        />
        {editingMinutes ? (
          <Card>
            <Field
              label={started ? 'Draft minutes' : 'Notes for the minutes'}
              value={text}
              onChangeText={(t) => {
                setDraft(t);
                setSaved(false);
              }}
              multiline
              placeholder="Who was there, what was decided, who’s doing what."
              style={{ minHeight: 180 }}
            />
            {state === 'due' || state === 'overdue' ? (
              <Small>{`Share the draft with members by ${formatAuDate(minutesDueOn(meeting))}, a week after the meeting (10.8).`}</Small>
            ) : shared ? (
              <Small>{`Shared with members ${formatAuDate(melbourneDate(shared))}. They see saved changes. Confirm the minutes at the next meeting (10.8).`}</Small>
            ) : null}
            {saved && draft === null ? <Small style={{ color: colors.ok }}>Saved.</Small> : null}
            <ErrorNotice error={minutesAction.error} />
            <Button label="Save draft" kind="secondary" busy={minutesAction.busy} disabled={draft === null} onPress={save} />
            {started ? (
              approveBlock ? (
                <Small>{approveBlock === 'Write the minutes first.' ? 'Write the minutes, then share the draft and confirm them here.' : approveBlock}</Small>
              ) : (
                <>
                  {shared ? null : (
                    <ConfirmButton label="Share draft with members" confirmLabel="Send it to members" kind="secondary" icon="send" onConfirm={share} />
                  )}
                  <ConfirmButton label="Confirm minutes" confirmLabel="Confirm and lock" kind="primary" icon="checkmark" onConfirm={approve} />
                </>
              )
            ) : (
              <Small>Notes saved here stay with the board. After the meeting, share the draft with members, then confirm the minutes at the next meeting (10.8).</Small>
            )}
          </Card>
        ) : canSeeMinutes(me, meeting, data.positions) && meeting.minutes ? (
          <Card>
            <Body selectable>{meeting.minutes}</Body>
            {meeting.minutesApprovedAt ? (
              <Small>{`Confirmed ${formatAuDate(melbourneDate(meeting.minutesApprovedAt))} by ${memberName(meeting.minutesApprovedBy, data)}`}</Small>
            ) : (
              <Small>Draft. The board confirms the minutes at the next meeting (10.8).</Small>
            )}
          </Card>
        ) : (
          <Card>
            <Small>{cancelled ? 'This meeting was cancelled.' : 'The board shares the draft minutes here after the meeting.'}</Small>
          </Card>
        )}
      </Stack>

      {items.length || (runs && !cancelled) ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Action items" />
          {items.length ? <ListCard items={items} render={(a, last) => <ActionRow key={a.id} item={a} last={last} showOwner />} /> : null}
          {runs && !cancelled ? <AddActionItem chapterId={meeting.chapterId} meetingId={meeting.id} /> : null}
        </Stack>
      ) : null}

      {votes.length || (runs && !cancelled) ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Votes" />
          {votes.length ? (
            <ListCard
              items={votes}
              render={(v, last) => (
                <VoteRow key={v.id} vote={v} needsMe={castProblem(me, v, now) === null} last={last} onPress={() => navigation.navigate('Vote', { voteId: v.id })} />
              )}
            />
          ) : null}
          {runs && !cancelled ? (
            <Button
              label="New vote for this meeting"
              icon="hand-left"
              kind="secondary"
              onPress={() => navigation.navigate('NewVote', { chapterId: meeting.chapterId, meetingId: meeting.id })}
            />
          ) : null}
        </Stack>
      ) : null}

      {runs && !cancelled && !started ? (
        <Stack gap={space.sm}>
          <ErrorNotice error={cancelAction.error} />
          <ConfirmButton
            label="Cancel meeting"
            confirmLabel="Yes, cancel it"
            kind="quiet"
            onConfirm={() => cancelAction.run(() => cancelMeeting(meeting.id))}
          />
        </Stack>
      ) : null}
    </Screen>
  );
}

function AddActionItem({ chapterId, meetingId }: { chapterId: string | null; meetingId: string | null }) {
  const { data, saveActionItem } = useClub();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const action = useAction();
  const owners = data.members
    .filter((m) => canOwnAction(m, chapterId))
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const dueIso = due.trim() ? parseAuDate(due) : null;
  const dueError = due.trim() && !dueIso ? 'Use DD/MM/YYYY, like 20/11/2026.' : null;

  if (!open) return <Button label="Add action item" icon="add" kind="secondary" onPress={() => setOpen(true)} />;
  return (
    <Card>
      <Field label="What needs doing" value={title} onChangeText={setTitle} placeholder="Book the hall" />
      <Choices<string>
        label="Who’s doing it"
        options={owners.map((m) => ({ value: m.id, label: displayName(m) }))}
        value={owner}
        onChange={setOwner}
      />
      <Field
        label="Due (optional)"
        value={due}
        onChangeText={(t) => setDue(typeDate(t))}
        placeholder="DD/MM/YYYY"
        keyboardType="number-pad"
        error={dueError}
      />
      <ErrorNotice error={action.error} />
      <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
        <Button
          label="Add"
          busy={action.busy}
          disabled={!title.trim() || !owner || !!dueError}
          style={{ flex: 1 }}
          onPress={() =>
            action.run(async () => {
              await saveActionItem({ id: null, chapterId, meetingId, title, ownerId: owner!, dueOn: dueIso });
              setTitle('');
              setOwner(null);
              setDue('');
              setOpen(false);
            })
          }
        />
        <Button label="Cancel" kind="quiet" onPress={() => setOpen(false)} />
      </Row>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Call or change a meeting
// ---------------------------------------------------------------------------

export function EditMeetingScreen({ route, navigation }: RootScreen<'EditMeeting'>) {
  const { me, data, saveMeeting } = useClub();
  const existing = route.params?.meetingId ? (data.meetings ?? []).find((m) => m.id === route.params?.meetingId) : undefined;
  const scopes = scopesRun(me, data);
  const [scope, setScope] = useState<string | null>(
    existing ? existing.chapterId : route.params?.chapterId !== undefined ? route.params.chapterId : scopes[0] ?? null,
  );
  const [kind, setKind] = useState<MeetingKind>(existing?.kind ?? (scope === null ? 'nec' : 'board'));
  const [title, setTitle] = useState(existing?.title ?? '');
  const [date, setDate] = useState(existing ? formatAuDate(melbourneDate(existing.startsAt)) : '');
  const [time, setTime] = useState(existing ? melbourneHhmm(existing.startsAt) : '19:30');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [agenda, setAgenda] = useState<AgendaItem[]>(existing?.agenda ?? []);
  const action = useAction();
  if (!me) return null;

  const dateIso = date.trim() ? parseAuDate(date) : null;
  const hhmm = parseTime(time);
  const startsAt = dateIso && hhmm ? melbourneInstant(dateIso, hhmm) : null;
  const dateError = date.trim() && !dateIso ? 'Use DD/MM/YYYY, like 04/11/2026.' : null;
  const timeError = time.trim() && !hhmm ? 'Like 7:30 pm or 19:30.' : dateIso && hhmm && !startsAt ? 'That time doesn’t exist: the clocks go forward then.' : null;
  const kinds = kindsFor(scope);
  const noticeWarn = startsAt ? noticeWarning({ id: existing?.id ?? null, chapterId: scope, kind, title, startsAt, location, agenda }, new Date().toISOString(), existing ?? null) : null;
  const noticeNote = noticeWarn ?? noticeLine(kind, scope);
  const pickScope = (s: string) => {
    const next = s === 'club' ? null : s;
    setScope(next);
    if (!kindsFor(next).includes(kind)) setKind(next === null ? 'nec' : 'board');
  };
  const setItem = (i: number, patch: Partial<AgendaItem>) => setAgenda(agenda.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const move = (i: number, by: number) => {
    const next = [...agenda];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setAgenda(next);
  };

  const save = () =>
    action.run(async () => {
      if (!startsAt) throw new Error(dateError ?? timeError ?? 'Pick a date and time.');
      const id = await saveMeeting({ id: existing?.id ?? null, chapterId: scope, kind, title, startsAt, location: location || null, agenda });
      if (existing) navigation.goBack();
      else navigation.replace('Meeting', { meetingId: id });
    });

  return (
    <Screen>
      {!existing && scopes.length > 1 ? (
        <Choices<string>
          label="For"
          options={scopes.map((s) => ({ value: s ?? 'club', label: scopeLabel(s, data) }))}
          value={scope ?? 'club'}
          onChange={pickScope}
        />
      ) : null}
      <Choices<MeetingKind> label="Kind of meeting" options={kinds.map((k) => ({ value: k, label: meetingKindLabel(k, scope) }))} value={kind} onChange={setKind} />
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="November board meeting" />
      <Row style={{ gap: space.md, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <View style={{ flex: 3 }}>
          <Field label="Date" value={date} onChangeText={(t) => setDate(typeDate(t))} placeholder="DD/MM/YYYY" keyboardType="number-pad" error={dateError} />
        </View>
        <View style={{ flex: 2 }}>
          <Field label="Time" value={time} onChangeText={setTime} placeholder="7:30 pm" error={timeError} />
        </View>
      </Row>
      {noticeNote ? <Small style={noticeWarn ? { color: colors.warn } : undefined}>{noticeNote}</Small> : null}
      <Field label="Place (optional)" value={location} onChangeText={setLocation} placeholder="Clubhouse, or Video call" />

      <Stack gap={space.sm}>
        <SectionTitle title="Agenda" action={<Text style={styles.count}>{agenda.length}</Text>} />
        {agenda.map((a, i) => (
          <Card key={i} style={{ gap: space.sm }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.agendaNumber}>{i + 1}</Text>
              <Row style={{ gap: 0 }}>
                <IconButton icon="arrow-up" label={`Move item ${i + 1} up`} disabled={i === 0} onPress={() => move(i, -1)} />
                <IconButton icon="arrow-down" label={`Move item ${i + 1} down`} disabled={i === agenda.length - 1} onPress={() => move(i, 1)} />
                <IconButton icon="trash-outline" label={`Remove item ${i + 1}`} onPress={() => setAgenda(agenda.filter((_, j) => j !== i))} />
              </Row>
            </Row>
            <Field label="Item" value={a.title} onChangeText={(t) => setItem(i, { title: t })} placeholder="Treasurer’s report" />
            <Field label="Notes (optional)" value={a.notes ?? ''} onChangeText={(t) => setItem(i, { notes: t })} />
          </Card>
        ))}
        <Button label="Add agenda item" icon="add" kind="secondary" onPress={() => setAgenda([...agenda, { title: '', notes: null }])} />
      </Stack>

      <ErrorNotice error={action.error} />
      <Button label={existing ? 'Save changes' : 'Call meeting'} icon="checkmark" busy={action.busy} onPress={save} />
    </Screen>
  );
}

function IconButton({ icon, label, onPress, disabled }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.iconButton,
        !disabled && (pressed || hovered) && { backgroundColor: colors.steel },
        disabled && { opacity: 0.35 },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.boneDim} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// One vote
// ---------------------------------------------------------------------------

const CHOICES: BallotChoice[] = ['yes', 'no', 'abstain'];
const CHOICE_ICON = { yes: 'thumbs-up', no: 'thumbs-down', abstain: 'remove-circle' } as const;

export function VoteScreen({ route, navigation }: RootScreen<'Vote'>) {
  const { me, data, castBallot, closeVote } = useClub();
  const vote = (data.votes ?? []).find((v) => v.id === route.params.voteId);
  const [choice, setChoice] = useState<BallotChoice | null>(null);
  const [casting, setCasting] = useState<'yes' | 'no' | null>(null);
  const ballot = useAction();
  const closing = useAction();
  if (!vote || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Vote not found">It may be for someone else’s chapter or the board only.</Notice>
      </Screen>
    );
  }
  const now = nowIso();
  const closed = vote.closedAt !== null;
  const runs = runsScope(me, vote.chapterId, data.positions);
  const iVoted = vote.votedIds.includes(me.id);
  const castBlock = castProblem(me, vote, now);
  const pastTime = new Date(vote.closesAt).getTime() <= new Date(now).getTime();
  const everyone = vote.votedIds.length === vote.electorIds.length;
  const isChair = chairOf(vote.chapterId, data.positions) === me.id;
  const tied = closing.error === TIE;
  const subject = vote.subjectMemberId ? data.members.find((m) => m.id === vote.subjectMemberId) : undefined;
  const share = vote.electorIds.length ? vote.votedIds.length / vote.electorIds.length : 0;

  return (
    <Screen>
      <Card>
        <Row style={{ gap: 6 }}>
          <Chip label={scopeLabel(vote.chapterId, data)} tone="steel" />
          {subject ? (
            <Chip label={vote.electorate !== 'nec' ? 'Patch vote' : vote.threshold === 'two_thirds' ? 'Auditor vote' : 'NEC vote'} tone="redOutline" />
          ) : null}
          {vote.secret ? <Chip label="Secret ballot" tone="bone" icon="lock-closed" /> : null}
        </Row>
        <H1>{vote.question}</H1>
        {vote.details ? <Body selectable>{vote.details}</Body> : null}
        <Stack gap={space.sm}>
          <Fact icon="people-outline" text={ELECTORATE_LABEL[vote.electorate]} />
          <Fact icon="podium-outline" text={ruleLine(vote)} />
          <Fact icon="time-outline" text={closed ? `Closed ${when(vote.closedAt!)}` : `Closes ${when(vote.closesAt)}`} />
        </Stack>
      </Card>

      {closed ? (
        <Card style={{ alignItems: 'stretch' }}>
          <View style={[styles.stamp, vote.result === 'carried' ? styles.stampCarried : styles.stampLost]}>
            <Text style={[styles.stampText, { color: vote.result === 'carried' ? colors.ok : colors.boneDim }]}>{RESULT_LABEL[vote.result!]}</Text>
          </View>
          {vote.tally ? (
            <Stack gap={2}>
              <KeyValue label="Yes" value={String(vote.tally.yes)} />
              <KeyValue label="No" value={String(vote.tally.no)} />
              <KeyValue label="Abstain" value={String(vote.tally.abstain)} />
            </Stack>
          ) : null}
          {vote.castingVote ? (
            <Small>{`Tied, so the chair gave the casting vote: ${BALLOT_LABEL[vote.castingVote]}.`}</Small>
          ) : vote.result === 'lost' && vote.threshold === 'majority' && vote.tally && vote.tally.yes > 0 && vote.tally.yes === vote.tally.no ? (
            <Small>Tied with no casting vote, so it’s lost (9.10).</Small>
          ) : null}
          {vote.result === 'no_quorum' ? <Small>{`Fewer than ${vote.quorum} ballots came in, so the vote doesn’t count.`}</Small> : null}
          {subject && vote.result === 'carried' && runs && (vote.electorate !== 'nec' || REINSTATABLE.includes(subject.status) || vote.threshold === 'two_thirds') ? (
            <Button
              label={
                vote.electorate !== 'nec'
                  ? `Record ${displayName(subject)}’s patch`
                  : vote.threshold === 'two_thirds' ? `${auditorSeat(data)?.memberId === subject.id ? 'Renew' : 'Appoint'} ${displayName(subject)} as Auditor` : `Bring ${displayName(subject)} back`
              }
              kind="secondary"
              onPress={() => navigation.navigate('ManageMember', { memberId: subject.id })}
            />
          ) : null}
        </Card>
      ) : (
        <Stack gap={space.sm}>
          <SectionTitle title="Ballots in" action={<Text style={styles.count}>{`${vote.votedIds.length} of ${vote.electorIds.length}`}</Text>} />
          <View style={styles.bar} accessibilityLabel={`${vote.votedIds.length} of ${vote.electorIds.length} have voted`}>
            <View style={[styles.barFill, { width: `${share * 100}%` }]} />
          </View>
          <Small>
            {vote.threshold === 'unanimous'
              ? `Every one of the ${vote.electorIds.length} has to vote yes. ${vote.subjectMemberId ? 'Only the result is kept.' : 'The count stays sealed until the vote closes.'}`
              : `${vote.quorum} needed for the result to count. The count stays sealed until the vote closes.`}
          </Small>
        </Stack>
      )}

      {!closed && vote.electorIds.includes(me.id) ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Your vote" />
          {iVoted ? (
            <Notice tone="ok" title="You’ve voted.">
              {vote.secret ? 'It’s a secret ballot: nobody can see which way you went.' : 'Everyone on the vote sees who voted which way once it closes.'}
            </Notice>
          ) : castBlock ? (
            <Notice>{castBlock}</Notice>
          ) : (
            <>
              <View style={styles.answers}>
                {CHOICES.map((c) => {
                  const selected = choice === c;
                  return (
                    <Pressable
                      key={c}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      aria-checked={selected}
                      accessibilityLabel={BALLOT_LABEL[c]}
                      onPress={() => setChoice(c)}
                      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                        styles.answer,
                        selected && styles.answerSelected,
                        !selected && (pressed || hovered) && { backgroundColor: colors.steelHi },
                      ]}
                    >
                      <Ionicons name={selected ? CHOICE_ICON[c] : (`${CHOICE_ICON[c]}-outline` as never)} size={22} color={selected ? colors.bone : colors.boneDim} />
                      <Text style={[styles.answerText, selected && { color: colors.bone }]}>{BALLOT_LABEL[c]}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {choice ? (
                <ConfirmButton
                  label="Cast my vote"
                  confirmLabel={`${BALLOT_LABEL[choice]}: it’s final`}
                  kind="secondary"
                  onConfirm={() => ballot.run(() => castBallot(vote.id, choice))}
                />
              ) : (
                <Small>Pick one. Your ballot is final once it’s cast.</Small>
              )}
              <ErrorNotice error={ballot.error} />
            </>
          )}
        </Stack>
      ) : null}

      {!closed && runs ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Close the vote" />
          {!pastTime && !everyone ? (
            <Small>{`It can be closed once it’s past closing time, or as soon as everyone has voted.`}</Small>
          ) : tied && isChair ? (
            <Card>
              <Body>It’s a tie. As chair, you can give the casting vote, or let it fall and it’s lost (9.10).</Body>
              <Choices<'yes' | 'no'> options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} value={casting} onChange={setCasting} />
              <ConfirmButton
                label="Close with casting vote"
                confirmLabel={casting ? `${BALLOT_LABEL[casting]}: close it` : 'Pick yes or no'}
                kind="secondary"
                onConfirm={() => casting && closing.run(() => closeVote(vote.id, casting))}
              />
              <ConfirmButton
                label="Let it fall"
                confirmLabel="Close it as lost"
                kind="secondary"
                onConfirm={() => closing.run(() => closeVote(vote.id, 'decline'))}
              />
            </Card>
          ) : (
            <>
              <ErrorNotice error={tied ? 'It’s a tie, so only the chair can close it. Ask them to.' : closing.error} />
              <ConfirmButton label="Close vote and count" confirmLabel="Close it now" kind="secondary" onConfirm={() => closing.run(() => closeVote(vote.id, null))} />
            </>
          )}
        </Stack>
      ) : null}

      {closed && !vote.secret && vote.ballots.length ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Who voted which way" />
          <ListCard
            items={[...vote.ballots].sort((a, b) => memberName(a.memberId, data).localeCompare(memberName(b.memberId, data)))}
            render={(b, last) => {
              const m = data.members.find((x) => x.id === b.memberId);
              return (
                <ListRow
                  key={b.memberId ?? `secret-${b.choice}`}
                  last={last}
                  left={<Avatar text={m ? initials(m) : '?'} size={40} />}
                  title={memberName(b.memberId, data)}
                  right={<Chip label={BALLOT_LABEL[b.choice]} tone={b.choice === 'yes' ? 'ok' : b.choice === 'no' ? 'danger' : 'steel'} />}
                />
              );
            }}
          />
        </Stack>
      ) : null}

      {/* On a patch vote a missing ballot counts against, so naming who's left would point at them. */}
      {!closed && vote.subjectMemberId === null && (runs || vote.electorIds.includes(me.id)) ? <StillToVote vote={vote} /> : null}
    </Screen>
  );
}

function StillToVote({ vote }: { vote: Vote }) {
  const { data } = useClub();
  const waiting = vote.electorIds.filter((id) => !vote.votedIds.includes(id));
  if (!waiting.length) return null;
  return (
    <Stack gap={space.sm}>
      <SectionTitle title="Still to vote" action={<Text style={styles.count}>{waiting.length}</Text>} />
      <Small>{waiting.map((id) => memberName(id, data)).sort((a, b) => a.localeCompare(b)).join(', ')}</Small>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Open a vote
// ---------------------------------------------------------------------------

const THRESHOLDS: Threshold[] = ['majority', 'two_thirds', 'unanimous'];

/** How the default quorum is worked out, for the hint under the field. */
const QUORUM_RULE: Record<Electorate, string> = {
  chapter_board: 'more than half the board, and at least three (8.5)',
  chapter_patched: 'a third, rounded up (10.6)',
  club_patched: 'a third, rounded up (10.6)',
  nec: '51%, rounded up (11.5)',
};

/** A week from today, at 7 pm Melbourne time. */
function defaultClose(): { date: string; time: string } {
  const week = new Date(Date.now() + 7 * 86_400_000).toISOString();
  return { date: formatAuDate(melbourneDate(week)), time: '19:00' };
}

export function NewVoteScreen({ route, navigation }: RootScreen<'NewVote'>) {
  const { me, data, openVote } = useClub();
  const params = route.params ?? {};
  const scopes = scopesRun(me, data);
  const subject = params.subjectMemberId ? data.members.find((m) => m.id === params.subjectMemberId) : undefined;
  // A vote about a member: the chapter's patch vote on an FNG (4.9), the NEC's on bringing someone back (5.6),
  // or the NEC's two-thirds vote on a Full Member as National Auditor (11.8).
  const auditor = !!subject && subject.status === 'full';
  const renewing = auditor && auditorSeat(data)?.memberId === subject.id;
  const reinstate = !!subject && subject.status !== 'fng' && !auditor;
  const national = reinstate || auditor;
  const fixedScope = params.chapterId !== undefined || !!subject;
  const [scope, setScope] = useState<string | null>(
    national ? null : subject ? subject.chapterId : params.chapterId !== undefined ? params.chapterId : scopes[0] ?? null,
  );
  const [electorate, setElectorate] = useState<Electorate>(national ? 'nec' : subject ? 'chapter_patched' : electoratesFor(scope)[0]);
  const [threshold, setThreshold] = useState<Threshold>(auditor ? 'two_thirds' : subject && !reinstate ? 'unanimous' : 'majority');
  const [question, setQuestion] = useState(
    auditor
      ? renewing
        ? `Keep ${displayName(subject)} on as National Auditor for another twelve months?`
        : `Appoint ${displayName(subject)} as National Auditor for twelve months?`
      : reinstate ? `Bring ${displayName(subject)} back to Full or Nomad?` : subject ? `Patch ${displayName(subject)} as a Full member?` : '',
  );
  const [details, setDetails] = useState('');
  const [secret, setSecret] = useState(!!subject && !national);
  const size = electorsFor(electorate, scope, data).length;
  const [quorumText, setQuorumText] = useState<string | null>(null);
  const close = defaultClose();
  const [date, setDate] = useState(close.date);
  const [time, setTime] = useState(close.time);
  const action = useAction();
  if (!me) return null;

  const quorum = quorumText === null ? defaultQuorum(electorate, size) : Number(quorumText);
  const dateIso = date.trim() ? parseAuDate(date) : null;
  const hhmm = parseTime(time);
  const closesAt = dateIso && hhmm ? melbourneInstant(dateIso, hhmm) : null;
  const pickScope = (s: string) => {
    const next = s === 'club' ? null : s;
    setScope(next);
    setElectorate(electoratesFor(next)[0]);
    setQuorumText(null);
  };

  const submit = () =>
    action.run(async () => {
      if (!closesAt) throw new Error('Pick a closing time in the future.');
      const id = await openVote({
        chapterId: scope,
        meetingId: params.meetingId ?? null,
        subjectMemberId: subject?.id ?? null,
        question,
        details: details || null,
        electorate,
        threshold,
        secret,
        quorum,
        closesAt,
      });
      navigation.replace('Vote', { voteId: id });
    });

  return (
    <Screen>
      {!fixedScope && scopes.length > 1 ? (
        <Choices<string>
          label="For"
          options={scopes.map((s) => ({ value: s ?? 'club', label: scopeLabel(s, data) }))}
          value={scope ?? 'club'}
          onChange={pickScope}
        />
      ) : null}
      {auditor ? (
        <Notice title="NEC vote, two-thirds">
          {`Each chapter’s President votes for their chapter (11.2), and it needs at least two yes for every no. If it carries, the National Chairman can ${renewing ? 'renew' : 'appoint'} ${displayName(subject!)} ${renewing ? 'for another twelve months' : 'National Auditor'} within 90 days (11.8).`}
        </Notice>
      ) : reinstate ? (
        <Notice title="NEC vote">
          {`Each chapter’s President votes for their chapter (11.2), and it passes on a majority. If it carries, the NEC can bring ${displayName(subject!)} back to Full or Nomad within 90 days (5.6).`}
        </Notice>
      ) : subject ? (
        <Notice title="Patch vote">
          {`Every Full Member of the ${scopeLabel(scope, data)} gets a secret ballot, and every one of them has to vote yes (4.9). Only the result is shown.`}
        </Notice>
      ) : null}
      <Field label="Question" value={question} onChangeText={setQuestion} placeholder="Spend up to $600 on a club gazebo?" />
      <Field label="Details (optional)" value={details} onChangeText={setDetails} multiline placeholder="What members need to know before voting." />
      {!subject ? (
        <>
          <Choices<Electorate>
            label="Who votes"
            options={electoratesFor(scope).map((e) => ({ value: e, label: `${ELECTORATE_LABEL[e]} (${electorsFor(e, scope, data).length})` }))}
            value={electorate}
            onChange={(e) => {
              setElectorate(e);
              setQuorumText(null);
            }}
          />
          <Choices<Threshold> label="To pass" options={THRESHOLDS.map((t) => ({ value: t, label: THRESHOLD_LABEL[t] }))} value={threshold} onChange={setThreshold} />
          <Small>
            {threshold === 'majority'
              ? 'More yes than no. Abstaining counts towards quorum only. A tie goes to the chair, who can cast a deciding vote or let it fall.'
              : threshold === 'two_thirds'
                ? 'At least two yes for every one no.'
                : 'Every voter has to vote yes. An abstention or a missing ballot stops it.'}
          </Small>
          <Toggle label="Secret ballot" description="Nobody, the board included, sees who voted which way." value={secret} onChange={setSecret} />
        </>
      ) : national ? (
        <Toggle label="Secret ballot" description="Nobody, the NEC included, sees which way each President voted." value={secret} onChange={setSecret} />
      ) : null}
      {/* A patch vote needs every ballot anyway, so its quorum stays at the least allowed. */}
      {electorate === 'chapter_board' && size < 3 ? (
        <Small>{`This board has ${size} ${size === 1 ? 'member' : 'members'}. A board vote needs at least three (8.5).`}</Small>
      ) : !subject ? (
        <Field
          label="Quorum"
          value={quorumText ?? String(defaultQuorum(electorate, size))}
          onChangeText={(t) => setQuorumText(t.replace(/\D/g, ''))}
          keyboardType="number-pad"
          hint={`Ballots needed for the result to count, out of ${size}. At least ${defaultQuorum(electorate, size)}: ${QUORUM_RULE[electorate]}.`}
        />
      ) : null}
      <Row style={{ gap: space.md, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <View style={{ flex: 3 }}>
          <Field
            label="Closes on"
            value={date}
            onChangeText={(t) => setDate(typeDate(t))}
            placeholder="DD/MM/YYYY"
            keyboardType="number-pad"
            error={date.trim() && !dateIso ? 'Use DD/MM/YYYY.' : null}
          />
        </View>
        <View style={{ flex: 2 }}>
          <Field label="At" value={time} onChangeText={setTime} placeholder="7 pm" error={time.trim() && !hhmm ? 'Like 7 pm or 19:00.' : null} />
        </View>
      </Row>
      <ErrorNotice error={action.error} />
      <Button label="Open vote" icon="hand-left" busy={action.busy} onPress={submit} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    minHeight: 44,
  },
  dateBlock: {
    width: 52,
    paddingVertical: 6,
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.steel,
    borderRadius: radius.sm,
  },
  dateDay: { fontFamily: fonts.stencil, fontSize: 24, lineHeight: 28, color: colors.bone, fontVariant: ['tabular-nums'] },
  dateWeekday: { fontFamily: fonts.stencil, fontSize: 12, letterSpacing: 1, color: colors.boneDim, textTransform: 'uppercase' },
  metaTime: { fontFamily: fonts.stencil, fontSize: 13, letterSpacing: 0.3, color: colors.boneDim },
  struck: { textDecorationLine: 'line-through', color: colors.boneMute },
  faded: { opacity: 0.55 },
  count: { fontFamily: fonts.stencil, fontSize: 16, color: colors.boneMute },
  voteBadge: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.steel, alignItems: 'center', justifyContent: 'center' },
  voteBadgeOn: { backgroundColor: colors.red },
  actionRow: { borderBottomWidth: 1, borderBottomColor: colors.line },
  actionHit: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 52 },
  factText: { fontFamily: fonts.stencil, fontSize: 16, lineHeight: 22, letterSpacing: 0.4, color: colors.boneDim, flexShrink: 1 },
  agendaRow: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  agendaNumber: { fontFamily: fonts.stencil, fontSize: 20, lineHeight: 22, color: colors.redText, minWidth: 22, fontVariant: ['tabular-nums'] },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  bar: { height: 8, backgroundColor: colors.steel, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.bone },
  stamp: {
    alignSelf: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderWidth: 3,
    borderRadius: radius.sm,
    transform: [{ rotate: '-3deg' }],
  },
  stampCarried: { borderColor: colors.ok },
  stampLost: { borderColor: colors.boneMute },
  stampText: { fontFamily: fonts.stencil, fontSize: 34, letterSpacing: 3, textTransform: 'uppercase' },
  answers: { flexDirection: 'row', gap: space.sm },
  answer: {
    flex: 1,
    minHeight: 72,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.steel,
  },
  answerSelected: { backgroundColor: colors.red, borderColor: colors.redBright },
  answerText: { fontFamily: fonts.stencil, fontSize: 14, lineHeight: 18, color: colors.boneDim, textAlign: 'center' },
});
