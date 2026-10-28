// Stage 7: swap and sell. Members list parts and gear for sale, to swap, free, or wanted, and
// message the seller. The app never writes the message: "Message the seller" only opens the chat.

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useChat } from '../data/chat/ChatProvider';
import { PickProblem, pickMedia } from '../data/chat/media';
import { useClub } from '../data/ClubStore';
import { useSocial } from '../data/social/SocialProvider';
import type { MediaSource } from '../data/chat/chatContext';
import type { PickedMedia } from '../domain/chat';
import { formatAuDate } from '../domain/dates';
import { displayName } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import {
  canTakeDown,
  kindLabel,
  LISTING_KINDS,
  listingProblem,
  listingsFor,
  MAX_LISTING_PHOTOS,
  priceLabel,
  type Listing,
  type ListingInput,
  type ListingKind,
  type ListingPhoto,
} from '../domain/social/swap';
import type { ClubData } from '../domain/types';
import type { RootParams, RootScreen } from '../navigation/types';
import { asImage } from '../ui/ChatBits';
import { colors, MAX_CONTENT_WIDTH, radius, space, type } from '../theme';
import {
  Body,
  Button,
  Card,
  Chip,
  ConfirmButton,
  Field,
  H2,
  IconBadge,
  Ionicons,
  KeyValue,
  ListRow,
  Notice,
  Screen,
  SectionTitle,
  Small,
} from '../ui/primitives';

type Nav = NavigationProp<RootParams>;

/** A photo's address once it's ready (live photos are signed a moment later), or 'failed'. */
function usePhotoSource(path: string | null, bucket: PhotoBucket): MediaSource | 'failed' | null {
  const { listingPhotoUrl, buildPhotoUrl, bragPhotoUrl } = useSocial();
  const photoUrl = bucket === 'build' ? buildPhotoUrl : bucket === 'brag' ? bragPhotoUrl : listingPhotoUrl;
  const [source, setSource] = useState<{ path: string; value: MediaSource | 'failed' } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    photoUrl(path).then(
      (value) => live && setSource({ path, value }),
      () => live && setSource({ path, value: 'failed' }),
    );
    return () => {
      live = false;
    };
  }, [path, photoUrl]);
  return path && source?.path === path ? source.value : null;
}

/** Which bucket a photo lives in: swap and sell, or garage builds. */
export type PhotoBucket = 'swap' | 'build' | 'brag';

/** One photo filling its box; a steel square with an icon when there's none. Also used by the build threads. */
export function ListingPhotoBox({
  path,
  uri,
  size,
  height,
  label,
  bucket = 'swap',
  icon = 'pricetag-outline',
}: {
  path?: string | null;
  uri?: string;
  size: number;
  height?: number;
  label: string;
  bucket?: PhotoBucket;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const shown = usePhotoSource(path ?? null, bucket);
  const failed = shown === 'failed';
  const source = uri ? { uri } : failed ? null : asImage(shown, path);
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: size, height: height ?? size, borderRadius: radius.sm, backgroundColor: colors.steel, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
    >
      {source ? (
        <Image source={source} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" transition={120} />
      ) : path && !failed ? (
        <ActivityIndicator color={colors.boneMute} />
      ) : (
        <Ionicons name={icon} size={size / 3} color={colors.boneMute} />
      )}
    </View>
  );
}

/** A kind to pick: 44pt, stencil, the picked one in club red. */
function KindPick({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        minHeight: 44,
        paddingHorizontal: space.md,
        borderRadius: 4,
        justifyContent: 'center',
        backgroundColor: selected ? colors.redBright : pressed || hovered ? colors.steelHi : colors.steel,
      })}
    >
      <Text style={[type.name, { color: selected ? colors.bone : colors.boneDim }]}>{label}</Text>
    </Pressable>
  );
}

function sellerLine(l: Listing, data: ClubData): string {
  const seller = data.members.find((m) => m.id === l.sellerId);
  const chapter = seller ? data.chapters.find((c) => c.id === seller.chapterId)?.name : undefined;
  return [seller ? displayName(seller) : 'A former member', chapter].filter(Boolean).join(' · ');
}

const listedOn = (l: Listing) => formatAuDate(melbourneDate(l.listedAt));

// ---------------------------------------------------------------------------
// Members tab: the way in
// ---------------------------------------------------------------------------

export function SwapRow({ last = false }: { last?: boolean }) {
  const navigation = useNavigation<Nav>();
  return (
    <ListRow
      left={<IconBadge icon="pricetags" tone="red" />}
      title="Swap and sell"
      subtitle="Parts and gear for sale, to swap or free"
      onPress={() => navigation.navigate('SwapSell')}
      last={last}
    />
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function ListingCard({ listing, sold }: { listing: Listing; sold?: boolean }) {
  const navigation = useNavigation<Nav>();
  const { data } = useClub();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${listing.title}, ${priceLabel(listing)}${sold ? ', sold' : ''}`}
      onPress={() => navigation.navigate('Listing', { listingId: listing.id })}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: 'row',
        gap: space.md,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: pressed || hovered ? colors.steel : colors.ink2,
        opacity: sold ? 0.6 : 1,
      })}
    >
      <ListingPhotoBox path={listing.photos[0]?.path ?? null} size={88} label={listing.photos.length ? `Photo of ${listing.title}` : 'No photo'} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={type.name} numberOfLines={2}>
          {listing.title}
        </Text>
        <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
          {sold ? <Chip label="Sold" tone="bone" /> : null}
          <Chip label={priceLabel(listing)} tone={listing.kind === 'sell' ? 'red' : listing.kind === 'wanted' ? 'redOutline' : 'steel'} />
        </View>
        <Small numberOfLines={1}>{sellerLine(listing, data)}</Small>
        <Text style={[type.name, { fontSize: 13, color: colors.boneMute }]}>{listedOn(listing)}</Text>
      </View>
    </Pressable>
  );
}

export function SwapSellScreen({ navigation }: RootScreen<'SwapSell'>) {
  const { me, data, today, isDemo, refresh: refreshClub } = useClub();
  const { ready, listings, refresh } = useSocial();
  const { blocks } = useChat();
  const [kind, setKind] = useState<ListingKind | null>(null);
  const { open, sold } = listingsFor(me, data.members, listings, blocks, data.positions, today, kind);
  const filters: { value: ListingKind | null; label: string }[] = [{ value: null, label: 'All' }, ...LISTING_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))];

  return (
    <Screen onRefresh={isDemo ? undefined : () => Promise.all([refresh(), refreshClub()]).then(() => undefined)}>
      <Button label="List something" icon="add" onPress={() => navigation.navigate('EditListing', {})} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {filters.map((f) => (
          <KindPick key={f.label} label={f.label} selected={kind === f.value} onPress={() => setKind(f.value)} />
        ))}
      </View>
      {!ready ? <ActivityIndicator color={colors.redText} /> : null}
      {ready && open.length === 0 ? (
        <Card>
          <Small>{kind ? `Nothing ${kindLabel(kind).toLowerCase()} up right now.` : 'Nothing up right now. List something.'}</Small>
        </Card>
      ) : null}
      {open.map((l) => (
        <ListingCard key={l.id} listing={l} />
      ))}
      {sold.length > 0 ? (
        <>
          <SectionTitle title="Recently sold" />
          {sold.map((l) => (
            <ListingCard key={l.id} listing={l} sold />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One listing
// ---------------------------------------------------------------------------

function PhotoPager({ listing }: { listing: Listing }) {
  const { width } = useWindowDimensions();
  const w = Math.min(width, MAX_CONTENT_WIDTH) - space.lg * 2;
  const h = Math.round(w * 0.75);
  const [page, setPage] = useState(0);
  if (listing.photos.length === 0) return null;
  return (
    <View style={{ gap: space.xs }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={{ width: w, borderRadius: radius.md }}
        onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / w))}
        scrollEventThrottle={64}
      >
        {listing.photos.map((p, i) => (
          <ListingPhotoBox key={p.path} path={p.path} size={w} height={h} label={`Photo ${i + 1} of ${listing.photos.length}`} />
        ))}
      </ScrollView>
      {listing.photos.length > 1 ? (
        <Text style={[type.name, { fontSize: 13, color: colors.boneMute, textAlign: 'center' }]}>
          {`${page + 1} of ${listing.photos.length} · swipe for more`}
        </Text>
      ) : null}
    </View>
  );
}

export function ListingScreen({ route, navigation }: RootScreen<'Listing'>) {
  const { me, data } = useClub();
  const { ready, listings, markListingSold, takeDownListing } = useSocial();
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
  const l = listings.find((x) => x.id === route.params.listingId);
  const blocked = !!l && chat.blocks.some((b) => (b.blockerId === me?.id && b.blockedId === l.sellerId) || (b.blockerId === l.sellerId && b.blockedId === me?.id));
  if (!l || l.takenDownAt || !me || blocked) {
    return (
      <Screen>
        <Notice title="Not found">That listing isn’t up any more.</Notice>
      </Screen>
    );
  }
  const mine = l.sellerId === me.id;
  // One change at a time, so a quick double tap can't land out of order.
  const act = (job: () => Promise<unknown>) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    job()
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  const message = () =>
    act(() => chat.openDirect(l.sellerId).then((chatId) => navigation.navigate('Chat', { chatId })));

  return (
    <Screen>
      <PhotoPager listing={l} />
      <Card>
        <H2>{l.title}</H2>
        <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
          {l.soldAt ? <Chip label="Sold" tone="bone" /> : null}
          <Chip label={priceLabel(l)} tone={l.kind === 'sell' ? 'red' : l.kind === 'wanted' ? 'redOutline' : 'steel'} />
          {l.kind === 'sell' ? <Chip label="For sale" tone="steel" /> : null}
        </View>
        {l.details ? <Body selectable>{l.details}</Body> : null}
        <KeyValue label={l.kind === 'wanted' ? 'Wanted by' : 'Listed by'} value={sellerLine(l, data)} />
        <KeyValue label="Listed" value={listedOn(l)} />
        {l.soldAt ? <KeyValue label="Sold" value={formatAuDate(melbourneDate(l.soldAt))} /> : null}
      </Card>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {!mine ? (
        <Button
          label={l.kind === 'wanted' ? 'Message them' : 'Message the seller'}
          icon="chatbubble-outline"
          busy={busy}
          onPress={message}
        />
      ) : (
        <>
          <Button label="Edit" kind="secondary" icon="create-outline" onPress={() => navigation.navigate('EditListing', { listingId: l.id })} />
          <Button
            label={l.soldAt ? 'Put it back on' : l.kind === 'wanted' ? 'Mark as found' : 'Mark as sold'}
            kind="secondary"
            icon={l.soldAt ? 'refresh' : 'checkmark-done'}
            busy={busy}
            onPress={() => act(() => markListingSold(l.id, !l.soldAt))}
          />
        </>
      )}
      {canTakeDown(me, l, data.positions) ? (
        <ConfirmButton
          label="Take it down"
          confirmLabel="Take it down"
          icon="archive-outline"
          confirmNote="Members won’t see it any more."
          onConfirm={() =>
            takeDownListing(l.id)
              .then(() => navigation.goBack())
              .catch((e) => setError((e as Error).message))
          }
        />
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// List something, or change a listing
// ---------------------------------------------------------------------------

export function EditListingScreen({ route, navigation }: RootScreen<'EditListing'>) {
  const { ready, listings } = useSocial();
  const id = route.params?.listingId;
  // Wait for the list, so changing a listing never starts as a new one.
  if (!ready) {
    return (
      <Screen>
        <ActivityIndicator color={colors.redText} />
      </Screen>
    );
  }
  const existing = id ? listings.find((x) => x.id === id && !x.takenDownAt) : undefined;
  if (id && !existing) {
    return (
      <Screen>
        <Notice title="Not found">That listing isn’t up any more.</Notice>
      </Screen>
    );
  }
  return <ListingForm existing={existing} navigation={navigation} />;
}

/** "150" or "$1,250" as whole dollars; anything else is sent as typed so the rules can refuse it. */
function parsePrice(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function ListingForm({ existing, navigation }: { existing: Listing | undefined; navigation: RootScreen<'EditListing'>['navigation'] }) {
  const { me } = useClub();
  const { listings, saveListing } = useSocial();
  const { width } = useWindowDimensions();
  const [kind, setKind] = useState<ListingKind>(existing?.kind ?? 'sell');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [price, setPrice] = useState(existing?.priceDollars != null ? String(existing.priceDollars) : '');
  const [details, setDetails] = useState(existing?.details ?? '');
  const [kept, setKept] = useState<ListingPhoto[]>(existing?.photos ?? []);
  const [added, setAdded] = useState<PickedMedia[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const room = MAX_LISTING_PHOTOS - kept.length - added.length;
  // Inside the screen's and the card's padding, and the card's 1pt border each side.
  const tile = Math.floor((Math.min(width, MAX_CONTENT_WIDTH) - space.lg * 4 - 2 - space.sm * 2) / 3);

  const input: ListingInput = { id: existing?.id ?? null, kind, title, priceDollars: kind === 'sell' ? parsePrice(price) : null, details, photos: kept };

  const pick = (source: 'library' | 'camera') => {
    setError(null);
    pickMedia(source, room, true)
      .then((picked) =>
        setAdded((a) => {
          // The same picture picked twice goes on once.
          const fresh = picked.filter((p, i) => p.kind === 'photo' && !a.some((x) => x.uri === p.uri) && picked.findIndex((x) => x.uri === p.uri) === i);
          return [...a, ...fresh].slice(0, MAX_LISTING_PHOTOS - kept.length);
        }),
      )
      .catch((e) => setError(e instanceof PickProblem ? e.message : 'That photo couldn’t be opened. Try another.'));
  };

  const save = () => {
    setError(null);
    // The same checks the database makes, with stand-ins for the photos still on the phone.
    const standIns = added.map((p, i) => ({ path: `${me?.id ?? ''}/new-${i}`, width: p.width, height: p.height }));
    const problem = listingProblem(me, { ...input, photos: [...kept, ...standIns] }, listings);
    if (problem) return setError(problem);
    setBusy(true);
    saveListing(input, added)
      .then((id) => (existing ? navigation.goBack() : navigation.replace('Listing', { listingId: id })))
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  const removeButton = (onPress: () => void, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={{ position: 'absolute', top: 0, right: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="close" size={18} color={colors.bone} />
      </View>
    </Pressable>
  );

  return (
    <Screen>
      <Card>
        <Text style={[type.name, { color: colors.boneDim }]}>What kind of listing?</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {LISTING_KINDS.map((k) => (
            <KindPick key={k} label={kindLabel(k)} selected={kind === k} onPress={() => setKind(k)} />
          ))}
        </View>
        <Field label="Title" value={title} onChangeText={setTitle} placeholder={kind === 'wanted' ? 'Left mirror for a Bonneville' : 'Givi panniers, pair'} maxLength={80} />
        {kind === 'sell' ? (
          <Field label="Price, in dollars" value={price} onChangeText={setPrice} keyboardType="number-pad" placeholder="150" maxLength={8} />
        ) : null}
        <Field
          label="Details"
          value={details}
          onChangeText={setDetails}
          multiline
          placeholder="Condition, what it fits, where to pick it up"
          maxLength={1000}
        />
      </Card>

      <Card>
        <Text style={[type.name, { color: colors.boneDim }]}>{`Photos (up to ${MAX_LISTING_PHOTOS})`}</Text>
        {kept.length + added.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {kept.map((p, i) => (
              <View key={p.path}>
                <ListingPhotoBox path={p.path} size={tile} label={`Photo ${i + 1}`} />
                {removeButton(() => setKept((k) => k.filter((x) => x.path !== p.path)), `Remove photo ${i + 1}`)}
              </View>
            ))}
            {added.map((p, i) => (
              <View key={p.uri}>
                <ListingPhotoBox uri={p.uri} size={tile} label={`Photo ${kept.length + i + 1}`} />
                {removeButton(() => setAdded((a) => a.filter((x) => x.uri !== p.uri)), `Remove photo ${kept.length + i + 1}`)}
              </View>
            ))}
          </View>
        ) : (
          <Small>The first photo is the one on the list.</Small>
        )}
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
      <Button label={existing ? 'Save' : 'Put it up'} icon="checkmark" busy={busy} onPress={save} />
    </Screen>
  );
}
