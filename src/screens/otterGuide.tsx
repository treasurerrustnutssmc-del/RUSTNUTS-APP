// How Draft from Otter works: the secretary's guide, opened from the Draft from Otter screen.
// The words live in src/domain/otterGuide.ts.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { OTTER_GUIDE } from '../domain/otterGuide';
import type { RootScreen } from '../navigation/types';
import { colors, fonts, space, type } from '../theme';
import { Body, Card, H1, Screen, Small, Stack } from '../ui/primitives';

export function OtterGuideScreen(_props: RootScreen<'OtterGuide'>) {
  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>How it works</H1>
        <Small>Record the meeting with Otter, let the app draft the minutes, then check and save. About a minute for an hour’s meeting.</Small>
      </Stack>
      {OTTER_GUIDE.map((section) => (
        <Card key={section.title}>
          <Text style={styles.title}>{section.title}</Text>
          <View style={styles.list}>
            {section.items.map((item, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.marker}>{section.numbered ? `${i + 1}.` : '•'}</Text>
                <Body style={styles.item}>{item}</Body>
              </View>
            ))}
          </View>
          {section.note ? <Small>{section.note}</Small> : null}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.stencil, fontSize: 18, letterSpacing: 0.6, color: colors.bone, textTransform: 'uppercase' },
  list: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  marker: { ...type.body, fontFamily: fonts.stencil, color: colors.boneDim, minWidth: 22 },
  item: { flex: 1 },
});
