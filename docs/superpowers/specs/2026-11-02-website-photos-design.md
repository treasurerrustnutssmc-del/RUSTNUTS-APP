# Club photos on the website (website-and-app task 23)

**Status:** approved by Claude under Jeff's 24 Oct rule; shown to Jeff 2 Nov 2026 (he can veto).
**Kind:** architectural. A new table pair, a new storage bucket, a public feed, a website page and
three app screens, following the club-news and bragging-rights patterns.

## What Jeff asked for

Task 23: "Public photo picks. The site links out to Facebook albums. Later: the board picks app
photos to show in a public gallery (only with the people in them happy to be public)." On 1 Nov
Jeff corrected who picks: "We have a social media officer", and "Give the SMO a crew that they
approve that can post as well."

So: the **Social Media Officer** (a club position the app already has) and a **crew the SMO
approves** put photos on the club website. The NEC can do everything the SMO can, so the club is
never stuck when the seat is empty. The board as such has no part in it.

## Who

| Role | Can |
| --- | --- |
| Website photo editor: anyone holding `social_media_officer` (either chapter), the NEC, or a member on the crew | Put a photo up (from a club chat, or straight from their phone), take any photo down |
| Social Media Officer or NEC ("crew manager") | Add approved members to the crew, take them off |
| The member who posted a chat photo | Say yes or no when an editor wants it on the website; take their own photo down any time |
| Everyone (the website) | See the live photos, newest first, no names |

A crew member must be an approved member (any status) who is not on hiatus; leaving the club or
losing approval takes them off in effect (`is_site_photo_editor` checks approval each time).

## A photo on the list

| Field | Rule |
| --- | --- |
| source | `chat` (a photo already posted in a club chat; never a direct chat) or `upload` (from the editor's phone into the `site-media` bucket) |
| media_id | the chat photo's `message_media` row (source `chat`), cascades when the message goes |
| bucket, path, width, height | where the file is: `chat-media` for a chat photo, `site-media` for an upload |
| caption | optional, 1–120 characters, plain text; the website shows it under the photo |
| posted_by | the member whose photo it is: the chat message's author, or the uploader |
| picked_by, picked_at | the editor and when |
| status | `waiting` (needs the poster's OK), `live`, `declined`, `removed` |
| decided_at | when the poster answered |
| removed_at, removed_by | "Take down" |

**Consent (the rule from the task).** Every pick carries the editor's tick "Everyone in this photo
is happy for it to be on the club website" (refused without it). A chat photo posted by **someone
else** also waits for that member's OK: it sits `waiting`, the poster gets a push ("Photo for the
website?") and a card on Home with the photo, Yes and No. Their own photo, or an upload, goes
`live` at once. Declined photos stay on the editor's list as "They said no" and cannot be asked
again (one ask per chat photo; a unique index on `media_id` where status is not `removed`).

**Taking down.** Any editor, or the photo's poster, any time. A chat message removed, a member
who deletes their account (their uploads' files are queued for the storage purge; their chat
photos go with their messages), or a chat photo that no longer exists all drop the photo from the
feed on their own.

**Public rule.** The website shows the **newest 60 live photos**, newest first. The feed returns
id, a signed link (an hour), width, height, caption and the photo's date only. Never a name, never
a chat.

## Words (identical in app and database, checked by tests)

- NOT_PHOTO_EDITOR "Only the Social Media Officer, their crew or the NEC can put photos on the website."
- NOT_CREW_MANAGER "Only the Social Media Officer or the NEC can change the website photo crew."
- PHOTO_GONE "No such photo."
- NOT_A_PHOTO "Only photos go on the website, not videos or GIFs."
- PRIVATE_PHOTO "Photos from private chats stay private."
- PHOTO_ALREADY_PICKED "That photo is already on the list."
- NO_CONSENT_TICK "Tick that everyone in the photo is happy to be on the website."
- LONG_CAPTION "Keep the caption to 120 characters."
- BAD_UPLOAD "That photo didn’t upload properly. Try again."
- NOT_YOUR_ASK "Only the member who posted the photo can answer."
- ASK_ANSWERED "That one has already been answered."
- NOT_PHOTO_REMOVER "Only the website photo crew or the member who posted it can take it down."
- PHOTO_REMOVED_ALREADY "That photo has already been taken down."
- CREW_NOT_MEMBER "Only approved members can join the crew."
- CREW_ON_HIATUS "Members on hiatus can’t join the crew."
- CREW_ALREADY "They’re already on the crew."
- NOT_ON_CREW "They’re not on the crew."

Refusal orders:
- pick from chat: signed in → approved → editor → photo exists and readable → is a photo (not video/GIF) → not from a direct chat → not already on the list → consent tick → caption length.
- upload: signed in → approved → editor → consent tick → caption length → file path is in my `site-media` folder (BAD_UPLOAD).
- answer: signed in → approved → exists → mine (NOT_YOUR_ASK) → still waiting (ASK_ANSWERED).
- take down: signed in → approved → exists → editor or mine → not already removed.
- crew on/off: signed in → approved → crew manager → target exists and approved → not on hiatus (on only) → already / not on crew.

## Pieces

**App (treasurerrustnutssmc-del/rustnuts-app)**
- `supabase/migrations/20270770000000_site_photos.sql`:
  - `public.site_photo_crew (member_id pk, added_by, added_at, removed_at, removed_by)`; RLS select for approved members (so the app knows who the editors are); writes only through `set_site_photo_crew(p_member, p_on)`.
  - `public.site_photos` as above; RLS select: editors see all, everyone sees their own; writes only through `pick_site_photo(p_media, p_caption, p_consent)`, `upload_site_photo(p_path, p_width, p_height, p_caption, p_consent)`, `answer_site_photo(p_id, p_yes)`, `remove_site_photo(p_id)`.
  - `private.is_site_photo_editor()`, `private.manages_site_photo_crew()`.
  - bucket `site-media` (private, 10 MB, image/jpeg|png|webp (the app re-encodes HEIC to JPEG before upload)); upload into `<my id>/…` for editors; read for editors and the file's owner; delete own files not on the list.
  - `list_site_photos()`: editors get every row (live first, then waiting, declined, removed, newest first); others get their own rows. Returns jsonb with the poster's and picker's ids (names come from the member list the app already has).
  - `public_site_photos()`: anon and authenticated, the public rule, returns bucket+path (site-api signs them).
  - A push to the poster when a pick lands `waiting`, through `private.push_outbox` like the chat push (dedupe key `site-photo:<id>`), held by the master switch like every push.
  - `private.forget_site_photos()` trigger after delete on `public.member_private` (the first thing `forget_member` does): deletes the member's `site_photos` rows, queues their `site-media` files into `private.storage_purge`, clears them as picker.
- `supabase/tests/site_photos_test.sql` + a `rustnuts_site_photos` block in `scripts/test-db.sh`.
- `src/domain/sitePhotos.ts` (+ test): words, limits, `SitePhoto`, `SitePhotoCrew` types, `isSitePhotoEditor`, `managesSitePhotoCrew`, `pickProblem`, `uploadProblem`, `answerProblem`, `removeProblem`, `crewProblem`, `publicSitePhotos(list)`, `editorListOrder`.
- `src/data/sitePhotos.tsx` + `sitePhotosData.ts`: `useSitePhotos()` on the site-news store pattern (demo: three sample photos from the demo chats held in memory; live: the RPCs, uploads through `prepareUpload` into `site-media`, signed links through the chat provider's `mediaUrl` for chat-media and a sibling for site-media).
- Screens:
  - `src/screens/sitePhotos.tsx`: `WebsitePhotosScreen` (route `WebsitePhotos`): for editors "From your phone" and "From the club's photos" buttons, the list with status chips and `ConfirmButton` "Take down"; a "Crew" section for crew managers (member picker, remove); for every member "Your photos on the website" with the asks (Yes / No) and their live ones (Take down). `HomePhotoAskCard` on Home when the member has an ask waiting.
  - `PickWebsitePhotoScreen` (route `PickWebsitePhoto`): the club photo grid (`club_photos`, photos only), tap one → caption + consent tick → "Put it up" (or "Ask them" when it is someone else's).
  - Rows: "Website photos" on the Photos screen for everyone (editors see their list; others their own), with a count of asks waiting.
- Privacy policy: one line under "Who sees what": "Photos the Social Media Officer or their crew pick for the club website, only with the OK of the member who posted them. The website shows no names." Then `npm run build:privacy` and `build:site`.
- `supabase/functions/_shared/siteApi.ts`: `GET /photos` → `{ photos: [{ id, url, width, height, caption, taken_at }] }`, cache `public, max-age=900` (PHOTOS_CACHE); signed links last an hour (`LOGO_URL_LIFE_S`) so a cached page never shows a dead photo; 503 `no-store` when the database refuses. `site-api/index.ts`: `listPhotos` + `signPhoto(bucket, path)`. Deploy as site-api v10.

**Website (treasurerrustnutssmc-del/rustnutssmc)**
- `app/site-api.js`: `photosHtml(list)` (escaped captions; alt is the caption or "Rustnuts club photo"), `loadPhotos()`.
- `index.html`: a "Photos" strip (`<section class="block photos" id="photos" hidden>`) between Club News and Sponsors with the newest 8 and a "More photos" link; hidden until the feed answers and when empty.
- `photos.html`: the full gallery (up to 60) with the Facebook album links underneath, so Chris's albums stay reachable. Nav link "Photos" on every page.
- `test/photos.test.js`. Degrades gracefully: feed missing or 503 → strip hidden, page shows the Facebook links only.

## Testing

Domain tests (words, orders, consent rule, own-photo-goes-live, public rule). DB tests: anon cannot
read the tables; a member off the crew cannot pick, upload or change the crew; the SMO adds a crew
member who then picks; a pick of someone else's photo waits and pushes, the poster answers yes/no,
a stranger cannot answer; an own photo and an upload go live; a video and a direct-chat photo are
refused; take down by editor and by poster; the public feed as anon returns live photos only,
60 at most, no names; the forget trigger queues the upload file. Website tests: escaping, empty
list → "", 8 on home. Then `npm test`, `npm run test:db`, `npx tsc --noEmit`, `npx expo lint`,
website `npm test`, phone-size screenshots (demo) of the Website photos screen, the pick flow, the
Home ask card, and the site strip and page with a mock feed, and an independent review of the diff.

## Out of scope

Videos on the website, albums or chapters on the site, photo editing or cropping, showing who
took the photo, Facebook or Instagram posting, a count of photo views. Any of these is a new task.

## Review notes (2 Nov 2026)

- A chat message removed the app's way keeps its row with `removed_at` set, so a trigger on `messages` takes its photos down at the same time; a deleted media row cascades.
- An upload's path is `<member id>/<random>.jpg`, so a signed link carries the uploader's member id. It is an opaque id, never a name, and the bucket policies depend on that folder; accepted.
- The pick screen offers the newest 60 club photos (one page of the Photos wall). Older ones can be uploaded from the phone instead.
