// Lane E: share in. A thin strip across the top for anyone without "Share to the club" (signed out,
// asking to join, waiting for approval, family) when something is shared in from another app, so it
// never opens nothing and says nothing. Sits where the refresh strip does, on every screen.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { AccessibilityInfo, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { waitingShareNote, type ShareWaitStage } from '../domain/shareIn';
import { colors, fonts, space, type } from '../theme';
import { Small } from './primitives';

export function ShareWaitingStrip({ stage, dismiss, padTop }: { stage: ShareWaitStage; dismiss: () => void; padTop: boolean }) {
  const insets = useSafeAreaInsets();
  const { title, text, action } = waitingShareNote(stage);
  // It turns up as the app comes to the front, so screen readers are told once they've finished
  // reading out the screen (queued on iPhone; Android reads it in turn anyway).
  useEffect(() => {
    const message = `${title}. ${text}`;
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
    else AccessibilityInfo.announceForAccessibility(message); // the web has no queued version
  }, [title, text]);
  return (
    <View
      accessibilityRole="alert"
      style={{
        paddingTop: (padTop ? insets.top : 0) + space.sm,
        paddingBottom: space.sm,
        paddingHorizontal: space.lg,
        backgroundColor: colors.steel,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space.md,
      }}
    >
      <Ionicons name="share-outline" size={18} color={colors.boneDim} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.name, { color: colors.bone }]}>{title}</Text>
        <Small style={{ color: colors.boneDim }}>{text}</Small>
      </View>
      {/* Quiet, so the screen's own red stays the one that matters. */}
      <Pressable accessibilityRole="button" accessibilityLabel={action} hitSlop={12} onPress={dismiss} style={{ marginTop: 2 }}>
        <Text style={{ fontFamily: fonts.stencil, color: colors.boneDim, fontSize: 15 }}>{action}</Text>
      </Pressable>
    </View>
  );
}
