// The Notifications section on Me. Ride reminders work now (the phone sets them itself); the rest
// are pushes from the club, which start when the app launches, so members can choose ahead of time.

import React, { useState } from 'react';
import { useClub } from '../data/ClubStore';
import { DEFAULT_PREFS } from '../domain/notifications';
import type { NotificationPrefs } from '../domain/types';
import { space } from '../theme';
import { Card, Notice, SectionTitle, Small, Stack, Toggle } from '../ui/primitives';

export function NotificationSettings() {
  const { data, level, saveNotificationPrefs } = useClub();
  const saved = data.notificationPrefs ?? DEFAULT_PREFS;
  // Shows the change straight away, and goes back if it doesn't save.
  const [shown, setShown] = useState<NotificationPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prefs = shown ?? saved;
  const board = level === 'board' || level === 'national';

  const change = (key: keyof NotificationPrefs) => (value: boolean) => {
    if (!saveNotificationPrefs) return;
    const next = { ...prefs, [key]: value };
    setShown(next);
    setError(null);
    saveNotificationPrefs(next)
      .then(() => setShown(null))
      .catch((e) => {
        setShown(null);
        setError(`Couldn’t change that: ${(e as Error).message}`);
      });
  };

  return (
    <Stack gap={space.sm}>
      <SectionTitle title="Notifications" />
      <Card>
        <Toggle
          label="Ride reminders"
          description="A reminder 2 hours before rides you’re going to."
          value={prefs.rideReminders}
          onChange={change('rideReminders')}
        />
        <Toggle
          label="Ride changes"
          description="When a ride you’re going to changes time or is cancelled."
          value={prefs.rideChanges}
          onChange={change('rideChanges')}
        />
        <Toggle
          label="New rides"
          description="When a ride is added in your colours."
          value={prefs.newRides}
          onChange={change('newRides')}
        />
        {board ? (
          <Toggle
            label="Waiting for approval"
            description="When someone in your chapter is waiting for approval."
            value={prefs.approvals}
            onChange={change('approvals')}
          />
        ) : null}
        <Small>Reminders work now. The rest start when the app launches.</Small>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </Card>
    </Stack>
  );
}
