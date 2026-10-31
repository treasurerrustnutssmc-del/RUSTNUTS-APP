# Store privacy answers (Google Play data safety, Apple privacy labels)

Drafted 31/10/2026 from the same audit as the privacy policy (`src/domain/privacyPolicy.ts`).
Keep the three in step: when the app starts collecting something new, change the policy, then these.

- **Privacy policy URL (both stores):** https://treasurerrustnutssmc-del.github.io/RUSTNUTS-APP/privacy.html
- **Account deletion web link (Google Play asks for one):** https://treasurerrustnutssmc-del.github.io/RUSTNUTS-APP/privacy.html#choices
  (deletion is by email to apps@rustnutssmc.com.au for now).
- **Release blocker:** the app lets people make an account, so Apple (guideline 5.1.1(v)) and Google both
  require a way to start account deletion inside the app. Email-only deletion will likely be rejected.
  In-app account deletion must be built before submitting.
- **Contact email:** apps@rustnutssmc.com.au

Rules used for both forms:
- Nothing is used for advertising, analytics or tracking. No ad SDKs, no analytics SDKs.
- The services the app uses (Supabase, Expo, Firebase Cloud Messaging, Apple Push, LiveKit, Open-Meteo,
  Gmail for sign-in codes) work for the club as service providers, which both stores say is not
  "sharing". GIPHY is the exception: its API terms let it use data for its own purposes, so the GIF
  search words are declared as shared (App activity: In-app search history) on Google Play. Members seeing each other's posts is the app's purpose, which Google treats as not sharing
  ("user-initiated").
- Ride comms voice is live and never stored, so it isn't "collected" (Apple) and is "processed
  ephemerally" (Google). Weather lookups send the ride's route (plus the phone's IP address) to Open-Meteo.

## Google Play: Data safety form

**Overview questions**

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes |
| Which ways can users request that their data is deleted? | "You provide a way for users to request that their data is deleted" (by email, with the web link above). Change to "in-app" too once account deletion is built. |
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

Not collected: Contacts, Calendar, Health and fitness, Web browsing, App info and performance (no crash
or diagnostics SDK), Purchase history, Credit info, Race/ethnicity, Political or religious beliefs,
Sexual orientation, SMS, Emails, Music files, Installed apps.

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

Not collected: Health and Fitness, Sensitive Info, Contacts (address book), Browsing History,
Purchases, Usage Data, Diagnostics, Device ID (the push token isn't an advertising or device
identifier), Coarse Location.

**Permission prompts** (already in `app.json`, matching the policy): camera, photos, microphone,
location when in use, location always (live ride, switches off after the ride). Apple will ask why the
app uses background location: "During a live ride, the riders sharing on that ride see each other on
the map with the phone in a pocket or on the bike. It switches itself off when the ride ends."
