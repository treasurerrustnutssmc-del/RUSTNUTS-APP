# Store privacy answers (Google Play data safety, Apple privacy labels)

Drafted 31/10/2026 from the same audit as the privacy policy (`src/domain/privacyPolicy.ts`).
Keep the three in step: when the app starts collecting something new, change the policy, then these.

- **Privacy policy URL (both stores):** https://treasurerrustnutssmc-del.github.io/RUSTNUTS-APP/privacy.html
- **Support URL (both stores):** https://treasurerrustnutssmc-del.github.io/RUSTNUTS-APP/support.html
- **Account deletion web link (Google Play asks for one):** https://treasurerrustnutssmc-del.github.io/RUSTNUTS-APP/delete-account.html
  (in the app: Me, Notifications and privacy, Delete my account; without the app: email apps@rustnutssmc.com.au).
- The same pages are also on the club domain (www.rustnutssmc.com.au/app/privacy.html, support.html, delete-account.html). The store forms keep the GitHub Pages addresses until the club domain has stayed up for a good while (it was down on 1 Nov 2026); each GitHub copy carries a note (not a redirect) pointing to the club-domain copy. Switch the forms over later in one go.
- **Contact email:** apps@rustnutssmc.com.au

Rules used for both forms:
- No advertising code, no ad networks and no analytics code of the club's own. The only ads are the
  club's own sponsors. On Android two Google parts the app uses send Google usage and diagnostic data
  under Google's own terms: the Maps SDK (draws ride maps: IP address, device and SDK details, a
  pseudonymous Maps SDK ID, crash traces and map pan/zoom) and ML Kit (reads the check-in QR code on the
  phone: install ID and usage data). On Google Play those are declared as **Shared with Google, for
  Analytics** (Crash logs, Diagnostics, App interactions, Device or other IDs; Diagnostics also for App
  functionality), the same reasoning as GIPHY.
- The other services the app uses (Supabase, Expo, Firebase Cloud Messaging, Apple Push, LiveKit, Open-Meteo,
  Gmail for sign-in codes, Anthropic, and for merch orders Make.com, Google Workspace (Sheets, Docs and
  Drive) and Resend) work for the club as service providers, which both stores say is not "sharing".
  GIPHY is an exception: its API terms let it use data for its own purposes, so the GIF search words are
  declared as shared (App activity: In-app search history) on Google Play.
- Website photos are the other exception. The Social Media Officer, their crew and the NEC put club-chat
  photos on the public club website without asking the poster first (Jeff, 2 Nov 2026), so Photos are
  **Shared: Yes**, for Advertising or marketing (promoting the club). Videos never go on the website.
- Members seeing each other's posts is the app's purpose, which Google treats as not sharing ("user-initiated").
- Nothing on the Google list is collected only in memory, so every row is **Ephemeral: No**. Ask the club,
  Catch me up and Draft from Otter send text to Anthropic (a service provider that doesn't train on it and
  may keep API data for up to 30 days); the club doesn't keep the questions, summaries or transcripts, but
  the rows they fall under also cover stored data, so they stay "No".
- Both Ask the club and Catch me up ask each member's permission in the app, naming Anthropic, before
  first use. Nothing goes to Anthropic from either until the member says yes.
- Ride comms voice is live and never stored. Voice notes are stored, so the Audio row stays "Ephemeral: No".
  Weather lookups send the ride's route (plus the phone's IP address) to Open-Meteo.
- The app is for adults (18 and over), Family accounts included: the join form asks every applicant to say
  they're 18 or over (Jeff, 3 Nov 2026).

## Google Play: Data safety form

**Entered and saved in Play Console on 03/11/2026**, sent for review on 04/11/2026 and approved the
same day. Change this table and the
policy together if anything changes.

**Overview questions**

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes |
| Account creation | Username and other authentication (email plus a one-time code; no passwords) |
| Delete account URL | https://treasurerrustnutssmc-del.github.io/RUSTNUTS-APP/delete-account.html |
| Can users ask for some of their data to be deleted without deleting the account? | Yes (saved 3 Nov 2026). Delete data URL: https://treasurerrustnutssmc-del.github.io/RUSTNUTS-APP/delete-account.html, the same page as account deletion; its "Delete some of your data and keep your account" section has the steps. |
| Independent security review | No |
| Target audience (its own App content page) | 18 and over |
| Contains ads (its own App content page) | Yes: the club's own sponsors and their member deals; no ad networks |

**Data types** (Collected: Yes for every row. Ephemeral: No for every row.)

| Category | Data type | Required or optional | Shared | Purposes (collected) | Purposes (shared) |
|---|---|---|---|---|---|
| Location | Approximate location (a live ride when Android only has "Approximate" permission) | Optional | No | App functionality | |
| Location | Precise location (live ride only; latest position only) | Optional | No | App functionality | |
| Personal info | Name | Required | No | App functionality, Account management, Fraud prevention, security and compliance | |
| Personal info | Email address | Required | No | App functionality, Account management, Fraud prevention, security and compliance | |
| Personal info | User IDs (member ID, also the LiveKit identity) | Required | No | App functionality, Account management, Fraud prevention, security and compliance | |
| Personal info | Phone number | Required (on the join form) | No | App functionality, Account management | |
| Personal info | Address (merch delivery address) | Optional | No | App functionality | |
| Personal info | Other info (chapter, membership status and dates, introducer, application note, positions, card, attendance, notices, conduct records; optional road name, bio, birthday, licence and first aid expiry, bikes) | Required | No | App functionality, Account management | |
| Financial info | Purchase history (merch orders) | Optional | No | App functionality, Fraud prevention, security and compliance | |
| Financial info | Other financial info (fees, payments members report, receipts; no card or bank numbers) | Required | No | App functionality, Account management, Fraud prevention, security and compliance | |
| Health and fitness | Health info (health or injury reasons for an excused check-in or Big 4 ride, entered by the board) | Optional | No | App functionality | |
| Messages | Other in-app messages (all chats, including the Family chat; reported messages kept for moderation) | Optional | No | App functionality, Fraud prevention, security and compliance | |
| Photos and videos | Photos | Optional | **Yes** (public club website) | App functionality, Advertising or marketing | Advertising or marketing |
| Photos and videos | Videos | Optional | No | App functionality | |
| Audio | Voice or sound recordings (voice notes) | Optional | No | App functionality | |
| Files and docs | Files and docs (route files, Otter transcript text) | Optional | No | App functionality | |
| Contacts | Contacts (emergency contacts and the member's block list) | Optional | No | App functionality | |
| App activity | App interactions (chat read markers, daily question counts, Maps SDK map moves) | Required | **Yes** (Google, Maps SDK) | App functionality, Analytics | Analytics |
| App activity | In-app search history (GIF search words) | Optional | **Yes** (GIPHY) | App functionality | App functionality |
| App activity | Other user-generated content (listings, build threads, nominations, app-made rides, routes, Rusty Bus, charity sign-ups, reviews, captions, feedback text, Ask the club questions) | Optional | No | App functionality | |
| App activity | Other actions (RSVPs, check-ins, votes, reactions, blocks, pins, sign-offs, notification settings) | Required | No | App functionality | |
| App info and performance | Crash logs (Expo's error from a failed update launch; Maps SDK crash traces) | Required | **Yes** (Google, Maps SDK) | App functionality, Analytics | Analytics |
| App info and performance | Diagnostics (app version, build and device on feedback reports and sign-in logs; Maps SDK and ML Kit device and usage details) | Required | **Yes** (Google: Maps SDK and ML Kit) | App functionality, Analytics, Fraud prevention, security and compliance | Analytics, App functionality |
| Device or other IDs | Device or other IDs (Expo install ID, Firebase installation ID, push tokens, Maps SDK ID, ML Kit install ID) | Required | **Yes** (Google: Maps SDK ID and ML Kit install ID) | App functionality, Analytics | Analytics |

Not collected: Calendar events, Fitness info, Web browsing history, Other app performance data, User
payment info, Credit score, Race and ethnicity, Political or religious beliefs, Sexual orientation, Emails,
SMS or MMS, Music files, Other audio files, Installed apps.

## Apple: App Privacy (App Store Connect)

**iOS privacy manifest:** `app.json` (`ios.privacyManifests`) lists every row of the table below
(Coarse Location, Health and Product Interaction added, and Developer's Advertising on Photos or
Videos, 14/11/2026). `src/appConfig.test.ts` fails if the two drift apart.

**Do you or your third-party partners collect data from this app?** Yes.
**Tracking:** No data is used to track you. (No App Tracking Transparency prompt needed.)

Every type below: **Linked to the user: Yes. Used for tracking: No. Purpose: App Functionality**
(plus Product Personalization: No, Analytics: No, Advertising: No, Developer's Advertising: No,
Other Purposes: No), unless the row says otherwise.

| Apple category | Data type | Notes |
|---|---|---|
| Contact Info | Name | |
| Contact Info | Email Address | Sign-in |
| Contact Info | Phone Number | |
| Contact Info | Physical Address | Merch orders with shipping; saved to the profile if the member ticks "Save for next time" |
| Location | Precise Location | Live ride only; latest position only, deleted when sharing stops |
| Location | Coarse Location | A live ride when the rider turned Precise Location off; the app still shares the rough position |
| Financial Info | Other Financial Info | Fees, payments members report, receipts |
| User Content | Photos or Videos | Purposes: App Functionality, plus Developer's Advertising or Marketing (club-chat photos the crew puts on the public club website) |
| User Content | Audio Data | Voice notes |
| User Content | Emails or Text Messages | Club chat messages (Apple counts in-app messages here) |
| User Content | Other User Content | Listings, build threads, nominations, app-made rides, routes, Rusty Bus bookings, charity sign-ups, website photo captions, RSVPs and sign-offs |
| User Content | Customer Support | Feedback and issue reports: the text, where in the app, an optional screenshot |
| Search History | Search History | GIF search words, sent to GIPHY. **Linked to the user: No** (GIPHY gets no account details) |
| Identifiers | User ID | |
| Other Data | Other Data Types | Road name, bio, birthday (day and month), bikes and registrations, licence and first aid expiry, membership records, emergency contacts (other people's details) |
| Purchases | Purchase History | Club merch orders: item, size, quantity, price, status. Paid outside the app by PayID, bank or cash; no payment details |
| Diagnostics | Crash Data | **Linked to the user: No.** When an update fails to launch, the Expo updates client sends that error and a random install id on its next update check. Tracking: No. Purpose: App Functionality |
| Health and Fitness | Health | Health or injury reasons for an excused check-in or Big 4 ride, entered by the member's board |
| Usage Data | Product Interaction | How far each member has read in each chat, and each member's daily count of Ask the club and Catch me up questions |
| Diagnostics | Other Diagnostic Data | App version, build and device/OS attached to a feedback or issue report |

Not collected: Fitness, Sensitive Info, Contacts (address book; Apple's definition includes "social
graph", which a block list arguably is, but it's kept as not collected), Browsing History, Usage Data
other than Product Interaction, Device ID (the push token isn't an advertising or device identifier, and
the Expo install ID is per install, not per device; Firebase, ML Kit and the Google Maps SDK aren't on
iPhone).
Within Diagnostics, Performance Data is not collected (Crash Data and Other Diagnostic Data are
declared above).

**Permission prompts** (already in `app.json`, matching the policy): camera, photos, microphone,
location when in use, location always (live ride, switches off after the ride). Apple will ask why the
app uses background location: "During a live ride, the riders sharing on that ride see each other on
the map with the phone in a pocket or on the bike. It switches itself off when the ride ends."
