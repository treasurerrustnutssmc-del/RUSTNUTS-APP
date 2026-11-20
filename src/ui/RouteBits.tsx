// The pieces the route screens share: the chapter chip, distance and climb, the stops, a library
// row, and the button that hands a route to a maps app.

import React, { useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { openInMapsApp, sendToGarmin } from '../data/routeFiles';
import { whereAmI } from '../data/whereAmI';
import { formatClimb, formatKm, routeChapterName } from '../domain/routes';
import { routeScore, starsLine } from '../domain/ratings';
import { followApps, followRouteOptions, navigateOptions, routeAhead, type NavApp } from '../domain/rideMap';
import type { ClubData, LatLng, Route } from '../domain/types';
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

/** The route's stops (or a ride's planned ones, with a detail line), numbered in order. */
export function StopList({ stops, flat = false }: { stops: { name: string; detail?: string }[]; flat?: boolean }) {
  if (stops.length === 0) return null;
  const rows = stops.map((s, i) => (
    <View key={`${i}-${s.name}`} style={[styles.stop, i === stops.length - 1 && { borderBottomWidth: 0 }]}>
      <View style={styles.stopTile}>
        <Text style={styles.stopNumber}>{i + 1}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={type.name}>{s.name}</Text>
        {s.detail ? <Text style={styles.stopDetail}>{s.detail}</Text> : null}
      </View>
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
  const stars = starsLine(routeScore(route.id, data.routeRatings));
  const label = [route.name, routeChapterName(route.chapterId, data), routeFacts(route), stars, current ? 'on this ride now' : null]
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
          <Text style={type.name}>
            {route.name}
          </Text>
          <Text style={styles.distance}>{routeFacts(route)}</Text>
          <Text style={styles.stars}>{stars}</Text>
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
 * A button that fetches the route's GPX and hands it on with `send`, showing what went wrong
 * underneath when it can't.
 */
function GpxHandOffButton({
  route,
  send,
  label,
  icon,
  accessibilityLabel,
  help,
  kind,
}: {
  route: Pick<Route, 'id' | 'name'>;
  send: (name: string, gpx: string) => Promise<void>;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  accessibilityLabel: string;
  help: string;
  kind: 'primary' | 'secondary';
}) {
  const { routeGpx } = useClub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await send(route.name, await routeGpx(route.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap={space.sm}>
      <Button label={label} icon={icon} kind={kind} busy={busy} accessibilityLabel={accessibilityLabel} onPress={open} />
      <Small>{help}</Small>
      <View accessibilityLiveRegion="polite" role="alert">
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </View>
    </Stack>
  );
}

/**
 * Hands the route to a maps app: the share sheet on a phone, where OsmAnd and MyRoute both take
 * GPX files, or a download on the web.
 */
export function OpenInMapsButton({ route, kind = 'primary' }: { route: Pick<Route, 'id' | 'name'>; kind?: 'primary' | 'secondary' }) {
  return (
    <GpxHandOffButton
      route={route}
      send={openInMapsApp}
      label={ON_WEB ? 'Download GPX' : 'Open in maps app'}
      icon={ON_WEB ? 'download-outline' : 'share-outline'}
      kind={kind}
      accessibilityLabel={ON_WEB ? `Download ${route.name} as a GPX file` : `Open ${route.name} in a maps app`}
      help={ON_WEB ? 'Saves the GPX file. Open it in OsmAnd or MyRoute to ride it.' : 'Pick OsmAnd or MyRoute from the share sheet. It stays there offline.'}
    />
  );
}

/**
 * Hands a Garmin-ready copy of the route on: the share sheet on a phone, for Garmin Tread, Explore
 * or Drive, or a download on the web, to copy onto a zūmo or open in BaseCamp.
 */
export function SendToGarminButton({ route, kind = 'secondary' }: { route: Pick<Route, 'id' | 'name'>; kind?: 'primary' | 'secondary' }) {
  return (
    <GpxHandOffButton
      route={route}
      send={sendToGarmin}
      label="Send to Garmin"
      icon={ON_WEB ? 'download-outline' : 'navigate-circle-outline'}
      kind={kind}
      accessibilityLabel={ON_WEB ? `Download ${route.name} for a Garmin` : `Send ${route.name} to a Garmin app`}
      help={
        ON_WEB
          ? 'Saves a Garmin-ready GPX. Copy it into the unit’s GPX folder, or open it in BaseCamp.'
          : 'Pick your Garmin app (Tread, Explore or Drive) from the share sheet, then sync it to the unit.'
      }
    />
  );
}

const FOLLOW_LABEL: Record<NavApp, string> = { apple: 'Apple Maps', google: 'Google Maps', waze: 'Waze' };

const NAV_ICON: Record<NavApp, React.ComponentProps<typeof Ionicons>['name']> = {
  apple: 'logo-apple',
  google: 'logo-google',
  waze: 'car-outline',
};

/**
 * One "Follow the route" button: works out what's left of the route from where the phone last was
 * (the whole route when it can't tell), then opens that maps app with the end and points along it.
 */
function FollowRouteButton({
  app,
  label,
  line,
  onOpened,
  kind = 'secondary',
  buttonLabel = label,
}: {
  app: NavApp;
  label: string;
  line: [number, number][];
  onOpened?: () => void;
  kind?: 'primary' | 'secondary';
  buttonLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const open = async () => {
    if (busy) return;
    setFailed(false);
    setBusy(true);
    try {
      const ahead = routeAhead(line, await whereAmI());
      const option = followRouteOptions(ahead, Platform.OS, Platform.Version).find((o) => o.app === app);
      if (!option) throw new Error('no link');
      await Linking.openURL(option.url);
      onOpened?.();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap={space.sm}>
      <Button
        label={buttonLabel}
        icon={NAV_ICON[app]}
        kind={kind}
        busy={busy}
        accessibilityLabel={`Follow the route in ${label}, from where you are`}
        onPress={open}
      />
      <View accessibilityLiveRegion="polite" role="alert">
        {failed ? <Notice tone="danger">{`${label} didn’t open. Try the GPX for OsmAnd or MyRoute below.`}</Notice> : null}
      </View>
    </Stack>
  );
}

/**
 * One big "Follow the route" button for mid-ride. Google Maps ends at each point it's given, so a
 * rider comes back here and taps once to carry on from where they are. Nothing when this phone has
 * no app that can follow a route, or the route has no line.
 */
export function FollowRouteNow({ route }: { route: Pick<Route, 'line'> }) {
  const app = route.line.length > 0 ? followApps(Platform.OS, Platform.Version)[0] : undefined;
  if (!app) return null;
  return (
    <Stack gap={space.xs}>
      <FollowRouteButton app={app} label={FOLLOW_LABEL[app]} line={route.line} kind="primary" buttonLabel={`Follow the route in ${FOLLOW_LABEL[app]}`} />
      <Small>Picks up from where you are. When Maps stops at a point, come back and tap again. OsmAnd rides it with no stops.</Small>
    </Stack>
  );
}

/**
 * "Navigate": opens the maps apps the rider picks from. With a `route`, "Follow the route" comes
 * first: Apple Maps (iOS 18.4+) and Google Maps led along the route's own points from where the
 * rider is, then the locked GPX for OsmAnd or MyRoute and a Garmin-ready copy, which follow every
 * bend. Then "To `to`": Apple Maps, Google Maps and Waze, each its own way to that one spot.
 * No pop-up: the choices open in place, since the web preview can't show dialogs.
 */
export function NavigateChooser({
  to,
  toLabel,
  route,
  kind = 'secondary',
}: {
  to: LatLng;
  /** What `to` is, for the button: "the start", "the regroup pin", "Rocko". */
  toLabel: string;
  route?: Pick<Route, 'id' | 'name' | 'line'>;
  kind?: 'primary' | 'secondary';
}) {
  const [open, setOpen] = useState(false);
  const options = navigateOptions(to, Platform.OS);
  const follow = route && route.line.length > 0 ? followApps(Platform.OS, Platform.Version) : [];
  return (
    <Stack gap={space.sm}>
      <Button
        label={open ? 'Close' : 'Navigate'}
        icon={open ? 'close' : 'navigate-outline'}
        kind={open ? 'quiet' : kind}
        accessibilityLabel={open ? 'Close the maps apps' : route ? `Navigate ${route.name}` : `Navigate to ${toLabel}`}
        onPress={() => setOpen((o) => !o)}
      />
      {open ? (
        <Card style={{ gap: space.sm }}>
          {route ? (
            <>
              <Text style={styles.navTitle}>Follow the route</Text>
              {follow.map((app) => (
                <FollowRouteButton key={app} app={app} label={FOLLOW_LABEL[app]} line={route.line} onOpened={() => setOpen(false)} />
              ))}
              {follow.length > 0 ? (
                <Small>
                  From where you are, through 9 points along the route to its end. Maps shows the stops first: tap Start to ride them. Google ends at each point, so come back and tap again. For no stops and every bend, use OsmAnd, MyRoute or Garmin.
                </Small>
              ) : null}
              <OpenInMapsButton route={route} kind="secondary" />
              <SendToGarminButton route={route} />
            </>
          ) : null}
          <Text style={[styles.navTitle, route ? { marginTop: space.sm } : null]}>{`To ${toLabel}`}</Text>
          {options.map((o) => (
            <Button
              key={o.app}
              label={o.label}
              icon={NAV_ICON[o.app]}
              kind="secondary"
              accessibilityLabel={`Navigate to ${toLabel} in ${o.label}`}
              onPress={() => {
                Linking.openURL(o.url).catch(() => {});
                setOpen(false);
              }}
            />
          ))}
          {route ? <Small>{`These take their own way to ${toLabel} only. Waze can’t follow a route.`}</Small> : null}
        </Card>
      ) : null}
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
  stars: { fontFamily: fonts.stencil, fontSize: 14, color: colors.boneDim },
  stopDetail: { fontFamily: fonts.stencil, fontSize: 14, color: colors.boneDim, marginTop: 2 },
  item: { borderBottomWidth: 1, borderBottomColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 72, padding: space.md },
  rowError: { paddingHorizontal: space.md, paddingBottom: space.md },
  navTitle: { fontFamily: fonts.stencil, fontSize: 14, letterSpacing: 0.6, color: colors.bone, textTransform: 'uppercase' },
});
