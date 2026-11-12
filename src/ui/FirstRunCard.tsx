import React from 'react';
import { View } from 'react-native';
import { useFirstRun } from '../data/firstRun';
import { useClub } from '../data/ClubStore';
import { firstRunSteps } from '../domain/firstRun';
import { space } from '../theme';
import { Body, Button, Card, H2, IconBadge, Row, Small, type IconName } from './primitives';

/** Home: a short "here's where things are" for someone new. Dismissed once, and Help can bring it back. */
export function FirstRunCard() {
  const { show, dismiss } = useFirstRun();
  const { level } = useClub();
  if (!show) return null;
  return (
    <Card>
      <H2>Here’s where things are</H2>
      {firstRunSteps(level === 'board' || level === 'national').map((s) => (
        <Row key={s.title} style={{ gap: space.md, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <IconBadge icon={s.icon as IconName} />
          <View style={{ flex: 1, gap: 2 }}>
            <Body strong>{s.title}</Body>
            <Small>{s.text}</Small>
          </View>
        </Row>
      ))}
      <Button label="Got it" kind="secondary" onPress={() => void dismiss()} />
    </Card>
  );
}
