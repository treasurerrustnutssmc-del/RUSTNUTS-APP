# Chat, photos and ride walls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Whole-club, chapter, ride and private chats with photos, videos and reactions, plus ride walls and a Photos screen, in the demo and live builds.

**Architecture:** Pure rules in `src/domain/chat.ts` decide who reads, posts and removes, mirrored by row-level security and SECURITY DEFINER actions in one migration. Chat has its own provider (`src/data/chat/`), demo and live, separate from `ClubData`. Files live in a private Storage bucket; the live app hears changes through Supabase Realtime on `messages`.

**Tech Stack:** Expo SDK 58, React Navigation 7, Supabase (Postgres 17, Storage, Realtime), expo-image-picker, expo-image-manipulator, expo-image, expo-video, expo-file-system.

**Spec:** `docs/superpowers/specs/2026-10-24-chat-and-photos-design.md`

## Global Constraints
- Lane B: migration files start `20261101`; shared files (`types.ts`, `labels.ts`, `liveData.ts`, `demoData.ts`, `database.types.ts`, `RootNavigator.tsx`, `parity.json`, `PRODUCT.md`, `DESIGN.md`) get one appended block each, nothing else moved.
- No `drop` anywhere in the migration. No `Alert`; destructive = `ConfirmButton`.
- Refusal words are identical in demo and database (parity cases check this).
- Dates DD/MM/YYYY, times Melbourne. Rustnuts Stencil for names, titles, buttons, chips, counts, dates.
- Limits: body ≤ 4,000 characters; ≤ 10 media per message; video ≤ 60 s and ≤ 50 MB; photos resized to 2048 px long edge, JPEG 0.8.
- Reactions: 👍 ❤️ 😂 🔥 🍺 😮.
- Ride chat in the list from 7 days before start to 3 days after the last day, for Going/Maybe.
- Add packages only with `npx expo install`.

## Review Focus
1. Sending a message: the app's own copy and the realtime echo must not show twice (dedupe by id).
2. A signed photo link expires after an hour with the chat still open: the image must reload, not stay broken.
3. Upload works but `send_message` fails (or the reverse on a flaky servo signal): the composer keeps the text and picked media for a retry.
4. A message removed by a moderator while someone has it open: the bubble turns into "Message removed" and its photo stops loading.
5. Someone with no Going/Maybe opens a ride chat from the ride screen: it works, even though it isn't in their list.

---

### Task 1: Chat rules

**Files:**
- Create: `src/domain/chat.ts`, `src/domain/chat.test.ts`

**Interfaces:**
- Produces (types): `ChatKind = 'club'|'chapter'|'ride'|'direct'`; `Conversation {id, kind, chapterId: string|null, rideId: string|null, memberIds: string[]}`; `MediaKind = 'photo'|'video'`; `MessageMedia {id, messageId, kind, path, posterPath: string|null, width, height, durationMs: number|null, position}`; `Reaction {messageId, memberId, emoji}`; `Message {id, conversationId, authorId, body: string|null, createdAt, removedAt: string|null, media: MessageMedia[], reactions: Reaction[]}`; `PickedMedia {uri, kind, width, height, durationMs: number|null, fileSize: number|null, mimeType: string|null}`.
- Produces (rules): `REACTIONS`, `MAX_BODY = 4000`, `MAX_MEDIA = 10`, `MAX_VIDEO_MS = 60_000`, `MAX_FILE_BYTES = 50 * 1024 * 1024`;
  `readProblem(me, conv, data: ClubData): string|null`; `postProblem(me, conv, body, mediaCount, data)`; `removeProblem(me, conv, message, data)`; `reactProblem(me, conv, message, emoji, data)`; `directProblem(me, target: Member|undefined)`; `canModerate(me, conv, data): boolean`; `mediaProblem(p: PickedMedia)`; `rideChatListed(ride: Ride, answer: RsvpAnswer|null, today: string): boolean`; `dayLabel(iso, today)`; `groupMessages(messages, today): {day: string, runs: {authorId, messages: Message[]}[]}[]` (oldest first; a run breaks after 5 minutes); `findLinks(text): {text, url: string|null}[]`; `chatTitle(conv, me, data, ride?)`.

Words (exact): `Sign in first.` · `Only approved members can do that.` · `No such chat.` · `That chat is for {Name} chapter members.` · `That’s a private chat.` · `Write something or add a photo.` · `Keep it under 4,000 characters.` · `Up to 10 photos or videos at a time.` · `No such message.` · `That message was removed.` · `You can only remove your own messages.` · `Pick one of the reactions.` · `You can’t message yourself.` · `They’re not an approved member.` · `That member no longer exists.` · `Videos can be up to 60 seconds.` · `That file is over 50 MB.` · `Only photos and videos can go in.`

- [ ] **Step 1: Write failing tests** covering: club readable by any approved status incl. Legacy, refused for pending (`Only approved members can do that.`) and null (`Sign in first.`); chapter chat readable by own chapter and by an NEC member of the other chapter, refused for the other chapter's plain member with `That chat is for North chapter members.`; direct only for its two members (`That’s a private chat.`); post refusals for empty/whitespace body with no media, 4,001 chars, 11 media; remove: own always (unless removed), chapter board in own chapter, other chapter's board refused, any board in club and ride chats, nobody else's in direct; react with `🙂` refused; `rideChatListed` true at start − 7 days and lastDay + 3, false at + 4 and for `no`/null; `groupMessages` splits Melbourne days (an 11:30 pm UTC message is the next Melbourne day) and runs at 5 minutes; `dayLabel` gives `Today`, `Yesterday`, `07/11/2026`; `findLinks('see https://x.au/a, ok')` yields the url without the trailing comma; `mediaProblem` for 60,001 ms video, 50 MB + 1 byte, `application/pdf`.
- [ ] **Step 2:** `npm test` → the new tests fail (module missing).
- [ ] **Step 3:** Implement in `src/domain/chat.ts` using `isBoardOf`/`isNational`/`activePositions` from `access.ts` and `melbourneDate`/`lastDay` from `rides.ts`. "Any board" = `accessLevel` is `board` or `national`.
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5:** Commit `Chat rules`.

### Task 2: Database

**Files:**
- Create: `supabase/migrations/20261101000000_chat.sql`, `supabase/tests/chat_test.sql`
- Modify: `supabase/tests/supabase_stub.sql` (append: `storage` schema with `buckets(id, name, public, file_size_limit, allowed_mime_types)`, `objects(id uuid default gen_random_uuid(), bucket_id, name, owner uuid, created_at, metadata jsonb)` with RLS on, `storage.foldername(text) returns text[]` as `string_to_array(name, '/')` minus the last part, and `create publication supabase_realtime` if missing), `scripts/test-db.sh` (append a `rustnuts_chat` block like the rides one).

**Interfaces:**
- Produces (SQL): enum `chat_kind`; tables in the spec; `private.can_read_chat(uuid) boolean`, `private.chat_problem(uuid) text` (null or the refusal, same words as Task 1), `private.is_any_board() boolean`;
  `public.send_message(p_chat uuid, p_body text, p_media jsonb) returns uuid` (media items `{path, kind, posterPath, width, height, durationMs}`; each `path` must start `<p_chat>/`, exist in `storage.objects` in `chat-media`, be owned by the caller and be unused);
  `public.remove_message(p_message uuid)`, `public.toggle_reaction(p_message uuid, p_emoji text)`, `public.open_direct_chat(p_member uuid) returns uuid`, `public.ride_chat(p_ride uuid) returns uuid`, `public.mark_chat_read(p_chat uuid)`;
  `public.chat_list() returns jsonb` → `[{id, kind, chapter_id, ride_id, member_ids, ride: {id,title,starts_at,ends_at,all_day,category,cancelled_at}|null, last: {id, author_id, body, has_media, removed, created_at}|null, unread}]`;
  `public.club_photos(p_before timestamptz, p_limit int) returns jsonb` → `[{media..., message_id, conversation_id, author_id, created_at}]` newest first, never `direct`, never removed;
  `public.ride_walls() returns jsonb` → `[{ride: {...}, chat_id, count, cover: {path, poster_path, kind}}]` newest ride first; `public.ride_wall(p_ride uuid) returns jsonb` → `{ride, chat_id, media: [...]}`.
  Bucket `chat-media` (private, 52428800, `image/jpeg,image/png,image/webp,video/mp4,video/quicktime`) with insert/select/delete-own policies on `storage.objects`.

- [ ] **Step 1: Write `chat_test.sql`** in the style of `rides_test.sql` (fixture users: West Full, West board (secretary), North Full, North president (NEC), Legacy, pending, stranger; one ride). Assert: counts of readable conversations per person; no direct insert/update/delete on any chat table as `authenticated`; every action's refusals with the Task 1 words; `send_message` refuses a path in another chat's folder, someone else's object and a reused path; a new chapter gets a chat; `chat_list()` hides a ride chat outside the window and when the answer is `no`; unread counts drop to 0 after `mark_chat_read`; `club_photos()` skips direct and removed; storage select policy refuses a removed message's file and another chapter's file.
- [ ] **Step 2:** `npm run test:db` → fails (no chat tables).
- [ ] **Step 3:** Write the migration. Chapter chats via an `after insert` trigger on `public.chapters` plus a backfill; the club chat inserted once. `updated_at` bumped by `toggle_reaction` and `remove_message`. `alter publication supabase_realtime add table public.messages`. Every function `security definer set search_path = ''`, revoke from public/anon, grant to authenticated.
- [ ] **Step 4:** `npm run test:db` → `ALL DATABASE CHECKS PASSED`.
- [ ] **Step 5:** Commit `Chat database`.

### Task 3: Shared demo/database cases

**Files:**
- Create: `src/data/chat/demoChatActions.ts`, `src/data/chat/demoChatActions.test.ts`
- Modify: `src/data/parityFixture.testkit.ts` (append: `chats?`/`messages?` fixture types and `fixtureChat()`; route actions starting `chat` to `runChatAction`), `scripts/parity-sql.mts` (append inserts and `case` lines), `supabase/tests/parity.json` (append fixture `messages` and cases).

**Interfaces:**
- Consumes: Task 1 rules.
- Produces: `ChatData {conversations: Conversation[], messages: Message[], reads: {conversationId, memberId, readAt}[]}`; `ChatCtx {chat: ChatData, club: ClubData, me: Member|null, now: string}`; `sendMessage(ctx, chatId, body, media: Omit<MessageMedia,'id'|'messageId'>[]) → {chat, id}`; `removeMessage(ctx, id)`; `toggleReaction(ctx, id, emoji)`; `openDirect(ctx, memberId) → {chat, id}`; `rideChat(ctx, rideId) → {chat, id}`; `markRead(ctx, chatId)`; `runChatAction(ctx, action)` for actions `chatSend {chat, body, mediaCount}`, `chatRemove {message}`, `chatReact {message, emoji}`, `chatDirect {member}`.
  Fixture chat descriptors: `club`, `chapter:west`, `chapter:north`, `ride:<key>`, `direct:<a>:<b>`; SQL resolves them by subquery.

- [ ] **Step 1:** Write ≥ 14 cases in `parity.json` (each refusal word at least once, and the allowed paths), plus unit tests for the demo actions' state changes (removal blanks body and media, reaction toggles, `openDirect` reuses).
- [ ] **Step 2:** `npm test` → fail. **Step 3:** implement. **Step 4:** `npm test` and `npm run test:db` → pass, parity line counts the new cases.
- [ ] **Step 5:** Commit `Chat: shared demo and database cases`.

### Task 4: Chat data layer

**Files:**
- Create: `src/data/chat/chatContext.ts`, `DemoChatProvider.tsx`, `demoChatData.ts`, `LiveChatProvider.tsx`, `liveChat.ts`, `liveChat.test.ts`, `media.ts`, `ChatProvider.tsx`
- Modify: `App.tsx` (wrap the navigator in `ChatProvider` inside `ClubProvider`), `src/data/database.types.ts` (append the chat tables and functions), `package.json`/`app.json` via `npx expo install expo-image-picker expo-image-manipulator expo-image expo-video expo-file-system` and the picker plugin with Rustnuts wording ("Rustnuts uses your photos so you can share them in club chats.", camera likewise, microphone "…to record videos for club chats.").

**Interfaces:**
- Produces `useChat(): ChatContextValue` with: `ready`, `list: ChatSummary[]` (`{conversation, title, ride: Ride|null, last: Message|null, unread}` sorted club, own chapter(s), ride chats by start, then directs by last message), `unreadTotal`, `messages(chatId): Message[]`, `hasOlder(chatId)`, `open(chatId)` (loads newest 40, marks read, returns a close fn), `loadOlder(chatId)`, `send(chatId, body, picked: PickedMedia[])`, `remove(messageId)`, `react(messageId, emoji)`, `openDirect(memberId) → Promise<string>`, `rideChat(rideId) → Promise<string>`, `photos(before?) → Promise<FeedItem[]>`, `rideWalls() → Promise<RideWall[]>`, `rideWall(rideId) → Promise<{ride, chatId, media: FeedItem[]}>`, `mediaUrl(path) → Promise<string>`, `refresh()`.
  `FeedItem = MessageMedia & {authorId, createdAt, conversationId}`; `RideWall = {ride: Ride, chatId, count, cover: FeedItem|null}`.
- `media.ts`: `pickMedia(source: 'library'|'camera') → Promise<PickedMedia[]>`; `prepareUpload(p) → Promise<{bytes: ArrayBuffer, contentType, ext, poster?: {bytes, contentType}}>` (photos resized/JPEG; video still via `expo-video` thumbnail on native, none on web).
- Live: uploads to `chat-media/<chat>/<uuid>.<ext>` then `send_message`; on failure keeps nothing sent and rethrows a friendly error (size/space errors say so). One Realtime channel on `messages` (`postgres_changes` `*`), debounced 300 ms refetch of `chat_list()` and of any open chat's newest page, merged by id. Signed URLs via `createSignedUrls`, cached 55 minutes.
- `liveChat.ts` row mappers are pure and tested (`toMessage`, `toSummary`, `toFeedItem`, merge-by-id keeping order).

- [ ] **Step 1:** Failing tests for the mappers and `mergeMessages` (dedupes the send echo; an update replaces in place). **Step 2:** fail. **Step 3:** implement the provider pair, demo data (whole-club, both chapter chats with a few made-up lines from demo members, one private chat, one ride chat with the Rusty Bus photo from `assets/`), and media helpers. **Step 4:** `npm test`, `npm run typecheck`, `npx expo lint` → pass.
- [ ] **Step 5:** Commit `Chat data: demo and live providers`.

### Task 5: Chat screens and tab

**Files:**
- Create: `src/screens/chat.tsx` (`ChatListScreen`, `ChatScreen`, `NewChatScreen`), `src/ui/ChatBits.tsx` (bubble, media grid, composer, reactions bar)
- Modify: `src/navigation/types.ts`, `src/navigation/RootNavigator.tsx` (Chat tab after Home with `chatbubbles` icons and unread badge; stack routes `Chat {chatId}`, `NewChat`), `src/screens/members.tsx` (a "Message" button on someone else's member screen).

- [ ] **Step 1:** Read Impeccable's craft floor (`.claude/skills/impeccable`). **Step 2:** Build the screens per the spec's Screens section using `primitives.tsx`; inverted `FlatList`, `KeyboardAvoidingView`, links via `findLinks` + `Linking.openURL`, removal via `ConfirmButton`, composer keeps text and media when sending fails, shows the error in a `Notice`. **Step 3:** typecheck, lint, test. **Step 4:** Look at the screens at 390×844 in the demo web build. **Step 5:** Commit `Chat tab and chat screens`.

### Task 6: Photos, ride walls and viewer

**Files:**
- Create: `src/screens/photos.tsx` (`PhotosScreen` with Latest / Ride walls `Choices`, `RideWallScreen`, `MediaViewerScreen`)
- Modify: navigation types and stack (`Photos`, `RideWall {rideId}`, `MediaViewer {items, index}` passed as ids + source), `src/screens/rides.tsx` (one block on the ride screen: "Ride chat" and "Ride wall" rows).

- [ ] Steps as Task 5: build, check, look at 390×844, commit `Photos, ride walls and the viewer`.

### Task 7: Review, docs and ship
- [ ] Independent reviewer subagent on the whole diff against the spec; fix Critical/Important test-first.
- [ ] Impeccable critique, audit and polish on the changed screens by hand; screenshots at 390×844 (demo; live once applied).
- [ ] Append Stage 3 blocks to `PRODUCT.md` and `DESIGN.md` (chat bubbles, media grid, composer); write `docs/handover/2026-10-24-stage-3.md`.
- [ ] `npm test`, `npm run test:db`, `npm run typecheck`, `npx expo lint`, all green; push, open the PR, subscribe.
