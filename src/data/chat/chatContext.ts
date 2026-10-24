// What every chat screen can ask of the chats, whichever source is behind them: the demo's
// made-up chats in memory, or the live database with photos in Supabase Storage.

import { createContext, useContext } from 'react';
import type { Block, Conversation, Message, MessageMedia, PickedMedia } from '../../domain/chat';
import type { Ride } from '../../domain/types';

export interface ChatSummary {
  conversation: Conversation;
  title: string;
  ride: Ride | null;
  /** The newest message (removed ones included, so the list can say so). */
  last: { id: string; authorId: string; body: string | null; createdAt: string; removed: boolean; mediaCount: number } | null;
  unread: number;
}

/** A photo or video in a feed, with who posted it and when. */
export interface FeedItem extends MessageMedia {
  conversationId: string;
  authorId: string;
  createdAt: string;
}

export interface RideWall {
  ride: Ride;
  chatId: string;
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

export type Attachment = PickedMedia | GifPick;

export interface ReportView {
  id: string;
  reason: string | null;
  createdAt: string;
  reporterId: string;
  message: { id: string; conversationId: string; authorId: string; body: string | null; mediaCount: number; createdAt: string };
  conversation: Conversation;
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
  conversation: (chatId: string) => Conversation | undefined;
  /** What's loaded of a chat, oldest first, without anyone I've blocked. */
  messages: (chatId: string) => Message[];
  hasOlder: (chatId: string) => boolean;
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
  rideChat: (rideId: string) => Promise<string>;
  reports: () => Promise<ReportView[]>;
  resolveReport: (reportId: string, remove: boolean) => Promise<void>;
  photos: (before?: string) => Promise<FeedItem[]>;
  rideWalls: () => Promise<RideWall[]>;
  rideWall: (rideId: string) => Promise<{ ride: Ride; chatId: string; media: FeedItem[] }>;
  mediaUrl: (path: string) => Promise<MediaSource>;
  refresh: () => Promise<void>;
}

export const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error('useChat needs a ChatProvider above it.');
  return value;
}
