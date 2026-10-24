import React from 'react';
import { View } from 'react-native';
import { activePositions } from '../domain/access';
import { ROLE_ORDER } from '../domain/labels';
import { displayName, initials } from '../domain/profile';
import type { ClubData, Member } from '../domain/types';
import { colors, space } from '../theme';
import { Avatar, Body, Chip, ListRow, RoleChip, Row, Small, StatusChip } from './primitives';

export function sortedPositions(memberId: string, data: ClubData) {
  return activePositions(memberId, data.positions).sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
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
          <Body strong numberOfLines={1} style={{ flexShrink: 1 }}>
            {name}
          </Body>
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
            {positions.map((p) => (
              <RoleChip key={p.id} role={p.role} />
            ))}
            {showChapter && chapter ? <Small style={{ color: colors.boneMute }}>{chapter.name}</Small> : null}
          </Row>
          {extra}
        </View>
      }
    />
  );
}
