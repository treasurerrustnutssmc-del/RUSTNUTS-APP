# Family view (29 Oct 2026)

Architectural (it changes who the database lets in everywhere), so a written spec. Claude approved
it; Jeff can veto.

## Why

Family is an app-only status for partners and kids (constitution v4 has no Family category, and 5.8
says a family relationship alone doesn't make someone a Supporter). Until now an approved Family
person was treated like any approved member: the whole directory with shared phone numbers, every
member chat they could reach, presented Treasurer's Reports, the business screens. The club is
"family-oriented" (1.3) and exists partly to "foster friendship, fellowship and support among members
and their families" (1.4), so family get a proper, small view of their own instead.

The demo's own Family applicant says what they want: "Keen to see ride days and come along to the
family BBQs."

## What family see

Three tabs, nothing else:

- **Home:** a welcome, the next few rides and events, and the club links (website, shop, socials).
- **Rides:** the ride calendar from today on (title, date and time, where from, notes, the colour key,
  called off). This is the same calendar the club website shows the public. No RSVP list (that's
  members' names), no crew, routes, briefings, weather or planning, and no Going button.
- **Me:** their profile, their emergency contacts (for when they're on the back of a bike), a
  membership card that says Family (no disc, no dues line), the club links, sign out.

## What family don't see

The member directory and phone numbers, chats (see the open question), photos, the Board tab,
meetings and votes, attendance and standing, fees, the treasurer's books and reports, conduct
records, merch, national, documents, Road Rules sign-off, the Rusty Bus, live ride, ride comms, the
social extras, and notification settings. They also aren't asked to sign the Road Rules, since they
can't say they're Going.

## How it's enforced

The database is the real wall; the app follows it.

- `private.is_approved_member()` now means an approved member who isn't Family. Every policy and
  action already built on it (167 places, and every one other lanes add later) shuts Family out
  without being touched. Board, NEC, money and conduct checks all build on it.
- `private.is_family()` is new: approved and Family.
- `public.family_rides()` is new: the calendar from today on, ride columns only, for Family (empty
  for anyone else, who use `ride_calendar()`).
- Two places that checked `approval = 'approved'` by hand are fixed: `meeting_reports()` (presented
  Treasurer's Reports went to anyone approved who hadn't left) and `open_direct_chat` (a member could
  open a private chat with a Family person: "Family don’t use the club chats.").
- What Family can still do comes from their own-row policies, which never used the helper: read and
  edit their own profile, bikes and emergency contacts.

In the app:

- A new access level, `family`, between `pending` and `member`.
- `forFamily(data, me)` trims the club data to what the database would hand a Family person
  (chapters, their own record, private details, bikes and contacts, rides with no answers), so the
  demo shows exactly what the live build can.
- The navigator gives Family their own tabs (like Pending gets its own screens), so no member screen
  has to remember to hide things.
- The chat rules treat Family as not approved; a private chat with a Family person is refused.
- The demo gets a "Family" persona (Kerry, West).

Migration `20270530000000_family_view.sql`.

## Open question for Jeff

**Chat.** Recommended: no chats for Family for now. It's easy to open the whole-club chat to them
later, and hard to take it back once members have said things there they assumed were members only.
The alternative is Family in the whole-club chat (read and post) and nothing else.

## Later, if wanted

- Link a Family person to their member ("Kerry, Spanner's partner") so they see whether their rider
  is down for a ride.
- Family say they're coming to family days and social rides (as a pillion or in the car), with the
  Road Rules sign-off that 7.1 asks of passengers.
- Live ride "where's my rider" for a linked partner, with the rider's say-so.
- Club photos.
