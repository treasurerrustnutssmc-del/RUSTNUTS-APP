// Photos: everything members have posted in the chats you can read (never private chats), each
// ride's wall of photos, and a full-screen viewer for photos and videos.

import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClub } from '../data/ClubStore';
import { useChat } from '../data/chat/ChatProvider';
import type { FeedItem, RideWall } from '../data/chat/chatContext';
import { formatAuDate } from '../domain/dates';
import { canAddToGallery, removeProblem as galleryRemoveProblem } from '../domain/gallery';
import { RIDE_CATEGORY_LABEL } from '../domain/labels';
import { displayName } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import type { Ride } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { colors, fonts, MAX_CONTENT_WIDTH, rideColors, space, type } from '../theme';
import { saveToPhone, SaveProblem } from '../data/saveMedia';
import { useSitePhotos } from '../data/sitePhotos';
import { asImage, MediaTile, useMediaSource } from '../ui/ChatBits';
import { ZoomablePhoto } from '../ui/ZoomablePhoto';
import { Button, Card, Choices, ConfirmButton, Ionicons, ListRow, Notice, Row, Screen, Small } from '../ui/primitives';
import { WebsitePhotosRow } from './sitePhotos';

const COLUMNS = 3;
const GAP = 3;

function useGridCell() {
  const { width } = useWindowDimensions();
  const inner = Math.min(width, MAX_CONTENT_WIDTH) - space.lg * 2;
  return Math.floor((inner - GAP * (COLUMNS - 1)) / COLUMNS);
}

/** Photos and videos in rows of three, tap one to see it full size. */
function PhotoGrid({ items, onOpen }: { items: FeedItem[]; onOpen: (index: number) => void }) {
  const cell = useGridCell();
  const { data } = useClub();
  return (
    <View style={styles.grid}>
      {items.map((m, i) => {
        const who = data.members.find((x) => x.id === m.authorId);
        return (
          <MediaTile
            key={m.id}
            media={m}
            style={{ width: cell, height: cell, borderRadius: 2 }}
            onPress={() => onOpen(i)}
            label={`${m.kind === 'video' ? 'Video' : 'Photo'} from ${who ? displayName(who) : 'a former member'}, ${formatAuDate(melbourneDate(m.createdAt))}${m.gallery?.caption ? `, ${m.gallery.caption}` : ''}`}
          />
        );
      })}
    </View>
  );
}

function RideSwatch({ ride }: { ride: Ride }) {
  const c = rideColors[ride.category];
  return (
    <View style={[styles.swatch, { backgroundColor: c.bg }]}>
      <Text style={[styles.swatchText, { color: c.fg }]} numberOfLines={1}>{RIDE_CATEGORY_LABEL[ride.category]}</Text>
    </View>
  );
}

function WallCover({ item }: { item: FeedItem | null }) {
  const shown = useMediaSource(item ? (item.kind === 'video' ? item.posterPath : item.path) : null);
  return (
    <View style={styles.cover}>
      {shown !== null ? <Image source={asImage(shown, item && (item.kind === 'video' ? item.posterPath : item.path))} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
    </View>
  );
}

export function PhotosScreen({ navigation, route }: RootScreen<'Photos'>) {
  const chat = useChat();
  const { me } = useClub();
  const added = route.params?.added;
  const addedAt = route.params?.at;
  const [tab, setTab] = useState<'latest' | 'walls'>('latest');
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [walls, setWalls] = useState<RideWall[] | null>(null);
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [latest, w] = await Promise.all([chat.photos(), chat.rideWalls()]);
      setItems(latest);
      setWalls(w);
      setMore(latest.length >= 60);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [chat]);

  // Back from Add to the gallery: show what just went in.
  useEffect(() => {
    if (!added) return;
    let live = true;
    Promise.all([chat.photos(), chat.rideWalls()]).then(
      ([latest, w]) => {
        if (!live) return;
        setItems(latest);
        setWalls(w);
        setMore(latest.length >= 60);
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [added, addedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    Promise.all([chat.photos(), chat.rideWalls()]).then(
      ([latest, w]) => {
        if (!live) return;
        setItems(latest);
        setWalls(w);
        setMore(latest.length >= 60);
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = async () => {
    const oldest = items?.[items.length - 1];
    if (!oldest || busy) return;
    setBusy(true);
    try {
      const older = await chat.photos(oldest.createdAt);
      setItems((now) => [...(now ?? []), ...older.filter((o) => !now?.some((n) => n.id === o.id))]);
      setMore(older.length >= 60);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Screen onRefresh={load}>
      {added ? (
        <Notice tone="ok" title="Added">
          {`${added === 1 ? 'It’s in the gallery.' : added === 2 ? 'Both are in the gallery.' : `All ${added} are in the gallery.`} Everyone in the club can see and save ${added === 1 ? 'it' : 'them'}.`}
        </Notice>
      ) : null}
      {canAddToGallery(me) ? (
        <Button label="Add photos and videos" icon="add-circle-outline" onPress={() => navigation.navigate('AddToGallery')} />
      ) : null}
      <WebsitePhotosRow onOpen={() => navigation.navigate('WebsitePhotos')} />
      <Choices
        options={[
          { value: 'latest', label: 'Latest' },
          { value: 'walls', label: 'Ride walls' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {tab === 'latest' ? (
        items === null ? (
          <ActivityIndicator color={colors.boneMute} />
        ) : items.length === 0 ? (
          <Notice title="No photos yet">Photos and videos added here, or posted in the club, chapter and ride chats, show up here.</Notice>
        ) : (
          <>
            <PhotoGrid items={items} onOpen={(index) => navigation.navigate('MediaViewer', { items, index })} />
            {more ? <Button label="Show older" kind="secondary" busy={busy} onPress={loadMore} /> : null}
          </>
        )
      ) : walls === null ? (
        <ActivityIndicator color={colors.boneMute} />
      ) : walls.length === 0 ? (
        <Notice title="No ride walls yet">Photos posted in a ride’s chat, or added to a ride’s album, make that ride’s wall.</Notice>
      ) : (
        <Card style={{ padding: 0 }}>
          {walls.map((w, i) => (
            <ListRow
              key={w.ride.id}
              last={i === walls.length - 1}
              left={<WallCover item={w.cover} />}
              title={w.ride.title}
              subtitle={
                <View style={{ gap: 6 }}>
                  <Small>{formatAuDate(melbourneDate(w.ride.startsAt))} · {w.count} {w.count === 1 ? 'photo' : 'photos'}</Small>
                  <RideSwatch ride={w.ride} />
                </View>
              }
              onPress={() => navigation.navigate('RideWall', { rideId: w.ride.id })}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}

export function RideWallScreen({ route, navigation }: RootScreen<'RideWall'>) {
  const chat = useChat();
  const { me } = useClub();
  const [wall, setWall] = useState<{ ride: Ride; chatId: string | null; media: FeedItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    chat.rideWall(route.params.rideId).then((w) => live && setWall(w), (e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [route.params.rideId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (wall) navigation.setOptions({ title: wall.ride.title });
  }, [navigation, wall]);
  return (
    <Screen>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!wall && !error ? <ActivityIndicator color={colors.boneMute} /> : null}
      {wall ? (
        <>
          <Small>{formatAuDate(melbourneDate(wall.ride.startsAt))}{wall.ride.location ? ` · ${wall.ride.location}` : ''}</Small>
          {wall.media.length ? (
            <PhotoGrid items={wall.media} onOpen={(index) => navigation.navigate('MediaViewer', { items: wall.media, index })} />
          ) : (
            <Notice title="No photos yet">Add them here or post them in the ride’s chat and they land here.</Notice>
          )}
          {canAddToGallery(me) ? (
            <Button label="Add photos and videos" icon="add-circle-outline" onPress={() => navigation.navigate('AddToGallery', { rideId: wall.ride.id, rideTitle: wall.ride.title, rideStartsAt: wall.ride.startsAt })} />
          ) : null}
          <Button
            label="Ride chat"
            kind="secondary"
            icon="chatbubbles-outline"
            onPress={() =>
              wall.chatId
                ? navigation.navigate('Chat', { chatId: wall.chatId })
                : chat.rideChat(wall.ride.id).then((chatId) => navigation.navigate('Chat', { chatId }), (e: Error) => setError(e.message))
            }
          />
        </>
      ) : null}
    </Screen>
  );
}

function VideoPage({ item, width, height, active }: { item: FeedItem; width: number; height: number; active: boolean }) {
  const source = useMediaSource(item.path);
  const player = useVideoPlayer(typeof source === 'string' ? source : null, (p) => {
    p.loop = false;
  });
  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);
  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      {source ? (
        <VideoView player={player} style={{ width, height }} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }} />
      ) : (
        <ActivityIndicator color={colors.boneMute} />
      )}
    </View>
  );
}

function PhotoPage({ item, width, height, onZoomed }: { item: FeedItem; width: number; height: number; onZoomed: (zoomed: boolean) => void }) {
  const source = useMediaSource(item.path);
  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      {source !== null ? (
        <ZoomablePhoto width={width} height={height} onZoomed={onZoomed} accessibilityLabel={item.gallery?.caption ?? 'Photo'}>
          <Image source={asImage(source, item.path)} style={{ width, height }} contentFit="contain" />
        </ZoomablePhoto>
      ) : (
        <ActivityIndicator color={colors.boneMute} />
      )}
    </View>
  );
}

/** Save, and for a gallery item its take-down, under the viewer. */
function ViewerActions({ item, onOpenChat, onTakenDown }: { item: FeedItem; onOpenChat: (chatId: string) => void; onTakenDown: () => void }) {
  const chat = useChat();
  const { me, data } = useClub();
  const { crew } = useSitePhotos();
  const source = useMediaSource(item.path);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const kind = item.kind === 'video' ? 'video' : 'photo';
  const save = async () => {
    if (source === null) return;
    setBusy(true);
    setNote(null);
    try {
      await saveToPhone(source, { kind, path: item.path, createdAt: item.createdAt, id: item.id });
    } catch (e) {
      setNote(e instanceof SaveProblem ? e.message : 'That one couldn’t be saved. Try again.');
    }
    setBusy(false);
  };
  const canTakeDown =
    !!item.gallery &&
    galleryRemoveProblem(me, data.positions, crew, {
      id: item.id, uploadedBy: item.authorId, rideId: item.gallery.rideId, kind, path: item.path, posterPath: item.posterPath,
      width: item.width, height: item.height, durationMs: item.durationMs, caption: item.gallery.caption, websiteOk: false,
      websiteDeclinedAt: null, onWebsite: false, createdAt: item.createdAt, removedAt: null,
    }) === null;
  const takeDown = async () => {
    try {
      await chat.removeGalleryItem(item.id);
      onTakenDown();
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  return (
    <View style={styles.viewerBottom}>
      {item.gallery?.caption ? <Text style={styles.caption} numberOfLines={2}>{item.gallery.caption}</Text> : null}
      {note ? <Small style={{ color: colors.danger, textAlign: 'center' }}>{note}</Small> : null}
      <Row style={{ gap: space.sm, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button
          label="Save"
          kind="quiet"
          icon="download-outline"
          busy={busy}
          disabled={busy || source === null}
          onPress={save}
          accessibilityLabel={item.kind === 'video' ? 'Save this video to your phone' : 'Save this photo to your phone'}
        />
        {item.conversationId ? (
          <Button label="Open the chat" kind="quiet" icon="chatbubbles-outline" onPress={() => onOpenChat(item.conversationId as string)} />
        ) : null}
        {canTakeDown ? (
          <ConfirmButton
            label="Take down"
            confirmLabel="Yes, take it down"
            kind="quiet"
            icon="trash-outline"
            confirmNote="It leaves the gallery, and the website if it’s there."
            onConfirm={takeDown}
          />
        ) : null}
      </Row>
    </View>
  );
}

export function MediaViewerScreen({ route, navigation }: RootScreen<'MediaViewer'>) {
  const [items, setItems] = useState(route.params.items);
  const { data } = useClub();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(route.params.index);
  // While a photo is zoomed, a drag moves about the photo instead of swiping to the next one.
  const [zoomed, setZoomed] = useState(false);
  const current = items[index];
  // Family chat: Family know people by the chat's names (data.chatPeople), not the directory.
  const who = current ? [...data.members, ...(data.chatPeople ?? [])].find((m) => m.id === current.authorId) : undefined;
  const pageHeight = height - insets.top - insets.bottom - 120;
  return (
    <View style={[styles.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.viewerTop}>
        <View style={{ flex: 1 }}>
          <Text style={type.name} numberOfLines={1}>{who ? displayName(who) : 'Former member'}</Text>
          {current ? <Small>{formatAuDate(melbourneDate(current.createdAt))} · {index + 1} of {items.length}</Small> : null}
        </View>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Close" style={styles.close} hitSlop={8}>
          <Ionicons name="close" size={26} color={colors.bone} />
        </Pressable>
      </View>
      <FlatList
        data={items}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed}
        initialScrollIndex={route.params.index}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(m) => m.id}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        onScroll={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width);
          if (i !== index && i >= 0 && i < items.length) setIndex(i);
        }}
        scrollEventThrottle={64}
        renderItem={({ item, index: i }) =>
          item.kind === 'video' ? (
            <VideoPage item={item} width={width} height={pageHeight} active={i === index} />
          ) : (
            <PhotoPage key={item.id} item={item} width={width} height={pageHeight} onZoomed={setZoomed} />
          )
        }
      />
      {current ? (
        <ViewerActions
          key={current.id}
          item={current}
          onOpenChat={(chatId) => navigation.navigate('Chat', { chatId })}
          onTakenDown={() => {
            const left = items.filter((m) => m.id !== current.id);
            if (!left.length) return navigation.goBack();
            setItems(left);
            setIndex(Math.min(index, left.length - 1));
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  swatch: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2 },
  swatchText: { fontFamily: fonts.stencil, fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase' },
  cover: { width: 56, height: 56, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.steel },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerTop: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 64 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  viewerBottom: { minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: space.lg },
  caption: { fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: colors.bone, textAlign: 'center' },
});
