// WillyWeather's credit: their name and logo, linked to their site. Their API terms ask for it as the
// app loads, in the app's About part (Me › Help) and wherever their forecast shows (the ride card).

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from '../theme';
import { ListRow } from './primitives';
import { openLink } from './openLink';

export const WILLYWEATHER_URL = 'https://www.willyweather.com.au/';
const LOGO = require('../../assets/credits/willyweather.png');

const open = () => openLink(WILLYWEATHER_URL).catch(() => {});

/** The logo and name, as one link. `size`: the logo's height. */
export function WillyWeatherCredit({ size = 20, label = 'Forecast by WillyWeather, open their site' }: { size?: number; label?: string }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} hitSlop={{ top: 8, bottom: 8, left: 4, right: 12 }} onPress={open} style={styles.link}>
      <Image source={LOGO} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />
      <Text style={[styles.name, { fontSize: Math.max(13, size * 0.7) }]}>WillyWeather</Text>
    </Pressable>
  );
}

/** While the app loads: "Ride weather by" and the credit, small, at the foot of the screen. */
export function WillyWeatherLoadingCredit() {
  return (
    <View style={styles.loading}>
      <Text style={styles.by}>Ride weather by</Text>
      <WillyWeatherCredit size={18} />
    </View>
  );
}

/** The About row under Me › Help. */
export function WillyWeatherAboutRow({ last }: { last?: boolean }) {
  return (
    <ListRow
      last={last}
      left={
        <View style={styles.badge}>
          <Image source={LOGO} style={{ width: 24, height: 24 }} accessibilityIgnoresInvertColors />
        </View>
      }
      title="Ride weather by WillyWeather"
      subtitle="Forecasts from Bureau of Meteorology data, gusts from Open-Meteo"
      accessibilityLabel="Ride weather by WillyWeather, from Bureau of Meteorology data, gusts from Open-Meteo. Opens their site."
      onPress={open}
    />
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  name: { fontFamily: fonts.body, fontWeight: '600', color: colors.boneDim, textDecorationLine: 'underline' },
  loading: { position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center', gap: 2 },
  by: { fontFamily: fonts.body, fontSize: 13, color: colors.boneMute },
  badge: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.bone, alignItems: 'center', justifyContent: 'center' },
});
