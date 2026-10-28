// Stage 7: the club's history and hall of fame. The timeline and the honours are kept by the board;
// founders and past office holders come from the positions, so nobody types them twice.

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { useSocial } from '../data/social/SocialProvider';
import { formatAuDate, parseAuDate, typeDate } from '../domain/dates';
import { ROLE_LABEL } from '../domain/labels';
import { displayName } from '../domain/profile';
import {
  canKeepHistory,
  founders,
  HISTORY_PRECISIONS,
  historyDateLabel,
  historyProblem,
  honourProblem,
  honoursFor,
  MAX_HISTORY_STORY,
  MAX_HISTORY_TITLE,
  MAX_HONOUR,
  MAX_HONOUR_NAME,
  MAX_HONOUR_NOTE,
  pastOfficeHolders,
  timeline,
  yearsLabel,
  type HistoryEntry,
  type HistoryPrecision,
  type Honour,
  type TimelineEntry,
} from '../domain/social/history';
import type { ClubData, Member } from '../domain/types';
import type { RootParams, RootScreen } from '../navigation/types';
import { colors, radius, space, type } from '../theme';
import {
  Body,
  Button,
  Card,
  Choices,
  ConfirmButton,
  Field,
  H1,
  IconBadge,
  Ionicons,
  ListRow,
  Notice,
  Screen,
  SectionTitle,
  Small,
} from '../ui/primitives';

type Nav = NavigationProp<RootParams>;

const PRECISION_LABEL: Record<HistoryPrecision, string> = { day: 'The day', month: 'Just the month', year: 'Just the year' };

function honourWho(h: Honour, data: ClubData): string {
  if (h.name) return h.name;
  const m = data.members.find((x) => x.id === h.memberId);
  return m ? displayName(m) : 'A former member';
}

function Loading() {
  return (
    <Screen>
      <ActivityIndicator color={colors.redText} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Members tab: the way in
// ---------------------------------------------------------------------------

export function HistoryRow({ last = false }: { last?: boolean }) {
  const navigation = useNavigation<Nav>();
  return (
    <ListRow
      left={<IconBadge icon="trophy-outline" tone="red" />}
      title="History and hall of fame"
      subtitle="The club’s story since 2019"
      onPress={() => navigation.navigate('History')}
      last={last}
    />
  );
}

// ---------------------------------------------------------------------------
// The timeline and the hall of fame
// ---------------------------------------------------------------------------

type View_ = 'timeline' | 'fame';

function TimelineItem({ entry, keeper, last }: { entry: TimelineEntry; keeper: boolean; last: boolean }) {
  const navigation = useNavigation<Nav>();
  return (
    <View style={{ flexDirection: 'row', gap: space.md }}>
      {/* The rail: a dot on each entry, the line running on to the next. */}
      <View style={{ width: 14, alignItems: 'center' }}>
        <View
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            marginTop: 5,
            backgroundColor: entry.kept ? colors.steelHi : colors.redBright,
            borderWidth: 2,
            borderColor: entry.kept ? colors.lineStrong : colors.redBright,
          }}
        />
        {last ? null : <View style={{ flex: 1, width: 2, backgroundColor: colors.line, marginTop: 4 }} />}
      </View>
      <View style={{ flex: 1, gap: 4, paddingBottom: last ? 0 : space.lg }}>
        <Text style={[type.name, { fontSize: 13, color: colors.boneMute }]}>{historyDateLabel(entry)}</Text>
        <Text style={[type.name, { fontSize: 17 }]}>{entry.title}</Text>
        {entry.story ? <Body selectable>{entry.story}</Body> : null}
        {keeper && entry.kept ? (
          <Button
            label="Change"
            kind="quiet"
            icon="create-outline"
            accessibilityLabel={`Change “${entry.title}”`}
            onPress={() => navigation.navigate('EditHistoryEntry', { entryId: entry.id })}
            style={{ alignSelf: 'flex-start' }}
          />
        ) : null}
      </View>
    </View>
  );
}

function Timeline({ keeper }: { keeper: boolean }) {
  const navigation = useNavigation<Nav>();
  const { data } = useClub();
  const { history } = useSocial();
  const years = timeline(history, data.positions);
  return (
    <>
      {keeper ? <Button label="Add to the timeline" icon="add" onPress={() => navigation.navigate('EditHistoryEntry')} /> : null}
      {years.length === 0 ? (
        <Card>
          <Small>Nothing on the timeline yet.</Small>
        </Card>
      ) : null}
      {years.map((y) => (
        <View key={y.year} style={{ gap: space.md }}>
          <H1 style={{ color: colors.redText }}>{String(y.year)}</H1>
          <Card>
            {y.entries.map((e, i) => (
              <TimelineItem key={e.id} entry={e} keeper={keeper} last={i === y.entries.length - 1} />
            ))}
          </Card>
        </View>
      ))}
    </>
  );
}

function HallOfFame({ keeper }: { keeper: boolean }) {
  const navigation = useNavigation<Nav>();
  const { data } = useClub();
  const { honours } = useSocial();
  const founding = founders(data.members, data.positions);
  const shown = honoursFor(honours);
  const past = pastOfficeHolders(data.members, data.positions);
  const chapterName = (id: string | null) => (id ? data.chapters.find((c) => c.id === id)?.name : undefined);

  return (
    <>
      <SectionTitle title="Founders" />
      {founding.length === 0 ? (
        <Card>
          <Small>No founders listed yet.</Small>
        </Card>
      ) : (
        <Card style={{ padding: 0, gap: 0 }}>
          {founding.map((m, i) => (
            <ListRow
              key={m.id}
              left={<IconBadge icon="flag" tone="red" />}
              title={displayName(m)}
              subtitle={m.fullName !== displayName(m) ? m.fullName : undefined}
              onPress={() => navigation.navigate('MemberDetail', { memberId: m.id })}
              last={i === founding.length - 1}
            />
          ))}
        </Card>
      )}

      <SectionTitle title="Honours" />
      {keeper ? <Button label="Add an honour" kind="secondary" icon="add" onPress={() => navigation.navigate('EditHonour')} /> : null}
      {shown.length === 0 ? (
        <Card>
          <Small>No honours yet.</Small>
        </Card>
      ) : null}
      {shown.map((h) => (
        <Card key={h.id}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
            <Ionicons name="trophy" size={22} color={colors.redText} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[type.name, { fontSize: 17 }]}>{h.honour}</Text>
              <Text style={type.name}>{`${honourWho(h, data)} · ${h.year}`}</Text>
              {h.note ? <Small>{h.note}</Small> : null}
            </View>
          </View>
          {keeper ? (
            <Button
              label="Change"
              kind="quiet"
              icon="create-outline"
              accessibilityLabel={`Change ${h.honour}, ${honourWho(h, data)}`}
              onPress={() => navigation.navigate('EditHonour', { honourId: h.id })}
              style={{ alignSelf: 'flex-start' }}
            />
          ) : null}
        </Card>
      ))}

      <SectionTitle title="Past office holders" />
      {past.length === 0 ? (
        <Card>
          <Small>Nobody has stepped down from an office yet.</Small>
        </Card>
      ) : null}
      {past.map((g) => (
        <View key={g.role} style={{ gap: space.sm }}>
          <Text style={[type.name, { color: colors.boneDim }]}>{ROLE_LABEL[g.role]}</Text>
          <Card style={{ padding: 0, gap: 0 }}>
            {g.holders.map((h, i) => (
              <ListRow
                key={`${h.member?.id ?? 'gone'}-${h.startedOn}-${i}`}
                title={h.member ? displayName(h.member) : 'A former member'}
                subtitle={[chapterName(h.chapterId), yearsLabel(h.startedOn, h.endedOn)].filter(Boolean).join(' · ')}
                onPress={h.member ? () => navigation.navigate('MemberDetail', { memberId: (h.member as Member).id }) : undefined}
                last={i === g.holders.length - 1}
              />
            ))}
          </Card>
        </View>
      ))}
    </>
  );
}

export function HistoryScreen() {
  const { me, data, isDemo, refresh: refreshClub } = useClub();
  const { ready, refresh } = useSocial();
  const [view, setView] = useState<View_>('timeline');
  const keeper = canKeepHistory(me, data.positions);
  return (
    <Screen onRefresh={isDemo ? undefined : () => Promise.all([refresh(), refreshClub()]).then(() => undefined)}>
      <Choices<View_>
        options={[
          { value: 'timeline', label: 'Timeline' },
          { value: 'fame', label: 'Hall of fame' },
        ]}
        value={view}
        onChange={setView}
      />
      {!ready ? <ActivityIndicator color={colors.redText} /> : view === 'timeline' ? <Timeline keeper={keeper} /> : <HallOfFame keeper={keeper} />}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Add or change a timeline entry (the board)
// ---------------------------------------------------------------------------

function NotKeeper() {
  return (
    <Screen>
      <Notice title="Board only">Only the board can keep the club’s history.</Notice>
    </Screen>
  );
}

export function EditHistoryEntryScreen({ route, navigation }: RootScreen<'EditHistoryEntry'>) {
  const { me, data } = useClub();
  const { ready, history } = useSocial();
  if (!canKeepHistory(me, data.positions)) return <NotKeeper />;
  const id = route.params?.entryId;
  // Wait for the list, so changing an entry never starts as adding a new one.
  if (!ready) return <Loading />;
  const existing = id ? history.find((e) => e.id === id && !e.archivedAt) : undefined;
  if (id && !existing) {
    return (
      <Screen>
        <Notice title="Not found">That entry isn’t on the timeline.</Notice>
      </Screen>
    );
  }
  return <EntryForm key={existing?.id ?? 'new'} existing={existing} navigation={navigation} />;
}

function EntryForm({ existing, navigation }: { existing: HistoryEntry | undefined; navigation: RootScreen<'EditHistoryEntry'>['navigation'] }) {
  const { me, data, today } = useClub();
  const { history, saveHistoryEntry, archiveHistoryEntry } = useSocial();
  const [dateText, setDateText] = useState(existing ? formatAuDate(existing.happenedOn) : '');
  const [precision, setPrecision] = useState<HistoryPrecision>(existing?.precision ?? 'day');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [story, setStory] = useState(existing?.story ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (busy) return;
    setError(null);
    const input = { id: existing?.id ?? null, happenedOn: parseAuDate(dateText) ?? '', precision, title, story };
    const problem = historyProblem(me, input, history, data.positions, today);
    if (problem) return setError(problem);
    setBusy(true);
    saveHistoryEntry(input)
      .then(() => navigation.goBack())
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <Screen>
      <Card>
        <Field
          label="When"
          value={dateText}
          onChangeText={(t) => setDateText(typeDate(t))}
          placeholder="DD/MM/YYYY"
          keyboardType="number-pad"
          maxLength={10}
          hint={precision === 'day' ? 'Use DD/MM/YYYY, like 09/03/2019.' : 'Any day in it will do, like 01/03/2019.'}
        />
        <Choices<HistoryPrecision>
          label="Show"
          options={HISTORY_PRECISIONS.map((p) => ({ value: p, label: PRECISION_LABEL[p] }))}
          value={precision}
          onChange={setPrecision}
        />
        <Field label="What happened" value={title} onChangeText={setTitle} placeholder="First Big 4, new chapter, the bus arrives" maxLength={MAX_HISTORY_TITLE * 2} />
        <Field
          label="The story"
          value={story}
          onChangeText={setStory}
          multiline
          placeholder="Who was there, what it meant"
          hint="Optional. Every approved member can read it."
          maxLength={MAX_HISTORY_STORY * 2}
        />
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={existing ? 'Save changes' : 'Add it'} icon="checkmark" busy={busy} onPress={save} />
      {existing ? (
        <ConfirmButton
          label="Take it off the timeline"
          confirmLabel="Take it off"
          kind="quiet"
          icon="archive-outline"
          confirmNote="It’s kept, but members won’t see it any more."
          onConfirm={() =>
            archiveHistoryEntry(existing.id)
              .then(() => navigation.goBack())
              .catch((e) => setError((e as Error).message))
          }
        />
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Add or change an honour (the board)
// ---------------------------------------------------------------------------

export function EditHonourScreen({ route, navigation }: RootScreen<'EditHonour'>) {
  const { me, data } = useClub();
  const { ready, honours } = useSocial();
  if (!canKeepHistory(me, data.positions)) return <NotKeeper />;
  const id = route.params?.honourId;
  if (!ready) return <Loading />;
  const existing = id ? honours.find((h) => h.id === id && !h.archivedAt) : undefined;
  if (id && !existing) {
    return (
      <Screen>
        <Notice title="Not found">That honour isn’t in the hall of fame.</Notice>
      </Screen>
    );
  }
  return <HonourForm key={existing?.id ?? 'new'} existing={existing} navigation={navigation} />;
}

type Who = 'member' | 'name';

function HonourForm({ existing, navigation }: { existing: Honour | undefined; navigation: RootScreen<'EditHonour'>['navigation'] }) {
  const { me, data, today } = useClub();
  const { honours, saveHonour, archiveHonour } = useSocial();
  const [who, setWho] = useState<Who>(existing?.name ? 'name' : 'member');
  const [memberId, setMemberId] = useState<string | null>(existing?.memberId ?? null);
  const [find, setFind] = useState('');
  const [name, setName] = useState(existing?.name ?? '');
  const [honour, setHonour] = useState(existing?.honour ?? '');
  const [year, setYear] = useState(existing ? String(existing.year) : today.slice(0, 4));
  const [note, setNote] = useState(existing?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const members = data.members.filter((m) => m.approval === 'approved');
  const picked = memberId ? data.members.find((m) => m.id === memberId) : undefined;
  const q = find.trim().toLowerCase();
  const found = q
    ? members.filter((m) => displayName(m).toLowerCase().includes(q) || m.fullName.toLowerCase().includes(q)).slice(0, 6)
    : [];

  const save = () => {
    if (busy) return;
    setError(null);
    const input = {
      id: existing?.id ?? null,
      memberId: who === 'member' ? memberId : null,
      name: who === 'name' ? name : '',
      honour,
      year: /^\d{4}$/.test(year.trim()) ? Number(year.trim()) : Number.NaN,
      note,
    };
    const problem = honourProblem(me, input, honours, data.members, data.positions, today);
    if (problem) return setError(problem);
    setBusy(true);
    saveHonour(input)
      .then(() => navigation.goBack())
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <Screen>
      <Card>
        <Choices<Who>
          label="Who"
          options={[
            { value: 'member', label: 'A member' },
            { value: 'name', label: 'Someone else' },
          ]}
          value={who}
          onChange={setWho}
        />
        {who === 'member' ? (
          <>
            {memberId ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  padding: space.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.lineStrong,
                  backgroundColor: colors.steel,
                }}
              >
                <Ionicons name="person" size={18} color={colors.bone} />
                <Text style={[type.name, { flex: 1 }]}>{picked ? displayName(picked) : 'A former member'}</Text>
              </View>
            ) : null}
            <Field
              label={memberId ? 'Pick someone else' : 'Find a member'}
              value={find}
              onChangeText={setFind}
              placeholder="Road name or name"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {q && found.length === 0 ? <Small>Nobody by that name.</Small> : null}
            {found.map((m) => (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityLabel={`Pick ${displayName(m)}`}
                onPress={() => {
                  setMemberId(m.id);
                  setFind('');
                }}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
                  minHeight: 44,
                  justifyContent: 'center',
                  paddingHorizontal: space.md,
                  borderRadius: radius.sm,
                  backgroundColor: pressed || hovered ? colors.steel : 'transparent',
                })}
              >
                <Text style={type.name}>{displayName(m)}</Text>
                {m.fullName !== displayName(m) ? <Small>{m.fullName}</Small> : null}
              </Pressable>
            ))}
          </>
        ) : (
          <Field
            label="Their name"
            value={name}
            onChangeText={setName}
            placeholder="Someone who isn’t in the app"
            hint="A mate of the club, or a member from before the app."
            maxLength={MAX_HONOUR_NAME * 2}
          />
        )}
      </Card>
      <Card>
        <Field label="Honour" value={honour} onChangeText={setHonour} placeholder="Life member, Rider of the year" maxLength={MAX_HONOUR * 2} />
        <Field label="Year" value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} placeholder="YYYY" />
        <Field
          label="A line about it"
          value={note}
          onChangeText={setNote}
          multiline
          placeholder="What it was for"
          hint="Optional."
          maxLength={MAX_HONOUR_NOTE * 2}
        />
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={existing ? 'Save changes' : 'Add the honour'} icon="checkmark" busy={busy} onPress={save} />
      {existing ? (
        <ConfirmButton
          label="Take it out of the hall of fame"
          confirmLabel="Take it out"
          kind="quiet"
          icon="archive-outline"
          confirmNote="It’s kept, but members won’t see it any more."
          onConfirm={() =>
            archiveHonour(existing.id)
              .then(() => navigation.goBack())
              .catch((e) => setError((e as Error).message))
          }
        />
      ) : null}
    </Screen>
  );
}
