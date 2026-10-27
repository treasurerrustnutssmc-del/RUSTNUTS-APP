// Stage 7: the social extras. Shout-outs on Home, and your own social settings on Me.

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { useChat } from '../data/chat/ChatProvider';
import { useSocial } from '../data/social/SocialProvider';
import { displayName, initials } from '../domain/profile';
import {
  birthdayLabel,
  birthdayProblem,
  daysInMonth,
  MONTH_OPTIONS,
  shoutoutDayLabel,
  shoutoutLine,
  shoutoutsFor,
  type Birthday,
  type Shoutout,
} from '../domain/social/shoutouts';
import type { RootParams, RootScreen } from '../navigation/types';
import { colors, space, type } from '../theme';
import {
  Avatar,
  Button,
  Card,
  Chip,
  H2,
  IconBadge,
  Ionicons,
  Label,
  ListRow,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
} from '../ui/primitives';

type Nav = NavigationProp<RootParams>;

// ---------------------------------------------------------------------------
// Home: shout-outs
// ---------------------------------------------------------------------------

/** Birthdays and patch anniversaries this week. Nothing shows when there are none. */
export function HomeShoutoutsCard() {
  const { me, data, today } = useClub();
  const { birthdays } = useSocial();
  const list = shoutoutsFor(me, data.members, birthdays, today, undefined, data.positions);
  if (list.length === 0) return null;
  return (
    <Card style={{ padding: 0, gap: 0 }}>
      <View style={{ padding: space.lg, paddingBottom: space.sm }}>
        <H2>Shout-outs</H2>
      </View>
      {list.map((s, i) => (
        <ShoutoutRow key={`${s.kind}:${s.member.id}:${s.date}`} s={s} last={i === list.length - 1} />
      ))}
    </Card>
  );
}

function ShoutoutRow({ s, last }: { s: Shoutout; last: boolean }) {
  const navigation = useNavigation<Nav>();
  const chat = useChat();
  const [error, setError] = useState<string | null>(null);
  const name = s.isMe ? 'You' : displayName(s.member);
  const today = s.daysAway === 0;
  const sayGday = () => {
    setError(null);
    chat
      .openDirect(s.member.id)
      .then((chatId) => navigation.navigate('Chat', { chatId }))
      .catch((e) => setError((e as Error).message));
  };
  // The member and the g'day button are side by side, never one inside the other: on the web a
  // press inside a pressable row reaches the row too.
  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${name}, ${shoutoutLine(s)}, ${shoutoutDayLabel(s.date, s.daysAway)}`}
          onPress={() => navigation.navigate('MemberDetail', { memberId: s.member.id })}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
            flex: 1,
            minWidth: 0,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            padding: space.md,
            backgroundColor: pressed || hovered ? colors.steel : 'transparent',
          })}
        >
          <Avatar text={initials(s.member)} size={40} />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text numberOfLines={1} style={type.name}>{name}</Text>
            <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
              <Ionicons name={s.kind === 'birthday' ? 'gift-outline' : 'ribbon-outline'} size={14} color={colors.boneMute} />
              <Small numberOfLines={1}>{shoutoutLine(s)}</Small>
            </Row>
          </View>
          {today ? (
            <View style={{ justifyContent: 'center' }}>
              <Chip label="Today" tone="red" />
            </View>
          ) : (
            <Text style={[type.name, { color: colors.boneDim, fontVariant: ['tabular-nums'] }]}>{shoutoutDayLabel(s.date, s.daysAway)}</Text>
          )}
        </Pressable>
        {today && !s.isMe ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Say g’day to ${name}`}
            onPress={sayGday}
            hitSlop={4}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
              height: 44,
              paddingHorizontal: space.md,
              marginRight: space.md,
              borderRadius: 4,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              borderWidth: 1,
              borderColor: colors.lineStrong,
              backgroundColor: pressed || hovered ? colors.steel : 'transparent',
            })}
          >
            <Ionicons name="chatbubble-outline" size={16} color={colors.bone} />
            <Text style={type.name}>G’day</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
          <Notice tone="danger">{error}</Notice>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Me: social settings
// ---------------------------------------------------------------------------

/** Me: your birthday shout-out (and, later, the rest of your social bits). */
export function MeSocialSection() {
  const { me } = useClub();
  const { birthdays } = useSocial();
  const navigation = useNavigation<Nav>();
  if (!me || me.approval !== 'approved') return null;
  const mine = birthdays.find((b) => b.memberId === me.id) ?? null;
  return (
    <>
      <SectionTitle title="Social" />
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow
          last
          left={<IconBadge icon="gift-outline" tone={mine ? 'red' : 'steel'} />}
          title="Birthday shout-out"
          subtitle={mine ? birthdayLabel(mine) : 'Not shared. Add it for a shout-out on Home.'}
          onPress={() => navigation.navigate('Birthday')}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Your birthday
// ---------------------------------------------------------------------------

export function BirthdayScreen({ navigation }: RootScreen<'Birthday'>) {
  const { me } = useClub();
  const { ready, birthdays } = useSocial();
  if (!me) return null;
  if (!ready) {
    return (
      <Screen>
        <ActivityIndicator color={colors.redText} />
      </Screen>
    );
  }
  const mine = birthdays.find((b) => b.memberId === me.id) ?? null;
  // Keyed by what's saved, so the picks start from it once it's loaded.
  return <BirthdayForm key={mine ? `${mine.month}-${mine.day}` : 'none'} mine={mine} onDone={() => navigation.goBack()} />;
}

function BirthdayForm({ mine, onDone }: { mine: Birthday | null; onDone: () => void }) {
  const { setBirthday } = useSocial();
  const [month, setMonth] = useState<number | null>(mine?.month ?? null);
  const [day, setDay] = useState<number | null>(mine?.day ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickMonth = (m: number) => {
    setMonth(m);
    if (day !== null && day > daysInMonth(m)) setDay(null);
  };
  const save = (m: number | null, d: number | null) => {
    setError(null);
    const problem = birthdayProblem(m, d);
    if (problem) return setError(problem);
    setBusy(true);
    setBirthday(m, d)
      .then(onDone)
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <Screen>
      <Card>
        <H2>Your birthday</H2>
        <Small>Members see your birthday on Home that week, day and month only. The year is never asked for or kept.</Small>
      </Card>

      <Card>
        <Label>Month</Label>
        <Grid>
          {MONTH_OPTIONS.map((o) => (
            <Pick key={o.month} width="23%" label={o.short} a11y={o.name} selected={month === o.month} onPress={() => pickMonth(o.month)} />
          ))}
        </Grid>
        <Label>Day</Label>
        {month === null ? (
          <Small>Pick the month first.</Small>
        ) : (
          <Grid>
            {Array.from({ length: daysInMonth(month) }, (_, i) => i + 1).map((d) => (
              <Pick key={d} width="14.5%" label={String(d)} a11y={`${d}`} selected={day === d} onPress={() => setDay(d)} />
            ))}
          </Grid>
        )}
      </Card>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button
        label={mine ? 'Save birthday' : 'Share my birthday'}
        icon="gift-outline"
        busy={busy}
        disabled={month === null || day === null}
        onPress={() => save(month, day)}
      />
      {mine ? <Button label="Stop sharing it" kind="quiet" onPress={() => save(null, null)} disabled={busy} /> : null}
    </Screen>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>{children}</View>;
}

/** One square in the month or day grid: stencil numbers, the selected one in club red. */
function Pick({
  label,
  a11y,
  width,
  selected,
  onPress,
}: {
  label: string;
  a11y: string;
  /** A share of the row: 4 months or 6 days to a row, so the grid fills the card. */
  width: `${number}%`;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={a11y}
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        width,
        height: 44,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected ? colors.redBright : pressed || hovered ? colors.steelHi : colors.steel,
      })}
    >
      <Text style={[type.name, { color: selected ? colors.bone : colors.boneDim, fontVariant: ['tabular-nums'] }]}>{label}</Text>
    </Pressable>
  );
}
