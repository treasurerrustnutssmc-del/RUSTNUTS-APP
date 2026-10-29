# Send ride routes to Garmin (design)

Bounded work, no database change. Self-approved by Claude on 29 Oct 2026 (Jeff can veto).

## Why

Plenty of members ride with a Garmin zūmo (XT, XT2, 396/595) rather than a phone in a cradle. The
locked route is a GPX file already, but the file a Road Captain uploads from MyRoute or OsmAnd
carries app-specific extensions, route points that a Garmin re-routes between, and sometimes far
more track points than an older unit keeps. A Garmin hand-off sends a cleaned copy that the
Garmin apps and units take without fuss.

## How members get it onto the Garmin

- **zūmo XT2 / newer:** the Garmin Tread app takes a GPX from the phone's share sheet and syncs it
  to the unit.
- **Garmin Explore / Drive:** the same share sheet route.
- **Older units:** the web build downloads the file; copy it into the unit's `GPX` folder over USB,
  or open it in BaseCamp.

So the button writes the cleaned file and opens the share sheet (phone) or downloads it (web), as
"Open in maps app" does, but with its own file and wording.

## The cleaned file (`src/domain/garmin.ts`, pure and tested)

`garminGpx(text, name)` reads the stored GPX with the same scanner as `readGpx` and writes a fresh
GPX 1.1 file:

- `creator="Rustnuts SMC"`, the plain GPX 1.1 namespace only. No extensions from other apps.
- `<metadata><name>` and one `<trk><name>` set to the route's name in the app, XML-escaped.
- One `<trkseg>` with the track (route points when the file had no track, as `readGpx` does).
  A track, not a `<rte>`: a Garmin recalculates a route between its points and can take a member
  off the planned roads, while a track is followed as drawn (Tread and zūmo can turn it into a trip).
- At most 10,000 track points, the track log limit of zūmo and Edge units, simplified with the
  existing Ramer–Douglas–Peucker `simplify` so bends survive. Elevation is kept when the point had it.
- Coordinates written with 6 decimals (about 10 cm), elevation with 1.
- Stops as `<wpt>` with their names (at most the 100 `readGpx` keeps), so fuel and coffee stops
  show as favourites on the unit.
- Returns the same messages as `readGpx` when the stored file can't be read.

`garminFileName(name)` gives an ASCII-only name (accents folded, other characters dropped, spaces
kept, at most 40 characters, "Rustnuts route" when nothing is left), ending in `.gpx`, because
older Garmin units and BaseCamp mangle non-ASCII file names.

## Where it shows

In the ride maps thread's Navigate chooser (`NavigateChooser` in `src/ui/RouteBits.tsx`), under
"The whole route", as a `SendToGarminButton` beside `OpenInMapsButton`. Label "Send to Garmin",
help line "Pick Garmin Tread or Explore from the share sheet, then sync to your zūmo." (phone) /
"Saves a Garmin-ready GPX. Copy it to the unit's GPX folder or open it in BaseCamp." (web).
Stencil font for the label, as every button.

## Tests

`src/domain/garmin.test.ts`: escaping, no extensions carried over, point cap with first and last
kept, elevation carried, waypoints, fallback to route points, unreadable file message, file names.
