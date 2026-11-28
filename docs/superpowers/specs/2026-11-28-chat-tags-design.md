# Chat tags that ring the phone (28 Nov 2026)

Jeff, 28 Nov 2026: "Can we make a tagging system that rings the phone of the person tagged. Like
@everyone, or @tinman". Then: "Any member can use @everyone and individual tags as well".
Bounded work. Claude approved this design (standing rule since 24 Oct); Jeff can veto.

## What a member sees
- Typing `@` in any chat's message box opens a pick list above it: `@everyone`, then the road names of
  people who can read that chat, narrowing as they type (`@ti` shows Tinman). Tapping one puts
  `@Tinman ` in the message. Typing the name in full works the same.
- In messages, tags show in bold rust; a tag of you is highlighted.
- A tagged member gets a notification of its own, not folded into the chat's stacked notification:
  "Wes tagged you · Whole club" (or "tagged everyone"), with the line as the body.
  - Android: its own "Tags" channel at the highest importance (pops over the screen, long double
    buzz, the phone's own sound so it's distinct from the bike rev).
  - iPhone: time-sensitive (breaks through Focus and the summary; the build already holds the
    entitlement), phone's own sound.
- Me > Notifications gets a "Tags" switch, on by default. Tags still come with chat notifications off.

## Rules
- A tag is `@` (at the start or after a space or punctuation) then a member's name as the app shows
  it (road name, else first name), any case, not followed by a letter, digit or `_`. `@everyone` tags
  everyone who can read the chat. Same rule in `src/domain/chatTags.ts` and `private.tags_name`.
- Any member who can post can tag anyone, including @everyone (Jeff). Only people who can read the chat
  are told, never the sender, never anyone blocked either way, never anyone with Tags off.
- A tagged member gets the tag notification in place of the ordinary one for that message (same outbox
  row, data.kind `tag`); the next ordinary chat push still lists it in the stack.
- Only new messages tag; editing a message doesn't re-notify.

## Shipping
- SQL `supabase/migrations/20271020000000_chat_tags.sql` (column, 7-setting save, push_chat_message).
- send-push redeploy (Tags channel, time-sensitive, not stacked). Without it a tag still arrives,
  on the club channel.
- OTA for the app (pick list, highlight, Tags channel set up in JS, switch). No native build.
- Order: SQL, send-push, OTA.
