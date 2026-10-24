// The club's chats: the live database in a live build, made-up chats in the demo. Sits inside
// ClubProvider, since chats need to know who's signed in and who's who.

import React from 'react';
import { useClub } from '../clubContext';
import { USE_LIVE_DATA } from '../config';
import { DemoChatProvider } from './DemoChatProvider';
import { LiveChatProvider } from './LiveChatProvider';

export function ChatProvider({ children }: { children: React.ReactNode }) {
  return USE_LIVE_DATA ? <LiveChats>{children}</LiveChats> : <DemoChatProvider>{children}</DemoChatProvider>;
}

// A fresh set of chats for each person who signs in, so nothing of the last person's lingers.
function LiveChats({ children }: { children: React.ReactNode }) {
  const { me } = useClub();
  return <LiveChatProvider key={me?.id ?? 'nobody'}>{children}</LiveChatProvider>;
}

export { useChat } from './chatContext';
