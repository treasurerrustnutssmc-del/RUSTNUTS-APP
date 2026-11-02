// The one-time card before a member first uses Ask the club or Catch me up: who the data goes to,
// what goes, and Agree / Not now (src/domain/aiConsent.ts).

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AI_CONSENT, type AiFeature } from '../domain/aiConsent';
import { colors, space } from '../theme';
import { Body, Button, Card, H2, Row, Small } from './primitives';

export function AiConsentCard({ feature, onAgree, onNotNow }: { feature: AiFeature; onAgree: () => Promise<void> | void; onNotNow?: () => void }) {
  const copy = AI_CONSENT[feature];
  const [busy, setBusy] = useState(false);
  const agree = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onAgree();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={styles.card}>
      <H2>{copy.heading}</H2>
      <Body>{copy.intro}</Body>
      <View style={styles.points}>
        {copy.sends.map((line) => (
          <View key={line} style={styles.point}>
            <Body style={styles.dot}>•</Body>
            <Body style={{ flex: 1 }}>{line}</Body>
          </View>
        ))}
      </View>
      <Small>{copy.promise}</Small>
      <Row style={{ gap: space.sm }}>
        <Button label={copy.agree} onPress={agree} busy={busy} style={{ flex: 1 }} />
        {onNotNow ? <Button label={copy.notNow} kind="quiet" onPress={onNotNow} disabled={busy} /> : null}
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.line },
  points: { gap: space.xs },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  dot: { color: colors.boneDim },
});
