// The digital membership card: the real club logo, who you are in the club, this club year and
// whether this year's dues are paid. The member disc only for Full and Nomad (brand rule).

import React from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { compassFor } from '../domain/compass';
import { cardOf } from '../domain/card';
import { formatAuDate } from '../domain/dates';
import { STATUS_LABEL } from '../domain/labels';
import { displayName } from '../domain/profile';
import type { RootScreen } from '../navigation/types';
import { colors, radius, space, type } from '../theme';
import { Button, Chip, KeyValue, Logo, MemberDisc, Notice, Row, Screen, Small, StatusChip } from '../ui/primitives';

export function MembershipCardScreen({ navigation }: RootScreen<'MembershipCard'>) {
  const { me, data, today } = useClub();
  if (!me || me.approval !== 'approved') {
    return (
      <Screen>
        <Notice tone="info" title="No card yet">Your membership card shows here once the board approves you.</Notice>
      </Screen>
    );
  }
  const card = cardOf(me, data, today);
  const chapter = data.chapters.find((c) => c.id === me.chapterId);
  return (
    <Screen>
      <View
        accessible
        accessibilityLabel={`Rustnuts membership card. ${displayName(me)}, ${STATUS_LABEL[me.status]}, ${chapter?.name ?? ''} chapter, club year ${card.clubYear}.`}
        style={{
          backgroundColor: colors.ink2,
          borderColor: colors.red,
          borderWidth: 2,
          borderRadius: radius.md,
          padding: space.lg,
          gap: space.lg,
          alignItems: 'center',
        }}
      >
        <Logo width={220} />
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={[type.display, { textAlign: 'center' }]}>{displayName(me)}</Text>
          {me.roadName && me.roadName !== me.fullName ? <Text style={[type.name, { color: colors.boneDim }]}>{me.fullName}</Text> : null}
        </View>
        <Row style={{ gap: 6, justifyContent: 'center' }}>
          <StatusChip status={me.status} />
          {me.onHiatus ? <Chip label="On hiatus" icon="pause" /> : null}
          {card.dues?.state === 'paid' ? <Chip label={`Paid ${card.clubYear}`} tone="ok" icon="checkmark" /> : null}
          {card.dues?.state === 'due' ? <Chip label={`Due ${formatAuDate(card.dues.dueOn)}`} tone="warn" /> : null}
        </Row>
        {card.showDisc ? <MemberDisc size={120} compass={compassFor(me, data)} /> : null}
        <View style={{ alignSelf: 'stretch', gap: 2 }}>
          <KeyValue label="Chapter" value={chapter?.name ?? '—'} />
          {me.joinedOn ? <KeyValue label={me.status === 'family' ? 'With the club since' : 'Member since'} value={formatAuDate(me.joinedOn)} /> : null}
          {card.showDisc && me.patchedOn ? <KeyValue label="Patched" value={formatAuDate(me.patchedOn)} /> : null}
          <KeyValue label="Club year" value={card.clubYear} />
        </View>
      </View>
      <Small style={{ textAlign: 'center' }}>Show this at club events and runs.</Small>
      {card.dues ? (
        <Button label="Fees and receipts" kind="secondary" icon="cash-outline" onPress={() => navigation.navigate('MemberFees', { memberId: me.id })} />
      ) : null}
    </Screen>
  );
}
