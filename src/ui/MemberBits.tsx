import React from 'react';
import { Text, View } from 'react-native';
import { coverOf, heldPositions, isActing } from '../domain/acting';
import { chipLabel, coveredStepDownNote, positionTitles, seatTitle } from '../domain/home';
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
 * One chip per title, in the short form ("PRES (WEST)", "TREAS (WEST, NORTH)"). A stint spells
 * itself out with chipLabel ("ACTING TREASURER (NORTH)"), so it never reads as a full term.
 */
export function RoleChips({ positions, data, homeChapterId }: { positions: Position[]; data: ClubData; homeChapterId: string }) {
  return (
    <>
      {positionTitles(positions, data.chapters, homeChapterId, ROLE_SHORT).map((t) => {
        const first = positions.find((p) => p.id === t.key)!;
        return <RoleChip key={t.key} role={first.role} label={isActing(first) ? chipLabel(first, data.chapters) : t.text} />;
      })}
    </>
  );
}

/**
 * Stepping down from one seat, the holder's own call (9.3), as on their member page and Delete
 * account. A stint reads "Step down from acting". The holder of a covered seat is told the cover
 * ends with it (the cover rests on the seat it covers).
 */
export function StepDownButton({ position, data, onConfirm }: { position: Position; data: ClubData; onConfirm: () => void }) {
  const title = seatTitle(position, data.chapters, ROLE_LABEL);
  const acting = isActing(position);
  const cover = coverOf(position, data.positions);
  return (
    <ConfirmButton
      label={acting ? 'Step down from acting' : `Step down as ${title}`}
      confirmLabel="Yes, step down"
      confirmAccessibilityLabel={acting ? `Yes, step down from acting as ${title}` : `Yes, step down as ${title}`}
      confirmNote={cover ? coveredStepDownNote(cover, data) : undefined}
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
            <RoleChips positions={positions} data={data} homeChapterId={member.chapterId} />
            {showChapter && chapter ? <Small style={{ color: colors.boneMute }}>{chapter.name}</Small> : null}
          </Row>
          {extra}
        </View>
      }
    />
  );
}
