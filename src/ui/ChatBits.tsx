// The pieces of a chat: message bubbles with photos, GIFs, links and reactions, the inline actions
// under a tapped message, the composer and the GIF picker. Flat ink and steel like the rest of the
// app; the one red thing in a chat is the Send button.

import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { GIPHY_KEY } from '../data/config';
import type { Attachment, FeedItem, GifPick, LinkPreview, MediaSource } from '../data/chat/chatContext';
import { useChat } from '../data/chat/chatContext';
import { searchGifs, type GifResult } from '../data/chat/gifSearch';
import { activePositions } from '../domain/access';
import { findLinks, mediaSummary, REACTIONS, type Message, type MessageMedia } from '../domain/chat';
import { ROLE_ORDER } from '../domain/labels';
import { displayName } from '../domain/profile';
import type { ClubData, Member } from '../domain/types';
import { colors, fonts, radius, space, type } from '../theme';
import { Ionicons, RoleChip, Small, StatusChip, type IconName } from './primitives';
import { openLink } from './openLink';

/** A picture's address once it's ready (signed addresses come from the database a moment later). */
export function useMediaSource(path: string | null): MediaSource | null {
  const { mediaUrl } = useChat();
  const [source, setSource] = useState<{ path: string; value: MediaSource } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    mediaUrl(path).then(
      (value) => live && setSource({ path, value }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [path, mediaUrl]);
  return path && source?.path === path ? source.value : null;
}

/** A picture source: a web address, or one of the app's own pictures (a number on phones, an object on the web).
 *  Signed addresses change every few minutes, so the file's own path is what the image cache goes by. */
export const asImage = (s: MediaSource | null, cacheKey?: string | null) =>
  s === null ? null : typeof s === 'string' ? { uri: s, cacheKey: cacheKey ?? undefined } : s;

function seconds(ms: number | null) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** One photo, video still or GIF, filling its box. Videos carry a play mark and their length. */
export function MediaTile({
  media,
  style,
  onPress,
  label,
}: {
  media: Pick<MessageMedia, 'kind' | 'path' | 'posterPath' | 'durationMs'>;
  style: object;
  onPress?: () => void;
  label?: string;
}) {
  const shown = useMediaSource(media.kind === 'video' ? media.posterPath : media.path);
  const kindWord = media.kind === 'video' ? 'Video' : media.kind === 'gif' ? 'GIF' : 'Photo';
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'imagebutton' : 'image'}
      accessibilityLabel={label ?? kindWord}
      style={({ pressed }) => [styles.tile, style, pressed && { opacity: 0.85 }]}
    >
      {shown !== null ? (
        <Image
          source={asImage(shown, media.kind === 'video' ? media.posterPath : media.path)}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={120}
          autoplay
        />
      ) : media.kind !== 'video' ? (
        <ActivityIndicator color={colors.boneMute} />
      ) : null}
      {media.kind === 'video' ? (
        <View style={styles.play}>
          <Ionicons name="play" size={22} color={colors.bone} />
          {media.durationMs ? <Text style={styles.playTime}>{seconds(media.durationMs)}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

/** A message's photos: one at its own shape, more in a two-across grid. */
export function MediaGrid({ media, width, onOpen }: { media: MessageMedia[]; width: number; onOpen: (index: number) => void }) {
  if (media.length === 1) {
    const m = media[0];
    const ratio = m.width && m.height ? Math.min(Math.max(m.height / m.width, 0.5), 1.4) : 0.75;
    return <MediaTile media={m} style={{ width, height: Math.round(width * ratio) }} onPress={() => onOpen(0)} />;
  }
  const cell = Math.floor((width - 4) / 2);
  return (
    <View style={[styles.grid, { width }]}>
      {media.map((m, i) => (
        <MediaTile key={m.id} media={m} style={{ width: cell, height: cell }} onPress={() => onOpen(i)} />
      ))}
    </View>
  );
}

/** The card under a link. Nothing shows until (and unless) the page has something to show. */
export function LinkCard({ url }: { url: string }) {
  const { linkPreview } = useChat();
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  useEffect(() => {
    let live = true;
    linkPreview(url).then((p) => live && setPreview(p), () => undefined);
    return () => {
      live = false;
    };
  }, [url, linkPreview]);
  if (!preview) return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${preview.site}: ${preview.title ?? url}`}
      onPress={() => openLink(url).catch(() => {})}
      style={({ pressed }) => [styles.linkCard, pressed && { backgroundColor: colors.steelHi }]}
    >
      {preview.image ? <Image source={{ uri: preview.image }} style={styles.linkImage} contentFit="cover" /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={styles.linkSite} numberOfLines={1}>{preview.site}</Text>
        {preview.title ? <Text style={type.bodyStrong} numberOfLines={2}>{preview.title}</Text> : null}
        {preview.description ? <Small numberOfLines={2}>{preview.description}</Small> : null}
      </View>
    </Pressable>
  );
}

/** Words with their links tappable. */
export function MessageText({ body }: { body: string }) {
  return (
    <Text style={styles.body} selectable>
      {findLinks(body).map((part, i) =>
        part.url ? (
          <Text key={i} style={styles.link} accessibilityRole="link" onPress={() => openLink(part.url!).catch(() => {})}>
            {part.text}
          </Text>
        ) : (
          <Text key={i}>{part.text}</Text>
        ),
      )}
    </Text>
  );
}

/** A name with the rank and top position beside it, as the club reads them. */
export function AuthorLine({ member, data }: { member: Member | undefined; data: ClubData }) {
  if (!member) return <Text style={styles.author}>Former member</Text>;
  const top = activePositions(member.id, data.positions).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))[0];
  return (
    <View style={styles.authorRow}>
      <Text style={styles.author} numberOfLines={1}>{displayName(member)}</Text>
      <StatusChip status={member.status} />
      {top ? <RoleChip role={top.role} /> : null}
    </View>
  );
}

/** Reactions under a message, one pill per emoji with how many. Yours is outlined in bone. */
export function ReactionPills({ message, meId, onToggle }: { message: Message; meId: string; onToggle: (emoji: string) => void }) {
  const counts = REACTIONS.map((e) => ({
    emoji: e,
    n: message.reactions.filter((r) => r.emoji === e).length,
    mine: message.reactions.some((r) => r.emoji === e && r.memberId === meId),
  })).filter((r) => r.n > 0);
  if (!counts.length) return null;
  return (
    <View style={styles.pills}>
      {counts.map((r) => (
        <Pressable
          key={r.emoji}
          onPress={() => onToggle(r.emoji)}
          accessibilityRole="button"
          accessibilityLabel={`${r.emoji} ${r.n}${r.mine ? ', yours' : ''}`}
          accessibilityState={{ selected: r.mine }}
          style={[styles.pill, r.mine && styles.pillMine]}
        >
          <Text style={styles.pillEmoji}>{r.emoji}</Text>
          <Text style={styles.pillCount}>{r.n}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The quoted message a reply answers. */
export function ReplyQuote({ message, author }: { message: Message | undefined; author: string }) {
  const words = !message
    ? 'An earlier message'
    : message.removedAt
      ? 'Message removed'
      : message.body || mediaSummary(message.media.length, message.media.some((m) => m.kind === 'voice'));
  return (
    <View style={styles.quote}>
      <Text style={styles.quoteName} numberOfLines={1}>{author}</Text>
      <Small numberOfLines={2}>{words}</Small>
    </View>
  );
}

/** The six reactions, big enough for a gloved thumb. */
export function ReactionBar({ onPick, mine }: { onPick: (emoji: string) => void; mine: string[] }) {
  return (
    <View style={styles.reactionBar}>
      {REACTIONS.map((e) => (
        <Pressable
          key={e}
          onPress={() => onPick(e)}
          accessibilityRole="button"
          accessibilityLabel={`React ${e}`}
          accessibilityState={{ selected: mine.includes(e) }}
          style={({ pressed }) => [styles.reactionBtn, mine.includes(e) && styles.pillMine, pressed && { backgroundColor: colors.steelHi }]}
        >
          <Text style={styles.reactionEmoji}>{e}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A small text-and-icon action under a tapped message. */
export function ActionChip({ label, icon, onPress, tone = 'bone' }: { label: string; icon: IconName; onPress: () => void; tone?: 'bone' | 'danger' }) {
  const fg = tone === 'danger' ? colors.danger : colors.boneDim;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.action, tone === 'danger' && { borderColor: colors.danger }, pressed && { backgroundColor: colors.steelHi }]}
    >
      <Ionicons name={icon} size={16} color={fg} />
      <Text style={[styles.actionText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/** Square icon button for the composer and headers: 44 across. */
export function IconButton({ icon, label, onPress, disabled, active }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      style={({ pressed }) => [styles.iconBtn, active && { backgroundColor: colors.steelHi }, pressed && { backgroundColor: colors.steel }, disabled && { opacity: 0.45 }]}
    >
      <Ionicons name={icon} size={22} color={active ? colors.bone : colors.boneDim} />
    </Pressable>
  );
}

/** What's going in with the next message: a strip of thumbnails, each with a remove button. */
export function AttachmentStrip({ items, onRemove }: { items: Attachment[]; onRemove: (index: number) => void }) {
  if (!items.length) return null;
  return (
    <View style={styles.strip}>
      {items.map((a, i) => (
        <View key={i} style={styles.stripItem}>
          <Image source={{ uri: a.kind === 'gif' ? a.url : a.uri }} style={StyleSheet.absoluteFill} contentFit="cover" autoplay={false} />
          {/* A centred play mark on a dark disc, so it shows on any thumbnail (or on none, before the phone makes one). */}
          {a.kind === 'video' ? (
            <View style={styles.stripPlay} pointerEvents="none">
              <Ionicons name="play" size={16} color={colors.bone} accessibilityLabel="Video" />
            </View>
          ) : null}
          {a.kind === 'gif' ? <Text style={[styles.stripMark, styles.gifMark]}>GIF</Text> : null}
          <Pressable onPress={() => onRemove(i)} accessibilityRole="button" accessibilityLabel="Take it out" style={styles.stripRemove} hitSlop={8}>
            <Ionicons name="close" size={14} color={colors.bone} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

/** GIF search: trending first, then whatever you type. Tap one to add it. */
export function GifPicker({ onPick }: { onPick: (gif: GifPick) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GifResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!GIPHY_KEY) return;
    let live = true;
    const timer = setTimeout(() => {
      setBusy(true);
      searchGifs(GIPHY_KEY, query)
        .then((r) => live && (setResults(r), setError(null)))
        .catch((e: Error) => live && setError(e.message))
        .finally(() => live && setBusy(false));
    }, query ? 400 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  if (!GIPHY_KEY) {
    return (
      <View style={styles.gifPanel}>
        <Small style={{ textAlign: 'center' }}>GIFs aren’t switched on yet. The club needs a GIPHY key first.</Small>
      </View>
    );
  }
  return (
    <View style={styles.gifPanel}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search GIFs"
        placeholderTextColor={colors.boneMute}
        style={styles.gifSearch}
        accessibilityLabel="Search GIFs"
        returnKeyType="search"
      />
      {error ? <Small style={{ color: colors.danger }}>{error}</Small> : null}
      <FlatList
        data={results}
        horizontal
        keyExtractor={(g) => g.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: space.xs }}
        ListEmptyComponent={busy ? <ActivityIndicator color={colors.boneMute} /> : <Small>No GIFs for that.</Small>}
        renderItem={({ item }) => {
          const h = 110;
          const w = Math.max(70, Math.min(200, Math.round((item.preview.width / Math.max(item.preview.height, 1)) * h)));
          return (
            <Pressable onPress={() => onPick(item.send)} accessibilityRole="imagebutton" accessibilityLabel={item.title || 'GIF'}>
              <Image source={{ uri: item.preview.url }} style={{ width: w, height: h, borderRadius: radius.sm, backgroundColor: colors.steel }} contentFit="cover" />
            </Pressable>
          );
        }}
      />
      <Text style={styles.giphy}>Powered by GIPHY</Text>
    </View>
  );
}

/** Media for the viewer screen, from a message. */
export function feedItemsOf(message: Message): FeedItem[] {
  return message.media
    .filter((m) => m.kind === 'photo' || m.kind === 'video')
    .map((m) => ({ ...m, conversationId: message.conversationId, authorId: message.authorId, createdAt: message.createdAt }));
}

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.steel, borderRadius: radius.sm, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  play: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.pill, backgroundColor: 'rgba(17,16,16,0.72)',
  },
  playTime: { fontFamily: fonts.stencil, fontSize: 13, color: colors.bone },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  linkCard: {
    flexDirection: 'row', gap: space.sm, padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.steel,
    borderWidth: 1, borderColor: colors.line, alignItems: 'center',
  },
  linkImage: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.steelHi },
  linkSite: { fontFamily: fonts.stencil, fontSize: 12, letterSpacing: 0.4, color: colors.boneMute, textTransform: 'uppercase' },
  body: { ...type.body, color: colors.bone },
  link: { color: colors.bone, textDecorationLine: 'underline' },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  author: { ...type.name, flexShrink: 1 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: 10, borderRadius: radius.pill,
    backgroundColor: colors.steel, borderWidth: 1, borderColor: colors.steel,
  },
  pillMine: { borderColor: colors.bone, backgroundColor: colors.steelHi },
  pillEmoji: { fontSize: 15 },
  pillCount: { fontFamily: fonts.stencil, fontSize: 14, color: colors.bone },
  quote: { borderLeftWidth: 1, borderLeftColor: colors.lineStrong, paddingLeft: space.sm, gap: 2 },
  quoteName: { fontFamily: fonts.stencil, fontSize: 13, color: colors.boneDim },
  reactionBar: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  reactionBtn: {
    width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.steel, borderWidth: 1, borderColor: colors.steel,
  },
  reactionEmoji: { fontSize: 22 },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: space.md,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineStrong,
  },
  actionText: { fontFamily: fonts.stencil, fontSize: 14, letterSpacing: 0.4, textTransform: 'uppercase' },
  iconBtn: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm },
  stripItem: { width: 64, height: 64, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.steel },
  stripMark: { position: 'absolute', left: 4, bottom: 4 },
  stripPlay: {
    position: 'absolute', left: 18, top: 18, width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', paddingLeft: 2, backgroundColor: 'rgba(17,16,16,0.72)',
  },
  gifMark: { fontFamily: fonts.stencil, fontSize: 11, color: colors.bone, backgroundColor: 'rgba(17,16,16,0.72)', paddingHorizontal: 4, borderRadius: 2 },
  stripRemove: {
    position: 'absolute', top: 2, right: 2, width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(17,16,16,0.8)', alignItems: 'center', justifyContent: 'center',
  },
  gifPanel: { gap: space.sm, padding: space.md, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.ink2 },
  gifSearch: {
    ...type.body, color: colors.bone, minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.sm,
    backgroundColor: colors.steel, borderWidth: 1, borderColor: colors.line,
  },
  giphy: { ...type.small, fontSize: 11, textAlign: 'right' },
});
