import React from 'react';
import { Linking, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { RootParams } from '../navigation/types';
import { PRIVACY_EMAIL, PRIVACY_INTRO, PRIVACY_SECTIONS, PRIVACY_URL, privacyUpdatedLine } from '../domain/privacyPolicy';
import { Body, Button, Card, H2, IconBadge, ListRow, Row, Screen, Small, Stack } from '../ui/primitives';
import { colors, space, type } from '../theme';

type Nav = NavigationProp<RootParams>;

/** A row that opens the privacy policy. On Welcome, Sign in, Ask to join, Pending, Me and Family Me. */
export function PrivacyPolicyRow() {
  const navigation = useNavigation<Nav>();
  return (
    <Card style={{ padding: 0, gap: 0 }}>
      <ListRow
        last
        left={<IconBadge icon="shield-checkmark-outline" />}
        title="Privacy policy"
        subtitle="What the app collects and who sees it"
        onPress={() => navigation.navigate('PrivacyPolicy')}
      />
    </Card>
  );
}

/** The whole policy, the same text as the public page the app stores link to. */
export function PrivacyPolicyScreen() {
  return (
    <Screen>
      <Text style={[type.name, { color: colors.boneMute }]}>{privacyUpdatedLine()}</Text>
      <Body style={{ color: colors.bone }}>{PRIVACY_INTRO}</Body>
      {PRIVACY_SECTIONS.map((s) => (
        <Stack key={s.id} gap={space.sm}>
          <H2>{s.heading}</H2>
          {s.blocks.map((b, i) =>
            typeof b === 'string' ? (
              <Body key={i} selectable>
                {b}
              </Body>
            ) : (
              <Stack key={i} gap={space.sm}>
                {b.points.map((p) => (
                  <Row key={p} style={{ gap: space.sm, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.redBright, marginTop: 8 }} />
                    <Body selectable style={{ flex: 1 }}>
                      {p}
                    </Body>
                  </Row>
                ))}
              </Stack>
            ),
          )}
        </Stack>
      ))}
      <Stack gap={space.sm}>
        <Button
          label="Email us"
          icon="mail-outline"
          kind="secondary"
          onPress={() => Linking.openURL(`mailto:${PRIVACY_EMAIL}`).catch(() => {})}
        />
        <Button label="Open it on the web" icon="open-outline" kind="quiet" onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})} />
        <Small style={{ textAlign: 'center' }}>{PRIVACY_EMAIL}</Small>
      </Stack>
    </Screen>
  );
}
