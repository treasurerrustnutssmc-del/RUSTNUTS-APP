// Lane E: share in. A thin strip across the top for anyone without "Share to the club" (signed out,
// asking to join, waiting for approval, family) when something is shared in from another app, so it
// never opens nothing and says nothing. Sits where the refresh strip does, on every screen.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keepsShare, waitingShareNote, type ShareWaitStage } from '../domain/shareIn';
import { colors, fonts, space } from '../theme';
import { Small } from './primitives';

export function ShareWaitingStrip({ stage, dismiss, padTop }: { stage: ShareWaitStage; dismiss: () => void; padTop: boolean }) {
  const insets = useSafeAreaInsets();
  const { title, text } = waitingShareNote(stage);
  // It turns up on whatever screen is open, so screen readers are told straight away.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`${title}. ${text}`);
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
        alignItems: 'center',
        gap: space.md,
      }}
    >
      <Ionicons name="share-outline" size={18} color={colors.boneDim} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: fonts.stencil, color: colors.bone, fontSize: 15, lineHeight: 20 }}>{title}</Text>
        <Small style={{ color: colors.boneDim }}>{text}</Small>
      </View>
      {/* A signed-out share goes once they sign in; the others were let go, so the strip can be too. */}
      {keepsShare(stage) ? null : (
        <Pressable accessibilityRole="button" accessibilityLabel="Got it, hide this" hitSlop={12} onPress={dismiss}>
          <Text style={{ fontFamily: fonts.stencil, color: colors.redText, fontSize: 15 }}>Got it</Text>
        </Pressable>
      )}
    </View>
  );
}
