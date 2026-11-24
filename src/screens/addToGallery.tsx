// Add to the gallery: photos and videos straight into Photos, filed under a ride or Club life, with
// an optional caption and an "OK for the website" tick that the website crew then check.
// Rules: src/domain/gallery.ts. Spec: docs/superpowers/specs/2026-11-23-club-gallery-design.md

import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { useChat } from '../data/chat/ChatProvider';
import { pickMedia, PickProblem } from '../data/chat/media';
import type { PickedMedia } from '../domain/chat';
import { formatAuDate } from '../domain/dates';
import { addProblem, albumChoices, CLUB_LIFE, GALLERY_CONSENT_LINE, GALLERY_MAX, type Album } from '../domain/gallery';
import { melbourneDate } from '../domain/rides';
import { CAPTION_MAX } from '../domain/sitePhotos';
import type { RootScreen } from '../navigation/types';
import { colors, fonts, MAX_CONTENT_WIDTH, space } from '../theme';
import { Button, Card, Field, Ionicons, ListRow, Notice, Screen, SectionTitle, Small, Stack, Toggle } from '../ui/primitives';

const COLUMNS = 4;
const GAP = 4;

export function AddToGalleryScreen({ navigation, route }: RootScreen<'AddToGallery'>) {
  const { me, data, today } = useClub();
  const chat = useChat();
  const { width } = useWindowDimensions();
  const cell = Math.floor((Math.min(width, MAX_CONTENT_WIDTH) - space.lg * 2 - GAP * (COLUMNS - 1)) / COLUMNS);
  const passedId = route.params?.rideId;
  // The app's ride list starts today; the database lists the last 30 days.
  const [loaded, setLoaded] = useState<Album[] | null>(null);
  const albums = albumChoices(loaded ?? data.rides, today);
  const [files, setFiles] = useState<PickedMedia[]>([]);
  const [rideId, setRideId] = useState<string | null>(passedId ?? albums[0]?.id ?? null);
  const picked = useRef(!!passedId);
  useEffect(() => {
    let live = true;
    chat
      .galleryAlbums()
      .then((list) => {
        if (!live) return;
        setLoaded(list);
        if (!picked.current) setRideId(albumChoices(list, today)[0]?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Once per visit: a later pick by the member must not be overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [caption, setCaption] = useState('');
  const [websiteOk, setWebsiteOk] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  const room = GALLERY_MAX - files.length;
  const pick = (source: 'library' | 'camera') => {
    setError(null);
    pickMedia(source, room)
      .then((more) => setFiles((now) => [...now, ...more].slice(0, GALLERY_MAX)))
      .catch((e) => setError(e instanceof PickProblem ? e.message : 'That couldn’t be opened. Try another.'));
  };
  // A ride passed in from its wall may be older than the picker's 30 days: keep it on the list.
  const passed: Album | undefined = passedId
    ? (data.rides.find((r) => r.id === passedId) ??
      (route.params?.rideTitle && route.params.rideStartsAt
        ? { id: passedId, title: route.params.rideTitle, startsAt: route.params.rideStartsAt, cancelledAt: null }
        : undefined))
    : undefined;
  const shownAlbums = passed && !albums.some((r) => r.id === passed.id) ? [passed, ...albums] : albums;
  const choose = (id: string | null) => {
    picked.current = true;
    setRideId(id);
  };

  const send = async () => {
    const input = { rideId, caption, websiteOk, consent, count: files.length };
    const cant = addProblem(me, input, shownAlbums);
    if (cant) return setError(cant);
    setBusy(true);
    setError(null);
    try {
      const n = await chat.addToGallery({ rideId, caption, websiteOk, consent, files });
      setBusy(false);
      navigation.navigate('Photos', { added: n });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <SectionTitle title={files.length ? `${files.length} picked` : 'Photos and videos'} />
        {files.length ? (
          <View style={styles.grid}>
            {files.map((f, i) => (
              <View key={`${f.uri}-${i}`} style={{ width: cell, height: cell }}>
                <Image source={{ uri: f.uri }} style={[StyleSheet.absoluteFill, styles.thumb]} contentFit="cover" accessibilityLabel={f.kind === 'video' ? 'Picked video' : 'Picked photo'} />
                {f.kind === 'video' ? (
                  <View style={styles.play} pointerEvents="none">
                    <Ionicons name="play" size={16} color={colors.bone} />
                  </View>
                ) : null}
                <Pressable
                  onPress={() => setFiles((now) => now.filter((_, j) => j !== i))}
                  accessibilityRole="button"
                  accessibilityLabel={`Take out ${f.kind === 'video' ? 'video' : 'photo'} ${i + 1}`}
                  style={styles.remove}
                  hitSlop={8}
                >
                  <Ionicons name="close" size={16} color={colors.bone} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <Small>Up to {GALLERY_MAX} at a time. Videos can be up to 60 seconds.</Small>
        )}
        {room > 0 ? (
          <Stack gap={space.sm}>
            <Button label="From your phone" kind="secondary" icon="images-outline" onPress={() => pick('library')} disabled={busy} />
            <Button label="Camera" kind="secondary" icon="camera-outline" onPress={() => pick('camera')} disabled={busy} />
          </Stack>
        ) : null}
      </Card>

      <SectionTitle title="Album" />
      <Card style={{ padding: 0 }}>
        {shownAlbums.map((r) => (
          <ListRow
            key={r.id}
            title={r.title}
            subtitle={formatAuDate(melbourneDate(r.startsAt))}
            checked={rideId === r.id}
            onPress={() => choose(r.id)}
          />
        ))}
        <ListRow title={CLUB_LIFE} subtitle="Not from a ride" checked={rideId === null} onPress={() => choose(null)} last />
      </Card>

      <Card>
        <Field label="Caption (optional)" value={caption} onChangeText={setCaption} maxLength={CAPTION_MAX} placeholder="Coming down off the Otways" />
        <Toggle
          label="OK for the website"
          description="The Social Media Officer or their crew check it before it goes on the club website. Captions only, never names."
          value={websiteOk}
          onChange={(v) => {
            setWebsiteOk(v);
            if (!v) setConsent(false);
          }}
        />
        {websiteOk ? <Toggle label={GALLERY_CONSENT_LINE} value={consent} onChange={setConsent} /> : null}
      </Card>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Stack>
        <Button
          label={files.length > 1 ? `Add ${files.length} to the gallery` : 'Add to the gallery'}
          icon="cloud-upload-outline"
          onPress={send}
          busy={busy}
          disabled={busy || files.length === 0 || (websiteOk && !consent)}
        />
        {busy ? <Text style={styles.wait}>Uploading. Videos take a little longer.</Text> : null}
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  thumb: { borderRadius: 3, backgroundColor: colors.steel },
  play: { position: 'absolute', left: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, padding: 2 },
  remove: { position: 'absolute', top: 3, right: 3, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.65)' },
  wait: { fontFamily: fonts.body, color: colors.boneMute, textAlign: 'center' },
});
