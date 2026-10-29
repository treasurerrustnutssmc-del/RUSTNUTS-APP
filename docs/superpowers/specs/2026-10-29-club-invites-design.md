# Invites to and from other clubs

**Type:** architectural (two new tables, six database actions, new screens). Ambition list, "the
wild ones": *Invites to and from other clubs for public events*. Jeff said "Start everything you
can" on 29 Oct 2026; Claude approves its own spec (Jeff's standing call) and Jeff can veto.

## Goal

Other clubs ask Rustnuts to their rides and events, and Rustnuts asks other clubs to its own. Today
that lives in someone's Messenger and gets lost. The app keeps it in one place:

- **Invites in.** Any member who hears of an invite passes it on in the app. The board (or Ride
  Committee) answers for the club: going or not, and if going, whether it goes on the club calendar
  as a **Supported Club Ride** or a **Non-Nuts Event** (the website's two labels for other clubs'
  events). Once the event shows up on the calendar, it's linked, so the ride and the invite point at
  each other.
- **Invites out.** From one of the club's own rides (North, West or Rustnuts), the board or Ride
  Committee invites another club. The app writes the invitation text; the member sends it themselves
  through the phone's share sheet. Their reply (coming, how many bikes, not coming) is recorded.
- **A list of other clubs**: name, town, how to reach them, a note. Reused by every invite.

## Hard rule: the app sends nothing outside the club

The app is secret until the 2027 AGM. Nothing here emails, texts, pushes or posts. Invitations and
replies are **text the member shares themselves** (the share sheet, or a copy box on the web, like
"Share this ride"). The texts never mention the app.

## Who can do what (mirrored in the domain and the database, same words, same order)

"Managers" are the existing ride managers:

- an incoming invite's managers: `managesChapterRides(me, invite.chapterId)` /
  `private.manages_chapter_rides(chapter_id)` (that chapter's board or Ride Committee, or the NEC;
  for a whole-club invite, any chapter's board or Ride Committee);
- an outgoing invite's managers: `managesRide(me, ride)` / `private.manages_ride(ride_id)`.

| Action | Who |
|---|---|
| Read clubs and invites | Every approved member (archived rows hidden) |
| Add a club | Any approved member |
| Change or take off a club | Any chapter's board or Ride Committee, or the NEC (`managesChapterRides(me, null)`), or whoever added it |
| Pass on an invite (in) | Any approved member |
| Change an incoming invite | Its managers; or whoever passed it on, while it's unanswered |
| Invite a club to a ride (out) | The ride's managers |
| Answer an invite (either way) | Its managers |
| Take an invite off | Its managers; or whoever passed it on, while it's unanswered |

## Data (migration `20270545000000_club_invites.sql`)

- `public.other_clubs`: `id`, `name` (1–80, unique among clubs on the list, case-insensitive),
  `town` (≤60), `contact` (≤200: who to talk to, phone, Facebook page), `note` (≤300), `added_by`,
  `added_at`, `updated_at`, `archived_at`, `archived_by`.
- `public.invite_direction` enum `in`, `out`; `public.invite_answer` enum `waiting`, `yes`, `no`.
- `public.club_invites`:
  - `id`, `direction`, `club_id` → other_clubs, `chapter_id` (null = the whole club).
  - `ride_id` → rides (out: required; in: optional link once it's on the calendar).
  - In only: `title` (1–80), `event_on` (date), `place` (≤120), `details` (≤1000).
  - `answer` (default `waiting`), `calendar_label` (`supported` / `non_nuts`, only on an incoming
    yes), `bikes` (1–500, only on an outgoing yes, optional), `note` (≤300).
  - `added_by`, `added_at`, `answered_by`, `answered_at`, `archived_at`, `archived_by`.
  - One open outgoing invite per ride and club (partial unique index).
- RLS: approved members select rows with `archived_at is null`. No writes through the API.
- Nothing is ever deleted: taking off archives, with who did it. No "drop" anywhere.

### Actions

1. `save_other_club(p_id, p_name, p_town, p_contact, p_note) → uuid`
2. `archive_other_club(p_id)`
3. `save_invite_in(p_id, p_club, p_chapter, p_title, p_event_on, p_place, p_details, p_ride) → uuid`
   - The date must be today or later (Melbourne), unless it's unchanged on an edit.
   - A linked ride must be a Supported or Non-Nuts ride, not cancelled, on the event's Melbourne date.
4. `invite_club(p_ride, p_club, p_note) → uuid`
   - The club's own rides only (North, West, Rustnuts), not cancelled, last day not passed; the club
     not already invited to that ride. The invite's chapter is the ride's.
5. `answer_invite(p_id, p_answer, p_label, p_bikes, p_note)`
   - An incoming yes needs a calendar label; `bikes` only counts on an outgoing yes; anything else
     stores nulls. Answering `waiting` clears who answered.
6. `archive_invite(p_id)`

Refusal words live as constants in `src/domain/invites.ts`; the SQL raises the same strings.

## The calendar tie-in (`src/domain/invites.ts`, no database)

- `calendarState(invite, rides)`:
  - linked → "On the club calendar" (opens the ride);
  - incoming yes, not linked → "Put it on the club calendar as Supported Club Rides" (or
    Non-Nuts Events), with **suggested rides**: same Melbourne date, the chosen label, not
    cancelled, not already linked to another open invite. A manager taps one to link it.
- `invitesForRide(rideId, invites)`: on a ride, the incoming invite(s) it came from, and for the
  club's own rides the clubs invited and their replies.
- Share texts:
  - `invitationText(ride, club, chapters)`: "G'day <club>. Rustnuts SMC West would love you to join
    us for <title>, Sat 07/11/2026 8:30 am, <place>. Let us know if you're coming and roughly how
    many bikes. Cheers, Rustnuts SMC."
  - `replyText(invite, club, chapters)`: thanks plus "will be there" / "can't make this one" / "we'll
    let you know soon", by answer.

## Screens (`src/screens/invites.tsx`)

- **Rides tab:** an "Other clubs" row under Rusty Bus: "2 invites waiting for an answer" (managers)
  or "Invites to and from other clubs".
- **Other clubs** screen, three views (Choices): *Invites in* (upcoming, waiting first, then
  earlier ones), *Invites out* (by ride), *Clubs* (the list). Buttons: "Pass on an invite",
  "Add a club".
- **Invite** screen (either direction): the club, the event (date in stencil, place, details), who
  passed it on, the answer chip, the calendar state with suggestions, the share button for the
  invitation or reply text, and for managers the answer form (Choices for the answer and the
  label; bikes; note), Change, Take off (ConfirmButton).
- **Pass on / change an invite**: club picker (rows, with "Add a club"), whose invite (chapter or
  whole club), name, date (DD/MM/YYYY), place, details.
- **Invite a club** (from a ride): pick a club not yet invited, optional note, preview of the
  invitation text, "Share and record" (records then opens the share sheet; on the web a copy box).
- **Club** screen: details, its invites both ways; Change / Take off for those allowed.
- **Edit club**.
- **Ride screen:** one `RideInvitesSection` line: incoming invites the ride came from, or the clubs
  invited with their replies and "Invite another club" for managers.

Everything follows DESIGN.md: stencil for titles, names, chips, dates and buttons; body font for
sentences and inputs; 44pt targets; no Alert (ConfirmButton); dates DD/MM/YYYY.

## Data plumbing

The social provider (`src/data/social/`) gains `otherClubs`, `invites` and the six actions (demo
and live), loaded per table so a missing table leaves only this part empty. Demo data: three made-up
clubs, two invites in (one answered and linked to the demo Toy Run), one out on a demo club ride.

## Tests

- `npm test`: `src/domain/invites.test.ts` (every refusal, the calendar state and suggestions, share
  texts, grouping), demo action tests, live row mapping.
- `npm run test:db`: shared parity cases in `parity.json` for all six actions (allowed and each
  refusal), plus `supabase/tests/club_invites_test.sql` for RLS (anon and applicants see nothing,
  archived rows hidden, no direct writes) and the partial unique index.
- A look at the changed screens at 390×844 in the demo build, plus the Impeccable passes by hand.

## Not in this spec

- Sending anything to another club from the app, or another club using the app. After the reveal.
- Putting events on the website calendar from the app (the calendar is still read from the
  website's Google calendar; the board adds the event there with the label).
- Push or reminders about unanswered invites (push is held until launch).
