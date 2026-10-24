# Locked ride routes (Stage 2, part 3)

**Type:** architectural. It adds new tables, new database actions, two native modules, and new screens. This is lane A of the parallel build, so migrations use the `2026102414` prefix. Claude approved this spec on 24 Oct 2026 under Jeff's standing rule. Jeff can veto any line, and the lines marked *inferred* are the ones most worth a look.

## Goal
Each ride can carry its route: the GPX file the Road Captain planned. Members see the route's shape, distance and stops in the app, and can send it to OsmAnd or MyRoute with one tap. Routes are **locked**: only the people who run rides can add, change or remove them, so nobody rides off a version someone edited. This is the "locked GPX routes (RC/board only can edit), hand-off to OsmAnd/MyRoute" decision.

## Words
- **Route:** one GPX file in the club's route library. It has a name, an optional chapter (North, West, or none for the whole club), and notes.
- **Route managers:**
  - for a chapter route: that chapter's board (including the Road Captain) or its Ride Committee
  - for a whole-club route: any chapter's board or Ride Committee
  - anyone on the NEC.
  These are the same people who manage ride crew, so the rule is `managesRide`'s, applied to a chapter instead of a ride.
- **A ride's route:** a ride points at one route from the library, or none. The ride's crew managers choose it.

## Rules (`src/domain/routes.ts`, mirrored by the database with the same words)
1. Approved members can see the library, every ride's route, and download any route's GPX. Applicants and the public see nothing. The public side waits for the reveal.
2. Only route managers can add, rename, re-file, change the notes of, or archive a route. Archiving hides a route from the library and from choosing, but rides that already use it keep it. Nothing is ever deleted.
   - Message: `Only the board or ride committee can change routes.`
3. Only the ride's crew managers can set or clear its route, and only until the ride day is over, the same window as the crew. A cancelled ride can't change.
   - Messages: `Only the board or ride committee can choose this ride’s route.`, `The route can’t change after the ride day.`, `That ride was cancelled.`
   - An archived route can't be chosen: `That route has been archived.`
4. **A GPX file must:**
   - be well-formed GPX
   - have at least 2 track or route points
   - be at most 5 MB.
   - Messages: `That isn’t a GPX file.`, `That route has no track in it.`, `That file is too big (5 MB at most).`
   - A name is required, at most 80 characters: `Give the route a name.`
5. The usual first checks, in order: `Sign in first.`, `Only approved members can do that.`

## How the GPX is read (`src/domain/gpx.ts`, plain TypeScript, tested by `npm test`)
- **What it reads:** a small scanner, with no XML library. Native has no DOMParser. It reads:
  - `trkpt` and `rtept` (lat, lon, optional ele): track points first, falling back to route points if there's no track
  - `wpt` (lat, lon, name) as stops.
- **What it returns:**
  - **distance:** haversine over consecutive points, in metres
  - **climb:** total ascent in metres, when the file has elevation
  - **a simplified line:** Ramer–Douglas–Peucker, at most 300 points, for drawing
  - **bounds**
  - **stops:** waypoint names, the first 100. Unnamed stops show as "Stop 1", "Stop 2" and so on.
  - **the file's own name**, used only to start an empty Name field: the first `<trk><name>`, else `<rte><name>`, else `<metadata><name>` (never a waypoint's). Without one, the file name is used. Either is cut to 80 characters, counted as the name rule counts them.
- **Well-formed means what Postgres (libxml2) accepts,** so the app never shows a good shape for a file the database then refuses. After one optional byte order mark, nothing comes before `<?xml …?>`; every `&` is one of the five XML entities or a character reference (so `&nbsp;` is refused); no `<` inside an attribute value; no attribute twice on one element; only white space, comments and processing instructions after the root. The app may be stricter than the database, never looser.
- The app reads the file before uploading, shows the summary for checking, and sends the file and the summary together.
- The database stores the summary next to the file. It checks the file with Postgres's own XML functions (`xml_is_well_formed_document` and `xpath`, counting `trkpt`/`rtept`), so a wrong or empty file can't get in even from a hand-made call. After the file checks, it refuses a summary the app could never send (a line over 300 points, over 100 stops, or `line`/`stops` that aren't arrays or `bounds` that isn't an object) with `That isn’t a GPX file.`
- A route's file is saved or shared as `<route name>.gpx`, keeping letters and digits in any script, spaces, hyphens and underscores; anything else goes, and an empty result is `route.gpx`.

## Data (new migration `20261024140000_ride_routes.sql`)
- **`public.routes`:**
  - **Fields:** `id`, `name`, `chapter_id` (null means the whole club), `notes`, `gpx text`, `distance_m int`, `climb_m int`, `line jsonb` (`[[lat,lng],…]`), `stops jsonb` (`[{name,lat,lng}]`), `bounds jsonb`.
  - **Audit fields:** `created_by`, `created_at`, `updated_by`, `updated_at`, `archived_at`.
  - **Constraints:** `octet_length(gpx) <= 5 MB`, `char_length(name)` between 1 and 80.
- **`public.ride_routes`:** `ride_id` (primary key; references rides, cascade), `route_id` (references routes), `set_by`, `set_at`.
  - It's a separate table, so the calendar sync never touches it.
- **Row-level security:** approved members can select both tables. Nobody writes through the API.
  - The library list selects every column except `gpx`.
  - The GPX is fetched one route at a time by `route_gpx(route)`.
- **Actions** (SECURITY DEFINER, `search_path = ''`, authenticated only):
  - `save_route(p_id uuid, p_name text, p_chapter uuid, p_notes text, p_gpx text, p_distance_m int, p_climb_m int, p_line jsonb, p_stops jsonb, p_bounds jsonb) returns uuid`
    - a null `p_id` adds a route
    - a null `p_gpx` keeps the file and changes only the name, chapter or notes
  - `archive_route(p_id uuid)`
  - `set_ride_route(p_ride uuid, p_route uuid)`, where null clears it
  - `route_gpx(p_route uuid) returns text`
- `private.manages_chapter_rides(p_chapter uuid)` holds the route-manager rule. `private.manages_ride` is reused for a ride's route.
- **`ride_calendar()`** gains `ride_routes`, the `{ride_id, route_id}` rows for the rides it shows. Its `crew` key and `set_rsvp` stay exactly as they are. See the lane note in `parallel-stages.md`.

## App
- **Types:**
  - `Route`: `{ id, name, chapterId, notes, distanceM, climbM, line, stops, bounds, archivedAt, updatedAt }`, with no GPX text
  - `RideRoute`: `{ rideId, routeId }`
  - `ClubData.routes?` and `ClubData.rideRoutes?`.
- **New Expo modules:** `expo-document-picker`, `expo-file-system` and `expo-sharing`, plus `react-native-svg` for drawing. Add them with `npx expo install`.
  - They need the development build that lane E's live ride already needs.
  - On the web, picking uses a file input, and "Open in maps app" downloads the file.
- **Ride screen:** a **Route** section between the answers and the crew. It shows:
  - the route's name, distance and climb
  - its shape, drawn as a line with start and finish markers on a dark tile
  - its stops.
  - **Open in maps app:** writes `<route name>.gpx` to the cache and opens the share sheet, where OsmAnd and MyRoute both take GPX files. On the web, it downloads the file.
  - **For crew managers:** **Choose route** (when there's none), or **Change** and **Remove**. Remove uses `ConfirmButton`.
  - With no route and the viewer not a manager, the section is hidden.
- **Routes screen** (a stack screen, opened from a "Route library" row at the top of the Rides tab; the tab bar is lane B's):
  - the library, newest first, with chapter filter chips matching the Rides chips
  - each row shows the name, chapter chip, distance and a small shape thumbnail.
  - Managers get **Add route**.
- **Route screen:**
  - the full shape, distance, climb and stops, the notes, and the upcoming rides using the route
  - **Open in maps app**.
  - **Managers:** **Edit** (name, chapter, notes, and **Replace file**) and **Archive** (`ConfirmButton`).
- **Add / edit route screen:**
  - **Pick GPX file.** The file is read on the phone, and the summary (shape, distance, climb, stops) is shown for checking.
  - Name, chapter (Whole club, North, West) and notes fields. Errors show inline in a live region.
- **Pick route screen** (for a ride):
  - the library, filtered to the ride's chapter plus whole-club routes, with a toggle to show all
  - tapping one sets it and goes back.
- **Demo:** two or three made-up routes (west loop, north hills, a club run), with real-looking GPX built from a few dozen points around Melbourne's west and north. One demo ride has a route, and one has none, so every state shows at 390×844.

## Tests
- **`npm test`:**
  - **`gpx.test.ts`:**
    - tracks, route-only files, waypoints with and without names
    - files without elevation
    - a bad file and an empty track
    - distance against a known course (within 0.5%)
    - simplifying to at most 300 points, keeping the start and end.
  - **`routes.test.ts`:**
    - every message above, in order
    - chapter versus whole-club managers, and the NEC
    - the ride-day window, cancelled rides and archived routes.
  - **Demo actions and live mapping**, as for crew.
- **`npm run test:db`** (`supabase/tests/ride_routes_test.sql`):
  - the same rules
  - well-formed but empty, malformed, and oversized files refused
  - no API writes, and applicants or anon can't read
  - `route_gpx`
  - `ride_calendar` returns `ride_routes`, with `crew` still there.
- **`parity.json`:** `saveRoute`, `archiveRoute` and `setRideRoute` cases, allowed and refused.
- **Screens:** Ride, Routes, Route, Add route and Pick route at 390×844 in the demo build, plus the Impeccable critique, audit and polish passes.

## Not in this spec
- Turn-by-turn navigation in the app. OsmAnd and MyRoute do that.
- Drawing or editing a route in the app. Routes are planned in MyRoute, OsmAnd or similar, then uploaded.
- Map tiles behind the shape. That needs a map provider and a key, which means Jeff's say-so on an account.
- Briefing cards. They come next, and will show the route's stops and hazards.
- Offline copies of GPX files in the app. Once a file is in OsmAnd, it is offline there.
