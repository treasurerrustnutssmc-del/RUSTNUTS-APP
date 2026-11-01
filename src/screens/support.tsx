import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { SUPPORT_URL } from '../domain/clubLinks';
import { SUPPORT_GROUPS, smsUrl, telUrl, type SupportLine } from '../domain/supportLines';
import { colors, space, type } from '../theme';
import { Body, Button, Card, H1, Notice, Row, Screen, SectionTitle, Small, Stack } from '../ui/primitives';

type Open = (url: string, number: string) => void;

function LineCard({ line, open }: { line: SupportLine; open: Open }) {
  return (
    <Card>
      <Stack gap={4}>
        <Text style={type.name}>{line.name}</Text>
        <Small>{line.detail}</Small>
      </Stack>
      <Row style={{ gap: space.sm }}>
        <Button
          label={`Call ${line.phone}`}
          icon="call-outline"
          kind="secondary"
          onPress={() => open(telUrl(line.phone), line.phone)}
          accessibilityLabel={`Call ${line.name} on ${line.phone}`}
          style={{ flexGrow: 1 }}
        />
        {line.text ? (
          <Button
            label="Text"
            icon="chatbubble-outline"
            kind="quiet"
            onPress={() => open(smsUrl(line.text!), line.text!)}
            accessibilityLabel={`Text ${line.name} on ${line.text}`}
          />
        ) : null}
      </Row>
    </Card>
  );
}

/**
 * No one rides alone: the 24/7 lines, inside the app so they work offline and when the website is
 * down. The website's Support page has the longer list (legal, rider training, money).
 */
export function SupportScreen() {
  // A tablet or computer can't always call or text, so say which number to dial instead of doing nothing.
  const [failed, setFailed] = useState<string | null>(null);
  const open: Open = (url, number) => {
    setFailed(null);
    Linking.openURL(url).catch(() => setFailed(`This device can’t call or text from here. Dial ${number} on a phone.`));
  };
  return (
    <Screen>
      <H1>No one rides alone</H1>
      <Body style={{ color: colors.bone }}>
        Free, confidential and there any time, day or night. You don’t have to be in crisis to call. Reaching out is strength, not weakness.
      </Body>
      <Notice tone="danger" title="In an emergency">
        <Stack gap={space.sm}>
          <Small style={{ color: colors.boneDim }}>If you or someone else is in danger right now, call 000.</Small>
          <Button label="Call 000" icon="call" onPress={() => open('tel:000', '000')} />
        </Stack>
      </Notice>
      {failed ? (
        <View accessibilityLiveRegion="polite" role="alert">
          <Notice tone="warn">{failed}</Notice>
        </View>
      ) : null}
      {SUPPORT_GROUPS.map((g) => (
        <React.Fragment key={g.title}>
          <SectionTitle title={g.title} />
          {g.lines.map((line) => (
            <LineCard key={line.id} line={line} open={open} />
          ))}
        </React.Fragment>
      ))}
      <SectionTitle title="More help" />
      <Card>
        <Small>Legal help, TAC claims, rider training, ambulance cover, money and gambling help are on the club website’s Support page.</Small>
        <Button label="Support page on the website" icon="open-outline" kind="secondary" onPress={() => Linking.openURL(SUPPORT_URL).catch(() => {})} />
      </Card>
      <Small style={{ textAlign: 'center' }}>
        Shared in good faith; these services aren’t run by the club and aren’t a substitute for professional advice. Check details with each service.
      </Small>
    </Screen>
  );
}
