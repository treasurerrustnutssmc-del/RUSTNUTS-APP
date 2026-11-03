// "Update ready": a thin strip across the top once an update has downloaded, with one tap to restart
// into it, so nobody has to close and open the app twice. Sits where the refresh strip does.

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { updateApi } from '../data/appUpdate';
import { REOPEN, UPDATE_READY_ACTION, UPDATE_READY_TEXT, UPDATE_READY_TITLE, restartNow } from '../domain/appUpdate';
import { colors, fonts, space, type } from '../theme';
import { Small } from './primitives';

export function UpdateReadyStrip({ padTop }: { padTop: boolean }) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [stuck, setStuck] = useState(false);
  const restart = () => {
    if (busy) return;
    setBusy(true);
    setStuck(false);
    void restartNow(updateApi).then((out) => {
      if (out.kind === 'downloaded') {
        setBusy(false);
        setStuck(true);
      }
    });
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${UPDATE_READY_TITLE}. ${UPDATE_READY_ACTION}`}
      accessibilityHint="Restarts the app into the new version"
      onPress={restart}
      disabled={busy}
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
      <Ionicons name="cloud-download-outline" size={18} color={colors.boneDim} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.name, { color: colors.bone }]}>{UPDATE_READY_TITLE}</Text>
        <Small style={{ color: stuck ? colors.danger : colors.boneDim }}>{stuck ? REOPEN : UPDATE_READY_TEXT}</Small>
      </View>
      {busy ? (
        <ActivityIndicator color={colors.redText} />
      ) : (
        <Text style={{ fontFamily: fonts.stencil, color: colors.redText, fontSize: 15 }}>{UPDATE_READY_ACTION}</Text>
      )}
    </Pressable>
  );
}
