// Share a ride to Messenger, a text and the like. A browser with no share sheet shows the text to
// copy instead, so the button never quietly does nothing.

import React, { useState } from 'react';
import { Share } from 'react-native';
import { rideShareText } from '../domain/share';
import type { Ride } from '../domain/types';
import { Body, Button, Notice, Stack } from '../ui/primitives';
import { space } from '../theme';

export function ShareRideButton({ ride }: { ride: Ride }) {
  const [copy, setCopy] = useState<string | null>(null);
  const message = rideShareText(ride);
  const share = async () => {
    try {
      await Share.share({ message });
    } catch (e) {
      // Closing the browser's share sheet isn't a failure.
      if ((e as Error)?.name !== 'AbortError') setCopy(message);
    }
  };
  return (
    <Stack gap={space.sm}>
      <Button label="Share this ride" icon="share-outline" kind="secondary" onPress={share} />
      {copy ? (
        <Notice title="Copy this">
          <Body selectable>{copy}</Body>
        </Notice>
      ) : null}
    </Stack>
  );
}
