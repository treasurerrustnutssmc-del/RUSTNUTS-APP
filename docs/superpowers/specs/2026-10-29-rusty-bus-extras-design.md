# Rusty Bus extras: changing a booking, keys, odometer and running costs

**Type:** architectural. It adds three tables, seven database actions, two screens and a mode of the booking form.

This thread's migration prefix is `20270515`. Claude approved this spec on 29 Oct 2026 under Jeff's standing rule, and Jeff can veto any line. Lines marked *inferred* are the ones most worth a look. It builds on `2026-10-25-rusty-bus-design.md` and closes three of that spec's "later" items.

## Goal
1. **Change a booking** instead of cancelling and booking again (which could lose the days held meanwhile).
2. **Keys:** who has the bus keys right now, and who had them before.
3. **Odometer:** readings over time, so the club knows how far the bus goes, and how far each booking took it.
4. **Running costs:** fuel, service, rego and the rest, with a yearly summary for the treasurer.

## Words
- **Bus hands:** who can log keys, km and costs: anyone who can book the bus (Full, Nomad, bus managers), plus **whoever has the keys right now**. *Inferred:* a driver who isn't Full (an FNG on a recovery, say) can still log the fuel they bought while holding the keys.
- **Key holder:** the member named by the newest key handover. Nobody until the first is logged.
- **Reading:** an odometer reading in whole km on a day, optionally tied to a Booked booking.
- **Cost:** money spent on the bus on a day, of a kind: **Fuel**, **Service**, **Repairs**, **Tyres**, **Rego**, **Insurance**, **Tolls**, **Cleaning** or **Other**. Fuel can carry litres.
- **Struck out:** a reading or cost logged by mistake. It stays on the list, crossed through, and counts for nothing. Nothing is ever deleted.
- **Financial year:** July to June, as the books use (`fyOf`).

## Rules
Every action starts with `Sign in first.` then `Only approved members can do that.`, takes the bus lock (`pg_advisory_xact_lock(hashtext('rusty_bus'))`), and uses the Melbourne date as today. Texts are trimmed like the app; lengths count code points; blank texts are stored as none.

### 1. Changing a booking (`change_bus`, in `src/domain/bus.ts`)
Arguments: the booking, then the same six as `book_bus`.
1. `No such booking.`
2. Not whoever booked it and not a bus manager: `Only whoever booked it or the board can change it.` *Inferred:* the driver can cancel but not change.
3. Declined or Cancelled: `That booking is already off.`
4. Its last day is before today: `That booking’s days have passed.`
5. The booking checks 4 to 12 from the original spec, in order (days missing, last before first, past start, then `The last day can’t be before today.` so a change never rewrites where the bus already was, 14 days, 12 months, purpose, ride, driver, notes), except that a first day before today is allowed when it's the booking's own first day (a booking under way can still change its last day or driver), and the booking's own ride may stay even when the app hasn't loaded it (live loads rides from today on).
6. A Booked booking, changed by someone who isn't a bus manager, to any day outside its current days, unless the change would be booked straight away anyway (a recovery whose first day is today or tomorrow): `Only the board or NEC can add days to a Booked booking.` Shrinking, or changing anything but the days, is fine.
7. A Booked booking whose new days share a day with another Booked one: `The Rusty Bus is already booked then.`

The status never changes: Waiting stays Waiting (managers still say yes), and Booked stays Booked. `changed_by` and `changed_at` are recorded and shown ("Changed by Diesel on 29/10/2026").

### 2. Keys (`hand_bus_keys(p_to, p_note)`, `src/domain/busLog.ts`)
1. Not a bus hand: `Only Full and Nomad members, the board or whoever has the keys can log the Rusty Bus.`
2. Nobody, or not an approved member: `Pick someone who’s an approved member.`
3. They already have them: `They already have the keys.`
4. Note over 200: `Keep the note to 200 characters at most.`

Anyone among the bus hands can log a handover between any two people (the giver, the taker or a manager who saw it). *Inferred:* it's a trust log, not a lock.

### 3. Odometer (`log_bus_km(p_km, p_on, p_booking, p_note)`)
1. Not a bus hand (as above).
2. No day, or a day after today: `Pick the day, today or earlier.`
3. Not a whole number from 1 to 2,000,000: `The odometer is in whole km, up to 2,000,000.`
4. Lower than a reading (not struck out) on that day or before, or higher than one on a later day: `That reading is out of order with the ones before and after it.`
5. A booking that doesn't exist or isn't Booked: `Pick a Booked booking.`
6. Note over 200 (as above).

### 4. Running costs (`log_bus_cost(p_on, p_kind, p_cents, p_litres, p_booking, p_note)`)
1. Not a bus hand (as above).
2. Day (as above).
3. No kind: `Pick what it was for.`
4. Not a whole number of cents from 1 to 10,000,000: `Enter an amount from $0.01 to $100,000.`
5. Litres on anything but Fuel: `Only fuel takes litres.`
6. Litres not more than 0 and at most 1000 (two decimals; the app rounds before sending): `Litres: more than 0, up to 1000.`
7. Booking (as above).
8. Note over 200 (as above).

Costs don't go into the treasurer's books. Paying or paying someone back still goes through the Treasury as usual; the screen says so.

### 5. Striking out (`strike_bus_km(p_id)`, `strike_bus_cost(p_id)`)
1. `No such entry.`
2. Not whoever logged it and not a bus manager: `Only whoever logged it or the board can strike it out.`
3. Already struck: `That’s already struck out.`

### 6. Who sees what
- Handovers and readings: every approved member.
- Costs: bus managers (every board seat and the NEC, so every treasurer), plus each member's own logged costs. *Inferred:* club spending stays with the board, like the books.

### 7. The year's summary (app only, nothing stored)
For a financial year: the total, each kind's total (largest first), litres of fuel, **km run** (the year's last reading less the last reading before the year, or less the year's first reading when there's none before; struck ones left out) and **cost per km** when km run is above 0. Years offered: the current one plus every year with a cost.

## Screens
- **Rusty Bus:** a new **Keys and odometer** card under the hero: "Keys with Diesel since 27/10/2026" (or "Nobody's logged the keys yet") and "Odometer 123,456 km on 27/10/2026". It opens **Keys and km**. Managers also see a **Running costs** row with this year's total, which opens **Running costs**. A bus hand who isn't a manager sees the row as "Log a running cost".
- **Keys and km** (stack screen `BusKeys`):
  - the key holder, **Hand over the keys** (pick a member, note), and the last 20 handovers
  - **Log km**: km, day (DD/MM/YYYY, today by default), a Booked booking around that day (optional), note; the latest reading is shown as a guide
  - the readings, newest first, each with **Strike out** (`ConfirmButton`) for whoever may.
- **Running costs** (stack screen `BusCosts`):
  - year chips, the summary, "These aren't in the books. Pay or pay people back through the Treasury as usual."
  - **Log a cost**: kind chips, amount ($), day, litres (Fuel only), booking (optional), note
  - the year's costs, newest first, with **Strike out**.
- **Booking:** **Change booking** for whoever booked it and managers, which opens the booking form filled in (stack screen `ChangeBus { bookingId }`, the same form, button **Save changes**). The booking also shows "Changed by …", and the km run on it when it has two or more readings.

No Alert dialogs. Names, labels, numbers and dates in Rustnuts Stencil. Theme tokens only. Checked at 390×844.

## Data (`20270515000000_rusty_bus_extras.sql`)
- `bus_bookings`: add `changed_by uuid references members on delete set null` and `changed_at timestamptz`.
- `public.bus_cost_kind` enum: `fuel, service, repairs, tyres, rego, insurance, tolls, cleaning, other`.
- `public.bus_key_handovers (id, to_id → members set null, note ≤ 200, logged_by → members set null, logged_at)`.
- `public.bus_km (id, km int 1..2000000, read_on date, booking_id → bus_bookings set null, note ≤ 200, logged_by, logged_at, struck_by, struck_at)`.
- `public.bus_costs (id, spent_on date, kind, amount_cents int 1..10000000, litres numeric(6,2) > 0 ≤ 1000 and only on fuel, booking_id, note ≤ 200, logged_by, logged_at, struck_by, struck_at)`.
- RLS select only, as above; no API writes. Helper `private.bus_hand()`.
- No `drop` and no `delete from`. The live app reads the new tables with their own queries (`src/data/busExtrasLive.ts`), and a missing table loads as none.

## App
- Types: `BusKeyHandover`, `BusKm`, `BusCost`, `BusCostKind`; `BusBooking.changedBy/changedAt`; `ClubData.busKeys?`, `busKm?`, `busCosts?`.
- Context: `changeBus(id, input)`, `handBusKeys(toId, note)`, `logBusKm(input)`, `logBusCost(input)`, `strikeBusKm(id)`, `strikeBusCost(id)`.
- Demo: Diesel has the keys; readings over the last three months; rego, insurance, a service and fuel fills this year and some last year; one struck reading.

## Tests
- `npm test`: `busLog.test.ts` (every message in order, bus hands, order of readings, the summary's edges), `bus.test.ts` additions for changing, demo actions, live mapping.
- `npm run test:db`: `supabase/tests/rusty_bus_extras_test.sql` (the same rules and order, RLS for costs, no API writes, anon nothing), and parity cases for change, keys, km, cost and strike.

## Not in this spec
- Push notices (push is live; nothing is sent without Jeff's OK).
- Posting costs into the books, receipts as photos, a service-due reminder by km or date.
- Fuel economy (litres per 100 km): the fills and the readings don't line up well enough to be honest about it.
