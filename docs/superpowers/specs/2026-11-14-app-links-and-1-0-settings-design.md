# Website links that open the app, and the 1.0 build settings

Date: 14/11/2026. Kind: architectural (new native settings, a second repo, store-side keys).
Approved by Claude under Jeff's 24 Oct rule; Jeff chose (13 Nov, by card) to put app links into
1.0 and to drop iPad for 1.0.

## Why one change set

Any `app.json` change moves the runtime fingerprint, which strands every installed Android test
build and needs a fresh android-preview and a fresh Play store build. So everything that touches
`app.json` before 1.0 goes in together: app links, `ios.supportsTablet: false`, and the missing
rows in the iPhone privacy manifest.

## 1. Links that open the app (website-and-app task 15)

### The links

Only paths under `/open/` on the club website open the app. Every other page (home, shop,
charity, photos, the public app pages, the Road Rules) keeps opening in a browser, so the
website works as it does today for everyone, members included.

| Link | Opens |
|---|---|
| `https://www.rustnutssmc.com.au/open/` | the app, on the screen it would open on anyway |
| `https://www.rustnutssmc.com.au/open/?ride=<ride id>` | that ride |

The app also accepts the same links on the bare domain (`rustnutssmc.com.au`, which GitHub Pages
redirects to www), over `http`, and with the app's own scheme (`rustnuts://open/?ride=…`), so a
link pasted in any of those forms still lands. Anything it doesn't understand under `/open/`
opens the app without moving. A ride id must look like an id (letters, digits, `-`, `_`; at
most 64), so a mangled link can't push junk into a screen.

Why a query (`?ride=`) and not `/open/ride/<id>`: the website is static GitHub Pages; one page,
`/open/index.html`, catches every link, with no 404 page and no server.

### Who gets what

Mirrors notification taps (`src/data/notificationTaps.tsx`):

- Members (all levels) and Family: the link is opened from inside the signed-in screens. A ride
  opens `RideDetail` (Family get their own Family ride screen, which already takes the same
  `rideId`).
- Signed out, waiting for approval, or on the posting-rules gate: the app just opens. A link
  that arrived then is kept for five minutes and opens once the person reaches the signed-in
  screens (signing in with a code takes about that long). Older ones are dropped, so nobody is
  thrown into a ride they tapped yesterday.
- A link is opened once, even when the screens rebuild.
- Web build (Chris's PC): no link handling; the web build never reads its own URL (AGENTS.md).

### Links inside the app

`openLink` today sends club-website pages to the in-app browser sheet. An `/open/` link would
then show the fallback page inside the app, which is silly. So `openLink` first asks whether the
link is an app link; if it is (and not on the web build), it is handed straight to the same
in-app opener and no browser opens. A ride link pasted in a chat therefore opens the ride.

### Sharing

"Share this ride" adds the ride's link to the text it sends, so the links get made by members
from day one: `West breakfast run · Sat 07/11/2026 8:30 am · BP Ravenhall. Answer in the Rustnuts
app: https://www.rustnutssmc.com.au/open/?ride=<id>`. A called-off ride keeps the link too (the
ride page says it is called off).

### Phone settings (`app.json`)

- Android: one intent filter, `autoVerify: true`, `https`, host `www.rustnutssmc.com.au`,
  `pathPrefix: "/open/"` (with the slash, so a page like `/opener.html` never opens the app; the app's own links always carry the slash). Only www: the bare domain redirects, and Android won't verify a host
  that redirects.
- iPhone: `ios.associatedDomains: ["applinks:www.rustnutssmc.com.au"]`. EAS turns on the
  Associated Domains capability for the App ID at build time.

### Website side (`treasurerrustnutssmc-del/rustnutssmc`)

- `/open/index.html`: the page anyone without the app sees. `noindex`; says the link opens in the
  Rustnuts members' app, tells members to open it on a phone with the app installed, and offers
  the club website. It names no store (nothing public about the app before Apple approves).
- `/.well-known/assetlinks.json` (Android): package `au.com.rustnutssmc.app` and two SHA-256
  fingerprints, both read from Play Console › Test and release › App integrity › App signing:
  the **app signing key** (every Play install) and the **upload key** (the EAS keystore, which
  also signs the android-preview test builds). Published when those two values are read; until
  then Android just opens the link in the browser, which shows the fallback page.
- `/.well-known/apple-app-site-association` (iPhone): `applinks` with `appIDs`
  `["<TEAMID>.au.com.rustnutssmc.app"]` and components `/open` and `/open/*`. **Held** until
  Apple enrols the club and gives a Team ID; the app side is in 1.0 already, so publishing the
  file later needs no new app build (iOS re-reads it at install and periodically).
- GitHub Pages runs Jekyll, which skips dot-folders; `_config.yml` gets
  `include: [".well-known"]` so `.well-known` is served. No `.nojekyll`, so nothing else about
  how the site is built changes.
- No domain or DNS login is needed: both files are plain files in the repo that GitHub Pages
  already serves on www.

A bare `/open/` link tapped inside the app does nothing (the person is already in the app), rather
than showing the website's fallback page in a browser sheet.

### Not in this change

Store links on the fallback page (the "Get the app" section stays hidden until launch); links to
chats, notices or other screens (add a row to the table later; no new build needed for a new
`/open/` target, only an over-the-air update); links on the website itself that point at
`/open/` (nothing public about the app before launch).

## 2. No iPad for 1.0

`ios.supportsTablet: false`. iPads still run the iPhone app in its iPhone-size window (Apple's
compatibility mode), so no iPad screenshots are needed.

## 3. iPhone privacy manifest

Bring `ios.privacyManifests.NSPrivacyCollectedDataTypes` level with the Apple table in
`docs/store/privacy-answers.md`: add Coarse Location, Health and Product Interaction (linked,
not tracking, App Functionality), and add Developer's Advertising to Photos or Videos (club-chat
photos the crew puts on the public website). Then drop the "before the first iPhone build" note.

## Tests

- `src/domain/appLinks.test.ts`: which URLs are app links, what each opens, junk ids, other
  website pages stay web, the five-minute wait; `src/domain/share.test.ts`: the share text
  carries the link.
- `src/appConfig.test.ts`: the intent filter (www only, `/open` only, autoVerify), the
  associated domain, `supportsTablet` false, the manifest rows and purposes.
- Website `test/open-links.test.js`: the fallback page exists, is noindex, names no store; Jekyll
  includes `.well-known`; once present, `assetlinks.json` has the right package and two
  well-formed fingerprints.

## After merge (Jeff's presses, one at a time)

1. Merge the app PR. 2. Merge the website PR. 3. Run Store build › android-preview. 4. Run the
Android store build for the Play closed test. 5. Claude reads the two SHA-256 values from Play
Console in Chrome and opens the assetlinks.json PR. 6. After Apple enrols: the AASA PR.
