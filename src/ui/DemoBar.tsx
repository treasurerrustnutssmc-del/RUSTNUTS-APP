import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClub } from '../data/ClubStore';
import { DEMO_PERSONAS } from '../data/demoData';
import { colors, fonts, space } from '../theme';

/** Strip across the top of the demo build: switch who you're viewing the app as. */
export function DemoBar() {
  const { me, signInAs } = useClub();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      <Text style={styles.tag}>Demo</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {DEMO_PERSONAS.map((p) => {
          const active = p.memberId === (me?.id ?? null);
          return (
            <Pressable
              key={p.level}
              accessibilityRole="button"
              accessibilityLabel={`View as ${p.label}: ${p.blurb}`}
              accessibilityState={{ selected: active }}
              onPress={() => signInAs(p.memberId)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#0a0908',
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: 6,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  tag: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.warn,
  },
  chips: { gap: 6, alignItems: 'center' },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  chipActive: { backgroundColor: colors.warn, borderColor: colors.warn },
  chipText: { fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: colors.boneDim },
  chipTextActive: { color: colors.ink },
});
