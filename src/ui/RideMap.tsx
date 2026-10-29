// The ride map: the phone's own map (Apple Maps on an iPhone, Google Maps on Android) with the
// locked route, its start, finish and stops, and on a live ride the riders' latest fixes and the
// regroup pin. Where this build can't draw a map (an iPhone before iOS 17, an Android build without
// a Google Maps key) it falls back to the drawn route shape. The web build has RideMap.web.tsx.

import Constants from 'expo-constants';
import { useImage, type ImageRef } from 'expo-image';
import { AppleMaps, GoogleMaps } from 'expo-maps';
import React, { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { boundsAround, fitCamera, mapsAvailable, type PinTone, type RiderPin } from '../domain/rideMap';
import { formatKm } from '../domain/routes';
import type { LatLng, Route } from '../domain/types';
import { colors, fonts, radius, space } from '../theme';
import { Ionicons } from './primitives';
import { RouteShape } from './RouteShape';

type MapRoute = Pick<Route, 'line' | 'bounds' | 'distanceM' | 'stops'>;

export interface RideMapProps {
  route?: MapRoute | null;
  riders?: RiderPin[];
  regroup?: LatLng | null;
  /** The map's height; it always fills the width. */
  height?: number;
}

const canMap = mapsAvailable({
  os: Platform.OS,
  version: Platform.Version,
  androidKey: Constants.expoConfig?.extra?.androidMaps === true,
});

export function hasRealMap(): boolean {
  return canMap;
}

const PAD = 28;

/** Apple Maps pins: a tint and an SF Symbol, or the rider's initials. */
const APPLE_TINT: Record<PinTone, string> = {
  me: colors.bone,
  help: colors.danger,
  leader: colors.redBright,
  split: colors.warn,
  stale: colors.boneMute,
  rider: colors.redBright,
};

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

const toCoords = (p: LatLng) => ({ latitude: p.lat, longitude: p.lng });

export function RideMap({ route = null, riders = [], regroup = null, height = 280 }: RideMapProps) {
  const [width, setWidth] = useState(0);
  if (!canMap) return route ? <RouteShape route={route} /> : null;
  const points = [...riders.map((r) => r.position), ...(regroup ? [regroup] : [])];
  const bounds = boundsAround(route?.bounds ?? null, points);
  if (!bounds) return null;
  const label = [
    route ? `Map of the route, ${formatKm(route.distanceM)}` : 'Map',
    riders.length > 0 ? `${riders.length} ${riders.length === 1 ? 'rider' : 'riders'}` : null,
    regroup ? 'regroup pin' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={{ gap: space.sm }}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}
        style={[styles.tile, { height }]}
      >
        {width > 0 ? <NativeMap route={route} riders={riders} regroup={regroup} camera={fitCamera(bounds, width, height, PAD)} /> : null}
      </View>
      <MapKey route={!!route} riders={riders} regroup={!!regroup} />
    </View>
  );
}

type Camera = LatLng & { zoom: number };

function NativeMap(props: { route: MapRoute | null; riders: RiderPin[]; regroup: LatLng | null; camera: Camera }) {
  return Platform.OS === 'ios' ? <AppleMap {...props} /> : <GoogleMap {...props} />;
}

function RecentreButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Fit the whole map in view"
      onPress={onPress}
      style={({ pressed }) => [styles.recentre, pressed && { backgroundColor: colors.steelHi }]}
    >
      <Ionicons name="scan-outline" size={20} color={colors.bone} />
    </Pressable>
  );
}

function AppleMap({ route, riders, regroup, camera }: { route: MapRoute | null; riders: RiderPin[]; regroup: LatLng | null; camera: Camera }) {
  const ref = useRef<AppleMaps.MapView>(null);
  const start = route?.line[0];
  const finish = route?.line[route.line.length - 1];
  const markers: AppleMaps.Marker[] = [
    ...(route?.stops ?? []).map((s, i) => ({ id: `stop-${i}`, coordinates: { latitude: s.lat, longitude: s.lng }, title: s.name, systemImage: 'mappin', tintColor: colors.boneMute })),
    ...(start ? [{ id: 'start', coordinates: { latitude: start[0], longitude: start[1] }, title: 'Start', systemImage: 'flag.fill', tintColor: colors.ok }] : []),
    ...(finish ? [{ id: 'finish', coordinates: { latitude: finish[0], longitude: finish[1] }, title: 'Finish', systemImage: 'flag.checkered', tintColor: colors.bone }] : []),
    ...(regroup ? [{ id: 'regroup', coordinates: toCoords(regroup), title: 'Regroup here', systemImage: 'flag.2.crossed.fill', tintColor: '#2B64A8' }] : []),
    ...riders.map((r) =>
      r.tone === 'help'
        ? { id: `rider-${r.memberId}`, coordinates: toCoords(r.position), title: `${r.name} needs help`, systemImage: 'exclamationmark.triangle.fill', tintColor: APPLE_TINT.help }
        : { id: `rider-${r.memberId}`, coordinates: toCoords(r.position), title: r.tone === 'me' ? 'You' : r.name, monogram: initialsOf(r.name), tintColor: APPLE_TINT[r.tone] },
    ),
  ];
  return (
    <>
      <AppleMaps.View
        ref={ref}
        style={StyleSheet.absoluteFill}
        colorScheme={AppleMaps.MapColorScheme.DARK}
        cameraPosition={{ coordinates: toCoords(camera), zoom: camera.zoom }}
        polylines={route ? [{ id: 'route', coordinates: route.line.map(([lat, lng]) => ({ latitude: lat, longitude: lng })), color: colors.redBright, width: 5 }] : []}
        markers={markers}
        uiSettings={{ compassEnabled: true, scaleBarEnabled: true, myLocationButtonEnabled: false }}
        properties={{ isMyLocationEnabled: false, selectionEnabled: true }}
      />
      <RecentreButton onPress={() => ref.current?.setCameraPosition({ coordinates: toCoords(camera), zoom: camera.zoom })} />
    </>
  );
}

/** Android's pins are small images in assets/map, one per kind. */
function useGooglePins(): Record<'start' | 'finish' | 'stop' | 'regroup' | PinTone, ImageRef | null> {
  return {
    start: useImage(require('../../assets/map/start.png')),
    finish: useImage(require('../../assets/map/finish.png')),
    stop: useImage(require('../../assets/map/stop.png')),
    regroup: useImage(require('../../assets/map/regroup.png')),
    me: useImage(require('../../assets/map/me.png')),
    help: useImage(require('../../assets/map/help.png')),
    leader: useImage(require('../../assets/map/leader.png')),
    split: useImage(require('../../assets/map/split.png')),
    stale: useImage(require('../../assets/map/stale.png')),
    rider: useImage(require('../../assets/map/rider.png')),
  };
}

const MIDDLE = { x: 0.5, y: 0.5 };

function GoogleMap({ route, riders, regroup, camera }: { route: MapRoute | null; riders: RiderPin[]; regroup: LatLng | null; camera: Camera }) {
  const ref = useRef<GoogleMaps.MapView>(null);
  const pins = useGooglePins();
  const icon = (img: ImageRef | null) => (img ? { icon: img, anchor: MIDDLE } : {});
  const start = route?.line[0];
  const finish = route?.line[route.line.length - 1];
  const markers: GoogleMaps.Marker[] = [
    ...(route?.stops ?? []).map((s, i) => ({ id: `stop-${i}`, coordinates: { latitude: s.lat, longitude: s.lng }, title: s.name, zIndex: 1, ...icon(pins.stop) })),
    ...(finish ? [{ id: 'finish', coordinates: { latitude: finish[0], longitude: finish[1] }, title: 'Finish', zIndex: 2, ...icon(pins.finish) }] : []),
    ...(start ? [{ id: 'start', coordinates: { latitude: start[0], longitude: start[1] }, title: 'Start', zIndex: 3, ...icon(pins.start) }] : []),
    ...(regroup ? [{ id: 'regroup', coordinates: toCoords(regroup), title: 'Regroup here', zIndex: 4, ...icon(pins.regroup) }] : []),
    ...riders.map((r) => ({
      id: `rider-${r.memberId}`,
      coordinates: toCoords(r.position),
      title: r.tone === 'me' ? 'You' : r.tone === 'help' ? `${r.name} needs help` : r.name,
      zIndex: r.tone === 'help' ? 7 : r.tone === 'me' ? 6 : 5,
      ...icon(pins[r.tone]),
    })),
  ];
  return (
    <>
      <GoogleMaps.View
        ref={ref}
        style={StyleSheet.absoluteFill}
        colorScheme={GoogleMaps.MapColorScheme.DARK}
        cameraPosition={{ coordinates: toCoords(camera), zoom: camera.zoom }}
        polylines={route ? [{ id: 'route', coordinates: route.line.map(([lat, lng]) => ({ latitude: lat, longitude: lng })), color: colors.redBright, width: 12 }] : []}
        markers={markers}
        uiSettings={{ compassEnabled: true, mapToolbarEnabled: false, myLocationButtonEnabled: false, zoomControlsEnabled: false, scaleBarEnabled: true }}
        properties={{ isMyLocationEnabled: false, isBuildingEnabled: false, isIndoorEnabled: false }}
      />
      <RecentreButton onPress={() => ref.current?.setCameraPosition({ coordinates: toCoords(camera), zoom: camera.zoom, duration: 400 })} />
    </>
  );
}

const KEY: Record<'start' | 'finish' | 'regroup' | 'me' | 'leader' | 'rider' | 'split' | 'help', { label: string; dot: object }> = {
  start: { label: 'Start', dot: { backgroundColor: colors.ok, borderRadius: 6 } },
  finish: { label: 'Finish', dot: { backgroundColor: colors.ink, borderWidth: 2, borderColor: colors.bone } },
  regroup: { label: 'Regroup', dot: { backgroundColor: '#2B64A8', borderRadius: 6, borderWidth: 2, borderColor: colors.bone } },
  me: { label: 'You', dot: { backgroundColor: colors.bone, borderRadius: 6 } },
  leader: { label: 'Leader', dot: { backgroundColor: colors.redBright, borderRadius: 6, borderWidth: 2, borderColor: colors.bone } },
  rider: { label: 'Rider', dot: { backgroundColor: colors.redBright, borderRadius: 6 } },
  split: { label: 'Split off', dot: { backgroundColor: colors.warn, borderRadius: 6 } },
  help: { label: 'Help', dot: { backgroundColor: colors.danger, borderRadius: 6, borderWidth: 2, borderColor: colors.bone } },
};

/** What the pins mean: only the kinds on this map. Screen readers get the same from the lists. */
function MapKey({ route, riders, regroup }: { route: boolean; riders: RiderPin[]; regroup: boolean }) {
  const tones = new Set(riders.map((r) => r.tone));
  const items = (
    [route && 'start', route && 'finish', regroup && 'regroup', ...(['me', 'leader', 'rider', 'split', 'help'] as const).filter((t) => tones.has(t))].filter(Boolean) as (keyof typeof KEY)[]
  ).map((k) => KEY[k]);
  if (items.length === 0) return null;
  return (
    <View style={styles.key} aria-hidden importantForAccessibility="no-hide-descendants">
      {items.map((k) => (
        <View key={k.label} style={styles.keyItem}>
          <View style={[styles.keyDot, k.dot]} />
          <Text style={styles.keyText}>{k.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.steel, borderRadius: radius.sm, overflow: 'hidden', width: '100%' },
  recentre: {
    position: 'absolute',
    right: space.sm,
    bottom: space.sm,
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink2,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  key: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.xs },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keyDot: { width: 12, height: 12 },
  keyText: { fontFamily: fonts.stencil, fontSize: 13, letterSpacing: 0.6, color: colors.boneMute, textTransform: 'uppercase' },
});
