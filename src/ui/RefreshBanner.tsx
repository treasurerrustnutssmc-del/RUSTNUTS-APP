// A thin strip across the top when a refresh fails but the member's data is still on screen,
// so pulling down or saving with no signal never fails silently.

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClub } from '../data/ClubStore';
import { offlineText } from '../data/offlineCache';
import { colors, fonts, space } from '../theme';
import { Small } from './primitives';

export function RefreshBanner() {
  const { refreshError, refresh, savedAt } = useClub();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  if (!refreshError) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{
        paddingTop: insets.top + space.sm,
        paddingBottom: space.sm,
        paddingHorizontal: space.lg,
        backgroundColor: colors.dangerBg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
      }}
    >
      <Ionicons name="cloud-offline-outline" size={18} color={colors.danger} />
      <Small style={{ flex: 1, color: colors.bone }}>{savedAt ? offlineText(savedAt) : 'Couldn’t refresh the club data.'}</Small>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try refreshing again"
        hitSlop={12}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          await refresh().catch(() => {});
          setBusy(false);
        }}
      >
        {busy ? (
          <ActivityIndicator color={colors.redText} />
        ) : (
          <Text style={{ fontFamily: fonts.stencil, color: colors.redText, fontSize: 15 }}>Try again</Text>
        )}
      </Pressable>
    </View>
  );
}
