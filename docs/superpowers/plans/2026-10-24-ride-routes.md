# Ride routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a locked GPX route library that ride crew managers attach to rides, which members view in the app and hand off to OsmAnd or MyRoute.

**Architecture:**
- **App:** a pure GPX reader (`src/domain/gpx.ts`) and pure rules (`src/domain/routes.ts`).
- **Database:** SECURITY DEFINER actions over read-only `routes` and `ride_routes` tables, with server-side GPX checks via Postgres XML functions.
- **Data and screens:** demo and live data layers, parity cases, and new screens using `expo-document-picker`, `expo-file-system`, `expo-sharing` and `react-native-svg`.

**Tech Stack:** TypeScript, Expo SDK 58, React Navigation, Supabase Postgres, Jest (`npm test`), `scripts/test-db.sh`.

**Spec:** `docs/superpowers/specs/2026-10-24-ride-routes-design.md`

## Global Constraints
- **Messages:** every refusal message is word-for-word from the spec (curly ’), identical in the app and the database.
- **Migration:** one new file, `supabase/migrations/20261024140000_ride_routes.sql`. The words "drop" and "delete" must not appear anywhere in it, because the live tool's confirm prompt can't reach Jeff. Nothing is ever deleted; archiving sets `archived_at`, and clearing a ride's route uses an upsert to a null-free state (see Task 3).
- **`ride_calendar()` redefinition:** keep its `crew` key and every existing key exactly, and only add `ride_routes`. `set_rsvp` is not touched.
- **Shared files:** additions only, one block each (`/mnt/project-files/build/parallel-stages.md`). The tab bar is not changed.
- **Expo:** before touching Expo APIs, read the SDK 58 docs (`https://docs.expo.dev/versions/v58.0.0/`), and add packages only with `npx expo install`.
- **UI:**
  - no `Alert`, and destructive actions use `ConfirmButton`
  - stencil font for labels, names, buttons, numbers and distances
  - theme tokens from `src/theme.ts`
  - 390×844.
- **Dates and units:** dates are `DD/MM/YYYY`. Distances are in km to one decimal place, and climb in whole metres.

## Review Focus
1. **Odd GPX files:** a GPX with only `<rte>` points, a namespace prefix (`<gpx:trkpt>`), single-quoted attributes, or a CDATA name. The reader must still find the points, or say plainly that it isn't a GPX file.
2. **Archived routes:** a route archived while rides still use it. Those rides keep showing it, but it can't be newly chosen and it isn't in the library list.
3. **Huge files:** a 5 MB file with 100k points. Reading must stay fast (one pass, no regex backtracking), and the drawn line must stay at most 300 points.
4. **Web hand-off:** on the web, "Open in maps app" downloads a file named `<route name>.gpx`, with filesystem-unsafe characters replaced.
5. **Live mode:** the library list must never pull the `gpx` column. Only `route_gpx` fetches it, one route at a time.

---

### Task 1: GPX reader
**Files:** create `src/domain/gpx.ts` and `src/domain/gpx.test.ts`.

**Produces:**
- `interface GpxSummary { distanceM: number; climbM: number | null; line: [number, number][]; stops: { name: string; lat: number; lng: number }[]; bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number } }`
- `readGpx(text: string): GpxSummary | string`. It returns a summary, or one of the spec's three GPX messages (`That isn’t a GPX file.` / `That route has no track in it.` / `That file is too big (5 MB at most).`). The size is checked first, using UTF-8 byte length over 5 × 1024 × 1024.
- `simplify(points, max = 300)`. This is Ramer–Douglas–Peucker, with the tolerance raised until there are at most `max` points. It always keeps the first and last points.
- `haversineM(a, b)`, using an Earth radius of 6371008.8 m.

**Steps:**
- [ ] Write failing tests covering:
  - a 3-segment track, with distance checked against hand-computed haversine to 0.5%
  - a route-only file
  - waypoints, named and unnamed ("Stop 1"…)
  - no elevation (climb null)
  - climb summing only rises
  - a malformed file, an empty `<trk>`, and an oversized string
  - a `gpx:`-prefixed file and single quotes
  - 100k points simplified to ≤300 in under 500 ms, with the ends kept
- [ ] See them fail, then implement with a linear tag scanner (no DOMParser, no catastrophic regex).
- [ ] Run `npm test`, `npm run typecheck` and lint until green.
- [ ] Commit: `Routes: GPX reader`.

### Task 2: Route rules in the app
**Files:**
- modify `src/domain/types.ts` (add `Route`, `RideRoute`, and the `ClubData.routes?` and `ClubData.rideRoutes?` fields)
- create `src/domain/routes.ts` and `src/domain/routes.test.ts`.

**Consumes:** `managesRide`, `crewChangeProblem` and `rideChapterId` (if exported) from `crew.ts`, plus `activePositions`, `holdsBoardSeat` and `isNational` from `access.ts`.

**Produces:**
- `managesChapterRoutes(me: Member | null, chapterId: string | null, data: ClubData): boolean`. True for: approved and NEC; or, for a chapter route, a board seat or active `ride_committee` in that chapter; or, for a whole-club route (null), any board seat or any `ride_committee`.
- `saveRouteProblem(me, existing: Route | undefined, input: { name: string; chapterId: string | null }, data): string | null`. Checks in order:
  1. sign in
  2. approved
  3. if editing, the existing route missing: `That route no longer exists.`
  4. not a manager of the target chapter (and, when editing, of the existing route's chapter): `Only the board or ride committee can change routes.`
  5. name blank or over 80 characters: `Give the route a name.`
  The GPX checks are separate: `readGpx`.
- `archiveRouteProblem(me, route: Route | undefined, data): string | null`. Checks sign in, approved, missing, then manager.
- `rideRouteProblem(me, ride: Ride | undefined, route: Route | undefined | null, data, now): string | null`. Checks in order:
  1. sign in
  2. approved
  3. `No such ride.`
  4. `That ride was cancelled.`
  5. `The route can’t change after the ride day.` (use `endOfFirstDay`)
  6. not `managesRide`: `Only the board or ride committee can choose this ride’s route.`
  7. a non-null route that's missing: `That route no longer exists.`
  8. archived: `That route has been archived.`
- `routeOf(rideId, data): Route | undefined`, and `libraryFor(data, chapterIds: (string|null)[] | 'all'): Route[]` (not archived, newest `updatedAt` first).

**Steps:** failing tests for every message and order, chapter versus whole-club, NEC, and the window. Then implement, go green, and commit: `Routes: rules in the app`.

### Task 3: Routes in the database
**Files:**
- create `supabase/migrations/20261024140000_ride_routes.sql` and `supabase/tests/ride_routes_test.sql`
- modify `scripts/test-db.sh`: a `rustnuts_routes` block copying the crew block.

**Produces:**
- **Tables** as in the spec, plus `check (octet_length(gpx) <= 5242880)` and `check (char_length(btrim(name)) between 1 and 80)`.
- **Actions:**
  - `save_route(...) returns uuid`, with the signature from the spec. On a new route, `p_gpx` is required.
  - `archive_route(p_id uuid)`
  - `set_ride_route(p_ride uuid, p_route uuid)`
  - `route_gpx(p_route uuid) returns text`, approved members only, otherwise the usual messages
  - `private.manages_chapter_rides(p_chapter uuid) returns boolean`
- **GPX check:**
  - Size first: `That file is too big (5 MB at most).`
  - Then `xml_is_well_formed_document(p_gpx)`: `That isn’t a GPX file.`
  - Then count the points with `xpath('//*[local-name()=''trkpt'' or local-name()=''rtept'']', p_gpx::xml)` and require at least 2: `That route has no track in it.`
  - Also refuse when the root's `local-name()` isn't `gpx`: `That isn’t a GPX file.`
- **Clearing a ride's route without the word "delete":** `ride_routes.route_id` is nullable, and clearing sets it to null with an upsert. `ride_calendar` returns only rows where `route_id is not null`.
- **`ride_calendar()`:** keep `20261024130000_ride_crew.sql`'s body exactly, and add a `'ride_routes'` key.
- **Grants:** RLS select for approved members, no writes through the API, and execute for authenticated only.

**Steps:**
- [ ] Write the failing SQL test, covering:
  - every message and order
  - well-formed-but-not-GPX, empty-track and oversized files
  - archive keeps existing ride links
  - a manager of the other chapter refused
  - NEC allowed
  - `route_gpx` for an applicant refused
  - `ride_calendar` has both `crew` and `ride_routes`
- [ ] Run `npm run test:db` and see it fail. Write the migration and go green.
- [ ] `grep -ciE 'drop|delete'` on the migration must print 0.
- [ ] Commit: `Routes: tables and actions in the database`.

### Task 4: Data layer, demo and parity (after 1–3)
**Files:**
- `src/data/clubContext.ts`: `saveRoute`, `archiveRoute`, `setRideRoute` and `routeGpx`
- `demoActions.ts`, `DemoClubProvider.tsx`, `LiveClubProvider.tsx`, `liveData.ts` and `database.types.ts`
- `demoData.ts`: 3 routes, generated by a small helper from point lists, with r-1 using one
- `parityFixture.testkit.ts`, `scripts/parity-sql.mts` and `parity.json`
- tests: `src/data/demoRoutes.test.ts` and `liveData.test.ts`.

**Produces:**
- `saveRoute(input: { id: string | null; name: string; chapterId: string | null; notes: string; gpx: string | null }): Promise<string>`. It reads the GPX with `readGpx` (and throws its message), checks `saveRouteProblem`, then calls `rpc('save_route', …)` with the summary.
- `archiveRoute(id)`, `setRideRoute(rideId, routeId | null)` and `routeGpx(routeId): Promise<string>`.
- **liveData** selects routes with explicit columns (never `gpx`), and maps `ride_routes` from the calendar (`?? []`).
- **Demo** keeps each route's GPX text in an in-memory map for `routeGpx`.
- **Parity:** at least 8 cases across `saveRoute` (with a small valid GPX string in the fixture), `archiveRoute` and `setRideRoute`, both allowed and refused.

**Steps:** failing tests, implement, then run `npm test`, `npm run test:db`, typecheck and lint until green. Commit: `Routes: demo and live actions, parity cases`.

### Task 5: Screens and hand-off (after 4)
**Files:**
- **Install:** `npx expo install expo-document-picker expo-file-system expo-sharing react-native-svg`.
- **Create:**
  - `src/data/routeFiles.ts` (native) and `src/data/routeFiles.web.ts`, each exporting `pickGpxFile(): Promise<{ name: string; text: string } | null>` and `openInMapsApp(name: string, gpx: string): Promise<void>`
  - `src/ui/RouteShape.tsx`: an SVG polyline from `line` and `bounds`, with start and finish markers, at `size` and `thumb` variants
  - `src/screens/routes.tsx`: `RoutesScreen`, `RouteScreen`, `EditRouteScreen` and `PickRouteScreen`.
- **Modify:**
  - `src/screens/rides.tsx`: a Route section between the answers and the crew, and a "Route library" row at the top of the Rides list
  - `src/navigation/types.ts` and `RootNavigator.tsx`: `Routes`, `Route { routeId }`, `EditRoute { routeId?: string }` and `PickRoute { rideId }`
  - `DESIGN.md`: the Route section and the route screens, briefly.
- **Behaviour:** as in the spec's App section.
  - A safe file name: `name.replace(/[^\w\- ]+/g, '').trim() || 'route'` + `.gpx`.
- **Steps:**
  - [ ] Read Impeccable's craft floor and `DESIGN.md`, plus the SDK 58 docs for the three modules.
  - [ ] Write tests first for any pure helpers you add (file name, distance and climb formatting).
  - [ ] Build the screens.
  - [ ] Run typecheck, lint, `npm test`, and the Impeccable `detect` on the changed screens.
  - [ ] Commit: `Routes: screens and hand-off to maps apps`.

### Task 6: Review, design passes, live (lead)
- [ ] Get an independent whole-branch review. Fix any findings in one wave, then re-review.
- [ ] Take 390×844 demo screenshots and run the Impeccable critique on Ride, Routes, Route, Edit and Pick.
- [ ] Merge main in and run all four checks. Then open the PR and merge it.
- [ ] Add a line to the Live log, then apply the migration live in parts with no "drop" or "delete". Smoke-check `ride_calendar`'s keys.
