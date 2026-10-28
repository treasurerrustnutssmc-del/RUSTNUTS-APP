// Stage 7: garage build threads. The owner of a project bike posts updates with photos; members
// follow along. There are no comments here: "Message the owner" opens a private chat.

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useChat } from '../data/chat/ChatProvider';
import { PickProblem, pickMedia } from '../data/chat/media';
import { useClub } from '../data/ClubStore';
import { useSocial } from '../data/social/SocialProvider';
import type { PickedMedia } from '../domain/chat';
import { formatAuDate } from '../domain/dates';
import { displayName } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import { bikeLabel, buildPostProblem, buildsFor, canTakeDownUpdate, MAX_BUILD_PHOTOS, type Build, type BuildUpdate } from '../domain/social/builds';
import type { Bike, ClubData } from '../domain/types';
import type { RootParams, RootScreen } from '../navigation/types';
import { colors, MAX_CONTENT_WIDTH, radius, space, type } from '../theme';
import { Body, Button, Card, ConfirmButton, Field, H2, IconBadge, Ionicons, ListRow, Notice, Screen, SectionTitle, Small } from '../ui/primitives';
import { ListingPhotoBox } from './swap';

type Nav = NavigationProp<RootParams>;

const dayOf = (iso: string) => formatAuDate(melbourneDate(iso));
const fullBike = (b: Bike) => [b.year, b.make, b.model].filter(Boolean).join(' ');

function ownerLine(memberId: string, data: ClubData): string {
  const owner = data.members.find((m) => m.id === memberId);
  const chapter = owner ? data.chapters.find((c) => c.id === owner.chapterId)?.name : undefined;
  return [owner ? displayName(owner) : 'A former member', chapter].filter(Boolean).join(' · ');
}

const updatesLabel = (n: number) => `${n} ${n === 1 ? 'update' : 'updates'}`;

// ---------------------------------------------------------------------------
// Members tab: the way in
// ---------------------------------------------------------------------------

export function BuildsRow({ last = false }: { last?: boolean }) {
  const navigation = useNavigation<Nav>();
  return (
    <ListRow
      left={<IconBadge icon="construct-outline" tone="red" />}
      title="Garage builds"
      subtitle="Project bikes coming back to life"
      onPress={() => navigation.navigate('Builds')}
      last={last}
    />
  );
}

// ---------------------------------------------------------------------------
// All builds
// ---------------------------------------------------------------------------

function BuildCard({ build }: { build: Build }) {
  const navigation = useNavigation<Nav>();
  const { data } = useClub();
  const cover = build.updates.find((u) => u.photos.length > 0)?.photos[0]?.path ?? null;
  const label = bikeLabel(build.bike);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${updatesLabel(build.updates.length)}`}
      onPress={() => navigation.navigate('BuildThread', { bikeId: build.bike.id })}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: 'row',
        gap: space.md,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: pressed || hovered ? colors.steel : colors.ink2,
      })}
    >
      <ListingPhotoBox path={cover} size={88} label={cover ? `Photo of ${label}` : 'No photo yet'} bucket="build" icon="construct-outline" />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={type.name} numberOfLines={2}>
          {label}
        </Text>
        {build.bike.nickname ? <Small numberOfLines={1}>{fullBike(build.bike)}</Small> : null}
        <Small numberOfLines={1}>{ownerLine(build.owner.id, data)}</Small>
        <Text style={[type.name, { fontSize: 13, color: colors.boneMute }]}>
          {`${updatesLabel(build.updates.length)} · ${dayOf(build.updates[0].postedAt)}`}
        </Text>
      </View>
    </Pressable>
  );
}

export function BuildsScreen({ navigation }: RootScreen<'Builds'>) {
  const { me, data, isDemo, refresh: refreshClub } = useClub();
  const { ready, buildUpdates, refresh } = useSocial();
  const { blocks } = useChat();
  const builds = buildsFor(me, data.members, data.bikes, buildUpdates, blocks);
  const mine = me ? data.bikes.filter((b) => b.memberId === me.id && b.isProject) : [];

  return (
    <Screen onRefresh={isDemo ? undefined : () => Promise.all([refresh(), refreshClub()]).then(() => undefined)}>
      {mine.length > 0 ? (
        <>
          <SectionTitle title="Your projects" />
          <Card style={{ padding: 0, gap: 0 }}>
            {mine.map((b, i) => (
              <ListRow
                key={b.id}
                left={<IconBadge icon="construct" tone="red" />}
                title={bikeLabel(b)}
                subtitle={updatesLabel(buildUpdates.filter((u) => u.bikeId === b.id && !u.takenDownAt).length)}
                onPress={() => navigation.navigate('BuildThread', { bikeId: b.id })}
                last={i === mine.length - 1}
              />
            ))}
          </Card>
        </>
      ) : (
        <Small>Got a project in the shed? Add it to your garage on Me and switch on “Project bike” to start its build thread.</Small>
      )}
      <SectionTitle title="Builds" />
      {!ready ? <ActivityIndicator color={colors.redText} /> : null}
      {ready && builds.length === 0 ? (
        <Card>
          <Small>No builds yet.</Small>
        </Card>
      ) : null}
      {builds.map((b) => (
        <BuildCard key={b.bike.id} build={b} />
      ))}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One bike's build
// ---------------------------------------------------------------------------

function UpdateCard({ update, onError }: { update: BuildUpdate; onError: (message: string) => void }) {
  const { me, data } = useClub();
  const { takeDownBuildUpdate } = useSocial();
  const { width } = useWindowDimensions();
  // Inside the screen's and the card's padding, the card's border, and one gap.
  const tile = Math.floor((Math.min(width, MAX_CONTENT_WIDTH) - space.lg * 4 - 2 - space.sm) / 2);
  return (
    <Card>
      <Text style={[type.name, { color: colors.boneDim }]}>{dayOf(update.postedAt)}</Text>
      {update.body ? <Body selectable>{update.body}</Body> : null}
      {update.photos.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {update.photos.map((p, i) =>
            update.photos.length === 1 ? (
              <ListingPhotoBox key={p.path} path={p.path} bucket="build" size={tile * 2 + space.sm} height={Math.round((tile * 2 + space.sm) * 0.75)} label="Photo" />
            ) : (
              <ListingPhotoBox key={p.path} path={p.path} bucket="build" size={tile} label={`Photo ${i + 1} of ${update.photos.length}`} />
            ),
          )}
        </View>
      ) : null}
      {canTakeDownUpdate(me, update, data.positions) ? (
        <ConfirmButton
          label="Take it down"
          confirmLabel="Take it down"
          kind="quiet"
          icon="archive-outline"
          confirmNote="Members won’t see this update any more."
          onConfirm={() => takeDownBuildUpdate(update.id).catch((e) => onError((e as Error).message))}
        />
      ) : null}
    </Card>
  );
}

export function BuildThreadScreen({ route, navigation }: RootScreen<'BuildThread'>) {
  const { me, data } = useClub();
  const { ready, buildUpdates } = useSocial();
  const chat = useChat();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ready) {
    return (
      <Screen>
        <ActivityIndicator color={colors.redText} />
      </Screen>
    );
  }
  const bike = data.bikes.find((b) => b.id === route.params.bikeId);
  const mine = !!me && bike?.memberId === me.id;
  const build = me && bike ? buildsFor(me, data.members, [bike], buildUpdates, chat.blocks)[0] : undefined;
  // Your own project shows even before its first update.
  if (!me || !bike || (!build && !(mine && bike.isProject))) {
    return (
      <Screen>
        <Notice title="Not found">There’s no build to show for that bike.</Notice>
      </Screen>
    );
  }
  const updates = build?.updates ?? [];
  const message = () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    chat
      .openDirect(bike.memberId)
      .then((chatId) => navigation.navigate('Chat', { chatId }))
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <Screen>
      <Card>
        <H2>{bikeLabel(bike)}</H2>
        {bike.nickname ? <Body>{fullBike(bike)}</Body> : null}
        <Small>{`${ownerLine(bike.memberId, data)} · ${updatesLabel(updates.length)}`}</Small>
      </Card>
      {mine && bike.isProject ? (
        <Button label="Post an update" icon="add" onPress={() => navigation.navigate('PostBuildUpdate', { bikeId: bike.id })} />
      ) : null}
      {mine && !bike.isProject ? <Small>This bike isn’t a project any more, so its build is finished. It stays here to look back on.</Small> : null}
      {!mine ? <Button label="Message the owner" kind="secondary" icon="chatbubble-outline" busy={busy} onPress={message} /> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {updates.length === 0 ? (
        <Card>
          <Small>No updates yet. Post the first one: where it’s at, what’s next.</Small>
        </Card>
      ) : null}
      {updates.map((u) => (
        <UpdateCard key={u.id} update={u} onError={setError} />
      ))}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Post an update
// ---------------------------------------------------------------------------

export function PostBuildUpdateScreen({ route, navigation }: RootScreen<'PostBuildUpdate'>) {
  const { me, data } = useClub();
  const { buildUpdates, postBuildUpdate } = useSocial();
  const { width } = useWindowDimensions();
  const [body, setBody] = useState('');
  const [added, setAdded] = useState<PickedMedia[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bike = data.bikes.find((b) => b.id === route.params.bikeId);
  const room = MAX_BUILD_PHOTOS - added.length;
  const tile = Math.floor((Math.min(width, MAX_CONTENT_WIDTH) - space.lg * 4 - 2 - space.sm) / 2);

  const pick = (source: 'library' | 'camera') => {
    setError(null);
    pickMedia(source, room, true)
      .then((picked) =>
        setAdded((a) => {
          // The same picture picked twice goes on once.
          const fresh = picked.filter((p, i) => p.kind === 'photo' && !a.some((x) => x.uri === p.uri) && picked.findIndex((x) => x.uri === p.uri) === i);
          return [...a, ...fresh].slice(0, MAX_BUILD_PHOTOS);
        }),
      )
      .catch((e) => setError(e instanceof PickProblem ? e.message : 'That photo couldn’t be opened. Try another.'));
  };

  const post = () => {
    if (busy) return;
    setError(null);
    const standIns = added.map((p, i) => ({ path: `${me?.id ?? ''}/new-${i}`, width: p.width, height: p.height }));
    const problem = buildPostProblem(me, { bikeId: route.params.bikeId, body, photos: standIns }, data.bikes, buildUpdates);
    if (problem) return setError(problem);
    setBusy(true);
    postBuildUpdate({ bikeId: route.params.bikeId, body, photos: [] }, added)
      .then(() => navigation.goBack())
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <Screen>
      {bike ? <H2>{bikeLabel(bike)}</H2> : null}
      <Card>
        <Field label="What’s new" value={body} onChangeText={setBody} multiline placeholder="What you did, what broke, what’s next" maxLength={2000} />
      </Card>
      <Card>
        <Text style={[type.name, { color: colors.boneDim }]}>{`Photos (up to ${MAX_BUILD_PHOTOS})`}</Text>
        {added.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {added.map((p, i) => (
              <View key={p.uri}>
                <ListingPhotoBox uri={p.uri} size={tile} label={`Photo ${i + 1}`} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${i + 1}`}
                  onPress={() => setAdded((a) => a.filter((x) => x.uri !== p.uri))}
                  style={{ position: 'absolute', top: 0, right: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="close" size={18} color={colors.bone} />
                  </View>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        {room > 0 ? (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Add photos" kind="secondary" icon="images-outline" onPress={() => pick('library')} style={{ flex: 1 }} />
            {Platform.OS !== 'web' ? (
              <Button label="Camera" kind="secondary" icon="camera-outline" onPress={() => pick('camera')} style={{ flex: 1 }} />
            ) : null}
          </View>
        ) : null}
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Post it" icon="checkmark" busy={busy} onPress={post} />
    </Screen>
  );
}
