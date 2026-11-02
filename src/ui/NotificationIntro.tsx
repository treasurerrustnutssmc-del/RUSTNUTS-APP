// The notifications explainer on Home: says what notifications are for, once, before the phone's own
// prompt. "Turn on notifications" brings the prompt up; "Not now" puts the card away for good on this
// phone (the Notifications section on Me can still ask).

import * as Notifications from 'expo-notifications';
import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { ensureChannels } from '../data/notificationChannels';
import { setIntroAnswer, useIntroAnswer } from '../data/notifyIntro';
import { NOTIFY_INTRO, showNotifyIntro } from '../domain/notifyIntro';
import { space } from '../theme';
import { Body, Button, Card, Chip, H2, Row } from './primitives';

const ICONS = ['alarm-outline', 'radio-outline', 'chatbubbles-outline'] as const;

export function NotificationIntroCard() {
  const answer = useIntroAnswer();
  const [permission, setPermission] = useState<{ granted: boolean; canAskAgain: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let live = true;
    Notifications.getPermissionsAsync().then(
      (p) => live && setPermission(p),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  if (!showNotifyIntro({ os: Platform.OS, permission, answer })) return null;

  const turnOn = async () => {
    setBusy(true);
    // Android 13 only shows the prompt once a channel exists.
    await ensureChannels().catch(() => undefined);
    await Notifications.requestPermissionsAsync().catch(() => null);
    // The ride reminders sync again on the answer, and save this phone's push token for chat and alerts.
    await setIntroAnswer('on');
  };

  return (
    <Card>
      <H2>{NOTIFY_INTRO.title}</H2>
      <Row style={{ gap: space.sm, flexWrap: 'wrap' }}>
        {NOTIFY_INTRO.points.map((label, i) => (
          <Chip key={label} label={label} icon={ICONS[i]} tone="bone" />
        ))}
      </Row>
      <Body>{NOTIFY_INTRO.body}</Body>
      <Button label={NOTIFY_INTRO.turnOn} icon="notifications-outline" busy={busy} onPress={turnOn} />
      <Button label={NOTIFY_INTRO.notNow} kind="quiet" disabled={busy} onPress={() => setIntroAnswer('later')} />
    </Card>
  );
}
