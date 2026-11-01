# Store privacy answers (Google Play data safety, Apple privacy labels)

Drafted 31/10/2026 from the same audit as the privacy policy (`src/domain/privacyPolicy.ts`).
Keep the three in step: when the app starts collecting something new, change the policy, then these.

- **Privacy policy URL (both stores):** https://www.rustnutssmc.com.au/app/privacy.html
- **Support URL (both stores):** https://www.rustnutssmc.com.au/app/support.html
- **Account deletion web link (Google Play asks for one):** https://www.rustnutssmc.com.au/app/delete-account.html
  (in the app: Me, Delete my account; without the app: email apps@rustnutssmc.com.au).
- The old GitHub Pages addresses (treasurerrustnutssmc-del.github.io/RUSTNUTS-APP/…) stay up and point to these.
- **Contact email:** apps@rustnutssmc.com.au

Rules used for both forms:
- Nothing is used for advertising, analytics or tracking. No ad SDKs, no analytics SDKs.
- The services the app uses (Supabase, Expo, Firebase Cloud Messaging, Apple Push, LiveKit, Open-Meteo,
  Gmail for sign-in codes) work for the club as service providers, which both stores say is not
  "sharing". GIPHY is the exception: its API terms let it use data for its own purposes, so the GIF
  search words are declared as shared (App activity: In-app search history) on Google Play. Members seeing each other's posts is the app's purpose, which Google treats as not sharing
  ("user-initiated").
- Ask the club sends a member's question, the chat so far and a summary of what they can already see
  in the app to Anthropic (Claude) to answer. Anthropic works for the club as a service provider and
  doesn't train on it. The club doesn't store the questions or answers (only a daily count per member),
  so on Google Play it's "processed ephemerally" under Other user-generated content.
- Draft from Otter sends a meeting's transcript (pasted or picked from the secretary's Otter.ai export),
  the agenda and the names of members who could have been there to Anthropic to draft minutes. The club
  keeps only the minutes the board saves (already declared with meeting minutes), not the transcript, so
  it's the same "processed ephemerally" line. No audio leaves Otter.
- Ride comms voice is live and never stored, so it isn't "collected" (Apple) and is "processed
  ephemerally" (Google). Weather lookups send the ride's route (plus the phone's IP address) to Open-Meteo.

## Google Play: Data safety form

**Overview questions**

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes |
| Which ways can users request that their data is deleted? | In the app (Me, Delete my account) and on the web (the deletion link above, by email). |
| Independent security review | No |
| Target audience | 18 and over (not designed for children; the policy says the same) |

**Data types** (Collected: Yes. Shared: No for every row. All purposes "App functionality"; "Account
management" where marked.)

| Category | Data type | Required or optional | Ephemeral? | Purposes |
|---|---|---|---|---|
| Location | Precise location | Optional (live ride only) | No (latest position only, deleted when sharing stops; alerts kept until the ride's live window closes) | App functionality |
| Personal info | Name | Required | No | App functionality, Account management |
| Personal info | Email address | Required | No | App functionality, Account management |
| Personal info | User IDs | Required | No | App functionality, Account management |
| Personal info | Phone number | Required (on the join form) | No | App functionality, Account management |
| Personal info | Other info (road name, bio, birthday day/month, licence and first aid expiry, emergency contacts, bikes and registrations) | Optional | No | App functionality |
| Financial info | Other financial info (fees charged, payments the member reports, receipts; no card or bank numbers) | Required for members | No | App functionality, Account management |
| Messages | Other in-app messages | Optional | No | App functionality |
| Photos and videos | Photos | Optional | No | App functionality |
| Photos and videos | Videos | Optional | No | App functionality |
| Audio | Voice or sound recordings (voice notes; ride comms is live only) | Optional | No | App functionality |
| Files and docs | Files and docs (ride route files the crew uploads) | Optional | No | App functionality |
| App activity | Other user-generated content (listings, build threads, nominations, RSVPs, votes, sign-offs) | Optional | No | App functionality |
| App activity | In-app search history (GIF search words, sent to GIPHY) | Optional | Yes (not stored by the club) | App functionality. **Shared: Yes** (GIPHY) |
| Device or other IDs | Device or other IDs (push notification token) | Optional (only if notifications are allowed) | No | App functionality |
| App info and performance | Crash logs (the Expo updates client sends the previous launch's fatal JS error text and a random install id when it checks for updates; no crash SDK) | Optional | No | App functionality |
| Financial info | Purchase history (club merch orders: item, size, quantity, price, status; paid outside the app by PayID, bank or cash) | Optional (only if the member orders merch) | No | App functionality |

Not collected: Contacts, Calendar, Health and fitness, Web browsing, App info and performance
(Diagnostics and Other app performance data; crash logs are declared above), Credit info,
Race/ethnicity, Political or religious beliefs, Sexual orientation, SMS, Emails, Music files,
Installed apps.

## Apple: App Privacy (App Store Connect)

**Do you or your third-party partners collect data from this app?** Yes.
**Tracking:** No data is used to track you. (No App Tracking Transparency prompt needed.)

Every type below: **Linked to the user: Yes. Used for tracking: No. Purpose: App Functionality**
(plus Product Personalization: No, Analytics: No, Advertising: No, Developer's Advertising: No,
Other Purposes: No).

| Apple category | Data type | Notes |
|---|---|---|
| Contact Info | Name | |
| Contact Info | Email Address | Sign-in |
| Contact Info | Phone Number | |
| Location | Precise Location | Live ride only; latest position only, deleted when sharing stops |
| Financial Info | Other Financial Info | Fees, payments members report, receipts |
| User Content | Photos or Videos | |
| User Content | Audio Data | Voice notes |
| User Content | Emails or Text Messages | Club chat messages (Apple counts in-app messages here) |
| User Content | Other User Content | Listings, build threads, nominations, routes |
| Search History | Search History | GIF search words, sent to GIPHY. **Linked to the user: No** (GIPHY gets no account details) |
| Identifiers | User ID | |
| Other Data | Other Data Types | Road name, bio, birthday (day and month), bikes and registrations, licence and first aid expiry, membership records, emergency contacts (other people's details) |
| Purchases | Purchase History | Club merch orders: item, size, quantity, price, status. Paid outside the app by PayID, bank or cash; no payment details |
| Diagnostics | Crash Data | **Linked to the user: No.** The Expo updates client sends the previous launch's fatal JS error text and a random install id when it checks for updates. Tracking: No. Purpose: App Functionality |

Not collected: Health and Fitness, Sensitive Info, Contacts (address book), Browsing History,
Usage Data, Device ID (the push token isn't an advertising or device identifier), Coarse Location.
Within Diagnostics, Performance Data and Other Diagnostic Data are not collected (only Crash Data,
above).

**Permission prompts** (already in `app.json`, matching the policy): camera, photos, microphone,
location when in use, location always (live ride, switches off after the ride). Apple will ask why the
app uses background location: "During a live ride, the riders sharing on that ride see each other on
the map with the phone in a pocket or on the bike. It switches itself off when the ride ends."
