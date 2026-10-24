// A route's shape: its simplified line on a dark steel tile, with a green start dot and a square
// finish, so a loop that ends where it began still shows both. No map tiles (that needs a map
// provider and a key); the shape, distance and stops are enough to know which ride it is.

import React, { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polyline, Rect } from 'react-native-svg';
import { formatKm } from '../domain/routes';
import { projectLine } from '../domain/routeShape';
import type { Route } from '../domain/types';
import { colors, fonts, radius, space } from '../theme';

type Shape = Pick<Route, 'line' | 'bounds' | 'distanceM'>;

const THUMB = 56;
/** The full shape's height as a share of its width. */
const ASPECT = 0.62;

function Drawing({ route, width, height, thumb }: { route: Shape; width: number; height: number; thumb: boolean }) {
  const pad = thumb ? 7 : 18;
  const pts = projectLine(route.line, route.bounds, width, height, pad);
  if (pts.length === 0) return null;
  const points = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [sx, sy] = pts[0];
  const [fx, fy] = pts[pts.length - 1];
  const stroke = thumb ? 2 : 3;
  const dot = thumb ? 3.5 : 6.5;
  const square = thumb ? 9 : 15;
  return (
    <Svg width={width} height={height}>
      {/* An ink edge under the line keeps it crisp where it crosses itself. */}
      <Polyline points={points} fill="none" stroke={colors.ink} strokeWidth={stroke + 2.5} strokeLinejoin="round" strokeLinecap="round" />
      <Polyline points={points} fill="none" stroke={colors.bone} strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round" />
      {/* Finish first, a little bigger, so a start on top of it still leaves the square showing. */}
      <Rect
        x={fx - square / 2}
        y={fy - square / 2}
        width={square}
        height={square}
        fill={colors.ink}
        stroke={colors.bone}
        strokeWidth={thumb ? 1.5 : 2}
      />
      <Circle cx={sx} cy={sy} r={dot} fill={colors.ok} stroke={colors.ink} strokeWidth={thumb ? 1.5 : 2} />
    </Svg>
  );
}

/**
 * The route's shape. `thumb` is a small square for list rows (hidden from screen readers, since
 * the row says what it is); otherwise it fills the width, with a start and finish key under it.
 */
export function RouteShape({ route, thumb = false, size = THUMB }: { route: Shape; thumb?: boolean; size?: number }) {
  const [width, setWidth] = useState(0);
  if (thumb) {
    return (
      <View style={[styles.tile, { width: size, height: size }]} aria-hidden importantForAccessibility="no-hide-descendants">
        <Drawing route={route} width={size} height={size} thumb />
      </View>
    );
  }
  const height = Math.round(width * ASPECT);
  return (
    <View style={{ gap: space.sm }}>
      <View
        // One image to a screen reader on phones; on the web the role does that without a tab stop.
        accessible={Platform.OS !== 'web'}
        accessibilityRole="image"
        role="img"
        accessibilityLabel={`Route shape, ${formatKm(route.distanceM)}`}
        aria-label={`Route shape, ${formatKm(route.distanceM)}`}
        onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}
        style={[styles.tile, { height: height || undefined, aspectRatio: width ? undefined : 1 / ASPECT }]}
      >
        {width > 0 ? <Drawing route={route} width={width} height={height} thumb={false} /> : null}
      </View>
      <View style={styles.key} aria-hidden importantForAccessibility="no-hide-descendants">
        <View style={styles.keyItem}>
          <View style={styles.keyStart} />
          <Text style={styles.keyText}>Start</Text>
        </View>
        <View style={styles.keyItem}>
          <View style={styles.keyFinish} />
          <Text style={styles.keyText}>Finish</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.steel, borderRadius: radius.sm, overflow: 'hidden', width: '100%' },
  key: { flexDirection: 'row', gap: space.lg },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keyStart: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.ok },
  keyFinish: { width: 12, height: 12, borderWidth: 2, borderColor: colors.bone, backgroundColor: colors.ink },
  keyText: { fontFamily: fonts.stencil, fontSize: 13, letterSpacing: 0.6, color: colors.boneMute, textTransform: 'uppercase' },
});
