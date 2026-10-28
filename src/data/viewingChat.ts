// Which chat is on screen right now, so a push for that chat isn't also shown as a banner.

let viewing: string | null = null;

export function viewingChat(): string | null {
  return viewing;
}

/** Call when a chat comes on screen; call what it returns when it goes. */
export function watchChat(chatId: string): () => void {
  viewing = chatId;
  return () => {
    if (viewing === chatId) viewing = null;
  };
}
