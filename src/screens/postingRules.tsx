// The club rules for chats and posts (App Review Guideline 1.2). An approved member who hasn't
// agreed yet sees this instead of the tabs, with one button: I agree. Afterwards it's a page off
// Me's Privacy section, the same text as the public web page.

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import {
  POSTING_RULES_EMAIL,
  POSTING_RULES_INTRO,
  POSTING_RULES_SECTIONS,
  POSTING_RULES_TITLE,
  POSTING_RULES_URL,
  postingRulesUpdatedLine,
  needsPostingRules,
} from '../domain/postingRules';
import type { RootParams } from '../navigation/types';
import { colors, space, type } from '../theme';
import { Body, Button, Card, H1, H2, IconBadge, ListRow, Notice, Row, Screen, Small, Stack } from '../ui/primitives';
import { PrivacyPolicyRow } from './privacy';

type Nav = NavigationProp<RootParams>;

/** A row that opens the rules, under Privacy on Me. */
export function PostingRulesRow() {
  const navigation = useNavigation<Nav>();
  return (
    <Card style={{ padding: 0, gap: 0 }}>
      <ListRow
        last
        left={<IconBadge icon="chatbubbles-outline" />}
        title={POSTING_RULES_TITLE}
        subtitle="What you agreed to before posting"
        onPress={() => navigation.navigate('PostingRules')}
      />
    </Card>
  );
}

function RulesText() {
  return (
    <>
      <Text style={[type.name, { color: colors.boneMute }]}>{postingRulesUpdatedLine()}</Text>
      <Body style={{ color: colors.bone }}>{POSTING_RULES_INTRO}</Body>
      {POSTING_RULES_SECTIONS.map((s) => (
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
    </>
  );
}

/**
 * The rules. Before a member has agreed, this is the whole app: the rules, I agree, and the ways
 * out (privacy policy, sign out, delete my account). Afterwards it's just the text.
 */
export function PostingRulesScreen() {
  const navigation = useNavigation<Nav>();
  const { me, acceptPostingRules, signOut } = useClub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gate = needsPostingRules(me);
  const agree = () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    acceptPostingRules()
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  return (
    <Screen padTop={gate}>
      {gate ? (
        <Stack gap={space.sm}>
          <H1>{POSTING_RULES_TITLE}</H1>
          <Body>Read these once and agree, and the chats and posts open up. Every member does the same.</Body>
        </Stack>
      ) : null}
      <RulesText />
      {gate ? (
        <Stack gap={space.sm}>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button label="I agree" icon="checkmark-circle-outline" busy={busy} onPress={agree} />
          <Small style={{ textAlign: 'center' }}>Agreeing is recorded against your membership with today’s date.</Small>
        </Stack>
      ) : null}
      <Stack gap={space.sm}>
        <Button
          label="Email us"
          icon="mail-outline"
          kind="secondary"
          onPress={() => Linking.openURL(`mailto:${POSTING_RULES_EMAIL}`).catch(() => {})}
        />
        <Button label="Open it on the web" icon="open-outline" kind="quiet" onPress={() => Linking.openURL(POSTING_RULES_URL).catch(() => {})} />
        <Small style={{ textAlign: 'center' }}>{POSTING_RULES_EMAIL}</Small>
      </Stack>
      {gate ? (
        <>
          <PrivacyPolicyRow />
          <Button label="Sign out" kind="secondary" icon="log-out-outline" onPress={() => signOut()} />
          <Button label="Delete my account" kind="quiet" onPress={() => navigation.navigate('DeleteAccount')} />
        </>
      ) : null}
    </Screen>
  );
}
