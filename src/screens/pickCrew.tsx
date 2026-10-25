// Pick crew: a crew manager chooses who takes a spot on a ride. Those going come first, then the
// standing holders of the same position, then everyone else who can crew. Tapping a name saves it.
// Members who could crew but haven't signed the Road Rules are listed last, unavailable, with why.

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { crewChangeProblem, managesRide, pickGroups, spotOf } from '../domain/crew';
import { formatAuDate, weekday } from '../domain/dates';
import { ROLE_LABEL, ROLE_SHORT } from '../domain/labels';
import { displayName, initials } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import { currentRoadRules, signoffLine } from '../domain/roadRules';
import type { Member } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { colors, fonts, space, type } from '../theme';
import { Avatar, Body, Card, Chip, H1, Ionicons, Notice, Row, Screen, SectionTitle, Small, Stack, StatusChip } from '../ui/primitives';

export function PickCrewScreen({ route, navigation }: RootScreen<'PickCrew'>) {
  const { me, data, today, setCrew } = useClub();
  const { rideId, role } = route.params;
  const [busy, setBusy] = useState<string | null>(null);
  // The member whose pick failed, with why, shown under their name.
  const [failed, setFailed] = useState<{ memberId: string; message: string } | null>(null);
  const ride = data.rides.find((r) => r.id === rideId);

  if (!ride || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Ride not found">It may have come off the club calendar.</Notice>
      </Screen>
    );
  }

  const date = melbourneDate(ride.startsAt);
  const locked = crewChangeProblem(me, ride, new Date().toISOString());
  const manages = managesRide(me, ride, data);
  const crew = data.crew ?? [];
  const holder = role === 'officer' ? undefined : crew.find((s) => s.rideId === ride.id && s.role === role);
  const holderMember = holder ? data.members.find((m) => m.id === holder.memberId) : undefined;
  const groups = pickGroups(ride, role, me, data, today);
  // Officers have no limit, so those already on as Officers aren't offered again.
  const offer = (members: Member[]) =>
    role === 'officer' ? members.filter((m) => spotOf(ride.id, m.id, data.crew) !== 'officer') : members;
  const chapter = data.chapters.find((c) => c.id === groups.chapterId);
  const sections = [
    { title: 'Going', members: offer(groups.going) },
    { title: `${chapter ? `${chapter.name} ` : ''}${ROLE_LABEL[role]}s`, members: offer(groups.holders) },
    { title: 'Everyone else', members: offer(groups.rest) },
  ].filter((g) => g.members.length > 0);
  const unsigned = offer(groups.unsigned);

  const pick = async (m: Member) => {
    if (busy) return;
    setFailed(null);
    setBusy(m.id);
    try {
      await setCrew(ride.id, m.id, role);
      navigation.goBack();
    } catch (e) {
      setFailed({ memberId: m.id, message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H1>{ROLE_LABEL[role]}</H1>
        <Text style={styles.ride}>
          {ride.title}
          <Text style={styles.rideDate}>{` · ${weekday(date)} ${formatAuDate(date)}`}</Text>
        </Text>
      </Stack>

      {locked ? (
        <Notice tone="warn">{locked}</Notice>
      ) : !manages ? (
        <Notice tone="warn">Only the board or ride committee can put someone else on the crew.</Notice>
      ) : (
        <>
          <Stack gap={space.xs}>
            <Body>
              {`Full and Nomad members who aren’t on hiatus${currentRoadRules(data) ? ' and have signed the Road Rules' : ''} can crew. Tail Gunners and Assistant Tail Gunners need a current first aid certificate. Whoever you pick is put down as going.`}
            </Body>
            {holderMember ? <Small>{`${displayName(holderMember)} has this spot now. Picking someone else replaces them.`}</Small> : null}
          </Stack>

          {sections.length === 0 && unsigned.length === 0 ? (
            <Notice title="Nobody to pick yet.">Members show up here once they can crew this ride.</Notice>
          ) : null}

          {sections.map((g) => (
            <Stack key={g.title} gap={space.sm}>
              <SectionTitle title={g.title} action={<Text style={styles.count}>{g.members.length}</Text>} />
              <Card style={{ padding: 0, gap: 0 }}>
                {g.members.map((m, i) => (
                  <PickRow
                    key={m.id}
                    member={m}
                    spot={spotOf(ride.id, m.id, data.crew)}
                    current={holder?.memberId === m.id}
                    saving={busy === m.id}
                    disabled={busy !== null && busy !== m.id}
                    error={failed?.memberId === m.id ? failed.message : null}
                    last={i === g.members.length - 1}
                    onPress={() => pick(m)}
                  />
                ))}
              </Card>
            </Stack>
          ))}

          {unsigned.length > 0 ? (
            <Stack gap={space.sm}>
              <SectionTitle title="Not signed" action={<Text style={styles.count}>{unsigned.length}</Text>} />
              <Small>They can crew once they’ve signed the Road Rules.</Small>
              <Card style={{ padding: 0, gap: 0 }}>
                {unsigned.map((m, i) => (
                  <UnsignedRow key={m.id} member={m} line={signoffLine(m, data, today)} last={i === unsigned.length - 1} />
                ))}
              </Card>
            </Stack>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function PickRow({
  member,
  spot,
  current,
  saving,
  disabled,
  error,
  last,
  onPress,
}: {
  member: Member;
  /** Their spot on this ride's crew already, if any: shown as "Now RC" so it doesn't read as a standing position. */
  spot: ReturnType<typeof spotOf>;
  /** They hold the spot being picked. */
  current: boolean;
  saving: boolean;
  disabled: boolean;
  error: string | null;
  last: boolean;
  onPress: () => void;
}) {
  const name = displayName(member);
  const label = [
    name,
    member.fullName !== name ? member.fullName : null,
    current ? 'has this spot now' : spot ? `currently ${ROLE_LABEL[spot]} on this ride, picking moves them` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const off = current || disabled;
  return (
    <View style={[styles.item, last && { borderBottomWidth: 0 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: off, busy: saving }}
        aria-disabled={off}
        aria-busy={saving}
        disabled={off || saving}
        onPress={onPress}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.row,
          !off && (pressed || hovered) && { backgroundColor: colors.steel },
          disabled && styles.dim,
        ]}
      >
        <Avatar text={initials(member)} size={40} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
            <Text numberOfLines={1} style={[type.name, { flexShrink: 1 }]}>
              {name}
            </Text>
            {member.roadName ? (
              <Small numberOfLines={1} style={{ flexShrink: 1 }}>
                {member.fullName}
              </Small>
            ) : null}
          </Row>
          <Row style={{ gap: 6 }}>
            <StatusChip status={member.status} />
            {current ? <Chip label="Has it now" tone="ok" icon="checkmark" /> : spot ? <Chip label={`Now ${ROLE_SHORT[spot]}`} tone="bone" icon="shield-half" /> : null}
          </Row>
        </View>
        {saving ? (
          <ActivityIndicator size="small" color={colors.bone} />
        ) : current ? null : (
          <Ionicons name="add-circle-outline" size={22} color={colors.boneMute} />
        )}
      </Pressable>
      <View accessibilityLiveRegion="polite" role="alert" style={error ? styles.error : undefined}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </View>
    </View>
  );
}

/** Someone who could crew but hasn't signed the Road Rules: shown, not pickable, with their sign-off line. */
function UnsignedRow({ member, line, last }: { member: Member; line: string; last: boolean }) {
  const name = displayName(member);
  return (
    <View
      accessible
      accessibilityLabel={`${name}${member.fullName !== name ? `, ${member.fullName}` : ''}, can’t be picked: ${line}`}
      style={[styles.item, styles.row, last && { borderBottomWidth: 0 }]}
    >
      <View style={styles.dim}>
        <Avatar text={initials(member)} size={40} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
          <Text numberOfLines={1} style={[type.name, { flexShrink: 1, color: colors.boneDim }]}>
            {name}
          </Text>
          {member.roadName ? (
            <Small numberOfLines={1} style={{ flexShrink: 1 }}>
              {member.fullName}
            </Small>
          ) : null}
        </Row>
        <Row style={{ gap: 6 }}>
          <Ionicons name="document-text-outline" size={14} color={colors.warn} />
          <Text style={styles.unsignedLine}>{line}</Text>
        </Row>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ride: { ...type.name, color: colors.bone },
  rideDate: { fontFamily: fonts.stencil, color: colors.boneDim },
  count: { fontFamily: fonts.stencil, fontSize: 16, color: colors.boneMute },
  item: { borderBottomWidth: 1, borderBottomColor: colors.line },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 64,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  dim: { opacity: 0.45 },
  unsignedLine: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.4, color: colors.warn },
  error: { paddingHorizontal: space.md, paddingBottom: space.md },
});
