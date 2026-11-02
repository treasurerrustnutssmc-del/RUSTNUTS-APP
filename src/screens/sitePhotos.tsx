// Club photos for the website (website-and-app task 23): the editors' list and crew, picking a
// photo from the club's chats or the phone (it goes straight up; the poster gets a heads-up push
// and can take it down here), and the row on the Photos screen that leads here.

import { Image } from 'expo-image';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { PickProblem, pickMedia } from '../data/chat/media';
import { useChat } from '../data/chat/ChatProvider';
import type { FeedItem, MediaSource } from '../data/chat/chatContext';
import { siteMediaUrl, useSitePhotos } from '../data/sitePhotos';
import type { PickedMedia } from '../domain/chat';
import { formatAuDate } from '../domain/dates';
import { displayName } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import { CAPTION_MAX, CONSENT_LINE, PHOTOS_SHOWN, type PickablePhoto, type SitePhoto, type SitePhotoStatus } from '../domain/sitePhotos';
import type { RootScreen } from '../navigation/types';
import { colors, MAX_CONTENT_WIDTH, space, type } from '../theme';
import { asImage, MediaTile, useMediaSource } from '../ui/ChatBits';
import { Button, Card, Chip, ConfirmButton, Field, H2, IconBadge, KeyValue, ListRow, Notice, Row, Screen, SectionTitle, Small, Stack, Toggle } from '../ui/primitives';
import { MemberPicker } from './adminBits';

const COLUMNS = 3;
const GAP = 3;
const STATUS_WORD: Record<SitePhotoStatus, string> = { live: 'On the website', removed: 'Taken down' };
const STATUS_TONE: Record<SitePhotoStatus, 'steel' | 'warn' | 'bone' | 'ok'> = { live: 'ok', removed: 'bone' };

/** A picture source for a photo on the list, whichever bucket holds it. */
function useSitePhotoSource(photo: Pick<SitePhoto, 'bucket' | 'path'>): MediaSource | null {
  const fromChat = useMediaSource(photo.bucket === 'chat-media' ? photo.path : null);
  const [fromSite, setFromSite] = useState<{ path: string; value: MediaSource } | null>(null);
  useEffect(() => {
    if (photo.bucket !== 'site-media') return;
    let live = true;
    siteMediaUrl(photo.path).then(
      (value) => live && setFromSite({ path: photo.path, value }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [photo.bucket, photo.path]);
  if (photo.bucket === 'chat-media') return fromChat;
  return fromSite?.path === photo.path ? fromSite.value : null;
}

function Thumb({ photo, size = 88 }: { photo: Pick<SitePhoto, 'bucket' | 'path'>; size?: number }) {
  const shown = useSitePhotoSource(photo);
  return (
    <View style={[styles.thumb, { width: size, height: size }]} accessibilityRole="image" accessibilityLabel="The photo">
      {shown !== null ? <Image source={asImage(shown, photo.path)} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
    </View>
  );
}

/** The caption and consent tick, shared by the pick and upload forms. */
function PickForm({
  verb, onSend, onCancel, busy, error,
}: {
  verb: string;
  onSend: (caption: string, consent: boolean) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [caption, setCaption] = useState('');
  const [consent, setConsent] = useState(false);
  return (
    <Stack>
      <Field label="Caption (optional)" value={caption} onChangeText={setCaption} maxLength={CAPTION_MAX} placeholder="Spring run to Lorne" hint="Shown under the photo on the website. No names needed." />
      <Toggle label={CONSENT_LINE} value={consent} onChange={setConsent} />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Row style={{ gap: space.sm }}>
        <Button label="Cancel" kind="secondary" onPress={onCancel} disabled={busy} style={{ flex: 1 }} />
        <Button label={verb} icon="globe-outline" onPress={() => onSend(caption, consent)} disabled={busy || !consent} busy={busy} style={{ flex: 2 }} />
      </Row>
    </Stack>
  );
}

// ---------------------------------------------------------------------------------------------
// The list and the crew

export function WebsitePhotosScreen({ navigation }: RootScreen<'WebsitePhotos'>) {
  const { me } = useClub();
  const { ready, photos, crew, editor, crewManager, loadError, upload, remove, setCrew, refresh } = useSitePhotos();
  const [done, setDone] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedMedia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  const fromPhone = () => {
    setError(null);
    pickMedia('library', 1, true)
      .then((items) => items[0] && setPicked(items[0]))
      .catch((e) => setError(e instanceof PickProblem ? e.message : 'That photo couldn’t be opened. Try another.'));
  };
  const sendUpload = async (caption: string, consent: boolean) => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await upload(picked, { caption, consent });
      setPicked(null);
      setDone('It’s on the website. The site shows it within a few minutes.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mine = photos.filter((p) => p.postedBy === me.id);
  return (
    <Screen onRefresh={refresh}>
      {done ? (
        <Notice tone="ok" title="Done">{done}</Notice>
      ) : null}
      {editor ? (
        <Card>
          <H2>Website photos</H2>
          <Small>
            What the club website shows the public: the newest {PHOTOS_SHOWN} photos here. Pick from the club’s chats, or straight from your phone. It goes up
            straight away, and the member who posted it gets a heads-up and can take it down. Captions only, never names.
          </Small>
          {picked ? (
            <Stack>
              <Row style={{ gap: space.md, alignItems: 'center' }}>
                <Image source={{ uri: picked.uri }} style={styles.thumb} contentFit="cover" accessibilityLabel="The photo from your phone" />
                <Small style={{ flex: 1 }}>From your phone, {picked.width}×{picked.height}</Small>
              </Row>
              <PickForm verb="Put it up" onSend={sendUpload} onCancel={() => setPicked(null)} busy={busy} error={error} />
            </Stack>
          ) : (
            <>
              {error ? <Notice tone="danger">{error}</Notice> : null}
              <Row style={{ gap: space.sm }}>
                <Button label="From the club’s photos" icon="images-outline" onPress={() => navigation.navigate('PickWebsitePhoto')} style={{ flex: 1 }} />
                <Button label="From your phone" kind="secondary" icon="camera-outline" onPress={fromPhone} style={{ flex: 1 }} />
              </Row>
            </>
          )}
        </Card>
      ) : null}

      {crewManager ? <CrewSection crew={crew} setCrew={setCrew} onDone={setDone} /> : null}

      <SectionTitle title={editor ? 'The list' : 'Your photos on the website'} action={<Small>{editor ? photos.length : mine.length}</Small>} />
      {loadError ? (
        <Notice tone="danger">{loadError}</Notice>
      ) : !ready ? (
        <ActivityIndicator color={colors.boneMute} />
      ) : (editor ? photos : mine).length === 0 ? (
        <Notice title={editor ? 'Nothing picked yet' : 'None yet'}>
          {editor
            ? 'The website’s Photos strip stays hidden until there is.'
            : 'When the Social Media Officer or their crew put one of your photos on the club website, it shows here and you can take it down.'}
        </Notice>
      ) : (
        (editor ? photos : mine).map((p) => <PhotoCard key={p.id} photo={p} canRemove={editor || p.postedBy === me.id} remove={remove} onDone={setDone} />)
      )}
      {editor || mine.length > 0 ? <Small>Anyone can take their own photo down, any time.</Small> : null}
    </Screen>
  );
}

function PhotoCard({ photo, canRemove, remove, onDone }: { photo: SitePhoto; canRemove: boolean; remove: (id: string) => Promise<void>; onDone: (msg: string) => void }) {
  const { data } = useClub();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const poster = data.members.find((m) => m.id === photo.postedBy);
  const picker = data.members.find((m) => m.id === photo.pickedBy);
  const takeDown = async () => {
    setBusy(true);
    setError(null);
    try {
      await remove(photo.id);
      onDone('It’s off the website.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={photo.status === 'removed' ? { opacity: 0.7 } : undefined}>
      <Row style={{ gap: space.md, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <Thumb photo={photo} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={type.name}>{photo.caption ?? 'No caption'}</Text>
          <Small>{poster ? displayName(poster) : 'Former member'}’s photo · {photo.source === 'upload' ? 'from the phone' : 'from a club chat'}</Small>
          <Small>Picked {formatAuDate(melbourneDate(photo.pickedAt))}{picker ? ` by ${displayName(picker)}` : ''}</Small>
          <Chip label={STATUS_WORD[photo.status]} tone={STATUS_TONE[photo.status]} />
        </View>
      </Row>
      {photo.status === 'removed' ? (
        <KeyValue label="Taken down" value={formatAuDate(melbourneDate(photo.removedAt!))} />
      ) : canRemove ? (
        <>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <ConfirmButton
            label="Take down"
            confirmLabel="Yes, take it down"
            kind="secondary"
            icon="eye-off-outline"
            disabled={busy}
            onConfirm={() => void takeDown()}
            accessibilityLabel={`Take ${photo.caption ?? 'this photo'} off the website`}
          />
        </>
      ) : null}
    </Card>
  );
}

function CrewSection({ crew, setCrew, onDone }: { crew: { memberId: string }[]; setCrew: (memberId: string, on: boolean) => Promise<void>; onDone: (msg: string) => void }) {
  const { me, data } = useClub();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onCrew = new Set(crew.map((c) => c.memberId));
  const choices = data.members.filter((m) => m.approval === 'approved' && !m.onHiatus && !onCrew.has(m.id) && m.id !== me?.id);
  const run = async (memberId: string, on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await setCrew(memberId, on);
      setPickedId(null);
      const who = data.members.find((m) => m.id === memberId);
      onDone(`${who ? displayName(who) : 'They'} ${on ? 'can now put photos on the website.' : 'are off the website photo crew.'}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionTitle title="Website photo crew" action={<Small>{crew.length}</Small>} />
      <Card>
        <Small>Members you trust to pick and post photos alongside you. The Social Media Officer and the NEC always can.</Small>
        {crew.length === 0 ? (
          <Small>Nobody on the crew yet.</Small>
        ) : (
          crew.map((c, i) => {
            const m = data.members.find((x) => x.id === c.memberId);
            return (
              <ListRow
                key={c.memberId}
                last={i === crew.length - 1}
                title={m ? displayName(m) : 'Former member'}
                subtitle={m && m.fullName !== displayName(m) ? m.fullName : undefined}
                right={
                  <ConfirmButton
                    label="Remove"
                    confirmLabel="Yes, remove"
                    kind="secondary"
                    size="small"
                    disabled={busy}
                    onConfirm={() => void run(c.memberId, false)}
                    accessibilityLabel={`Take ${m ? displayName(m) : 'them'} off the website photo crew`}
                  />
                }
              />
            );
          })
        )}
        <MemberPicker label="Add to the crew" choices={choices} picked={pickedId ? [pickedId] : []} onChange={(ids) => setPickedId(ids[0] ?? null)} />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button label="Add to the crew" icon="people-outline" onPress={() => pickedId && void run(pickedId, true)} disabled={busy || !pickedId} busy={busy} />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Picking from the club's photos

export function PickWebsitePhotoScreen({ navigation }: RootScreen<'PickWebsitePhoto'>) {
  const { me, data } = useClub();
  const chat = useChat();
  const { photos: list, pick } = useSitePhotos();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [chosen, setChosen] = useState<FeedItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cell = Math.floor((Math.min(width, MAX_CONTENT_WIDTH) - space.lg * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

  const load = useCallback(async () => {
    setError(null);
    try {
      // club_photos never includes private chats; keep photos only.
      setItems((await chat.photos()).filter((m) => m.kind === 'photo'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [chat]);
  useEffect(() => {
    let live = true;
    chat.photos().then(
      (all) => live && setItems(all.filter((m) => m.kind === 'photo')),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [chat]);

  if (!me) return null;
  const taken = new Set(list.filter((p) => p.status !== 'removed' && p.mediaId).map((p) => p.mediaId));
  const pickable = (m: FeedItem): PickablePhoto => ({ media: m, chatKind: 'club', authorId: m.authorId });
  const send = async (caption: string, consent: boolean) => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await pick(pickable(chosen), { caption, consent });
      setBusy(false);
      navigation.goBack();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const who = chosen ? data.members.find((m) => m.id === chosen.authorId) : undefined;
  const own = chosen ? chosen.authorId === me.id : false;

  return (
    <Screen onRefresh={load}>
      {chosen ? (
        <Card>
          <Row style={{ gap: space.md, alignItems: 'center' }}>
            <Thumb photo={{ bucket: 'chat-media', path: chosen.path }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.name}>{who ? displayName(who) : 'A former member'}’s photo</Text>
              <Small>{formatAuDate(melbourneDate(chosen.createdAt))}</Small>
              <Small>{own ? 'Yours. It goes straight up.' : who ? `It goes straight up. ${displayName(who)} gets a heads-up and can take it down.` : 'It goes straight up.'}</Small>
            </View>
          </Row>
          <PickForm verb="Put it up" onSend={send} onCancel={() => setChosen(null)} busy={busy} error={error} />
        </Card>
      ) : (
        <>
          <Small>Tap a photo from the club’s chats. Ones already on the list are marked.</Small>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {items === null ? (
            <ActivityIndicator color={colors.boneMute} />
          ) : items.length === 0 ? (
            <Notice title="No photos yet">Photos posted in the club, chapter and ride chats show up here.</Notice>
          ) : (
            <View style={styles.grid}>
              {items.map((m) => {
                const author = data.members.find((x) => x.id === m.authorId);
                const onList = taken.has(m.id);
                return (
                  <View key={m.id} style={{ width: cell, height: cell }}>
                    <MediaTile
                      media={m}
                      style={{ width: cell, height: cell, borderRadius: 2, opacity: onList ? 0.45 : 1 }}
                      onPress={onList ? undefined : () => setChosen(m)}
                      label={`${onList ? 'Already on the list: ' : ''}Photo from ${author ? displayName(author) : 'a former member'}, ${formatAuDate(melbourneDate(m.createdAt))}`}
                    />
                    {onList ? (
                      <View style={styles.onList} pointerEvents="none">
                        <Text style={styles.onListText}>On the list</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------------------------
// The Photos screen

/** The row on the Photos screen that leads to the website list. */
export function WebsitePhotosRow({ onOpen }: { onOpen: () => void }) {
  const { editor, photos } = useSitePhotos();
  const live = photos.filter((p) => p.status === 'live').length;
  return (
    <Card style={{ padding: 0, gap: 0 }}>
      <ListRow
        last
        left={<IconBadge icon="globe-outline" />}
        title="Website photos"
        subtitle={
          editor
              ? `${live} on the club website · pick what the public sees`
              : 'The photos of yours on the club website'
        }
        onPress={onOpen}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 88, height: 88, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.steel },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  onList: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  onListText: { ...type.small, color: colors.bone, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2 },
});
