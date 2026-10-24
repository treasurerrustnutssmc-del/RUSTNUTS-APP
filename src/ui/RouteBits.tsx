// The pieces the route screens share: the chapter chip, distance and climb, the stops, a library
// row, and the button that hands a route to a maps app.

import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { openInMapsApp } from '../data/routeFiles';
import { formatClimb, formatKm, routeChapterName } from '../domain/routes';
import type { ClubData, Route } from '../domain/types';
import { colors, fonts, radius, rideColors, space, type } from '../theme';
import { Button, Card, Chip, Ionicons, Notice, Row, Small, Stack } from './primitives';
import { RouteShape } from './RouteShape';

/** The chapter a route is filed under, in the ride key's colours: North, West, or Whole club. */
export function chapterColours(chapterId: string | null, data: ClubData) {
  const slug = chapterId ? data.chapters.find((c) => c.id === chapterId)?.slug : undefined;
  return slug === 'north' || slug === 'west' ? rideColors[slug] : rideColors.club;
}

export function ChapterChip({ chapterId, data }: { chapterId: string | null; data: ClubData }) {
  const c = chapterColours(chapterId, data);
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      <Text style={[styles.chipText, { color: c.fg }]}>{routeChapterName(chapterId, data)}</Text>
    </View>
  );
}

/** "84.2 km · 643 m climb", the climb only when the file had heights. */
export function routeFacts(route: Pick<Route, 'distanceM' | 'climbM'>): string {
  const climb = formatClimb(route.climbM);
  return climb ? `${formatKm(route.distanceM)} · ${climb} climb` : formatKm(route.distanceM);
}

/** Distance and climb as the ride screen's fact lines, with icons. */
export function RouteFacts({ route }: { route: Pick<Route, 'distanceM' | 'climbM'> }) {
  const climb = formatClimb(route.climbM);
  return (
    <Row style={{ gap: space.lg }}>
      <Row style={styles.fact}>
        <Ionicons name="navigate-outline" size={18} color={colors.boneMute} />
        <Text style={styles.factText}>{formatKm(route.distanceM)}</Text>
      </Row>
      {climb ? (
        <Row style={styles.fact}>
          <Ionicons name="trending-up-outline" size={18} color={colors.boneMute} />
          <Text style={styles.factText}>{`${climb} climb`}</Text>
        </Row>
      ) : null}
    </Row>
  );
}

/** The route's stops, numbered in the order the file lists them. */
export function StopList({ stops, flat = false }: { stops: Route['stops']; flat?: boolean }) {
  if (stops.length === 0) return null;
  const rows = stops.map((s, i) => (
    <View key={`${i}-${s.name}`} style={[styles.stop, i === stops.length - 1 && { borderBottomWidth: 0 }]}>
      <View style={styles.stopTile}>
        <Text style={styles.stopNumber}>{i + 1}</Text>
      </View>
      <Text style={[type.name, { flex: 1 }]}>{s.name}</Text>
    </View>
  ));
  return flat ? <View>{rows}</View> : <Card style={{ padding: 0, gap: 0 }}>{rows}</Card>;
}

/** One route in a list: its shape, name, chapter and distance. */
export function RouteRow({
  route,
  data,
  last,
  onPress,
  current = false,
  saving = false,
  disabled = false,
  error = null,
}: {
  route: Route;
  data: ClubData;
  last: boolean;
  onPress: () => void;
  /** It's already on this ride (pick route). */
  current?: boolean;
  saving?: boolean;
  disabled?: boolean;
  error?: string | null;
}) {
  const label = [route.name, routeChapterName(route.chapterId, data), routeFacts(route), current ? 'on this ride now' : null]
    .filter(Boolean)
    .join(', ');
  const off = current || disabled;
  return (
    <View style={[styles.item, last && { borderBottomWidth: 0 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: off, busy: saving }}
        aria-disabled={off}
        aria-busy={saving}
        disabled={off || saving}
        onPress={onPress}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.row,
          !off && (pressed || hovered) && { backgroundColor: colors.steel },
          disabled && { opacity: 0.45 },
        ]}
      >
        <RouteShape route={route} thumb />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text numberOfLines={2} style={type.name}>
            {route.name}
          </Text>
          <Text style={styles.distance}>{routeFacts(route)}</Text>
          <Row style={{ gap: 6 }}>
            <ChapterChip chapterId={route.chapterId} data={data} />
            {current ? <Chip label="On this ride" tone="ok" icon="checkmark" /> : null}
          </Row>
        </View>
        {saving ? (
          <ActivityIndicator size="small" color={colors.bone} />
        ) : current ? null : (
          <Ionicons name="chevron-forward" size={18} color={colors.boneMute} />
        )}
      </Pressable>
      <View accessibilityLiveRegion="polite" role="alert" style={error ? styles.rowError : undefined}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </View>
    </View>
  );
}

const ON_WEB = Platform.OS === 'web';

/**
 * Hands the route to a maps app: the share sheet on a phone, where OsmAnd and MyRoute both take
 * GPX files, or a download on the web.
 */
export function OpenInMapsButton({ route, kind = 'primary' }: { route: Pick<Route, 'id' | 'name'>; kind?: 'primary' | 'secondary' }) {
  const { routeGpx } = useClub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await openInMapsApp(route.name, await routeGpx(route.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap={space.sm}>
      <Button
        label={ON_WEB ? 'Download GPX' : 'Open in maps app'}
        icon={ON_WEB ? 'download-outline' : 'share-outline'}
        kind={kind}
        busy={busy}
        accessibilityLabel={ON_WEB ? `Download ${route.name} as a GPX file` : `Open ${route.name} in a maps app`}
        onPress={open}
      />
      <Small>
        {ON_WEB
          ? 'Saves the GPX file. Open it in OsmAnd or MyRoute to ride it.'
          : 'Pick OsmAnd or MyRoute from the share sheet. It stays there offline.'}
      </Small>
      <View accessibilityLiveRegion="polite" role="alert">
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </View>
    </Stack>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.sm, alignSelf: 'flex-start' },
  chipText: { fontFamily: fonts.stencil, fontSize: 11.5, letterSpacing: 1, textTransform: 'uppercase' },
  fact: { gap: space.sm, flexWrap: 'nowrap' },
  factText: { fontFamily: fonts.stencil, fontSize: 16, lineHeight: 22, letterSpacing: 0.4, color: colors.boneDim, fontVariant: ['tabular-nums'] },
  distance: { fontFamily: fonts.stencil, fontSize: 14, lineHeight: 18, letterSpacing: 0.4, color: colors.boneDim, fontVariant: ['tabular-nums'] },
  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  stopTile: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.steel, borderRadius: radius.sm },
  stopNumber: { fontFamily: fonts.stencil, fontSize: 15, color: colors.bone, fontVariant: ['tabular-nums'] },
  item: { borderBottomWidth: 1, borderBottomColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 72, padding: space.md },
  rowError: { paddingHorizontal: space.md, paddingBottom: space.md },
});
