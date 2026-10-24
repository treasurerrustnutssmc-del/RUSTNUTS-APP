// The club's locked route library: the list, one route, adding or changing one, and choosing a
// ride's route. Only the board, ride committee and NEC change routes; every approved member can
// see them and send them to OsmAnd or MyRoute.

import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import type { RouteInput } from '../data/clubContext';
import { createPickGuard, type PickGuard } from '../data/pickGuard';
import { pickGpxFile, releaseOnReturn } from '../data/routeFiles';
import { formatAuDate } from '../domain/dates';
import { readGpx, type GpxSummary } from '../domain/gpx';
import {
  archiveRouteProblem,
  libraryFor,
  managesChapterRoutes,
  NOT_MANAGER,
  rideRouteChapters,
  rideRouteProblem,
  ridesUsingRoute,
  routeChapterName,
  routeOf,
  saveRouteProblem,
} from '../domain/routes';
import { melbourneDate } from '../domain/rides';
import type { ClubData, Route } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { colors, fonts, radius, space, type } from '../theme';
import {
  Body,
  Button,
  Card,
  Chip,
  Choices,
  ConfirmButton,
  Field,
  H1,
  Ionicons,
  ListRow,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
  Toggle,
} from '../ui/primitives';
import { ChapterChip, chapterColours, OpenInMapsButton, RouteFacts, RouteRow, StopList } from '../ui/RouteBits';
import { RouteShape } from '../ui/RouteShape';
import { weekday } from './rides';

/** Chapter filters and choices use this for "Whole club" (a route with no chapter). */
const WHOLE_CLUB = 'whole-club';
type ChapterKey = string; // a chapter id, or WHOLE_CLUB

const toChapterId = (key: ChapterKey): string | null => (key === WHOLE_CLUB ? null : key);
const toKey = (chapterId: string | null): ChapterKey => chapterId ?? WHOLE_CLUB;

/** North, then West (the Rides chips' order), then Whole club. */
function chapterKeys(data: ClubData): ChapterKey[] {
  const order = (slug: string) => (slug === 'north' ? 0 : slug === 'west' ? 1 : 2);
  return [...[...data.chapters].sort((a, b) => order(a.slug) - order(b.slug)).map((c) => c.id), WHOLE_CLUB];
}

function RideDateLine({ title, startsAt }: { title: string; startsAt: string }) {
  const date = melbourneDate(startsAt);
  return (
    <Text style={styles.ride}>
      {title}
      <Text style={styles.rideDate}>{` · ${weekday(date)} ${formatAuDate(date)}`}</Text>
    </Text>
  );
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

export function RoutesScreen({ navigation }: RootScreen<'Routes'>) {
  const { me, data } = useClub();
  const [shown, setShown] = useState<ChapterKey[] | null>(null);
  if (!me) return null;
  const keys = chapterKeys(data);
  // Like the Rides tab: your own chapter and the whole club to start with.
  const chapters = shown ?? [toKey(me.chapterId), WHOLE_CLUB].filter((k, i, a) => keys.includes(k) && a.indexOf(k) === i);
  const routes = libraryFor(data, chapters.map(toChapterId));
  const anyRoutes = libraryFor(data, 'all').length > 0;
  const canAdd = managesChapterRoutes(me, null, data);
  const toggle = (k: ChapterKey) => setShown(chapters.includes(k) ? chapters.filter((x) => x !== k) : [...chapters, k]);

  return (
    <Screen>
      <Stack gap={space.sm}>
        <Body>Ride routes planned by the Road Captains. Open one in OsmAnd or MyRoute to ride it.</Body>
        <Small>Routes are locked: only the board or ride committee can change them.</Small>
      </Stack>

      {canAdd ? <Button label="Add route" icon="add" onPress={() => navigation.navigate('EditRoute', {})} /> : null}

      <View style={styles.filters} accessibilityLabel="Show routes by chapter">
        {keys.map((k) => {
          const on = chapters.includes(k);
          const col = chapterColours(toChapterId(k), data);
          const name = routeChapterName(toChapterId(k), data);
          return (
            <Pressable
              key={k}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              accessibilityLabel={k === WHOLE_CLUB ? 'Whole-club routes' : `${name} routes`}
              onPress={() => toggle(k)}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.filter,
                on ? { backgroundColor: col.bg, borderColor: col.bg } : (pressed || hovered) && { backgroundColor: colors.steel },
              ]}
            >
              {on ? <Ionicons name="checkmark" size={14} color={col.fg} /> : <View style={[styles.swatch, { backgroundColor: col.bg }]} />}
              <Text style={[styles.filterText, { color: on ? col.fg : colors.boneDim }]}>{name}</Text>
            </Pressable>
          );
        })}
      </View>

      {routes.length === 0 ? (
        <Notice title={anyRoutes ? 'No routes here.' : 'No routes yet.'}>
          {anyRoutes
            ? 'Turn on more chapters above to see other routes.'
            : canAdd
              ? 'Add the first one from a GPX file planned in MyRoute or OsmAnd.'
              : 'Routes show up here once the Road Captains add them.'}
        </Notice>
      ) : (
        <Card style={{ padding: 0, gap: 0 }}>
          {routes.map((r, i) => (
            <RouteRow
              key={r.id}
              route={r}
              data={data}
              last={i === routes.length - 1}
              onPress={() => navigation.navigate('Route', { routeId: r.id })}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One route
// ---------------------------------------------------------------------------

export function RouteScreen({ route: nav, navigation }: RootScreen<'Route'>) {
  const { me, data, today, archiveRoute } = useClub();
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const route = (data.routes ?? []).find((r) => r.id === nav.params.routeId);

  if (!route || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Route not found">It may have been taken out of the library.</Notice>
      </Screen>
    );
  }

  const manages = managesChapterRoutes(me, route.chapterId, data);
  const canArchive = !route.archivedAt && archiveRouteProblem(me, route, data) === null;
  const rides = ridesUsingRoute(route.id, data, today);

  const archive = async () => {
    setError(null);
    setArchiving(true);
    try {
      await archiveRoute(route.id);
      navigation.popTo('Routes');
    } catch (e) {
      setError((e as Error).message);
      setArchiving(false);
    }
  };

  return (
    <Screen>
      <Stack gap={space.sm}>
        <Row style={{ gap: 6 }}>
          <ChapterChip chapterId={route.chapterId} data={data} />
          {route.archivedAt ? <Chip label="Archived" tone="warn" /> : null}
        </Row>
        <H1>{route.name}</H1>
        <RouteFacts route={route} />
      </Stack>

      <RouteShape route={route} />

      <OpenInMapsButton route={route} />

      {route.archivedAt ? (
        <Notice tone="warn">Archived: it’s out of the library, but the rides that use it keep it.</Notice>
      ) : null}

      {route.notes ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Notes" />
          <Body selectable>{route.notes}</Body>
        </Stack>
      ) : null}

      {route.stops.length > 0 ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Stops" action={<Text style={styles.count}>{route.stops.length}</Text>} />
          <StopList stops={route.stops} />
        </Stack>
      ) : null}

      <Stack gap={space.sm}>
        <SectionTitle title="Rides using it" action={<Text style={styles.count}>{rides.length}</Text>} />
        {rides.length === 0 ? (
          <Small>No rides coming up use this route yet.</Small>
        ) : (
          <Card style={{ padding: 0, gap: 0 }}>
            {rides.map((r, i) => {
              const date = melbourneDate(r.startsAt);
              return (
                <ListRow
                  key={r.id}
                  last={i === rides.length - 1}
                  title={r.title}
                  subtitle={<Text style={styles.rowDate}>{`${weekday(date)} ${formatAuDate(date)}`}</Text>}
                  onPress={() => navigation.navigate('RideDetail', { rideId: r.id })}
                />
              );
            })}
          </Card>
        )}
      </Stack>

      {manages ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Manage" />
          <Button label="Edit" icon="create-outline" kind="secondary" onPress={() => navigation.navigate('EditRoute', { routeId: route.id })} />
          {canArchive ? (
            archiving ? (
              <Button label="Archive" kind="secondary" busy onPress={() => {}} />
            ) : (
              <ConfirmButton label="Archive" confirmLabel="Yes, archive" kind="secondary" icon="archive-outline" onConfirm={archive} />
            )
          ) : null}
          {canArchive ? <Small>Archiving takes it out of the library. Rides that use it keep it.</Small> : null}
          <View accessibilityLiveRegion="polite" role="alert">
            {error ? <Notice tone="danger">{error}</Notice> : null}
          </View>
        </Stack>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Add or change a route
// ---------------------------------------------------------------------------

/** The route's file name without `.gpx`, as a starting name. */
function nameFromFile(fileName: string): string {
  return fileName.replace(/\.gpx$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 80);
}

export function EditRouteScreen({ route: nav, navigation }: RootScreen<'EditRoute'>) {
  const { me, data, saveRoute } = useClub();
  const routeId = nav.params?.routeId;
  const existing = routeId ? (data.routes ?? []).find((r) => r.id === routeId) : undefined;
  const ownChapter = me && managesChapterRoutes(me, me.chapterId, data) ? me.chapterId : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [chapterKey, setChapterKey] = useState<ChapterKey>(toKey(existing ? existing.chapterId : ownChapter));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [picked, setPicked] = useState<{ fileName: string; text: string; summary: GpxSummary } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // One pick at a time: a double tap would otherwise ask the phone for a second picker.
  const [picking, setPicking] = useState(false);
  const guard = useRef<PickGuard | null>(null);
  if (guard.current == null) guard.current = createPickGuard(setPicking);

  if (!me) return null;
  if (routeId && !existing) {
    return (
      <Screen>
        <Notice tone="warn" title="Route not found">It may have been taken out of the library.</Notice>
      </Screen>
    );
  }
  if (!managesChapterRoutes(me, existing ? existing.chapterId : null, data)) {
    return (
      <Screen>
        <Notice tone="warn">{NOT_MANAGER}</Notice>
      </Screen>
    );
  }

  // Only the chapters this person can file a route under, plus where it is now.
  // Whole club first, then North and West.
  const options = [WHOLE_CLUB, ...chapterKeys(data).filter((k) => k !== WHOLE_CLUB)]
    .filter((k) => managesChapterRoutes(me, toChapterId(k), data) || (existing && toKey(existing.chapterId) === k))
    .map((k) => ({ value: k, label: routeChapterName(toChapterId(k), data) }));
  // What's shown for checking: the new file's summary, or the route's own.
  const shape = picked?.summary ?? existing;
  const needsFile = !existing && !picked;

  const pick = async () => {
    const pickGuard = guard.current!;
    const token = pickGuard.start();
    if (token === null) return;
    // On the web a backed-out pick may never settle, so the window getting focus back frees it too.
    const stopWatching = releaseOnReturn(() => pickGuard.release(token));
    setFileError(null);
    try {
      const file = await pickGpxFile();
      if (!file) return;
      const summary = readGpx(file.text);
      if (typeof summary === 'string') {
        setFileError(summary);
        return;
      }
      setPicked({ fileName: file.name, text: file.text, summary });
      setFileError(null);
      setName((now) => (now.trim() === '' ? nameFromFile(file.name) : now));
    } catch (e) {
      setFileError((e as Error).message);
    } finally {
      stopWatching();
      pickGuard.release(token);
    }
  };

  const save = async () => {
    if (saving || needsFile) return;
    setError(null);
    const input: RouteInput = {
      id: existing?.id ?? null,
      name: name.trim(),
      chapterId: toChapterId(chapterKey),
      notes: notes.trim(),
      gpx: picked?.text ?? null,
    };
    const problem = saveRouteProblem(me, existing, input, data);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      const id = await saveRoute(input);
      if (existing) navigation.goBack();
      else navigation.replace('Route', { routeId: id });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack gap={space.sm}>
        <SectionTitle title="GPX file" />
        {shape ? (
          <Card>
            <RouteShape route={shape} />
            <RouteFacts route={shape} />
            {shape.stops.length > 0 ? (
              <Stack gap={space.xs}>
                <Text style={styles.subhead}>{shape.stops.length === 1 ? '1 stop' : `${shape.stops.length} stops`}</Text>
                <StopList stops={shape.stops} flat />
              </Stack>
            ) : (
              <Small>No stops marked in the file.</Small>
            )}
            {picked ? (
              <Small>{existing ? `New file: ${picked.fileName}. It replaces the old one when you save.` : `From ${picked.fileName}.`}</Small>
            ) : null}
            <Button label="Replace file" icon="document-outline" kind="secondary" busy={picking} onPress={pick} />
          </Card>
        ) : (
          <Card>
            <View style={styles.emptyFile}>
              <Ionicons name="map-outline" size={28} color={colors.boneMute} />
              <Body style={{ textAlign: 'center' }}>Pick the GPX file you planned in MyRoute, OsmAnd or another route planner.</Body>
            </View>
            <Button label="Pick GPX file" icon="document-outline" busy={picking} onPress={pick} />
            <Small>It’s checked on your phone first, so you can see the route before saving it. 5 MB at most.</Small>
          </Card>
        )}
        <View accessibilityLiveRegion="polite" role="alert">
          {fileError ? <Notice tone="danger">{fileError}</Notice> : null}
        </View>
      </Stack>

      <Stack gap={space.md}>
        <SectionTitle title="Details" />
        <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Daylesford breakfast loop" maxLength={80} autoCapitalize="sentences" />
        {options.length > 1 ? (
          <Choices label="Chapter" options={options} value={chapterKey} onChange={setChapterKey} />
        ) : (
          <Small>{`Filed under ${options[0]?.label ?? 'Whole club'}.`}</Small>
        )}
        <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Fuel stops, road works, where to regroup" multiline />
      </Stack>

      <Stack gap={space.sm}>
        <Button
          label={existing ? 'Save changes' : 'Save route'}
          icon="checkmark"
          kind={needsFile ? 'secondary' : 'primary'}
          disabled={needsFile}
          busy={saving}
          onPress={save}
        />
        {needsFile ? <Small>Pick the GPX file first.</Small> : null}
        <View accessibilityLiveRegion="polite" role="alert">
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </View>
      </Stack>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Choose a ride's route
// ---------------------------------------------------------------------------

export function PickRouteScreen({ route: nav, navigation }: RootScreen<'PickRoute'>) {
  const { me, data, setRideRoute } = useClub();
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ routeId: string; message: string } | null>(null);
  const ride = data.rides.find((r) => r.id === nav.params.rideId);

  if (!ride || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Ride not found">It may have come off the club calendar.</Notice>
      </Screen>
    );
  }

  const locked = rideRouteProblem(me, ride, null, data, new Date().toISOString());
  const chapters = rideRouteChapters(ride, data);
  const routes = libraryFor(data, all ? 'all' : chapters);
  const current = routeOf(ride.id, data);
  const own = chapters
    .filter((c): c is string => c !== null)
    .map((c) => routeChapterName(c, data))
    .concat('whole-club')
    .join(' and ');

  const pick = async (r: Route) => {
    if (busy) return;
    setFailed(null);
    setBusy(r.id);
    try {
      await setRideRoute(ride.id, r.id);
      navigation.goBack();
    } catch (e) {
      setFailed({ routeId: r.id, message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <RideDateLine title={ride.title} startsAt={ride.startsAt} />

      {locked ? (
        <Notice tone="warn">{locked}</Notice>
      ) : (
        <>
          <Toggle
            label="Show every chapter’s routes"
            description={`Off: ${own} routes only.`}
            value={all}
            onChange={setAll}
          />

          {routes.length === 0 ? (
            <Notice title="No routes to choose from.">
              {all ? 'Add one to the library first.' : 'Turn on every chapter’s routes above, or add one to the library.'}
            </Notice>
          ) : (
            <Card style={{ padding: 0, gap: 0 }}>
              {routes.map((r, i) => (
                <RouteRow
                  key={r.id}
                  route={r}
                  data={data}
                  last={i === routes.length - 1}
                  current={current?.id === r.id}
                  saving={busy === r.id}
                  disabled={busy !== null && busy !== r.id}
                  error={failed?.routeId === r.id ? failed.message : null}
                  onPress={() => pick(r)}
                />
              ))}
            </Card>
          )}

          {managesChapterRoutes(me, null, data) ? (
            <Button label="Add a new route" icon="add" kind="secondary" onPress={() => navigation.navigate('EditRoute', {})} />
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  ride: { ...type.name, color: colors.bone },
  rideDate: { fontFamily: fonts.stencil, color: colors.boneDim },
  rowDate: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.4, color: colors.boneDim },
  count: { fontFamily: fonts.stencil, fontSize: 16, color: colors.boneMute },
  subhead: { fontFamily: fonts.stencil, fontSize: 13, letterSpacing: 0.6, color: colors.boneMute, textTransform: 'uppercase' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  filter: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  swatch: { width: 12, height: 12, borderRadius: 2 },
  filterText: { fontFamily: fonts.stencil, fontSize: 14, letterSpacing: 0.6, textTransform: 'uppercase' },
  emptyFile: { alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
});
