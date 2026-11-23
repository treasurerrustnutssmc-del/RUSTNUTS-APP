# Club photo and video gallery — design

Date: 23 Nov 2026. Asked by Jeff (22 Nov): "a way to store photos on the app that also add a gallery to the website, upload and download photos and videos". Folded in 23 Nov from his idea list: "anyone can download images and video".

Size: **architectural** (new table, bucket, Edge Function, Cloudflare storage, website page, one native-build item). Claude approves its own spec; Jeff can veto.

## What already exists (keep, build on)

- Chat › Photos: Latest (every photo/video in chats the member can read, never private chats) and Ride walls; full-screen viewer (photos + videos).
- `chat-media` bucket: 50 MB, mp4/mov, 60 s video cap. Photos shrink to 2048 px JPEG. **Videos are not shrunk.**
- Website Photos page + Home strip (`site-api` GET /photos, newest 60, captions only, no names). SMO, crew or NEC put up chat photos or phone uploads (`site_photos`, `site-media` bucket). Photos only.

## Jeff's choices

| Question | Answer |
|---|---|
| Video storage | Shrink on the phone, keep in Supabase (Pro 100 GB at launch) — tapped 22 Nov 11:11Z |
| Videos on the website | Yes, copied to the club's Cloudflare R2 (free to 10 GB, no watch charges) — tapped 22 Nov 11:11Z |
| Who makes photos public | **Card still open.** Built for the recommended option: uploader ticks "OK for the website", SMO/crew/NEC approve. Today's rule (crew picks any club photo, poster heads-up) stays as a second route. If Jeff picks otherwise, only the approve step changes. |

## The pieces

### 1. Add straight to the gallery (OTA)
- Photos screen gets **Add photos and videos** (any approved member; not Introduced/Family).
- Pick up to 10, choose an **album**: a ride (last 30 days + upcoming, same list as ride walls) or "Club life". Optional caption (120). Tick **OK for the website** (with the existing "everyone in it is happy" consent line).
- New table `gallery_items` (uploader, album ride_id or null, kind photo/video, path, poster_path, size, duration, caption, website_ok, created_at, removed_at). New private bucket `gallery-media` (50 MB, same types), folder per uploader.
- Latest and ride walls show chat media **and** gallery items, newest first (one feed function `gallery_feed(before)`). A ride wall = that ride's chat media + gallery items filed under it.
- Uploader, SMO/crew/NEC and the board can take one down (existing storage purge clears the file).
- Rules in `src/domain/gallery.ts`, mirrored by RLS; `supabase/tests/gallery_test.sql` + parity cases.

### 2. Save to your phone — "anyone can download" (two steps)
- **Now (OTA):** viewer gets a **Save** button on every photo and video for every member who can see it. It downloads the file (`expo-file-system`) and opens the share sheet (`expo-sharing`, already installed): iPhone shows "Save Image/Save Video"; Android offers Photos, Drive, etc. Web: plain download.
- **Next native build:** add `expo-media-library` so Save goes straight to the phone's Photos with a "Saved" note. Needs an app.json permission, so it moves the runtime fingerprint: **new android-preview, Play build and iPhone build.** Batched with the item below.
- Website: every photo and video on the public gallery gets a **Download** link (it's already public).

### 3. Smaller videos
- **iPhone (OTA):** picker exports at 1280×720 H.264 (`videoExportPreset`), about 8–12 MB a minute instead of ~100 MB.
- **Android (next native build):** `react-native-compressor` (no Expo module does this) shrinks to 720p before upload. Until that build, Android keeps today's 50 MB refusal message.
- 60 s cap stays.

### 4. Website gallery with albums and videos
- `site_photos` grows a `kind` (photo/video) and a `gallery` source. Approving a "OK for the website" item puts it live (photos as today).
- **Videos:** on approval, a new Edge Function `site-video-copy` copies the file and its still to Cloudflare R2 (S3 API, keys as function secrets) and stores the public URL. Taking it down deletes it from R2. Served through a small Cloudflare Worker on the club's workers.dev address (the domain's DNS is at Quantum Core, not Cloudflare, so no custom-domain bucket; r2.dev links are rate-limited and not for real use).
- R2 storage cap: the function refuses new website videos once R2 holds 9 GB, so it can never bill.
- `public_site_photos()` returns kind, album (ride title + date, or "Club life"), poster and video URL. Still never names or member ids.
- Website `photos.html`: album chips (All, then each ride), grid with play marks, tap opens a lightbox with the video player, Download link.

## Costs
- Supabase: covered by Pro (100 GB files, 250 GB downloads a month). Shrunk videos ~10 MB each → ~10,000 before Pro's limit.
- Cloudflare R2: A$0 up to 10 GB (hard-capped at 9 GB). **Needs a card on file to switch R2 on — Jeff, club card, one step.**
- Nothing else new.

## Order of work (one batched update, shipped when Jeff says)
1. Domain rules + SQL + tests (gallery table, bucket, feed, approve, kind on site_photos).
2. App: Add to gallery, merged feed, Save (share sheet), iPhone video preset.
3. site-api /photos v-next + website albums/lightbox/download.
4. R2 + Worker + `site-video-copy` (after Jeff's card step).
5. Native build batch: expo-media-library + react-native-compressor (one android-preview, Play and iPhone build).
6. Before-and-after screenshots at 390×844, demo and live, for Jeff's OK. Independent review before merge.

## Live steps that need Jeff
- Switch on R2 with the club card.
- Merge/ship tap for the batched update and the website.
- (Live SQL and function deploys Claude runs itself under the blanket rule.)
