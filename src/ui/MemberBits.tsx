import React from 'react';
import { Text, View } from 'react-native';
import { heldPositions, isActing } from '../domain/acting';
import { chipLabel, positionTitles, seatTitle, stepDownNote, type ChipForm } from '../domain/home';
import { ROLE_LABEL, ROLE_ORDER, ROLE_SHORT } from '../domain/labels';
import { displayName, initials } from '../domain/profile';
import type { ClubData, Member, Position } from '../domain/types';
import { colors, space, type } from '../theme';
import { Avatar, Chip, ConfirmButton, ListRow, RoleChip, Row, Small, StatusChip } from './primitives';

/** The member's titles, in role order: the held rows, so a covered holder keeps theirs and a lapsed stint has none. */
export function sortedPositions(memberId: string, data: ClubData) {
  return heldPositions(memberId, data.positions).sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
  );
}

/**
 * One chip per title, in the short form ("PRES (WEST)", "TREAS (WEST, NORTH)"). A stint says Acting
 * with chipLabel, so it never reads as a full term: spelt out where the chips have a line of their
 * own ("ACTING TREASURER (NORTH)"), short in a dense row (form "short": "ACTING TREAS (NORTH)").
 * A screen reader hears each title in full ("Treasurer (West, North)").
 */
export function RoleChips({
  positions,
  data,
  homeChapterId,
  form = 'long',
}: {
  positions: Position[];
  data: ClubData;
  homeChapterId: string;
  form?: ChipForm;
}) {
  // The same titles in words, grouped the same way, so each lines up with its chip.
  const spoken = positionTitles(positions, data.chapters, homeChapterId, ROLE_LABEL);
  return (
    <>
      {positionTitles(positions, data.chapters, homeChapterId, ROLE_SHORT).map((t, i) => {
        const first = positions.find((p) => p.id === t.key)!;
        return (
          <RoleChip
            key={t.key}
            role={first.role}
            label={isActing(first) ? chipLabel(first, data.chapters, form) : t.text}
            accessibilityLabel={spoken[i].text}
          />
        );
      })}
    </>
  );
}

/**
 * Stepping down from one seat, the holder's own call (9.3), as on their member page and Delete
 * account, where each seat has its own button, so each names its seat: "Step down as Acting
 * Treasurer (North)" for a stint (Manage member's lone stint button keeps "Step down from acting").
 * The confirm says what else ends with the row
 * (stepDownNote): the holder of a covered seat hears the cover ends too, and a stand-in leaving
 * the last board seat their cover rests on hears their acting ends.
 */
export function StepDownButton({ position, data, onConfirm }: { position: Position; data: ClubData; onConfirm: () => void }) {
  const title = seatTitle(position, data.chapters, ROLE_LABEL);
  // A stint's title already says Acting (Acting Treasurer (North)), so the confirm says it once.
  return (
    <ConfirmButton
      label={`Step down as ${title}`}
      confirmLabel="Yes, step down"
      confirmAccessibilityLabel={`Yes, step down as ${title}`}
      confirmNote={stepDownNote(position, data)}
      kind="secondary"
      size="small"
      onConfirm={onConfirm}
    />
  );
}

export function MemberRow({
  member,
  data,
  onPress,
  last,
  showChapter = true,
  extra,
}: {
  member: Member;
  data: ClubData;
  onPress?: () => void;
  last?: boolean;
  showChapter?: boolean;
  extra?: React.ReactNode;
}) {
  const chapter = data.chapters.find((c) => c.id === member.chapterId);
  const positions = sortedPositions(member.id, data);
  const name = displayName(member);
  return (
    <ListRow
      onPress={onPress}
      last={last}
      left={<Avatar text={initials(member)} />}
      title={
        <Row style={{ gap: space.sm }}>
          <Text numberOfLines={1} style={[type.name, { flexShrink: 1 }]}>
            {name}
          </Text>
          {member.roadName ? (
            <Small numberOfLines={1} style={{ flexShrink: 1 }}>
              {member.fullName}
            </Small>
          ) : null}
        </Row>
      }
      subtitle={
        <View style={{ gap: 6 }}>
          <Row style={{ gap: 6 }}>
            <StatusChip status={member.status} />
            {member.onHiatus ? <Chip label="On hiatus" icon="pause" /> : null}
            <RoleChips positions={positions} data={data} homeChapterId={member.chapterId} form="short" />
            {showChapter && chapter ? <Small style={{ color: colors.boneMute }}>{chapter.name}</Small> : null}
          </Row>
          {extra}
        </View>
      }
    />
  );
}
