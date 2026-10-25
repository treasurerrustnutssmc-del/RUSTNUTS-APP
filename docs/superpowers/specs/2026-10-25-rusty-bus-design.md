# Rusty Bus booking (Stage 2, part 6)

**Type:** architectural. It adds a table, new database actions and new screens.

This is lane A of the parallel build, so its migration uses the `20261025170000` prefix. Claude approved this spec on 25 Oct 2026 under Jeff's standing rule, and Jeff can veto any line. The lines marked *inferred* are the ones most worth a look.

## Goal
The Rusty Bus is the club van, used for charity rides and vehicle recovery. Today, booking it means asking around in a group chat. In the app, members will:
- see when the bus is free
- ask for it for the days they need
- get a yes from the board.

A breakdown can't wait for a meeting, so a recovery for today or tomorrow is booked on the spot when the bus is free.

## Words
- **Booking:** the bus for whole Melbourne days, from a first day to a last day (at most 14 days). Each booking has:
  - a purpose: **Charity ride**, **Recovery**, **Club event** or **Other**
  - an optional ride from the calendar
  - a driver, who is an approved member
  - notes (at most 500 characters)
  - a status: **Waiting**, **Booked**, **Declined** or **Cancelled**
- **Bus managers:** the NEC (`isNational`), plus anyone with a board seat in any chapter. They say yes or no. *Inferred:* the club has one bus, so any board can manage it. A dedicated "bus keeper" position can come later.
- **Who can book:** approved Full and Nomad members, plus bus managers. *Inferred:* the same group who can crew a ride.
- **Booked straight away:** a booking skips Waiting and becomes Booked when either of these is true:
  - a bus manager makes it
  - it's a Recovery whose first day is today or tomorrow.

  Every other booking waits for a manager.
- **Clash:** two Booked bookings can never share a day. Waiting bookings may overlap each other and Booked ones. Whichever is approved first wins, and a later approval that would clash is refused.

## Rules (`src/domain/bus.ts`, mirrored by the database with the same words and order)
1. **Visibility:** approved members see every booking, including its purpose, driver, ride and notes. Applicants and the public see nothing.
2. **Booking** checks these, in order:
   1. `Sign in first.`
   2. `Only approved members can do that.`
   3. Not Full, Nomad or a bus manager: `Only Full and Nomad members can book the Rusty Bus.`
   4. A day missing or not a real date: `Pick the first and last day.`
   5. Last before first: `The last day can’t be before the first.`
   6. First day before today: `Bookings can’t start in the past.`
   7. More than 14 days: `Keep a booking to 14 days at most.`
   8. First day more than 12 months after today: `Book at most 12 months ahead.`
   9. No purpose: `Pick what it’s for.`
   10. A ride that doesn't exist or is cancelled: `That ride isn’t on the calendar.`
   11. A driver who isn't an approved member: `Pick a driver who’s an approved member.`
   12. Notes over 500 characters: `Keep the notes to 500 characters at most.`
   13. It would be Booked straight away but clashes: `The Rusty Bus is already booked then.`

   A Waiting booking may overlap a Booked one. The booker sees the clash on the form, but asking is still allowed.
3. **Deciding (yes or no)** checks these, in order:
   1. sign in
   2. approved
   3. `Only the board or NEC can say yes or no to Rusty Bus bookings.`
   4. `No such booking.`
   5. Not Waiting: `That booking has already been decided.`
   6. Its last day is before today: `That booking’s days have passed.`
   7. A yes that clashes with a Booked one: `The Rusty Bus is already booked then.`
   8. A no with a reason over 300 characters: `Keep the reason to 300 characters at most.`
4. **Cancelling** checks these, in order:
   1. sign in
   2. approved
   3. `No such booking.`
   4. Not the booker, not the driver and not a bus manager: `Only whoever booked it, its driver or the board can cancel it.`
   5. Already Declined or Cancelled: `That booking is already off.`
   6. Its last day is before today: `That booking’s days have passed.`
5. **Texts** are trimmed with JS `trim()` in the app and `private.trim_like_app` in the database. Lengths count code points.
6. **Today** is the Melbourne date (`private.club_date()`).

## Screens
- **Rusty Bus** (stack screen `Bus`). It's opened from a "Rusty Bus" row at the top of the Rides list, next to the Route library row, and from the ride screen's bus chip.
  1. A header card with "Free today" or "Out today: <purpose>, <driver>", plus a big **Book the Rusty Bus** button for people who can book.
  2. **For managers:** a "Waiting for a yes" section. Each row has the dates, the purpose, who booked it, and any clash in amber ("Clashes with Recovery 03/11/2026"). It opens the booking.
  3. **Coming up:** Booked and Waiting bookings from today on, grouped by month. Each row has the dates (DD/MM/YYYY, or one date for a single day), the purpose, the driver and a status chip (Booked in green, Waiting in amber). A linked ride shows its title.
  4. **Yours:** your own Declined and Cancelled bookings from the last 30 days, so a no doesn't just vanish.
- **Booking** (stack screen `BusBooking { bookingId }`):
  - dates, purpose, driver, ride (which opens the ride), notes, who booked it and when, and the status, with the reason if declined
  - managers on a Waiting booking: **Say yes**, plus **Say no** with an optional reason field
  - anyone allowed: **Cancel booking**, using `ConfirmButton`
  - errors inline in a live region.
- **Book the Rusty Bus** (stack screen `BookBus { rideId?: string }`):
  - first and last day, typed DD/MM/YYYY like the other date fields
  - purpose chips
  - "For a ride?": a picker of calendar rides in those days, prefilled when opened from a ride
  - driver: you by default, or **Pick someone else** from approved members
  - notes
  - a live clash line that names the Booked booking it hits
  - **Book it**, labelled **Ask for it** when it will wait
  - after saving, the new booking opens.
- **Ride screen:** a chip "Rusty Bus booked" (or "Rusty Bus asked for" while Waiting) when a booking links to the ride and isn't off. Writers of the ride (crew managers) also get a **Book the Rusty Bus** link prefilled with the ride.

No Alert dialogs. Labels, names, buttons, numbers and dates use Rustnuts Stencil. Theme tokens only. Checked at 390×844.

## Data (new migration `20261025170000_rusty_bus.sql`)
- **Enums:**
  - `public.bus_purpose`: `charity_ride`, `recovery`, `club_event`, `other`
  - `public.bus_status`: `requested`, `approved`, `declined`, `cancelled`
- **`public.bus_bookings`:**
  - `id uuid primary key default gen_random_uuid()`
  - `first_day date not null`, `last_day date not null`, with checks that last ≥ first and last − first ≤ 13
  - `purpose public.bus_purpose not null`
  - `ride_id uuid references rides on delete set null`
  - `driver_id uuid references members on delete set null`
  - `notes text`, checked ≤ 500 characters
  - `status public.bus_status not null`
  - `booked_by` (references members, on delete set null) and `booked_at timestamptz not null default now()`
  - `decided_by` and `decided_at`
  - `decline_reason`, checked ≤ 300 characters
  - `cancelled_by` and `cancelled_at`
  - **Exclusion constraint:** `exclude using gist (daterange(first_day, last_day, '[]') with &&) where (status = 'approved')`, so the database itself can never double-book.
- **Row-level security:** approved members can select. There are no writes through the API.
- **Actions** (SECURITY DEFINER, `search_path = ''`, authenticated only). Each one takes `pg_advisory_xact_lock(hashtext('rusty_bus'))` right after the sign-in and approved checks.
  - `book_bus(p_first date, p_last date, p_purpose public.bus_purpose, p_ride uuid, p_driver uuid, p_notes text) returns uuid`
  - `decide_bus(p_booking uuid, p_yes boolean, p_reason text) returns void`
  - `cancel_bus(p_booking uuid) returns void`
- **Helper:** `private.manages_bus()`.
- **Loading:** the live app reads `bus_bookings` with a plain select, in the same pass as routes and the Road Rules.
- **No `drop` and no `delete from`.**

## App
- **Types:**
  - `BusBooking { id; firstDay; lastDay; purpose; rideId: string | null; driverId: string | null; notes: string; status; bookedBy: string | null; bookedAt; decidedBy: string | null; decidedAt: string | null; declineReason: string; cancelledBy: string | null; cancelledAt: string | null }`
  - `ClubData.busBookings?`
- **Context:**
  - `bookBus(input): Promise<string>`, where input is `{ firstDay, lastDay, purpose, rideId, driverId, notes }`
  - `decideBus(id, yes, reason): Promise<void>`
  - `cancelBus(id): Promise<void>`

  Each checks the app rules first. Live then calls `rpc` and reloads.
- **Domain** (`src/domain/bus.ts`):
  - message constants and limits
  - `managesBus(me, data)`, `canBookBus(me, data)`
  - `bookProblem(me, input, data, today)`, `bookedStraightAway(me, input, today)`
  - `decideProblem(me, booking, yes, reason, data, today)`, `cancelProblem(me, booking, data, today)`
  - `clashesWith(range, data, exceptId?)`, `busToday(data, today)`
  - `upcomingBus(data, today)`, grouped by month
  - `waitingForYes(data)`, `myRecentOff(me, data, today)`
  - `busForRide(rideId, data)`
  - `formatDays(first, last)`
- **Demo data:**
  - A Booked charity ride booking on ride r-3, or on any charity ride in the demo calendar. If there isn't one, it links to no ride.
  - A Booked recovery for today, driven by Diesel.
  - A Waiting club-event request from Spanner that clashes with the charity booking.
  - A Declined request of Spanner's from last week, with a reason.

  All dates count back or forward from the real today.
- **Navigation:** `Bus`, `BusBooking { bookingId }`, `BookBus { rideId?: string }`.

## Tests
- **`npm test`:**
  - `bus.test.ts`: every message and its order for book, decide and cancel; booked-straight-away (manager, recovery today, recovery tomorrow, recovery in 3 days); clashes, including touching days and single days; the 14-day and 12-month edges; the groupings.
  - demo actions
  - live mapping
- **`npm run test:db`** (`supabase/tests/rusty_bus_test.sql`):
  - the same rules and order
  - the exclusion constraint refusing a direct double booking
  - the advisory lock
  - no API writes
  - applicants and anon read nothing
- **`parity.json`:**
  - book cases: a member asking, a recovery booked straight away, a clash on straight away, a past start, an FNG refused
  - decide cases: a yes, a clashing yes, a non-manager
  - cancel cases: by the booker, by a stranger, already off
- **Screens:** all three screens and the ride chip, at 390×844 in the demo build, followed by the Impeccable passes.

## Not in this spec
- Times of day (bookings are whole days).
- Keys, odometer, fuel and running costs. That's a log for the treasurer, later.
- Who may drive by licence class. The app only stores motorcycle licences, so the board judges the driver when it says yes.
- A trailer as a separate bookable thing.
- Push notices to managers about a waiting booking. That's lane E's push.
- Charging for use.
