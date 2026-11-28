// What every chat screen can ask of the chats, whichever source is behind them: the demo's
// made-up chats in memory, or the live database with photos in Supabase Storage.

import { createContext, useContext } from 'react';
import type { Block, Conversation, Message, MessageMedia, PickedMedia } from '../../domain/chat';
import type { Album, GalleryItem } from '../../domain/gallery';
import type { SeenRead } from '../../domain/chatSeen';
import type { Ride } from '../../domain/types';

export interface ChatSummary {
  conversation: Conversation;
  title: string;
  ride: Ride | null;
  /** The newest message (removed ones included, so the list can say so). */
  last: {
    id: string; authorId: string; body: string | null; createdAt: string; removed: boolean; mediaCount: number;
    /** It's a voice note (and still there). */
    voice: boolean;
  } | null;
  unread: number;
  /** A chat with topics, once the list folds them in (foldTopics): how many are open and closed. */
  topics?: { open: number; closed: number };
  /** The topic the newest line (last) is from, when it's from one. */
  lastTopic?: string | null;
}

/** A photo or video in a feed, with who posted it and when. */
export interface FeedItem extends MessageMedia {
  /** The chat it was posted in; null for one added straight to the gallery. */
  conversationId: string | null;
  authorId: string;
  createdAt: string;
  /** Added straight to the gallery (src/domain/gallery.ts): its album and caption. */
  gallery?: { rideId: string | null; caption: string | null } | null;
}

/** What Add to the gallery sends. */
export interface GalleryAdd {
  rideId: string | null;
  caption: string;
  websiteOk: boolean;
  consent: boolean;
  files: PickedMedia[];
}

export interface RideWall {
  ride: Ride;
  /** The ride's chat; null when it has only gallery photos and no chat yet. */
  chatId: string | null;
  count: number;
  cover: FeedItem | null;
}

/** A GIF picked from the search. */
export interface GifPick {
  kind: 'gif';
  url: string;
  width: number;
  height: number;
}

/** A voice note just recorded on the phone (or in the browser), before it's uploaded. */
export interface VoiceRecording {
  kind: 'voice';
  uri: string;
  /** From the recorder, not the file: Chrome's recordings carry no length. */
  durationMs: number;
  /** The recording's own type on the web; phones record AAC in an .m4a file. */
  mimeType: string | null;
}

export type Attachment = PickedMedia | GifPick | VoiceRecording;

export interface ReportView {
  id: string;
  reason: string | null;
  createdAt: string;
  reporterId: string;
  message: {
    id: string; conversationId: string; authorId: string; body: string | null; mediaCount: number; createdAt: string;
    /** A reported voice note's recording, so a moderator can listen to it. */
    voice: { path: string; durationMs: number | null } | null;
  };
  conversation: Conversation;
}

/** The card under a link: from the page's Open Graph tags. */
export interface LinkPreview {
  url: string;
  site: string;
  title: string | null;
  description: string | null;
  image: string | null;
}

/** Something an image or video component can show: a web address, or a bundled demo picture. */
export type MediaSource = string | number;

export interface ChatContextValue {
  /** False until the first list arrives. */
  ready: boolean;
  list: ChatSummary[];
  unreadTotal: number;
  /** The members I've blocked. */
  blocks: Block[];
  /** Messages I've reported that the board hasn't dealt with yet: hidden from me (member content rules). */
  reportedMessageIds: string[];
  conversation: (chatId: string) => Conversation | undefined;
  /** What's loaded of a chat, oldest first, without anyone I've blocked or anything I've reported. */
  messages: (chatId: string) => Message[];
  hasOlder: (chatId: string) => boolean;
  /** True once a chat's newest page has arrived since it was last opened. */
  pageLoaded: (chatId: string) => boolean;
  /** Seen by (src/domain/chatSeen.ts): everyone else who reads the chat and when they last saw it.
   *  Undefined until it's loaded, or while the club's database can't say yet. Kept fresh while the chat is open. */
  seenReads: (chatId: string) => SeenRead[] | undefined;
  /** Fetches Seen by for a chat afresh. */
  loadSeen: (chatId: string) => Promise<void>;
  /** Loads the newest page, marks the chat read and keeps it fresh until the returned close runs. */
  open: (chatId: string) => () => void;
  loadOlder: (chatId: string) => Promise<void>;
  send: (chatId: string, body: string, attachments: Attachment[], replyToId: string | null) => Promise<void>;
  remove: (messageId: string) => Promise<void>;
  react: (messageId: string, emoji: string) => Promise<void>;
  pin: (chatId: string, messageId: string | null) => Promise<void>;
  report: (messageId: string, reason: string) => Promise<void>;
  setBlock: (memberId: string, blocked: boolean) => Promise<void>;
  openDirect: (memberId: string) => Promise<string>;
  /** Groups (board members and the NEC run them): starts one and gives its id. */
  createGroup: (name: string, memberIds: string[]) => Promise<string>;
  addToGroup: (chatId: string, memberIds: string[]) => Promise<void>;
  renameGroup: (chatId: string, name: string) => Promise<void>;
  removeFromGroup: (chatId: string, memberId: string) => Promise<void>;
  leaveGroup: (chatId: string) => Promise<void>;
  /** Topics inside board, committee and group chats (2026-11-24-chat-topics-design.md): starts one and gives its id. */
  startTopic: (chatId: string, name: string) => Promise<string>;
  renameTopic: (chatId: string, name: string) => Promise<void>;
  closeTopic: (chatId: string) => Promise<void>;
  reopenTopic: (chatId: string) => Promise<void>;
  rideChat: (rideId: string) => Promise<string>;
  reports: () => Promise<ReportView[]>;
  resolveReport: (reportId: string, remove: boolean) => Promise<void>;
  photos: (before?: string) => Promise<FeedItem[]>;
  rideWalls: () => Promise<RideWall[]>;
  rideWall: (rideId: string) => Promise<{ ride: Ride; chatId: string | null; media: FeedItem[] }>;
  /** The gallery: adds photos and videos straight to Photos; gives how many went in. */
  addToGallery: (add: GalleryAdd) => Promise<number>;
  removeGalleryItem: (id: string) => Promise<void>;
  /** What members ticked "OK for the website", waiting for the website crew. Empty for anyone else. */
  galleryForSite: () => Promise<GalleryItem[]>;
  /** Rides from the last 30 days the Add form can file under (the app's own ride list starts today). */
  galleryAlbums: () => Promise<Album[]>;
  approveGalleryForSite: (id: string, caption: string) => Promise<void>;
  declineGalleryForSite: (id: string) => Promise<void>;
  mediaUrl: (path: string) => Promise<MediaSource>;
  /** The card for a link, or null when the page has nothing to show (or can't be reached). */
  linkPreview: (url: string) => Promise<LinkPreview | null>;
  refresh: () => Promise<void>;
}

export const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error('useChat needs a ChatProvider above it.');
  return value;
}
