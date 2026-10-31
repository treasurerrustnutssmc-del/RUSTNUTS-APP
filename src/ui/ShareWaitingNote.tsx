// Lane E: share in. Before someone can use "Share to the club" (signed out, waiting for approval, or
// family), a share from another app opens nothing, so this note says why and what happens next.

import React from 'react';
import { View } from 'react-native';
import { useShareWaiting } from '../data/shareIn';
import { waitingShareNote, type ShareWaitStage } from '../domain/shareIn';
import { Notice } from './primitives';

export function ShareWaitingNote({ stage }: { stage: ShareWaitStage }) {
  const waiting = useShareWaiting();
  if (!waiting) return null;
  const { title, text } = waitingShareNote(stage);
  return (
    <View accessibilityLiveRegion="polite">
      <Notice title={title}>{text}</Notice>
    </View>
  );
}
