// The club's own banner for a notification that arrives while the app is open (a chat message, ride
// news, a reply), since Android's chat and club channels don't pop up over an open app. It drops in at
// the top over whatever screen is open, plays the bike (src/data/foregroundNotifications.ts), and goes
// after a few seconds. Tapping it opens what it's about; the cross puts it away. Never for the chat
// that's on screen.

import { Ionicons } from '@expo/vector-icons';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClub } from '../data/ClubStore';
import { presentIncoming, type IncomingNotice } from '../data/foregroundNotifications';
import { DEFAULT_PREFS, notificationTarget } from '../domain/notifications';
import type { RootParams } from '../navigation/types';
import { colors, fonts, space, type } from '../theme';

/** Long enough to read a line at a glance; longer with a screen reader. */
const SHOW_MS = 6_000;
const SHOW_MS_READER = 12_000;

export function IncomingBanner({ navigation }: { navigation: NavigationContainerRefWithCurrent<RootParams> }) {
  const { me, isDemo, data } = useClub();
  const revSound = (data.notificationPrefs ?? DEFAULT_PREFS).revSound;
  const [notice, setNotice] = useState<IncomingNotice | null>(null);
  const insets = useSafeAreaInsets();
  const [drop] = useState(() => new Animated.Value(0));
  const [reader, setReader] = useState(false);
  const [calm, setCalm] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setReader).catch(() => undefined);
    AccessibilityInfo.isReduceMotionEnabled().then(setCalm).catch(() => undefined);
  }, []);

  // Only for a signed-in member on a real phone; the demo's club is made up.
  const on = (Platform.OS === 'ios' || Platform.OS === 'android') && !!me && !isDemo;
  useEffect(() => {
    if (!on) return undefined;
    return presentIncoming(setNotice, revSound);
  }, [on, revSound]);
  useEffect(() => {
    if (!notice) return undefined;
    drop.setValue(calm ? 1 : 0);
    if (!calm) Animated.timing(drop, { toValue: 1, duration: 220, easing: Easing.out(Easing.exp), useNativeDriver: true }).start();
    AccessibilityInfo.announceForAccessibility(`${notice.title}. ${notice.body}`);
    const timer = setTimeout(() => setNotice((n) => (n?.id === notice.id ? null : n)), reader ? SHOW_MS_READER : SHOW_MS);
    return () => clearTimeout(timer);
  }, [notice, calm, reader, drop]);

  // Signed out with one still up: it goes.
  if (!notice || !on) return null;
  const target = notificationTarget(notice.data);
  const open = () => {
    setNotice(null);
    if (target && navigation.isReady()) navigation.navigate(target.screen, target.params as never);
  };
  const icon = notice.data.kind === 'chat' ? 'chatbubbles-outline' : 'notifications-outline';

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { opacity: drop, transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }] },
      ]}
    >
      <View style={[styles.banner, { paddingTop: insets.top + space.sm }]} accessibilityLiveRegion="polite">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${notice.title}. ${notice.body}`}
          accessibilityHint={target ? 'Opens it' : undefined}
          onPress={open}
          style={({ pressed }) => [styles.main, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name={icon} size={20} color={colors.redText} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.name, { color: colors.bone }]} numberOfLines={1}>
              {notice.title}
            </Text>
            {notice.body ? (
              <Text style={styles.body} numberOfLines={2}>
                {notice.body}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={() => setNotice(null)}
          hitSlop={4}
          style={({ pressed }) => [styles.close, pressed && { backgroundColor: colors.steelHi }]}
        >
          <Ionicons name="close" size={20} color={colors.boneMute} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingBottom: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    backgroundColor: colors.steel,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineStrong,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: space.md, minHeight: 44, paddingVertical: 2 },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.boneDim },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
});
