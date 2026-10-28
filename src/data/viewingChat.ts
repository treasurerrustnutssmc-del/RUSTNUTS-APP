// Which chat is on screen right now, so a push for that chat isn't also shown as a banner.

import { AppState } from 'react-native';

let viewing: string | null = null;

/** Only while the app is in front: a chat left open behind a locked screen isn't being looked at. */
export function viewingChat(): string | null {
  return AppState.currentState === 'active' ? viewing : null;
}

/** Call when a chat comes on screen; call what it returns when it goes. */
export function watchChat(chatId: string): () => void {
  viewing = chatId;
  return () => {
    if (viewing === chatId) viewing = null;
  };
}
