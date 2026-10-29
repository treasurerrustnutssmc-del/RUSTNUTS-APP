# Charity ride sign-ups (29 Oct 2026)

Self-approved by Claude under Jeff's standing rule (24 Oct 2026). Jeff can veto any ruling below.

**Kind of work:** bounded, with one new migration (`20270520000000_charity_signups.sql`). It follows the
event hub's shape (`hubs.ts`, `save_hub`, `register_hub`, `withdraw_hub`) so the two read alike.

## What it's for

The club runs and supports charity rides (Ride for Kids, the Toy Run, other clubs' runs). The committee
needs to know who's riding, how many pillions and friends are coming, and who'll help on the day
(BBQ, marshals, collection buckets, the Rusty Bus). Today that's a Messenger thread and a head count.

The event hub doesn't fit: it's about beds, it's members-only by default, and it has no guests or jobs.
So a charity ride gets its own sign-up sheet.

## What it is

- **Make it a charity ride** (on the ride screen) for the ride's crew managers (`managesRide`: the
  chapter board, ride committee, NEC) **and the Charity Committee**. Settings:
  - **Raising money for** (required, 120 characters): the cause, "Royal Children's Hospital".
  - **About** (optional, 1000): what to bring, where the money goes, the other club's details.
  - **Sign-ups close** (optional day, from today up to the ride day; one already set can stay).
  - **Places** (optional, 1 to 2000): people on bikes, counting riders, pillions and guests.
  - **Helper jobs** (up to 8, 40 characters each, each once): BBQ, Marshal, Collection bucket.
    A job can't come off the list while someone's signed up for it.
  - Changes stop at the end of the ride day; a cancelled ride can't change.
- **Sign up** for any approved member (charity rides are open to Supporters and Family too):
  - **Riding** (yes/no), **Bringing a pillion** (only when riding), **Guests** (0 to 10, friends who
    aren't in the app) and their names (200), **Helping with** one job (or none), notes (200).
  - You must ride or help. Over the places left is refused. Sign-ups close at the ride's start (all-day:
    end of its first day) or after the closing day.
  - **Withdraw** until the ride starts; signing up again brings the row back.
  - Signing up doesn't change your ride answer. Riding but not Going gets "Say Going on the ride too",
    as the hub does (the Road Rules Going gate stays where it is).
- **Who's coming:** riders (with pillion and guest counts), then helpers by job. Everyone approved sees it.
- **Run it:** managers get **Share the list** (plain text for the organisers) and **Edit**.
- **Rides list:** a ride with sign-ups gets a "Charity" chip.
- **No notifications** of any kind (Jeff hasn't OK'd member notifications).

## Donations: the later hook

No money moves here. The charity screen shows a quiet line: "Donations come later, once the app can
take payments. Give on the day for now." When payments land (PayID, then card), a donation is a payment
against the charity ride, recorded in the ledger under a charity code and passed on. The club's bank
details and PayID already sit in the fees settings (`payment_details`, per chapter), so the donate button reads
from there. That needs Jeff's yes (money), and nothing in this build assumes how.

## Rules (`src/domain/charity.ts`, mirrored by the database with the same words and order)

`save_charity(ride, cause, about, closes_on, places, jobs)`:
1. `Sign in first.` / `Only approved members can do that.`
2. `No such ride.` 3. `That ride was cancelled.`
4. After the ride day: `Sign-ups can’t change after the ride day.`
5. Not a manager or the Charity Committee: `Only the board, ride committee, charity committee or NEC can run sign-ups.`
6. Blank cause: `Say who the ride is raising money for.`
7. `That’s too long: 120 characters for the cause, 1000 for the rest.`
8. `Places: 1 to 2000, or leave it blank.`
9. Jobs (trimmed, blanks dropped): over 8 or over 40 characters: `Up to 8 helper jobs, 40 characters each.`; a repeat (ignoring case): `Each job once.`
10. A job dropped while someone's on it: `Someone’s helping with “<job>”, so keep that job.`
11. `Pick a closing day from today up to the ride day.`

`sign_up_charity(ride, riding, pillion, guests, guest_names, job, notes)`:
1. Signed in and approved. 2. `No such ride.` 3. `That ride was cancelled.`
4. `This ride doesn’t take sign-ups.` 5. `Sign-ups have closed.`
6. Not riding and no job: `Say you’re riding, or pick a job to help with.`
7. Pillion without riding: `A pillion needs a rider: say you’re riding too.`
8. `Guests: 0 to 10.` 9. `That job isn’t on the list.`
10. `Keep it short: 200 characters for guests’ names, 200 for notes.`
11. Places: (riding + pillion + guests) on top of everyone else's goes over: `The ride’s full.`

`withdraw_charity(ride)`: signed in; `No such ride.`; `You’re not signed up.`; after the start `Sign-ups have closed.`

## Database

- `charity_rides (ride_id pk → rides, cause, about, closes_on, places, jobs text[], updated_by, updated_at)`.
- `charity_signups (ride_id → charity_rides, member_id, riding, pillion, guests, guest_names, job, notes,
  signed_at, withdrawn_at, pk (ride_id, member_id))`, with checks that match the limits.
- Written only through the three security-definer actions, which take the ride row lock first like the
  hub. `private.on_charity_committee()` is the committee check. RLS: approved members select; anon nothing.
- Tests: `supabase/tests/charity_signups_test.sql` (incl. the Charity Committee, which the shared
  fixture has no seat for) and shared cases in `supabase/tests/parity.json`.

## Screens

- **Ride screen** (after Registrations): a **Charity ride** card with a heart badge, the cause in stencil,
  the counts ("8 riding · 2 pillions · 3 guests · 4 helping"), chips (You're in / Closes / Full / Closed)
  and **Sign up** (primary when you're not in and it's open, else **Open sign-ups**, secondary). Managers
  with no sheet yet get a one-line offer and **Make it a charity ride** (secondary).
- **Charity ride** screen: cause, about, places left, the donations line; your sign-up form or the reason
  you can't; Withdraw (`ConfirmButton`); Who's coming; Run it (Share the list, Edit).
- **Run sign-ups** screen: the settings above; jobs typed one per line.

## Later

Donations (above); push to people signed up when the ride changes (with push at launch); a public
sign-up link for non-members (needs the public site).
